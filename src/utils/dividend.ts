/** ledger note에서 배당락일 추출. "배당락일:YYYY-MM-DD" 형식 */
export function parseExDateFromNote(note: string | undefined): string | null {
  if (!note || typeof note !== "string") return null;
  const m = note.match(/배당락일\s*:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** ledger note에서 보유주식 수 추출. "보유주식: 254" 형식 */
export function parseQuantityFromNote(note: string | undefined): number | null {
  if (!note || typeof note !== "string") return null;
  const m = note.match(/보유주식\s*:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** 배당 입력 시 note 생성: 보유주식(입력값) + 배당락일 */
export function buildDividendNote(quantity?: number, exDate?: string): string | undefined {
  const parts: string[] = [];
  if (quantity != null && Number.isInteger(quantity) && quantity >= 0) parts.push(`보유주식: ${quantity}`);
  if (exDate?.trim()) parts.push(`배당락일:${exDate.trim()}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}
