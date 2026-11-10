/**
 * 대시보드 첫 화면(한눈에 보기)과 상세 카드가 같은 숫자를 쓰도록 모은 순수 계산.
 *  - computeMonthPace: 이번 달 지출 vs 최근 3개월 같은 기간 (MonthPaceCard·DashboardGlance 공용)
 *  - computeInvestmentTotals: 투자 평가액·순입금 원금·총 손익 (InvestmentSummaryCard·DashboardGlance 공용)
 *  - nearestLoanMaturity: 잔액이 남은 대출 중 만기가 가장 가까운 것
 */
import type { Account, AccountBalanceRow, CategoryPresets, LedgerEntry, Loan, PositionRow, StockTrade } from "../../types";
import { baseBalanceForAccount, positionMarketValueKRW } from "../../calculations";
import { shiftMonth } from "../../utils/date";
import { recordedDayCap } from "../../utils/ledgerFreshness";
import { toKrwByRate } from "../../utils/currency";
import { usdBalanceModeDelta } from "../../utils/tradeCashImpact";
import { isCurrencyExchangeEntry } from "../../utils/categoryUtils";
// 원금성(이전성) 수입 판정 — 리포트 투자 정산과 같은 단일 규칙 (퇴직연금 이전·이월·지원은 원금, 배당·이자는 손익)
import { isPrincipalLikeIncomeEntry } from "../../utils/reports/shared";
import { classifyLedgerFlow, toKrwAmount } from "./summaryMath";

export interface MonthPace {
  /** 1~elapsed일 지출 (KPI '이번 달 지출'과 같은 classifyLedgerFlow 정의) */
  currentExpense: number;
  /** 마지막 기록일 기준 경과일 (recordedDayCap). 0 = 이번 달 기록 전 */
  elapsed: number;
  totalDays: number;
  /** 최근 3개월 월 전체 지출 평균 */
  avgPrev3: number;
  /** 최근 3개월 같은 기간(1~elapsed일) 지출 평균 — "평소 이맘때" */
  avgPrevPartial: number;
  /** 같은 기간이 월 전체에서 차지한 비중 (avgPrevPartial / avgPrev3) */
  share: number | null;
  /** 월말 예상 — share로 환산(없으면 일할) */
  projectedExpense: number | null;
}

/**
 * 진행 중인 달의 지출 페이스. 경과일은 오늘이 아니라 마지막 기록일(ledgerFreshness) —
 * 캡처를 모아 입력하면 기록 안 된 며칠이 지출 0으로 들어가 페이스가 과소 추정된다.
 * 환산은 일할 대신 '최근 3달의 같은 기간이 월 전체에서 차지한 비중' — 월말 몰림 지출(카드대금 등) 대응.
 */
export function computeMonthPace(
  ledger: LedgerEntry[],
  currentMonth: string,
  today: string,
  categoryPresets: CategoryPresets | undefined,
  fxRate: number | null
): MonthPace {
  const [year, monthNum] = currentMonth.split("-").map(Number);
  const totalDays = new Date(year, monthNum, 0).getDate();
  const cap = recordedDayCap(ledger, currentMonth, today) ?? totalDays;
  const elapsed = Math.min(cap, totalDays);
  const prevMonths = [-1, -2, -3].map((offset) => shiftMonth(currentMonth, offset));
  const monthSet = new Set([currentMonth, ...prevMonths]);
  // 한 번 순회로 월별 전체·부분 합 집계
  const full = new Map<string, number>();
  const partial = new Map<string, number>();
  for (const entry of ledger) {
    const m = entry.date?.slice(0, 7);
    if (!m || !monthSet.has(m)) continue;
    if (classifyLedgerFlow(entry, categoryPresets) !== "expense") continue;
    const amt = toKrwAmount(entry, fxRate);
    full.set(m, (full.get(m) ?? 0) + amt);
    if (Number(entry.date.slice(8, 10)) <= elapsed) partial.set(m, (partial.get(m) ?? 0) + amt);
  }
  const currentExpense = partial.get(currentMonth) ?? 0;
  const avgPrev3 = prevMonths.reduce((s, m) => s + (full.get(m) ?? 0), 0) / 3;
  const avgPrevPartial = prevMonths.reduce((s, m) => s + (partial.get(m) ?? 0), 0) / 3;
  const share = avgPrev3 > 0 && avgPrevPartial > 0 ? avgPrevPartial / avgPrev3 : null;
  const projectedExpense =
    elapsed <= 0 ? null
      : share != null ? currentExpense / share
        : (currentExpense / elapsed) * totalDays;
  return { currentExpense, elapsed, totalDays, avgPrev3, avgPrevPartial, share, projectedExpense };
}

