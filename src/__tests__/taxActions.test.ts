/** 4-2 절세 액션 카드 — buildTaxActions 순수 로직 (우선순위·임계 경계·연말 D-day·null 입력) */
import { describe, expect, it } from "vitest";
import { buildTaxActions, type ComprehensiveTaxTrackerResult, type ForeignCapitalGainsTaxResult, type ShelterContributionsResult } from "../utils/taxActions";

function tracker(overrides: Partial<ComprehensiveTaxTrackerResult> = {}): ComprehensiveTaxTrackerResult {
  return {
    year: 2026,
    ytdGross: 5_000_000,
    dividendGross: 3_000_000,
    interestGross: 2_000_000,
    threshold: 20_000_000,
    remainingToThreshold: 15_000_000,
    exceeded: false,
    pctOfThreshold: 0.25,
    projectedYearEndGross: 8_000_000,
    projectedThresholdDate: null,
    grossUpApplied: false,
    netTotal: 5_000_000,
    grossTotal: 5_000_000,
    excludedKRW: 0,
    projectionBasis: "linear",
    ...overrides
  };
}

function foreignTax(overrides: Partial<ForeignCapitalGainsTaxResult> = {}): ForeignCapitalGainsTaxResult {
  return {
    year: 2026,
    realizedGainKRW: 0,
    deduction: 2_500_000,
    taxableGain: 0,
    estimatedTax: 0,
    deductionRemaining: 2_500_000,
    harvestCandidates: [],
    harvestableLossKRW: 0,
    taxSavingIfHarvestAll: 0,
    ...overrides
  };
}

function shelter(overrides: Partial<ShelterContributionsResult> = {}): ShelterContributionsResult {
  return {
    year: 2026,
    hasShelterAccounts: true,
    isa: { accountCount: 1, paid: 0, annualLimit: 20_000_000, limitLeft: 20_000_000 },
    pension: {
      accountCount: 1,
      paidPension: 0,
      paidIrp: 0,
      paidTotal: 0,
      annualLimit: 18_000_000,
      limitLeft: 18_000_000,
      creditable: 0,
      creditableLeft: 9_000_000,
      creditRate: 0.132,
      estCredit: 0
    },
    excluded: { exchange: 0, internal: 0, reinvest: 0 },
    ...overrides
  };
}

