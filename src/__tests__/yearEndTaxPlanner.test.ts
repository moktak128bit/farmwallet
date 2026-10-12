import { describe, expect, it } from "vitest";
import type { Account, LedgerEntry } from "../types";
import { buildYearEndTaxPlanner, type YearEndTaxPlannerInputs } from "../utils/yearEndTaxPlanner";
import { buildYearEndTaxHelper, calculateYearEndCardSpend } from "../utils/yearEndTaxHelper";

const accounts: Account[] = [
  { id: "bank", name: "은행", institution: "", type: "checking", initialBalance: 0 },
  { id: "pension", name: "연금저축", institution: "", type: "securities", initialBalance: 0, taxShelter: "pension" },
  { id: "irp", name: "IRP", institution: "", type: "securities", initialBalance: 0, taxShelter: "irp" },
];
const base: YearEndTaxPlannerInputs = { grossSalary: 50_000_000, creditSpend: 10_000_000, checkCashSpend: 5_000_000 };
const run = (
  inputs: Partial<YearEndTaxPlannerInputs> = {},
  ledger: LedgerEntry[] = [],
  year = 2026,
  today = "2026-10-12",
) => buildYearEndTaxPlanner(ledger, accounts, year, { ...base, ...inputs }, { today });
const transfer = (
  id: string,
  date: string,
  toAccountId: string,
  amount: number,
  fromAccountId = "bank",
): LedgerEntry => ({
  id,
  date,
  toAccountId,
  amount,
  fromAccountId,
  kind: "transfer",
  category: "이체",
  subCategory: "투자이체",
  description: "",
});

describe("연금 추가 납입 계획", () => {
  it("연금저축 300만 납입 → 연금저축 300만 + IRP 300만, 99만원 추가 공제", () => {
    const p = run({ paidPension: 3_000_000 }).pension;
    expect(p.addPension).toBe(3_000_000);
    expect(p.addIrp).toBe(3_000_000);
    expect(p.additionalCredit).toBe(990_000);
    expect(p.monthlyContribution).toBe(2_000_000);
  });
  it("총급여 5500만 경계에서 지방세 포함 공제율 변경", () => {
    expect(run({ grossSalary: 55_000_000 }).pension.creditRate).toBe(0.165);
    expect(run({ grossSalary: 55_000_001 }).pension.creditRate).toBe(0.132);
    expect(run({ grossSalary: null }).pension.additionalCredit).toBeNull();
  });
  it("IRP를 이미 800만 넣었으면 연금저축 추가는 100만까지", () => {
    const p = run({ paidIrp: 8_000_000 }).pension;
    expect(p.addPension).toBe(1_000_000);
    expect(p.addIrp).toBe(0);
  });
  it("연금저축 단독 800만이어도 공제는 600만, 나머지는 IRP로", () => {
    const p = run({ paidPension: 8_000_000 }).pension;
    expect(p.creditable).toBe(6_000_000);
    expect(p.addPension).toBe(0);
    expect(p.addIrp).toBe(3_000_000);
  });
  it("공제 잔여가 있어도 합산 납입한도 1800만은 넘지 않는다", () => {
    const p = run({ paidPension: 17_000_000 }).pension;
    expect(p.creditRoom).toBe(1_000_000);
    expect(p.addIrp).toBe(1_000_000);
    expect(run({ paidPension: 18_000_000 }).pension.contribution).toBe(0);
  });
  it("여유자금 내에서만 배분하고 명시적인 0원을 보존", () => {
    const p = run({ paidPension: 5_000_000, pensionBudget: 2_000_000 }).pension;
    expect(p.addPension).toBe(1_000_000);
    expect(p.addIrp).toBe(1_000_000);
    expect(run({ pensionBudget: 0 }).pension.contribution).toBe(0);
    expect(run({ pensionBudget: 10_000_000 }).pension.unallocatedBudget).toBe(1_000_000);
  });
  it("오늘 이후 납입·내부 이체 제외, 사용자 입력 0원은 기록을 대체", () => {
    const ledger = [
      transfer("1", "2026-01-10", "pension", 2_000_000),
      transfer("2", "2026-12-01", "pension", 3_000_000),
      transfer("3", "2026-02-01", "irp", 1_000_000, "pension"),
    ];
    expect(run({}, ledger).pension.paidPension).toBe(2_000_000);
    expect(run({}, ledger).pension.paidIrp).toBe(0);
    expect(run({ paidPension: 0 }, ledger).pension.paidPension).toBe(0);
  });
  it("지난 귀속연도·미래연도에는 신규 납입을 추천하지 않는다", () => {
    expect(run({}, [], 2026, "2027-01-01").pension.contribution).toBe(0);
    expect(run({}, [], 2026, "2025-12-31").canContribute).toBe(false);
    expect(run({}, [], 2025).supported).toBe(false);
    expect(run({}, [], 2026, "2026-12-31").monthsLeft).toBe(1);
  });
});

