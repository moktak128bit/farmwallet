import type { Account, LedgerEntry, LedgerKind, LedgerTemplate, StockTrade } from "../types";
import { formatUSD, formatKRW } from "./formatter";
import { isUSDStock } from "./finance";
import { getTodayKST } from "./date";
import { formatAmount, parseAmount } from "./parseAmount";

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
    // 수익은 income(가계부 일별 소계에 +), 손실은 expense(소계에 -). 둘 다 amount는 절댓값.
    // 이전엔 둘 다 expense라 일별 소계에서 투자수익이 음수처럼 빼져 표시되던 문제 수정.
    return {
      id: `trade-${t.id}`,
      date: t.date,
      kind: isProfit ? "income" : "expense",
      category: isProfit ? "수입" : "재테크",
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

/** 템플릿 적용 결과 — 폼 상태 + 존재하지 않아 비운 계좌 id 목록 */
export interface TemplateApplyResult {
  form: LedgerFormState;
  clearedAccountIds: string[];
}

/**
 * LedgerTemplate → LedgerFormState (순수 함수).
 * 날짜=오늘(KST), id=undefined(새 항목). 존재하지 않는 계좌는 비우고 clearedAccountIds로 보고.
 * startCopy 경유 금지 — startCopy는 저장 스키마(category="지출")를 mainCategory에 넣는 다른 경로.
 */
export function ledgerTemplateToForm(
  t: LedgerTemplate,
  accounts: ReadonlyArray<Pick<Account, "id">>
): TemplateApplyResult {
  const exists = (id?: string) => !!id && accounts.some((a) => a.id === id);
  const clearedAccountIds: string[] = [];
  let fromAccountId = "";
  let toAccountId = "";
  if (t.kind !== "income" && t.fromAccountId) {
    if (exists(t.fromAccountId)) fromAccountId = t.fromAccountId;
    else clearedAccountIds.push(t.fromAccountId);
  }
  if (t.kind !== "expense" && t.toAccountId) {
    if (exists(t.toAccountId)) toAccountId = t.toAccountId;
    else clearedAccountIds.push(t.toAccountId);
  }
  return {
    form: {
      ...createDefaultLedgerForm(),
      kind: t.kind,
      mainCategory: t.kind === "transfer" ? "이체" : t.kind === "income" ? "" : (t.mainCategory ?? ""),
      subCategory: t.subCategory ?? "",
      description: t.description ?? "",
      fromAccountId,
      toAccountId,
      amount: t.amount && t.amount > 0 ? formatAmount(String(t.amount)) : ""
    },
    clearedAccountIds
  };
}

/**
 * 현재 폼 → LedgerTemplate (순수 함수). id는 호출 측이 newIdWithPrefix("LT")로 생성해 전달.
 * 템플릿에 currency 필드가 없으므로 USD 폼의 amount는 저장하지 않음 (적용 시 KRW 오해석 방지).
 */
export function ledgerFormToTemplate(
  form: LedgerFormState,
  kind: LedgerKind,
  name: string,
  id: string
): LedgerTemplate {
  const parsed = form.currency === "USD" ? 0 : parseAmount(form.amount);
  return {
    id,
    name: name.trim(),
    kind,
    mainCategory: kind === "income" ? undefined : (form.mainCategory || undefined),
    subCategory: form.subCategory || undefined,
    description: form.description.trim() || undefined,
    amount: parsed > 0 ? parsed : undefined,
    fromAccountId: kind !== "income" ? (form.fromAccountId || undefined) : undefined,
    toAccountId: kind !== "expense" ? (form.toAccountId || undefined) : undefined
  };
}
