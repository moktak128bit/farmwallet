/**
 * 연말정산 미리보기 — 순수 계산.
 * ───────────────────────────────────────────────────────
 * 가계부(ledger)만으로 "지금까지 쓴 돈이 연말정산에 얼마나 반영될지"를 개략 추정한다.
 *  - 신용카드 등 사용금액 소득공제: 총급여 25% 문턱 → 초과분 신용 15% / 체크·현금 30%, 총급여 구간별 한도
 *  - 의료비 세액공제: 총급여 3% 초과분 × 15%
 *  - 기부금 세액공제: 15% (1천만 원 초과분 30%)
 *  - 월세 세액공제: 총급여 8천만 이하, 연 1천만 원 한도 × 15%(5,500만 이하 17%)
 *
 * ⚠ 개략 추정(면책): 전통시장·대중교통·도서공연 추가공제, 부양가족 의료비 한도 예외, 기부금 종류별 한도,
 *   주택 요건 등은 반영하지 않는다. 실제 공제액은 국세청 연말정산 간소화 자료 기준이며 본 수치는 참고용.
 *
 * 카드 유형 판정(앱 데이터 한계):
 *  - 신용카드 사용분 = fromAccountId가 type "card"인 계좌에서 나간 expense
 *    (카드 대금 납부는 transfer 카드결제이체라 classifyLedgerFlow가 이미 지출에서 제외 → 이중계상 없음)
 *  - 체크카드·현금영수증 = type "checking" 계좌에서 바로 나간 expense (현금영수증 발급 여부는 알 수 없으므로 가정)
 *  - 그 밖(계좌 미지정·저축/증권/기타) = 공제 대상 아님으로 분류(other)
 *
 * 총급여: 옵션 grossSalary(사용자 입력)가 없으면 salaryKeys(incomeClassification) 수입의 당해 누계를
 *   급여 발생 개월 수로 나눠 12개월 연환산한다(진행 중인 해). 지난 해는 누계 그대로.
 */
import type { Account, CategoryPresets, LedgerEntry } from "../types";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { expenseMainName } from "./categoryMerge";
import { computeIncomeNatureKeys } from "./incomeClassification";
import { toKrwByRate } from "./currency";
import { getTodayKST } from "./date";

/**
 * 연말정산 세법 상수 — 연도 태그 단일 객체.
 * 출처(2025년 귀속 기준 수치를 2026년 귀속에 그대로 적용 — 개정 시 여기만 갱신):
 *  - 신용카드 등 소득공제: 조세특례제한법 §126의2 (문턱 총급여 25%, 신용 15%·직불/선불/현금영수증 30%,
 *    기본 한도 총급여 7천만 이하 300만 / 초과 250만; 문턱은 신용카드 사용분부터 차감 — 시행령 §121의2)
 *  - 의료비 세액공제: 소득세법 §59의4②  (총급여 3% 초과분 15%, 한도 700만 — 본인·65세 이상·장애인·난임 예외 미반영)
 *  - 기부금 세액공제: 소득세법 §59의4④  (15%, 1천만 원 초과분 30% — 종류별 한도 미반영)
 *  - 월세 세액공제: 조세특례제한법 §95의2 (총급여 8천만 이하 무주택 세대주, 월세액 연 1천만 한도,
 *    15% / 총급여 5,500만 이하 17%)
 */
export const YEAR_END_TAX_RULES_2026 = {
  year: 2026,
  card: {
    thresholdRate: 0.25,
    creditRate: 0.15,
    checkCashRate: 0.3,
    /** 총급여 상한(이하) → 기본 공제 한도. 오름차순, 마지막은 Infinity */
    capBySalary: [
      { maxSalary: 70_000_000, cap: 3_000_000 },
      { maxSalary: Infinity, cap: 2_500_000 }
    ]
  },
  medical: { thresholdRate: 0.03, creditRate: 0.15, cap: 7_000_000 },
  donation: { rate: 0.15, highThreshold: 10_000_000, highRate: 0.3 },
  rent: { salaryLimit: 80_000_000, annualCap: 10_000_000, rate: 0.15, lowSalaryLimit: 55_000_000, lowSalaryRate: 0.17 }
} as const;

type YearEndTaxRules = typeof YEAR_END_TAX_RULES_2026;

