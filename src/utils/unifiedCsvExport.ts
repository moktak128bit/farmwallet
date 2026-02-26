import type { Account, CategoryPresets, LedgerEntry, StockTrade } from "../types";
import { getSavingsCategories } from "./category";

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

  for (const t of trades) {
    const sideLabel = t.side === "buy" ? "buy" : "sell";
    withDate.push({
      date: t.date,
      row: [
        "trade",
        t.date,
        sideLabel,
        "",
        "",
        "",
        "",
        "",
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
