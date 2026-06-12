import type { LedgerEntry, Account } from "../types";
import { getTodayKST } from "./date";

/**
 * RFC 4180 호환 escape:
 * - 콤마, 따옴표, CR, LF 중 하나라도 있으면 따옴표로 감싸고 내부 따옴표는 ""로 escape.
 * - 내부에 LF만 있고 quote 안 했던 기존 코드는 Excel/spreadsheet에서 줄 분리 오류 발생.
 */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
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

  const bom = "﻿"; // Excel UTF-8 인식용 BOM
  // RFC 4180은 CRLF 줄바꿈 명시. Windows Excel 호환성도 안전.
  const csv = bom + [headers, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // 기본 파일명 날짜는 KST 기준 — UTC 사용 시 오전 9시 이전엔 전날 날짜가 찍힘
  a.download = filename || `farmwallet_${getTodayKST()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
