/**
 * 증권 보유 일별 추이 — 매입금액(원가) vs 평가액을 날짜별로.
 * A0 buildDailyPortfolioValueSeries 그대로 사용: 평가액=그날 종가×그날 환율, 매입금액=매입 당시 환율(정확).
 * 둘의 간격 = 평가손익. self-contained(store 구독). 차트 애니메이션 끔(사용자 선호).
 */
import React, { useMemo, useState } from "react";
import {
  Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { buildDailyPortfolioValueSeries, buildFxHistory, firstTradeDate } from "../../utils/portfolioHistory";
import { performanceStartDate, type PerformancePeriod } from "../../utils/portfolioPerformance";

const PERIODS: Array<{ key: PerformancePeriod; label: string }> = [
  { key: "3M", label: "3개월" },
  { key: "6M", label: "6개월" },
  { key: "1Y", label: "1년" },
  { key: "ALL", label: "전체" },
];
const fmtAxisWon = (v: number) => (v >= 100_000_000 ? `${(v / 100_000_000).toFixed(1)}억` : v >= 10_000 ? `${Math.round(v / 10_000)}만` : String(Math.round(v)));

export const SecuritiesValueTrendCard: React.FC = () => {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const historicalDailyCloses = useAppStore((s) => s.data.historicalDailyCloses);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const [period, setPeriod] = useState<PerformancePeriod>("ALL");

  const series = useMemo(() => {
    if (!trades.length) return [];
    const today = getTodayKST();
    const startDate = performanceStartDate(period, today, firstTradeDate(trades));
    const fxHistory = buildFxHistory(historicalDailyFx, marketEnvSnapshots);
    const step = period === "ALL" || period === "1Y" ? "weekly" : "daily";
    return buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: historicalDailyCloses ?? [],
      fxHistory,
      fallbackFxRate: fxRate,
      startDate,
      endDate: today,
      step,
    });
  }, [trades, accounts, historicalDailyCloses, historicalDailyFx, marketEnvSnapshots, fxRate, period]);

  const last = series[series.length - 1];
  const pnl = last ? last.pnlKRW : 0;
  const pnlPct = last && last.costKRW > 0 ? (pnl / last.costKRW) * 100 : 0;
  const pnlColor = pnl >= 0 ? "var(--danger)" : "var(--accent)"; // 이익=빨강, 손실=파랑 (국내 관례)

  const tickFmt = (d: string) => (typeof d === "string" && d.length >= 10 ? d.slice(2, 7) : d);

  return (
    <div className="card" style={{ minHeight: 320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>증권 평가액 · 매입금액 추이 (일별)</div>
          <div className="hint" style={{ fontSize: 13 }}>
            평가액 = 그날 종가 × 그날 환율 · 매입금액 = 매입 당시 환율 · 둘의 간격 = 평가손익
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              style={{
                fontSize: 12, padding: "4px 12px", borderRadius: 14, border: "1px solid var(--border)",
                background: period === p.key ? "var(--primary-light, var(--surface))" : "var(--surface)",
                color: period === p.key ? "var(--primary, var(--text))" : "var(--text-muted)",
                fontWeight: period === p.key ? 700 : 400, cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {series.length < 2 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 240, color: "var(--text-muted)" }}>
          {trades.length ? "표시할 데이터가 부족합니다 (시세 갱신으로 일별 종가가 쌓이면 표시됩니다)." : "주식 거래를 추가하면 추이가 표시됩니다."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "6px 0 12px" }}>
            <Stat label="매입금액 (원가)" value={formatKRW(Math.round(last?.costKRW ?? 0))} color="var(--text-muted)" />
            <Stat label="평가액" value={formatKRW(Math.round(last?.valueKRW ?? 0))} />
            <Stat
              label="평가손익"
              value={`${pnl >= 0 ? "+" : ""}${formatKRW(Math.round(pnl))} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`}
              color={pnlColor}
            />
          </div>

          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="sv-value" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-primary, #2563eb)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-primary, #2563eb)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={tickFmt} tick={{ fontSize: 10 }} minTickGap={32} />
                <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={fmtAxisWon} domain={["auto", "auto"]} />
                <Tooltip
                  labelFormatter={(d) => String(d)}
                  formatter={(v: number | string | undefined, name: string | undefined) => [formatKRW(Math.round(Number(v ?? 0))), name ?? ""] as [string, string]}
                />
                <Area isAnimationActive={false} type="monotone" dataKey="valueKRW" name="평가액" stroke="var(--chart-primary, #2563eb)" strokeWidth={2.5} fill="url(#sv-value)" connectNulls dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="costKRW" name="매입금액(원가)" stroke="var(--text-faint, #94a3b8)" strokeWidth={1.8} strokeDasharray="5 4" connectNulls dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>
            ⓘ 달러 종목은 평가액·매입금액 모두 원화 환산 (평가=그날 환율, 매입=매입 당시 환율). 기록된 일별 종가 기준이라 시세 갱신을 자주 할수록 촘촘해집니다.
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div>
    <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color ?? "var(--text)" }}>{value}</div>
  </div>
);
