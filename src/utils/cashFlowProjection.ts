/**
 * 통합 현금흐름 — 향후 N개월(기본 12) 잔고 곡선 (3-5).
 *
 * cashFlowForecast(반복지출/이체, 60일 고정)를 "가용 현금 + 반복 + 대출 + 카드청구 + 변동 지출
 * 기준선(+선택 선행배당)"으로 확장한 순수 합성 모듈. 소스별 이벤트를 하나의 서명된(+수입/-지출)
 * 목록으로 모아 날짜순 누적하면 "최저 잔고가 언제·얼마인지", "잔고가 언제 처음 마이너스가 되는지"를
 * 정확한 날짜 단위로 구할 수 있다. 월말 지점(points)은 차트용 12개 요약일 뿐, 실제 최저/마이너스
 * 판정은 이벤트 단위(일 단위)로 한다.
 *
 * 이중계상 계약(ledger-plan G1과 동일 원칙):
 *  1) 대출 상환이 RecurringExpense로도 등록돼 있으면(제목이 대출명/기관명을 포함) 그 반복 항목은
 *     제외하고 loanSchedule만 쓴다 — 둘 다 넣으면 같은 상환이 두 번 잡힌다.
 *  2) 카드 계좌로 가는 반복 이체(카드결제이체)도 cardBillForecast가 청구주기 기준으로 이미 계산하므로
 *     반복지출 목록에서는 제외한다.
 *  3) 배당은 기본적으로 "가용 현금"에 넣지 않는다(증권계좌 예수금이지 은행 잔고가 아님) —
 *     opts.includeForwardDividends=true일 때만 유입으로 포함(사용자가 실제로 인출해 쓰는 경우).
 *  4) 대출 원금 상환은 loanSchedule에서 한 번만(이자와 분리해 더블카운트하지 않음).
 *
 * 변동 지출 기준선: utils/fixedExpense.computeExpenseNatureSeries의 최근 3개월(variable+discretionary)
 * 평균을 각 달 15일에 단일 유출 이벤트로 넣는다 — 실제 지출은 하루하루 흩어지지만, 미래는 알 수 없으므로
 * "평균만큼은 나간다"는 보수적 가정을 명시적인 한 이벤트로 표시(라벨에 "추정" 표기).
 */
import type { Account, CategoryPresets, LedgerEntry, Loan, RecurringExpense } from "../types";
import { parseIsoLocal, getMonthEndDate, shiftMonth } from "./date";
import { computeAccountBalances, computeLoanBalanceAt } from "../calculations";
import { computeCashFlowForecast } from "./cashFlowForecast";
import { buildLoanPaymentSchedule } from "./loanSchedule";
import { computeCardBillForecast } from "./cardBillForecast";
import { computeExpenseNatureSeries } from "./fixedExpense";
import { addMonthsClamped } from "./loanPrepay";
import type { ForwardDividends } from "./forwardDividends";

type CashFlowEventSource =
  | "recurring-expense"
  | "recurring-income"
  | "loan"
  | "card"
  | "variable-baseline"
  | "dividend";

interface CashFlowFlowEvent {
  /** yyyy-mm-dd */
  date: string;
  label: string;
  /** 서명 금액(KRW) — 유입 +, 유출 − */
  amount: number;
  source: CashFlowEventSource;
}

interface CashFlowProjectionMonthPoint {
  /** YYYY-MM */
  month: string;
  /** 그 달 말일(또는 horizon 끝이 그 전이면 horizon 끝) */
  date: string;
  balance: number;
}

interface CashFlowProjection {
  openingBalance: number;
  /** 날짜순, 서명 금액 이벤트 전체 */
  events: CashFlowFlowEvent[];
  /** 월말 잔고 요약점(차트용) */
  points: CashFlowProjectionMonthPoint[];
  minBalance: number;
  minBalanceDate: string | null;
  /** 잔고가 처음 0 미만이 되는 날짜 — 없으면 null */
  firstNegativeDate: string | null;
  monthlyNet: { month: string; net: number }[];
}