/** 연도 → 적용 규칙 (해당 연도 상수가 없으면 최신 상수 사용 — 결과의 rules.year로 어느 해 기준인지 드러냄) */
function getYearEndTaxRules(_year: number): YearEndTaxRules {
  return YEAR_END_TAX_RULES_2026;
}

interface YearEndTaxHelperOptions {
  /** 사용자 입력 총급여(연). 없으면 salaryKeys YTD 연환산 */
  grossSalary?: number | null;
  categoryPresets?: CategoryPresets;
  /** USD 항목 환산용 (없으면 액면 — toKrwByRate 정책) */
  fxRate?: number | null;
  /** 테스트용 오늘(YYYY-MM-DD). 기본 KST 오늘 */
  today?: string;
}

interface YearEndCardSpend {
  /** 신용카드(type "card") 사용분 */
  credit: number;
  /** 체크카드·현금영수증 추정분(type "checking" 직접 출금) */
  checkOrCash: number;
  /** 공제 대상으로 잡히지 않은 지출(계좌 미지정·저축/증권/기타 계좌) */
  other: number;
  /** credit + checkOrCash */
  total: number;
  /** 총급여 25% 문턱 */
  threshold25: number;
  /** 문턱 초과 사용액 합(신용+체크) */
  overThreshold: number;
  /** 문턱까지 남은 금액 (이미 넘었으면 0) */
  toThreshold: number;
  /** 문턱 초과 신용카드분 (문턱은 신용카드부터 차감) */
  creditOver: number;
  /** 문턱 초과 체크·현금분 */
  checkOver: number;
  /** 추정 소득공제액 = min(한도, 신용 15% + 체크 30%) */
  estimatedDeduction: number;
  /** 총급여 구간별 기본 한도 */
  deductionCap: number;
  /** 한도까지 남은 공제액 */
  remainingCap: number;
  /** 한도 소진 여부 */
  capReached: boolean;
  /** 한 줄 조언 */
  advice: string;
}

export interface YearEndTaxHelperResult {
  year: number;
  /** 적용 규칙(연도 태그) */
  rules: YearEndTaxRules;
  /** 계산에 쓴 총급여 (0이면 미확정 — 문턱·한도 계산 불가) */
  grossSalary: number;
  /** input=사용자 입력 / estimated=급여 YTD 연환산 / none=급여 항목 없음 */
  grossSalarySource: "input" | "estimated" | "none";
  /** 당해 salaryKeys 수입 누계(KRW) */
  salaryYtd: number;
  /** 급여 수입이 발생한 개월 수 (연환산 분모) */
  salaryMonths: number;
  /** 진행 중인 해인지 (연환산 적용 여부) */
  yearInProgress: boolean;
  cardSpend: YearEndCardSpend;
  medical: {
    total: number;
    /** 총급여 3% 문턱 */
    threshold3: number;
    /** 문턱 초과 공제대상액 (한도 적용) */
    deductible: number;
    /** 추정 세액공제 = deductible × 15% */
    estimatedCredit: number;
  };
  donation: {
    total: number;
    /** 15% (1천만 초과분 30%) */
    estimatedCredit: number;
  };
  rent: {
    total: number;
    /** 총급여 요건 충족 여부 (총급여 미확정이면 true로 두고 개략 계산) */
    eligible: boolean;
    /** 연 한도 적용액 */
    eligibleAmount: number;
    /** 추정 세액공제 */
    estimatedCredit: number;
  };
}

const MEDICAL_MAIN = /의료|병원|건강/;
/** 의료건강비 대분류 중 의료비 공제 대상이 아닌 소분류 (보험료는 별도 보험료공제, 영양제·헬스는 공제 불가) */
const MEDICAL_EXCLUDED_DETAIL = /보험|영양제|헬스|피트니스|운동|미용|성형/;
const MEDICAL_DETAIL = /병원|약국|의약|진료|치과|한의원|안과|검진|수술|입원|의료/;
const DONATION = /기부|후원|헌금|성금/;
const RENT = /월세/;

function fieldsOf(l: LedgerEntry): { main: string; detail: string; cat: string } {
  return {
    main: expenseMainName(l),
    detail: (l.detailCategory || "").trim(),
    cat: (l.category || "").trim()
  };
}

