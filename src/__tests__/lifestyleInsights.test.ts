import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { buildLifestyleInsights, classifyVehicleCost, DEFAULT_LIFESTYLE_ASSUMPTIONS, parseLifestyleAssumptions } from "../utils/lifestyleInsights";

const entry = (id: string, date: string, amount: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, date, amount, kind: "expense", category: "지출", subCategory: "유류교통비", description: "", ...overrides,
});
const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const history = months.flatMap(month => [
  entry(`${month}-salary`, `${month}-25`, 3_000_000, { kind: "income", category: "수입", subCategory: "급여" }),
  entry(`${month}-fuel1`, `${month}-05`, 50_000, { detailCategory: "유류비/충전비", description: "청정에너지" }),
  entry(`${month}-fuel2`, `${month}-20`, 50_000, { detailCategory: "유류비/충전비", description: "휘발유" }),
  entry(`${month}-maintenance`, `${month}-15`, 20_000, { detailCategory: "유지보수비" }),
  entry(`${month}-parking`, `${month}-15`, 10_000, { detailCategory: "주차비" }),
  entry(`${month}-toll`, `${month}-15`, 5_000, { detailCategory: "톨비/하이패스" }),
  entry(`${month}-wash`, `${month}-15`, 5_000, { detailCategory: "세차" }),
  entry(`${month}-finance`, `${month}-15`, 300_000, { detailCategory: "자동차할부" }),
  entry(`${month}-taxi`, `${month}-15`, 30_000, { detailCategory: "택시" }),
  entry(`${month}-food`, `${month}-15`, 300_000, { subCategory: "식비", detailCategory: "외식/배달" }),
  entry(`${month}-subscription`, `${month}-15`, 20_000, { subCategory: "구독비", detailCategory: "음악" }),
]);
const annual = [entry("insurance", "2026-03-05", 600_000, { detailCategory: "자동차보험" }),
  entry("car-tax", "2026-06-05", 240_000, { detailCategory: "자동차세" }),
  entry("car-purchase", "2026-01-05", 10_000_000, { description: "중고차 구매" })];
const assumptions = { ...DEFAULT_LIFESTYLE_ASSUMPTIONS, replacementMonthly: 100_000, depreciationMonthly: 150_000 };
const build = (ledger: LedgerEntry[], overrides: Partial<Parameters<typeof buildLifestyleInsights>[0]> = {}) => buildLifestyleInsights({
  ledger, fxRate: 1400, targetMonth: "2026-10", today: "2026-10-13", assumptions, ...overrides,
});

