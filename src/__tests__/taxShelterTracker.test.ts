/** 4-1·4-6 — 종합과세 트래커/연간 요약의 절세계좌 제외(excludeAccountIds) + 선행배당 연말 투영(forwardMonths) */
import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import type { ForwardDividendMonth } from "../utils/forwardDividends";
import { buildComprehensiveTaxTracker, summarizeTaxYear, COMPREHENSIVE_TAX_THRESHOLD } from "../utils/taxCalculator";

const mk = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-03-01",
  kind: "income",
  category: "배당",
  description: "t",
  amount: 0,
  toAccountId: "GEN",
  ...over,
});

const fm = (month: string, amountKRW: number): ForwardDividendMonth => ({ month, amountKRW });

describe("excludeAccountIds — 절세계좌 수령분 제외", () => {
  const ledger = [
    mk({ category: "배당", amount: 5_000_000, toAccountId: "GEN" }),
    mk({ category: "배당", amount: 4_000_000, toAccountId: "ISA" }),
    mk({ category: "이자", amount: 1_000_000, toAccountId: "PEN" }),
    mk({ category: "이자", amount: 2_000_000, toAccountId: "GEN" }),
    mk({ category: "이자", amount: 300_000, toAccountId: undefined }), // 계좌 미상 → 합산 유지
  ];

  it("tracker: Set·배열 모두 허용, 제외분은 excludedKRW로, 빈 집합은 미지정과 동일", () => {
    const base = buildComprehensiveTaxTracker(ledger, "2026-07-01");
    expect(base.ytdGross).toBe(12_300_000);
    expect(base.excludedKRW).toBe(0);
    expect(base.projectionBasis).toBe("linear");

    const r = buildComprehensiveTaxTracker(ledger, "2026-07-01", null, { excludeAccountIds: new Set(["ISA", "PEN"]) });
    expect(r.dividendGross).toBe(5_000_000);
    expect(r.interestGross).toBe(2_300_000);
    expect(r.ytdGross).toBe(7_300_000);
    expect(r.netTotal).toBe(7_300_000);
    expect(r.excludedKRW).toBe(5_000_000);

    const arr = buildComprehensiveTaxTracker(ledger, "2026-07-01", null, { excludeAccountIds: ["ISA", "PEN"] });
    expect(arr.ytdGross).toBe(7_300_000);
    const empty = buildComprehensiveTaxTracker(ledger, "2026-07-01", null, { excludeAccountIds: [] });
    expect(empty.ytdGross).toBe(base.ytdGross);
  });

  it("summarizeTaxYear: 같은 규칙, 연도 전체", () => {
    const r = summarizeTaxYear(ledger, 2026, null, { excludeAccountIds: ["ISA"] });
    expect(r.dividendGross).toBe(5_000_000);
    expect(r.interestGross).toBe(3_300_000);
    expect(r.excludedKRW).toBe(4_000_000);
    expect(summarizeTaxYear(ledger, 2026).excludedKRW).toBe(0);
  });

  it("grossUp과 결합 — 제외분도 세전 환산 금액으로 기록", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "배당", amount: 846, toAccountId: "ISA" }), mk({ category: "배당", amount: 850, currency: "USD", toAccountId: "ISA" })],
      "2026-07-01",
      1_000,
      { grossUp: true, excludeAccountIds: ["ISA"] }
    );
    expect(r.ytdGross).toBe(0);
    expect(r.excludedKRW).toBeCloseTo(846 / (1 - 0.154) + 850_000 / (1 - 0.15), 6);
  });

  it("제외로 임계 미만이 되면 exceeded=false (기존 과대 경고 해소)", () => {
    const led = [mk({ amount: 15_000_000, toAccountId: "ISA" }), mk({ amount: 8_000_000, toAccountId: "GEN" })];
    expect(buildComprehensiveTaxTracker(led, "2026-07-01").exceeded).toBe(true);
    const r = buildComprehensiveTaxTracker(led, "2026-07-01", null, { excludeAccountIds: ["ISA"] });
    expect(r.exceeded).toBe(false);
    expect(r.remainingToThreshold).toBe(12_000_000);
  });
});

