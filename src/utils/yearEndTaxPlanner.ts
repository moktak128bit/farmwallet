import type { Account, LedgerEntry } from "../types";
import { getTodayKST } from "./date";
import { buildShelterContributions, TAX_SHELTER_RULES_2026 } from "./taxShelter";
import { calculateYearEndCardSpend } from "./yearEndTaxHelper";

export interface YearEndTaxPlannerInputs {
  grossSalary: number | null;
  creditSpend: number;
  checkCashSpend: number;
  eligibleChildren?: number;
  paidPension?: number;
  paidIrp?: number;
  /** 미입력은 공제 한도까지, 0은 추가 납입하지 않는 계획 */
  pensionBudget?: number;
  plannedSpend?: number;
  /** 사용자가 선택한 소득세 한계세율. 총급여에서 추정하지 않는다. */
  marginalRate?: number;
}

export type YearEndTaxPlannerSettings = Partial<Omit<YearEndTaxPlannerInputs, "grossSalary">>;

const amount = (n: number | undefined) => (n != null && Number.isFinite(n) ? Math.max(0, n) : 0);
const MARGINAL_RATES = [0, 0.06, 0.15, 0.24, 0.35, 0.38, 0.4, 0.42, 0.45];

/** 추가 납입·결제수단 비교. 일반 사용분만 지원하며 소득공제와 세액공제를 합산하지 않는다. */
export function buildYearEndTaxPlanner(
  ledger: LedgerEntry[],
  accounts: Account[],
  year: number,
  inputs: YearEndTaxPlannerInputs,
  options: { today?: string; fxRate?: number | null } = {},
) {
  const today = options.today ?? getTodayKST();
  const yearNow = Number(today.slice(0, 4));
  const supported = year === TAX_SHELTER_RULES_2026.baseYear;
  const canContribute = supported && year === yearNow;
  const salary = amount(inputs.grossSalary ?? undefined);
  const salaryKnown = salary > 0;
  // 예정된 납입·지출을 이미 실행한 누계로 세지 않는다.
  const recorded = buildShelterContributions(
    ledger.filter((e) => e.date <= today),
    accounts,
    year,
    options.fxRate,
  );
  const paidPension = amount(inputs.paidPension ?? recorded.pension.paidPension);
  const paidIrp = amount(inputs.paidIrp ?? recorded.pension.paidIrp);
  const pr = TAX_SHELTER_RULES_2026.pensionAccount;
  const creditable = Math.min(pr.combinedCreditCap, Math.min(pr.pensionCreditCap, paidPension) + paidIrp);
  const annualRoom = Math.max(0, pr.annualLimit - paidPension - paidIrp);
  const creditRoom = Math.min(annualRoom, Math.max(0, pr.combinedCreditCap - creditable));
  const pensionRoom = Math.min(creditRoom, Math.max(0, pr.pensionCreditCap - paidPension));
  const irpRoomAfterPension = creditRoom - pensionRoom;
  const budget = inputs.pensionBudget == null ? creditRoom : amount(inputs.pensionBudget);
  const contribution = canContribute ? Math.min(budget, creditRoom) : 0;
  const addPension = Math.min(contribution, pensionRoom);
  const addIrp = contribution - addPension;
  const creditRate = salaryKnown
    ? salary <= 55_000_000
      ? TAX_SHELTER_RULES_2026.creditRates.low
      : TAX_SHELTER_RULES_2026.creditRates.high
    : null;
  const monthsLeft = canContribute ? 13 - Number(today.slice(5, 7)) : 0;

  const credit = amount(inputs.creditSpend);
  const check = amount(inputs.checkCashSpend);
  const card = calculateYearEndCardSpend(salary, credit, check, 0, inputs.eligibleChildren, year);
  const deductionAt = (extra: number, method: "credit" | "check") =>
    calculateYearEndCardSpend(
      salary,
      credit + (method === "credit" ? extra : 0),
      check + (method === "check" ? extra : 0),
      0,
      inputs.eligibleChildren,
      year,
    ).estimatedDeduction;
  // 신용 사용액이 문턱을 채우면 기존 체크 사용액의 공제도 달라지므로 단순 ÷15%는 틀린다.
  const spendToCap = (method: "credit" | "check") => {
    if (!salaryKnown || !supported) return null;
    if (card.capReached) return 0;
    let lo = 0;
    let hi = Math.ceil(card.toThreshold + card.remainingCap / 0.15);
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (deductionAt(mid, method) >= card.deductionCap) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const plannedSpend = canContribute ? amount(inputs.plannedSpend) : 0;
  const marginalRate =
    inputs.marginalRate != null && MARGINAL_RATES.includes(inputs.marginalRate) ? inputs.marginalRate : null;
  const scenario = (method: "credit" | "check") => {
    const deductionGain = Math.max(0, deductionAt(plannedSpend, method) - card.estimatedDeduction);
    return {
      deductionGain,
      taxSaving: salaryKnown && marginalRate != null ? deductionGain * marginalRate * 1.1 : null,
    };
  };
  return {
    supported,
    canContribute,
    salaryKnown,
    deadline: `${year}-12-31`,
    monthsLeft,
    pension: {
      paidPension,
      paidIrp,
      creditable,
      annualRoom,
      creditRoom,
      pensionRoom,
      irpRoomAfterPension,
      contribution,
      addPension,
      addIrp,
      creditRate,
      currentCredit: creditRate == null ? null : creditable * creditRate,
      additionalCredit: creditRate == null ? null : contribution * creditRate,
      monthlyContribution: monthsLeft > 0 ? Math.ceil(contribution / monthsLeft) : 0,
      unallocatedBudget: Math.max(0, budget - contribution),
      needsPensionAccount: addPension > 0 && !accounts.some((a) => a.taxShelter === "pension"),
      needsIrpAccount: addIrp > 0 && !accounts.some((a) => a.taxShelter === "irp"),
    },
    card: {
      ...card,
      spendToCapCredit: spendToCap("credit"),
      spendToCapCheck: spendToCap("check"),
      plannedSpend,
      creditScenario: scenario("credit"),
      checkScenario: scenario("check"),
      marginalRate,
    },
  };
}
