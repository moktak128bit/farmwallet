import { create } from "zustand";
import type { TabId } from "../components/ui/Tabs";
import type { LedgerEntry } from "../types";
import { isGistConfigured } from "../services/gistSync";
import { STORAGE_KEYS } from "../constants/config";
import { TAB_ORDER } from "../constants/tabs";
import type { ApplySummary } from "../utils/applySummary";
import { setAmountMask } from "../utils/formatter";

interface AppLogEntry {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  time: string;
}

export interface PendingAction {
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: "primary" | "danger";
  onConfirm: () => void;
}

interface IntegritySummary {
  error: number;
  warning: number;
}

/**
 * Gist 자동 push 중 원격 변경이 감지된 경우의 충돌 정보.
 * 모달이 표시되며 사용자가 원격 적용/로컬 강제 푸시/취소를 선택.
 */
export interface GistConflict {
  /** 원격에서 새로 fetch한 Gist 데이터 JSON 문자열 */
  remoteDataJson: string;
  /** 원격 커밋 시각 (ISO) */
  remoteUpdatedAt: string;
  /** push하려고 시도했던 로컬 데이터 JSON */
  pendingLocalDataJson: string;
}

/** 자동저장 상태 머신. saving/saved는 디바운스 콜백 진입·완료에 매핑. error는 다음 시도까지 sticky. */
type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * 다른 탭에서 저장된 변경이 도착했을 때, 현재 탭에 미저장 dirty 변경이 있어
 * 단순 덮어쓰기로는 데이터 유실이 발생할 수 있는 충돌 상황.
 */
export interface TabConflict {
  /** 다른 탭이 저장한 데이터 (localStorage에서 읽은 직렬화 payload) */
  remoteDataJson: string;
  /** 우리 탭의 현재 store 데이터 직렬화 (충돌 해결 후 그대로 push할 수 있도록) */
  localDataJson: string;
  /** 충돌 감지 시각 (ms epoch) */
  detectedAt: number;
}

/**
 * 디바운스 대기 중 크래시로 유실될 뻔한 미저장 변경이 boot 시점에 발견된 경우.
 * 사용자가 [복구]/[폐기]를 선택할 때까지 banner로 노출.
 */
interface DraftRecovery {
  /** 드래프트 슬롯에 보관됐던 직렬화 데이터 */
  draftJson: string;
  /** 드래프트 작성 시각 (ms epoch) */
  draftAt: number;
}

/**
 * '덮어쓰기 적용' 게이트(ApplyConfirmModal)가 열려 있을 때의 대기 요청 (1-6).
 * 백업 복원·JSON/파일 가져오기·드래프트 복구·Gist 수동 pull이 utils/applySummary의
 * requestApply를 통해 여기 세팅한다 — 차이가 없으면 이 상태를 거치지 않고 즉시 onConfirm이 실행된다.
 */
interface PendingApply {
  /** 모달 제목 — 게이트별 문구 ("백업 파일에서 복원" 등) */
  title: string;
  summary: ApplySummary;
  /** [적용] 클릭 시 실행 — 각 게이트가 소유한 스냅샷·정규화된 데이터 반영 로직 */
  onConfirm: () => void;
  /** [취소]/ESC 시 실행 (선택) */
  onCancel?: () => void;
  /** true면 드래프트 복구처럼 "복구" 성격 — [적용] 버튼에 기본 포커스 */
  defaultFocusConfirm?: boolean;
}

/** 부팅 시 마지막 탭 복원 — TAB_ORDER 화이트리스트 외 값(구버전·오염)은 무시하고 dashboard */
function loadLastTab(): TabId {
  if (typeof window === "undefined") return "dashboard";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.LAST_TAB);
    if (raw && (TAB_ORDER as string[]).includes(raw)) return raw as TabId;
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 기본 탭
  }
  return "dashboard";
}

/** 부팅 시 프라이버시 모드 복원 — 저장값 없으면 기본 off. formatter의 마스킹 플래그를 즉시 동기화. */
function loadPrivacyMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.PRIVACY_MODE);
    const on = raw === "true";
    setAmountMask(on);
    return on;
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 기본 off
    return false;
  }
}

function persistPrivacyMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.PRIVACY_MODE, on ? "true" : "false");
  } catch {
    // quota/접근 불가 — 이번 세션 동안만 유지
  }
}

function persistLastTab(tab: TabId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.LAST_TAB, tab);
  } catch {
    // quota/접근 불가 — 복원 기능만 비활성, 동작엔 영향 없음
  }
}

