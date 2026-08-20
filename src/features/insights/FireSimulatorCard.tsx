/**
 * FIRE 시뮬레이터 카드 — 인사이트 자산 탭 하단.
 *  - 기준선: utils/fireBaseline(연 실질지출·고정비·월 저축·TWR+배당수익률) — 장부 최근 12개 완료월.
 *  - 투영: utils/fireProjection 결정론 3시나리오(보수/기준/낙관). 몬테카를로 없음.
 *  - 입력 3개(월 저축·수익률·은퇴 후 연 지출)는 로컬 state. 사용자가 건드린 값만
 *    localStorage(STORAGE_KEYS.FIRE_ASSUMPTIONS)에 덮어쓰기 형태로 저장 — AppData 무변경.
 *  - TWR·선행배당은 useAppStore/FxRateContext 직접 구독(LoanPrepaySimulator.useInvestHints와 같은 패턴,
 *    InsightsPage props 시그니처 불변). 순자산은 부모(AssetTab)가 타임라인 값(d.netWorthNow)을 넘긴다.
 *  - 색: 낙관 = --chart-income(상승 빨강), 보수 = --chart-expense(하락 파랑), 기준 = --chart-primary,
 *    FIRE 숫자 = --chart-warning 점선. recharts 전 시리즈 isAnimationActive={false}.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { useDateAccountId } from "../../hooks/useDateAccountSettings";
import { STORAGE_KEYS } from "../../constants/config";
import { getTodayKST } from "../../utils/date";
import { buildPortfolioPerformance } from "../../utils/portfolioPerformance";
import { buildForwardDividends } from "../../utils/forwardDividends";
import { canonicalTickerForMatch } from "../../utils/finance";
import { buildFireBaseline, type FireBaseline } from "../../utils/fireBaseline";
import {
  buildFireScenarios,
  requiredMonthlySavingForYear,
  DEFAULT_INFLATION_PCT,
  DEFAULT_WITHDRAWAL_RATE_PCT,
  type FireProjection,
} from "../../utils/fireProjection";
import { Card, F, W } from "./insightsShared";

interface Props {
  /** 현재 순자산 (타임라인 마지막 행 total — 대시보드와 동일 숫자). 없으면 0 */
  netWorthKRW: number | null;
}

/** 사용자가 덮어쓴 가정만 저장 (undefined = 기준선 값 사용) */
interface FireOverrides {
  monthlySaving?: number;
  returnPct?: number;
  retireSpendingAnnual?: number;
}

function readOverrides(): FireOverrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.FIRE_ASSUMPTIONS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const o = parsed as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return {
      monthlySaving: num(o.monthlySaving),
      returnPct: num(o.returnPct),
      retireSpendingAnnual: num(o.retireSpendingAnnual),
    };
  } catch {
    return {};
  }
}

function writeOverrides(o: FireOverrides): void {
  try {
    const clean: FireOverrides = {};
    if (o.monthlySaving != null) clean.monthlySaving = o.monthlySaving;
    if (o.returnPct != null) clean.returnPct = o.returnPct;
    if (o.retireSpendingAnnual != null) clean.retireSpendingAnnual = o.retireSpendingAnnual;
    if (Object.keys(clean).length === 0) window.localStorage.removeItem(STORAGE_KEYS.FIRE_ASSUMPTIONS);
    else window.localStorage.setItem(STORAGE_KEYS.FIRE_ASSUMPTIONS, JSON.stringify(clean));
  } catch {
    /* 저장 실패는 무시 — 로컬 state로 계속 동작 */
  }
}

