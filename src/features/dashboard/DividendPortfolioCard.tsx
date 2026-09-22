/**
 * 배당 포트폴리오 카드 — 대시보드 2번 칸.
 *
 * 한 화면에서 세 가지에 답한다.
 *   ① 원금 대비 몇 %?  → 히어로: 총 배당률(연환산 ÷ 배당주 KRW 원가)
 *   ② 월에 얼마?       → 히어로: 월 평균 + 최근 완료 월 실수령
 *   ③ 자라고 있나?     → 차트: 월배당 스택 막대(종목별) + 총 배당률 추이 선(우축)
 *
 * 막대(원)와 선(%)은 단위가 달라 축을 나눈다. 막대는 "얼마 들어왔나"(절대액·기여 종목),
 * 선은 "원금 대비 효율"(성장). 둘을 겹쳐야 "돈은 늘었는데 원금은 더 늘었다" 같은 상황이 보인다.
 *
 * 계산은 utils/dividendPortfolio.ts(순수). 차트 애니메이션은 끔(사용자 선호).
 */
import React, { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DividendPortfolio } from "../../utils/dividendPortfolio";
import { formatNumber } from "../../utils/formatter";

interface Props {
  data: DividendPortfolio;
}

/** 스택 막대 색 — 디자인 시스템의 범주 시리즈 토큰 (다크모드 자동 대응) */
const SERIES_COLORS = [
  "var(--chart-series-a)",
  "var(--chart-series-c)",
  "var(--chart-series-d)",
  "var(--chart-series-f)",
  "var(--chart-series-b)",
];

const fmtWon = (n: number) => `${formatNumber(Math.round(n))}원`;
const fmtAxisWon = (v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(Math.round(v)));

const Hero: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({
  label,
  value,
  sub,
  tone,
}) => (
  <div
    style={{
      padding: "12px 14px",
      background: "var(--bg)",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div
      style={{
        fontSize: 24,
        fontWeight: 800,
        color: tone ?? "var(--text)",
        marginTop: 4,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
    {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
  </div>
);

export const DividendPortfolioCard: React.FC<Props> = React.memo(function DividendPortfolioCard({ data }) {
  const [showAll, setShowAll] = useState(false);

  // 차트는 최근 15개월만 — 그 이상은 모바일에서 막대가 실오라기가 된다
  const chartData = useMemo(() => {
    const rows = data.months.slice(-15);
    return rows.map((m) => ({
      label: m.label,
      rolling: m.rolling,
      partial: m.partial,
      ...m.byTicker,
    }));
  }, [data.months]);

  const visibleTickers = showAll ? data.tickers : data.tickers.slice(0, 5);
  const hasPartial = data.months.some((m) => m.partial && m.total > 0);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="card-title">
          배당 포트폴리오
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginLeft: 8 }}>
            {data.tickers.length}종목 · {data.tickers.map((t) => t.name).join(" + ")}
          </span>
        </div>
        <div className="hint" style={{ fontSize: 11 }}>
          원가 {fmtWon(data.totalCost)} 기준 · 누적 수령 {fmtWon(data.receivedTotal)}
          {data.excludedCount > 0 && ` · 총계 제외 ${data.excludedCount}종목`}
        </div>
      </div>

      {/* ── 히어로 3 ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
          marginTop: 12,
        }}
      >
        <Hero
          label="총 배당률 (원금 대비)"
          value={data.yoc != null ? `${data.yoc.toFixed(2)}%` : "—"}
          sub={`연 ${fmtWon(data.annualTotal)} 기준`}
          tone="var(--chart-income)"
        />
        <Hero
          label="월 배당 (최근 3개월 평균)"
          value={fmtWon(data.monthlyAvg)}
          sub={
            data.lastMonth
              ? `${data.lastMonth.month} 실수령 ${fmtWon(data.lastMonth.amount)}`
              : undefined
          }
        />
        <Hero
          label="최근 12개월 실수령"
          value={fmtWon(data.received12)}
          sub="연환산 아님 · 실제 받은 금액"
        />
      </div>

      {/* ── 차트 ── */}
      <div style={{ marginTop: 16, height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} />
            <YAxis
              yAxisId="won"
              tickFormatter={fmtAxisWon}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <YAxis
              yAxisId="roll"
              orientation="right"
              tickFormatter={fmtAxisWon}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip formatter={(value, name) => [fmtWon(Number(value) || 0), String(name)]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {data.topTickers.map((t, i) => (
              <Bar
                key={t.key}
                yAxisId="won"
                dataKey={t.key}
                name={t.name}
                stackId="d"
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                isAnimationActive={false}
              />
            ))}
            <Line
              yAxisId="roll"
              type="monotone"
              dataKey="rolling"
              name="12개월 누적 배당"
              stroke="var(--chart-income)"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
        막대 = 월 배당 수령액(종목별) · 선 = 그 시점까지 최근 12개월 누적 배당(성장 추세)
        {hasPartial && " · 이번 달은 진행 중이라 추세선에서 제외"}
      </div>

      {/* ── 종목별 ── */}
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>종목</th>
              <th className="number">원금</th>
              <th className="number">연 배당</th>
              <th className="number">배당률</th>
              <th className="number">누적</th>
            </tr>
          </thead>
          <tbody>
            {visibleTickers.map((t) => (
              <tr key={t.ticker}>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {t.ticker}
                    {t.months < 12 && ` · ${t.months}개월 연환산`}
                    {t.excluded === "sold" && " · 전량 매도 (총계 제외)"}
                    {t.excluded === "tooShort" && " · 관측 부족 (총계 제외)"}
                  </div>
                </td>
                <td className="number">{t.cost > 0 ? fmtWon(t.cost) : "—"}</td>
                <td className="number" style={{ color: t.excluded ? "var(--text-muted)" : undefined }}>
                  {fmtWon(t.annual)}
                </td>
                <td className="number" style={{ fontWeight: 700, color: t.yoc != null ? "var(--chart-income)" : "var(--text-muted)" }}>
                  {t.yoc != null ? `${t.yoc.toFixed(2)}%` : "—"}
                </td>
                <td className="number">{fmtWon(t.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.tickers.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            style={{ marginTop: 8, fontSize: 12, padding: "5px 12px" }}
          >
            {showAll ? "접기" : `전체 ${data.tickers.length}종목 보기`}
          </button>
        )}
      </div>
    </div>
  );
});