describe("월별 생활비·차량 시나리오", () => {
  it("월중 지출을 월 비용의 대표값으로 쓰지 않고 직전 완료월을 사용한다", () => {
    const result = build([...history, entry("now", "2026-10-05", 1, { description: "주유" })]);
    expect(result.current.fuel).toBe(1);
    expect(result.completedMonth).toBe("2026-09");
    expect(result.completed.fuel).toBe(100_000);
    expect(result.completedFuelCount).toBe(2);
    expect(result.fuelAverage3).toBe(100_000);
  });
  it("완료월 기록이 없으면 이번 달이나 더 오래된 달로 대체하지 않는다", () => {
    const result = build([entry("old", "2026-08-05", 50_000, { description: "주유" }), entry("now", "2026-10-05", 40_000, { description: "주유" })]);
    expect(result.hasCompleted).toBe(false);
    expect(result.completedMonth).toBe("2026-09");
    expect(result.fuelAverage3).toBeNull();
  });
  it("과거 월 선택과 새해·월말도 완료월 대표값에 반영한다", () => {
    expect(build(history, { targetMonth: "2026-06" }).completedMonth).toBe("2026-06");
    const january = build([entry("dec", "2025-12-31", 70_000, { description: "주유" })], { targetMonth: "2026-01", today: "2026-01-01" });
    expect(january.completedMonth).toBe("2025-12");
    expect(january.completed.fuel).toBe(70_000);
    expect(build(history, { today: "2026-10-31" }).completedMonth).toBe("2026-09");
  });
  it("주유비와 모든 차량 운영비를 구분하고 할부·구입비를 절약액에서 제외한다", () => {
    const result = build([...history, ...annual, entry("now", "2026-10-05", 42_000, { description: "휘발유" })]);
    expect(result.current.fuel).toBe(42_000);
    expect(result.averages.fuel).toBe(100_000);
    expect(result.averages.vehicleOperating).toBe(210_000);
    expect(result.averages.vehicleCapital).toBeCloseTo(300_000 + 10_000_000 / 12);
    expect(result.carless).toEqual({ monthly: 110_000, annual: 1_320_000, fiveYears: 6_600_000, withDepreciationMonthly: 260_000 });
    expect(result.baselineMonths).toHaveLength(12);
  });
  it("현재 월은 월평균 분모에 넣지 않고 미래·손상 날짜를 집계하지 않는다", () => {
    const result = build([...history, entry("future", "2026-10-20", 10_000_000, { description: "주유" }), entry("invalid", "2026-02-30", 10_000_000),
      entry("today", "2026-10-13", 40_000, { description: "주유" })]);
    expect(result.current.fuel).toBe(40_000);
    expect(result.averages.fuel).toBe(100_000);
    expect(result.monthly.at(-1)).toMatchObject({ month: "2026-10", partial: true, fuel: 40_000 });
    expect(result.partialDay).toBe(13);
  });
  it("선택한 과거 월 이후 거래를 시나리오와 월별 표에 섞지 않는다", () => {
    const result = build([...history, ...annual], { targetMonth: "2026-06" });
    expect(result.current.vehicle.tax).toBe(240_000);
    expect(result.monthly.at(-1)?.month).toBe("2026-06");
    expect(result.baselineMonths).not.toContain("2026-06");
    expect(result.partialDay).toBeNull();
  });
  it("버스·택시·기차·항공·모바일 충전을 주유비로 잡지 않는다", () => {
    for (const detailCategory of ["버스/지하철", "택시", "기차", "항공", "휴대폰 충전", "기타교통"]) {
      expect(classifyVehicleCost(entry("x", "2026-10-05", 10_000, { detailCategory }))).toBeNull();
    }
    expect(classifyVehicleCost(entry("x", "2026-10-05", 10_000, { category: "식비", subCategory: "카페", description: "충전" }))).toBeNull();
  });
  it("차량 보험·세금·구입 세금과 레거시 주유 분류를 인식한다", () => {
    const cases = [["자동차보험", "insurance"], ["자동차세", "tax"], ["차량 취득세", "purchase"], ["엔진오일", "maintenance"], ["자동차리스", "finance"], ["주차", "parking"], ["세차", "wash"]];
    for (const [detailCategory, kind] of cases) expect(classifyVehicleCost(entry("x", "2026-10-05", 10_000, { detailCategory }))).toBe(kind);
    expect(classifyVehicleCost(entry("x", "2026-10-05", 10_000, { category: "유류교통비", subCategory: "주유비" }))).toBe("fuel");
    expect(classifyVehicleCost(entry("x", "2026-10-05", 10_000, { detailCategory: "주차비", description: "KTX 역 주차" }))).toBe("parking");
  });
  it("자동 분류를 제외·다른 차량 항목으로 수정하고 원본은 보존한다", () => {
    const gas = entry("gas", "2026-10-05", 40_000, { description: "주유" });
    const unknown = entry("unknown", "2026-10-05", 20_000, { subCategory: "기타", description: "A 상점" });
    const original = JSON.stringify([gas, unknown]);
    const result = build([gas, unknown], { assumptions: { ...assumptions, vehicleOverrides: { gas: "exclude", unknown: "maintenance" } } });
    expect(result.current.vehicleOperating).toBe(20_000);
    expect(result.current.fuel).toBe(0);
    expect(JSON.stringify([gas, unknown])).toBe(original);
  });
  it("대체 교통비 미입력·명시 0·차량비보다 높은 비용을 구분한다", () => {
    expect(build(history, { assumptions: { ...assumptions, replacementMonthly: null } }).carless.monthly).toBeNull();
    expect(build(history, { assumptions: { ...assumptions, replacementMonthly: 0 } }).carless.monthly).toBe(140_000);
    expect(build(history, { assumptions: { ...assumptions, replacementMonthly: 200_000, depreciationMonthly: null } }).carless).toMatchObject({ monthly: -60_000, annual: -720_000, withDepreciationMonthly: null });
  });
  it("기록이 없는 달은 평균에서 빼고 수입만 기록한 달은 지출 0원을 포함한다", () => {
    const result = build([entry("salary", "2026-08-25", 3_000_000, { kind: "income", category: "수입", subCategory: "급여" }),
      entry("gas", "2026-09-05", 100_000, { description: "주유" })]);
    expect(result.baselineMonths).toHaveLength(2);
    expect(result.averages.fuel).toBe(50_000);
    expect(result.monthly.find(row => row.month === "2026-07")?.recorded).toBe(false);
    expect(result.monthly.find(row => row.month === "2026-08")?.expense).toBe(0);
  });
  it("월 투자 계획은 근로소득에서 지출을 빼고 일시성 입금과 카드결제 중복을 제외한다", () => {
    const result = build([...months.map(month => entry(`${month}-income`, `${month}-25`, 3_000_000, { kind: "income", category: "수입", subCategory: "급여" })),
      ...months.map(month => entry(`${month}-expense`, `${month}-10`, 1_200_000, { subCategory: "식비" })),
      entry("settlement", "2026-09-15", 100_000_000, { kind: "income", category: "수입", subCategory: "정산" }),
      entry("old-card", "2026-09-15", 9_000_000, { category: "신용결제", subCategory: undefined }),
      entry("savings", "2026-09-15", 9_000_000, { category: "재테크", subCategory: undefined })]);
    expect(result.averageIncome).toBe(3_000_000);
    expect(result.averageExpense).toBe(1_200_000);
    expect(result.afterPlannedInvestment).toBe(-200_000);
    expect(result.monthly.find(row => row.month === "2026-09")?.investmentTransfers).toBe(9_000_000);
  });
  it("USD 지출을 환산하고 환율 부재는 원화 액면으로 처리하지 않는다", () => {
    const data = [entry("usd", "2026-09-05", 10, { currency: "USD", description: "주유" })];
    expect(build(data).averages.fuel).toBe(14_000);
    expect(build(data, { fxRate: null })).toMatchObject({ missingFx: true, averageExpense: null, carless: { monthly: null } });
    expect(build([...history, entry("old-usd", "2020-01-05", 10, { currency: "USD" })], { fxRate: null }).missingFx).toBe(false);
  });
  it("구독 평균·카테고리 감축 가정·비정기 준비금은 같은 기준월을 사용한다", () => {
    const result = build([...history, ...annual]);
    expect(result.subscriptions[0]).toMatchObject({ name: "음악", activeMonths: 12, monthlyAverage: 20_000 });
    expect(result.categories.find(row => row.name === "식비")?.reductionMonthly).toBe(30_000);
    expect(result.detailCategories.find(row => row.name === "식비 / 외식/배달")?.reductionMonthly).toBe(30_000);
    expect(result.occasional.find(row => row.name.includes("자동차보험"))).toMatchObject({ activeMonths: 1, amount: 600_000, monthlyReserve: 50_000 });
    expect(result.occasional.find(row => row.name.includes("음악"))).toBeUndefined();
  });
  it("비교 기록이 없으면 시나리오를 0원 절약이라고 표시하지 않는다", () => {
    const result = build([]);
    expect(result.hasCurrent).toBe(false);
    expect(result.averageExpense).toBeNull();
    expect(result.carless.monthly).toBeNull();
    expect(result.afterPlannedInvestment).toBeNull();
    expect(build(history.filter(row => row.kind !== "income")).afterPlannedInvestment).toBeNull();
  });
  it("평가액으로 투자 집중도를 계산하며 0·비정상 평가액은 제외한다", () => {
    const result = build([], { holdings: [{ name: "A", valueKRW: 16_000_000, costKRW: 20_000_000 }, { name: "B", valueKRW: 4_000_000, costKRW: 3_000_000 },
      { name: "zero", valueKRW: 0, costKRW: 0 }, { name: "bad", valueKRW: NaN, costKRW: 0 }] });
    expect(result.investmentValue).toBe(20_000_000);
    expect(result.holdings[0].share).toBe(80);
  });
  it("오래된 기록과 미입력 기간을 표시한다", () => {
    const result = build([entry("gas", "2026-10-05", 40_000, { description: "주유" })]);
    expect(result.latestRecord).toBe("2026-10-05");
    expect(result.daysSinceLastRecord).toBe(8);
    const futureTarget = build([...history, entry("partial", "2026-10-05", 10_000, { description: "주유" })], { targetMonth: "2026-11" });
    expect(futureTarget.baselineMonths).not.toContain("2026-10");
  });
});

