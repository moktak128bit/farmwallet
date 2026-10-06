import { describe, it, expect } from "vitest";
import { buildApplySummary, countNewIntegrityErrors } from "../utils/applySummary";
import { getEmptyData, normalizeImportedData, toUserDataJson } from "../services/dataService";
import { normalizeAssetSnapshots } from "../services/dataNormalizers";
import { DATA_SCHEMA_VERSION } from "../constants/config";
import { buildMaskedLegacyData } from "./fixtures/maskedLegacyData";
import type { AppData, LedgerEntry } from "../types";

/**
 * applySummary(ApplyConfirmModal 게이트의 순수 계산) 행동 테스트.
 *  - 차이 없음 → hasChanges=false (모달 생략 신호)
 *  - 컬렉션 건수 변화 → diff.collections에 반영, hasChanges=true
 *  - 최신 가계부 날짜 변화 감지
 *  - 새로 생기는 무결성 오류만 카운트(기존에 있던 오류는 상쇄)
 */

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind">): LedgerEntry {
  return { date: "2026-01-10", description: "", amount: 10_000, category: "", ...partial };
}

describe("applySummary — buildApplySummary", () => {
  it("완전히 동일한 데이터는 차이 없음(hasChanges=false)", () => {
    const data = getEmptyData();
    const summary = buildApplySummary(data, { ...data });
    expect(summary.hasChanges).toBe(false);
    expect(summary.newIntegrityErrorCount).toBe(0);
  });

  it("가계부 항목 추가는 collections.ledger.added로 반영되고 hasChanges=true", () => {
    const before = getEmptyData();
    const after: AppData = { ...before, ledger: [entry({ id: "L1", kind: "expense" })] };
    const summary = buildApplySummary(before, after);
    expect(summary.hasChanges).toBe(true);
    expect(summary.diff.collections.ledger.added).toBe(1);
    expect(summary.diff.collections.ledger.removed).toBe(0);
  });

  it("최신 가계부 날짜가 바뀌면 감지된다", () => {
    const before: AppData = { ...getEmptyData(), ledger: [entry({ id: "L1", kind: "expense", date: "2026-01-01" })] };
    const after: AppData = { ...before, ledger: [entry({ id: "L1", kind: "expense", date: "2026-02-15" })] };
    const summary = buildApplySummary(before, after);
    expect(summary.latestLedgerDateBefore).toBe("2026-01-01");
    expect(summary.latestLedgerDateAfter).toBe("2026-02-15");
    expect(summary.hasChanges).toBe(true);
  });

  it("계좌가 사라지는 변경은 실제 diff로 잡힌다(계좌 위축은 조용히 넘기면 안 됨)", () => {
    const before: AppData = {
      ...getEmptyData(),
      accounts: [{ id: "A1", name: "입출금", institution: "테스트", type: "checking", initialBalance: 0 }]
    };
    const after: AppData = { ...before, accounts: [] };
    const summary = buildApplySummary(before, after);
    expect(summary.diff.collections.accounts.removed).toBe(1);
    expect(summary.hasChanges).toBe(true);
  });
});

/** 사용자 실데이터 형태(3세대 가계부·거래·구형 프리셋) + 설정·시계열을 채운 "스토어에 있을 법한" 데이터 */
function realisticStoreData(): AppData {
  const base = normalizeImportedData({ ...buildMaskedLegacyData(), schemaVersion: 9 });
  return {
    ...base,
    prices: [{ ticker: "005930", price: 70_000, currency: "KRW" } as AppData["prices"][number]],
    targetNetWorthCurve: { "2026-12-31": 100_000_000, "2027-12-31": 150_000_000 },
    assetSnapshots: normalizeAssetSnapshots([
      { date: "2026-09-01", totalAssetEvaluationAmount: 12_345_678, accountBreakdown: [] },
      { date: "2026-09-15", totalAssetEvaluationAmount: 12_500_000 }
    ]),
    marketEnvSnapshots: [{ date: "2026-09-15", fxRate: 1_390, prices: [], recordedAt: "2026-09-15T01:00:00Z" }],
    historicalDailyFx: [{ date: "2026-09-30", rate: 1_391.5 }],
    dividendTrackingTicker: "458730",
    usTickers: ["SCHD", "QQQ"],
    investmentGoals: { annualDepositTarget: 12_000_000, investmentStartDate: "2024-01-02" },
    dailyBudget: {
      enabled: true,
      dailyLimit: 30_000,
      mode: "daily",
      excludedCategories: ["신용결제", "재테크"],
      excludedSubCategories: ["통신비"],
      warnOnExceed: true
    },
    savingsGoals: [
      { id: "SG-1", name: "비상금", targetAmount: 5_000_000, createdAt: "2026-08-01T00:00:00.000Z", linkedAccountIds: ["ACC-BANK"] }
    ]
  };
}

