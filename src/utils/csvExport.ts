import type { LedgerEntry, Account } from "../types";

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportLedgerCsv(
  entries: LedgerEntry[],
  accounts: Account[],
  filename?: string
): void {
  const acctName = (id: string | undefined) => {
    if (!id) return "";
    return accounts.find((a) => a.id === id)?.name || id;
  };

  const kindLabel: Record<string, string> = {
    income: "수입",
    expense: "지출",
    transfer: "이체",
  };

  const headers = ["날짜", "종류", "대분류", "중분류", "소분류", "메모", "금액", "출금계좌", "입금계좌", "고정지출", "태그"];
  const rows = entries.map((l) => [
    l.date,
    kindLabel[l.kind] || l.kind,
    l.category || "",
    l.subCategory || "",
    l.detailCategory || "",
    l.description || "",
    String(l.amount),
    acctName(l.fromAccountId),
    acctName(l.toAccountId),
    l.isFixedExpense ? "Y" : "",
    (l.tags || []).join(";"),
  ]);

  const bom = "\uFEFF";
  const csv = bom + [headers, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `farmwallet_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
