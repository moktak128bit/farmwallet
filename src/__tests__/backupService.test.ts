// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSafetySnapshot,
  saveBackupSnapshot,
  getBackupList,
  getAllBackupList,
  loadBackupDataVerified,
  getLatestLocalBackupIntegrity,
  clearOldBackups,
  mergeCurrentCaches,
  isBackupOnSaveEnabled,
  getCorruptBackupsInfo,
  getCorruptBackupsRaw,
  clearCorruptBackups
} from "../services/backupService";
import { getBackupStore, resetBackupStoreForTests, readPendingSafetySnapshot } from "../services/backupStore";
import { toUserDataJson } from "../services/dataService";
import { STORAGE_KEYS } from "../constants/config";
import type { AppData } from "../types";
import { installMemoryIndexedDB, type MemoryIndexedDB } from "./helpers/memoryIndexedDB";

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides,
  };
}

/** 캐시 3종이 채워진 픽스처 */
function makeFullData(): AppData {
  return makeAppData({
    ledger: [{ id: "L1", date: "2026-08-01", kind: "expense", category: "지출", subCategory: "식비", description: "점심", amount: 9000 }],
    prices: [{ ticker: "AAPL", price: 100, updatedAt: "2026-08-01T00:00:00.000Z" } as AppData["prices"][number]],
    tickerDatabase: [{ ticker: "AAPL", name: "Apple", market: "US" } as NonNullable<AppData["tickerDatabase"]>[number]],
    historicalDailyCloses: [{ ticker: "AAPL", date: "2026-08-01", close: 100 } as NonNullable<AppData["historicalDailyCloses"]>[number]],
  });
}

interface SeedBackup {
  id: string;
  createdAt: string;
  data: AppData;
  label?: string;
  hash?: string;
}

/** 레거시 localStorage 배열로 시드 — 저장소 초기화 시 IDB(또는 폴백)로 이관된다 */
function seedLegacyBackups(backups: SeedBackup[]): void {
  window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backups));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

let idb: MemoryIndexedDB;

beforeEach(() => {
  window.localStorage.clear();
  resetBackupStoreForTests();
  idb = installMemoryIndexedDB();
  // dev 모드에서 saveBackupSnapshot이 호출하는 /api/backup(파일 백업)은 실패로 — 로컬 경로만 검증
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no dev server"); }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  idb.uninstall();
  resetBackupStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backupService — 보존 정책 (일별 최대 5개 × 최근 4일)", () => {
  it("saveSafetySnapshot이 사유 라벨과 함께 로컬 백업(IDB)으로 저장된다", async () => {
    const ok = await saveSafetySnapshot(makeAppData(), "백업 복원 직전 자동 스냅샷");
    expect(ok).toBe(true);
    const list = await getBackupList();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("백업 복원 직전 자동 스냅샷");
    expect(idb.rows("farmwallet-backups", "backups")).toHaveLength(1);
    // IDB 복제가 끝났으니 동기 슬롯은 비어 있다
    expect(readPendingSafetySnapshot()).toBeNull();
  });

  it("같은 날 백업이 5개를 넘으면 최신 5개만 보존 (당일 안전 백업이 1개로 뭉개지지 않음)", async () => {
    // 같은 KST 날짜 안의 기존 백업 7개 시드 (초 단위 간격)
    const now = Date.now();
    const seeds: SeedBackup[] = Array.from({ length: 7 }, (_, i) => ({
      id: `OLD${i}`,
      createdAt: new Date(now - (i + 1) * 1000).toISOString(),
      data: makeAppData(),
    }));
    seedLegacyBackups(seeds);

    await saveSafetySnapshot(makeAppData(), "새 스냅샷");
    const list = await getBackupList();
    // 당일 최대 5개 (새 스냅샷 포함)
    expect(list).toHaveLength(5);
    // 최신순 정렬 — 첫 항목이 방금 만든 스냅샷
    expect(list[0].label).toBe("새 스냅샷");
    // 가장 최신인 OLD0~OLD3가 살아남고 오래된 OLD4~OLD6은 정리됨
    const ids = list.map((b) => b.id);
    expect(ids).toContain("OLD0");
    expect(ids).not.toContain("OLD6");
    // IDB 본문 스토어도 같이 정리됨
    expect(idb.rows("farmwallet-backups", "backups")).toHaveLength(5);
  });

  it("위험 작업 직전 안전 스냅샷은 같은 날 자동백업 cap에 밀려도 보존된다 (#10)", async () => {
    const now = Date.now();
    // 오래된 라벨 스냅샷 1개 + 더 최신 무라벨 자동백업 5개 (모두 오늘) → 라벨이 perDay(5) cap에 밀릴 위치
    const seeds: SeedBackup[] = [
      { id: "SAFE", createdAt: new Date(now - 60_000).toISOString(), data: makeAppData(), label: "위험 작업 직전 자동 스냅샷" },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `AUTO${i}`,
        createdAt: new Date(now - (i + 1) * 1000).toISOString(),
        data: makeAppData(),
      })),
    ];
    seedLegacyBackups(seeds);
    await saveSafetySnapshot(makeAppData(), "새 스냅샷");
    const ids = (await getBackupList()).map((b) => b.id);
    // SAFE는 가장 오래돼 perDay cap이라면 잘려야 하지만, 라벨 스냅샷이라 보존됨
    expect(ids).toContain("SAFE");
  });

  it("백업이 있는 날짜는 최근 4일치만 유지", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // 과거 1~6일 전 각 1개 시드
    const seeds: SeedBackup[] = Array.from({ length: 6 }, (_, i) => ({
      id: `D${i + 1}`,
      createdAt: new Date(now - (i + 1) * day).toISOString(),
      data: makeAppData(),
    }));
    seedLegacyBackups(seeds);

    await saveSafetySnapshot(makeAppData(), "오늘 스냅샷");
    const list = await getBackupList();
    // 오늘 + 1일 전 + 2일 전 + 3일 전 = 4개 날짜만 유지
    expect(list).toHaveLength(4);
    const ids = list.map((b) => b.id);
    expect(ids).toContain("D1");
    expect(ids).toContain("D3");
    expect(ids).not.toContain("D4");
    expect(ids).not.toContain("D6");
  });

  it("4일 × 5개 = 20개가 실제로 유지된다 (IDB라 quota 축소 없음)", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const seeds: SeedBackup[] = [];
    for (let d = 0; d < 4; d++) {
      for (let k = 0; k < 5; k++) {
        // 오늘(d=0)은 4개만 — 새 백업이 5번째
        if (d === 0 && k === 4) continue;
        seeds.push({
          id: `D${d}K${k}`,
          createdAt: new Date(now - d * day - (k + 1) * 60_000).toISOString(),
          data: makeAppData({ ledger: Array.from({ length: 200 }, (_, i) => ({ id: `L${i}`, date: "2026-08-01", kind: "expense" as const, category: "지출", subCategory: "식비", description: "x".repeat(50), amount: i })) }),
        });
      }
    }
    expect(seeds).toHaveLength(19);
    seedLegacyBackups(seeds);

    const result = await saveBackupSnapshot(makeAppData(), { skipHash: true });
    expect(result.localSaved).toBe(true);
    expect(result.localError).toBeUndefined();
    const list = await getBackupList();
    expect(list).toHaveLength(20);
    expect(idb.rows("farmwallet-backups", "backups")).toHaveLength(20);
  });
});

