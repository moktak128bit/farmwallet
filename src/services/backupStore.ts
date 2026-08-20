/**
 * 로컬 백업 저장소 — IndexedDB('farmwallet-backups') 기반.
 *
 * 이전엔 localStorage BACKUPS 키에 백업 배열(캐시 포함 풀 AppData × 최대 20개 ≈ 28MB)을 JSON으로
 * 저장해 5MB quota 안에서 실제로는 1~2개만 남는 상태였다. IndexedDB는 수백 MB 이상 쓸 수 있어
 * 보존 정책(4일 × 5개 + 라벨 스냅샷)이 산수대로 유지된다.
 *
 * 구조
 * - 'backups' 스토어(keyPath id): { id, createdAt, label?, hash?, dataJson } — 본문은 user-only JSON 문자열
 *   (구조화 복제 비용이 객체 그래프보다 훨씬 싸고, 해시도 같은 문자열로 계산)
 * - 'backupMeta' 스토어(keyPath id): { id, createdAt, label?, hash? } — 목록 조회가 본문을 읽지 않도록
 * - 두 스토어는 항상 같은 readwrite 트랜잭션에서 함께 갱신(원자적)
 *
 * 폴백: IndexedDB가 없거나 열기/이관에 실패하면 기존 localStorage BACKUPS 경로(레거시 형식
 * { id, createdAt, data, hash?, label? } 배열)를 그대로 쓴다. 손상 BACKUPS 원본 보존(BACKUPS_CORRUPT 1슬롯)
 * 로직도 localStorage에 그대로 둔다.
 *
 * 이관: 저장소 초기화 시 localStorage BACKUPS 배열을 IDB로 복사하고, 복사본이 실제로 읽히는 것을
 * 확인한 뒤에만 localStorage 키를 제거한다. 실패하면 키를 그대로 두고 이번 세션은 localStorage 경로를 쓴다.
 *
 * 안전 스냅샷 동기 1슬롯(BACKUP_SAFETY_PENDING): saveSafetySnapshot은 "첫 await 전에 동기 기록" 계약이
 * 있어(dataService 0-9·1-3 — 호출 직후 리로드/크래시가 나도 원본이 남아야 함) 최신 안전 스냅샷 1개를
 * localStorage에 동기로 먼저 쓰고, IDB 복제가 성공하면 슬롯을 비운다. 목록/복원은 슬롯을 병합해 읽는다.
 */

import { STORAGE_KEYS } from "../constants/config";

/** 저장소 공통 레코드 — 본문은 JSON 문자열 */
export interface BackupRecord {
  id: string;
  createdAt: string;
  /** 백업 생성 사유 (위험 작업 직전 안전 스냅샷 등). 없으면 일반 자동/수동 백업. */
  label?: string;
  /** dataJson의 SHA-256 (skipHash 저장은 없음) */
  hash?: string;
  /** 백업 본문 JSON (신규 백업은 user-only — 캐시 3종 제외; 구 백업은 캐시 포함 가능) */
  dataJson: string;
}

export interface BackupRecordMeta {
  id: string;
  createdAt: string;
  label?: string;
  hash?: string;
}

interface BackupStoreDriver {
  readonly kind: "idb" | "local";
  listMeta(): Promise<BackupRecordMeta[]>;
  get(id: string): Promise<BackupRecord | null>;
  /** put + delete를 한 번에(원자적으로) 적용 */
  write(puts: BackupRecord[], deleteIds: string[]): Promise<void>;
}

/** localStorage BACKUPS 레거시 형식 */
interface LegacyStoredBackup {
  id: string;
  createdAt: string;
  data: unknown;
  hash?: string;
  label?: string;
}

const DB_NAME = "farmwallet-backups";
const DB_VERSION = 1;
const STORE_NAME = "backups";
const META_STORE_NAME = "backupMeta";

export function toBackupMeta(record: BackupRecord | BackupRecordMeta): BackupRecordMeta {
  const meta: BackupRecordMeta = { id: record.id, createdAt: record.createdAt };
  if (record.label !== undefined) meta.label = record.label;
  if (record.hash !== undefined) meta.hash = record.hash;
  return meta;
}

function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined" && window.indexedDB != null;
}

// =========================================
//  localStorage 레거시(폴백) 저장소
// =========================================