describe("카드 일반 사용분 비교", () => {
  it("문턱 전 예정 지출은 문턱 초과분만 공제", () => {
    const c = run({ creditSpend: 10_000_000, checkCashSpend: 0, plannedSpend: 3_000_000, marginalRate: 0.15 }).card;
    expect(c.toThreshold).toBe(2_500_000);
    expect(c.creditScenario.deductionGain).toBe(75_000);
    expect(c.checkScenario.deductionGain).toBe(150_000);
    expect(c.checkScenario.taxSaving).toBeCloseTo(24_750);
    expect(c.spendToCapCheck).toBe(12_500_000);
    expect(c.spendToCapCredit).toBe(22_500_000);
  });
  it("혼합 사용에서 신용 추가 결제로 기존 체크분의 문턱도 다시 계산", () => {
    const c = run({ plannedSpend: 3_000_000 }).card;
    expect(c.estimatedDeduction).toBe(750_000);
    expect(c.creditScenario.deductionGain).toBe(825_000);
    expect(c.checkScenario.deductionGain).toBe(900_000);
    expect(c.creditScenario.taxSaving).toBeNull();
    expect(c.spendToCapCredit).toBe(12_500_000);
    expect(c.spendToCapCheck).toBe(7_500_000);
  });
  it("기본한도를 넘는 예정 지출의 공제 증가액은 잔여 한도로 제한", () => {
    const c = run({ plannedSpend: 100_000_000 }).card;
    expect(c.checkScenario.deductionGain).toBe(2_250_000);
    expect(run({ creditSpend: 40_000_000 }).card.spendToCapCheck).toBe(0);
    expect(run({ creditSpend: 40_000_000, plannedSpend: 1_000_000 }).card.creditScenario.deductionGain).toBe(0);
  });
  it("총급여 미확정·잘못된 세율에는 절세액을 만들어내지 않는다", () => {
    expect(run({ grossSalary: null }).card.spendToCapCheck).toBeNull();
    expect(run({ grossSalary: null, marginalRate: 0.15 }).card.checkScenario.taxSaving).toBeNull();
    expect(run({ marginalRate: 0.165 }).card.creditScenario.taxSaving).toBeNull();
    expect(run({ marginalRate: 0, plannedSpend: 1_000_000 }).card.creditScenario.taxSaving).toBe(0);
    expect(run({ paidPension: NaN, paidIrp: -100, plannedSpend: Infinity }).pension.paidPension).toBe(0);
  });
  it("2026년 자녀 증액: 7천만 이하 50만/명, 초과 25만/명, 2명까지", () => {
    expect(calculateYearEndCardSpend(70_000_000, 0, 0, 0, 2).deductionCap).toBe(4_000_000);
    expect(calculateYearEndCardSpend(70_000_001, 0, 0, 0, 1).deductionCap).toBe(2_750_000);
    expect(calculateYearEndCardSpend(80_000_000, 0, 0, 0, 5).deductionCap).toBe(3_000_000);
    expect(calculateYearEndCardSpend(50_000_000, 0, 0, 0, 2, 2025).deductionCap).toBe(3_000_000);
  });
  it("미래 지출을 실제 사용액에 넣지 않는다", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "f",
        date: "2026-12-01",
        kind: "expense",
        category: "지출",
        subCategory: "식비",
        fromAccountId: "bank",
        amount: 1_000_000,
        description: "",
      },
    ];
    expect(
      buildYearEndTaxHelper(ledger, accounts, 2026, { today: "2026-10-12", grossSalary: 50_000_000 }).cardSpend.total,
    ).toBe(0);
  });
});
