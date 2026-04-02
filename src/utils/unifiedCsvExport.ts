import type { Account, CategoryPresets, LedgerEntry, StockTrade } from "../types";
import { getSavingsCategories } from "./category";
import { computeRealizedPnlByTradeId } from "../calculations";
import { isUSDStock } from "./finance";

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
  categoryPresets?: CategoryPresets
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

  const realizedPnlByTradeId = computeRealizedPnlByTradeId(trades);
  for (const t of trades) {
    const sideLabel = t.side === "buy" ? "buy" : "sell";
    const isSell = t.side === "sell";
    const rawPnl = isSell ? (realizedPnlByTradeId.get(t.id) ?? t.totalAmount) : 0;
    const subCategory = isSell ? (rawPnl >= 0 ? "투자수익" : "투자손실") : "";
    const kind = isSell ? "expense" : sideLabel;
    const category = isSell ? "재테크" : "";
    const description = isSell ? subCategory : "";
    const amount = isSell ? Math.abs(Number(rawPnl)) : "";
    const currency = isUSDStock(t.ticker) ? "USD" : "KRW";
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
        "",
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
