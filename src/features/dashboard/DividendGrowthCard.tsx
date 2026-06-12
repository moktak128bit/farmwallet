/**
 * 배당 성장 추적 카드 — "버핏의 코카콜라" 위젯.
 * 장기 적립 종목 하나당 카드 1개: 주가(+내 평단) 미니 차트 위에,
 * 월 분배금 수령액(막대) · 분배율(시장가, 선) · YOC(평단 기준, 선)를 보여준다.
 * 10년 모아가며 "월 분배금과 YOC가 어떻게 자라는지"를 보는 것이 목적.
 *
 * 데이터 계산은 utils/dividendGrowth.ts(순수 함수)가 담당, 이 컴포넌트는 표시만.
 * React.memo — 부모가 넘기는 props는 안정적(useMemo 결과)이어야 한다.
 */
import React from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import type { DividendGrowthData } from "../../utils/dividendGrowth";

const fmtWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const Kpi: React.FC<{ label: string; value: string; tone?: string; hint?: string }> = ({ label, value, tone, hint }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: "var(--radius-md)", minWidth: 96 }} title={hint}>
    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 800, color: tone ?? "var(--text)", marginTop: 2 }}>{value}</div>
  </div>
);

export const DividendGrowthCard: React.FC<{ data: DividendGrowthData }> = React.memo(function DividendGrowthCard({ data }) {
  const { current: cur, points } = data;
  const priceVsCost =
    cur.price != null && cur.avgCost ? ((cur.price - cur.avgCost) / cur.avgCost) * 100 : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 16 }}>
          💎 {data.name} <span style={{ color: "var(--text-faint)", fontWeight: 500, fontSize: 12 }}>({data.ticker})</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          분배금 기록 {data.recordCount}건 · 분배율=시장가 기준, YOC=내 평단 기준 (연환산)
        </span>
      </div>

      {/* KPI 줄 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 12px" }}>
        <Kpi label="보유" value={`${cur.shares.toLocaleString()}주`} />
        <Kpi label="평단" value={cur.avgCost != null ? fmtWon(cur.avgCost) : "–"} />
        <Kpi
          label="현재가"
          value={cur.price != null ? fmtWon(cur.price) : "–"}
          tone={priceVsCost == null ? undefined : priceVsCost >= 0 ? "var(--danger)" : "var(--accent)"}
          hint={priceVsCost != null ? `평단 대비 ${priceVsCost >= 0 ? "+" : ""}${priceVsCost.toFixed(1)}%` : undefined}
        />
        <Kpi
          label="최근 월 분배금"
          value={cur.lastMonthReceived != null ? fmtWon(cur.lastMonthReceived) : "–"}
          hint={cur.lastMonthPerShare != null ? `주당 ${cur.lastMonthPerShare.toFixed(1)}원` : undefined}
        />
        <Kpi label="분배율(연)" value={cur.marketYield != null ? fmtPct(cur.marketYield) : "–"} />
        <Kpi
          label="YOC(평단 기준)"
          value={cur.yoc != null ? fmtPct(cur.yoc) : "–"}
          tone="var(--success)"
          hint="Yield on Cost — 내 평단 대비 연 분배율. 모아갈수록·분배금이 자랄수록 상승"
        />
      </div>

      {/* 주가 + 평단 미니 차트 */}
      <ResponsiveContainer width="100%" height={110}>
        <ComposedChart data={points} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 10 }}
            width={52}
            tickFormatter={(v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}만` : String(Math.round(v)))}
          />
          <Tooltip
            formatter={(v: number | string | undefined, key: string | undefined) =>
              [fmtWon(Number(v ?? 0)), key === "price" ? "주가" : "평단"] as [string, string]
            }
            labelFormatter={(l) => `${l} 주가`}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="price"
            name="주가"
            stroke="var(--chart-primary)"
            fill="var(--primary-light)"
            strokeWidth={2}
            connectNulls
            dot={false}
          />
          <Line
            isAnimationActive={false}
            type="stepAfter"
            dataKey="avgCost"
            name="평단"
            stroke="var(--text-faint)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            connectNulls
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* 월 분배금(막대) + 분배율/YOC(선) */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            yAxisId="won"
            tick={{ fontSize: 10 }}
            width={52}
            tickFormatter={(v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}만` : String(Math.round(v)))}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            tick={{ fontSize: 10 }}
            width={40}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(v: number | string | undefined, key: string | undefined) => {
              const n = Number(v ?? 0);
              if (key === "월 분배금") return [fmtWon(n), key] as [string, string];
              return [fmtPct(n), key ?? ""] as [string, string];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            isAnimationActive={false}
            yAxisId="won"
            dataKey="received"
            name="월 분배금"
            fill="var(--chart-primary)"
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
          />
          <Line
            isAnimationActive={false}
            yAxisId="pct"
            type="monotone"
            dataKey="annualYield"
            name="분배율(연)"
            stroke="var(--chart-accent)"
            strokeWidth={2}
            connectNulls
            dot={{ r: 2 }}
          />
          <Line
            isAnimationActive={false}
            yAxisId="pct"
            type="monotone"
            dataKey="yoc"
            name="YOC"
            stroke="var(--success)"
            strokeWidth={2}
            connectNulls
            dot={{ r: 2 }}
          />
          <ReferenceLine yAxisId="pct" y={0} stroke="var(--chart-grid)" />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
        막대 = 그 달 실제 수령액 (모아갈수록 우상향이 목표) · 분배율·YOC는 월 주당 분배금 × 12 연환산.
      </div>
    </div>
  );
});
