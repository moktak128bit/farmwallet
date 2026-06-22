/**
 * 투자 성과 (벤치마크 대비) — A1 UI.
 * 현금흐름 제거 TWR 수익률을 시장지수(KOSPI/S&P500)와 같은 기간으로 비교하고, 리스크 지표를 보여준다.
 * 분석은 전부 utils/portfolioPerformance(순수)에 있고, 이 컴포넌트는 store 구독 + 지수 fetch + 렌더만.
 *
 * 색 관례(CLAUDE.md #4): 이익/플러스 = 빨강(--danger), 손실/마이너스 = 파랑(--accent).
 */
import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { toast } from "react-hot-toast";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { fetchHistoricalCloses } from "../../yahooFinanceApi";
import {
  buildPortfolioPerformance,
  upsertBenchmarkCloses,
  STANDARD_BENCHMARKS,
  type PerformancePeriod,
} from "../../utils/portfolioPerformance";

const BENCHMARKS = STANDARD_BENCHMARKS;

const PERIODS: Array<{ key: PerformancePeriod; label: string }> = [
  { key: "3M", label: "3개월" },
  { key: "6M", label: "6개월" },
  { key: "1Y", label: "1년" },
  { key: "ALL", label: "전체" },
];

const pct = (v: number | null | undefined): string =>
  v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const gainColor = (v: number | null | undefined): string =>
  v == null ? "var(--text-muted)" : v >= 0 ? "var(--danger)" : "var(--accent)";

