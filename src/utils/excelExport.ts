/**
 * 의존성 없는 경량 XLSX(SpreadsheetML 2003 XML) 생성기.
 * 엑셀에서 .xls로 인식하며 "확장자가 다르다" 경고만 표시 후 정상 오픈된다.
 * 풀 SheetJS 도입 전까지 가벼운 대안으로 사용.
 */

export interface SheetData {
  name: string;
  rows: (string | number | null | undefined)[][];
}

const escapeXml = (s: string): string => s
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const cellXml = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === "") return '<Cell/>';
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(String(v))}</Data></Cell>`;
};

const sheetXml = (sheet: SheetData): string => {
  const rows = sheet.rows.map((row) =>
    `<Row>${row.map(cellXml).join("")}</Row>`
  ).join("");
  return `<Worksheet ss:Name="${escapeXml(sheet.name).slice(0, 31)}"><Table>${rows}</Table></Worksheet>`;
};

export function buildSpreadsheetXml(sheets: SheetData[]): string {
  const body = sheets.map(sheetXml).join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${body}
</Workbook>`;
}

export function downloadAsExcel(filename: string, sheets: SheetData[]): void {
  const xml = buildSpreadsheetXml(sheets);
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") || filename.endsWith(".xlsx") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