describe("backupService — user-only payload·해시·복원 호환", () => {
  it("백업 본문은 toUserDataJson과 동일한 문자열(캐시 3종 제외)이고 해시도 그 문자열로 계산된다", async () => {
    const data = makeFullData();
    const result = await saveBackupSnapshot(data, { skipHash: false });
    expect(result.localSaved).toBe(true);

    const list = await getBackupList();
    expect(list).toHaveLength(1);
    const store = await getBackupStore();
    const record = await store.get(list[0].id);
    expect(record?.dataJson).toBe(toUserDataJson(data));
    expect(record?.dataJson).not.toContain("AAPL");
    expect(record?.hash).toBe(await sha256Hex(toUserDataJson(data)));

    // 읽기 검증: 해시 일치, 본문에는 캐시가 없다
    const verified = await loadBackupDataVerified(list[0].id);
    expect(verified.status).toBe("valid");
    expect(verified.data?.ledger).toHaveLength(1);
    expect(verified.data).not.toHaveProperty("prices");
    expect((await getLatestLocalBackupIntegrity()).status).toBe("valid");
  });

  it("호출부가 userDataJson을 넘기면 그 문자열을 그대로 본문·해시로 쓴다 (재직렬화 생략)", async () => {
    const data = makeFullData();
    const userJson = toUserDataJson(data);
    await saveBackupSnapshot(data, { skipHash: false, userDataJson: userJson, dataJson: JSON.stringify(data) });
    const [meta] = await getBackupList();
    const record = await (await getBackupStore()).get(meta.id);
    expect(record?.dataJson).toBe(userJson);
    expect(meta.hash).toBe(await sha256Hex(userJson));
  });

  it("구 백업(캐시 포함 full AppData, 해시=JSON.stringify(data))도 이관 후 그대로 복원·검증된다", async () => {
    const full = makeFullData();
    const legacyHash = await sha256Hex(JSON.stringify(full));
    seedLegacyBackups([{ id: "LEGACY", createdAt: new Date().toISOString(), data: full, hash: legacyHash }]);

    const verified = await loadBackupDataVerified("LEGACY");
    expect(verified.status).toBe("valid");
    expect(verified.data?.prices).toEqual(full.prices);
    expect(verified.data?.historicalDailyCloses).toEqual(full.historicalDailyCloses);
    // 이관 후 localStorage 키는 제거되고 IDB에 있다
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBeNull();
    expect((await getLatestLocalBackupIntegrity())).toEqual({ createdAt: verified.data ? expect.any(String) : null, status: "valid" });
  });

  it("해시 불일치(본문 변조)면 mismatch + onCorrupt 콜백, 데이터는 그대로 반환", async () => {
    const data = makeAppData({ ledger: [{ id: "L1", date: "2026-08-01", kind: "expense", category: "식비", description: "a", amount: 1 }] });
    seedLegacyBackups([{ id: "TAMPER", createdAt: new Date().toISOString(), data, hash: "deadbeef" }]);
    const onCorrupt = vi.fn();
    const verified = await loadBackupDataVerified("TAMPER", onCorrupt);
    expect(verified.status).toBe("mismatch");
    expect(verified.data?.ledger).toHaveLength(1);
    expect(onCorrupt).toHaveBeenCalledWith({ id: "TAMPER", createdAt: expect.any(String) });
    expect((await getLatestLocalBackupIntegrity()).status).toBe("mismatch");
    expect((await loadBackupDataVerified("nope")).status).toBe("not-found");
  });

  it("mergeCurrentCaches: 복원 본문에 캐시가 없으면 현재 캐시를 유지하고, 있으면(구 백업) 본문 것을 쓴다", () => {
    const current = makeFullData();
    const restoredUserOnly = makeAppData({ ledger: [{ id: "R", date: "2026-08-02", kind: "income", category: "수입", description: "x", amount: 1 }] });
    const merged = mergeCurrentCaches(restoredUserOnly, current);
    expect(merged.ledger[0].id).toBe("R");
    expect(merged.prices).toBe(current.prices);
    expect(merged.tickerDatabase).toBe(current.tickerDatabase);
    expect(merged.historicalDailyCloses).toBe(current.historicalDailyCloses);

    const restoredFull = makeFullData();
    restoredFull.prices = [{ ticker: "MSFT", price: 1, updatedAt: "2026-08-02T00:00:00.000Z" } as AppData["prices"][number]];
    const merged2 = mergeCurrentCaches(restoredFull, current);
    expect(merged2.prices).toBe(restoredFull.prices);
    // current가 없으면 그대로
    expect(mergeCurrentCaches(restoredUserOnly, null)).toBe(restoredUserOnly);
  });

  it("왕복: user-only 백업 복원 + mergeCurrentCaches → 사용자 데이터는 백업, 캐시는 현재 것", async () => {
    const current = makeFullData();
    const past = makeAppData({ ledger: [{ id: "PAST", date: "2026-07-01", kind: "expense", category: "식비", description: "p", amount: 5 }] });
    await saveBackupSnapshot(past, { skipHash: false });
    const [meta] = await getBackupList();
    const { data: restored, status } = await loadBackupDataVerified(meta.id);
    expect(status).toBe("valid");
    const merged = mergeCurrentCaches(restored!, current);
    expect(merged.ledger.map((l) => l.id)).toEqual(["PAST"]);
    expect(merged.prices).toEqual(current.prices);
  });

  it("getAllBackupList는 source=browser로 감싸고, clearOldBackups는 최신 N개만 남긴다", async () => {
    const now = Date.now();
    seedLegacyBackups(Array.from({ length: 3 }, (_, i) => ({ id: `X${i}`, createdAt: new Date(now - (i + 1) * 1000).toISOString(), data: makeAppData() })));
    const all = await getAllBackupList();
    expect(all.map((b) => b.source)).toEqual(["browser", "browser", "browser"]);
    expect(await clearOldBackups(1)).toBe(2);
    expect((await getBackupList()).map((b) => b.id)).toEqual(["X0"]);
    expect(await clearOldBackups(1)).toBe(0);
  });
});