/**
 * 손상된 BACKUPS 원본을 BACKUPS_CORRUPT 1슬롯으로 옮긴다.
 * 이미 보존된 슬롯이 있으면 더 오래된 그것을 유지하고 새 손상본은 버린다(1슬롯 정책 —
 * 첫 손상본이 가장 많은 원본 백업을 담고 있을 가능성이 높고, 이후 손상은 대개 빈 목록에서
 * 새로 시작한 소량 백업이라 덮어쓰면 오히려 복구 가치가 떨어진다).
 * 보존에 실패(quota 등)해도 호출부는 빈 목록으로 계속 진행한다.
 */
function preserveCorruptBackupsRaw(raw: string): boolean {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT);
    if (existing) {
      console.warn(
        "[FarmWallet] 손상된 백업 원본 슬롯(BACKUPS_CORRUPT)이 이미 있어 기존 것을 유지합니다 — 새 손상본은 버림"
      );
      return true;
    }
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS_CORRUPT, raw);
    return true;
  } catch (e) {
    console.warn("[FarmWallet] 손상된 백업 원본 보존 실패", e);
    return false;
  }
}

/**
 * localStorage BACKUPS 배열 읽기(레거시 형식). 손상 JSON은 BACKUPS_CORRUPT로 옮기고 빈 목록.
 * (손상 BACKUPS가 throw하면 모든 자동 백업이 영구 무력화되므로 파싱 실패를 빈 목록으로 흡수하되,
 *  다음 쓰기가 원본 블롭을 덮기 전에 보존 슬롯으로 옮겨 둔다.)
 */
function readLegacyBackups(): LegacyStoredBackup[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUPS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is LegacyStoredBackup => !!b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string"
    );
  } catch (e) {
    console.warn("[FarmWallet] 백업 목록(BACKUPS) 파싱 실패 — 원본을 보존 슬롯으로 옮기고 빈 목록으로 복구", e);
    // 보존(또는 1슬롯 정책에 따른 의도적 스킵)이 끝난 경우에만 손상 원본을 BACKUPS에서 비운다 —
    // 보존 자체가 실패(quota 등)했으면 그대로 두어 다음 읽기에서 재시도할 여지를 남긴다.
    if (preserveCorruptBackupsRaw(raw)) {
      try {
        window.localStorage.removeItem(STORAGE_KEYS.BACKUPS);
      } catch {
        /* 제거 실패해도 다음 쓰기가 덮어쓴다 */
      }
    }
    return [];
  }
}

function legacyToRecord(b: LegacyStoredBackup): BackupRecord {
  const record: BackupRecord = {
    id: b.id,
    createdAt: typeof b.createdAt === "string" ? b.createdAt : "",
    dataJson: JSON.stringify(b.data ?? null)
  };
  if (typeof b.label === "string") record.label = b.label;
  if (typeof b.hash === "string") record.hash = b.hash;
  return record;
}

function recordToLegacy(r: BackupRecord): LegacyStoredBackup {
  let data: unknown;
  try {
    data = JSON.parse(r.dataJson);
  } catch {
    data = null;
  }
  const legacy: LegacyStoredBackup = { id: r.id, createdAt: r.createdAt, data };
  if (r.hash !== undefined) legacy.hash = r.hash;
  if (r.label !== undefined) legacy.label = r.label;
  return legacy;
}

function writeLegacyBackups(backups: LegacyStoredBackup[]): void {
  window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backups));
}

const localDriver: BackupStoreDriver = {
  kind: "local",
  async listMeta() {
    return readLegacyBackups().map((b) => toBackupMeta(legacyToRecord(b)));
  },
  async get(id) {
    const found = readLegacyBackups().find((b) => b.id === id);
    return found ? legacyToRecord(found) : null;
  },
  async write(puts, deleteIds) {
    if (typeof window === "undefined") return;
    const del = new Set(deleteIds);
    const putIds = new Set(puts.map((p) => p.id));
    const kept = readLegacyBackups().filter((b) => !del.has(b.id) && !putIds.has(b.id));
    writeLegacyBackups([...puts.map(recordToLegacy), ...kept]);
  }
};

// =========================================
//  IndexedDB 저장소
// =========================================