describe("buildTaxActions", () => {
  it("null 입력(foreignTax·shelter 없음) — 종합과세 액션만 성립(B1만으로도)", () => {
    const actions = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-03-01" });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("comprehensiveThreshold");
    expect(actions[0].targetTab).toBe("dividends");
  });

  it("종합과세 임계 근접(70~90%)은 medium, 90%+는 high", () => {
    const near90 = buildTaxActions({
      tracker: tracker({ ytdGross: 19_000_000, remainingToThreshold: 1_000_000, pctOfThreshold: 0.95 }),
      foreignTax: null,
      shelter: null,
      today: "2026-03-01"
    })[0];
    expect(near90.severity).toBe("high");

    const near70 = buildTaxActions({
      tracker: tracker({ ytdGross: 15_000_000, remainingToThreshold: 5_000_000, pctOfThreshold: 0.75 }),
      foreignTax: null,
      shelter: null,
      today: "2026-03-01"
    })[0];
    expect(near70.severity).toBe("medium");

    const low = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-03-01" })[0];
    expect(low.severity).toBe("low");
  });

  it("종합과세 임계 초과 시 high + 초과액 표시", () => {
    const t = tracker({ ytdGross: 22_000_000, exceeded: true, remainingToThreshold: 0, pctOfThreshold: 1.1 });
    const [action] = buildTaxActions({ tracker: t, foreignTax: null, shelter: null, today: "2026-03-01" });
    expect(action.severity).toBe("high");
    expect(action.amountKRW).toBe(2_000_000);
    expect(action.title).toContain("초과");
  });

  it("예상 도달일이 있으면 제목에 포함", () => {
    const t = tracker({ projectedThresholdDate: "2026-09-15" });
    const [action] = buildTaxActions({ tracker: t, foreignTax: null, shelter: null, today: "2026-03-01" });
    expect(action.title).toContain("2026-09-15");
    expect(action.deadline).toBe("2026-09-15");
  });

  it("해외주식 비과세 여유(taxableGain<=0) — foreignTaxRoom 액션", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: foreignTax({ taxableGain: 0, deductionRemaining: 1_200_000 }),
      shelter: null,
      today: "2026-03-01"
    });
    const a = actions.find((x) => x.kind === "foreignTaxRoom");
    expect(a).toBeDefined();
    expect(a?.amountKRW).toBe(1_200_000);
    expect(a?.targetTab).toBe("stocks");
    expect(actions.find((x) => x.kind === "foreignTaxHarvest")).toBeUndefined();
  });

  it("해외주식 손실수확 후보가 있으면 foreignTaxHarvest 액션 (종목 수 포함)", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: foreignTax({
        taxableGain: 1_000_000,
        deductionRemaining: 0,
        harvestCandidates: [
          { ticker: "TSLA", name: "테슬라", accountName: "증권", unrealizedLossKRW: 500_000 },
          { ticker: "NVDA", name: "엔비디아", accountName: "증권", unrealizedLossKRW: 300_000 }
        ],
        harvestableLossKRW: 800_000,
        taxSavingIfHarvestAll: 176_000
      }),
      shelter: null,
      today: "2026-03-01"
    });
    const a = actions.find((x) => x.kind === "foreignTaxHarvest");
    expect(a).toBeDefined();
    expect(a?.amountKRW).toBe(176_000);
    expect(a?.title).toContain("2종목");
  });

  it("절세 여지가 없으면(과세표준>0, 후보 없음) foreignTax 액션 생략", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: foreignTax({ taxableGain: 1_000_000, deductionRemaining: 0, harvestCandidates: [], taxSavingIfHarvestAll: 0 }),
      shelter: null,
      today: "2026-03-01"
    });
    expect(actions.find((x) => x.kind === "foreignTaxRoom" || x.kind === "foreignTaxHarvest")).toBeUndefined();
  });

  it("절세계좌 지정 없음(hasShelterAccounts=false) — shelterLimit 생략", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: null,
      shelter: shelter({ hasShelterAccounts: false }),
      today: "2026-03-01"
    });
    expect(actions.find((x) => x.kind === "shelterLimit")).toBeUndefined();
  });

  it("한도 소진(둘 다 0)이면 shelterLimit 생략", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: null,
      shelter: shelter({
        isa: { accountCount: 1, paid: 20_000_000, annualLimit: 20_000_000, limitLeft: 0 },
        pension: {
          accountCount: 1, paidPension: 6_000_000, paidIrp: 12_000_000, paidTotal: 18_000_000,
          annualLimit: 18_000_000, limitLeft: 0, creditable: 9_000_000, creditableLeft: 0, creditRate: 0.132, estCredit: 1_188_000
        }
      }),
      today: "2026-03-01"
    });
    expect(actions.find((x) => x.kind === "shelterLimit")).toBeUndefined();
  });

  it("절세계좌 한도 여유 — shelterLimit 액션 (한도합·세액공제 예상 표시)", () => {
    const actions = buildTaxActions({
      tracker: tracker(),
      foreignTax: null,
      shelter: shelter({
        isa: { accountCount: 1, paid: 5_000_000, annualLimit: 20_000_000, limitLeft: 15_000_000 },
        pension: {
          accountCount: 1, paidPension: 2_000_000, paidIrp: 0, paidTotal: 2_000_000,
          annualLimit: 18_000_000, limitLeft: 16_000_000, creditable: 2_000_000, creditableLeft: 7_000_000, creditRate: 0.132, estCredit: 264_000
        }
      }),
      today: "2026-03-01"
    });
    const a = actions.find((x) => x.kind === "shelterLimit");
    expect(a).toBeDefined();
    expect(a?.amountKRW).toBe(31_000_000);
    expect(a?.title).toContain("264,000");
  });

  it("연말 D-day — 9월엔 생략, 10월부터 등장하고 날짜가 가까울수록 심각도가 오른다", () => {
    const sep = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-09-30" });
    expect(sep.find((x) => x.kind === "yearEnd")).toBeUndefined();

    const oct = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-10-01" });
    const octAction = oct.find((x) => x.kind === "yearEnd");
    expect(octAction).toBeDefined();
    expect(octAction?.deadline).toBe("2026-12-31");
    expect(octAction?.severity).toBe("low");
    expect(octAction?.title).toContain("D-91");

    const dec01 = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-12-01" });
    const dec01Action = dec01.find((x) => x.kind === "yearEnd");
    expect(dec01Action?.severity).toBe("medium");
    expect(dec01Action?.title).toContain("D-30");

    const dec20 = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-12-20" });
    const dec20Action = dec20.find((x) => x.kind === "yearEnd");
    expect(dec20Action?.severity).toBe("high");
    expect(dec20Action?.title).toContain("D-11");

    const dec31 = buildTaxActions({ tracker: tracker(), foreignTax: null, shelter: null, today: "2026-12-31" });
    const dec31Action = dec31.find((x) => x.kind === "yearEnd");
    expect(dec31Action?.severity).toBe("high");
    expect(dec31Action?.title).toContain("D-0");
  });

  it("Q4엔 절세 기회 액션의 심각도가 한 단계 오른다(연내에만 가능해서)", () => {
    const q1 = buildTaxActions({
      tracker: tracker(),
      foreignTax: foreignTax({ taxableGain: 0, deductionRemaining: 1_000_000 }),
      shelter: null,
      today: "2026-03-01"
    });
    expect(q1.find((x) => x.kind === "foreignTaxRoom")?.severity).toBe("low");

    const q4 = buildTaxActions({
      tracker: tracker(),
      foreignTax: foreignTax({ taxableGain: 0, deductionRemaining: 1_000_000 }),
      shelter: null,
      today: "2026-11-01"
    });
    expect(q4.find((x) => x.kind === "foreignTaxRoom")?.severity).toBe("medium");
  });

  it("우선순위 정렬 — severity(high→low) 순, 동급 안에서는 계산 순서 유지", () => {
    const actions = buildTaxActions({
      tracker: tracker({ ytdGross: 19_500_000, remainingToThreshold: 500_000, pctOfThreshold: 0.975 }), // high
      foreignTax: foreignTax({ taxableGain: 0, deductionRemaining: 1_000_000 }), // low(Q1)
      shelter: shelter(), // low(Q1, limitLeft>0)
      today: "2026-03-01"
    });
    expect(actions.map((a) => a.kind)).toEqual(["comprehensiveThreshold", "foreignTaxRoom", "shelterLimit"]);
    expect(actions.map((a) => a.severity)).toEqual(["high", "low", "low"]);
  });
});
