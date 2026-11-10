/**
 * FIRE 기준선(baseline) — 순수 모듈 (React 의존 없음). 읽기 전용, 저장 경로 없음.
 *
 * 최근 N개월(기본 12, **완료된 달만** — 진행 중인 이번 달은 제외) 장부에서 은퇴 투영의 입력값을 뽑는다.
 *  - annualRealExpense : 연 실질 지출 = computeMonthlyRealFlows(savingsRate.ts) realExpense 합 → 12개월 환산.
 *                        단, **투자손실(isInvestmentPnlEntry)은 먼저 걸러낸다** — savingsRate의 실질 지출은 투자손실을
 *                        포함하지만(저축률 맥락), 은퇴 후 '생활비'에는 실현손실이 들어가면 안 되고 손실은 이미 순자산에
 *                        반영돼 있다(G1 이중계상 계약: 투자손익은 수입/지출이 아닌 재테크 순집계).
 *  - annualFixedExpense: 연 고정비  = computeExpenseNatureSeries(fixedExpense.ts) fixed 합 → 12개월 환산
 *                        (대시보드 DividendCoverageCard·인사이트 지출 탭과 **같은 단일 소스** — 여기서 재정의 금지)
 *  - sustainableMonthlySavingKRW: 반복 가능한 월 저축 = min(재테크 유입, 실질 수입 − 실질 지출). 재테크 유입에는
 *                        대출·용돈으로 넣은 돈도 섞인다(실장부: 대출 2,000만 투자 → 유입 468만/월 vs 흑자 ~150만/월).
 *                        창에 실질 수입 기록이 없으면 재테크 유입 그대로.
 *  - monthlySavingKRW  : 월 저축 = classifyLedgerFlow === "investing"(재테크: 저축이체·투자이체 transfer + 레거시
 *                        저축성지출) 월평균. **투자손익(isInvestmentPnlEntry)은 제외** — 실현손익은 '넣은 돈'이 아니라
 *                        이미 순자산에 반영된 결과다(ledger-plan G1 이중계상 계약). 배당 재투자(증권계좌 안에서의 매수)는
 *                        transfer가 아니므로 애초에 잡히지 않고, TWR netFlow(매수/매도 현금흐름)도 여기 가산하지 않는다.
 *  - netWorthKRW       : 호출부가 타임라인(accountTimeline — 대시보드 순자산과 동일 계산) 값을 넘긴다. 여기서
 *                        별도 계산하면 두 벌이 된다.
 *  - expectedReturnPct : 장기 가정 DEFAULT_RETURN_PCT(명목 5%, 배당 포함 총수익). 최근 1년 TWR은 recentTwrPct로
 *                        참고만 한다 — 예전엔 TWR을 −5~15%로 캡해 그대로 썼는데, 한 해 −21%(실장부)면 −5%가 40년
 *                        복리로 투영돼 "40년 내 도달 못함"만 나왔다. 한 해 실적은 수십 년 기대수익률의 근거가 못 된다.
 *  - dividendYieldPct  : 향후 12개월 예상 배당(forwardDividends.annualTotalKRW 등) ÷ 순자산 × 100.
 *                        분모가 순자산인 이유: 투영은 순자산 전체에 수익률을 곱하므로, 배당이 순자산 대비 몇 %의
 *                        현금흐름을 만드는지가 맞는 단위다(포트폴리오 평가액 대비 수익률보다 작게 나온다 — 의도).
 *
 * 12개월 환산(annualize) 규칙: 창 안에서 장부가 **실제로 존재하는 달 수**(firstLedgerMonth 이후)로 나눠 ×12.
 * 장부를 3개월 전부터 썼는데 12로 나누면 연 지출이 1/4로 과소 추정되는 것을 막는다. 창 안에 장부가 없으면 0.
 */
