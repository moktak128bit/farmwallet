/**
 * IndexedDB-based cache store for large/growing data (prices, ticker DB, daily closes).
 *
 * 이전엔 localStorage에 JSON으로 저장 → 브라우저당 5~10MB quota에 걸려
 * 1~2년 운영 시 quota exceeded 위험이 있었음. IndexedDB는 기본 수백 MB~GB까지
 * 사용 가능하여 이 한계를 해소.
 *
 * 공개 API는 Promise 기반. 초기 로드는 dataService가 localStorage에서 즉시
 * 빈/작은 캐시를 반환하고, 앱 마운트 후 loadCacheFromDB()로 비동기 하이드레이션.
 */

import type { AppData, StockPrice, TickerInfo, HistoricalDailyClose } from "../types";

export interface CacheData {
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  historicalDailyCloses: HistoricalDailyClose[];
  /** 마지막으로 saveCacheToDB가 성공한 ISO 시각 (없으면 epoch) */
  cachedAt?: string;
}

const DB_NAME = "farmwallet-cache";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const CACHE_KEY = "cache-v1";

let _dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

let _unloadHandlerRegistered = false;

function registerUnloadCloseHandler() {
  if (_unloadHandlerRegistered || typeof window === "undefined") return;
  _unloadHandlerRegistered = true;
  // 탭 종료/리프레시 시 db.close()로 IDB 풀에 점유된 connection 반환.
  // pagehide가 brower 호환성·iOS 안정성 면에서 beforeunload보다 안전.
  const closeIfOpen = () => {
    if (!_dbPromise) return;
    _dbPromise
      .then((db) => { try { db.close(); } catch { /* */ } })
      .catch(() => { /* open 자체 실패면 close 불필요 */ });
    _dbPromise = null;
  };
  window.addEventListener("pagehide", closeIfOpen);
}

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  registerUnloadCloseHandler();
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭에서 schema upgrade 요청 시 자동으로 close해야 다음 open이 막히지 않음
      db.onversionchange = () => {
        try { db.close(); } catch { /* */ }
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
  return _dbPromise;
}

function emptyCache(): CacheData {
  return { prices: [], tickerDatabase: [], historicalDailyCloses: [], cachedAt: undefined };
}

/** IndexedDB에서 캐시 로드. 실패 시 빈 캐시 반환. */
export async function loadCacheFromDB(): Promise<CacheData> {
  try {
    const db = await openDB();
    return await new Promise<CacheData>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CACHE_KEY);
      req.onsuccess = () => {
        const raw = req.result as Partial<CacheData> | undefined;
        if (!raw) {
          resolve(emptyCache());
          return;
        }
        resolve({
          prices: Array.isArray(raw.prices) ? raw.prices : [],
          tickerDatabase: Array.isArray(raw.tickerDatabase) ? raw.tickerDatabase : [],
          historicalDailyCloses: Array.isArray(raw.historicalDailyCloses)
            ? raw.historicalDailyCloses
            : [],
          cachedAt: typeof raw.cachedAt === "string" ? raw.cachedAt : undefined,
        });
      };
      req.onerror = () => resolve(emptyCache());
    });
  } catch {
    return emptyCache();
  }
}

/** IndexedDB에 캐시 저장. 실패해도 throw하지 않고 warn만. */
export async function saveCacheToDB(cache: CacheData): Promise<void> {
  try {
    const db = await openDB();
    const enriched: CacheData = { ...cache, cachedAt: new Date().toISOString() };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(enriched, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (e) {
    console.warn("[FarmWallet] cacheStore save failed", e);
  }
}

/** AppData에 캐시 필드를 병합 (캐시 제외 필드는 그대로 유지) */
export function mergeCacheIntoAppData(data: AppData, cache: CacheData): AppData {
  return {
    ...data,
    prices: cache.prices.length > 0 ? cache.prices : data.prices,
    tickerDatabase: cache.tickerDatabase.length > 0 ? cache.tickerDatabase : data.tickerDatabase,
    historicalDailyCloses:
      cache.historicalDailyCloses.length > 0
        ? cache.historicalDailyCloses
        : data.historicalDailyCloses,
  };
}