/** 포트폴리오 TWR(1Y 연율 %)·향후 12개월 예상 배당(KRW) — 무거운 계산은 useMemo로 격리 */
function useReturnInputs(): { twrAnnualPct: number | null; dividendAnnualKRW: number | null } {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const ledger = useAppStore((s) => s.data.ledger);
  const historicalDailyCloses = useAppStore((s) => s.data.historicalDailyCloses);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const today = getTodayKST();

  const twrAnnualPct = useMemo(() => {
    if (trades.length === 0) return null;
    const perf = buildPortfolioPerformance({
      data: { trades, accounts, historicalDailyCloses, historicalDailyFx, marketEnvSnapshots, benchmarkDailyCloses: [] },
      fxRate,
      period: "1Y",
      endDate: today,
    });
    return perf?.annualizedPct != null ? perf.annualizedPct * 100 : null;
  }, [trades, accounts, historicalDailyCloses, historicalDailyFx, marketEnvSnapshots, fxRate, today]);

  const dividendAnnualKRW = useMemo(() => {
    const qty = new Map<string, number>();
    for (const t of trades) {
      const k = canonicalTickerForMatch(t.ticker);
      if (!k) continue;
      const q = Number(t.quantity) || 0;
      qty.set(k, (qty.get(k) ?? 0) + (t.side === "buy" ? q : -q));
    }
    for (const [k, v] of qty) if (Math.abs(v) < 1e-8) qty.set(k, 0);
    const fd = buildForwardDividends(ledger, today, fxRate, { currentQtyByTicker: qty });
    return fd.annualTotalKRW > 0 ? fd.annualTotalKRW : null;
  }, [trades, ledger, fxRate, today]);

  return { twrAnnualPct, dividendAnnualKRW };
}

const MAN = 10_000;
const REQUIRED_TARGET_YEARS = [10, 15, 20, 25] as const;

const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 };
const rowStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const numInputStyle: React.CSSProperties = { width: 110, padding: "4px 6px", fontSize: 13, textAlign: "right" };
const kpiBox: React.CSSProperties = { padding: "8px 10px", background: "var(--bg)", borderRadius: 6, fontSize: 12 };

function crossoverLabel(p: FireProjection, thisYear: number): string {
  if (p.fireNumberToday == null) return "인출률 0 — 정의 불가";
  if (p.crossoverYear == null) return `${p.assumptions.horizonYears}년 내 도달 못함`;
  if (p.crossoverYear === 0) return "이미 달성";
  return `${p.crossoverYear}년 후 (${thisYear + p.crossoverYear}년)`;
}