let _dbPromise: Promise<IDBDatabase> | null = null;
let _unloadHandlerRegistered = false;

function registerUnloadCloseHandler() {
  if (_unloadHandlerRegistered || typeof window === "undefined") return;
  _unloadHandlerRegistered = true;
  // 탭 종료/리프레시 시 db.close()로 IDB 풀에 점유된 connection 반환 (cacheStore와 동일 패턴)
  window.addEventListener("pagehide", () => {
    if (!_dbPromise) return;
    _dbPromise
      .then((db) => {
        try {
          db.close();
        } catch {
          /* */
        }
      })
      .catch(() => {
        /* open 자체 실패면 close 불필요 */
      });
    _dbPromise = null;
  });
}

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  registerUnloadCloseHandler();
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭에서 schema upgrade 요청 시 자동으로 close해야 다음 open이 막히지 않음
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* */
        }
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  // 실패한 open은 캐시하지 않는다 — 다음 호출에서 재시도 가능
  _dbPromise.catch(() => {
    _dbPromise = null;
  });
  return _dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function isValidRecord(v: unknown): v is BackupRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<BackupRecord>;
  return typeof r.id === "string" && typeof r.createdAt === "string" && typeof r.dataJson === "string";
}

function isValidMeta(v: unknown): v is BackupRecordMeta {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<BackupRecordMeta>;
  return typeof r.id === "string" && typeof r.createdAt === "string";
}

const idbDriver: BackupStoreDriver = {
  kind: "idb",
  async listMeta() {
    const db = await openDB();
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const all = await requestToPromise(tx.objectStore(META_STORE_NAME).getAll());
    return (Array.isArray(all) ? all : []).filter(isValidMeta).map(toBackupMeta);
  },
  async get(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const found = await requestToPromise(tx.objectStore(STORE_NAME).get(id));
    return isValidRecord(found) ? found : null;
  },
  async write(puts, deleteIds) {
    if (puts.length === 0 && deleteIds.length === 0) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([STORE_NAME, META_STORE_NAME], "readwrite");
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const meta = tx.objectStore(META_STORE_NAME);
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err ?? "IndexedDB write failed")));
      };
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted"));
      try {
        for (const id of deleteIds) {
          store.delete(id);
          meta.delete(id);
        }
        for (const p of puts) {
          store.put(p);
          meta.put(toBackupMeta(p));
        }
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* */
        }
        fail(e);
      }
    });
  }
};

// =========================================
//  안전 스냅샷 동기 1슬롯 (localStorage)
// =========================================

/**
 * 안전 스냅샷을 localStorage 1슬롯에 동기 기록. 성공 여부 반환(quota 등 실패 시 false).
 * 본문 JSON은 재직렬화(이스케이프) 없이 그대로 이어 붙여 `{"id":..,"data":<dataJson>}` 형태로 저장한다.
 */
export function writePendingSafetySnapshotSync(record: BackupRecord): boolean {
  if (typeof window === "undefined") return false;
  try {
    const head =
      `{"id":${JSON.stringify(record.id)},"createdAt":${JSON.stringify(record.createdAt)}` +
      (record.label !== undefined ? `,"label":${JSON.stringify(record.label)}` : "") +
      `,"data":`;
    window.localStorage.setItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING, `${head}${record.dataJson}}`);
    return true;
  } catch (e) {
    console.warn("[FarmWallet] 안전 스냅샷 동기 슬롯 기록 실패", e);
    return false;
  }
}

/** 동기 슬롯의 안전 스냅샷 읽기. 없거나 손상이면 null (손상은 슬롯 제거). */
export function readPendingSafetySnapshot(): BackupRecord | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyStoredBackup> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.createdAt !== "string") {
      throw new Error("invalid pending safety snapshot");
    }
    return legacyToRecord({
      id: parsed.id,
      createdAt: parsed.createdAt,
      data: parsed.data,
      label: typeof parsed.label === "string" ? parsed.label : undefined
    });
  } catch (e) {
    console.warn("[FarmWallet] 안전 스냅샷 동기 슬롯 파싱 실패 — 슬롯 폐기", e);
    clearPendingSafetySnapshot();
    return null;
  }
}

