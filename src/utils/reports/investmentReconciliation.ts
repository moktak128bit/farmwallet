// ---------------------------------------------------------------------------
// reportGenerator 분해 — 계좌별 성과 분해 + 투자 정산 (Investment reconciliation).
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// 규칙: 주식·코인 계좌를 하나의 "투자 세계"로 보고, 자본 흐름과 손익을 분리해 정산.
//   투자 총성과 = 현재 평가액 − 순투입원금
//   순투입원금  = 투자계좌 초기자본 + 누적 입금(이체) − 누적 출금(이체, 생활비 회수 포함)
// 매수/매도 총액은 계좌 안에서 현금↔주식 형태만 바꾼 "거래량"이라 손익·정산에 들어가지 않음.
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, StockPrice, StockTrade } from "../../types";
import { computeAccountBalances, computePositions } from "../../calculations";
import { buildClosedTradeRecords } from "../investmentRecord";
import { usdBalanceModeDelta } from "../tradeCashImpact";
import { getTodayKST } from "../date";
import { isUSDStock } from "../finance";
import { xirr, type CashFlowItem } from "../irr";
import { convertPositionAmount, realizedPnlKRWByTradeId, isDividendIncomeEntry, toKrwAmount } from "./shared";

export interface AccountPerformanceBreakdownRow {
  accountId: string;
  accountName: string;
  currentValue: number;
  irr?: number | null;
  ttwr?: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  dividendContribution: number;
  totalContribution: number;
}