/** Gist 왕복과 같은 경로: toUserDataJson으로 올리고(캐시 제외) 내려받아 정규화 */
function gistRoundTrip(data: AppData): AppData {
  return normalizeImportedData({ ...JSON.parse(toUserDataJson(data)), schemaVersion: DATA_SCHEMA_VERSION });
}

describe("applySummary — 컬렉션 밖 사용자 설정(K9)", () => {
  it("동일 데이터의 Gist 왕복은 변화 없음 — 모달이 뜨지 않는다(오탐 금지)", () => {
    const d = realisticStoreData();
    const summary = buildApplySummary(d, gistRoundTrip(d));
    expect(summary.otherSettingsChanged).toEqual([]);
    expect(summary.hasChanges).toBe(false);
  });

  it("빈 데이터도 왕복 후 변화 없음 (정규화가 빈 값을 undefined로 바꾸는 표현 차이 무시)", () => {
    const d = getEmptyData();
    expect(buildApplySummary(d, gistRoundTrip(d)).hasChanges).toBe(false);
    // 빈 투자 목표 객체 ↔ 미설정(normalizeInvestmentGoals가 undefined로)도 같은 상태
    expect(buildApplySummary({ ...d, investmentGoals: {} }, gistRoundTrip(d)).hasChanges).toBe(false);
  });

  it("저축 목표만 다르면 hasChanges=true, otherSettingsChanged에 savingsGoals", () => {
    const local = realisticStoreData();
    const remote = gistRoundTrip({ ...local, savingsGoals: [] });
    const summary = buildApplySummary(local, remote);
    expect(summary.diff.hasChanges).toBe(false);
    expect(summary.otherSettingsChanged).toEqual(["savingsGoals"]);
    expect(summary.hasChanges).toBe(true);
  });

  it("하루 예산·카테고리·배당 추적 종목 변경도 각각 잡힌다", () => {
    const local = realisticStoreData();
    const remote = gistRoundTrip({
      ...local,
      dailyBudget: { ...local.dailyBudget!, dailyLimit: 50_000 },
      categoryPresets: { ...local.categoryPresets, income: [...local.categoryPresets.income, "부수입"] },
      dividendTrackingTicker: "SCHD"
    });
    expect(buildApplySummary(local, remote).otherSettingsChanged).toEqual([
      "categoryPresets",
      "dailyBudget",
      "dividendTrackingTicker"
    ]);
  });

  it("캐시·자동 적립 시계열만 다르면 변화 없음 (기기마다 달라 매번 모달이 뜨면 안 됨)", () => {
    const local = realisticStoreData();
    const remote: AppData = {
      ...local,
      prices: [],
      historicalDailyCloses: [{ ticker: "SPY", date: "2026-09-30", close: 500 }],
      historicalDailyFx: [{ date: "2026-10-01", rate: 1_400 }],
      benchmarkDailyCloses: [{ ticker: "^KS11", date: "2026-09-30", close: 3_000 }],
      marketEnvSnapshots: []
    };
    const summary = buildApplySummary(local, remote);
    expect(summary.otherSettingsChanged).toEqual([]);
    expect(summary.hasChanges).toBe(false);
  });
});

describe("applySummary — countNewIntegrityErrors", () => {
  it("이미 있던 오류(존재하지 않는 계좌 참조)는 상쇄되어 새 오류로 세지 않는다", () => {
    const brokenLedger: LedgerEntry[] = [entry({ id: "L1", kind: "expense", fromAccountId: "GHOST" })];
    const before: AppData = { ...getEmptyData(), ledger: brokenLedger };
    const after: AppData = { ...getEmptyData(), ledger: brokenLedger };
    expect(countNewIntegrityErrors(before, after)).toBe(0);
  });

  it("적용 후에만 생기는 존재하지 않는 계좌 참조는 새 오류로 센다", () => {
    const before: AppData = { ...getEmptyData(), ledger: [] };
    const after: AppData = {
      ...getEmptyData(),
      ledger: [entry({ id: "L1", kind: "expense", fromAccountId: "GHOST" })]
    };
    expect(countNewIntegrityErrors(before, after)).toBe(1);
    const summary = buildApplySummary(before, after);
    expect(summary.newIntegrityErrorCount).toBe(1);
    expect(summary.hasChanges).toBe(true);
  });

  it("오류가 오히려 줄어드는 경우(정리) 새 오류는 0 — 음수로 상쇄하지 않는다", () => {
    const before: AppData = {
      ...getEmptyData(),
      ledger: [
        entry({ id: "L1", kind: "expense", fromAccountId: "GHOST1" }),
        entry({ id: "L2", kind: "expense", fromAccountId: "GHOST2" })
      ]
    };
    const after: AppData = { ...getEmptyData(), ledger: [] };
    expect(countNewIntegrityErrors(before, after)).toBe(0);
  });
});
