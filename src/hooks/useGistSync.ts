import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../types";
import {
  saveToGist,
  saveToGistWithRetry,
  loadFromGist,
  getGistToken,
  getGistId,
  getGistAutoSync,
  setGistAutoSync,
  getGistLastPushAt,
  setGistLastPushAt,
  getGistLastPullAt,
  setGistLastPullAt,
  getGistVersions,
  getGistVersionsWithCredentials,
  setGistToken,
  setGistId,
  detectConflict,
  hashGistPayload,
  getGistLastPushedHash,
  setGistLastPushedHash,
  GistNoRemoteDataError,
  GistSchemaTooNewError,
  type GistVersion,
} from "../services/gistSync";
import { isEmptyLocalData, describeConnectTarget, type ConnectPayload } from "../services/deviceConnect";
import { toUserDataJson, normalizeImportedData } from "../services/dataService";
import { saveSafetySnapshot } from "../services/backupService";
import { requestApply } from "../components/ApplyConfirmModal";
import {
  GIST_AUTO_PUSH_DEBOUNCE_MS,
  GIST_REMOTE_CHECK_THROTTLE_MS,
  GIST_STALE_WARNING_HOURS,
} from "../constants/config";
import { useUIStore } from "../store/uiStore";
import { useAppStore } from "../store/appStore";
import {
  mergeGistPayloadTimeSeries,
  mergeDailyFx,
  mergeBenchmarkCloses,
  mergeMarketEnvSnapshots,
} from "../utils/timeSeriesMerge";
import type { GistSyncHealth } from "../services/gistSyncStatus";

const GIST_AUTO_SAVE_ERROR_TOAST_ID = "gist-auto-save-error";
const GIST_SCHEMA_TOAST_ID = "gist-schema-too-new";

/**
 * 원격 불러오기 — 원격이 더 새 스키마(GistSchemaTooNewError)면 이 세션의 자동 동기화를 멈춘다.
 * 구버전 앱이 새 필드를 모른 채 적용·재업로드하면 다른 기기의 새 필드가 지워지기 때문(앱 업데이트 전까지).
 */
async function loadRemoteGuarded(schemaBlockedRef: { current: boolean }) {
  try {
    return await loadFromGist();
  } catch (err) {
    if (err instanceof GistSchemaTooNewError) {
      schemaBlockedRef.current = true;
      toast.error(err.message, { id: GIST_SCHEMA_TOAST_ID, duration: 10_000 });
    }
    throw err;
  }
}
const GIST_RESUME_PULL_TOAST_ID = "gist-resume-pull";

/**
 * 마지막 push 해시 자리에 두는 '이 Gist와는 아직 맞춰 본 적 없음' 표식 — `unsynced:<gistId>`
 * (hashGistPayload는 숫자 문자열만 내므로 실제 해시와 겹치지 않음).
 * 기기 연결로 다른 Gist로 바꿨지만 적용하지 않은(취소·실패) 상태에서 세운다 — 어떤 내용도 '마지막 push와 같음'으로
 * 보지 않으므로 부팅 불러오기는 충돌 모달로 가고, 업로드는 시각과 무관하게 내용 비교(충돌 확인)를 거친다.
 * 세운 Gist ID에만 유효 — 설정에서 ID를 바꾸거나 비우면(새 Gist 생성) 무효가 되어 업로드를 막지 않는다.
 * 빈 해시는 '구버전 상태 → 원격 그대로 적용' 의미라 이 용도로 쓸 수 없다. 첫 push/pull 성공 시 실제 해시로 바뀐다.
 */
const UNSYNCED_PUSH_HASH_PREFIX = "unsynced:";

function unsyncedMarkerFor(gistId: string): string {
  return `${UNSYNCED_PUSH_HASH_PREFIX}${gistId}`;
}

/** 지금 설정된 Gist가 '아직 맞춰 본 적 없음' 표식 상태인지 (다른 Gist에 세운 표식은 무시) */
function isNeverSyncedWithCurrentGist(): boolean {
  const gistId = getGistId();
  return !!gistId && getGistLastPushedHash() === unsyncedMarkerFor(gistId);
}

/**
 * '반영한 원격 없음' known 기준 — 어떤 commit보다 이르므로 업로드·복귀 확인이 시각 비교로 통과하지 않고
 * 원격 내용 비교(우리 마지막 push와 같으면 가짜 충돌로 걸러짐)부터 한다. 빈 known은 '판단 불가 → 통과'라 쓸 수 없다.
 */
const NOTHING_ACCOUNTED_AT = new Date(0).toISOString();

/**
 * Gist 데이터로 덮기 직전 로컬에 잃을 것이 있는지 — 받을 내용과 같거나 마지막 동기화(push/pull) 내용과 같으면
 * (Gist 버전 이력에 이미 있음) false. 해시 기록이 없으면(구버전 상태) 판단 불가 → true.
 * 용도: 주기 확인으로 받을 때마다 안전 스냅샷이 쌓여 보존 한도(라벨 최근 3개)에서 사용자 작업 직전 스냅샷을 밀어내지 않게.
 */
export function hasUnsyncedLocalData(localJson: string, incomingJson: string): boolean {
  return localJson !== incomingJson && hashGistPayload(localJson) !== getGistLastPushedHash();
}

/**
 * 앱 복귀 시 "원격(다른 기기)이 우리가 아는 시점 이후에 바뀌었는가" 순수 판정.
 * - known이 비어 있으면(부팅 때 토큰이 없어 원격 시점을 한 번도 못 봤음) 판단 불가 → false(보수적).
 * - 원격 버전이 없거나 시각 파싱 실패 → false.
 * - 원격 committed_at이 known보다 **엄격히** 새로울 때만 true (같으면 우리 push/pull 시점 그대로).
 * 내용이 우리 마지막 push와 같은 '가짜 변경'은 여기서 가려낼 수 없다 — 호출부가 payload 해시로 2차 확인.
 */
export function checkRemoteChanged(
  knownRemoteCommit: string | null | undefined,
  latestVersion: Pick<GistVersion, "committedAt"> | null | undefined
): boolean {
  if (!knownRemoteCommit || !latestVersion?.committedAt) return false;
  return detectConflict(latestVersion.committedAt, knownRemoteCommit);
}

/** Gist payload 중 기기별 자동 적립(기록기)만으로 달라질 수 있는 날짜키 시계열 3종 */
const AUTO_SERIES_KEYS = ["historicalDailyFx", "benchmarkDailyCloses", "marketEnvSnapshots"] as const;

/**
 * 두 Gist payload의 차이가 자동 적립 시계열 3종 **만**인지 순수 판정.
 * 시계열을 제외한 나머지 필드를 최상위 키 정렬 후 직렬화해 비교한다(최상위 키 순서 차이 무시).
 * 파싱 실패·객체가 아니면 false(= 실제 변경으로 간주 → 보수적으로 충돌 모달 경로).
 * 용도: 복귀 시 로컬 dirty가 환율·지수·스냅샷 적립뿐이면 충돌 모달 대신 pull+union으로 조용히 처리.
 */
export function isTimeSeriesOnlyDiff(aJson: string, bJson: string): boolean {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(aJson);
    b = JSON.parse(bJson);
  } catch {
    return false;
  }
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const strip = (raw: object): string => {
    const r = { ...(raw as Record<string, unknown>) };
    for (const k of AUTO_SERIES_KEYS) delete r[k];
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(r).sort()) sorted[k] = r[k];
    return JSON.stringify(sorted);
  };
  return strip(a) === strip(b);
}