const APP_LOG_MAX = 200;
/** localStorage에 보관할 최근 로그 (세션 복원용 + 사용자 내보내기) */
const APP_LOG_PERSIST_MAX = 500;
const APP_LOG_STORAGE_KEY = STORAGE_KEYS.APP_LOG;

function loadPersistedLog(): AppLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APP_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 최근 APP_LOG_MAX만 UI로 올림
    return parsed
      .filter((e): e is AppLogEntry =>
        !!e && typeof e === "object" &&
        typeof (e as AppLogEntry).id === "number" &&
        typeof (e as AppLogEntry).message === "string" &&
        typeof (e as AppLogEntry).time === "string")
      .slice(-APP_LOG_MAX);
  } catch { return []; }
}

/** 부팅 시 복원된 영속 로그 — id 카운터를 최대 id 다음부터 시작해 React key 중복 방지 */
const initialAppLog = loadPersistedLog();
let appLogIdCounter = initialAppLog.reduce(
  (max, e) => (Number.isFinite(e.id) && e.id > max ? e.id : max),
  0
);

let persistScheduled = false;
function schedulePersist(getEntries: () => AppLogEntry[]) {
  if (persistScheduled || typeof window === "undefined") return;
  persistScheduled = true;
  // 연속된 log 추가를 한 번에 묶어 쓰도록 idle/next-tick에 지연
  setTimeout(() => {
    persistScheduled = false;
    try {
      const trimmed = getEntries().slice(-APP_LOG_PERSIST_MAX);
      window.localStorage.setItem(APP_LOG_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // quota 초과 등 — 조용히 실패, 다음 호출에서 재시도
    }
  }, 500);
}

interface UIStore {
  // Navigation
  tab: TabId;
  setTab: (tab: TabId) => void;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;

  // Modals
  pendingAction: PendingAction | null;
  setPendingAction: (action: PendingAction | null) => void;
  showShortcutsHelp: boolean;
  setShowShortcutsHelp: (show: boolean | ((prev: boolean) => boolean)) => void;
  showQuickEntry: boolean;
  setShowQuickEntry: (show: boolean) => void;
  /** 딥링크(share_target)로 전달된 텍스트 — 빠른 입력 열릴 때 1회 프리필 후 소비. 자동 저장은 하지 않는다. */
  quickEntryPrefill: string | null;
  setQuickEntryPrefill: (text: string | null) => void;
  showGistVersionModal: boolean;
  setShowGistVersionModal: (show: boolean) => void;

  // Gist 충돌
  gistConflict: GistConflict | null;
  setGistConflict: (conflict: GistConflict | null) => void;

  // 자동저장 상태 표시기
  saveStatus: SaveStatus;
  saveStatusError: string | null;
  /** saved/error 진입 시각 — pill의 "N초 전" 표시·자동 idle 복귀 타이머용 */
  saveStatusAt: number;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;

  /** 사용자 편집이 디바운스 큐에 있고 아직 디스크에 안 들어간 dirty 윈도우 신호 */
  hasDirtyChanges: boolean;
  setHasDirtyChanges: (v: boolean) => void;

  // 탭 간 충돌 / 드래프트 복구
  tabConflict: TabConflict | null;
  setTabConflict: (conflict: TabConflict | null) => void;
  draftRecovery: DraftRecovery | null;
  setDraftRecovery: (recovery: DraftRecovery | null) => void;

  // 적용 게이트 diff 확인 모달 (1-6)
  pendingApply: PendingApply | null;
  setPendingApply: (pending: PendingApply | null) => void;

  // Cross-page navigation
  copyRequest: LedgerEntry | null;
  setCopyRequest: (entry: LedgerEntry | null) => void;
  highlightLedgerId: string | null;
  setHighlightLedgerId: (id: string | null) => void;
  highlightTradeId: string | null;
  setHighlightTradeId: (id: string | null) => void;

  // Sync UI flags
  isPushingToGit: boolean;
  setIsPushingToGit: (val: boolean) => void;
  isPullingFromGit: boolean;
  setIsPullingFromGit: (val: boolean) => void;
  isGistSaving: boolean;
  setIsGistSaving: (val: boolean) => void;
  isGistLoading: boolean;
  setIsGistLoading: (val: boolean) => void;

  // Misc UI
  newVersionAvailable: boolean;
  setNewVersionAvailable: (val: boolean) => void;
  /** PWA 새 버전 적용 함수(vite-plugin-pwa updateServiceWorker). prompt 모드에서 waiting SW에 SKIP_WAITING을 보내
   *  controlling 이벤트 → 리로드로 이어진다. 단순 location.reload()는 waiting SW를 활성화하지 못한다. */
  applyPwaUpdate: (() => Promise<void>) | null;
  setApplyPwaUpdate: (fn: (() => Promise<void>) | null) => void;
  gistConfigured: boolean;
  setGistConfigured: (val: boolean) => void;
  integritySummary: IntegritySummary | null;
  setIntegritySummary: (summary: IntegritySummary | null) => void;

  // App log
  appLog: AppLogEntry[];
  addAppLog: (message: string, type?: AppLogEntry["type"]) => void;

  /** 프라이버시 블러(5-1) — 켜지면 화면 금액을 마스킹. formatter.setAmountMask와 동기화되어 있다. */
  privacyMode: boolean;
  setPrivacyMode: (on: boolean | ((prev: boolean) => boolean)) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  tab: loadLastTab(),
  setTab: (tab) => {
    persistLastTab(tab);
    set({ tab });
  },
  mobileDrawerOpen: false,
  setMobileDrawerOpen: (mobileDrawerOpen) => set({ mobileDrawerOpen }),

  pendingAction: null,
  setPendingAction: (pendingAction) => set({ pendingAction }),
  showShortcutsHelp: false,
  setShowShortcutsHelp: (show) =>
    set((state) => ({
      showShortcutsHelp: typeof show === "function" ? show(state.showShortcutsHelp) : show,
    })),
  showQuickEntry: false,
  setShowQuickEntry: (showQuickEntry) => set({ showQuickEntry }),
  quickEntryPrefill: null,
  setQuickEntryPrefill: (quickEntryPrefill) => set({ quickEntryPrefill }),
  showGistVersionModal: false,
  setShowGistVersionModal: (showGistVersionModal) => set({ showGistVersionModal }),

  gistConflict: null,
  setGistConflict: (gistConflict) => set({ gistConflict }),

  saveStatus: "idle",
  saveStatusError: null,
  saveStatusAt: 0,
  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveStatusError: error, saveStatusAt: Date.now() }),

  hasDirtyChanges: false,
  setHasDirtyChanges: (hasDirtyChanges) => set({ hasDirtyChanges }),

  tabConflict: null,
  setTabConflict: (tabConflict) => set({ tabConflict }),
  draftRecovery: null,
  setDraftRecovery: (draftRecovery) => set({ draftRecovery }),

  pendingApply: null,
  setPendingApply: (pendingApply) => set({ pendingApply }),

  copyRequest: null,
  setCopyRequest: (copyRequest) => set({ copyRequest }),
  highlightLedgerId: null,
  setHighlightLedgerId: (highlightLedgerId) => set({ highlightLedgerId }),
  highlightTradeId: null,
  setHighlightTradeId: (highlightTradeId) => set({ highlightTradeId }),

  isPushingToGit: false,
  setIsPushingToGit: (isPushingToGit) => set({ isPushingToGit }),
  isPullingFromGit: false,
  setIsPullingFromGit: (isPullingFromGit) => set({ isPullingFromGit }),
  isGistSaving: false,
  setIsGistSaving: (isGistSaving) => set({ isGistSaving }),
  isGistLoading: false,
  setIsGistLoading: (isGistLoading) => set({ isGistLoading }),

  newVersionAvailable: false,
  setNewVersionAvailable: (newVersionAvailable) => set({ newVersionAvailable }),
  applyPwaUpdate: null,
  setApplyPwaUpdate: (applyPwaUpdate) => set({ applyPwaUpdate }),
  gistConfigured: typeof window !== "undefined" ? isGistConfigured() : false,
  setGistConfigured: (gistConfigured) => set({ gistConfigured }),
  integritySummary: null,
  setIntegritySummary: (integritySummary) => set({ integritySummary }),

  appLog: initialAppLog,
  addAppLog: (message, type = "success") =>
    set((state) => {
      const id = ++appLogIdCounter;
      const time = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const next = [...state.appLog.slice(-(APP_LOG_MAX - 1)), { id, message, type, time }];
      // 백그라운드 영속화 — quota 초과 시 조용히 실패
      schedulePersist(() => useUIStore.getState().appLog);
      return { appLog: next };
    }),

  privacyMode: loadPrivacyMode(),
  setPrivacyMode: (on) =>
    set((state) => {
      const next = typeof on === "function" ? on(state.privacyMode) : on;
      setAmountMask(next);
      persistPrivacyMode(next);
      return { privacyMode: next };
    }),
}));
