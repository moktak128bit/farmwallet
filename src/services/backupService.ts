import type { AppData } from "../types";
import { STORAGE_KEYS, BACKUP_CONFIG } from "../constants/config";
import { getKoreaTime } from "../utils/date";

interface StoredBackup {
  id: string;
  createdAt: string;
  data: AppData;
  hash?: string;
}

export interface BackupMeta {
  id: string;
  createdAt: string;
  hash?: string;
}

export type BackupSource = "browser" | "server";

export interface BackupEntry extends BackupMeta {
  source: BackupSource;
  fileName?: string;
}

/** KST 기준, 백업이 있는 서로 다른 날짜 최대 개수(오늘 포함 4일치) */
const BACKUP_RETENTION_DAY_SLOTS = 4;

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

function sortBackupsNewestFirst(backups: StoredBackup[]): StoredBackup[] {
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
 * KST 날짜 기준: 백업이 실제로 있는 날만 세어 최근 BACKUP_RETENTION_DAY_SLOTS개 날짜만 유지.
 * 같은 KST 날에는 createdAt이 가장 최신인 항목 1개만 남김.
 */
function applyBackupRetentionPolicy(backups: StoredBackup[]): StoredBackup[] {
  const bestByDay = new Map<string, StoredBackup>();

  for (const backup of backups) {
    const dayKey = getSeoulDayKeyFromCreatedAt(backup.createdAt);
    if (dayKey === "unknown") continue;
    const prev = bestByDay.get(dayKey);
    const bMs = parseCreatedAtMs(backup.createdAt) ?? 0;
    const pMs = prev ? (parseCreatedAtMs(prev.createdAt) ?? 0) : -Infinity;
    if (!prev || bMs > pMs) {
      bestByDay.set(dayKey, backup);
    }
  }

  const representatives = [...bestByDay.values()].sort((a, b) => {
    const am = parseCreatedAtMs(a.createdAt) ?? 0;
    const bm = parseCreatedAtMs(b.createdAt) ?? 0;
    if (bm !== am) return bm - am;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const kept = representatives.slice(0, BACKUP_RETENTION_DAY_SLOTS);

  if (kept.length === 0 && backups.length > 0) {
    return sortBackupsNewestFirst(backups).slice(0, 1);
  }

  return kept;
}

function keepRecentBackups(backups: StoredBackup[]): StoredBackup[] {
  return applyBackupRetentionPolicy(backups);
}

function capBackups(backups: StoredBackup[]): StoredBackup[] {
  const maxCount = Math.max(1, BACKUP_CONFIG.MAX_LOCAL_BACKUPS);
  return backups.slice(0, maxCount);
}

function readStoredBackups(): StoredBackup[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as StoredBackup[];
}

function writeStoredBackups(backups: StoredBackup[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backups));
}

async function computeBackupHashFromText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SaveBackupOptions {
  skipHash?: boolean;
  folder?: string;
  timeoutMs?: number;
  dataJson?: string;
}

export interface SaveBackupResult {
  fileSaved: boolean;
  localSaved: boolean;
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
      ? `request timeout (${timeoutMs}ms)`
      : toErrorMessage(error);
    console.warn("[backupService] file backup request failed", error);
    return { saved: false, error: message };
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function saveLocalBackup(
  data: AppData,
  payload: string,
  skipHash?: boolean
): Promise<{ saved: boolean; error?: string }> {
  try {
    const current = readStoredBackups();
    const koreaTime = getKoreaTime();
    const nowISO = koreaTime.toISOString();
    const hash = skipHash ? undefined : await computeBackupHashFromText(payload);
    const backup: StoredBackup = {
      id: `B${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: nowISO,
      data,
      hash
    };

    const merged = [backup, ...current];
    const retained = capBackups(applyBackupRetentionPolicy(merged));

    try {
      writeStoredBackups(retained);
      return { saved: true };
    } catch (quotaError) {
      const recentOnly = capBackups(keepRecentBackups(merged));
      try {
        writeStoredBackups(recentOnly);
        return { saved: true, error: "storage quota reached, old backups were pruned" };
      } catch (retryError) {
        try {
          writeStoredBackups([backup]);
          return { saved: true, error: "storage quota reached, only latest backup was retained" };
        } catch (finalError) {
          console.warn("[backupService] local backup write failed", quotaError, retryError, finalError);
          return { saved: false, error: toErrorMessage(finalError) };
        }
      }
    }
  } catch (error) {
    console.warn("[backupService] local backup failed", error);
    return { saved: false, error: toErrorMessage(error) };
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
      fileError: "window is not available"
    };
  }

  const payload = options?.dataJson ?? JSON.stringify(data);
  const payloadBytes = new TextEncoder().encode(payload).length;
  if (payloadBytes > BACKUP_CONFIG.MAX_BACKUP_PAYLOAD_BYTES) {
    const reason = `payload too large (${payloadBytes} bytes)`;
    return {
      fileSaved: false,
      localSaved: false,
      fileError: reason,
      localError: reason
    };
  }

  const timeoutMs = options?.timeoutMs ?? BACKUP_CONFIG.API_TIMEOUT_MS;
  const [fileResult, localResult] = await Promise.all([
    saveFileBackup(payload, timeoutMs),
    saveLocalBackup(data, payload, options?.skipHash)
  ]);

  return {
    fileSaved: fileResult.saved,
    localSaved: localResult.saved,
    fileError: fileResult.error,
    localError: localResult.error
  };
}

export function getBackupList(): BackupMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const current = sortBackupsNewestFirst(readStoredBackups());
    return current.map((b) => ({ id: b.id, createdAt: b.createdAt, hash: b.hash }));
  } catch (error) {
    console.warn("[backupService] failed to load backup list", error);
    return [];
  }
}

export function loadBackupData(id: string): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const current = readStoredBackups();
    const found = current.find((b) => b.id === id);
    return found ? found.data : null;
  } catch (error) {
    console.warn("[backupService] failed to load backup data", error);
    return null;
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
    const current = readStoredBackups();
    const found = current.find((b) => b.id === id);
    if (!found) return { data: null, status: "not-found" };
    if (!found.hash) return { data: found.data, status: "missing-hash" };

    const text = JSON.stringify(found.data);
    const hash = await computeBackupHashFromText(text);
    if (hash !== found.hash) {
      console.warn("[backupService] backup hash mismatch", { id, expected: found.hash, actual: hash });
      onCorrupt?.({ id: found.id, createdAt: found.createdAt });
      return { data: found.data, status: "mismatch" };
    }
    return { data: found.data, status: "valid" };
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
    const current = sortBackupsNewestFirst(readStoredBackups());
    const latest = current[0];
    if (!latest) return { createdAt: null, status: "none" };
    if (!latest.hash) return { createdAt: latest.createdAt, status: "missing-hash" };

    const text = JSON.stringify(latest.data);
    const hash = await computeBackupHashFromText(text);
    const status = hash === latest.hash ? "valid" : "mismatch";
    return { createdAt: latest.createdAt, status };
  } catch (error) {
    console.warn("[backupService] failed to check backup integrity", error);
    return { createdAt: null, status: "none" };
  }
}

export async function getAllBackupList(): Promise<BackupEntry[]> {
  const browserBackups: BackupEntry[] = getBackupList().map((b) => ({
    ...b,
    source: "browser" as const
  }));
  return browserBackups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function clearOldBackups(keepCount: number = 1): number {
  if (typeof window === "undefined") return 0;
  try {
    const current = sortBackupsNewestFirst(readStoredBackups());
    if (current.length <= keepCount) return 0;
    const kept = current.slice(0, keepCount);
    writeStoredBackups(kept);
    return current.length - kept.length;
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
