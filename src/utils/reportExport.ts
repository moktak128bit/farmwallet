/**
 * 보고서 내보내기 공용 모델.
 * 보고서 타입별로 표 블록(제목+헤더+행)을 한 번 만들면 CSV·Excel·PDF가 모두 같은 데이터를 공유한다.
 */
import type { SheetData } from "./excelExport";

export interface ReportBlock {
  title: string;
  head: string[];
  rows: (string | number)[][];
}

/** 블록 중 데이터 행이 하나라도 있으면 true (내보낼 데이터 유무 판단용). */
export function hasReportRows(blocks: ReportBlock[]): boolean {
  return blocks.some((b) => b.rows.length > 0);
}

const csvCell = (v: string | number): string => {
  // 숫자는 천단위 쉼표 없이 raw로 — toLocaleString을 쓰면 스프레드시트가 텍스트로 인식
  const s = typeof v === "number" ? String(v) : v;
  return `"${s.replace(/"/g, '""')}"`;
};

export function blocksToCsv(blocks: ReportBlock[]): string {
  // 줄바꿈은 RFC 4180에 맞춰 CRLF — csvExport와 동일 (Windows Excel 호환)
  return blocks
    .map((b) => {
      const lines = [`# ${b.title}`, b.head.map(csvCell).join(",")];
      for (const row of b.rows) lines.push(row.map(csvCell).join(","));
      return lines.join("\r\n");
    })
    .join("\r\n\r\n");
}

// Excel 시트명 제약: 31자 이하, \ / ? * [ ] : 금지. 중복 시 접미사로 구분.
const sanitizeSheetName = (name: string): string =>
  name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";

export function blocksToSheets(blocks: ReportBlock[]): SheetData[] {
  const seen = new Set<string>();
  return blocks.map((b) => {
    const base = sanitizeSheetName(b.title);
    let name = base;
    let i = 2;
    while (seen.has(name)) name = sanitizeSheetName(`${base} ${i++}`);
    seen.add(name);
    return { name, rows: [b.head, ...b.rows] };
  });
}

const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function blocksToHtml(blocks: ReportBlock[]): string {
  return blocks
    .map((b) => {
      const head = b.head.map((h) => `<th>${escHtml(h)}</th>`).join("");
      const body = b.rows
        .map(
          (row) =>
            "<tr>" +
            row
              .map((c) =>
                typeof c === "number"
                  ? `<td class="num">${c.toLocaleString()}</td>`
                  : `<td>${escHtml(c)}</td>`
              )
              .join("") +
            "</tr>"
        )
        .join("");
      return `<h2>${escHtml(b.title)}</h2>\n<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("\n");
}
