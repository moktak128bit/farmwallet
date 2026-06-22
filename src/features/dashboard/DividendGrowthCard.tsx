/**
 * 배당 성장 추적 카드 — "모으는 재미"를 앞세운 버핏의 코카콜라 위젯.
 *
 * 상단 히어로(항상): ① 연간 배당 런레이트(보유×연환산 주당분배금, 모을수록 커짐)
 *                    ② 내 배당률(YOC, 연환산) — 시작→지금 증가폭
 *                    ③ 배당 눈덩이(누적 수령)
 * + 📈 배당률 여정(YOC area) · ❄️ 배당 눈덩이(누적 area)
 * '자세히'(접이식): 기존 월 분배금 막대·월 분배율 두 기준·주가 차트.
 *
 * 데이터 계산은 utils/dividendGrowth.ts(순수). 차트 애니메이션은 끔(사용자 선호).
 */
import React, { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { buildDividendStory, type DividendGrowthData } from "../../utils/dividendGrowth";

const fmtWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
const fmtPct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
const fmtAxisWon = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}만` : String(Math.round(v)));

const Kpi: React.FC<{ label: string; value: string; tone?: string; hint?: string }> = ({ label, value, tone, hint }) => (
  <div style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: "var(--radius-md)", minWidth: 96 }} title={hint}>
    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 800, color: tone ?? "var(--text)", marginTop: 2 }}>{value}</div>
  </div>
);

/** 히어로 스탯 — KPI보다 크고 강조 */
const Hero: React.FC<{ label: string; value: string; tone?: string; sub?: string }> = ({ label, value, tone, sub }) => (
  <div style={{ padding: "12px 14px", background: "var(--bg)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 900, color: tone ?? "var(--text)", marginTop: 4, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
  </div>
);

const PanelTitle: React.FC<{ title: string; desc?: string }> = ({ title, desc }) => (
  <div style={{ margin: "14px 0 4px" }}>
    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</span>
    {desc && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{desc}</span>}
  </div>
);

export const DividendGrowthCard: React.FC<{ data: DividendGrowthData }> = React.memo(function DividendGrowthCard({ data }) {
  const { current: cur, points } = data;
  const sync = `div-growth-${data.ticker}`;
  const gid = data.ticker.replace(/[^a-zA-Z0-9]/g, "");
  const story = useMemo(() => buildDividendStory(data), [data]);
  const [showDetails, setShowDetails] = useState(false);
  const [showPrice, setShowPrice] = useState(false);
  const priceVsCost = cur.price != null && cur.avgCost ? ((cur.price - cur.avgCost) / cur.avgCost) * 100 : null;
  const dailyRunRate = story.annualRunRate != null ? story.annualRunRate / 365 : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 16 }}>
          {data.name} <span style={{ color: "var(--text-faint)", fontWeight: 500, fontSize: 12 }}>({data.ticker})</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>분배금 기록 {data.recordCount}건 · 보유 {cur.shares.toLocaleString()}주</span>
      </div>

      {/* 🌟 히어로 — 모으는 재미 3종 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "12px 0 4px" }}>
        <Hero
          label="연간 배당 런레이트"
          value={story.annualRunRate != null ? fmtWon(story.annualRunRate) : "–"}
          tone="var(--chart-income, var(--danger))"
          sub={
            story.monthlyRunRate != null
              ? `월 ${fmtWon(story.monthlyRunRate)} · 하루 ${dailyRunRate != null ? fmtWon(dailyRunRate) : "–"}`
              : "분배 기록이 쌓이면 표시"
          }
        />
        <Hero
          label="내 배당률 (YOC)"
          value={story.nowYoc != null ? fmtPct(story.nowYoc, 1) : "–"}
          tone="var(--success)"
          sub={
            story.yocGainPp != null && story.yocGainPp > 0.05
              ? `▲ 모으기 시작 후 +${fmtPct(story.yocGainPp, 1)}p`
              : "내 평단 기준 · 12개월 실수령"
          }
        />
        <Hero
          label="지금까지 받은 배당 ❄️"
          value={fmtWon(story.totalReceived)}
          tone="var(--chart-warning, var(--warning))"
          sub="모을수록 커지는 눈덩이"
        />
      </div>

      {/* 🎯 메인 콤보 — 월 배당금(막대) + 배당율 YOC(선) + 보유 평가액(배경) */}
      <PanelTitle
        title="📊 한눈에 — 받은 배당 · 배당률 · 내 보유"
        desc="막대 = 월 배당금 · 초록선 = 내 배당률(YOC, 원금대비) · 연한 면적 = 보유 평가액(모을수록 우상향)"
      />
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={story.points} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={`val-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-primary, #2563eb)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-primary, #2563eb)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          {/* 좌: 월 배당금(원) */}
          <YAxis yAxisId="won" tick={{ fontSize: 10 }} width={50} tickFormatter={fmtAxisWon} />
          {/* 우: 배당률(%) */}
          <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} width={40} domain={[0, "auto"]} tickFormatter={(v: number) => `${v}%`} />
          {/* 숨김: 보유 평가액 — 자체 스케일로 배경 언덕 */}
          <YAxis yAxisId="value" hide domain={[0, "auto"]} />
          <Tooltip
            formatter={(v: number | string | undefined, name: string | undefined) => {
              const n = Number(v ?? 0);
              if (name === "배당률(YOC)") return [fmtPct(n, 2), name] as [string, string];
              return [fmtWon(n), name ?? ""] as [string, string];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area yAxisId="value" isAnimationActive={false} type="monotone" dataKey="marketValue" name="보유 평가액" stroke="var(--chart-primary, #2563eb)" strokeOpacity={0.5} strokeWidth={1.5} fill={`url(#val-${gid})`} connectNulls dot={false} />
          <Bar yAxisId="won" isAnimationActive={false} dataKey="received" name="월 배당금" fill="var(--chart-income, var(--danger))" radius={[3, 3, 0, 0]} maxBarSize={34} />
          <Line yAxisId="pct" isAnimationActive={false} type="monotone" dataKey="annualYoc" name="배당률(YOC)" stroke="var(--success)" strokeWidth={2.5} connectNulls dot={{ r: 3, strokeWidth: 0, fill: "var(--success)" }} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* 자세히 — 기존 분석 차트(월 분배금·분배율·주가) */}
      <button
        type="button"
        className="link"
        onClick={() => setShowDetails((v) => !v)}
        style={{ fontSize: 12, marginTop: 10, padding: 0 }}
        aria-expanded={showDetails}
      >
        {showDetails ? "▲ 자세히 접기" : "▼ 자세히 — 월 분배금·분배율·주가"}
      </button>

      {showDetails && (
        <>
          {/* KPI 줄 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 2px" }}>
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
              label="시장 분배율 (현재가)"
              value={cur.marketYield != null ? fmtPct(cur.marketYield, 1) : "–"}
              hint="연환산, 지금 사는 사람 기준"
            />
          </div>

          <PanelTitle title="① 매달 받은 분배금" desc="모아갈수록 막대가 커지는 게 목표 (수량 증가 × 주당 분배금 성장)" />
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={points} syncId={sync} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={fmtAxisWon} />
              <Tooltip formatter={(v: number | string | undefined) => [fmtWon(Number(v ?? 0)), "받은 분배금"] as [string, string]} />
              <Bar isAnimationActive={false} dataKey="received" name="받은 분배금" fill="var(--chart-warning)" radius={[3, 3, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>

          <PanelTitle
            title="② 월 분배율 — 100만원당 매달 얼마 받나"
            desc="파랑 = 지금 주가 기준 · 초록 = 내 평단 기준. 분배금이 자라면 초록만 계속 올라감"
          />
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={points} syncId={sync} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={52} domain={[0, "auto"]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                formatter={(v: number | string | undefined, key: string | undefined) => {
                  const n = Number(v ?? 0);
                  const per1m = Math.round(n * 10000);
                  return [`${fmtPct(n)} (100만원당 ${per1m.toLocaleString()}원)`, key ?? ""] as [string, string];
                }}
              />
              <Line isAnimationActive={false} type="monotone" dataKey="monthlyYield" name="지금 주가 기준" stroke="var(--chart-accent)" strokeWidth={3} connectNulls dot={{ r: 4, strokeWidth: 0, fill: "var(--chart-accent)" }} />
              <Line isAnimationActive={false} type="monotone" dataKey="monthlyYoc" name="내 매입가 기준 (배당성장)" stroke="var(--success)" strokeWidth={3} connectNulls dot={{ r: 4, strokeWidth: 0, fill: "var(--success)" }} />
            </LineChart>
          </ResponsiveContainer>

          <button type="button" className="link" onClick={() => setShowPrice((v) => !v)} style={{ fontSize: 12, marginTop: 8, padding: 0 }} aria-expanded={showPrice}>
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
                  <Tooltip formatter={(v: number | string | undefined, key: string | undefined) => [fmtWon(Number(v ?? 0)), key ?? ""] as [string, string]} />
                  <Area isAnimationActive={false} type="monotone" dataKey="price" name="주가" stroke="var(--chart-primary)" fill="var(--primary-light)" strokeWidth={2} connectNulls dot={false} />
                  <Line isAnimationActive={false} type="stepAfter" dataKey="avgCost" name="내 평단" stroke="var(--text-faint)" strokeDasharray="4 3" strokeWidth={1.5} connectNulls dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          )}
        </>
      )}
    </div>
  );
});
