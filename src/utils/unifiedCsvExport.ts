import type { Account, CategoryPresets, LedgerEntry, StockTrade } from "../types";
import { getSavingsCategories } from "./category";
import { buildClosedTradeRecords } from "./investmentRecord";

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `"${s}"`;
}

/**
 * Build a date-sorted unified CSV of ledger + stock trades.
 */
export function buildUnifiedCsv(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  accounts: Account[],
  categoryPresets?: CategoryPresets,
  fxRate?: number | null
): string {
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name ?? a.id]));
  const savingsCategories = new Set(getSavingsCategories(categoryPresets));

  const headers = [
    "source",
    "date",
    "kind",
    "category",
    "subCategory",
    "description",
    "amount",
    "currency",
    "fromAccount",
    "toAccount",
    "note",
    "tags",
    "tradeAccount",
    "ticker",
    "stockName",
    "side",
    "quantity",
    "price",
    "totalAmount",
    "fee",
    "id"
  ];

  type Row = (string | number)[];
  const withDate: { date: string; row: Row }[] = [];

  for (const l of ledger) {
    const kindLabel =
      l.kind === "income"
        ? "income"
        : l.kind === "transfer"
          ? "transfer"
          : savingsCategories.has(l.category ?? "")
            ? "investment"
            : "expense";

    withDate.push({
      date: l.date,
      row: [
        "ledger",
        l.date,
        kindLabel,
        l.category ?? "",
        l.subCategory ?? "",
        l.description ?? "",
        l.amount,
        l.currency ?? "KRW",
        l.fromAccountId ? accountNameById.get(l.fromAccountId) ?? l.fromAccountId : "",
        l.toAccountId ? accountNameById.get(l.toAccountId) ?? l.toAccountId : "",
        l.note ?? "",
        Array.isArray(l.tags) ? l.tags.join(",") : "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        l.id
      ]
    });
  }

  // KRW 실현손익(매수·매도 각각 fxRateAtTrade 환산) — 가계부 화면의 매도 가상 행과 동일 숫자.
  // 동일 통화 FIFO(computeRealizedPnlByTradeId)는 USD 손익이 달러 액면으로 나가 환차손익이 빠지고
  // 화면과 다른 값(부호까지 반전 가능)이 내보내졌다.
  const realizedKrwByTradeId = new Map<string, number>();
  for (const r of buildClosedTradeRecords(trades, accounts, fxRate ?? undefined)) {
    realizedKrwByTradeId.set(r.tradeId, r.realizedPnlKRW);
  }
  for (const t of trades) {
    const sideLabel = t.side === "buy" ? "buy" : "sell";
    const isSell = t.side === "sell";
    // FIFO 미매칭 매도(선행 매수 없음)는 매도대금 전액을 손익으로 잡지 않고 0 처리 + 비고 표기
    const fifoMatched = !isSell || realizedKrwByTradeId.has(t.id);
    const rawPnl = isSell ? (realizedKrwByTradeId.get(t.id) ?? 0) : 0;
    const isGain = rawPnl >= 0;
    const subCategory = isSell ? (isGain ? "투자수익" : "투자손실") : "";
    // dataService v8 규약: 투자수익 → kind=income/category=수입, 투자손실 → kind=expense/category=재테크
    const kind = isSell ? (isGain ? "income" : "expense") : sideLabel;
    const category = isSell ? (isGain ? "수입" : "재테크") : "";
    const description = isSell ? subCategory : "";
    const amount = isSell ? Math.abs(Number(rawPnl)) : "";
    const note = fifoMatched ? "" : "FIFO 미매칭 매도 — 손익 0 처리";
    const currency = "KRW"; // 실현손익은 KRW 환산값 — USD 표기 시 수입 측에서 이중 환산 위험
    withDate.push({
      date: t.date,
      row: [
        "trade",
        t.date,
        kind,
        category,
        subCategory,
        description,
        amount,
        isSell ? currency : "",
        "",
        "",
        note,
        "",
        accountNameById.get(t.accountId) ?? t.accountId,
        t.ticker,
        t.name ?? "",
        sideLabel,
        t.quantity,
        t.price,
        t.totalAmount,
        t.fee,
        t.id
      ]
    });
  }

  withDate.sort((a, b) => a.date.localeCompare(b.date));

  const headerLine = headers.map(escapeCsvCell).join(",");
  const dataLines = withDate.map((r) => r.row.map(escapeCsvCell).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}
