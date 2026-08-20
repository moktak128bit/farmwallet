import type { AppData } from "../types";
import { STORAGE_KEYS, BACKUP_CONFIG } from "../constants/config";
import { getKoreaTime } from "../utils/date";
import {
  getBackupStore,
  readPendingSafetySnapshot,
  writePendingSafetySnapshotSync,
  clearPendingSafetySnapshot,
  toBackupMeta,
  type BackupRecord,
  type BackupRecordMeta
} from "./backupStore";

interface BackupMeta {
  id: string;
  createdAt: string;
  hash?: string;
  /** 백업 생성 사유 라벨 (안전 스냅샷 등) */
  label?: string;
}

export type BackupSource = "browser" | "server";

export interface BackupEntry extends BackupMeta {
  source: BackupSource;
  fileName?: string;
}

/** 보존 정책·정렬이 필요로 하는 최소 필드 */
interface RetentionItem {
  id: string;
  createdAt: string;
  label?: string;
}

/** KST 기준, 백업이 있는 서로 다른 날짜 최대 개수(오늘 포함 4일치) */
const BACKUP_RETENTION_DAY_SLOTS = 4;
/**
 * 같은 KST 날짜 안에 보관할 최대 백업 수 (최신순).
 * 일별 1개만 남기면 "실수 후 자동백업"이 당일의 정상 백업을 대체해
 * 복구 지점이 사라지는 문제가 있어 복수 보관한다 (4일 × 5개 = 최대 20개).
 * 저장소가 IndexedDB라 20개(user-only ≈ 15MB)를 실제로 유지할 수 있다.
 */
const BACKUP_RETENTION_PER_DAY = 5;
/**
 * 라벨 스냅샷(위험 작업 직전 saveSafetySnapshot)을 perDay·day-slot 한도와 별개로 항상 보존할 최소 개수.
 * 같은 날 자동 백업이 perDay를 채우면 안전 스냅샷이 cap에 밀려 사라져 복구망이 무력화되던 문제(#10) 방지.
 */
const BACKUP_RETENTION_LABELED_KEEP = 3;

const seoulDayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseCreatedAtMs(createdAt: string): number | null {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : null;
}

function sortBackupsNewestFirst<T extends RetentionItem>(backups: T[]): T[] {
  return [...backups].sort((a, b) => {
    const aMs = parseCreatedAtMs(a.createdAt);
    const bMs = parseCreatedAtMs(b.createdAt);
    if (aMs == null && bMs == null) return b.createdAt.localeCompare(a.createdAt);
    if (aMs == null) return 1;
    if (bMs == null) return -1;
    if (aMs === bMs) return b.createdAt.localeCompare(a.createdAt);
    return bMs - aMs;
  });
}

function getSeoulDayKeyFromCreatedAt(createdAt: string): string {
  const ms = parseCreatedAtMs(createdAt);
  if (ms == null) return "unknown";
  const parts = seoulDayKeyFormatter.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return "unknown";
  return `${y}-${m}-${d}`;
}

/**
 * KST 날짜 기준 보존 정책: 백업이 실제로 있는 날만 세어 최근 BACKUP_RETENTION_DAY_SLOTS개
 * 날짜만 유지하고, 같은 KST 날 안에서는 createdAt이 최신인 항목을 perDay개까지 남긴다.
 * (이전 정책의 "일별 1개"는 같은 날 안전 백업을 파괴해 복구 지점을 없앴음.)
 */
