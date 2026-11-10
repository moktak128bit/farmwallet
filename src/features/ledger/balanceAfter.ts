/**
 * 가계부 출금/입금 셀의 "금액 · 그 행 직후 잔액" — 현재 잔액(잔액 엔진)에서 날짜순으로 역산한다.
 * 통화별로 따로 역산: 잔액 엔진(computeAccountBalances)과 같은 규칙으로 USD '이체'는 달러 잔고
 * (account.usdBalance + usdTransferNet)에, 나머지는 원화 잔고에. 예전엔 원화 잔액 94,611에 $41.19를 섞어
 * "CMA +$41.190 · $94,652.000"처럼 원화 숫자를 달러로 찍었다. (LedgerPage에서 분리 — 순수 함수·테스트 가능)
 */
import type { AccountBalanceRow, LedgerEntry, StockTrade } from "../../types";

export type BalanceCell = { amount: number; balance: number; currency: "KRW" | "USD" };

export function computeBalanceAfterByLedgerId(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  balances: AccountBalanceRow[]
): Map<string, { from?: BalanceCell; to?: BalanceCell }> {
  type Cell = BalanceCell;
  const result = new Map<string, { from?: Cell; to?: Cell }>();
  const balanceById = new Map<string, number>();
  const usdBalanceById = new Map<string, number>();
  for (const row of balances) {
    balanceById.set(row.account.id, row.currentBalance);
    usdBalanceById.set(row.account.id, (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0));
  }
  type Event = { type: "ledger"; id: string; date: string; l: LedgerEntry } | { type: "trade"; id: string; date: string; t: StockTrade };
  // 같은 날짜 내 잔액 귀속 순서 = 표시 순서와 동일 기준이라야 표를 위→아래로 읽을 때 잔액이 맞는다.
  // id 사전순 tie-break는 ☰ 드래그/▲▼로 행 순서를 바꿔도 반영되지 않아 잔액 열이 모순됐다.
  // 표시 순서: combinedLedger가 [...ledger, ...trades]라 같은 날짜면 ledger가 trade보다 먼저,
  // 각 그룹 내부는 원본 배열 인덱스 순.
  const ledgerIndex = new Map(ledger.map((l, i) => [l.id, i]));
  const tradeIndex = new Map(trades.map((t, i) => [t.id, i]));
  const events: Event[] = [
    ...ledger.map((l) => ({ type: "ledger" as const, id: l.id, date: l.date, l })),
    ...trades.map((t) => ({ type: "trade" as const, id: t.id, date: t.date, t }))
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.type !== b.type) return a.type === "ledger" ? -1 : 1;
    if (a.type === "ledger") return (ledgerIndex.get(a.id) ?? 0) - (ledgerIndex.get(b.id) ?? 0);
    return (tradeIndex.get(a.id) ?? 0) - (tradeIndex.get(b.id) ?? 0);
  });
  const futureKrw = new Map<string, number>();
  const futureUsd = new Map<string, number>();
  const addImpact = (m: Map<string, number>, accId: string, delta: number) =>
    m.set(accId, (m.get(accId) ?? 0) + delta);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "ledger") {
      const l = e.l;
      // 잔액 엔진은 USD '이체'만 달러 잔고로 분리한다(수입·지출은 원화 합산) — 같은 규칙이라야 끝 잔액이 계좌 탭과 맞는다
      const usd = l.kind === "transfer" && l.currency === "USD";
      const future = usd ? futureUsd : futureKrw;
      const current = usd ? usdBalanceById : balanceById;
      const currency: Cell["currency"] = usd ? "USD" : "KRW";
      let fromImpact = 0;
      let toImpact = 0;
      if (l.kind === "income" && l.toAccountId) toImpact = l.amount;
      else if (l.kind === "expense") {
        if (l.fromAccountId) fromImpact = -l.amount;
        if (l.toAccountId) toImpact = l.amount;
      } else if (l.kind === "transfer") {
        if (l.fromAccountId) fromImpact = -l.amount;
        if (l.toAccountId) toImpact = l.amount;
      }
      const fromBalance = l.fromAccountId
        ? (current.get(l.fromAccountId) ?? 0) - (future.get(l.fromAccountId) ?? 0)
        : 0;
      const toBalance = l.toAccountId
        ? (current.get(l.toAccountId) ?? 0) - (future.get(l.toAccountId) ?? 0)
        : 0;
      result.set(e.id, {
        from: l.fromAccountId ? { amount: fromImpact, balance: fromBalance, currency } : undefined,
        to: l.toAccountId ? { amount: toImpact, balance: toBalance, currency } : undefined
      });
      if (l.fromAccountId) addImpact(future, l.fromAccountId, fromImpact);
      if (l.toAccountId) addImpact(future, l.toAccountId, toImpact);
    } else {
      const t = e.t;
      addImpact(futureKrw, t.accountId, t.cashImpact);
    }
  }
  return result;
}
