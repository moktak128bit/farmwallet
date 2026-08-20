// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getBackupStore,
  resetBackupStoreForTests,
  writePendingSafetySnapshotSync,
  readPendingSafetySnapshot,
  clearPendingSafetySnapshot,
  type BackupRecord
} from "../services/backupStore";
import { STORAGE_KEYS } from "../constants/config";
import { installMemoryIndexedDB, type MemoryIndexedDB } from "./helpers/memoryIndexedDB";

const DB = "farmwallet-backups";

function rec(id: string, createdAt: string, extra: Partial<BackupRecord> = {}): BackupRecord {
  return { id, createdAt, dataJson: JSON.stringify({ ledger: [{ id: `L-${id}` }] }), ...extra };
}

describe("backupStore — localStorage 폴백 (IndexedDB 없음)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBackupStoreForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("jsdom에는 indexedDB가 없어 local 드라이버를 쓰고, 레거시 BACKUPS 배열 형식으로 읽고 쓴다", async () => {
    const store = await getBackupStore();
    expect(store.kind).toBe("local");

    await store.write([rec("A", "2026-08-20T00:00:00.000Z", { label: "라벨", hash: "h1" })], []);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.BACKUPS) ?? "[]");
    // 레거시 형식: data는 객체(문자열 아님), hash/label 보존
    expect(raw).toEqual([
      { id: "A", createdAt: "2026-08-20T00:00:00.000Z", data: { ledger: [{ id: "L-A" }] }, hash: "h1", label: "라벨" }
    ]);

    expect(await store.listMeta()).toEqual([{ id: "A", createdAt: "2026-08-20T00:00:00.000Z", label: "라벨", hash: "h1" }]);
    const got = await store.get("A");
    expect(got?.dataJson).toBe(JSON.stringify({ ledger: [{ id: "L-A" }] }));
    expect(await store.get("missing")).toBeNull();

    // put + delete 동시 적용, 같은 id put은 교체
    await store.write([rec("B", "2026-08-21T00:00:00.000Z"), rec("A", "2026-08-20T00:00:00.000Z", { label: "갱신" })], []);
    expect((await store.listMeta()).map((m) => m.id).sort()).toEqual(["A", "B"]);
    expect((await store.get("A"))?.label).toBe("갱신");
    await store.write([], ["A"]);
    expect((await store.listMeta()).map((m) => m.id)).toEqual(["B"]);
  });

  it("손상된 BACKUPS JSON은 BACKUPS_CORRUPT로 보존하고 빈 목록으로 시작한다 (0-10 로직 유지)", async () => {
    const corrupt = '[{"id":"B1","data":{"accounts":[';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, corrupt);
    const store = await getBackupStore();
    expect(await store.listMeta()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(corrupt);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBeNull();
  });
});

