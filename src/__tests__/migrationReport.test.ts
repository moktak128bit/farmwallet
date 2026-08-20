// @vitest-environment jsdom
/**
 * 1-3 마이그레이션 직전 스냅샷 + diff 리포트.
 *  - diffAppData 순수 함수: 컬렉션별 added/removed/changed·kind별 합계·id 집합 차, 손상 입력 내성
 *  - 리포트 localStorage 왕복(write/read, 깨진 JSON)
 *  - loadData 통합: 마커 < 앱 버전이면 saveData 전에 **마이그레이션 전 원본**을 라벨 스냅샷 + 리포트 기록,
 *    마커가 현행/앞서면 둘 다 없음
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadData, saveData } from "../services/dataService";
import { saveSafetySnapshot } from "../services/backupService";
import { STORAGE_KEYS, DATA_SCHEMA_VERSION } from "../constants/config";
import {
  diffAppData,
  buildMigrationReport,
  migrationSnapshotLabel,
  readLastMigrationReport,
  writeLastMigrationReport,
  DIFF_COLLECTIONS
} from "../services/migrationReport";
import { buildMaskedLegacyData, summarizeMaskedLegacyData } from "./fixtures/maskedLegacyData";
import type { AppData } from "../types";

vi.mock("../services/backupService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/backupService")>();
  return { ...actual, saveSafetySnapshot: vi.fn(async () => true) };
});

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
    ...overrides
  };
}

const L = (id: string, kind: "income" | "expense" | "transfer", amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  date: "2026-01-01",
  kind,
  category: kind === "income" ? "수입" : kind === "expense" ? "지출" : "이체",
  description: "x",
  amount,
  ...extra
});

describe("diffAppData — 순수 함수", () => {
  it("동일 입력이면 모든 컬렉션 0·합계 동일·hasChanges=false", () => {
    const d = buildMaskedLegacyData();
    const diff = diffAppData(d, JSON.parse(JSON.stringify(d)));
    for (const name of DIFF_COLLECTIONS) {
      const c = diff.collections[name];
      expect(c.added).toBe(0);
      expect(c.removed).toBe(0);
      expect(c.changed).toBe(0);
      expect(c.before).toBe(c.after);
    }
    expect(diff.ledgerAmountTotal.before).toBe(diff.ledgerAmountTotal.after);
    expect(diff.tradesTotalAmount.before).toBe(diff.tradesTotalAmount.after);
    expect(diff.hasChanges).toBe(false);
  });

  it("v10 패턴(income 데이트비 → 데이트통장): changed만 잡히고 금액·건수·id는 불변", () => {
    const before = makeAppData({
      ledger: [
        L("a", "income", 150_000, { category: "데이트비" }),
        L("b", "income", 100, { category: "데이트비", subCategory: "데이트통장" }),
        L("c", "expense", 5_000, { category: "데이트비" })
      ] as AppData["ledger"]
    });
    const after = {
      ...before,
      ledger: before.ledger.map((l) => (l.kind === "income" && l.category === "데이트비" ? { ...l, category: "데이트통장" } : l))
    };
    const diff = diffAppData(before, after);
    expect(diff.collections.ledger).toMatchObject({ before: 3, after: 3, added: 0, removed: 0, changed: 2, addedIds: [], removedIds: [] });
    expect(diff.ledgerAmountByKind.income).toEqual({ before: 150_100, after: 150_100 });
    expect(diff.ledgerAmountByKind.expense).toEqual({ before: 5_000, after: 5_000 });
    expect(diff.ledgerAmountTotal).toEqual({ before: 155_100, after: 155_100 });
    expect(diff.hasChanges).toBe(true);
  });

  it("v8/v11 패턴(재테크 expense → transfer): kind별 합계가 이동하고 총합은 불변", () => {
    const before = makeAppData({
      ledger: [
        L("a", "expense", 100_000, { category: "재테크", subCategory: "저축" }),
        L("b", "expense", 300_000, { category: "재테크", subCategory: "투자" }),
        L("c", "expense", 9_000)
      ] as AppData["ledger"]
    });
    const after = {
      ...before,
      ledger: before.ledger.map((l) =>
        l.category === "재테크"
          ? { ...l, kind: "transfer" as const, category: "이체", subCategory: l.subCategory === "저축" ? "저축이체" : "투자이체" }
          : l
      )
    };
    const diff = diffAppData(before, after);
    expect(diff.collections.ledger.changed).toBe(2);
    expect(diff.ledgerAmountByKind.expense).toEqual({ before: 409_000, after: 9_000 });
    expect(diff.ledgerAmountByKind.transfer).toEqual({ before: 0, after: 400_000 });
    expect(diff.ledgerAmountTotal).toEqual({ before: 409_000, after: 409_000 });
  });

  it("추가/제거: id 집합 차가 added/removed·샘플 id로 잡힌다 (샘플은 최대 10개)", () => {
    const before = makeAppData({ ledger: [L("keep", "expense", 1), L("gone", "expense", 2)] as AppData["ledger"] });
    const many = Array.from({ length: 15 }, (_, i) => L(`new${i}`, "income", 10));
    const after = makeAppData({ ledger: [L("keep", "expense", 1), ...many] as AppData["ledger"] });
    const diff = diffAppData(before, after);
    expect(diff.collections.ledger).toMatchObject({ before: 2, after: 16, added: 15, removed: 1, changed: 0, removedIds: ["gone"] });
    expect(diff.collections.ledger.addedIds).toHaveLength(10);
    expect(diff.collections.ledger.addedIds[0]).toBe("new0");
    expect(diff.ledgerAmountByKind.expense).toEqual({ before: 3, after: 1 });
    expect(diff.ledgerAmountByKind.income).toEqual({ before: 0, after: 150 });
  });

  it("trades: totalAmount 합계 전/후 + id 변경 감지 (fxRateAtTrade 덮어쓰기는 changed)", () => {
    const t = { id: "t1", date: "2026-01-01", accountId: "a", ticker: "SCHD", name: "S", side: "buy" as const, quantity: 1, price: 10, fee: 0, totalAmount: 10, cashImpact: -10, fxRateAtTrade: 1400 };
    const before = makeAppData({ trades: [t] });
    const after = makeAppData({ trades: [{ ...t, fxRateAtTrade: 1300 }, { ...t, id: "t2", totalAmount: 5 }] });
    const diff = diffAppData(before, after);
    expect(diff.collections.trades).toMatchObject({ before: 1, after: 2, added: 1, removed: 0, changed: 1, addedIds: ["t2"] });
    expect(diff.tradesTotalAmount).toEqual({ before: 10, after: 15 });
  });

  it("id 없는 컬렉션(customExercises 등)은 직렬화 키로 added/removed만 잡고 changed=0", () => {
    const before = makeAppData({ customExercises: [{ name: "A", bodyPart: "등", addedAt: "2026-01-01" }] });
    const after = makeAppData({ customExercises: [{ name: "A", bodyPart: "가슴", addedAt: "2026-01-01" }] });
    const diff = diffAppData(before, after);
    expect(diff.collections.customExercises).toMatchObject({ added: 1, removed: 1, changed: 0, addedIds: [], removedIds: [] });
  });

  it("손상 입력: 객체 아님·컬렉션이 배열 아님·항목이 객체 아님·amount NaN/문자열 — throw 없이 집계", () => {
    expect(() => diffAppData(null, undefined)).not.toThrow();
    expect(diffAppData(null, undefined).hasChanges).toBe(false);
    expect(diffAppData("x", 42).collections.ledger).toMatchObject({ before: 0, after: 0 });

    const before = { ledger: "not-an-array", trades: { id: "t" } };
    const after = {
      ledger: [null, 3, "str", { id: "a", kind: "expense", amount: Number.NaN }, { id: "b", kind: 7, amount: "1000" }, { amount: 5 }],
      trades: [{ id: "t", totalAmount: "abc" }, { id: "t", totalAmount: Infinity }]
    };
    const diff = diffAppData(before, after);
    expect(diff.collections.ledger.before).toBe(0);
    expect(diff.collections.ledger.after).toBe(6);
    expect(diff.collections.ledger.added).toBe(6);
    // amount: NaN→0, "1000"→1000(Number 변환), 객체 아닌 항목→0 / kind 미상·숫자 kind→"unknown"
    expect(diff.ledgerAmountByKind.expense).toEqual({ before: 0, after: 0 });
    expect(diff.ledgerAmountByKind.unknown).toEqual({ before: 0, after: 1005 });
    expect(diff.ledgerAmountTotal).toEqual({ before: 0, after: 1005 });
    // 같은 id가 2번(중복 id) — 건수로 비교, totalAmount 비유한값은 0
    expect(diff.collections.trades).toMatchObject({ before: 0, after: 2, added: 2 });
    expect(diff.tradesTotalAmount).toEqual({ before: 0, after: 0 });
  });

  it("입력을 변형하지 않는다", () => {
    const before = buildMaskedLegacyData();
    const after = buildMaskedLegacyData();
    const snapB = JSON.stringify(before);
    const snapA = JSON.stringify(after);
    diffAppData(before, after);
    expect(JSON.stringify(before)).toBe(snapB);
    expect(JSON.stringify(after)).toBe(snapA);
  });
});

describe("마이그레이션 리포트 localStorage 왕복", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("write → read 동일 (at 보존), 없으면 null", () => {
    expect(readLastMigrationReport()).toBeNull();
    const diff = diffAppData(makeAppData(), makeAppData({ ledger: [L("a", "income", 1)] as AppData["ledger"] }));
    const report = buildMigrationReport(9, 12, diff, "2026-08-21T00:00:00.000Z");
    expect(writeLastMigrationReport(report)).toBe(true);
    const raw = window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT);
    expect(raw).not.toBeNull();
    // 소형 키: 수 KB 이내
    expect((raw as string).length).toBeLessThan(8_000);
    expect(readLastMigrationReport()).toEqual(report);
  });

  it("깨진 JSON·형태 불일치는 null", () => {
    window.localStorage.setItem(STORAGE_KEYS.LAST_MIGRATION_REPORT, "{not json");
    expect(readLastMigrationReport()).toBeNull();
    window.localStorage.setItem(STORAGE_KEYS.LAST_MIGRATION_REPORT, JSON.stringify({ fromVersion: "9", toVersion: 12 }));
    expect(readLastMigrationReport()).toBeNull();
    window.localStorage.setItem(STORAGE_KEYS.LAST_MIGRATION_REPORT, JSON.stringify({ fromVersion: 9, toVersion: 12, at: "x", diff: {} }));
    expect(readLastMigrationReport()).toBeNull();
  });

  it("컬렉션 일부가 누락된 구형 리포트는 누락분을 0으로 채워 읽는다", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.LAST_MIGRATION_REPORT,
      JSON.stringify({
        fromVersion: 11,
        toVersion: 12,
        at: "2026-08-21T00:00:00.000Z",
        diff: {
          collections: { ledger: { before: 3, after: 3, added: 0, removed: 0, changed: 1, addedIds: [], removedIds: [] } },
          ledgerAmountByKind: { income: { before: 1, after: 1 }, bad: { before: "x" } },
          ledgerAmountTotal: { before: 1, after: 1 },
          tradesTotalAmount: { before: 0, after: 0 },
          hasChanges: true
        }
      })
    );
    const r = readLastMigrationReport();
    expect(r).not.toBeNull();
    expect(r!.diff.collections.ledger.changed).toBe(1);
    expect(r!.diff.collections.accounts).toEqual({ before: 0, after: 0, added: 0, removed: 0, changed: 0, addedIds: [], removedIds: [] });
    expect(Object.keys(r!.diff.ledgerAmountByKind)).toEqual(["income"]);
  });
});

describe("loadData 통합 — 마이그레이션 직전 원본 스냅샷 + 리포트", () => {
  const snapshotMock = vi.mocked(saveSafetySnapshot);
  beforeEach(() => {
    window.localStorage.clear();
    snapshotMock.mockClear();
  });

  it("마커 v9 < 앱: saveData 전에 마이그레이션 전 원본을 라벨 스냅샷 + 리포트 기록(from 9 → to 현행)", () => {
    const original = buildMaskedLegacyData();
    const raw = JSON.stringify(original);
    window.localStorage.setItem(STORAGE_KEYS.DATA, raw);
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "9");

    const loaded = loadData();
    expect(window.localStorage.getItem(STORAGE_KEYS.DATA_SCHEMA_VERSION)).toBe(String(DATA_SCHEMA_VERSION));

    // 스냅샷: 1회, 라벨은 migrationSnapshotLabel과 동일, 내용은 **마이그레이션 전** 원본(재테크 expense·프리셋 구형 그대로)
    expect(snapshotMock).toHaveBeenCalledTimes(1);
    const [snapData, label] = snapshotMock.mock.calls[0];
    expect(label).toBe(migrationSnapshotLabel(9, DATA_SCHEMA_VERSION));
    expect(label).toContain("스키마 v9→v12 마이그레이션 직전 원본");
    expect(snapData).toEqual(JSON.parse(raw));
    const snapLedger = (snapData as unknown as { ledger: Array<Record<string, unknown>> }).ledger;
    expect(snapLedger.find((l) => l.id === "L1690000000004")).toMatchObject({ kind: "expense", category: "재테크", subCategory: "저축" });
    const snapPresets = (snapData as { categoryPresets: { transfer: string[] } }).categoryPresets;
    expect(snapPresets.transfer).not.toContain("투자이체");
    // 로드 결과는 마이그레이션됨
    expect(loaded.ledger.find((l) => l.id === "L1690000000004")).toMatchObject({ kind: "transfer", category: "이체", subCategory: "저축이체" });
    expect(loaded.categoryPresets.transfer).toContain("투자이체");

    // 리포트
    const report = readLastMigrationReport();
    expect(report).not.toBeNull();
    expect(report!.fromVersion).toBe(9);
    expect(report!.toVersion).toBe(DATA_SCHEMA_VERSION);
    expect(Number.isNaN(new Date(report!.at).getTime())).toBe(false);
    const { legacyRecheckExpenseAmount } = summarizeMaskedLegacyData();
    const ledgerDiff = report!.diff.collections.ledger;
    expect(ledgerDiff.before).toBe(original.ledger ? (original.ledger as unknown[]).length : -1);
    expect(ledgerDiff.after).toBe(ledgerDiff.before);
    expect(ledgerDiff.added).toBe(0);
    expect(ledgerDiff.removed).toBe(0);
    // v10(income 데이트비 2) + v11(재테크 expense 저축/투자 2 + v7 임시 transfer 2)
    expect(ledgerDiff.changed).toBe(6);
    expect(report!.diff.ledgerAmountTotal.before).toBe(report!.diff.ledgerAmountTotal.after);
    expect(report!.diff.ledgerAmountByKind.expense.before - report!.diff.ledgerAmountByKind.expense.after).toBe(legacyRecheckExpenseAmount);
    expect(report!.diff.ledgerAmountByKind.transfer.after - report!.diff.ledgerAmountByKind.transfer.before).toBe(legacyRecheckExpenseAmount);
    expect(report!.diff.ledgerAmountByKind.income.before).toBe(report!.diff.ledgerAmountByKind.income.after);
    expect(report!.diff.tradesTotalAmount.before).toBe(report!.diff.tradesTotalAmount.after);
    for (const name of DIFF_COLLECTIONS) {
      if (name === "ledger") continue;
      expect(report!.diff.collections[name]).toMatchObject({ added: 0, removed: 0, changed: 0 });
    }
    expect(report!.diff.hasChanges).toBe(true);

    // 다음 부팅(마커 현행): 스냅샷·리포트 재기록 없음 — 리포트는 v9→v12 그대로 남는다
    snapshotMock.mockClear();
    const reportRaw = window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT);
    loadData();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT)).toBe(reportRaw);
  });

  it("마커 v11 → 변경 항목이 없어도(프리셋만) 마이그레이션이면 스냅샷·리포트(hasChanges=false) 기록", () => {
    saveData(makeAppData({ ledger: [L("a", "expense", 1_000) as AppData["ledger"][number]] }));
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "11");
    loadData();
    expect(snapshotMock).toHaveBeenCalledTimes(1);
    expect(snapshotMock.mock.calls[0][1]).toBe(migrationSnapshotLabel(11, DATA_SCHEMA_VERSION));
    const report = readLastMigrationReport();
    expect(report).toMatchObject({ fromVersion: 11, toVersion: DATA_SCHEMA_VERSION });
    expect(report!.diff.hasChanges).toBe(false);
    expect(report!.diff.collections.ledger).toMatchObject({ before: 1, after: 1, changed: 0 });
  });

  it("마커가 현행이면 스냅샷·리포트 없음", () => {
    saveData(makeAppData());
    loadData();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT)).toBeNull();
  });

  it("마커가 앱보다 높으면(0-6 storedAhead) 마이그레이션으로 취급하지 않아 스냅샷·리포트 없음", () => {
    saveData(makeAppData());
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, String(DATA_SCHEMA_VERSION + 1));
    loadData();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT)).toBeNull();
  });

  it("저장 DATA가 없으면(첫 실행) 마커가 낮아도 아무것도 기록하지 않는다", () => {
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "9");
    loadData();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT)).toBeNull();
  });

  it("같은 부팅에 손상 항목 폐기(0-9)도 있으면 스냅샷 2개(마이그레이션 전 원본 + 폐기 전) — 라벨이 다르다", () => {
    const stored = {
      ...makeAppData(),
      ledger: [
        L("ok", "expense", 1_000),
        { id: "bad", date: "not-a-date", kind: "expense", category: "식비", description: "b", amount: 500 }
      ]
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(stored));
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "10");
    const loaded = loadData();
    expect(loaded.ledger).toHaveLength(1);
    expect(snapshotMock).toHaveBeenCalledTimes(2);
    const labels = snapshotMock.mock.calls.map((c) => c[1]);
    expect(labels[0]).toBe(migrationSnapshotLabel(10, DATA_SCHEMA_VERSION));
    expect(labels[1]).toContain("손상 항목 폐기 직전 원본");
    // 리포트의 after는 sanitize 전(마이그레이션 결과)이므로 폐기 건은 removed로 잡히지 않는다
    const report = readLastMigrationReport();
    expect(report!.diff.collections.ledger).toMatchObject({ before: 2, after: 2, removed: 0 });
  });
});