/** 의료비 공제 후보 — 대분류가 의료/병원/건강이면서 소분류가 보험·영양제 등 제외 대상이 아닌 것, 또는 소분류 자체가 의료 키워드 */
export function isMedicalExpense(l: LedgerEntry): boolean {
  const { main, detail } = fieldsOf(l);
  if (MEDICAL_EXCLUDED_DETAIL.test(detail)) return false;
  if (MEDICAL_MAIN.test(main)) return true;
  return MEDICAL_DETAIL.test(detail);
}

export function isDonationExpense(l: LedgerEntry): boolean {
  const { main, detail, cat } = fieldsOf(l);
  return DONATION.test(detail) || DONATION.test(main) || DONATION.test(cat);
}

export function isRentExpense(l: LedgerEntry): boolean {
  const { main, detail, cat } = fieldsOf(l);
  return RENT.test(detail) || RENT.test(main) || RENT.test(cat);
}

function capForSalary(rules: YearEndTaxRules, grossSalary: number): number {
  for (const band of rules.card.capBySalary) {
    if (grossSalary <= band.maxSalary) return band.cap;
  }
  return rules.card.capBySalary[rules.card.capBySalary.length - 1].cap;
}

function buildAdvice(
  c: Omit<YearEndCardSpend, "advice">,
  rules: YearEndTaxRules,
  salaryKnown: boolean
): string {
  if (!salaryKnown) return "총급여를 입력하면 25% 문턱과 공제 한도를 계산합니다.";
  if (c.capReached) return "카드 공제 한도를 모두 채웠습니다 — 추가 카드 소비는 소득공제 효과가 없습니다.";
  if (c.toThreshold > 0) {
    return `총급여 25% 문턱까지 ${Math.round(c.toThreshold).toLocaleString("ko-KR")}원 남음 — 문턱을 넘긴 소비부터 공제되니 그 전까진 결제수단 차이가 없습니다.`;
  }
  // 문턱은 넘었고 한도는 남음 → 체크·현금 우선
  const moreCheck = Math.ceil(c.remainingCap / rules.card.checkCashRate);
  return `문턱 초과 구간 — 체크카드·현금영수증은 신용카드의 2배(30%)로 공제됩니다. 체크·현금으로 약 ${moreCheck.toLocaleString("ko-KR")}원 더 쓰면 한도(${c.deductionCap.toLocaleString("ko-KR")}원)에 도달합니다.`;
}

/**
 * 연말정산 미리보기 계산.
 * @param ledger 전체 가계부 (salaryKeys 자동감지에 전 기간 필요; 집계는 year만)
 * @param accounts 계좌 (카드/입출금 유형 판정)
 * @param year 귀속 연도
 */
