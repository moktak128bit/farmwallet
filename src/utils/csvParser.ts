import Papa from "papaparse";
import type { LedgerEntry } from "../types";

export interface CSVColumnMapping {
  date?: number;
  description?: number;
  amount?: number;
  category?: number;
  subCategory?: number;
  fromAccount?: number;
  toAccount?: number;
  kind?: number;
}

export interface ParsedRow {
  date?: string;
  description?: string;
  amount?: number;
  category?: string;
  subCategory?: string;
  fromAccount?: string;
  toAccount?: string;
  kind?: "income" | "expense" | "transfer";
}

export function parseCSV(
  file: File,
  mapping: CSVColumnMapping,
  onComplete: (rows: ParsedRow[], errors: string[]) => void
) {
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: (results) => {
      const rows: ParsedRow[] = [];
      const errors: string[] = [];

      results.data.forEach((row: any[], index: number) => {
        try {
          const parsed: ParsedRow = {};

          if (mapping.date !== undefined && row[mapping.date]) {
            const dateStr = String(row[mapping.date]).trim();
            // 다양한 날짜 형식 파싱
            const date = parseDate(dateStr);
            if (date) {
              parsed.date = date;
            } else {
              errors.push(`행 ${index + 1}: 날짜 형식 오류 (${dateStr})`);
            }
          }

          if (mapping.description !== undefined && row[mapping.description]) {
            parsed.description = String(row[mapping.description]).trim();
          }

          if (mapping.amount !== undefined && row[mapping.amount]) {
            const amountStr = String(row[mapping.amount]).replace(/[^\d-]/g, "");
            const amount = Number(amountStr);
            if (!isNaN(amount)) {
              parsed.amount = Math.abs(amount);
              // 금액이 음수면 지출로 추정
              if (amount < 0 && !parsed.kind) {
                parsed.kind = "expense";
              }
            } else {
              errors.push(`행 ${index + 1}: 금액 형식 오류 (${row[mapping.amount]})`);
            }
          }

          if (mapping.category !== undefined && row[mapping.category]) {
            parsed.category = String(row[mapping.category]).trim();
          }

          if (mapping.subCategory !== undefined && row[mapping.subCategory]) {
            parsed.subCategory = String(row[mapping.subCategory]).trim();
          }

          if (mapping.fromAccount !== undefined && row[mapping.fromAccount]) {
            parsed.fromAccount = String(row[mapping.fromAccount]).trim();
          }

          if (mapping.toAccount !== undefined && row[mapping.toAccount]) {
            parsed.toAccount = String(row[mapping.toAccount]).trim();
          }

          if (mapping.kind !== undefined && row[mapping.kind]) {
            const kindStr = String(row[mapping.kind]).trim().toLowerCase();
            if (kindStr === "수입" || kindStr === "income") parsed.kind = "income";
            else if (kindStr === "지출" || kindStr === "expense") parsed.kind = "expense";
            else if (kindStr === "이체" || kindStr === "transfer") parsed.kind = "transfer";
          }

          // 필수 필드 확인
          if (parsed.date && parsed.amount && parsed.amount > 0) {
            rows.push(parsed);
          } else {
            errors.push(`행 ${index + 1}: 필수 필드 누락 (날짜 또는 금액)`);
          }
        } catch (error) {
          errors.push(`행 ${index + 1}: 파싱 오류 - ${error}`);
        }
      });

      onComplete(rows, errors);
    },
    error: (error) => {
      onComplete([], [`CSV 파싱 오류: ${error.message}`]);
    }
  });
}

function parseDate(dateStr: string): string | null {
  // YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  // YYYY/MM/DD 형식
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
    return dateStr.replace(/\//g, "-");
  }
  // YYYY.MM.DD 형식
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) {
    return dateStr.replace(/\./g, "-");
  }
  // 기타 형식 시도
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return null;
}

export function convertToLedgerEntries(
  parsedRows: ParsedRow[],
  defaultKind: "income" | "expense" | "transfer",
  accounts: { id: string; name: string }[]
): LedgerEntry[] {
  return parsedRows.map((row, index) => {
    // 계좌 ID 찾기 (이름으로 검색)
    let fromAccountId: string | undefined;
    let toAccountId: string | undefined;

    if (row.fromAccount) {
      const account = accounts.find(
        (a) => a.id.toLowerCase() === row.fromAccount!.toLowerCase() || 
               a.name.toLowerCase() === row.fromAccount!.toLowerCase()
      );
      if (account) fromAccountId = account.id;
    }

    if (row.toAccount) {
      const account = accounts.find(
        (a) => a.id.toLowerCase() === row.toAccount!.toLowerCase() || 
               a.name.toLowerCase() === row.toAccount!.toLowerCase()
      );
      if (account) toAccountId = account.id;
    }

    const kind = row.kind || defaultKind;

    return {
      id: `L${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      date: row.date!,
      kind,
      category: row.category || (kind === "income" ? "수입" : kind === "transfer" ? "이체" : "(미분류)"),
      subCategory: row.subCategory || undefined,
      description: row.description || "",
      amount: row.amount!,
      fromAccountId,
      toAccountId
    };
  });
}