/** 동기 슬롯 비우기. id를 주면 슬롯이 그 id일 때만 비운다(다른 호출이 덮어쓴 최신 슬롯 보호). */
export function clearPendingSafetySnapshot(id?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (id !== undefined) {
      const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING);
      if (!raw) return;
      // 앞부분에 id가 첫 키로 기록돼 있어 전체 파싱 없이 확인 가능
      if (!raw.startsWith(`{"id":${JSON.stringify(id)},`)) return;
    }
    window.localStorage.removeItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING);
  } catch {
    /* */
  }
}

// =========================================
//  드라이버 선택 + 1회 이관
// =========================================

let _driverPromise: Promise<BackupStoreDriver> | null = null;

/**
 * localStorage BACKUPS → IDB 1회 이관. 복사 후 IDB에서 전부 읽히는 것을 확인한 뒤에만 키 제거.
 * 반환: true = 이관 완료(또는 이관할 것 없음), false = 실패(키 유지, 레거시 경로 계속 사용).
 */
async function migrateLegacyBackupsToIDB(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  let rawExists = false;
  try {
    rawExists = window.localStorage.getItem(STORAGE_KEYS.BACKUPS) != null;
  } catch {
    return true;
  }
  if (!rawExists) return true;
  const legacy = readLegacyBackups(); // 손상이면 BACKUPS_CORRUPT로 보존 + 키 제거됨
  if (legacy.length === 0) {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.BACKUPS);
    } catch {
      /* */
    }
    return true;
  }
  try {
    const records = legacy.map(legacyToRecord);
    await idbDriver.write(records, []);
    const stored = new Set((await idbDriver.listMeta()).map((m) => m.id));
    const allCopied = records.every((r) => stored.has(r.id));
    if (!allCopied) {
      console.warn("[FarmWallet] 백업 IDB 이관 검증 실패 — localStorage 백업을 유지합니다");
      return false;
    }
    window.localStorage.removeItem(STORAGE_KEYS.BACKUPS);
    console.info(`[FarmWallet] 로컬 백업 ${records.length}개를 IndexedDB로 이관했습니다`);
    return true;
  } catch (e) {
    console.warn("[FarmWallet] 백업 IDB 이관 실패 — localStorage 백업을 유지합니다", e);
    return false;
  }
}

/** 동기 슬롯에 남은 안전 스냅샷(IDB 복제 실패/크래시)을 저장소로 옮기고 슬롯을 비운다 (best-effort). */
async function flushPendingSafetySnapshot(driver: BackupStoreDriver): Promise<void> {
  const pending = readPendingSafetySnapshot();
  if (!pending) return;
  try {
    const existing = await driver.get(pending.id);
    if (!existing) await driver.write([pending], []);
    clearPendingSafetySnapshot(pending.id);
  } catch (e) {
    console.warn("[FarmWallet] 안전 스냅샷 슬롯 → 저장소 이동 실패 (슬롯 유지)", e);
  }
}

async function resolveDriver(): Promise<BackupStoreDriver> {
  let driver: BackupStoreDriver = localDriver;
  if (isIndexedDBAvailable()) {
    try {
      await openDB();
      const migrated = await migrateLegacyBackupsToIDB();
      driver = migrated ? idbDriver : localDriver;
    } catch (e) {
      console.warn("[FarmWallet] 백업 IndexedDB 사용 불가 — localStorage 폴백", e);
      driver = localDriver;
    }
  }
  await flushPendingSafetySnapshot(driver);
  return driver;
}

/** 백업 저장소 드라이버 (최초 호출 시 IDB 열기 + 레거시 이관 + 슬롯 flush 1회) */
export function getBackupStore(): Promise<BackupStoreDriver> {
  if (!_driverPromise) {
    _driverPromise = resolveDriver();
    // 예기치 못한 reject는 캐시하지 않는다 — 다음 호출에서 다시 시도
    _driverPromise.catch(() => {
      _driverPromise = null;
    });
  }
  return _driverPromise;
}

/** 테스트 전용: 모듈 캐시(드라이버·DB 연결) 초기화 */
export function resetBackupStoreForTests(): void {
  if (_dbPromise) {
    _dbPromise
      .then((db) => {
        try {
          db.close();
        } catch {
          /* */
        }
      })
      .catch(() => {});
  }
  _dbPromise = null;
  _driverPromise = null;
}