interface CashFlowProjectionOptions {
  horizonMonths?: number;
  fxRate?: number | null;
  categoryPresets?: CategoryPresets;
  /** true면 선행배당(향후 12개월 예상)을 유입으로 포함 */
  includeForwardDividends?: boolean;
  forwardDividends?: ForwardDividends | null;
}

const DEFAULT_HORIZON_MONTHS = 12;

function isLiquidAccountType(type: Account["type"]): boolean {
  return type === "checking" || type === "savings" || type === "other";
}

/** 반복지출 제목이 대출명/기관명을 포함하면 같은 상환으로 간주(loanSchedule과 중복 방지) */
function recurringMatchesLoan(r: RecurringExpense, loan: Loan): boolean {
  const title = (r.title || "").trim();
  if (!title) return false;
  if (loan.loanName && title.includes(loan.loanName)) return true;
  if (loan.institution && title.includes(loan.institution)) return true;
  return false;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = parseIsoLocal(fromIso);
  const b = parseIsoLocal(toIso);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function emptyProjection(): CashFlowProjection {
  return {
    openingBalance: 0,
    events: [],
    points: [],
    minBalance: 0,
    minBalanceDate: null,
    firstNegativeDate: null,
    monthlyNet: []
  };
}

export function buildCashFlowProjection(
  todayIso: string,
  accounts: Account[],
  ledger: LedgerEntry[],
  loans: Loan[],
  recurring: RecurringExpense[],
  opts: CashFlowProjectionOptions = {}
): CashFlowProjection {
  const today = parseIsoLocal(todayIso);
  if (!today) return emptyProjection();
  const horizonMonths = Math.max(1, opts.horizonMonths ?? DEFAULT_HORIZON_MONTHS);
  const endIso = addMonthsClamped(todayIso, horizonMonths) ?? todayIso;
  const horizonDays = daysBetweenIso(todayIso, endIso);

  // 1) 가용 현금 — 입출금·저축·기타(증권/코인/카드 제외)
  const balances = computeAccountBalances(accounts, ledger, []);
  const openingBalance = balances.reduce(
    (s, row) => (isLiquidAccountType(row.account.type) ? s + row.currentBalance : s),
    0
  );

  const events: CashFlowFlowEvent[] = [];

  // 2) 반복지출/이체 — 카드결제이체(toAccountId=카드계좌)·대출상환 매칭 반복은 제외(중복 방지 계약 1·2)
  const cardAccountIds = new Set(accounts.filter((a) => a.type === "card").map((a) => a.id));
  const outflowRecurring = recurring.filter((r) => {
    if (r.kind === "income") return false;
    if (r.toAccountId && cardAccountIds.has(r.toAccountId)) return false;
    if (loans.some((loan) => recurringMatchesLoan(r, loan))) return false;
    return true;
  });
  const outflow = computeCashFlowForecast(outflowRecurring, { todayIso, horizonDays, ledger });
  for (const e of outflow.events) {
    events.push({ date: e.date, label: e.title, amount: -e.amount, source: "recurring-expense" });
  }

  // 3) 반복 수입(kind='income', 3-4)
  const incomeRecurring = recurring.filter((r) => r.kind === "income");
  const income = computeCashFlowForecast(incomeRecurring, { todayIso, horizonDays, ledger });
  for (const e of income.events) {
    events.push({ date: e.date, label: e.title, amount: e.amount, source: "recurring-income" });
  }

  // 4) 대출 상환 스케줄 (계약 4: 원금·이자 합쳐 한 번만)
  for (const loan of loans) {
    const loanBalance = computeLoanBalanceAt([loan], ledger, todayIso);
    const schedule = buildLoanPaymentSchedule(loan, loanBalance, todayIso, endIso);
    for (const s of schedule) {
      events.push({ date: s.date, label: `${loan.loanName} 상환`, amount: -s.totalPayment, source: "loan" });
    }
  }

  // 5) 카드 청구 예정액 (billingCycleStart/paymentDay 설정된 카드만 — 3-4)
  const cardForecast = computeCardBillForecast(accounts, ledger, todayIso, {
    fxRate: opts.fxRate,
    categoryPresets: opts.categoryPresets
  }).filter((c) => c.paymentDate <= endIso);
  for (const c of cardForecast) {
    if (c.remainingKRW <= 0) continue;
    events.push({ date: c.paymentDate, label: "카드 결제", amount: -c.remainingKRW, source: "card" });
  }

  // 6) 변동 지출 기준선 — 최근 3개월(오늘 이전) variable+discretionary 평균을 매달 15일에 한 번씩
  const trailingMonths: string[] = [];
  for (let i = 3; i >= 1; i--) trailingMonths.push(shiftMonth(todayIso.slice(0, 7), -i));
  const natureSeries = computeExpenseNatureSeries(ledger, trailingMonths, opts.categoryPresets, opts.fxRate ?? null);
  const variableSamples = trailingMonths
    .map((m) => natureSeries[m])
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => t.variable + t.discretionary);
  const variableBaseline =
    variableSamples.length > 0 ? variableSamples.reduce((s, v) => s + v, 0) / variableSamples.length : 0;

  // 정확히 horizonMonths개의 달(오늘이 속한 달부터) — buildMonthRange를 쓰면 날짜 나머지 때문에
  // horizonMonths+1개가 나올 수 있어(예: 8/15+3개월=11/15 → Aug~Nov 4개월) 직접 shiftMonth로 생성.
  const todayMonth = todayIso.slice(0, 7);
  const projectionMonths: string[] = [];
  for (let i = 0; i < horizonMonths; i++) projectionMonths.push(shiftMonth(todayMonth, i));

  if (variableBaseline > 0) {
    for (const m of projectionMonths) {
      const mid = `${m}-15`;
      if (mid < todayIso || mid > endIso) continue;
      events.push({ date: mid, label: "변동 지출(추정, 최근 3개월 평균)", amount: -variableBaseline, source: "variable-baseline" });
    }
  }

  // 7) 선행배당 — 토글로만(계약 3: 기본 미포함, 증권계좌 예수금이지 은행 잔고 아님)
  if (opts.includeForwardDividends && opts.forwardDividends) {
    for (const m of opts.forwardDividends.months) {
      if (m.amountKRW <= 0) continue;
      const d = `${m.month}-25`; // 배당 지급일은 알 수 없으므로 월 하순으로 근사
      if (d < todayIso || d > endIso) continue;
      events.push({ date: d, label: "예상 배당(선행)", amount: m.amountKRW, source: "dividend" });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // 누적 잔고(이벤트 단위) — 최저 잔고·첫 마이너스일 판정용
  let running = openingBalance;
  let minBalance = openingBalance;
  let minBalanceDate: string | null = todayIso;
  let firstNegativeDate: string | null = openingBalance < 0 ? todayIso : null;
  for (const e of events) {
    running += e.amount;
    if (running < minBalance) {
      minBalance = running;
      minBalanceDate = e.date;
    }
    if (firstNegativeDate == null && running < 0) firstNegativeDate = e.date;
  }

  // 월말 요약점 — 그 시점까지의 누적 잔고(마지막으로 갱신된 running 값을 앞으로 이어붙임)
  const points: CashFlowProjectionMonthPoint[] = [];
  const monthlyNet: { month: string; net: number }[] = [];
  let carry = openingBalance;
  let cursorForCarry = 0; // events index
  for (let i = 0; i < projectionMonths.length; i++) {
    const m = projectionMonths[i];
    const isLast = i === projectionMonths.length - 1;
    // 마지막 점은 endIso까지(달의 일부만 걸쳐도 horizon 끝까지의 이벤트를 전부 반영) — 그 전 점들은 월말.
    const monthEnd = getMonthEndDate(m);
    const pointDate = isLast ? endIso : monthEnd > endIso ? endIso : monthEnd;
    let net = 0;
    while (cursorForCarry < events.length && events[cursorForCarry].date <= pointDate) {
      carry += events[cursorForCarry].amount;
      net += events[cursorForCarry].amount;
      cursorForCarry++;
    }
    points.push({ month: m, date: pointDate, balance: carry });
    monthlyNet.push({ month: m, net });
  }

  return {
    openingBalance,
    events,
    points,
    minBalance,
    minBalanceDate,
    firstNegativeDate,
    monthlyNet
  };
}