interface UseGistSyncOptions {
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
  /** 주어지면 탭이 표시 중일 때 이 간격(ms)마다 원격 변경을 확인(checkRemoteOnResume 재사용) */
  remotePollMs?: number;
  /**
   * true면 어떤 동기화도 하지 않는다(부팅 불러오기·자동 업로드·복귀 확인·수동 저장/불러오기) — 로드 실패(메모리는 빈 데이터)·
   * 로딩 중에 빈 데이터를 올리면 다른 기기가 주기 확인으로 그대로 받아 전 기기가 비워진다. 풀리면 부팅 불러오기부터.
   */
  disabled?: boolean;
}

export type GistConflictResolution = "apply-remote" | "force-push-local" | "cancel";

/** 기기 연결 결과 — failed는 이미 토스트로 이유를 알린 상태 */
type ConnectDeviceResult = "connected" | "cancelled" | "failed";

interface GistStaleWarning {
  type: "warning" | "critical";
  message: string;
  hoursSince: number;
}

interface UseGistSyncReturn {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  lastPushAt: string | null;
  lastPullAt: string | null;
  isSyncing: boolean;
  /** Gist 충돌 모달에서 사용자가 액션을 선택했을 때 호출 */
  resolveGistConflict: (resolution: GistConflictResolution) => Promise<void>;
  /** N시간 이상 푸시 안 됐을 때 노출되는 경고 (자동 동기화 켜져 있을 때만) */
  gistStaleWarning: GistStaleWarning | null;
  /**
   * 수동 저장 — 디바운스·dirty 체크 건너뛰고 즉시 푸시.
   * React state(`lastPushAt`)와 localStorage 둘 다 갱신해서 헤더 "N시간 전" 표시가 즉시 반영됨.
   * 자동 동기화 OFF 상태에서도 사용 가능 (사용자 의도 우선).
   */
  manualPush: () => Promise<void>;
  /**
   * 수동 불러오기 — Gist 최신 데이터를 onApplyPulledData로 적용하고
   * lastPullAt·knownRemoteCommit·lastPushedPayload를 정식 경로와 동일하게 갱신.
   * (설정 카드의 "Gist에서 불러오기"가 상태 갱신을 우회하던 문제 해소)
   */
  manualPull: () => Promise<void>;
  /** Gist 과거 버전 복원 직후 동기화 상태 갱신 — 자동 push로 인한 조용한 롤백 방지 */
  syncStateAfterRestore: (dataJson: string, committedAt: string) => void;
  /** 최근 성공 시각·연속 실패 횟수·마지막 오류 — 헤더 상태 메뉴("동기화 오류")용 */
  syncHealth: GistSyncHealth;
  /**
   * 연결 링크로 받은 토큰·Gist ID로 이 기기를 연결 — 연결 테스트 → 저장 → 즉시 불러오기 → 자동 동기화 ON.
   * 원격 데이터가 검증·적용되지 않으면 자동 동기화를 켜지 않는다. ⚠ 토큰은 로그·토스트에 남기지 않는다.
   */
  connectDevice: (payload: ConnectPayload) => Promise<ConnectDeviceResult>;
}

/**
 * 자동 Gist 동기화 훅
 * - 앱 시작 시 Gist가 더 최신이면 자동 불러오기
 * - 데이터 변경 후 1분 뒤 자동 Gist 저장
 */