describe("backupStore — IndexedDB 드라이버 (인메모리 스텁)", () => {
  let idb: MemoryIndexedDB;
  beforeEach(() => {
    window.localStorage.clear();
    resetBackupStoreForTests();
    idb = installMemoryIndexedDB();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    idb.uninstall();
    resetBackupStoreForTests();
    vi.restoreAllMocks();
  });

  it("idb 드라이버: backups/backupMeta 두 스토어에 원자적으로 put/delete, 목록은 meta만 읽는다", async () => {
    const store = await getBackupStore();
    expect(store.kind).toBe("idb");

    await store.write([rec("A", "2026-08-20T00:00:00.000Z", { hash: "h" }), rec("B", "2026-08-21T00:00:00.000Z", { label: "안전" })], []);
    expect(idb.rows(DB, "backups")).toHaveLength(2);
    expect(idb.rows(DB, "backupMeta")).toEqual(
      expect.arrayContaining([
        { id: "A", createdAt: "2026-08-20T00:00:00.000Z", hash: "h" },
        { id: "B", createdAt: "2026-08-21T00:00:00.000Z", label: "안전" }
      ])
    );
    // meta에는 본문이 없다
    for (const m of idb.rows(DB, "backupMeta")) expect(m).not.toHaveProperty("dataJson");

    const list = await store.listMeta();
    expect(list.map((m) => m.id).sort()).toEqual(["A", "B"]);
    expect((await store.get("B"))?.dataJson).toBe(rec("B", "").dataJson);

    await store.write([rec("C", "2026-08-22T00:00:00.000Z")], ["A"]);
    expect((await store.listMeta()).map((m) => m.id).sort()).toEqual(["B", "C"]);
    expect(await store.get("A")).toBeNull();
    expect(idb.rows(DB, "backups").map((r) => (r as BackupRecord).id).sort()).toEqual(["B", "C"]);
  });

  it("쓰기 실패 시 트랜잭션이 abort되어 아무것도 바뀌지 않고 reject된다", async () => {
    const store = await getBackupStore();
    await store.write([rec("A", "2026-08-20T00:00:00.000Z")], []);
    idb.options.failWrites = true;
    await expect(store.write([rec("B", "2026-08-21T00:00:00.000Z")], ["A"])).rejects.toThrow();
    idb.options.failWrites = false;
    expect((await store.listMeta()).map((m) => m.id)).toEqual(["A"]);
  });

  it("이관: localStorage BACKUPS 배열을 IDB로 복사하고 검증된 뒤에만 키를 제거한다", async () => {
    const legacy = [
      { id: "OLD1", createdAt: "2026-08-19T00:00:00.000Z", data: { ledger: [], prices: [{ ticker: "AAPL", price: 1 }] }, hash: "hh" },
      { id: "OLD2", createdAt: "2026-08-18T00:00:00.000Z", data: { ledger: [{ id: "x" }] }, label: "안전 스냅샷" }
    ];
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(legacy));

    const store = await getBackupStore();
    expect(store.kind).toBe("idb");
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBeNull();
    const metas = await store.listMeta();
    expect(metas.map((m) => m.id).sort()).toEqual(["OLD1", "OLD2"]);
    // 구 백업 본문(캐시 포함)·해시·라벨이 그대로 옮겨진다
    const old1 = await store.get("OLD1");
    expect(old1?.hash).toBe("hh");
    expect(old1?.dataJson).toBe(JSON.stringify(legacy[0].data));
    expect((await store.get("OLD2"))?.label).toBe("안전 스냅샷");
  });

  it("이관 실패(IDB 쓰기 오류) 시 localStorage 키를 유지하고 이번 세션은 local 드라이버를 쓴다", async () => {
    const legacy = [{ id: "OLD1", createdAt: "2026-08-19T00:00:00.000Z", data: { ledger: [] } }];
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(legacy));
    idb.options.failWrites = true;

    const store = await getBackupStore();
    expect(store.kind).toBe("local");
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBe(JSON.stringify(legacy));
    expect(idb.rows(DB, "backups")).toEqual([]);
    // 레거시 경로로 계속 읽고 쓴다
    expect((await store.listMeta()).map((m) => m.id)).toEqual(["OLD1"]);
    await store.write([rec("NEW", "2026-08-20T00:00:00.000Z")], []);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.BACKUPS) ?? "[]").map((b: { id: string }) => b.id)).toEqual(["NEW", "OLD1"]);

    // 다음 부팅(재초기화)에서 IDB가 정상이면 그때 이관된다
    idb.options.failWrites = false;
    resetBackupStoreForTests();
    const next = await getBackupStore();
    expect(next.kind).toBe("idb");
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBeNull();
    expect((await next.listMeta()).map((m) => m.id).sort()).toEqual(["NEW", "OLD1"]);
  });

  it("IDB open 실패 시 local 드라이버로 폴백하고 localStorage BACKUPS는 건드리지 않는다", async () => {
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify([{ id: "K", createdAt: "2026-08-19T00:00:00.000Z", data: {} }]));
    idb.options.failOpen = true;
    const store = await getBackupStore();
    expect(store.kind).toBe("local");
    expect((await store.listMeta()).map((m) => m.id)).toEqual(["K"]);
  });

  it("빈 레거시 배열('[]')은 이관할 것이 없으므로 키만 제거한다", async () => {
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, "[]");
    await getBackupStore();
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS)).toBeNull();
  });
});

describe("backupStore — 안전 스냅샷 동기 1슬롯", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBackupStoreForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("동기 기록 → 읽기 왕복 (본문은 재이스케이프 없이 이어 붙임), id 불일치면 비우지 않는다", () => {
    const r = rec("S1", "2026-08-20T01:02:03.000Z", { label: "복원 직전" });
    expect(writePendingSafetySnapshotSync(r)).toBe(true);
    const raw = window.localStorage.getItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING)!;
    expect(raw).toBe(`{"id":"S1","createdAt":"2026-08-20T01:02:03.000Z","label":"복원 직전","data":${r.dataJson}}`);
    expect(readPendingSafetySnapshot()).toEqual(r);

    clearPendingSafetySnapshot("OTHER");
    expect(readPendingSafetySnapshot()).toEqual(r);
    clearPendingSafetySnapshot("S1");
    expect(readPendingSafetySnapshot()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING)).toBeNull();
  });

  it("손상된 슬롯은 null을 돌려주고 폐기한다", () => {
    window.localStorage.setItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING, '{"id":"S1","data":{');
    expect(readPendingSafetySnapshot()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUP_SAFETY_PENDING)).toBeNull();
  });

  it("저장소 초기화 시 슬롯에 남은 스냅샷을 저장소로 옮기고 슬롯을 비운다 (크래시·IDB 실패 후 재부팅)", async () => {
    const idb = installMemoryIndexedDB();
    try {
      writePendingSafetySnapshotSync(rec("S9", "2026-08-20T00:00:00.000Z", { label: "직전" }));
      const store = await getBackupStore();
      expect((await store.listMeta()).map((m) => m.id)).toEqual(["S9"]);
      expect(readPendingSafetySnapshot()).toBeNull();
    } finally {
      idb.uninstall();
      resetBackupStoreForTests();
    }
  });
});
