/**
 * Yahoo v8 chart 응답 → 일별 종가 시계열 파싱 (순수, 네트워크/env 의존 없음).
 * 벤치마크 지수 등 과거 종가 비교용. yahooFinanceApi(네트워크)에서 import해 사용.
 */
interface YahooChartLike {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

/** timestamp(unix초)→KST 날짜, close>0만. 같은 날짜는 마지막 종가. 날짜 오름차순. */
export function parseHistoricalCloses(data: YahooChartLike): Array<{ date: string; close: number }> {
  const result = data.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  for (let i = 0; i < ts.length; i += 1) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    // dailyCloses.ts와 동일한 KST 환산 패턴 (unix초 + 9h → 날짜)
    const date = new Date((ts[i] + 9 * 60 * 60) * 1000).toISOString().slice(0, 10);
    byDate.set(date, close);
  }
  return Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