export const FireSimulatorCard: React.FC<Props> = ({ netWorthKRW }) => {
  const ledger = useAppStore((s) => s.data.ledger);
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const fxRate = useFxRateValue();
  const dateAccountId = useDateAccountId();
  const today = getTodayKST();
  const thisYear = Number(today.slice(0, 4));
  const { twrAnnualPct, dividendAnnualKRW } = useReturnInputs();

  const baseline: FireBaseline = useMemo(
    () =>
      buildFireBaseline({
        ledger,
        todayIso: today,
        categoryPresets,
        fxRate,
        dateAccountId,
        nonRealIncomeOverride: categoryPresets?.categoryTypes?.nonRealIncome,
        netWorthKRW: netWorthKRW ?? 0,
        twrAnnualPct,
        dividendAnnualKRW,
      }),
    [ledger, today, categoryPresets, fxRate, dateAccountId, netWorthKRW, twrAnnualPct, dividendAnnualKRW]
  );

  const [overrides, setOverrides] = useState<FireOverrides>(() => readOverrides());
  const update = useCallback((patch: FireOverrides) => {
    setOverrides((prev) => {
      const next = { ...prev, ...patch };
      writeOverrides(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setOverrides({});
    writeOverrides({});
  }, []);

  const monthlySaving = overrides.monthlySaving ?? Math.max(0, Math.round(baseline.monthlySavingKRW));
  const returnPct = overrides.returnPct ?? Math.round(baseline.expectedReturnPct * 10) / 10;
  const retireSpendingAnnual = overrides.retireSpendingAnnual ?? Math.max(0, Math.round(baseline.annualRealExpense));
  const hasOverride = overrides.monthlySaving != null || overrides.returnPct != null || overrides.retireSpendingAnnual != null;

  const projParams = useMemo(
    () => ({
      baseline: { netWorthKRW: baseline.netWorthKRW, annualRealExpense: baseline.annualRealExpense },
      assumptions: { returnPct, monthlySaving, retireSpendingAnnual },
    }),
    [baseline.netWorthKRW, baseline.annualRealExpense, returnPct, monthlySaving, retireSpendingAnnual]
  );
  const scenarios = useMemo(() => buildFireScenarios(projParams), [projParams]);
  const required = useMemo(
    () => REQUIRED_TARGET_YEARS.map((y) => ({ year: y, saving: requiredMonthlySavingForYear(projParams, y) })),
    [projParams]
  );

  const chartData = useMemo(() => {
    const b = scenarios.base;
    return b.years.map((y, i) => ({
      year: thisYear + y,
      보수: Math.round(scenarios.conservative.netWorth[i]),
      기준: Math.round(b.netWorth[i]),
      낙관: Math.round(scenarios.optimistic.netWorth[i]),
      "FIRE 숫자": b.fireNumberByYear.length > i ? Math.round(b.fireNumberByYear[i]) : undefined,
    }));
  }, [scenarios, thisYear]);

  const base = scenarios.base;
  const progressPct = base.progressRatio != null ? Math.min(999, base.progressRatio * 100) : null;
  const fixedShare =
    baseline.annualRealExpense > 0 ? Math.round((baseline.annualFixedExpense / baseline.annualRealExpense) * 100) : null;

  // 슬라이더 상한 — 기준선의 2배와 고정 하한 중 큰 값 (기준선이 0이어도 조작 가능)
  const savingMaxMan = Math.max(500, Math.ceil((baseline.monthlySavingKRW * 2) / MAN / 10) * 10);
  const spendMaxMan = Math.max(10_000, Math.ceil((baseline.annualRealExpense * 2) / MAN / 100) * 100);

  return (
    <Card title="🔥 FIRE 시뮬레이터 (가정 기반 추정 — 보장 아님)" span={4}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 12 }}>
        기준선: 최근 {baseline.coveredMonths > 0 ? `${baseline.coveredMonths}개 완료월` : "장부 없음"} ({baseline.windowStartMonth}~{baseline.windowEndMonth})
        · 연 실질 지출 <strong>{W(Math.round(baseline.annualRealExpense))}</strong>
        {fixedShare != null && <> (고정비 {W(Math.round(baseline.annualFixedExpense))}, {fixedShare}%)</>}
        · 월 저축(재테크 유입, 투자손익 제외) <strong>{W(Math.round(baseline.monthlySavingKRW))}</strong>
        · 기대수익률 <strong>{baseline.expectedReturnPct.toFixed(1)}%</strong>
        {" "}({baseline.returnSource === "twr" ? `포트폴리오 1년 TWR ${twrAnnualPct != null ? twrAnnualPct.toFixed(1) : "–"}%` : "TWR 없음 → 기본 4%"}
        {baseline.dividendYieldPct > 0 && ` + 배당 ${baseline.dividendYieldPct.toFixed(1)}%`}, 캡 −5~15%)
        · 인플레 {DEFAULT_INFLATION_PCT}% · 인출률 {DEFAULT_WITHDRAWAL_RATE_PCT}%
      </div>

      {/* 입력 3개 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
        <div style={rowStyle}>
          <label htmlFor="fire-saving" style={labelStyle}>월 저축 (만원)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="fire-saving"
              type="range"
              min={0}
              max={savingMaxMan}
              step={5}
              value={Math.min(savingMaxMan, Math.round(monthlySaving / MAN))}
              onChange={(e) => update({ monthlySaving: Number(e.target.value) * MAN })}
              style={{ flex: 1 }}
              aria-label="월 저축 슬라이더"
            />
            <input
              type="number"
              min={0}
              step={5}
              value={Math.round(monthlySaving / MAN)}
              onChange={(e) => update({ monthlySaving: Math.max(0, Number(e.target.value) || 0) * MAN })}
              style={numInputStyle}
              aria-label="월 저축 (만원)"
            />
          </div>
        </div>
        <div style={rowStyle}>
          <label htmlFor="fire-return" style={labelStyle}>연 수익률 (%)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="fire-return"
              type="range"
              min={-5}
              max={15}
              step={0.5}
              value={Math.min(15, Math.max(-5, returnPct))}
              onChange={(e) => update({ returnPct: Number(e.target.value) })}
              style={{ flex: 1 }}
              aria-label="연 수익률 슬라이더"
            />
            <input
              type="number"
              min={-20}
              max={30}
              step={0.5}
              value={returnPct}
              onChange={(e) => update({ returnPct: Math.min(30, Math.max(-20, Number(e.target.value) || 0)) })}
              style={numInputStyle}
              aria-label="연 수익률 (%)"
            />
          </div>
        </div>
        <div style={rowStyle}>
          <label htmlFor="fire-spend" style={labelStyle}>은퇴 후 연 지출 (만원, 오늘 가치)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="fire-spend"
              type="range"
              min={0}
              max={spendMaxMan}
              step={50}
              value={Math.min(spendMaxMan, Math.round(retireSpendingAnnual / MAN))}
              onChange={(e) => update({ retireSpendingAnnual: Number(e.target.value) * MAN })}
              style={{ flex: 1 }}
              aria-label="은퇴 후 연 지출 슬라이더"
            />
            <input
              type="number"
              min={0}
              step={50}
              value={Math.round(retireSpendingAnnual / MAN)}
              onChange={(e) => update({ retireSpendingAnnual: Math.max(0, Number(e.target.value) || 0) * MAN })}
              style={numInputStyle}
              aria-label="은퇴 후 연 지출 (만원)"
            />
          </div>
        </div>
      </div>
      {hasOverride && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" className="secondary" onClick={reset} style={{ fontSize: 12, padding: "4px 10px" }}>
            기준선 값으로 초기화
          </button>
        </div>
      )}

      {/* 결과 KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={kpiBox}>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>FIRE 숫자 (오늘 가치)</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{base.fireNumberToday == null ? "–" : W(Math.round(base.fireNumberToday))}</div>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>= 은퇴 후 연 지출 ÷ 인출률 {base.assumptions.withdrawalRatePct}%</div>
        </div>
        <div style={kpiBox}>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>현재 달성률</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: progressPct != null && progressPct >= 100 ? "var(--success)" : "var(--text)" }}>
            {progressPct == null ? "–" : `${progressPct.toFixed(1)}%`}
          </div>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>순자산 {W(Math.round(baseline.netWorthKRW))}</div>
        </div>
        <div style={kpiBox}>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>크로스오버 (기준)</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: base.crossoverYear != null ? "var(--text)" : "var(--warning)" }}>
            {crossoverLabel(base, thisYear)}
          </div>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>
            보수 {crossoverLabel(scenarios.conservative, thisYear)} · 낙관 {crossoverLabel(scenarios.optimistic, thisYear)}
          </div>
        </div>
        <div style={kpiBox}>
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>N년 후 은퇴하려면 필요한 월 저축</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px", marginTop: 2 }}>
            {required.map((r) => (
              <div key={r.year} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>{r.year}년</span>
                <span style={{ fontWeight: 700, color: r.saving != null && r.saving <= monthlySaving ? "var(--success)" : "var(--text)" }}>
                  {r.saving == null ? "–" : r.saving === 0 ? "충분" : `${F(Math.round(r.saving / MAN))}만`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 차트 */}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tickFormatter={F} tick={{ fontSize: 11 }} width={70} />
          <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} labelFormatter={(l) => `${l}년`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="보수" stroke="var(--chart-expense)" strokeWidth={1.5} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="기준" stroke="var(--chart-primary)" strokeWidth={2.5} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="낙관" stroke="var(--chart-income)" strokeWidth={1.5} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="FIRE 숫자" stroke="var(--chart-warning)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, marginTop: 8 }}>
        ⚠️ 가정 기반 추정 — 보장 아님. 보수/낙관 = 수익률 ∓2%p·저축 ∓10%. 순자산은 연 단위 복리(저축은 연말 일괄 적립, 명목 고정),
        FIRE 숫자는 인플레 {base.assumptions.inflationPct}%로 매년 상승. 세금·건보료·연금·주택은 반영하지 않음.
        슬라이더 값은 이 기기에만 저장되며 백업/동기화에 포함되지 않습니다.
      </div>
    </Card>
  );
};
