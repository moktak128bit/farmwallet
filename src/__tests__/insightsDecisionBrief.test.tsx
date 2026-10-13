// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { CategoryPresets, LedgerEntry } from "../types";
import { buildInsightsDecisionBrief } from "../utils/insightsDecisionBrief";
import { InsightsDecisionBrief } from "../features/insights/InsightsDecisionBrief";
import { useInsightsData } from "../features/insights/useInsightsData";

vi.mock("../utils/date", async importOriginal => ({
  ...await importOriginal<typeof import("../utils/date")>(),
  getTodayKST: () => "2026-10-13", getThisMonthKST: () => "2026-10",
}));
afterEach(cleanup);
const entry = (date: string, amount: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `${date}-${amount}`, date, amount, kind: "expense", category: "지출", subCategory: "식비", description: "식사", ...overrides,
});
const build = (ledger: LedgerEntry[], targetMonth = "2026-10", fxRate: number | null = null) =>
  buildInsightsDecisionBrief({ ledger, targetMonth, fxRate, today: "2026-10-13" });
const history = [entry("2026-07-05", 100), entry("2026-08-05", 200), entry("2026-09-05", 300)];

describe("인사이트의 다기간 지출 비교", () => {
  it("이번 달과 과거 월의 같은 기간을 비교하고 미래 거래를 제외한다", () => {
    const result = build([...history, entry("2026-09-25", 9000), entry("2026-10-05", 400), entry("2026-10-20", 8000)]);
    expect(result.target.amount).toBe(400);
    expect(result.partialDay).toBe(13);
    expect(result.comparisons[0].amount).toBe(300);
    expect(result.comparisons[1].amount).toBe(200);
    expect(result.comparisons[1].percent).toBe(100);
    expect(result.drivers[0]).toMatchObject({ name: "식비", delta: 200, count: 1, averageCount: 1, baselineTicket: 200 });
  });
  it("과거 선택월은 월 전체를 사용하고 이후 기록이 기준에 섞이지 않는다", () => {
    const result = build([...history, entry("2026-09-25", 100), entry("2026-10-05", 99999)], "2026-09");
    expect(result.partialDay).toBeNull();
    expect(result.target.amount).toBe(400);
    expect(result.comparisons[0].amount).toBe(200);
  });
  it("없는 달은 0원으로 평균내지 않으며 수입만 기록된 달의 지출 0원은 포함한다", () => {
    const missing = build([history[0], history[2], entry("2026-10-05", 400)]);
    expect(missing.comparisons[1]).toMatchObject({ amount: null, recordedCount: 2, requiredCount: 3 });
    expect(missing.drivers).toEqual([]);
    const zero = build([history[0], entry("2026-08-25", 1000, { kind: "income", category: "수입" }), history[2], entry("2026-10-05", 400)]);
    expect(zero.comparisons[1].amount).toBeCloseTo(400 / 3);
  });
  it("12개월 평균과 전년 동월을 각각 계산한다", () => {
    const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const result = build([...months.map((month, i) => entry(`${month}-05`, (i + 1) * 100)), entry("2026-10-05", 1300)]);
    expect(result.comparisons.find(row => row.id === "average6")?.amount).toBe(950);
    expect(result.comparisons.find(row => row.id === "average12")?.amount).toBe(650);
    expect(result.comparisons.find(row => row.id === "year")?.amount).toBe(100);
  });
  it("거래 횟수와 건당 금액을 따로 보여주고 사라진 지출도 분석한다", () => {
    const result = build([...history.map(row => ({ ...row, amount: 100 })), entry("2026-10-05", 200), entry("2026-10-06", 200),
      entry("2026-07-05", 500, { subCategory: "의료비" }), entry("2026-08-05", 500, { subCategory: "의료비" }), entry("2026-09-05", 500, { subCategory: "의료비" })]);
    expect(result.drivers.find(row => row.name === "식비")).toMatchObject({ count: 2, averageCount: 1, averageTicket: 200, baselineTicket: 100, delta: 300 });
    expect(result.drivers.find(row => row.name === "식비")?.largestEntry).toMatchObject({ amount: 200, description: "식사", date: "2026-10-05" });
    expect(result.drivers.find(row => row.name === "의료비")).toMatchObject({ amount: 0, delta: -500 });
  });
  it("현행·레거시 지출을 합치고 카드대금·투자·저축을 소비에서 제외하며 USD를 환산한다", () => {
    const result = build([entry("2026-10-05", 100), entry("2026-10-06", 200, { category: "식비", subCategory: "외식" }),
      entry("2026-10-06", 10, { currency: "USD" }), entry("2026-10-06", 5000, { category: "신용결제" }),
      entry("2026-10-06", 5000, { category: "재테크" }), entry("2026-10-06", 5000, { kind: "transfer", subCategory: "투자이체" })], "2026-10", 1400);
    expect(result.target).toEqual({ amount: 14300, count: 3 });
  });
  it("환율 없는 USD를 원화 액면으로 비교하지 않는다", () => {
    expect(build([...history, entry("2026-10-05", 10, { currency: "USD" })])).toMatchObject({ missingFx: true, drivers: [] });
    const unrelated = build([...history, entry("2026-10-05", 400), entry("2020-01-05", 10, { currency: "USD" })]);
    expect(unrelated.missingFx).toBe(false);
  });
  it("과거 지출 0원의 증감률과 미래월·잘못된 날짜는 분석을 보류한다", () => {
    const result = build([entry("2026-09-25", 1000, { kind: "income" }), entry("2026-10-05", 400), entry("2026-02-30", 9999)]);
    expect(result.comparisons[0]).toMatchObject({ amount: 0, delta: 400, percent: null });
    expect(build([entry("2026-11-05", 400)], "2026-11").hasTarget).toBe(false);
  });
  it("첫 화면에서 다기간 비교와 항목별 확인 행동을 함께 보여준다", () => {
    render(<InsightsDecisionBrief ledger={[...history, entry("2026-10-05", 400)]} targetMonth="2026-10" categoryPresets={{} as CategoryPresets} fxRate={null} />);
    expect(screen.getByRole("region", { name: "지출 변화와 확인할 항목" })).toBeInTheDocument();
    expect(screen.getByText("직전 12개월 평균")).toBeInTheDocument();
    expect(screen.getByText("전년 동월")).toBeInTheDocument();
    expect(screen.getByText(/반복 결제·큰 단건·구매 횟수/)).toBeInTheDocument();
    expect(screen.getByText(/기록 3\/6개월/)).toBeInTheDocument();
    expect(screen.getByText(/동기\(1~13일\).*기간 필터/)).toBeInTheDocument();
    expect(screen.getByText(/8일간 새 기록이 없어/)).toBeInTheDocument();
  });
  it("선택한 과거 월의 세부 추세가 이후 월 때문에 바뀌지 않는다", () => {
    const ledger = [entry("2025-01-05", 100), entry("2025-02-05", 200), entry("2025-03-05", 10000)];
    const { result } = renderHook(() => useInsightsData(ledger, [], [], [], [], "2025-02", undefined, undefined, null, null, [], ledger));
    expect(result.current.subInsights[0]).toMatchObject({ mom: 100, monthAvg: 150, peak: "2월" });
    expect(result.current.subInsights[0].comment).not.toContain("연간");
  });
  it("선택월의 거래 1건만으로 월별 빈도·급여 정기성을 단정하지 않는다", () => {
    const ledger = [entry("2025-01-05", 100), entry("2025-02-05", 100), entry("2025-01-25", 3000, { kind: "income", category: "수입", subCategory: "급여" }),
      entry("2025-02-25", 3000, { kind: "income", category: "수입", subCategory: "급여" })];
    const { result } = renderHook(() => useInsightsData(ledger, [], [], [], [], "2025-02", undefined, undefined, null, null, [], ledger));
    expect(result.current.subInsights[0].comment).toContain("월평균 1건");
    expect(result.current.incSubInsights[0].comment).toContain("판단을 보류");
    expect(result.current.incSubInsights[0].comment).not.toContain("상여·수당처럼");
  });
});
