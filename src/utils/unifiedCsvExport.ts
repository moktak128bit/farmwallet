import type { LedgerEntry, StockTrade, Account } from "../types";

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `"${s}"`;
}

/**
 * 가계부(ledger)와 주식 거래(trades)를 일자순으로 통합한 CSV 문자열 생성.
 * 한 파일에 모든 기록을 타입별 컬럼으로 담고, 계좌 ID는 계좌명으로 치환.
 */
export function buildUnifiedCsv(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  accounts: Account[]
): string {
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name ?? a.id]));

  const headers = [
    "데이터구분",
    "일자",
    "구분",
    "대분류",
    "세부",
    "적요",
    "금액",
    "통화",
    "출금계좌",
    "입금계좌",
    "메모",
    "태그",
    "계좌",
    "티커",
    "종목명",
    "매수매도",
    "수량",
    "단가",
    "총액",
    "수수료",
    "id"
  ];

  type Row = (string | number)[];
  const withDate: { date: string; row: Row }[] = [];

  for (const l of ledger) {
    const kindLabel = l.kind === "income" ? "수입" : l.kind === "expense" ? "지출" : "이체";
    withDate.push({
      date: l.date,
      row: [
        "가계부",
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
        "", "", "", "", "", "", "", "",
        l.id
      ]
    });
  }

  for (const t of trades) {
    const sideLabel = t.side === "buy" ? "매수" : "매도";
    withDate.push({
      date: t.date,
      row: [
        "주식",
        t.date,
        sideLabel,
        "", "", "",
        "",
        "",
        "",
        "", "",
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