export interface InvestmentTotals {
  /** 증권·crypto 계좌의 지금 평가액 (현금 + USD 현금 환산 + 보유 종목) */
  totalInvestmentAssets: number;
  /** 순입금 원금 — 시작 잔액 + 초기 USD + 증권 계좌로의 순이체(환전 제외) + 이전성 수입(퇴직연금 이전 등) */
  principal: number;
  /** 총 손익 = 평가액 − 순입금 원금 (평가손익·매도 실현·배당·이자·수수료 포함) */
  cumulativePnl: number;
}

export function computeInvestmentTotals(args: {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  fxRate: number | null;
}): InvestmentTotals {
  const { accounts, ledger, trades, balances, positions, fxRate } = args;
  const sec = new Set<string>();
  for (const a of accounts) if (a.type === "securities" || a.type === "crypto") sec.add(a.id);

  let totalInvestmentAssets = 0;
  for (const row of balances) {
    if (!sec.has(row.account.id)) continue;
    totalInvestmentAssets += row.currentBalance;
    const usdCash = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
    if (usdCash && fxRate) totalInvestmentAssets += usdCash * fxRate;
  }
  for (const p of positions) {
    if (!sec.has(p.accountId)) continue;
    totalInvestmentAssets += positionMarketValueKRW(p, fxRate);
  }

  // 초기 USD 현금 롤백 — usdBalance는 잔액모드 거래가 반영된 '현재' 값이므로 전체 델타를 되감아
  // 최초 보유분만 원금에 넣는다 (보고서 투자 총성과의 initialCapital과 동일 정의).
  const usdModeDeltaTotal = new Map<string, number>();
  for (const t of trades) {
    const delta = usdBalanceModeDelta(t);
    if (delta !== 0) usdModeDeltaTotal.set(t.accountId, (usdModeDeltaTotal.get(t.accountId) ?? 0) + delta);
  }
  let principal = 0;
  for (const a of accounts) {
    if (!sec.has(a.id)) continue;
    // 잔액 계산과 동일한 단일 정의 — initialBalance + initialCashBalance 이중계상 방지
    principal += baseBalanceForAccount(a);
    const initialUsd = (a.usdBalance ?? 0) - (usdModeDeltaTotal.get(a.id) ?? 0);
    if (initialUsd && fxRate) principal += initialUsd * fxRate;
  }
  for (const e of ledger) {
    // 투자 계좌로 들어온 '이전성' 수입(퇴직연금 회사부담분 이전·이월·지원 등)은 번 돈이 아니라 넣은 돈 → 원금.
    // 배당·이자·투자수익·환불은 계좌가 번(돌려받은) 돈이라 원금이 아니다(손익에 남는다).
    if (e.kind === "income") {
      if (e.toAccountId && sec.has(e.toAccountId) && isPrincipalLikeIncomeEntry(e)) {
        principal += toKrwByRate(e.amount, e.currency, fxRate);
      }
      continue;
    }
    if (e.kind !== "transfer") continue;
    // 환전은 계좌 안에서 통화만 바꾸는 내부 이동 — 두 다리가 각각 상대 계좌 없이 기록돼(KRW 다리는 액면,
    // USD 다리는 오늘 환율) 원금에 넣으면 환율 차이만큼 원금이 틀어진다. 환전 손익은 평가액 쪽에 남는다.
    if (isCurrencyExchangeEntry(e)) continue;
    const toSec = e.toAccountId ? sec.has(e.toAccountId) : false;
    const fromSec = e.fromAccountId ? sec.has(e.fromAccountId) : false;
    if (toSec === fromSec) continue;
    const amtKrw = toKrwByRate(e.amount, e.currency, fxRate);
    if (toSec) principal += amtKrw;
    else if (fromSec) principal -= amtKrw;
  }
  return { totalInvestmentAssets, principal, cumulativePnl: totalInvestmentAssets - principal };
}

export interface NextLoanMaturity {
  name: string;
  maturityDate: string;
  balance: number;
}

/** 잔액이 남은 대출 중 만기가 가장 가까운(오늘 이후 포함, 지난 만기 우선) 대출 */
export function nearestLoanMaturity(loans: Loan[], balancesById: Map<string, number>): NextLoanMaturity | null {
  let best: NextLoanMaturity | null = null;
  for (const loan of loans) {
    const balance = balancesById.get(loan.id);
    if (balance == null || balance <= 0 || !loan.maturityDate) continue;
    if (!best || loan.maturityDate < best.maturityDate) {
      best = { name: loan.loanName || loan.institution, maturityDate: loan.maturityDate, balance };
    }
  }
  return best;
}
