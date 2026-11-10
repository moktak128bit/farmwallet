/**
 * 주식 탭 차트 범주 색 — styles.css 시리즈 토큰(라이트/다크 자동 전환). 인라인 hex 하드코딩 금지(CLAUDE.md #2).
 * 비중 파이처럼 범주가 많은 차트는 9색까지, 종목 비교(최대 6)는 앞 6색을 쓴다.
 */
export const STOCK_SERIES_COLORS = [
  "var(--chart-series-a)",
  "var(--chart-series-c)",
  "var(--chart-series-d)",
  "var(--chart-series-f)",
  "var(--chart-series-e)",
  "var(--chart-primary)",
  "var(--chart-warning)",
  "var(--chart-secondary)",
  "var(--chart-series-b)",
] as const;