describe("생활 시나리오 가정 복원", () => {
  it("빈칸과 명시적 0을 구분한다", () => {
    expect(parseLifestyleAssumptions(null).replacementMonthly).toBeNull();
    expect(parseLifestyleAssumptions('{"replacementMonthly":0,"plannedInvestmentMonthly":0}')).toMatchObject({ replacementMonthly: 0, plannedInvestmentMonthly: 0 });
  });
  it("손상 JSON·배열·잘못된 타입·음수·과도한 금액을 안전하게 거른다", () => {
    for (const raw of ["broken", "null", "[]", '"string"']) expect(parseLifestyleAssumptions(raw)).toEqual(DEFAULT_LIFESTYLE_ASSUMPTIONS);
    expect(parseLifestyleAssumptions('{"replacementMonthly":-1,"depreciationMonthly":"100","plannedInvestmentMonthly":1e20,"reductionPct":120}'))
      .toMatchObject({ replacementMonthly: null, depreciationMonthly: null, plannedInvestmentMonthly: 2_000_000, reductionPct: 100 });
  });
  it("알 수 없는 차량 분류와 객체를 제거한다", () => {
    expect(parseLifestyleAssumptions('{"vehicleOverrides":{"a":"fuel","b":"exclude","c":"invalid","d":{}}}').vehicleOverrides).toEqual({ a: "fuel", b: "exclude" });
  });
});