import type { CategoryPresets, LedgerEntry } from "../types";
import { computeMonthlyRealFlows } from "./savingsRate";
import { computeExpenseNatureSeries } from "./fixedExpense";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { isInvestmentPnlEntry } from "./categoryUtils";
import { toKrwByRate } from "./currency";
import { shiftMonth } from "./date";

/**
 * 장기 기대수익률 가정 (연 %, 명목, 배당 포함 총수익) — 주식·채권·예금 혼합 포트폴리오의 수십 년 평균을
 * 보수적으로 잡은 값(인플레 2.5% 위 실질 약 2.5%). 최근 실적(TWR)으로 바꾸지 않는다.
 */
export const DEFAULT_RETURN_PCT = 5;
/** 기본 창 길이 (완료월 수) */
const DEFAULT_BASELINE_MONTHS = 12;

interface FireBaselineInput {
  ledger: LedgerEntry[];
  /** 창 길이(완료월 수). 기본 12 */
  months?: number;
  /** 기준일 "YYYY-MM-DD" (KST). 창 = 이 달의 직전 달부터 months개월 */
  todayIso: string;
  categoryPresets?: CategoryPresets;
  fxRate: number | null;
  /** 데이트 분담 계좌 id — 실질 지출에서 상대 부담분 50% 차감 (savingsRate와 동일) */
  dateAccountId?: string | null;
  /** 설정의 비실질 수입 카테고리 (computeMonthlyRealFlows 전달) */
  nonRealIncomeOverride?: string[];
  /** 현재 순자산 (KRW) — 타임라인 마지막 행 total (대시보드와 동일 숫자) */
  netWorthKRW: number;
  /** 포트폴리오 TWR 연율 (%, 예: 7.2). 없으면 null */
  twrAnnualPct?: number | null;
  /** 향후 12개월 예상 배당 합계 (KRW). 없으면 null */
  dividendAnnualKRW?: number | null;
}

export interface FireBaseline {
  /** 창 시작/끝 월 ("YYYY-MM") */
  windowStartMonth: string;
  windowEndMonth: string;
  /** 12개월 환산에 쓴 실제 데이터 달 수 (0이면 장부 없음) */
  coveredMonths: number;
  /** 연 실질 지출 (KRW, 12개월 환산) */
  annualRealExpense: number;
  /** 연 고정비 (KRW, 12개월 환산) — fixedExpense 단일 소스 */
  annualFixedExpense: number;
  /** 월 저축 = 재테크 유입 월평균 (KRW, 투자손익 제외) — 대출·용돈 재원 포함 */
  monthlySavingKRW: number;
  /** 월 실질 흑자 = (실질 수입 − 실질 지출) 월평균. 창에 실질 수입이 없으면 null */
  monthlySurplusKRW: number | null;
  /** 반복 가능한 월 저축 = min(재테크 유입, 실질 흑자) (흑자 없으면 재테크 유입). 시뮬레이터 기본값 */
  sustainableMonthlySavingKRW: number;
  /** 현재 순자산 (입력 그대로) */
  netWorthKRW: number;
  /** 기대수익률 (연 %, 명목) = 장기 가정 DEFAULT_RETURN_PCT */
  expectedReturnPct: number;
  /** 참고: 포트폴리오 최근 1년 TWR (연 %). 기대수익률에 쓰지 않는다 */
  recentTwrPct: number | null;
  /** 배당수익률 (연 %, 순자산 대비). 배당·순자산 없으면 0 */
  dividendYieldPct: number;
}

/** 창 안의 월 목록 — 이번 달 직전 달부터 과거로 months개 (오름차순) */
export function fireBaselineWindow(todayIso: string, months: number): string[] {
  const thisMonth = todayIso.slice(0, 7);
  const n = Math.max(1, Math.floor(months));
  const out: string[] = [];
  for (let i = n; i >= 1; i -= 1) out.push(shiftMonth(thisMonth, -i));
  return out;
}

