import type { LedgerEntry, LedgerKind, StockTrade } from "../types";
import { formatUSD, formatKRW } from "./formatter";
import { isUSDStock } from "./finance";
import { getTodayKST } from "./date";

/** 가계부에 표시하는 한 행: ledger 항목 또는 주식 거래를 ledger 형태로 만든 것 */
export type LedgerDisplayRow = LedgerEntry & { _tradeId?: string };

/** 기록표: 수입·지출은 할인 전 금액 = 순액 + 할인. 이체 등은 amount만. */
export function ledgerEntryGross(l: Pick<LedgerEntry, "kind" | "amount" | "discountAmount">): number {
  if (l.kind === "income" || l.kind === "expense") {
    return l.amount + (l.discountAmount ?? 0);
  }
  return l.amount;
}

/** 주식 거래를 가계부 행 형태로 변환. 매도는 실현손익 있으면 그것 기준, 없으면 totalAmount. */
export function tradeToLedgerRow(
  t: StockTrade,
  realizedPnlByTradeId: Map<string, number>
): LedgerDisplayRow {
  const isSell = t.side === "sell";
  const isUsd = isUSDStock(t.ticker);
  const priceStr = isUsd ? `${formatUSD(t.price)}` : `${formatKRW(Math.round(t.price))}`;
  const qty = t.quantity % 1 === 0 ? String(t.quantity) : t.quantity.toFixed(2);
  const label = t.name ? `${t.ticker} ${t.name}` : t.ticker;
  const action = isSell ? "매도" : "매수";
  const description = `${label} ${qty}주 ${priceStr}에 ${action}`;
  const rawPnl = isSell ? (realizedPnlByTradeId.get(t.id) ?? t.totalAmount) : t.totalAmount;
  if (isSell) {
    const isProfit = rawPnl >= 0;
    return {
      id: `trade-${t.id}`,
      date: t.date,
      kind: "expense",
      category: "재테크",
      subCategory: isProfit ? "투자수익" : "투자손실",
      description,
      amount: Math.abs(rawPnl),
      toAccountId: isProfit ? t.accountId : undefined,
      fromAccountId: isProfit ? undefined : t.accountId,
      currency: isUsd ? "USD" : "KRW",
      _tradeId: t.id,
    };
  }
  return {
    id: `trade-${t.id}`,
    date: t.date,
    kind: "expense",
    category: "재테크",
    subCategory: "주식매수",
    description,
    amount: Math.abs(rawPnl),
    fromAccountId: t.accountId,
    toAccountId: undefined,
    currency: isUsd ? "USD" : "KRW",
    _tradeId: t.id,
  };
}

export interface LedgerFormState {
  id?: string;
  date: string;
  kind: LedgerKind;
  isFixedExpense: boolean;
  mainCategory: string;
  subCategory: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  discountAmount: string;
  currency: "KRW" | "USD";
  tags: string[];
}

/** 기본 폼 상태 팩토리. 날짜는 오늘(KST), 종류는 income 기본. */
export function createDefaultLedgerForm(): LedgerFormState {
  return {
    id: undefined,
    date: getTodayKST(),
    kind: "income",
    isFixedExpense: false,
    mainCategory: "",
    subCategory: "",
    description: "",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    discountAmount: "",
    currency: "KRW",
    tags: [],
  };
}
