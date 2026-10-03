import { buildMonthRange } from "./date";

/** ledger note에서 배당락일 추출. "배당락일:YYYY-MM-DD" 형식 */
export function parseExDateFromNote(note: string | undefined): string | null {
  if (!note || typeof note !== "string") return null;
  const m = note.match(/배당락일\s*:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * ledger note에서 보유주식 수 추출. "보유주식: 254" 또는 "보유주식: 2.5"(미국 소수 주식) 형식.
 *
 * 콤마·소수점도 받아들인다 — 입력 킷이 "1,000"처럼 포맷된 값을 note에 남길 수 있는데
 * \d+ 만 보면 "1,000"이 1로 읽히며 배당수익률이 통째로 틀어진다.
 */
export function parseQuantityFromNote(note: string | undefined): number | null {
  if (!note || typeof note !== "string") return null;
  const m = note.match(/보유주식\s*:\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 배당 입력 시 note 생성: 보유주식(입력값) + 배당락일. 소수 주식(미국 소수점 매수) 허용 */
export function buildDividendNote(quantity?: number, exDate?: string): string | undefined {
  const parts: string[] = [];
  if (quantity != null && Number.isFinite(quantity) && quantity >= 0) parts.push(`보유주식: ${quantity}`);
  if (exDate?.trim()) parts.push(`배당락일:${exDate.trim()}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * 배당 탭 월별 차트(오름차순 + 3개월 이동평균 + 진행 중인 달) + 요약 지표(완료월 평균·최근/직전 6개월·최근 12개월).
 * 첫 수령월~이번 달을 **빈 달 0으로 채운 뒤** 집계한다 — 받은 달만 이으면 분기배당의 "최근 12개월"이
 * 3년치(13회 중 12회)가 되고 6개월 비교·이동평균·완료월 평균도 빈 달을 건너뛰었다.
 * 이번 달(thisMonth)은 아직 안 끝났으므로 isPartial — 이동평균·완료월 지표에서 뺀다.
 */
export function buildMonthlyDividendSeries(totals: Array<{ month: string; total: number }>, thisMonth: string) {
  const byMonth = new Map(totals.filter((r) => /^\d{4}-\d{2}$/.test(r.month)).map((r) => [r.month, r.total]));
  const keys = [...byMonth.keys()].sort();
  const end = keys.length > 0 && keys[keys.length - 1] > thisMonth ? keys[keys.length - 1] : thisMonth;
  const filled = keys.length > 0 ? buildMonthRange(keys[0], end).map((month) => ({ month, total: byMonth.get(month) ?? 0 })) : [];
  const chart = filled.map((row, i) => {
    const isPartial = row.month === thisMonth;
    const windowRows = filled.slice(Math.max(0, i - 2), i + 1);
    const movingAvg = !isPartial && windowRows.length === 3 ? windowRows.reduce((s, r) => s + r.total, 0) / 3 : undefined;
    return { month: row.month, total: row.total, isPartial, movingAvg };
  });
  const completed = chart.filter((r) => !r.isPartial);
  const sum = (rows: typeof chart) => rows.reduce((s, r) => s + r.total, 0);
  const recentSix = completed.slice(-6);
  const priorSix = completed.slice(-12, -6);
  const last12 = completed.slice(-12);
  return {
    chart,
    stats: {
      completedMonths: completed.length,
      completedAvg: completed.length > 0 ? sum(completed) / completed.length : 0,
      recentSixTotal: sum(recentSix),
      recentSixCount: recentSix.length,
      priorSixTotal: sum(priorSix),
      priorSixCount: priorSix.length,
      last12Total: sum(last12),
      last12Count: last12.length
    }
  };
}