describe("backupService — saveSafetySnapshot 동기 슬롯 계약", () => {
  it("첫 await 전에 localStorage 동기 슬롯에 기록되고, IDB 복제가 끝나면 슬롯이 비워진다", async () => {
    const data = makeFullData();
    const promise = saveSafetySnapshot(data, "테스트 직전");
    // await 전 — 동기 슬롯에 이미 존재 (user-only 본문)
    const pending = readPendingSafetySnapshot();
    expect(pending).not.toBeNull();
    expect(pending?.label).toBe("테스트 직전");
    expect(pending?.dataJson).toBe(toUserDataJson(data));
    // 목록 조회도 슬롯을 병합해 보여준다
    expect((await getBackupList()).some((b) => b.id === pending!.id)).toBe(true);

    expect(await promise).toBe(true);
    expect(readPendingSafetySnapshot()).toBeNull();
    expect((await getBackupList()).map((b) => b.id)).toEqual([pending!.id]);
  });

  it("IDB 쓰기가 실패해도 동기 슬롯 덕에 true를 돌려주고 목록·복원에 보인다; 다음 초기화에서 저장소로 옮겨진다", async () => {
    idb.options.failWrites = true;
    const data = makeAppData({ ledger: [{ id: "KEEP", date: "2026-08-01", kind: "expense", category: "식비", description: "k", amount: 1 }] });
    const ok = await saveSafetySnapshot(data, "실패 시나리오");
    expect(ok).toBe(true);
    const pending = readPendingSafetySnapshot();
    expect(pending).not.toBeNull();
    expect(idb.rows("farmwallet-backups", "backups")).toEqual([]);

    const list = await getBackupList();
    expect(list.map((b) => b.id)).toEqual([pending!.id]);
    const verified = await loadBackupDataVerified(pending!.id);
    expect(verified.status).toBe("missing-hash");
    expect(verified.data?.ledger[0].id).toBe("KEEP");

    // IDB가 회복된 다음 초기화(부팅)에서 슬롯 → IDB
    idb.options.failWrites = false;
    resetBackupStoreForTests();
    expect((await getBackupList()).map((b) => b.id)).toEqual([pending!.id]);
    expect(idb.rows("farmwallet-backups", "backups")).toHaveLength(1);
    expect(readPendingSafetySnapshot()).toBeNull();
  });
});