export function useGistSync(
  data: AppData,
  onApplyPulledData: (dataJson: string, remoteUpdatedAt: string) => void,
  options?: UseGistSyncOptions
): UseGistSyncReturn {
  const { onLog, remotePollMs, disabled = false } = options ?? {};

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => getGistAutoSync());
  const [lastPushAt, setLastPushAt] = useState<string | null>(() => getGistLastPushAt() || null);
  const [lastPullAt, setLastPullAt] = useState<string | null>(() => getGistLastPullAt() || null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncHealth, setSyncHealth] = useState<GistSyncHealth>({
    lastCheckAt: null,
    consecutiveFailures: 0,
    lastError: null,
  });

  /** 동기화 성공 기록 — 실패 카운트 리셋 (Task 4 connectDevice도 재사용) */
  const recordSyncOk = useCallback(() => {
    setSyncHealth({ lastCheckAt: new Date().toISOString(), consecutiveFailures: 0, lastError: null });
  }, []);
  /** 동기화 실패 기록 — 연속 실패 +1. 메시지에 토큰을 넣지 말 것. */
  const recordSyncFail = useCallback((message: string) => {
    setSyncHealth((prev) => ({ ...prev, consecutiveFailures: prev.consecutiveFailures + 1, lastError: message }));
  }, []);
  /** 최신 원격 버전 1건 조회 — 성공/실패를 기록하고, 실패 시 기존 `.catch(() => [])`처럼 undefined로 계속 진행 */
  const fetchLatestVersion = useCallback(async (): Promise<GistVersion | undefined> => {
    try {
      const versions = await getGistVersions(1);
      recordSyncOk();
      return versions[0];
    } catch (err) {
      recordSyncFail(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, [recordSyncOk, recordSyncFail]);

  const autoPushTimerRef = useRef<number | null>(null);
  const lastPushedPayloadRef = useRef<string>("");
  const hasMountedRef = useRef(false);
  const isPushingRef = useRef(false);
  const knownRemoteCommitRef = useRef<string>("");
  /** 복귀 시 원격 확인 마지막 시각(ms) — 부팅 확인·복귀 확인이 공유하는 throttle 기준 */
  const lastRemoteCheckAtRef = useRef<number>(0);
  /** 복귀 시 원격 확인 재진입 가드 */
  const isRemoteCheckingRef = useRef(false);
  /**
   * Gist 과거 버전 복원 직후 true — knownRemoteCommitRef가 의도적으로 과거 시점이라 복귀 확인이
   * 최신 원격을 '외부 변경'으로 오인해 복원을 조용히 되돌릴 수 있다. 다음 push/pull 성공 때 해제.
   */
  const restoredRef = useRef(false);
  /**
   * 기기 연결(connectDevice) 진행 중 true — 자격증명이 바뀌는 사이 자동 업로드·원격 확인이 새로 시작되면
   * 옛 Gist의 로컬 데이터를 새 Gist로 올리거나(재시도) 새 Gist를 옛 기준으로 판정할 수 있어 보류한다.
   */
  const isConnectingRef = useRef(false);
  /** 기기 연결이 자격증명을 바꿀 때마다 +1 — 그 전에 시작된 부팅 불러오기(Effect 1) 결과를 폐기하는 기준 */
  const connectGenRef = useRef(0);
  /** runAutoPush가 항상 최신 data를 직렬화하도록 — 디바운스 타이머 + visibility flush 양쪽이 공유 */
  const dataRef = useRef(data);
  dataRef.current = data;
  /** 대기 중이던 타이머·비동기 작업도 최신 disabled를 보도록 */
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  /** 원격이 더 새 스키마로 저장됨 — 앱을 업데이트(새로고침)할 때까지 자동 업로드·원격 적용 중단 */
  const schemaBlockedRef = useRef(false);
  /**
   * Effect 1 전용 최신 콜백 — 의존성에서 빼 둔다. 미완료 정리 시 재시도(hasMountedRef 리셋)를 하므로
   * 매 렌더 새로 만들어지는 콜백이 의존성에 있으면 setIsSyncing 리렌더마다 불러오기가 다시 시작된다.
   */
  const onApplyRef = useRef(onApplyPulledData);
  onApplyRef.current = onApplyPulledData;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  // Effect 1: 시작 시 자동 불러오기 (자동 동기화 ON 일 때만)
  // - Gist의 마지막 commit 시각이 로컬 lastPullAt 보다 최신이면 자동으로 불러옴
  // - 첫 활성화 시 강제로 풀 백업이 만들어진 뒤 동기화 (loadFromGist 응답을 그대로 적용 콜백에 전달)
  useEffect(() => {
    if (!autoSyncEnabled || disabled) return;
    if (hasMountedRef.current) return;
    // 토큰 검사보다 먼저 마운트 플래그를 세운다 — 부팅 시 토큰이 없었다가
    // 나중에 입력해도 Effect 2(자동 push)가 영구 비활성되지 않도록.
    hasMountedRef.current = true;
    if (!getGistToken() || !getGistId()) return;

    let cancelled = false;
    let settled = false;
    // 대기 중에 기기 연결이 자격증명을 바꾸면 이 pull은 옛 Gist 기준 — 결과를 쓰지 않고 버린다
    const connectGen = connectGenRef.current;
    (async () => {
      try {
        setIsSyncing(true);
        lastRemoteCheckAtRef.current = Date.now();
        const latest = await fetchLatestVersion();
        if (cancelled || connectGen !== connectGenRef.current) return;
        const localPull = getGistLastPullAt();
        const localPush = getGistLastPushAt();
        // 1) 원격이 마지막 pull보다 새로움 + 2) 원격이 우리의 마지막 push와 다름 (= 외부 기기가 변경)
        // 두 조건 모두 만족할 때만 pull. 하나라도 아니면 로컬에 미-push된 변경이 덮여 사라지는 것을 방지.
        const remoteIsNewerThanLastPull =
          !!latest && (!localPull || new Date(latest.committedAt) > new Date(localPull));
        const remoteIsFromExternalDevice =
          !!latest && (!localPush || new Date(latest.committedAt) > new Date(localPush));
        const remoteIsNewer = remoteIsNewerThanLastPull && remoteIsFromExternalDevice;
        // known은 원격을 반영한 시점까지만 — 미리 최신으로 올리면 불러오기가 중단(실패·정리)됐을 때 다음 업로드가
        // 충돌 확인 없이 다른 기기 변경을 덮는다. 아직 반영 못 한 원격이 있으면 마지막 pull(없으면 epoch)에 둬서
        // 업로드·복귀 확인이 내용 비교부터 하게 한다. 적용에 성공하면 아래에서 원격 시각으로 올린다.
        knownRemoteCommitRef.current = remoteIsNewerThanLastPull
          ? localPull || NOTHING_ACCOUNTED_AT
          : latest?.committedAt ?? "";
        if (!remoteIsNewer) {
          // 원격이 마지막 pull보다 새로운데 lastPushAt(로컬 시계)보다 이르면 '우리 push'로 보이지만, 로컬 시계가 빠르면
          // 다른 기기 변경도 그렇게 보인다 — known·lastPullAt을 올리지 않고 업로드·복귀 확인의 내용 비교에 맡긴다.
          onLogRef.current?.("Gist 자동 동기화: 외부 변경 없음(건너뜀)", "info");
          return;
        }
        const { dataJson, updatedAt } = await loadRemoteGuarded(schemaBlockedRef);
        if (cancelled) return;
        if (connectGen !== connectGenRef.current) return;
        // 로컬에 push되지 않은 변경이 있으면 무모달 덮어쓰기 금지 — 충돌 모달로 사용자 결정.
        // (마지막 push payload 해시와 현재 로컬 데이터 해시를 비교해 dirty 감지.
        //  해시 기록이 없는 구버전 상태에서는 기존 동작 유지 — 원격 적용.)
        const localJson = toUserDataJson(dataRef.current);
        const lastPushedHash = getGistLastPushedHash();
        const localDirty =
          !!lastPushedHash && hashGistPayload(localJson) !== lastPushedHash && localJson !== dataJson;
        if (localDirty) {
          useUIStore.getState().setGistConflict({
            remoteDataJson: dataJson,
            remoteUpdatedAt: updatedAt,
            pendingLocalDataJson: localJson,
          });
          onLogRef.current?.("Gist 자동 불러오기: 로컬에 push되지 않은 변경 감지 — 충돌 확인 필요", "info");
          return;
        }
        onApplyRef.current(dataJson, updatedAt);
        setGistLastPullAt(updatedAt);
        setLastPullAt(updatedAt);
        knownRemoteCommitRef.current = updatedAt;
        // pull 적용 후 로컬=원격 — 동일 payload 재push 방지 + 다음 부팅 dirty 기준 갱신
        lastPushedPayloadRef.current = dataJson;
        setGistLastPushedHash(hashGistPayload(dataJson));
        recordSyncOk();
        onLogRef.current?.("Gist 자동 불러오기 성공", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordSyncFail(message);
        onLogRef.current?.(`Gist 자동 불러오기 실패: ${message}`, "error");
      } finally {
        settled = true;
        if (!cancelled) setIsSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
      // 끝나기 전에 정리됨(StrictMode 이중 실행·자동 동기화 끔) = 원격을 반영 못 함 — 다음 실행이 다시 불러오게
      if (!settled) hasMountedRef.current = false;
    };
  }, [autoSyncEnabled, disabled, fetchLatestVersion, recordSyncOk, recordSyncFail]);

  /**
   * 디바운스/즉시 flush 양쪽이 호출하는 실제 push 루틴.
   * 충돌 감지 → 충돌 모달 / 정상 → retry 래퍼로 push.
   * 일시적 오류는 saveToGistWithRetry가 내부 재시도, 영구 오류는 즉시 throw → toast.
   */
  const runAutoPush = useCallback(async () => {
    if (!autoSyncEnabled || disabledRef.current || schemaBlockedRef.current) return;
    if (!getGistToken() || !getGistId()) return;
    if (isPushingRef.current) return;
    if (isConnectingRef.current) return;
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 자동 저장 보류", "info");
      return;
    }

    const dataJson = toUserDataJson(dataRef.current);
    if (dataJson === lastPushedPayloadRef.current) return;

    isPushingRef.current = true;
    try {
      setIsSyncing(true);
      const latest = await fetchLatestVersion();
      const known = knownRemoteCommitRef.current || getGistLastPullAt();
      // 기기 연결 후 아직 맞춰 보지 않은 Gist — 시각 비교(옛 기준·빈 기준이면 통과해 버림) 대신 항상 내용 비교부터.
      // 표식은 어떤 내용과도 같지 않으므로 원격에 데이터가 있으면 충돌 모달로만 끝난다.
      const neverSynced = isNeverSyncedWithCurrentGist();
      if (neverSynced || detectConflict(latest?.committedAt, known)) {
        // 시각상 원격이 새로 보여도, 내용이 우리가 마지막에 push한 것과 같으면 가짜 충돌
        // (gist updated_at vs commit committed_at 소스 차이). 내용 해시로 진짜 외부 변경만 모달 표시 →
        // "PC에서 수정했는데 자꾸 과거로 되돌리라"는 가짜 충돌 제거.
        try {
          const remote = await loadRemoteGuarded(schemaBlockedRef);
          const lastPushedHash = getGistLastPushedHash();
          if (lastPushedHash && hashGistPayload(remote.dataJson) === lastPushedHash) {
            knownRemoteCommitRef.current = latest?.committedAt || known;
            onLog?.("Gist: 시각만 다른 가짜 충돌(내용 동일) — 저장 진행", "info");
          } else {
            onLog?.("Gist 충돌 감지 — 외부 기기 변경 확인, 모달 표시", "info");
            useUIStore.getState().setGistConflict({
              remoteDataJson: remote.dataJson,
              remoteUpdatedAt: remote.updatedAt,
              pendingLocalDataJson: dataJson,
            });
            return;
          }
        } catch (pullErr) {
          const message = pullErr instanceof Error ? pullErr.message : String(pullErr);
          if (neverSynced && pullErr instanceof GistNoRemoteDataError) {
            // 맞춰 보지 않은 Gist에 덮어쓸 FarmWallet 데이터 자체가 없음(파일 없음·Gist 삭제) — 잃을 것이 없으니 저장 진행
            // (saveToGist가 파일을 만들거나 404 → 새 Gist 생성으로 처리하고, 성공하면 표식이 실제 해시로 바뀐다)
            onLog?.(`Gist: 원격에 FarmWallet 데이터 없음 — 저장 진행 (${message})`, "info");
          } else {
            // 표식 상태에서 원격을 못 읽으면 올리지 않는다. 직전 fetchLatestVersion 성공이 연속 실패 수를 리셋해
            // 배지(2회 연속)만으로는 안 드러나므로 일반 자동 저장 실패처럼 토스트도 띄운다 (토큰 미포함 문구)
            if (neverSynced) {
              recordSyncFail(message);
              toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
            }
            onLog?.(`Gist 충돌 후 원격 fetch 실패: ${message}`, "error");
            return;
          }
        }
      }
      const result = await saveToGistWithRetry(dataJson, {
        onAttempt: (attempt, err) => {
          onLog?.(`Gist 푸시 ${attempt}회 실패 (${err.message}) — 재시도`, "info");
        }
      });
      lastPushedPayloadRef.current = dataJson;
      setGistLastPushedHash(hashGistPayload(dataJson));
      // 로컬 시각 사용 — GitHub updated_at이 약간 지연/stale일 수 있어 "방금 저장" 즉시 반영
      const nowIso = new Date().toISOString();
      setGistLastPushAt(nowIso);
      setLastPushAt(nowIso);
      // committed_at(getGistVersions와 동일 소스)을 known으로 — updated_at을 쓰면 다음 push에서
      // committed_at > updated_at 로 보여 매번 가짜 충돌이 떴음.
      knownRemoteCommitRef.current = result.committedAt || result.updatedAt || nowIso;
      restoredRef.current = false;
      recordSyncOk();
      onLog?.("Gist 자동 저장 성공", "success");
      // 이전 실패 토스트가 있다면 정리
      toast.dismiss(GIST_AUTO_SAVE_ERROR_TOAST_ID);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncFail(message);
      onLog?.(`Gist 자동 저장 실패: ${message}`, "error");
      // 토스트로 사용자에게 가시화 — 모바일에서 백그라운드 suspend 등 조용한 실패 방지
      toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
    } finally {
      isPushingRef.current = false;
      setIsSyncing(false);
    }
  }, [autoSyncEnabled, onLog, fetchLatestVersion, recordSyncOk, recordSyncFail]);

  /**
   * 수동 저장 — 사용자가 "저장" 버튼 클릭 시. 디바운스/dirty 체크 없이 즉시 푸시.
   * 자동 동기화 OFF 상태에서도 작동 (자동 동기화 가드 없음).
   * 동일 payload여도 푸시 — GitHub이 새 commit·새 updated_at 만들어 timestamp가 갱신됨.
   */
  const manualPush = useCallback(async () => {
    if (disabledRef.current) {
      toast.error("데이터를 불러오지 못한 상태에서는 Gist에 저장할 수 없어요.");
      return;
    }
    if (schemaBlockedRef.current) {
      toast.error("다른 기기가 더 새 앱으로 저장해 Gist 저장을 멈췄어요. 이 기기 앱을 새로고침·업데이트하세요.", { id: GIST_SCHEMA_TOAST_ID });
      return;
    }
    // gistId는 없어도 됨 — 첫 저장 시 saveToGist가 새 Gist를 생성하고 ID를 기록한다.
    if (!getGistToken()) {
      onLog?.("Gist 토큰 미설정", "error");
      toast.error("Gist 토큰을 먼저 설정하세요.");
      return;
    }
    if (isPushingRef.current) return;
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 저장 보류", "info");
      return;
    }

    const dataJson = toUserDataJson(dataRef.current);

    // 진행 중인 디바운스 타이머가 있으면 취소 (수동 저장이 우선)
    if (autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
      autoPushTimerRef.current = null;
    }

    isPushingRef.current = true;
    try {
      setIsSyncing(true);
      // 충돌 감지 (자동 동기화 OFF여도 다른 기기에서 변경됐을 수 있으니 체크)
      const latest = await fetchLatestVersion();
      const known = knownRemoteCommitRef.current || getGistLastPullAt();
      // 기기 연결 후 아직 맞춰 보지 않은 Gist — runAutoPush와 같은 규칙(항상 내용 비교 → 충돌 모달)
      const neverSynced = isNeverSyncedWithCurrentGist();
      if (neverSynced || detectConflict(latest?.committedAt, known)) {
        // 시각상 원격이 새로 보여도, 내용이 우리가 마지막에 push한 것과 같으면 가짜 충돌
        // (gist updated_at vs commit committed_at 소스 차이). 내용 해시로 진짜 외부 변경만 모달 표시 →
        // "PC에서 수정했는데 자꾸 과거로 되돌리라"는 가짜 충돌 제거.
        try {
          const remote = await loadRemoteGuarded(schemaBlockedRef);
          const lastPushedHash = getGistLastPushedHash();
          if (lastPushedHash && hashGistPayload(remote.dataJson) === lastPushedHash) {
            knownRemoteCommitRef.current = latest?.committedAt || known;
            onLog?.("Gist: 시각만 다른 가짜 충돌(내용 동일) — 저장 진행", "info");
          } else {
            onLog?.("Gist 충돌 감지 — 외부 기기 변경 확인, 모달 표시", "info");
            useUIStore.getState().setGistConflict({
              remoteDataJson: remote.dataJson,
              remoteUpdatedAt: remote.updatedAt,
              pendingLocalDataJson: dataJson,
            });
            return;
          }
        } catch (pullErr) {
          const message = pullErr instanceof Error ? pullErr.message : String(pullErr);
          if (neverSynced && pullErr instanceof GistNoRemoteDataError) {
            // runAutoPush와 동일 — 덮어쓸 FarmWallet 데이터가 없으면(파일 없음·Gist 삭제) 저장 진행
            onLog?.(`Gist: 원격에 FarmWallet 데이터 없음 — 저장 진행 (${message})`, "info");
          } else {
            if (neverSynced) {
              // 사용자가 누른 저장이 조용히 끝나지 않도록 — 실패 기록 + 토스트 (메시지는 gistSync 문구, 토큰 없음)
              recordSyncFail(message);
              toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
            }
            onLog?.(`Gist 충돌 후 원격 fetch 실패: ${message}`, "error");
            return;
          }
        }
      }
      const result = await saveToGistWithRetry(dataJson, {
        onAttempt: (attempt, err) => {
          onLog?.(`Gist 푸시 ${attempt}회 실패 (${err.message}) — 재시도`, "info");
        }
      });
      lastPushedPayloadRef.current = dataJson;
      setGistLastPushedHash(hashGistPayload(dataJson));
      // 로컬 시각 사용 — GitHub 응답의 updated_at이 stale일 수 있어 사용자 체감과 어긋남 방지
      const nowIso = new Date().toISOString();
      setGistLastPushAt(nowIso);
      setLastPushAt(nowIso);
      // committed_at(getGistVersions와 동일 소스)을 known으로 — updated_at을 쓰면 다음 push에서
      // committed_at > updated_at 로 보여 매번 가짜 충돌이 떴음.
      knownRemoteCommitRef.current = result.committedAt || result.updatedAt || nowIso;
      restoredRef.current = false;
      recordSyncOk();
      onLog?.("Gist 저장 성공", "success");
      toast.dismiss(GIST_AUTO_SAVE_ERROR_TOAST_ID);
      toast.success("Gist 저장 완료");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncFail(message);
      onLog?.(`Gist 저장 실패: ${message}`, "error");
      toast.error(`Gist 저장 실패: ${message}`, { id: GIST_AUTO_SAVE_ERROR_TOAST_ID });
    } finally {
      isPushingRef.current = false;
      setIsSyncing(false);
    }
  }, [onLog, fetchLatestVersion, recordSyncOk, recordSyncFail]);

  /**
   * 수동 불러오기 — 설정 카드의 "Gist에서 불러오기"용 정식 pull 경로.
   * lastPullAt(localStorage+state)·knownRemoteCommitRef·lastPushedPayloadRef를 모두 갱신해
   * 다음 자동 push 때 가짜 충돌 모달이 뜨지 않게 한다.
   * 데이터 검증·안전 스냅샷은 onApplyPulledData(App.handleGistPulledData) 내부에서 수행.
   */
  const manualPull = useCallback(async () => {
    if (disabledRef.current) {
      toast.error("데이터를 불러오지 못한 상태에서는 Gist에서 불러올 수 없어요.");
      return;
    }
    if (!getGistToken() || !getGistId()) {
      onLog?.("Gist 토큰·ID 미설정", "error");
      toast.error("Gist 토큰과 ID를 먼저 설정하세요.");
      return;
    }
    if (useUIStore.getState().gistConflict) {
      onLog?.("Gist 충돌 모달이 열려 있어 불러오기 보류", "info");
      return;
    }
    try {
      setIsSyncing(true);
      const { dataJson, updatedAt } = await loadRemoteGuarded(schemaBlockedRef);

      const commit = () => {
        // 검증·안전 스냅샷·실제 반영은 onApplyPulledData(App.handleGistPulledData) 내부에서 수행.
        onApplyPulledData(dataJson, updatedAt);
        setGistLastPullAt(updatedAt);
        setLastPullAt(updatedAt);
        knownRemoteCommitRef.current = updatedAt;
        restoredRef.current = false;
        lastPushedPayloadRef.current = dataJson;
        setGistLastPushedHash(hashGistPayload(dataJson));
        recordSyncOk();
        onLog?.("Gist에서 불러오기 완료", "success");
      };

      // diff 미리보기(1-6)를 위한 정규화 — 실패하면 게이트를 건너뛰고 onApplyPulledData가
      // 검증·오류 toast를 그대로 담당(실패 시 미적용 계약은 거기서 유지됨).
      let after: AppData | null = null;
      try {
        after = normalizeImportedData(JSON.parse(dataJson) as unknown);
      } catch {
        after = null;
      }

      if (after) {
        requestApply({
          title: "Gist에서 불러오기",
          before: dataRef.current,
          after,
          onConfirm: commit,
          onCancel: () => onLog?.("Gist 수동 불러오기: 사용자 취소", "info")
        });
      } else {
        commit();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncFail(message);
      onLog?.(`Gist 불러오기 실패: ${message}`, "error");
      toast.error(`Gist 불러오기 실패: ${message}`);
    } finally {
      setIsSyncing(false);
    }
  }, [onApplyPulledData, onLog, recordSyncOk, recordSyncFail]);

  /**
   * 원격 payload를 로컬에 적용하되, 자동 적립 시계열(환율·지수 종가·반월 스냅샷)은 폐기하지 않고
   * 원격 payload에 date-union으로 합친다(원격 우선, id 키 컬렉션은 원격 그대로 — 1-7 설계).
   * 합칠 대상은 지금 덮일 현재 메모리 데이터(dataRef) — 모달이 열린 뒤에도 기록기가 더 적립했을 수 있다.
   * 동기화 상태(lastPullAt·knownRemoteCommit·lastPushed payload/hash)도 함께 갱신:
   * lastPushed는 **원격이 실제로 가진 payload**로 맞춘다 — 로컬 시계열이 채워졌으면 로컬이 원격보다
   * 많아 dirty → 다음 자동 push가 union을 원격에 올린다. 채워진 게 없으면 불필요한 push 방지.
   * 충돌 모달 '원격 적용'과 복귀 시 자동 pull이 공유. 반환값 = 로컬에서 채워진 시계열 건수.
   */
  const applyRemoteWithSeriesUnion = useCallback((remoteDataJson: string, remoteAt: string): number => {
    const mergedRemote = mergeGistPayloadTimeSeries(remoteDataJson, toUserDataJson(dataRef.current));
    onApplyPulledData(mergedRemote.json, remoteAt);
    setGistLastPullAt(remoteAt);
    setLastPullAt(remoteAt);
    knownRemoteCommitRef.current = remoteAt;
    restoredRef.current = false;
    lastPushedPayloadRef.current = remoteDataJson;
    setGistLastPushedHash(hashGistPayload(remoteDataJson));
    return mergedRemote.filledFromOther;
  }, [onApplyPulledData]);

  /**
   * 앱 복귀(visibilitychange:visible·online) 시 원격 변경 확인.
   * getGistVersions(1) 경량 조회 → 우리가 아는 commit보다 새롭고(checkRemoteChanged) 내용도 우리 마지막
   * push와 다르면(해시 2차 확인 — 가짜 변경 제거):
   *  - 로컬 dirty 없음 → 자동 pull(시계열 union 포함), 토스트 '다른 기기 변경 반영됨'
   *  - dirty가 자동 적립 시계열 3종만의 차이(isTimeSeriesOnlyDiff) → 충돌 대신 pull+union으로 조용히 처리
   *  - 그 외 dirty(id 키 컬렉션 변경) → 기존 충돌 모달(1-7 union 포함)
   * 스킵: 자동 동기화 off·토큰/ID 없음·in-flight push·열린 충돌 모달·복원 직후·throttle·재진입.
   * dirty 판정 기준: 세션 내 마지막 push/pull payload(lastPushedPayloadRef). 없으면(부팅 후 첫 push 전)
   * 부팅 pull과 같은 localStorage 해시 기준 — 이 경우 시계열-only 판정은 불가(원문 없음) → 충돌 모달.
   * 둘 다 없으면(한 번도 push/pull 성공 못 함) 판단 불가 → 조용히 덮어쓰지 않고 충돌 모달(보수적).
   */
  const checkRemoteOnResume = useCallback(async () => {
    if (!autoSyncEnabled || disabledRef.current || schemaBlockedRef.current) return;
    if (!hasMountedRef.current) return;
    if (!getGistToken() || !getGistId()) return;
    if (isPushingRef.current || isRemoteCheckingRef.current) return;
    if (isConnectingRef.current) return;
    if (useUIStore.getState().gistConflict) return;
    if (restoredRef.current) return;
    const now = Date.now();
    if (now - lastRemoteCheckAtRef.current < GIST_REMOTE_CHECK_THROTTLE_MS) return;
    lastRemoteCheckAtRef.current = now;
    isRemoteCheckingRef.current = true;
    try {
      setIsSyncing(true);
      const latest = await fetchLatestVersion();
      const known = knownRemoteCommitRef.current || getGistLastPullAt();
      if (!latest || !checkRemoteChanged(known, latest)) return;
      // 조회 대기 중 push·모달이 시작됐으면 그쪽 경로에 맡긴다 (push는 자체 충돌 감지 보유)
      if (isPushingRef.current || useUIStore.getState().gistConflict) return;
      const remote = await loadRemoteGuarded(schemaBlockedRef);
      if (isPushingRef.current || useUIStore.getState().gistConflict) return;
      const remoteAt = latest.committedAt;
      const lastPushedHash = getGistLastPushedHash();
      if (lastPushedHash && hashGistPayload(remote.dataJson) === lastPushedHash) {
        // 시각만 다르고 내용은 우리 마지막 push와 동일 — 외부 변경 아님
        knownRemoteCommitRef.current = remoteAt;
        onLog?.("Gist 복귀 확인: 시각만 다른 가짜 변경(내용 동일) — 건너뜀", "info");
        return;
      }
      const localJson = toUserDataJson(dataRef.current);
      if (localJson === remote.dataJson) {
        knownRemoteCommitRef.current = remoteAt;
        lastPushedPayloadRef.current = remote.dataJson;
        setGistLastPushedHash(hashGistPayload(remote.dataJson));
        return;
      }
      const baseline = lastPushedPayloadRef.current;
      const localDirty = baseline
        ? localJson !== baseline
        : lastPushedHash
          ? hashGistPayload(localJson) !== lastPushedHash
          : true; // 기준 없음 = 판단 불가 → dirty 취급(무모달 덮어쓰기 금지)
      const seriesOnlyDirty = localDirty && !!baseline && isTimeSeriesOnlyDiff(localJson, baseline);
      if (localDirty && !seriesOnlyDirty) {
        useUIStore.getState().setGistConflict({
          remoteDataJson: remote.dataJson,
          remoteUpdatedAt: remote.updatedAt,
          pendingLocalDataJson: localJson,
        });
        onLog?.("Gist 복귀 확인: 다른 기기 변경 + 로컬 미push 변경 — 충돌 확인 필요", "info");
        return;
      }
      const filled = applyRemoteWithSeriesUnion(remote.dataJson, remoteAt);
      toast.success("다른 기기 변경 반영됨", { id: GIST_RESUME_PULL_TOAST_ID });
      onLog?.(
        seriesOnlyDirty
          ? `Gist 복귀 확인: 다른 기기 변경 반영 (로컬 차이는 자동 적립 시계열뿐 — union ${filled}건 보존)`
          : filled > 0
            ? `Gist 복귀 확인: 다른 기기 변경 반영 (로컬 자동 적립 시계열 ${filled}건 보존)`
            : "Gist 복귀 확인: 다른 기기 변경 반영",
        "success"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncFail(message);
      onLog?.(`Gist 복귀 확인 실패: ${message}`, "error");
    } finally {
      isRemoteCheckingRef.current = false;
      setIsSyncing(false);
    }
  }, [autoSyncEnabled, applyRemoteWithSeriesUnion, onLog, fetchLatestVersion, recordSyncFail]);

  // Effect 2: 데이터 변경 시 자동 저장 (debounced)
  useEffect(() => {
    if (!autoSyncEnabled || disabled) return;
    if (!getGistToken() || !getGistId()) return;
    if (!hasMountedRef.current) return;

    const dataJson = toUserDataJson(data);
    if (dataJson === lastPushedPayloadRef.current) return;

    if (autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
    }

    autoPushTimerRef.current = window.setTimeout(() => {
      autoPushTimerRef.current = null;
      void runAutoPush();
    }, GIST_AUTO_PUSH_DEBOUNCE_MS);

    return () => {
      if (autoPushTimerRef.current) {
        window.clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
    };
  }, [autoSyncEnabled, disabled, data, runAutoPush]);

  // Effect 3: 모바일 백그라운드 suspend 방지용 즉시 flush + 오프라인 복귀 시 재개 + 복귀 시 원격 확인.
  // visibilitychange:hidden — 앱 전환·화면 잠금 시점. setTimeout이 정지·지연되기 전에 push.
  // visibilitychange:visible — 앱 복귀. throttle로 원격 변경 확인(checkRemoteOnResume).
  // pagehide — 페이지가 실제로 unload되는 시점 (iOS Safari에서 신뢰성 ↑).
  // online — 장시간 오프라인 후 복귀. dirty면 1회 push (다음 변경까지 기다리면 다른 기기 변경에 덮일 위험),
  //          아니면 원격 확인(push가 시작됐으면 push의 자체 충돌 감지에 맡기고 확인은 스킵).
  // flush는 dirty가 있을 때만 작동(runAutoPush의 가드가 재진입 방지), 디바운스 타이머는 cancel 후 즉시 push.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!autoSyncEnabled || disabled) return;
    if (!hasMountedRef.current) return;

    const flush = () => {
      if (!getGistToken() || !getGistId()) return;
      const dataJson = toUserDataJson(dataRef.current);
      if (dataJson === lastPushedPayloadRef.current) return;
      if (autoPushTimerRef.current) {
        window.clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
      // 페이지가 곧 죽을 수 있어 await하지 않음 — 브라우저가 in-flight fetch를 잠시 살려둠 (보통 ~30s)
      void runAutoPush();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
      else if (document.visibilityState === "visible") void checkRemoteOnResume();
    };
    const onOnline = () => {
      onLog?.("네트워크 복귀 — 미저장 변경이 있으면 Gist 푸시 재개", "info");
      flush();
      void checkRemoteOnResume();
    };

    // 탭을 계속 켜둔 PC가 다른 기기 입력을 받도록 표시 중에만 주기 확인 (가드·throttle은 checkRemoteOnResume이 담당)
    const pollId = remotePollMs
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void checkRemoteOnResume();
        }, remotePollMs)
      : null;

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", onOnline);
    return () => {
      if (pollId !== null) window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onOnline);
    };
  }, [autoSyncEnabled, disabled, runAutoPush, checkRemoteOnResume, onLog, remotePollMs]);

  const setAutoSyncEnabled = useCallback((enabled: boolean) => {
    setGistAutoSync(enabled);
    setAutoSyncEnabledState(enabled);
    if (!enabled && autoPushTimerRef.current) {
      window.clearTimeout(autoPushTimerRef.current);
      autoPushTimerRef.current = null;
    }
  }, []);

  /**
   * 기기 연결 (받는 쪽) — 연결 링크의 토큰·Gist ID로:
   *  1) 업로드·원격 확인 중이거나 충돌 모달이 열려 있으면 거절
   *  2) 저장 전에 주어진 자격증명으로 연결 테스트 — 실패하면 아무것도 저장하지 않는다
   *  3') 같은 Gist면 토큰만 저장하고 끝 — 미리보기·자동 동기화 변경 없이 정식 동기화 경로(충돌 확인)에 맡긴다
   *  3) 토큰(영속)·Gist ID 저장
   *  4) 즉시 불러오기 + normalizeImportedData 검증 — 실패하면 적용·자동 동기화 ON 모두 하지 않는다
   *     (빈 새 기기가 빈 데이터를 원격에 덮어쓰는 사고 방지)
   *  5) 적용(commit) — 동기화 상태를 정식 불러오기 경로와 동일하게 갱신한 뒤에만 자동 동기화 ON
   *  6) 로컬이 비어 있으면 미리보기 없이 적용, 데이터가 있으면 requestApply 미리보기(취소 시 자동 동기화 OFF)
   * ⚠ 토큰은 onLog·토스트에 절대 남기지 않는다 — 오류 메시지도 토큰을 가린 뒤 출력.
   */
  const connectDevice = useCallback(async (payload: ConnectPayload): Promise<ConnectDeviceResult> => {
    const syncBusy = () =>
      isPushingRef.current ||
      isRemoteCheckingRef.current ||
      isConnectingRef.current ||
      !!useUIStore.getState().gistConflict;
    if (syncBusy()) {
      toast.error("동기화 작업이 끝난 뒤 다시 시도하세요.");
      return "failed";
    }
    const previousGistId = getGistId();
    const { shortId } = describeConnectTarget(previousGistId, payload.gistId);
    const redact = (message: string) => (payload.token ? message.split(payload.token).join("***") : message);
    const errorMessage = (err: unknown) => redact(err instanceof Error ? err.message : String(err));

    isConnectingRef.current = true;
    try {
      // 2) 연결 테스트 — 아직 이 기기에 설정된 Gist가 아니므로 동기화 건강 상태(실패 카운트)에는 기록하지 않는다
      let versions: GistVersion[];
      try {
        versions = await getGistVersionsWithCredentials(payload.token, payload.gistId, 1);
      } catch (err) {
        const message = errorMessage(err);
        onLog?.(`기기 연결 테스트 실패 — Gist(…${shortId}): ${message}`, "error");
        toast.error(message);
        return "failed";
      }
      // 테스트 대기 중 부팅 불러오기가 충돌 모달을 열었을 수 있다 — 자격증명을 바꾸기 전에 다시 확인
      // (isConnectingRef 때문에 새 업로드·원격 확인은 시작되지 않는다)
      if (useUIStore.getState().gistConflict) {
        toast.error("동기화 작업이 끝난 뒤 다시 시도하세요.");
        return "failed";
      }

      // 3') 같은 Gist 재연결('연결 끊김' 복구) — 토큰만 저장하고 기준점·자동 동기화 상태는 그대로 둔다.
      //     원격으로 통째 바꾸는 미리보기는 끊긴 동안의 로컬 편집을 충돌 확인 없이 지우고, 취소·실패하면 자동 동기화가
      //     꺼진 채 남는다. 원격 반영은 정식 경로(업로드·복귀 확인·부팅 불러오기의 충돌 확인)에 맡긴다.
      if (previousGistId === payload.gistId) {
        setGistToken(payload.token, { persist: true });
        // 부팅 때 토큰이 없어 원격 시점을 못 봤고 pull 기록도 없으면 빈 known — 업로드가 시각 비교로 통과하지 않게
        if (!knownRemoteCommitRef.current) knownRemoteCommitRef.current = getGistLastPullAt() || NOTHING_ACCOUNTED_AT;
        onLog?.(`기기 연결: 같은 Gist(…${shortId}) — 토큰만 다시 저장`, "success");
        toast.success(autoSyncEnabled ? "이 기기를 다시 연결했어요" : "이 기기를 다시 연결했어요. 자동 동기화는 꺼져 있어요.");
        return "connected";
      }

      // 3) 자격증명 저장. 다른 Gist에 자동 동기화 중이던 기기면 여기서 끈다 — 적용이 확정될 때만 다시 켠다.
      if (autoSyncEnabled) setAutoSyncEnabled(false);
      connectGenRef.current += 1;
      setGistToken(payload.token, { persist: true });
      setGistId(payload.gistId);
      if (previousGistId !== payload.gistId) {
        // 다른 Gist로 바뀜 — 옛 Gist 기준점(known commit·마지막 push payload/해시·pull/push 시각)을 그대로 두면,
        // 적용하지 않고(취소·실패) 나중에 자동 동기화를 켰을 때 로컬이 새 Gist를 묻지 않고 덮거나(업로드)
        // 새 Gist가 로컬을 묻지 않고 덮는다(복귀 확인). 기준점을 비우고 '아직 맞춰 본 적 없음'으로 표시하고,
        // 마운트 플래그를 내려 다음 ON 때 부팅 불러오기(Effect 1 — 충돌 확인) 경로를 타게 한다.
        // 적용이 확정되면 commit()이 새 Gist 기준으로 전부 다시 채운다.
        knownRemoteCommitRef.current = "";
        lastPushedPayloadRef.current = "";
        restoredRef.current = false;
        setGistLastPullAt("");
        setLastPullAt(null);
        setGistLastPushAt("");
        setLastPushAt(null);
        setGistLastPushedHash(unsyncedMarkerFor(payload.gistId));
        hasMountedRef.current = false;
      }

      // 4) 즉시 불러오기 + 검증
      let dataJson: string;
      let updatedAt: string;
      try {
        ({ dataJson, updatedAt } = await loadRemoteGuarded(schemaBlockedRef));
      } catch (err) {
        const message = errorMessage(err);
        onLog?.(`기기 연결: Gist(…${shortId}) 불러오기 실패 — ${message}`, "error");
        toast.error(message);
        return "failed";
      }
      let after: AppData;
      try {
        after = normalizeImportedData(JSON.parse(dataJson) as unknown);
      } catch (err) {
        onLog?.(`기기 연결: Gist(…${shortId}) 데이터 검증 실패 — 적용하지 않음 (${errorMessage(err)})`, "error");
        toast.error("원격 데이터가 올바르지 않아 불러오지 않았어요.");
        return "failed";
      }

      // committed_at(getGistVersions와 동일 소스)을 known으로 — 다음 자동 업로드의 가짜 충돌 방지
      const remoteAt = versions[0]?.committedAt ?? updatedAt;
      const commit = () => {
        // 안전 스냅샷·실제 반영은 onApplyPulledData(App.handleGistPulledData) — 같은 검증을 위에서 통과했다
        onApplyPulledData(dataJson, remoteAt);
        setGistLastPullAt(remoteAt);
        setLastPullAt(remoteAt);
        knownRemoteCommitRef.current = remoteAt;
        lastPushedPayloadRef.current = dataJson;
        setGistLastPushedHash(hashGistPayload(dataJson));
        restoredRef.current = false;
        recordSyncOk();
        // 자동 동기화 ON 전환에 부팅용 불러오기(Effect 1)가 다시 반응하지 않도록 먼저 세운다 (이중 불러오기 방지)
        hasMountedRef.current = true;
        setAutoSyncEnabled(true);
        onLog?.(`기기 연결 완료 — Gist(…${shortId})에서 불러옴, 자동 동기화 켬`, "success");
        toast.success("이 기기를 연결했어요");
      };

      // 6) 빈 새 기기는 미리보기 없이 적용, 데이터가 있으면 manualPull과 같은 변경 미리보기
      if (isEmptyLocalData(dataRef.current)) {
        commit();
        return "connected";
      }
      return await new Promise<ConnectDeviceResult>((resolve, reject) => {
        requestApply({
          title: "연결한 Gist에서 불러오기",
          before: dataRef.current,
          after,
          onConfirm: () => {
            // 적용 중 예외는 모달 클릭 핸들러로 새지 않게 넘겨받아 실패로 끝낸다 (연결 모달이 "연결 중..."에 멈추지 않도록)
            try {
              commit();
              resolve("connected");
            } catch (err) {
              reject(err);
            }
          },
          onCancel: () => {
            onLog?.(`기기 연결: Gist(…${shortId}) 불러오기 취소 — 자동 동기화 꺼 둠`, "info");
            toast("불러오기를 취소했어요. 자동 동기화는 꺼져 있어요.");
            resolve("cancelled");
          },
        });
      });
    } catch (err) {
      // 예상 밖 예외(적용·미리보기 요약 실패 등) — commit은 반영(onApplyPulledData)이 먼저라 여기 오면 자동 동기화는 꺼진 채다
      const message = errorMessage(err);
      onLog?.(`기기 연결 실패 — Gist(…${shortId}): ${message}`, "error");
      toast.error(`기기 연결 실패: ${message}`);
      return "failed";
    } finally {
      isConnectingRef.current = false;
    }
  }, [autoSyncEnabled, setAutoSyncEnabled, onApplyPulledData, onLog, recordSyncOk]);

  const resolveGistConflict = useCallback(async (resolution: GistConflictResolution): Promise<void> => {
    const conflict = useUIStore.getState().gistConflict;
    if (!conflict) return;
    const setConflict = useUIStore.getState().setGistConflict;
    try {
      if (resolution === "apply-remote") {
        // 원격 데이터를 로컬에 반영. 로컬 변경은 폐기.
        // 모달이 열려있는 동안 원격이 또 갱신됐을 가능성을 보수적으로 처리:
        // 사용 직전에 commits API로 최신 commit 시각을 한 번 더 권위 확보.
        let authoritativeRemoteAt = conflict.remoteUpdatedAt;
        try {
          const versions = await getGistVersions(1);
          if (versions[0]?.committedAt) authoritativeRemoteAt = versions[0].committedAt;
        } catch { /* 무시 — 모달의 시각 유지 */ }

        // 자동 적립 시계열은 폐기하지 않고 원격 payload에 date-union(원격 우선) — applyRemoteWithSeriesUnion 참조
        const filled = applyRemoteWithSeriesUnion(conflict.remoteDataJson, authoritativeRemoteAt);
        onLog?.(
          filled > 0
            ? `Gist 충돌: 원격 데이터를 적용했습니다 (로컬 자동 적립 시계열 ${filled}건 보존)`
            : "Gist 충돌: 원격 데이터를 적용했습니다",
          "success"
        );
      } else if (resolution === "force-push-local") {
        // 로컬 데이터를 원격에 강제 push. 원격(다른 기기) 변경은 폐기 →
        // 폐기되는 원격 데이터를 안전 스냅샷으로 보관해 "다른 기기에서 한 작업"을 되찾을 수 있게 한다.
        try {
          const remoteData = JSON.parse(conflict.remoteDataJson) as AppData;
          await saveSafetySnapshot(remoteData, "Gist 강제 push 직전 폐기되는 원격 데이터 스냅샷");
        } catch {
          /* best-effort — 스냅샷 실패해도 사용자 선택(강제 push)은 진행 */
        }
        // push 직후 원격 commit 시각을 다시 조회해 knownRemoteCommitRef를 권위 있는 값으로 갱신.
        // (saveToGist의 updatedAt이 GitHub commits API와 다를 수 있는 엣지 보호)
        // 원격(다른 기기)이 쌓은 자동 적립 시계열은 폐기하지 않고 로컬 payload에 date-union으로 합쳐 push.
        // 로컬 스토어에도 같은 union을 반영해 다음 자동 push가 원격 시계열을 다시 지우지 않게 한다
        // (기록기와 동일한 setData 비-undo 경로 — id 키 컬렉션은 건드리지 않음).
        const mergedLocal = mergeGistPayloadTimeSeries(conflict.pendingLocalDataJson, conflict.remoteDataJson);
        if (mergedLocal.filledFromOther > 0 && mergedLocal.fields) {
          const union = mergedLocal.fields;
          useAppStore.getState().setData((prev) => ({
            ...prev,
            historicalDailyFx: mergeDailyFx(prev.historicalDailyFx, union.historicalDailyFx),
            benchmarkDailyCloses: mergeBenchmarkCloses(prev.benchmarkDailyCloses, union.benchmarkDailyCloses),
            marketEnvSnapshots: mergeMarketEnvSnapshots(prev.marketEnvSnapshots, union.marketEnvSnapshots),
          }));
        }
        const result = await saveToGist(mergedLocal.json);
        lastPushedPayloadRef.current = mergedLocal.json;
        setGistLastPushedHash(hashGistPayload(mergedLocal.json));
        setGistLastPushAt(result.updatedAt);
        setLastPushAt(result.updatedAt);
        recordSyncOk();
        try {
          const versions = await getGistVersions(1);
          const authoritative = versions[0]?.committedAt ?? result.updatedAt;
          knownRemoteCommitRef.current = authoritative;
          setGistLastPullAt(authoritative);
          setLastPullAt(authoritative);
        } catch {
          // 재조회 실패 시 result.updatedAt으로 fallback (다음 push 사이클에서 재시도)
          knownRemoteCommitRef.current = result.updatedAt;
        }
        restoredRef.current = false;
        onLog?.(
          mergedLocal.filledFromOther > 0
            ? `Gist 충돌: 로컬 데이터를 강제 push 했습니다 (원격 자동 적립 시계열 ${mergedLocal.filledFromOther}건 보존)`
            : "Gist 충돌: 로컬 데이터를 강제 push 했습니다",
          "success"
        );
      } else {
        // cancel: 모달 닫기만. 다음 변경 시 다시 충돌 가능.
        onLog?.("Gist 충돌 모달: 취소", "info");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncFail(message);
      onLog?.(`Gist 충돌 해결 실패: ${message}`, "error");
      // force-push 등 실패가 조용히 모달만 닫히면 사용자가 "해결됐다"고 오해 — 토스트로 가시화
      toast.error(`Gist 충돌 해결 실패: ${message}`);
    } finally {
      setConflict(null);
    }
  }, [applyRemoteWithSeriesUnion, onLog, recordSyncOk, recordSyncFail]);

  /**
   * Gist 과거 버전 복원(GistVersionModal) 직후 동기화 상태를 갱신한다.
   * 이걸 호출하지 않으면 복원된 (과거) 데이터를 runAutoPush가 '새 로컬 변경'으로 보고
   * 디바운스 후 조용히 push → 최신 원격이 과거로 롤백된다.
   * - lastPushedPayloadRef/hash = 복원 데이터: 즉시 자동 push 막음(데이터 동일 → no-op).
   * - knownRemoteCommitRef = 복원 버전의 commit 시각(과거): 이후 실제 변경 시 detectConflict가
   *   '원격이 더 최신'을 감지해 충돌 모달로 사용자에게 롤백 여부를 의식적으로 묻게 함.
   */
  const syncStateAfterRestore = useCallback((dataJson: string, committedAt: string) => {
    lastPushedPayloadRef.current = dataJson;
    setGistLastPushedHash(hashGistPayload(dataJson));
    knownRemoteCommitRef.current = committedAt;
    // 복귀 시 원격 확인이 과거 known을 근거로 최신 원격을 자동 pull해 복원을 되돌리지 않도록 — 다음 push/pull까지 보류
    restoredRef.current = true;
  }, []);

  // 경고는 매 렌더에 재계산 — 사용자가 앱을 보고 있으면 어차피 자주 리렌더됨 (탭 전환·데이터 변경 등).
  // 별도 setInterval로 강제 갱신은 안 함 (불필요 + fake-timer 테스트와 충돌).
  let gistStaleWarning: GistStaleWarning | null = null;
  if (autoSyncEnabled && lastPushAt) {
    const ms = Date.now() - new Date(lastPushAt).getTime();
    if (Number.isFinite(ms) && ms > 0) {
      const hoursSince = ms / 36e5;
      if (hoursSince >= GIST_STALE_WARNING_HOURS.CRITICAL) {
        gistStaleWarning = {
          type: "critical",
          message: `${Math.floor(hoursSince)}시간 동안 Gist에 푸시되지 않았습니다. 지금 푸시하세요.`,
          hoursSince,
        };
      } else if (hoursSince >= GIST_STALE_WARNING_HOURS.WARNING) {
        gistStaleWarning = {
          type: "warning",
          message: `${Math.floor(hoursSince)}시간 경과 — Gist 푸시 권장`,
          hoursSince,
        };
      }
    }
  }

  return {
    autoSyncEnabled,
    setAutoSyncEnabled,
    lastPushAt,
    lastPullAt,
    isSyncing,
    resolveGistConflict,
    gistStaleWarning,
    manualPush,
    manualPull,
    syncStateAfterRestore,
    syncHealth,
    connectDevice,
  };
}