function accountValueMapAtDate(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  date: string,
  fxRate?: number
): Map<string, number> {
  const filteredLedger = ledger.filter((entry) => entry.date <= date);
  // ⚠ account.usdBalance는 '현재' 달러 보유량(거래마다 갱신되는 러닝 값)이다. 과거 시점 평가액을 구하려면
  //   그 이후 잔액모드 거래분을 되돌려야 한다. 되돌리지 않으면 매수대금이 초기자본에서 미리 빠져
  //   currentValue와 상쇄되고, 매수액이 통째로 '수익'으로 둔갑한다(총성과·IRR 왜곡).
  //   이 함수는 타임라인 날짜마다 호출되므로 분할과 롤백을 한 번의 순회로 처리한다.
  const filteredTrades: StockTrade[] = [];
  const usdRollback = new Map<string, number>();
  for (const trade of trades) {
    if (trade.date <= date) {
      filteredTrades.push(trade);
      continue;
    }
    const delta = usdBalanceModeDelta(trade);
    if (delta === 0) continue;
    usdRollback.set(trade.accountId, (usdRollback.get(trade.accountId) ?? 0) + delta);
  }
  const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
  const positions = computePositions(filteredTrades, prices, accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const stockByAccount = new Map<string, number>();
  for (const position of positions) {
    const account = accountById.get(position.accountId);
    const converted = convertPositionAmount(position.marketValue, position.ticker, account, fxRate);
    stockByAccount.set(position.accountId, (stockByAccount.get(position.accountId) ?? 0) + converted);
  }

  const result = new Map<string, number>();
  for (const row of balances) {
    const usdCash =
      (row.account.type === "securities" || row.account.type === "crypto") && fxRate
        ? ((row.account.usdBalance ?? 0) - (usdRollback.get(row.account.id) ?? 0) + (row.usdTransferNet ?? 0)) * fxRate
        : 0;
    const stockValue = stockByAccount.get(row.account.id) ?? 0;
    result.set(row.account.id, row.currentBalance + usdCash + stockValue);
  }

  return result;
}

export function generateAccountPerformanceBreakdown(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  fxRate?: number
): AccountPerformanceBreakdownRow[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const today = getTodayKST();

  const timelineDates = Array.from(
    new Set<string>([today, ...ledger.map((entry) => entry.date), ...trades.map((trade) => trade.date)])
  )
    .filter(Boolean)
    .sort();

  const valuesByDate = new Map<string, Map<string, number>>();
  for (const date of timelineDates) {
    valuesByDate.set(date, accountValueMapAtDate(accounts, ledger, trades, prices, date, fxRate));
  }

  const flowsByAccountDate = new Map<string, Map<string, number>>();
  const addFlow = (accountId: string, date: string, amount: number) => {
    const accountFlows = flowsByAccountDate.get(accountId) ?? new Map<string, number>();
    accountFlows.set(date, (accountFlows.get(date) ?? 0) + amount);
    flowsByAccountDate.set(accountId, accountFlows);
  };

  // 외부 현금흐름 정의 (계좌 타입별):
  //  - 투자계좌(securities/crypto): 이체(transfer)만 — 헤드라인 IRR(computeInvestmentReconciliation)과
  //    동일 정의. 배당 income까지 flow로 넣으면 '내가 넣은 돈'으로 차감되어 배당 성과가 IRR·TTWR에서
  //    사라지고, 같은 행의 '합계'(배당 포함)와 다른 정의가 된다.
  //  - 비투자계좌(입출금·현금 등): income/expense도 외부 흐름 — 월급·생활비를 빼면 그 돈이 전부
  //    '계좌가 벌어낸 성과'로 계상되어 IRR이 수백 %·TTWR이 −100%로 발산한다.
  const investingFlowIds = new Set(
    accounts.filter((a) => a.type === "securities" || a.type === "crypto").map((a) => a.id)
  );
  for (const entry of ledger) {
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    if (entry.toAccountId && (entry.kind === "transfer" || !investingFlowIds.has(entry.toAccountId))) {
      addFlow(entry.toAccountId, entry.date, amount);
    }
    if (entry.fromAccountId && (entry.kind === "transfer" || !investingFlowIds.has(entry.fromAccountId))) {
      addFlow(entry.fromAccountId, entry.date, -amount);
    }
  }

  const realizedByTradeId = realizedPnlKRWByTradeId(trades, accounts, fxRate);
  const realizedByAccount = new Map<string, number>();
  for (const trade of trades) {
    if (trade.side !== "sell") continue;
    // pnl은 이미 거래시점 환율로 KRW 환산됨 — convertPositionAmount(현재환율) 재적용 금지
    const pnl = realizedByTradeId.get(trade.id) ?? 0;
    realizedByAccount.set(trade.accountId, (realizedByAccount.get(trade.accountId) ?? 0) + pnl);
  }

  const positions = computePositions(trades, prices, accounts);
  const unrealizedByAccount = new Map<string, number>();
  for (const position of positions) {
    const account = accountById.get(position.accountId);
    const converted = convertPositionAmount(position.pnl, position.ticker, account, fxRate);
    unrealizedByAccount.set(
      position.accountId,
      (unrealizedByAccount.get(position.accountId) ?? 0) + converted
    );
  }

  const dividendByAccount = new Map<string, number>();
  for (const entry of ledger) {
    if (!isDividendIncomeEntry(entry) || !entry.toAccountId) continue;
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    dividendByAccount.set(
      entry.toAccountId,
      (dividendByAccount.get(entry.toAccountId) ?? 0) + amount
    );
  }

  const firstDate = timelineDates[0] ?? today;
  const lastDate = timelineDates[timelineDates.length - 1] ?? today;

  const rows: AccountPerformanceBreakdownRow[] = [];

  for (const account of accounts) {
    const accountFlows = flowsByAccountDate.get(account.id) ?? new Map<string, number>();

    const startValue = valuesByDate.get(firstDate)?.get(account.id) ?? 0;
    const endValue = valuesByDate.get(lastDate)?.get(account.id) ?? 0;

    const irrFlows: CashFlowItem[] = [];
    if (Math.abs(startValue) > 0.000001) {
      irrFlows.push({ date: firstDate, amount: -startValue });
    }
    for (const date of timelineDates) {
      const externalFlow = accountFlows.get(date) ?? 0;
      if (Math.abs(externalFlow) <= 0.000001) continue;
      irrFlows.push({ date, amount: -externalFlow });
    }
    if (Math.abs(endValue) > 0.000001) {
      irrFlows.push({ date: lastDate, amount: endValue });
    }

    const irr = xirr(irrFlows) ?? undefined;

    let factor = 1;
    let periods = 0;
    for (let i = 1; i < timelineDates.length; i += 1) {
      const prevDate = timelineDates[i - 1];
      const date = timelineDates[i];
      const prevValue = valuesByDate.get(prevDate)?.get(account.id) ?? 0;
      const currentValue = valuesByDate.get(date)?.get(account.id) ?? 0;
      const flowOnDate = accountFlows.get(date) ?? 0;
      if (prevValue <= 0) continue;

      const periodReturn = (currentValue - flowOnDate) / prevValue - 1;
      if (!Number.isFinite(periodReturn)) continue;
      if (periodReturn <= -0.999999) continue;

      factor *= 1 + periodReturn;
      periods += 1;
    }

    const ttwr = periods > 0 ? factor - 1 : undefined;

    const realizedPnl = realizedByAccount.get(account.id) ?? 0;
    const unrealizedPnl = unrealizedByAccount.get(account.id) ?? 0;
    const dividendContribution = dividendByAccount.get(account.id) ?? 0;
    const totalContribution = realizedPnl + unrealizedPnl + dividendContribution;

    rows.push({
      accountId: account.id,
      accountName: account.name,
      currentValue: endValue,
      irr,
      ttwr,
      realizedPnl,
      unrealizedPnl,
      dividendContribution,
      totalContribution
    });
  }

  return rows.sort((a, b) => b.currentValue - a.currentValue);
}

/** 투자 정산 — 투자 계좌(주식·코인)만 집계 대상으로 삼는다 */
const RECONCILIATION_ACCOUNT_TYPES = new Set<Account["type"]>(["securities", "crypto"]);

export interface InvestmentReconciliationAccountRow {
  accountId: string;
  accountName: string;
  /** 초기자본 + 입금 − 출금 (계좌 간 이체 포함) */
  netContributed: number;
  currentValue: number;
  /** currentValue − netContributed */
  totalReturn: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dividendIncome: number;
  irr?: number | null;
}

/** 보유 종목의 미실현 손익 (평가수익·평가손실 공통) */
export interface InvestmentPositionPnlRow {
  accountName: string;
  ticker: string;
  name: string;
  /** 미실현 손익 (KRW) */
  pnl: number;
  /** 손익률 (비율, 예: -0.12 = −12%) */
  pnlRate: number;
}

/**
 * 분류 외 차이(residual) 원인 분해. 다섯 항목의 합은 residual과 정확히 일치한다.
 *
 * 근거 항등식 — 초기자본과 이체는 currentValue·netContributed 양쪽에 같은 금액으로 들어가 상쇄되므로
 *   totalReturn = Σ(계좌 입금 수입 − 계좌 직접 지출 + 저축성지출 유입 + 매매 현금영향 + 보유 평가액)
 * 이고, 여기서 pnlSum(실현+미실현+배당)을 빼면 남는 것이 아래 다섯 갈래다.
 */
export interface InvestmentResidualBreakdown {
  /** 투자계좌에서 이체가 아닌 지출(expense)로 직접 빠져나간 돈 — 보통 음수 */
  accountExpense: number;
  /** 배당이 아닌 수입(이자·환급 등)이 투자계좌로 들어온 것 — 보통 양수 */
  nonDividendIncome: number;
  /** 배당의 원화 환산 차이 — 계좌 잔액은 표기금액, 배당 집계는 환율 환산이라 생기는 간극 */
  dividendFxGap: number;
  /** USD 종목 매매·평가의 환율 환산 차이 — 원금에 붙은 환차손익은 실현·미실현 어디에도 안 들어간다 */
  fxTranslation: number;
  /** 위 넷으로 설명되지 않는 나머지 (수수료·초기 보유분·기록 누락 등). 정상 데이터면 0에 가깝다 */
  unexplained: number;
}

/** 월별 실현손익 (이익·손실 분리) */
export interface InvestmentMonthlyPnlRow {
  month: string; // yyyy-mm
  realizedGain: number;
  realizedLoss: number; // 0 이하
}

/** 확정(매도 완료)된 거래 한 건 */
export interface InvestmentRealizedTradeRow {
  date: string; // 매도일
  accountName: string;
  ticker: string;
  name: string;
  /** 실현손익 (KRW) */
  pnl: number;
  /** 매수원가 대비 수익률 (비율, 예: -0.12 = −12%) */
  returnRate: number;
}

export interface InvestmentReconciliation {
  /** 집계 대상 투자 계좌가 하나라도 있는지 */
  hasData: boolean;
  // ── 자본 흐름 ──
  initialCapital: number;
  deposits: number;
  withdrawals: number;
  netContributed: number;
  currentValue: number;
  totalReturn: number;
  returnRate: number | null;
  irr: number | null;
  // ── 손익 분해 (순액) ──
  realizedPnl: number;
  unrealizedPnl: number;
  dividendIncome: number;
  pnlSum: number;
  /** totalReturn − pnlSum: 초기 보유분·계좌 입금 수입 등으로 설명되지 않는 차이 */
  residual: number;
  /** residual을 원인별로 분해 (합계 = residual) */
  residualBreakdown: InvestmentResidualBreakdown;
  // ── 이익/손실 총액 (상계 전) ──
  realizedGain: number;     // 이익 본 매도 합계 (≥ 0)
  realizedLoss: number;     // 손실 본 매도 합계 (≤ 0)
  winningTrades: InvestmentRealizedTradeRow[];  // 확정수익 거래
  losingTrades: InvestmentRealizedTradeRow[];   // 확정손실 거래
  unrealizedGain: number;   // 평가이익 종목 합계 (≥ 0)
  unrealizedLoss: number;   // 평가손실 종목 합계 (≤ 0)
  winningPositions: InvestmentPositionPnlRow[];
  losingPositions: InvestmentPositionPnlRow[];
  monthlyPnl: InvestmentMonthlyPnlRow[];
  // ── 거래 활동량 (참고: 손익 아님) ──
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  accounts: InvestmentReconciliationAccountRow[];
}

/**
 * 투자 정산표 계산. accountPerformance(전체 기간 계좌 성과 분해)를 입력으로 받아
 * 평가액·실현/미실현/배당을 재사용하고, 자본 흐름(입금·출금·초기자본)만 추가로 계산한다.
 */
export function computeInvestmentReconciliation(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  accountPerformance: AccountPerformanceBreakdownRow[],
  fxRate?: number
): InvestmentReconciliation {
  const empty: InvestmentReconciliation = {
    hasData: false,
    initialCapital: 0, deposits: 0, withdrawals: 0, netContributed: 0,
    currentValue: 0, totalReturn: 0, returnRate: null, irr: null,
    realizedPnl: 0, unrealizedPnl: 0, dividendIncome: 0, pnlSum: 0, residual: 0,
    residualBreakdown: {
      accountExpense: 0, nonDividendIncome: 0, dividendFxGap: 0, fxTranslation: 0, unexplained: 0
    },
    realizedGain: 0, realizedLoss: 0, unrealizedGain: 0, unrealizedLoss: 0,
    winningTrades: [], losingTrades: [],
    winningPositions: [], losingPositions: [], monthlyPnl: [],
    buyVolume: 0, sellVolume: 0, tradeCount: 0, accounts: []
  };

  const investingAccounts = accounts.filter((a) => RECONCILIATION_ACCOUNT_TYPES.has(a.type));
  if (investingAccounts.length === 0) return empty;

  const investingIds = new Set(investingAccounts.map((a) => a.id));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const perfById = new Map(accountPerformance.map((r) => [r.accountId, r]));

  // 초기자본 C0 — 어떤 거래도 반영되기 전 투자계좌의 기본 잔액
  const earlyMap = accountValueMapAtDate(accounts, ledger, trades, prices, "1900-01-01", fxRate);
  const contributedByAccount = new Map<string, number>();
  let initialCapital = 0;
  for (const a of investingAccounts) {
    const base = earlyMap.get(a.id) ?? 0;
    contributedByAccount.set(a.id, base);
    initialCapital += base;
  }

  // 입금·출금 — 투자계좌 경계를 넘는 이체(transfer)만 집계
  let deposits = 0;
  let withdrawals = 0;
  const netFlowByDate = new Map<string, number>(); // 투자 세계로의 순유입 (IRR용)
  for (const entry of ledger) {
    if (entry.kind !== "transfer") continue;
    // 환율 미로드 시 USD 이체는 건너뛴다 — toKrwByRate는 fxRate가 없으면 달러 액면을 그대로 원화로
    // 돌려주는데, 평가액 쪽 usdCash는 fxRate 없으면 통째로 0이라 한쪽만 세면 순투입원금이 부풀어
    // 없던 손실이 잡힌다. 양쪽을 같은 조건으로 묶어 대칭을 유지한다.
    if (entry.currency === "USD" && !fxRate) continue;
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    if (!(amount > 0)) continue;
    const fromInv = !!entry.fromAccountId && investingIds.has(entry.fromAccountId);
    const toInv = !!entry.toAccountId && investingIds.has(entry.toAccountId);
    if (toInv) {
      contributedByAccount.set(entry.toAccountId!, (contributedByAccount.get(entry.toAccountId!) ?? 0) + amount);
    }
    if (fromInv) {
      contributedByAccount.set(entry.fromAccountId!, (contributedByAccount.get(entry.fromAccountId!) ?? 0) - amount);
    }
    if (toInv && !fromInv) {
      deposits += amount;
      netFlowByDate.set(entry.date, (netFlowByDate.get(entry.date) ?? 0) + amount);
    }
    if (fromInv && !toInv) {
      withdrawals += amount;
      netFlowByDate.set(entry.date, (netFlowByDate.get(entry.date) ?? 0) - amount);
    }
  }

  // 평가액·손익 — accountPerformance 재사용
  let currentValue = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let dividendIncome = 0;
  const accountRows: InvestmentReconciliationAccountRow[] = investingAccounts.map((a) => {
    const perf = perfById.get(a.id);
    const cv = perf?.currentValue ?? 0;
    const nc = contributedByAccount.get(a.id) ?? 0;
    const realized = perf?.realizedPnl ?? 0;
    const unrealized = perf?.unrealizedPnl ?? 0;
    const dividend = perf?.dividendContribution ?? 0;
    currentValue += cv;
    realizedPnl += realized;
    unrealizedPnl += unrealized;
    dividendIncome += dividend;
    return {
      accountId: a.id,
      accountName: a.name,
      netContributed: nc,
      currentValue: cv,
      totalReturn: cv - nc,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      dividendIncome: dividend,
      irr: perf?.irr ?? null
    };
  });
  accountRows.sort((a, b) => b.currentValue - a.currentValue);

  // 거래 활동량 + 실현손익 이익/손실 분리 + 확정 거래 목록 + 월별 추이
  // 실현손익·매수/매도 활동량 모두 '거래시점 환율(fxRateAtTrade)' 기준 KRW로 산출한다.
  // accountRows.realizedPnl(perf)·대시보드·투자기록 카드와 동일 정의 — 과거 USD 매도를
  // '현재' 환율로 환산하면 환변동분이 손익에 섞여 같은 화면 안에서도 값이 어긋난다(불변식: 과거손익 보존).
  const closedRecords = buildClosedTradeRecords(trades, accounts, fxRate ?? undefined);
  const closedByTradeId = new Map(closedRecords.map((r) => [r.tradeId, r]));
  // 거래 한 건의 totalAmount를 거래시점 환율로 환산 (USD 종목만; 없으면 현재 환율 폴백).
  const tradeAmountKRW = (t: StockTrade): number => {
    if (!isUSDStock(t.ticker)) return t.totalAmount;
    const fx = t.fxRateAtTrade && t.fxRateAtTrade > 0 ? t.fxRateAtTrade : (fxRate && fxRate > 0 ? fxRate : 0);
    return fx > 0 ? t.totalAmount * fx : 0;
  };
  let buyVolume = 0;
  let sellVolume = 0;
  let tradeCount = 0;
  let realizedGain = 0;
  let realizedLoss = 0;
  const winningTrades: InvestmentRealizedTradeRow[] = [];
  const losingTrades: InvestmentRealizedTradeRow[] = [];
  const monthlyPnlMap = new Map<string, { gain: number; loss: number }>();
  for (const t of trades) {
    if (!investingIds.has(t.accountId)) continue;
    const account = accountById.get(t.accountId);
    tradeCount += 1;
    if (t.side === "buy") {
      buyVolume += tradeAmountKRW(t);
      continue;
    }
    sellVolume += tradeAmountKRW(t);
    const rec = closedByTradeId.get(t.id);
    const pnl = rec?.realizedPnlKRW ?? 0;
    const costBasis = rec?.costBasisKRW ?? 0;
    const month = t.date.slice(0, 7);
    const bucket = monthlyPnlMap.get(month) ?? { gain: 0, loss: 0 };
    if (pnl >= 0) {
      realizedGain += pnl;
      bucket.gain += pnl;
    } else {
      realizedLoss += pnl;
      bucket.loss += pnl;
    }
    monthlyPnlMap.set(month, bucket);
    const tradeRow: InvestmentRealizedTradeRow = {
      date: t.date,
      accountName: account?.name ?? t.accountId,
      ticker: t.ticker,
      name: t.name,
      pnl,
      returnRate: costBasis > 0 ? pnl / costBasis : 0
    };
    if (pnl >= 0) winningTrades.push(tradeRow);
    else losingTrades.push(tradeRow);
  }
  winningTrades.sort((a, b) => b.pnl - a.pnl); // 수익 큰 거래 먼저
  losingTrades.sort((a, b) => a.pnl - b.pnl); // 손실 큰 거래 먼저
  const monthlyPnl: InvestmentMonthlyPnlRow[] = Array.from(monthlyPnlMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, realizedGain: v.gain, realizedLoss: v.loss }));

  // 미실현 손익 이익/손실 분리 + 평가수익·평가손실 종목 목록
  let unrealizedGain = 0;
  let unrealizedLoss = 0;
  const winningPositions: InvestmentPositionPnlRow[] = [];
  const losingPositions: InvestmentPositionPnlRow[] = [];
  const positions = computePositions(trades, prices, accounts);
  for (const p of positions) {
    if (!investingIds.has(p.accountId)) continue;
    const account = accountById.get(p.accountId);
    const pnl = convertPositionAmount(p.pnl, p.ticker, account, fxRate);
    const row: InvestmentPositionPnlRow = {
      accountName: account?.name ?? p.accountId,
      ticker: p.ticker,
      name: p.name,
      pnl,
      pnlRate: p.pnlRate
    };
    if (pnl > 0) {
      unrealizedGain += pnl;
      winningPositions.push(row);
    } else if (pnl < 0) {
      unrealizedLoss += pnl;
      losingPositions.push(row);
    }
  }
  winningPositions.sort((a, b) => b.pnl - a.pnl); // 수익 큰 종목 먼저
  losingPositions.sort((a, b) => a.pnl - b.pnl); // 손실 큰 종목 먼저

  const netContributed = initialCapital + deposits - withdrawals;
  const totalReturn = currentValue - netContributed;
  const pnlSum = realizedPnl + unrealizedPnl + dividendIncome;
  const residual = totalReturn - pnlSum;

  // ── 분류 외 차이(residual) 원인 분해 ──
  // 이체가 아닌 경로로 투자계좌 잔액이 변한 것들이 residual에 쌓인다. 아래 넷을 정확히 계산하고
  // 나머지는 unexplained로 남겨 합계가 항상 residual과 일치하게 만든다(표가 어긋나지 않도록).
  //
  // ⚠ 계좌 잔액(computeAccountBalances)은 income/expense를 '표기금액 그대로' 더한다(환산 없음).
  //    반면 배당 집계(dividendIncome)는 toKrwAmount로 환산한다 → USD 배당이 있으면 그 차이가
  //    dividendFxGap으로 드러난다. 여기서 임의로 맞추지 말 것 — 진단 대상 그 자체다.
  let accountIncomeRaw = 0;
  let dividendIncomeRaw = 0;
  let accountExpense = 0;
  for (const entry of ledger) {
    if (entry.kind === "income") {
      if (!entry.toAccountId || !investingIds.has(entry.toAccountId)) continue;
      accountIncomeRaw += entry.amount;
      if (isDividendIncomeEntry(entry)) dividendIncomeRaw += entry.amount;
    } else if (entry.kind === "expense") {
      // 저축성지출은 투자계좌로 '들어오는' 지출이라 잔액을 늘린다(computeAccountBalances와 동일 부호)
      if (entry.fromAccountId && investingIds.has(entry.fromAccountId)) accountExpense -= entry.amount;
      if (entry.toAccountId && investingIds.has(entry.toAccountId)) accountExpense += entry.amount;
    }
  }

  // USD 종목 버킷 — 매매 현금영향(과거 환율 기준)과 평가액(현재 환율 기준)의 간극이 곧 환차.
  // 판정은 convertPositionAmount와 같은 기준(티커 또는 계좌 통화)을 쓴다.
  const isUsdBucket = (ticker: string, account: Account | undefined) =>
    isUSDStock(ticker) || account?.currency === "USD";
  // 매매로 실제 오간 원금(KRW). 두 모드는 상호 배타적이라 나란히 더해도 이중계상되지 않는다:
  //   원화 현금모드 → cashImpact(거래시점 환율 원화), 델타 0
  //   달러 잔액모드 → cashImpact 0, 달러 증감 × 현재 환율
  // 잔액모드를 빼먹으면 매수가 '0원'으로 잡혀 분해가 통째로 어긋난다.
  let usdPrincipalFlow = 0;
  let usdRealized = 0;
  for (const t of trades) {
    if (!investingIds.has(t.accountId)) continue;
    const account = accountById.get(t.accountId);
    if (!isUsdBucket(t.ticker, account)) continue;
    const impact = Number(t.cashImpact);
    usdPrincipalFlow += Number.isFinite(impact) ? impact : 0;
    usdPrincipalFlow += usdBalanceModeDelta(t) * (fxRate ?? 0);
    if (t.side === "sell") usdRealized += closedByTradeId.get(t.id)?.realizedPnlKRW ?? 0;
  }
  let usdStockValue = 0;
  let usdUnrealized = 0;
  for (const p of positions) {
    if (!investingIds.has(p.accountId)) continue;
    const account = accountById.get(p.accountId);
    if (!isUsdBucket(p.ticker, account)) continue;
    usdStockValue += convertPositionAmount(p.marketValue, p.ticker, account, fxRate);
    usdUnrealized += convertPositionAmount(p.pnl, p.ticker, account, fxRate);
  }

  const nonDividendIncome = accountIncomeRaw - dividendIncomeRaw;
  const dividendFxGap = dividendIncomeRaw - dividendIncome;
  const fxTranslation = usdPrincipalFlow + usdStockValue - usdRealized - usdUnrealized;
  const residualBreakdown: InvestmentResidualBreakdown = {
    accountExpense,
    nonDividendIncome,
    dividendFxGap,
    fxTranslation,
    unexplained: residual - accountExpense - nonDividendIncome - dividendFxGap - fxTranslation
  };

  // 포트폴리오 IRR — 초기자본·이체 순유입을 음(−), 현재 평가액을 양(+)으로
  const today = getTodayKST();
  let firstDate = today;
  for (const e of ledger) if (e.date && e.date < firstDate) firstDate = e.date;
  for (const t of trades) if (t.date && t.date < firstDate) firstDate = t.date;
  const irrFlows: CashFlowItem[] = [];
  if (Math.abs(initialCapital) > 0.000001) irrFlows.push({ date: firstDate, amount: -initialCapital });
  for (const [date, net] of Array.from(netFlowByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Math.abs(net) > 0.000001) irrFlows.push({ date, amount: -net });
  }
  if (Math.abs(currentValue) > 0.000001) irrFlows.push({ date: today, amount: currentValue });
  const irr = irrFlows.length >= 2 ? (xirr(irrFlows) ?? null) : null;

  return {
    hasData: true,
    initialCapital,
    deposits,
    withdrawals,
    netContributed,
    currentValue,
    totalReturn,
    returnRate: netContributed > 0 ? totalReturn / netContributed : null,
    irr,
    realizedPnl,
    unrealizedPnl,
    dividendIncome,
    pnlSum,
    residual,
    residualBreakdown,
    realizedGain,
    realizedLoss,
    winningTrades,
    losingTrades,
    unrealizedGain,
    unrealizedLoss,
    winningPositions,
    losingPositions,
    monthlyPnl,
    buyVolume,
    sellVolume,
    tradeCount,
    accounts: accountRows
  };
}