describe("backupService — BACKUP_ON_SAVE 기본값", () => {
  it("저장된 설정이 없으면 on, 'false'면 off, 'true'면 on", () => {
    expect(isBackupOnSaveEnabled()).toBe(true);
    window.localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, "false");
    expect(isBackupOnSaveEnabled()).toBe(false);
    window.localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, "true");
    expect(isBackupOnSaveEnabled()).toBe(true);
  });
});

describe("backupService — BACKUPS 손상 시 원본 보존 (BACKUPS_CORRUPT 1슬롯)", () => {
  it("손상 JSON → 원본을 BACKUPS_CORRUPT로 옮기고 빈 목록으로 시작, 다음 저장이 원본을 덮지 않는다", async () => {
    const corruptRaw = '[{"id":"B1","createdAt":"2026-08-01T00:00:00.000Z","data":{"accounts":[';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, corruptRaw);

    expect(await getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(corruptRaw);
    expect(getCorruptBackupsRaw()).toBe(corruptRaw);
    expect(getCorruptBackupsInfo()).toEqual({ sizeBytes: new TextEncoder().encode(corruptRaw).length });

    // 다음 저장은 새 목록을 쓰지만 보존 슬롯의 원본은 그대로
    const ok = await saveSafetySnapshot(makeAppData(), "손상 후 첫 스냅샷");
    expect(ok).toBe(true);
    expect(await getBackupList()).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(corruptRaw);

    // 삭제하면 슬롯이 비고 정보도 null
    expect(clearCorruptBackups()).toBe(true);
    expect(getCorruptBackupsInfo()).toBeNull();
    expect(clearCorruptBackups()).toBe(false);
  });

  it("이미 BACKUPS_CORRUPT 슬롯이 있으면 더 오래된 것을 유지하고 새 손상본은 덮지 않는다 (1슬롯 정책)", async () => {
    const olderCorrupt = '[{"id":"OLDER","data":{"ledger":[{"id":"L1"';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS_CORRUPT, olderCorrupt);
    const newerCorrupt = '{"broken":true';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, newerCorrupt);

    expect(await getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(olderCorrupt);

    await saveSafetySnapshot(makeAppData(), "스냅샷");
    expect(await getBackupList()).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(olderCorrupt);
  });

  it("정상 JSON은 보존 슬롯을 만들지 않고 기존 백업도 그대로 유지된다", async () => {
    seedLegacyBackups([{ id: "OK1", createdAt: new Date(Date.now() - 1000).toISOString(), data: makeAppData() }]);

    await saveSafetySnapshot(makeAppData(), "정상 스냅샷");
    const ids = (await getBackupList()).map((b) => b.id);
    expect(ids).toContain("OK1");
    expect(ids).toHaveLength(2);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBeNull();
    expect(getCorruptBackupsInfo()).toBeNull();
    expect(getCorruptBackupsRaw()).toBeNull();
  });

  it("배열이 아닌 정상 JSON(객체)은 손상으로 취급하지 않고 빈 목록만 반환한다", async () => {
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, '{"not":"array"}');
    expect(await getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBeNull();
  });
});