export const PortfolioPerformanceSection: React.FC = () => {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const historicalDailyCloses = useAppStore((s) => s.data.historicalDailyCloses);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const benchmarkDailyCloses = useAppStore((s) => s.data.benchmarkDailyCloses);
  const setData = useAppStore((s) => s.setData);
  const fxRate = useFxRateValue();

  const [benchmarkTicker, setBenchmarkTicker] = useState<string>("^KS11");
  const [period, setPeriod] = useState<PerformancePeriod>("1Y");
  const [loading, setLoading] = useState(false);

  const benchmarkLabel = BENCHMARKS.find((b) => b.ticker === benchmarkTicker)?.label ?? benchmarkTicker;

  const perf = useMemo(
    () =>
      buildPortfolioPerformance({
        data: {
          trades,
          accounts,
          historicalDailyCloses,
          historicalDailyFx,
          marketEnvSnapshots,
          benchmarkDailyCloses,
        },
        fxRate,
        benchmarkTicker,
        benchmarkLabel,
        period,
      }),
    [
      trades,
      accounts,
      historicalDailyCloses,
      historicalDailyFx,
      marketEnvSnapshots,
      benchmarkDailyCloses,
      fxRate,
      benchmarkTicker,
      benchmarkLabel,
      period,
    ]
  );

  const hasBenchmarkData = (benchmarkDailyCloses ?? []).some(
    (c) => (c.ticker ?? "").trim().toUpperCase() === benchmarkTicker
  );

  const handleLoadBenchmark = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const fetched = await fetchHistoricalCloses(benchmarkTicker, "2y");
      if (fetched.length === 0) {
        toast.error(`${benchmarkLabel} 지수를 불러오지 못했습니다. 잠시 후 다시 시도하세요.`);
        return;
      }
      setData((prev) => ({
        ...prev,
        benchmarkDailyCloses: upsertBenchmarkCloses(prev.benchmarkDailyCloses, benchmarkTicker, fetched),
      }));
      toast.success(`${benchmarkLabel} ${fetched.length}일치 지수를 불러왔습니다.`);
    } catch {
      toast.error("지수 조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const chartData = perf?.benchmark
    ? perf.benchmark.series.map((p) => ({ date: p.date, 포트폴리오: p.portfolio, [benchmarkLabel]: p.benchmark }))
    : (perf?.twr ?? []).map((p) => ({ date: p.date, 포트폴리오: p.returnIndex }));

  const tickFmt = (d: string) => (typeof d === "string" && d.length >= 10 ? d.slice(2, 7) : d);

  return (
    <div className="card" style={{ minHeight: 360, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>투자 성과 (벤치마크 대비)</div>
          <div className="hint" style={{ fontSize: 13 }}>
            시간가중수익률(TWR) — 입금·출금 효과를 제거한 순수 수익률 · 같은 기간 시장지수와 비교
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={benchmarkTicker}
            onChange={(e) => setBenchmarkTicker(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13 }}
          >
            {BENCHMARKS.map((b) => (
              <option key={b.ticker} value={b.ticker}>{b.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLoadBenchmark}
            disabled={loading}
            style={{ fontSize: 13, padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "불러오는 중…" : hasBenchmarkData ? "지수 갱신" : "지수 불러오기"}
          </button>
        </div>
      </div>

      {/* 기간 선택 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            style={{
              fontSize: 12,
              padding: "4px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: period === p.key ? "var(--primary-light, var(--surface))" : "var(--surface)",
              color: period === p.key ? "var(--primary, var(--text))" : "var(--text-muted)",
              fontWeight: period === p.key ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!perf ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 240, color: "var(--text-muted)" }}>
          거래 내역이 없습니다. 주식 거래를 추가하면 성과가 표시됩니다.
        </div>
      ) : (
        <>
          {/* 요약 — 내 수익률 / 벤치마크 / 초과수익 */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <Summary label="내 수익률 (TWR)" value={pct(perf.twrReturnPct)} color={gainColor(perf.twrReturnPct)}
              sub={perf.annualizedPct != null ? `연율 ${pct(perf.annualizedPct)}` : undefined} />
            {perf.benchmark ? (
              <>
                <Summary label={`${perf.benchmark.benchmarkLabel} 수익률`} value={pct(perf.benchmark.benchmarkReturnPct)} color={gainColor(perf.benchmark.benchmarkReturnPct)} />
                <Summary
                  label="초과수익 (α)"
                  value={pct(perf.benchmark.excessReturnPct)}
                  color={gainColor(perf.benchmark.excessReturnPct)}
                  sub={perf.benchmark.excessReturnPct >= 0 ? "시장을 이기는 중" : "시장에 뒤처짐"}
                />
              </>
            ) : (
              <Summary label={`${benchmarkLabel} 비교`} value="—" color="var(--text-muted)" sub="지수 자동 로딩 중 — 잠시 후 표시" />
            )}
          </div>

          {/* 리스크 지표 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
            <RiskCard label="연율 변동성" value={pct(perf.risk.volatilityPct)} hint="수익률의 출렁임" />
            <RiskCard label="최대낙폭 (MDD)" value={`-${(perf.risk.maxDrawdownPct * 100).toFixed(1)}%`} color="var(--accent)" hint="고점 대비 최대 하락" />
            <RiskCard label="샤프지수" value={perf.risk.sharpe == null ? "-" : perf.risk.sharpe.toFixed(2)} hint="위험 대비 수익" />
            <RiskCard label="베타 (β)" value={perf.beta == null ? "-" : perf.beta.toFixed(2)} hint="시장 민감도" />
          </div>

          {/* 차트 — 시작=100 정규화 */}
          <div style={{ width: "100%", height: 300 }}>
            {chartData.length < 2 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
                {hasBenchmarkData
                  ? "비교할 데이터가 부족합니다 (시세 갱신으로 일별 종가가 쌓이면 표시됩니다)."
                  : `${benchmarkLabel} 지수를 자동으로 불러오는 중입니다 — 잠시 후 곡선이 표시됩니다 (또는 '지수 갱신' 클릭).`}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={tickFmt} tick={{ fontSize: 11 }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={40} />
                  <Tooltip
                    formatter={(value: number | string | undefined, name) => [
                      typeof value === "number"
                        ? `${value.toFixed(1)} (${value >= 100 ? "+" : ""}${(value - 100).toFixed(1)}%)`
                        : (value ?? "-"),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="포트폴리오" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {perf.benchmark && (
                    <Line type="monotone" dataKey={benchmarkLabel} stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {perf.benchmark && (
            <div className="hint" style={{ fontSize: 12, marginTop: 6 }}>
              비교 시작 {perf.benchmark.startDate} · 시작점을 100으로 정규화 · 점선 = {perf.benchmark.benchmarkLabel}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Summary: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({ label, value, color, sub }) => (
  <div>
    <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    {sub && <div className="hint" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>}
  </div>
);

const RiskCard: React.FC<{ label: string; value: string; color?: string; hint: string }> = ({ label, value, color, hint }) => (
  <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--surface)" }}>
    <div className="hint" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
    <div className="hint" style={{ fontSize: 10, marginTop: 2 }}>{hint}</div>
  </div>
);