export function buildYearEndTaxHelper(
  ledger: LedgerEntry[],
  accounts: Account[],
  year: number,
  options: YearEndTaxHelperOptions = {}
): YearEndTaxHelperResult {
  const rules = getYearEndTaxRules(year);
  const fxRate = options.fxRate ?? null;
  const today = options.today ?? getTodayKST();
  const todayYear = Number(today.slice(0, 4));
  const yearInProgress = year >= todayYear;
  const yearPrefix = `${year}-`;
  const toKrw = (l: LedgerEntry) => toKrwByRate(Number(l.amount) || 0, l.currency, fxRate);

  // ── 총급여 ──
  const { salaryKeys } = computeIncomeNatureKeys(ledger, accounts, options.categoryPresets?.categoryTypes);
  let salaryYtd = 0;
  const salaryMonthSet = new Set<string>();
  for (const l of ledger) {
    if (l.kind !== "income" || !l.date?.startsWith(yearPrefix)) continue;
    if (yearInProgress && l.date > today) continue;
    if (!salaryKeys.has(l.subCategory || l.category || "")) continue;
    const amt = toKrw(l);
    if (amt <= 0) continue;
    salaryYtd += amt;
    salaryMonthSet.add(l.date.slice(0, 7));
  }
  const salaryMonths = salaryMonthSet.size;
  let grossSalary = 0;
  let grossSalarySource: YearEndTaxHelperResult["grossSalarySource"] = "none";
  if (options.grossSalary != null && Number.isFinite(options.grossSalary) && options.grossSalary > 0) {
    grossSalary = options.grossSalary;
    grossSalarySource = "input";
  } else if (salaryYtd > 0) {
    grossSalary = yearInProgress && salaryMonths > 0 ? (salaryYtd / salaryMonths) * 12 : salaryYtd;
    grossSalarySource = "estimated";
  }
  const salaryKnown = grossSalary > 0;

  // ── 지출 집계 ──
  const accountType = new Map<string, Account["type"]>();
  for (const a of accounts) accountType.set(a.id, a.type);

  let credit = 0;
  let checkOrCash = 0;
  let other = 0;
  let medicalTotal = 0;
  let donationTotal = 0;
  let rentTotal = 0;

  for (const l of ledger) {
    if (!l.date?.startsWith(yearPrefix)) continue;
    if (classifyLedgerFlow(l, options.categoryPresets) !== "expense") continue;
    const amt = toKrw(l);
    if (amt <= 0) continue;
    const t = l.fromAccountId ? accountType.get(l.fromAccountId) : undefined;
    if (t === "card") credit += amt;
    else if (t === "checking") checkOrCash += amt;
    else other += amt;

    if (isMedicalExpense(l)) medicalTotal += amt;
    else if (isDonationExpense(l)) donationTotal += amt;
    else if (isRentExpense(l)) rentTotal += amt;
  }

  // ── 카드 공제 ──
  const threshold25 = salaryKnown ? grossSalary * rules.card.thresholdRate : 0;
  const total = credit + checkOrCash;
  const creditOver = salaryKnown ? Math.max(0, credit - threshold25) : 0;
  const thresholdLeftAfterCredit = Math.max(0, threshold25 - credit);
  const checkOver = salaryKnown ? Math.max(0, checkOrCash - thresholdLeftAfterCredit) : 0;
  const overThreshold = creditOver + checkOver;
  const toThreshold = salaryKnown ? Math.max(0, threshold25 - total) : 0;
  const deductionCap = salaryKnown ? capForSalary(rules, grossSalary) : 0;
  const rawDeduction = creditOver * rules.card.creditRate + checkOver * rules.card.checkCashRate;
  const estimatedDeduction = salaryKnown ? Math.min(deductionCap, rawDeduction) : 0;
  const remainingCap = Math.max(0, deductionCap - estimatedDeduction);
  const capReached = salaryKnown && deductionCap > 0 && rawDeduction >= deductionCap;
  const cardBase: Omit<YearEndCardSpend, "advice"> = {
    credit, checkOrCash, other, total, threshold25, overThreshold, toThreshold,
    creditOver, checkOver, estimatedDeduction, deductionCap, remainingCap, capReached
  };
  const cardSpend: YearEndCardSpend = { ...cardBase, advice: buildAdvice(cardBase, rules, salaryKnown) };

  // ── 의료비 ──
  const threshold3 = salaryKnown ? grossSalary * rules.medical.thresholdRate : 0;
  const medicalDeductible = salaryKnown ? Math.min(rules.medical.cap, Math.max(0, medicalTotal - threshold3)) : 0;
  const medical = {
    total: medicalTotal,
    threshold3,
    deductible: medicalDeductible,
    estimatedCredit: medicalDeductible * rules.medical.creditRate
  };

  // ── 기부금 ──
  const donLow = Math.min(donationTotal, rules.donation.highThreshold);
  const donHigh = Math.max(0, donationTotal - rules.donation.highThreshold);
  const donation = {
    total: donationTotal,
    estimatedCredit: donLow * rules.donation.rate + donHigh * rules.donation.highRate
  };

  // ── 월세 ──
  const rentEligible = !salaryKnown || grossSalary <= rules.rent.salaryLimit;
  const rentEligibleAmount = rentEligible ? Math.min(rules.rent.annualCap, rentTotal) : 0;
  const rentRate = salaryKnown && grossSalary <= rules.rent.lowSalaryLimit ? rules.rent.lowSalaryRate : rules.rent.rate;
  const rent = {
    total: rentTotal,
    eligible: rentEligible,
    eligibleAmount: rentEligibleAmount,
    estimatedCredit: rentEligibleAmount * rentRate
  };

  return {
    year,
    rules,
    grossSalary,
    grossSalarySource,
    salaryYtd,
    salaryMonths,
    yearInProgress,
    cardSpend,
    medical,
    donation,
    rent
  };
}