function applyBackupRetentionPolicy<T extends RetentionItem>(
  backups: T[],
  perDay: number = BACKUP_RETENTION_PER_DAY,
  labeledKeep: number = BACKUP_RETENTION_LABELED_KEEP
): T[] {
  // 라벨 스냅샷(안전 스냅샷)은 perDay/day-slot 한도와 별개로 최근 K개를 항상 보존 (#10)
  const protectedLabeled = sortBackupsNewestFirst(backups.filter((b) => !!b.label)).slice(
    0,
    Math.max(0, labeledKeep)
  );
  const keptById = new Map<string, T>();
  for (const b of protectedLabeled) keptById.set(b.id, b);

  const byDay = new Map<string, T[]>();
  for (const backup of backups) {
    const dayKey = getSeoulDayKeyFromCreatedAt(backup.createdAt);
    if (dayKey === "unknown") continue;
    const list = byDay.get(dayKey);
    if (list) list.push(backup);
    else byDay.set(dayKey, [backup]);
  }

  const recentDayKeys = [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, BACKUP_RETENTION_DAY_SLOTS);

  for (const dayKey of recentDayKeys) {
    const sameDayNewestFirst = sortBackupsNewestFirst(byDay.get(dayKey) ?? []);
    for (const b of sameDayNewestFirst.slice(0, Math.max(1, perDay))) {
      if (!keptById.has(b.id)) keptById.set(b.id, b);
    }
  }

  if (keptById.size === 0 && backups.length > 0) {
    return sortBackupsNewestFirst(backups).slice(0, 1);
  }

  return sortBackupsNewestFirst([...keptById.values()]);
}

/** 저장 실패(quota 등) fallback — 일별 최신 1개 + 안전 스냅샷 1개만 남겨 용량을 최소화 (복구망 1개는 유지) */
function keepRecentBackups<T extends RetentionItem>(backups: T[]): T[] {
  return applyBackupRetentionPolicy(backups, 1, 1);
}

function capBackups<T>(backups: T[]): T[] {
  const maxCount = Math.max(1, BACKUP_CONFIG.MAX_LOCAL_BACKUPS);
  return backups.slice(0, maxCount);
}

/** 손상된 백업 원본 보존 슬롯(BACKUPS_CORRUPT) 정보 — 없으면 null */
export function getCorruptBackupsInfo(): { sizeBytes: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT);
    if (!raw) return null;
    return { sizeBytes: new TextEncoder().encode(raw).length };
  } catch {
    return null;
  }
}

/** 손상된 백업 원본 문자열(JSON 파싱 불가) — 다운로드용. 없으면 null */
export function getCorruptBackupsRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT);
  } catch {
    return null;
  }
}

/** 손상된 백업 원본 보존 슬롯 삭제 — 삭제했으면 true */
export function clearCorruptBackups(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT) == null) return false;
    window.localStorage.removeItem(STORAGE_KEYS.BACKUPS_CORRUPT);
    return true;
  } catch {
    return false;
  }
}

async function computeBackupHashFromText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 백업 본문 직렬화 — dataService.toUserDataJson과 동일 규칙(캐시 3종 prices/tickerDatabase/
 * historicalDailyCloses 제외, 키 순서 보존). 백업 해시도 이 문자열로 계산한다.
 * (dataService ↔ backupService 순환 import를 피하려고 여기서 같은 규칙을 적용한다 —
 *  backupService.test가 toUserDataJson과의 동일성을 고정한다.)
 */
function toBackupDataJson(data: AppData): string {
  const { prices: _p, tickerDatabase: _t, historicalDailyCloses: _h, ...userData } = data;
  return JSON.stringify(userData);
}

/**
 * 복원 데이터(user-only 백업이라 캐시가 비어 있을 수 있음)에 현재 메모리의 API 캐시를 병합.
 * 백업/Gist 본문에 캐시가 들어 있으면(구 백업) 그것을 쓰고, 비어 있으면 현재 캐시를 유지해
 * 빈 배열이 localStorage CACHE(saveDataSerialized는 무조건 덮어씀)를 지우지 않게 한다.
 */
export function mergeCurrentCaches(normalized: AppData, current: AppData | null | undefined): AppData {
  if (!current) return normalized;
  return {
    ...normalized,
    prices: (normalized.prices?.length ?? 0) > 0 ? normalized.prices : current.prices,
    tickerDatabase:
      (normalized.tickerDatabase?.length ?? 0) > 0 ? normalized.tickerDatabase : current.tickerDatabase,
    historicalDailyCloses:
      (normalized.historicalDailyCloses?.length ?? 0) > 0
        ? normalized.historicalDailyCloses
        : current.historicalDailyCloses
  };
}

/** 저장 시 스냅샷(BACKUP_ON_SAVE) 설정 — 저장된 값이 없으면 기본 on */
export function isBackupOnSaveEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