export function buildFireBaseline(input: FireBaselineInput): FireBaseline {
  const months = input.months ?? DEFAULT_BASELINE_MONTHS;
  const window = fireBaselineWindow(input.todayIso, months);
  const windowStartMonth = window[0];
  const windowEndMonth = window[window.length - 1];
  const fxRate = input.fxRate;

  // 창 안에서 장부가 존재하는 첫 달 → coveredMonths (환산 분모)
  let firstMonthInWindow: string | null = null;
  for (const l of input.ledger) {
    const m = l.date?.slice(0, 7);
    if (!m || m < windowStartMonth || m > windowEndMonth) continue;
    if (firstMonthInWindow == null || m < firstMonthInWindow) firstMonthInWindow = m;
  }
  const coveredMonths = firstMonthInWindow == null ? 0 : window.filter((m) => m >= firstMonthInWindow!).length;

  let annualRealExpense = 0;
  let annualFixedExpense = 0;
  let monthlySavingKRW = 0;
  let monthlySurplusKRW: number | null = null;

  if (coveredMonths > 0) {
    // 실질 지출 — savingsRate 단일 소스 (환전·신용결제·재테크 제외, 데이트 50% 차감) + 투자손익 사전 제외
    const livingLedger = input.ledger.filter((l) => !isInvestmentPnlEntry(l));
    const flows = computeMonthlyRealFlows(livingLedger, {
      fxRate,
      dateAccountId: input.dateAccountId ?? null,
      startMonth: windowStartMonth,
      endMonth: windowEndMonth,
      nonRealIncomeOverride: input.nonRealIncomeOverride,
    });
    let realExpenseSum = 0;
    let realIncomeSum = 0;
    for (const m of window) {
      realExpenseSum += flows.get(m)?.realExpense ?? 0;
      realIncomeSum += flows.get(m)?.realIncome ?? 0;
    }

    // 고정비 — fixedExpense 단일 소스
    const nature = computeExpenseNatureSeries(input.ledger, window, input.categoryPresets, fxRate);
    let fixedSum = 0;
    for (const m of window) fixedSum += nature[m]?.fixed ?? 0;

    // 월 저축 — 재테크 유입(투자손익 제외)
    let savingSum = 0;
    for (const l of input.ledger) {
      const m = l.date?.slice(0, 7);
      if (!m || m < windowStartMonth || m > windowEndMonth) continue;
      if (isInvestmentPnlEntry(l)) continue;
      if (classifyLedgerFlow(l, input.categoryPresets) !== "investing") continue;
      savingSum += toKrwByRate(Number(l.amount), l.currency, fxRate);
    }

    annualRealExpense = (realExpenseSum / coveredMonths) * 12;
    annualFixedExpense = (fixedSum / coveredMonths) * 12;
    monthlySavingKRW = savingSum / coveredMonths;
    if (realIncomeSum > 0) monthlySurplusKRW = (realIncomeSum - realExpenseSum) / coveredMonths;
  }
  const sustainableMonthlySavingKRW = monthlySurplusKRW == null
    ? monthlySavingKRW
    : Math.max(0, Math.min(monthlySavingKRW, monthlySurplusKRW));

  const netWorthKRW = Number.isFinite(input.netWorthKRW) ? input.netWorthKRW : 0;
  const dividendAnnual = input.dividendAnnualKRW ?? 0;
  const dividendYieldPct =
    netWorthKRW > 0 && dividendAnnual > 0 ? (dividendAnnual / netWorthKRW) * 100 : 0;

  const twr = input.twrAnnualPct;
  const recentTwrPct = typeof twr === "number" && Number.isFinite(twr) ? twr : null;

  return {
    windowStartMonth,
    windowEndMonth,
    coveredMonths,
    annualRealExpense,
    annualFixedExpense,
    monthlySavingKRW,
    monthlySurplusKRW,
    sustainableMonthlySavingKRW,
    netWorthKRW,
    expectedReturnPct: DEFAULT_RETURN_PCT,
    recentTwrPct,
    dividendYieldPct,
  };
}