describe("forwardMonths — 선행배당 기반 연말 투영 (4-6)", () => {
  it("옵션 없으면 선형 페이스 그대로 (projectionBasis=linear)", () => {
    const r = buildComprehensiveTaxTracker([mk({ date: "2026-06-30", amount: 11_000_000 })], "2026-07-02");
    expect(r.projectionBasis).toBe("linear");
    expect(r.projectedYearEndGross).toBeCloseTo((11_000_000 / 183) * 365, 3);
  });

  it("분기배당: 연말 예상 = YTD + 남은 달 예상 배당, 도달 예상 = 누적이 임계를 넘는 첫 달 말일", () => {
    const forward = [
      fm("2026-08", 0),
      fm("2026-09", 5_000_000),
      fm("2026-10", 0),
      fm("2026-11", 0),
      fm("2026-12", 8_000_000),
      fm("2027-01", 0),
      fm("2027-03", 99_000_000), // 내년 → 무시
    ];
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-03-15", amount: 4_000_000 }), mk({ date: "2026-06-15", amount: 4_000_000 })],
      "2026-07-02",
      null,
      { forwardMonths: forward }
    );
    expect(r.projectionBasis).toBe("forward");
    expect(r.ytdGross).toBe(8_000_000);
    expect(r.projectedYearEndGross).toBeCloseTo(21_000_000, 3);
    expect(r.projectedThresholdDate).toBe("2026-12-31"); // 9월 말 13M, 12월 말 21M > 20M
  });

  it("이번 달(YYYY-MM) 항목은 제외, 정렬 안 된 입력도 달 순서로 누적", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-03-15", amount: 10_000_000 })],
      "2026-07-02",
      null,
      { forwardMonths: [fm("2026-09", 6_000_000), fm("2026-07", 50_000_000), fm("2026-08", 6_000_000)] }
    );
    expect(r.projectedYearEndGross).toBeCloseTo(22_000_000, 3);
    expect(r.projectedThresholdDate).toBe("2026-09-30"); // 8월 말 16M, 9월 말 22M
  });

  it("연말 경계: 12월엔 남은 달이 없어 연말 예상=YTD(+이자 페이스), 임계 미만이면 도달일 null", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-11-15", amount: 3_000_000 })],
      "2026-12-15",
      null,
      { forwardMonths: [fm("2027-01", 30_000_000), fm("2027-02", 30_000_000)] }
    );
    expect(r.projectionBasis).toBe("forward");
    expect(r.projectedYearEndGross).toBe(3_000_000);
    expect(r.projectedThresholdDate).toBeNull();
  });

  it("이미 초과면 도달 예상일 null, 연말 예상은 YTD+남은 달", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-02-01", amount: 25_000_000 })],
      "2026-07-01",
      null,
      { forwardMonths: [fm("2026-09", 1_000_000)] }
    );
    expect(r.exceeded).toBe(true);
    expect(r.projectedThresholdDate).toBeNull();
    expect(r.projectedYearEndGross).toBe(26_000_000);
  });

  it("이자는 기존 일 페이스로 잔여 일수만큼 가산, 달 말일 체크에도 이자 누적 반영", () => {
    // 2026-07-02 = 183일차, 이자 YTD 1,830,000 → 일 10,000. 배당 YTD 0, 9월 말(273일차)까지 이자 +900,000
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "이자", date: "2026-06-30", amount: 1_830_000 })],
      "2026-07-02",
      null,
      { forwardMonths: [fm("2026-09", 18_000_000)] }
    );
    expect(r.projectedYearEndGross).toBeCloseTo(1_830_000 + 18_000_000 + 10_000 * (365 - 183), 3);
    // 9월 말 누적 = 1.83M + 18M + 0.9M = 20.73M > 20M
    expect(r.projectedThresholdDate).toBe("2026-09-30");
  });

  it("이자 페이스만으로 연말에 넘는 경우(남은 달 배당 0) — 12-31로 안내", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "이자", date: "2026-06-30", amount: 11_000_000 })],
      "2026-07-02",
      null,
      { forwardMonths: [] }
    );
    expect(r.projectedYearEndGross).toBeGreaterThan(COMPREHENSIVE_TAX_THRESHOLD);
    expect(r.projectedThresholdDate).toBe("2026-12-31");
  });

  it("grossUp이면 선행 월 예상(세후 입금 기준)을 YTD 배당의 세전/세후 비율로 같이 역산", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-03-01", amount: 846_000 })],
      "2026-07-02",
      null,
      { grossUp: true, forwardMonths: [fm("2026-09", 846_000)] }
    );
    // 국내 배당 ÷(1−0.154) → 1,000,000 씩
    expect(r.ytdGross).toBeCloseTo(1_000_000, 3);
    expect(r.projectedYearEndGross).toBeCloseTo(2_000_000, 3);
  });

  it("forwardMonths + excludeAccountIds 동시 — YTD는 제외 후, 투영은 그대로 가산", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ date: "2026-03-01", amount: 5_000_000, toAccountId: "ISA" }), mk({ date: "2026-03-01", amount: 1_000_000 })],
      "2026-07-02",
      null,
      { excludeAccountIds: ["ISA"], forwardMonths: [fm("2026-10", 2_000_000)] }
    );
    expect(r.ytdGross).toBe(1_000_000);
    expect(r.excludedKRW).toBe(5_000_000);
    expect(r.projectedYearEndGross).toBe(3_000_000);
  });
});