function newBackupId(): string {
  return `B${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function buildRecord(dataJson: string, options?: { hash?: string; label?: string }): BackupRecord {
  const record: BackupRecord = {
    id: newBackupId(),
    createdAt: getKoreaTime().toISOString(),
    dataJson
  };
  if (options?.hash !== undefined) record.hash = options.hash;
  if (options?.label !== undefined) record.label = options.label;
  return record;
}

interface SaveBackupOptions {
  skipHash?: boolean;
  timeoutMs?: number;
  /** 파일(dev 서버 /api/backup) 백업용 전체 payload — 없으면 JSON.stringify(data) */
  dataJson?: string;
  /** 로컬 백업 본문(user-only, toUserDataJson과 동일 규칙) — 호출부가 이미 만들어 둔 경우 재직렬화 생략 */
  userDataJson?: string;
}

interface SaveBackupResult {
  fileSaved: boolean;
  localSaved: boolean;
  /** 프로덕션 등 백업 API가 없는 환경에서 파일 저장 단계를 의도적으로 생략한 경우 true */
  fileSkipped?: boolean;
  fileError?: string;
  localError?: string;
}

async function saveFileBackup(payload: string, timeoutMs: number): Promise<{ saved: boolean; error?: string }> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetch(BACKUP_CONFIG.API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: controller?.signal
    });
    if (res.ok) {
      return { saved: true };
    }

    const errBody = await res.text();
    const error = `HTTP ${res.status}${errBody ? `: ${errBody}` : ""}`;
    console.warn("[backupService] file backup failed", error);
    return { saved: false, error };
  } catch (error) {
    const isAbortError = error instanceof DOMException && error.name === "AbortError";
    const message = isAbortError
      ? `요청 시간 초과 (${timeoutMs}ms)`
      : toErrorMessage(error);
    console.warn("[backupService] file backup request failed", error);
    return { saved: false, error: message };
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * 레코드를 저장소(IDB 또는 localStorage 폴백)에 기록하고 보존 정책으로 정리.
 * 쓰기 실패(quota 등) 시 더 공격적으로 정리해 재시도 → 최후엔 새 백업 1개만 남긴다.
 */
async function saveLocalBackupRecord(record: BackupRecord): Promise<{ saved: boolean; error?: string }> {
  try {
    const store = await getBackupStore();
    const existing = (await store.listMeta()).filter((m) => m.id !== record.id);
    const merged: BackupRecordMeta[] = [toBackupMeta(record), ...existing];
    const retained = capBackups(applyBackupRetentionPolicy(merged));
    const keepIds = new Set(retained.map((m) => m.id));
    keepIds.add(record.id);
    const deleteIds = existing.filter((m) => !keepIds.has(m.id)).map((m) => m.id);

    try {
      await store.write([record], deleteIds);
      return { saved: true };
    } catch (firstError) {
      const recentIds = new Set(capBackups(keepRecentBackups(merged)).map((m) => m.id));
      recentIds.add(record.id);
      try {
        await store.write([record], existing.filter((m) => !recentIds.has(m.id)).map((m) => m.id));
        return { saved: true, error: "저장 공간 부족 — 오래된 백업을 정리하고 저장했습니다" };
      } catch (retryError) {
        try {
          await store.write([record], existing.map((m) => m.id));
          return { saved: true, error: "저장 공간 부족 — 최신 백업 1개만 보관했습니다" };
        } catch (finalError) {
          console.warn("[backupService] local backup write failed", firstError, retryError, finalError);
          return { saved: false, error: toErrorMessage(finalError) };
        }
      }
    }
  } catch (error) {
    console.warn("[backupService] local backup failed", error);
    return { saved: false, error: toErrorMessage(error) };
  }
}

/**
 * 위험 작업(백업 복원·파일 복원·JSON 가져오기·초기화·Gist 불러오기) 직전에
 * 현재 데이터를 로컬 백업으로 보존하는 안전 스냅샷.
 * - 파일 API 호출 없음 (프로덕션에서도 동작)
 * - 해시 생략으로 빠르게 완료
 * - **첫 await 전에** 본문을 직렬화하고 localStorage 동기 1슬롯(BACKUP_SAFETY_PENDING)에 기록한다 —
 *   호출 직후 리로드/크래시가 나도 원본이 남는다(dataService 0-9·1-3 계약). IDB 복제가 끝나면 슬롯을 비운다.
 * - 실패해도 throw하지 않고 false 반환 — 호출부가 진행 여부를 결정
 */
export async function saveSafetySnapshot(data: AppData, reason: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let record: BackupRecord;
  try {
    record = buildRecord(toBackupDataJson(data), { label: reason });
  } catch (error) {
    console.warn("[backupService] safety snapshot serialize failed", error);
    return false;
  }
  // 1) 동기 슬롯 — 이 줄까지는 await 없음
  const slotWritten = writePendingSafetySnapshotSync(record);
  // 2) 본 저장소(IDB/폴백)에 비동기 복제
  try {
    const result = await saveLocalBackupRecord(record);
    if (result.saved) {
      clearPendingSafetySnapshot(record.id);
      return true;
    }
    console.warn("[backupService] safety snapshot not saved to store:", result.error);
    return slotWritten;
  } catch (error) {
    console.warn("[backupService] safety snapshot failed", error);
    return slotWritten;
  }
}

export async function saveBackupSnapshot(
  data: AppData,
  options?: SaveBackupOptions
): Promise<SaveBackupResult> {
  if (typeof window === "undefined") {
    return {
      fileSaved: false,
      localSaved: false,
      fileError: "브라우저 환경이 아닙니다."
    };
  }

  // 로컬 백업 본문은 user-only(캐시 제외) — 해시도 같은 문자열로
  const userJson = options?.userDataJson ?? toBackupDataJson(data);
  const payloadBytes = new TextEncoder().encode(userJson).length;
  if (payloadBytes > BACKUP_CONFIG.MAX_BACKUP_PAYLOAD_BYTES) {
    const reason = `백업 용량 초과 (${payloadBytes.toLocaleString()} bytes / 최대 ${BACKUP_CONFIG.MAX_BACKUP_PAYLOAD_BYTES.toLocaleString()} bytes)`;
    return {
      fileSaved: false,
      localSaved: false,
      fileError: reason,
      localError: reason
    };
  }

  const timeoutMs = options?.timeoutMs ?? BACKUP_CONFIG.API_TIMEOUT_MS;
  // 백업 파일 API(/api/backup)는 dev 서버 전용 — 프로덕션에서는 호출 자체를 생략해
  // 매 백업마다 "파일 저장 실패" 노이즈가 나는 것을 방지한다. (파일에는 기존대로 전체 payload)
  const filePromise: Promise<{ saved: boolean; error?: string; skipped?: boolean }> = import.meta.env.DEV
    ? saveFileBackup(options?.dataJson ?? JSON.stringify(data), timeoutMs)
    : Promise.resolve({ saved: false, skipped: true });

  const localPromise = (async () => {
    try {
      const hash = options?.skipHash ? undefined : await computeBackupHashFromText(userJson);
      return await saveLocalBackupRecord(buildRecord(userJson, { hash }));
    } catch (error) {
      console.warn("[backupService] local backup failed", error);
      return { saved: false, error: toErrorMessage(error) };
    }
  })();

  const [fileResult, localResult] = await Promise.all([filePromise, localPromise]);

  return {
    fileSaved: fileResult.saved,
    fileSkipped: fileResult.skipped === true,
    localSaved: localResult.saved,
    fileError: fileResult.error,
    localError: localResult.error
  };
}

/** 저장소 목록 + (아직 복제되지 않은) 동기 슬롯 안전 스냅샷을 병합해 최신순으로 */
async function listAllMeta(): Promise<BackupRecordMeta[]> {
  const store = await getBackupStore();
  const metas = await store.listMeta();
  const pending = readPendingSafetySnapshot();
  if (pending && !metas.some((m) => m.id === pending.id)) {
    metas.push(toBackupMeta(pending));
  }
  return sortBackupsNewestFirst(metas);
}

async function findRecord(id: string): Promise<BackupRecord | null> {
  const store = await getBackupStore();
  const found = await store.get(id);
  if (found) return found;
  const pending = readPendingSafetySnapshot();
  return pending && pending.id === id ? pending : null;
}

function parseRecordData(record: BackupRecord): AppData | null {
  try {
    const parsed = JSON.parse(record.dataJson) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AppData;
  } catch (error) {
    console.warn("[backupService] backup payload parse failed", { id: record.id }, error);
    return null;
  }
}

export async function getBackupList(): Promise<BackupMeta[]> {
  if (typeof window === "undefined") return [];
  try {
    const metas = await listAllMeta();
    return metas.map((b) => ({ id: b.id, createdAt: b.createdAt, hash: b.hash, label: b.label }));
  } catch (error) {
    console.warn("[backupService] failed to load backup list", error);
    return [];
  }
}

/**
 * 읽기 시점에 SHA-256 해시를 재계산해 저장 시 해시와 비교한다.
 * 손상되었으면 onCorrupt 콜백 호출 후 데이터를 그대로 반환 (사용자가 결정).
 * 해시가 없으면 검증 생략 (skipHash로 저장된 구버전 호환).
 */
export async function loadBackupDataVerified(
  id: string,
  onCorrupt?: (info: { id: string; createdAt: string }) => void
): Promise<{ data: AppData | null; status: "valid" | "missing-hash" | "mismatch" | "not-found" }> {
  if (typeof window === "undefined") return { data: null, status: "not-found" };
  try {
    const found = await findRecord(id);
    if (!found) return { data: null, status: "not-found" };
    const data = parseRecordData(found);
    if (!data) return { data: null, status: "not-found" };
    if (!found.hash) return { data, status: "missing-hash" };

    const hash = await computeBackupHashFromText(found.dataJson);
    if (hash !== found.hash) {
      console.warn("[backupService] backup hash mismatch", { id, expected: found.hash, actual: hash });
      onCorrupt?.({ id: found.id, createdAt: found.createdAt });
      return { data, status: "mismatch" };
    }
    return { data, status: "valid" };
  } catch (error) {
    console.warn("[backupService] failed to verify backup", error);
    return { data: null, status: "not-found" };
  }
}

export async function getLatestLocalBackupIntegrity(): Promise<{
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}> {
  if (typeof window === "undefined") return { createdAt: null, status: "none" };

  try {
    const latest = (await listAllMeta())[0];
    if (!latest) return { createdAt: null, status: "none" };
    if (!latest.hash) return { createdAt: latest.createdAt, status: "missing-hash" };

    const record = await findRecord(latest.id);
    if (!record) return { createdAt: latest.createdAt, status: "mismatch" };
    const hash = await computeBackupHashFromText(record.dataJson);
    const status = hash === latest.hash ? "valid" : "mismatch";
    return { createdAt: latest.createdAt, status };
  } catch (error) {
    console.warn("[backupService] failed to check backup integrity", error);
    return { createdAt: null, status: "none" };
  }
}

export async function getAllBackupList(): Promise<BackupEntry[]> {
  const browserBackups: BackupEntry[] = (await getBackupList()).map((b) => ({
    ...b,
    source: "browser" as const
  }));
  return browserBackups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 최신 keepCount개만 남기고 삭제. 삭제한 개수 반환. */
export async function clearOldBackups(keepCount: number = 1): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const store = await getBackupStore();
    const current = sortBackupsNewestFirst(await store.listMeta());
    if (current.length <= keepCount) return 0;
    const deleteIds = current.slice(keepCount).map((m) => m.id);
    await store.write([], deleteIds);
    return deleteIds.length;
  } catch (error) {
    console.warn("[backupService] failed to clear old backups", error);
    return 0;
  }
}

export async function loadServerBackupData(fileName: string): Promise<AppData | null> {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams({ fileName });
    const url = `${BACKUP_CONFIG.API_PATH}?${params.toString()}`;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeoutId =
      controller && BACKUP_CONFIG.API_TIMEOUT_MS > 0
        ? window.setTimeout(() => controller.abort(), BACKUP_CONFIG.API_TIMEOUT_MS)
        : null;

    try {
      const res = await fetch(url, { signal: controller?.signal });
      if (!res.ok) return null;
      return (await res.json()) as AppData;
    } finally {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    console.warn("[backupService] failed to load server backup", error);
    return null;
  }
}
