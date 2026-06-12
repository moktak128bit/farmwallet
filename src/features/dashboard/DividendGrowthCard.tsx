/**
 * 배당 성장 추적 카드 — "버핏의 코카콜라" 위젯.
 * 기본 2단 차트(마우스 호버 동기화) + 주가 차트는 접이식(보조 정보 — KPI에 현재가·평단 있음):
 *   ① 매달 분배금을 얼마나 받았나 (적립 효과)
 *   ② 월 분배율 — 지금 주가 기준 vs 내가 산 가격 기준 (배당성장이면 초록 선이 우상향)
 *   (+ 펼치면) 주가는 내 평단 대비 어디쯤인가
 *
 * 데이터 계산은 utils/dividendGrowth.ts(순수 함수)가 담당, 이 컴포넌트는 표시만.
 * React.memo — 부모가 넘기는 props는 안정적(useMemo 결과)이어야 한다.
 */
import React, { useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DividendGrowthData } from "../../utils/dividendGrowth";

const fmtWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
const fmtPct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
const fmtAxisWon = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}만` : String(Math.round(v)));

const Kpi: React.FC<{ label: string; value: string; tone?: string; hint?: string }> = ({ label, value, tone, hint }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: "var(--radius-md)", minWidth: 96 }} title={hint}>
    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 800, color: tone ?? "var(--text)", marginTop: 2 }}>{value}</div>
  </div>
);

/** 차트 패널 제목 + 한 줄 설명 */
const PanelTitle: React.FC<{ title: string; desc?: string }> = ({ title, desc }) => (
  <div style={{ margin: "14px 0 4px" }}>
    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</span>
    {desc && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{desc}</span>}
  </div>
);

export const DividendGrowthCard: React.FC<{ data: DividendGrowthData }> = React.memo(function DividendGrowthCard({ data }) {
  const { current: cur, points } = data;
  const sync = `div-growth-${data.ticker}`;
  // 주가 차트는 보조 정보 — 기본 접힘 (KPI에 현재가·평단 대비 % 있음)
  const [showPrice, setShowPrice] = useState(false);
  const priceVsCost =
    cur.price != null && cur.avgCost ? ((cur.price - cur.avgCost) / cur.avgCost) * 100 : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 16 }}>
          {data.name} <span style={{ color: "var(--text-faint)", fontWeight: 500, fontSize: 12 }}>({data.ticker})</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>분배금 기록 {data.recordCount}건</span>
      </div>

      {/* KPI 줄 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 2px" }}>
        <Kpi label="보유" value={`${cur.shares.toLocaleString()}주`} />
        <Kpi label="내 평단" value={cur.avgCost != null ? fmtWon(cur.avgCost) : "–"} />
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
        <Kpi
          label="월 분배율 (지금 주가)"
          value={cur.lastMonthYield != null ? fmtPct(cur.lastMonthYield) : "–"}
          hint={cur.marketYield != null ? `연환산 약 ${fmtPct(cur.marketYield, 1)}` : undefined}
        />
        <Kpi
          label="월 분배율 (내 매입가)"
          value={cur.lastMonthYoc != null ? fmtPct(cur.lastMonthYoc) : "–"}
          tone="var(--success)"
          hint={`배당성장 지표 — 분배금이 자라면 평단은 고정이라 계속 상승${cur.yoc != null ? ` (연환산 약 ${fmtPct(cur.yoc, 1)})` : ""}`}
        />
      </div>

      {/* ① 매달 받은 분배금 */}
      <PanelTitle title="① 매달 받은 분배금" desc="모아갈수록 막대가 커지는 게 목표 (수량 증가 × 주당 분배금 성장)" />
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={points} syncId={sync} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={fmtAxisWon} />
          <Tooltip
            formatter={(v: number | string | undefined) => [fmtWon(Number(v ?? 0)), "받은 분배금"] as [string, string]}
          />
          <Bar
            isAnimationActive={false}
            dataKey="received"
            name="받은 분배금"
            fill="var(--chart-warning)"
            radius={[3, 3, 0, 0]}
            maxBarSize={36}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* ② 월 분배율 — 두 기준 비교 */}
      <PanelTitle
        title="② 월 분배율 — 100만원당 매달 얼마 받나"
        desc="파랑 = 지금 주가로 살 때(주당 분배금÷주가) · 초록 = 내가 산 가격 기준(주당 분배금÷내 평단). 분배금이 자라면 초록 선만 계속 올라감 (배당성장)"
      />
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={points} syncId={sync} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fontSize: 10 }}
            width={52}
            domain={[0, "auto"]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(v: number | string | undefined, key: string | undefined) => {
              const n = Number(v ?? 0);
              // 직관 보조: 0.45% → "0.45% (100만원당 4,500원)"
              const per1m = Math.round(n * 10000);
              return [`${fmtPct(n)} (100만원당 ${per1m.toLocaleString()}원)`, key ?? ""] as [string, string];
            }}
          />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="monthlyYield"
            name="지금 주가 기준"
            stroke="var(--chart-accent)"
            strokeWidth={3}
            connectNulls
            dot={{ r: 4, strokeWidth: 0, fill: "var(--chart-accent)" }}
          />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="monthlyYoc"
            name="내 매입가 기준 (배당성장)"
            stroke="var(--success)"
            strokeWidth={3}
            connectNulls
            dot={{ r: 4, strokeWidth: 0, fill: "var(--success)" }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* 주가 차트 — 보조 정보라 기본 접힘 */}
      <button
        type="button"
        className="link"
        onClick={() => setShowPrice((v) => !v)}
        style={{ fontSize: 12, marginTop: 8, padding: 0 }}
        aria-expanded={showPrice}
      >
        {showPrice ? "▲ 주가·평단 차트 접기" : "▼ 주가·평단 차트 보기"}
      </button>
      {showPrice && (
        <>
          <PanelTitle title="주가" desc="회색 점선 = 내 평단. 주가가 점선 아래면 평단보다 싸게 모을 수 있는 구간" />
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart data={points} syncId={sync} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={52} tickFormatter={fmtAxisWon} />
              <Tooltip
                formatter={(v: number | string | undefined, key: string | undefined) =>
                  [fmtWon(Number(v ?? 0)), key ?? ""] as [string, string]
                }
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
                name="내 평단"
                stroke="var(--text-faint)"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                connectNulls
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
});
