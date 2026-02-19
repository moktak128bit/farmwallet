import type { AppData } from "../types";
import { STORAGE_KEYS, BACKUP_CONFIG } from "../constants/config";
import { getKoreaTime } from "../utils/dateUtils";

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

async function computeBackupHash(data: AppData): Promise<string> {
  const text = JSON.stringify(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveBackupSnapshot(
  data: AppData,
  options?: { skipHash?: boolean; folder?: string }
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
    const current: StoredBackup[] = raw ? (JSON.parse(raw) as StoredBackup[]) : [];
    const koreaTime = getKoreaTime();
    const nowISO = koreaTime.toISOString();
    const hash = options?.skipHash ? undefined : await computeBackupHash(data);

    const backup: StoredBackup = {
      id: `B${Date.now()}`,
      createdAt: nowISO,
      data,
      hash
    };

    // localStorage 용량 제한을 고려하여 최근 5개만 보관
    const next = [backup, ...current].slice(0, 5);
    try {
      window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(next, null, 2));
    } catch (quotaErr) {
      // 용량 초과 시 기존 백업을 더 줄이고 재시도
      const reduced = [backup, ...current].slice(0, 3);
      try {
        window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(reduced, null, 2));
      } catch (retryErr) {
        // 그래도 실패하면 최신 1개만 저장 시도
        try {
          window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify([backup], null, 2));
        } catch (finalErr) {
          // 최종 실패 시 localStorage 백업은 포기
        }
      }
    }
  } catch (err) {
    // 백업은 실패해도 앱 동작에 영향을 주지 않도록 조용히 무시
  }

  // 로컬 파일에도 동일한 스냅샷을 남겨 브라우저를 바꿔도 복원 가능하도록 저장
  try {
    await saveServerBackup(data);
  } catch (err) {
    // 서버 저장 실패도 무시
  }
}

async function saveServerBackup(data: AppData): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(BACKUP_CONFIG.API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw new Error("Backup save failed");
    }
  } catch {
    // 실패해도 무시
  }
}

export function getBackupList(): BackupMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
    if (!raw) return [];
    const current = JSON.parse(raw) as StoredBackup[];
    return current.map((b) => ({ id: b.id, createdAt: b.createdAt, hash: b.hash }));
  } catch {
    return [];
  }
}

export function loadBackupData(id: string): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
    if (!raw) return null;
    const current = JSON.parse(raw) as StoredBackup[];
    const found = current.find((b) => b.id === id);
    return found ? found.data : null;
  } catch {
    return null;
  }
}

export async function getLatestLocalBackupIntegrity(): Promise<{
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}> {
  if (typeof window === "undefined") return { createdAt: null, status: "none" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
    if (!raw) return { createdAt: null, status: "none" };
    const current = JSON.parse(raw) as StoredBackup[];
    const latest = current[0];
    if (!latest) return { createdAt: null, status: "none" };
    if (!latest.hash) return { createdAt: latest.createdAt, status: "missing-hash" };
    const hash = await computeBackupHash(latest.data);
    const status = hash === latest.hash ? "valid" : "mismatch";
    return { createdAt: latest.createdAt, status };
  } catch {
    return { createdAt: null, status: "none" };
  }
}

export async function getAllBackupList(): Promise<BackupEntry[]> {
  const browserBackups: BackupEntry[] = getBackupList().map((b) => ({
    ...b,
    source: "browser" as const
  }));
  return browserBackups.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function loadServerBackupData(fileName: string): Promise<AppData | null> {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams({ fileName });
    const url = `${BACKUP_CONFIG.API_PATH}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as AppData;
    return data;
  } catch {
    return null;
  }
}
