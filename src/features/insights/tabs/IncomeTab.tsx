import React from "react";
import { Info } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Pct, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";
import type { IncomeNature } from "../../../utils/realIncome";
import type { LedgerEntry } from "../../../types";
import { useAppStore } from "../../../store/appStore";
import { useFxRateValue } from "../../../context/FxRateContext";
import { toKrwAmount } from "../../dashboard/summaryMath";
import { isExcludedIncomeEntry } from "../../../utils/savingsRate";
import { getThisMonthKST } from "../../../utils/date";
import { computeIncomeNatureKeys } from "../../../utils/incomeClassification";
import { computeTakeHomeTrend } from "../../../utils/annualTakeHome";

// 그룹 색은 이름 고정 매핑 — incByGroup은 금액순 정렬이라 인덱스 기반이면 순서 따라 색이 바뀜
const GROUP_COLOR_BY_NAME: Record<string, string> = {
  "회사소득": "var(--warning)", "투자/패시브": "var(--success)", "기타수입": "var(--accent)", "비실질": "var(--text-faint)",
};

const NATURE_COLORS: Record<IncomeNature, string> = {
  근로: "var(--accent)", 패시브: "var(--success)", 기타: "var(--chart-series-c)",
  일시: "var(--warning)", 환급: "var(--text-faint)", 부채: "var(--danger)",
};
const NATURE_LABELS: Record<IncomeNature, string> = {
  근로: "근로소득", 패시브: "패시브", 기타: "부수입",
  일시: "일시·이전", 환급: "환급·정산", 부채: "부채",
};
/** 실질 수입에서 빼는 이유 — 성격별 한 줄 (조언 아님) */
const NON_REAL_REASON: Partial<Record<IncomeNature, string>> = {
  부채: "갚아야 할 돈이라 실질 수입에서 뺍니다.",
  환급: "내가 먼저 쓴 돈을 돌려받은 것이라 실질 수입에서 뺍니다.",
  일시: "반복이 보장되지 않는 이전성 입금이라 실질 수입에서 뺍니다.",
};

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const fmtMonth = (m: string) => m.replace("-", ".");

interface IncomeFacts {
  lastDate: string;
  /** 완료월 중 발생한 달 수 / 완료월 수 */
  activeMonths: number;
  doneMonths: number;
  /** 직전 완료월 두 개 [그 전월, 직전월] 금액 (0 포함) */
  prevPair: [{ m: string; v: number }, { m: string; v: number }] | null;
  /** 최근 3건 건당 평균 vs 그 이전 건당 평균 (6건 이상일 때만) */
  recentAvg: number | null;
  earlierAvg: number | null;
  /** 평소 달(발생월 중앙값)보다 4배 이상 큰 달 — 분류·금액 확인 필요 */
  outlier: { m: string; v: number; med: number } | null;
}

/**
 * 수입원별 사실(마지막 발생일·발생 패턴·건당 금액 변화·이상치). slice의 incSubInsights와 같은 키(sub‖category)·기간.
 * curMonth(진행 중인 달)는 완료월 통계에서 뺀다.
 */
export function buildIncomeFacts(ledger: LedgerEntry[], months: string[], fxRate: number | null, curMonth: string = getThisMonthKST()): Map<string, IncomeFacts> {
  const done = months.filter((m) => m < curMonth);
  const inRange = new Set(months);
  const bySub = new Map<string, LedgerEntry[]>();
  for (const l of ledger) {
    if (l.kind !== "income" || !(Number(l.amount) > 0) || !l.date || !inRange.has(l.date.slice(0, 7)) || isExcludedIncomeEntry(l)) continue;
    const sub = l.subCategory || l.category || "기타";
    const arr = bySub.get(sub) ?? [];
    arr.push(l);
    bySub.set(sub, arr);
  }
  const out = new Map<string, IncomeFacts>();
  for (const [sub, list] of bySub) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amt = (l: LedgerEntry) => toKrwAmount(l, fxRate);
    const byMonth = new Map<string, number>();
    for (const l of list) byMonth.set(l.date.slice(0, 7), (byMonth.get(l.date.slice(0, 7)) ?? 0) + amt(l));
    const doneVals = done.map((m) => byMonth.get(m) ?? 0);
    const nonZero = doneVals.filter((v) => v > 0);
    const prevPair: IncomeFacts["prevPair"] = done.length >= 2
      ? [{ m: done[done.length - 2], v: doneVals[done.length - 2] }, { m: done[done.length - 1], v: doneVals[done.length - 1] }]
      : null;
    let recentAvg: number | null = null;
    let earlierAvg: number | null = null;
    if (list.length >= 6) {
      const recent = list.slice(-3);
      const earlier = list.slice(0, -3);
      recentAvg = recent.reduce((s, l) => s + amt(l), 0) / recent.length;
      earlierAvg = earlier.reduce((s, l) => s + amt(l), 0) / earlier.length;
    }
    let outlier: IncomeFacts["outlier"] = null;
    if (nonZero.length >= 3) {
      const med = median(nonZero);
      const maxV = Math.max(...nonZero);
      if (med > 0 && maxV >= med * 4) outlier = { m: done[doneVals.indexOf(maxV)], v: maxV, med };
    }
    out.set(sub, { lastDate: list[list.length - 1].date, activeMonths: nonZero.length, doneMonths: done.length, prevPair, recentAvg, earlierAvg, outlier });
  }
  return out;
}

/** 두 달 비교 — 기준이 0이거나 변화가 4배를 넘으면 %를 숨기고 금액만 (103900% 같은 숫자 방지) */
export function pairText(p: NonNullable<IncomeFacts["prevPair"]>): string {
  const [a, b] = p;
  const base = `${fmtMonth(a.m)} ${a.v > 0 ? F(a.v) + "원" : "없음"} → ${fmtMonth(b.m)} ${b.v > 0 ? F(b.v) + "원" : "없음"}`;
  if (a.v <= 0 || b.v <= 0) return base;
  const pct = (b.v / a.v - 1) * 100;
  if (Math.abs(pct) < 5) return `${base} (비슷)`;
  if (Math.abs(pct) > 300) return base;
  return `${base} (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

export const IncomeTab = React.memo(function IncomeTab({ d }: { d: D }) {
  const ledger = useAppStore((s) => s.data.ledger);
  const fxRate = useFxRateValue();
  const facts = React.useMemo(() => buildIncomeFacts(ledger ?? [], d.months, fxRate), [ledger, d.months, fxRate]);
  const accounts = useAppStore((s) => s.data.accounts);
  const categoryTypes = useAppStore((s) => s.data.categoryPresets?.categoryTypes);
  // 실질 월급 추이 — 각 완료월까지 12개월 평균 실수령(대시보드 "내 실질 월급"과 같은 정의, utils/annualTakeHome)
  const takeHomeTrend = React.useMemo(() => {
    const { salaryKeys } = computeIncomeNatureKeys(ledger ?? [], accounts ?? [], categoryTypes);
    return computeTakeHomeTrend({ ledger: ledger ?? [], salaryKeys, fxRate, curMonth: getThisMonthKST() });
  }, [ledger, accounts, categoryTypes, fxRate]);
  const thNow = takeHomeTrend[takeHomeTrend.length - 1] ?? null;
  const thFirstFull = takeHomeTrend.find((p) => !p.partial) ?? null;
  const thYearAgo = takeHomeTrend.length >= 12 && !takeHomeTrend[0].partial ? takeHomeTrend[0] : null;
  // 근로소득 완료월 범위 (최소·최대 달) — 안정성 문장의 근거
  const curMonth = getThisMonthKST();
  const salaryDone = d.months.filter((m) => m < curMonth).map((m) => ({ m, v: d.salaryMonthly[m] ?? 0 })).filter((x) => x.v > 0);
  const salaryMin = salaryDone.length > 0 ? salaryDone.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const salaryMax = salaryDone.length > 0 ? salaryDone.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const otherRealGroup = d.incByGroup.find((g) => g.name === "기타수입")?.value ?? 0;
  // 최근 완료월 3개의 배당·이자 (divTrend는 d.months 평행 배열 — 진행 중인 달 제외)
  const recentDiv = d.months
    .map((m, i) => ({ m, l: d.divTrend[i]?.l ?? fmtMonth(m), amount: d.divTrend[i]?.amount ?? 0 }))
    .filter((x) => x.m < curMonth)
    .slice(-3);
  const incData = d.incByCat.map(([name, value]) => ({ name, value }));
  const totalIncome = incData.reduce((s, x) => s + x.value, 0);

  // 회사소득 그룹 합계 (급여 단독이 아님 — 급여/수당/상여 모두 포함)
  const salaryGroupTotal = d.incByGroup.find((g) => g.name === "회사소득")?.value ?? 0;
  const passiveGroupTotal = d.incByGroup.find((g) => g.name === "투자/패시브")?.value ?? 0;

  // 의존도·패시브 비율 분모는 실질 수입 — 정산·환불·대출 같은 비실질 유입이 비율을 희석하지 않도록
  const salaryPct = d.realIncome > 0 ? (salaryGroupTotal / d.realIncome) * 100 : 0;
  const passivePct = d.realIncome > 0 ? (passiveGroupTotal / d.realIncome) * 100 : 0;

  // 수입 다각화 — 실효 수입원 수 (1 / HHI). 실질 수입원만 대상 (정산·환불·대출은 수입원이 아님)
  const isRealSub = new Map(d.incSubInsights.map((s) => [s.sub, s.isReal]));
  const realIncData = incData.filter((x) => isRealSub.get(x.name) ?? true);
  const realIncTotal = realIncData.reduce((s, x) => s + x.value, 0);
  const hhi = realIncTotal > 0 ? realIncData.reduce((s, x) => s + Math.pow(x.value / realIncTotal, 2), 0) : 0;
  const effectiveSources = hhi > 0 ? 1 / hhi : 0;

  // 패시브 비율 추이 — divTrend는 d.months와 평행 배열이므로 인덱스로 조회
  // ("6월" 같은 연도 없는 라벨 find 조인은 13개월 이상 기간에서 엉뚱한 해와 매칭됨)
  // 분모는 월별 실질 수입(정산·용돈 제외, 배당·이자 포함) — 위 passivePct KPI와 동일 기준
  const passiveRatioTrend = d.months.map((m, i) => {
    const inc = d.realIncomeMonthly[m] ?? 0;
    const dv = d.divTrend[i]?.amount ?? 0;
    return { l: d.ml[m], 수입: inc, 패시브: dv, 비율: inc > 0 ? (dv / inc) * 100 : 0 };
  });

  // 월별 근로소득 + MoM% (incomeGrowth 재사용) — 수입 성장률은 정기 근로소득 기준
  const monthlyInc = d.months.map((m) => ({
    name: d.ml[m],
    수입: d.salaryMonthly[m] ?? 0,
    momPct: d.incomeGrowth.series.find((s) => s.month === m)?.momPct ?? null,
  }));

  const periodLabel = d.selMonth
    ? d.selMonth
    : (d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-");
  const rangeLabel = d.selMonth ? `1개월 (${d.ml[d.selMonth] ?? d.selMonth})` : `${d.months.length}개월`;
  const monthsWithoutIncome = d.salaryTrend
    .filter(m => m.salary === 0 && m.nonSalary === 0)
    .map(m => m.l);

  return (
    <div>
      {/* 상단 기간·단위 배너 */}
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />범위: <strong>{rangeLabel}</strong> ({periodLabel}) · 단위: <strong>원</strong> · 분류: 회사소득(급여·수당·상여) / 투자·패시브(배당·이자 등) / 기타수입(캐시백 등 부수입) / 비실질(정산·환불·지원·용돈·대출 — 실질 수입 제외)
        <div style={{ marginTop: 4 }}>
          분류는 자동 감지입니다. 월급·배당 등이 잘못 분류됐다면 <strong>설정 ▸ 항목 관리 ▸ 수입 성격 지정</strong>에서 카테고리별로 직접 지정할 수 있습니다.
        </div>
      </div>

      {/* ============ 한눈에 보기 ============ */}
      <Section storageKey="income-section-overview" title="한눈에 보기">
        <Card accent><Kpi label="총 수입 (장부)" value={F(totalIncome) + "원"} sub={`실질 ${F(d.realIncome)}원 · ${d.accumLabel}`} color="var(--chart-income)" info="장부 수입(퇴직연금·투자수익 제외) 기준. 실질 수입 = 장부 수입 − 정산·환불·일시소득·대출 + 투자수익" /></Card>
        <Card accent><Kpi label="회사소득 의존도" value={salaryPct.toFixed(1) + "%"} sub={`${F(salaryGroupTotal)}원 / 실질 ${F(d.realIncome)}원`} color="var(--text)" info="회사소득 그룹(급여·수당·상여)이 실질 수입에서 차지하는 비율" /></Card>
        <Card accent><Kpi label="패시브 수입 비율" value={passivePct.toFixed(1) + "%"} sub={`월평균 ${F(Math.round(passiveGroupTotal / d.monthSpan))}원`} color="var(--text)" info="배당·이자 등 패시브 수입 합 / 실질 수입 (투자 매매 수익은 재테크 순집계로 별도)" /></Card>
        <Card accent><Kpi label="실효 수입원 수" value={effectiveSources.toFixed(1) + "개"} sub={`실질 수입원 ${realIncData.length}개 · 집중도 반영`} color="var(--chart-series-c)" info="실질 수입원만 대상 1 / HHI. 같은 비율 N개면 N, 한 곳에 몰릴수록 작음" /></Card>

        <Card title="수입 구조 (그룹별)" span={2}>
          {d.incByGroup.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie isAnimationActive={false} data={d.incByGroup} dataKey="value" cx="50%" cy="50%" outerRadius={95} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 11 }}>
                  {d.incByGroup.map((g, i) => <Cell key={i} fill={GROUP_COLOR_BY_NAME[g.name] ?? C[i]} />)}
                </Pie>
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="그룹별 상세" span={2}>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {d.incByGroup.map((g) => {
              const col = GROUP_COLOR_BY_NAME[g.name] ?? "var(--text)";
              return (
                <div key={g.name}>
                  <div style={{ padding: "8px 0 4px", fontWeight: 700, fontSize: 13, color: col, borderBottom: `2px solid ${col}` }}>
                    {g.name} — {F(g.value)}원 ({totalIncome > 0 ? Math.round(g.value / totalIncome * 100) : 0}%)
                  </div>
                  {g.items.map(([name, value]) => (
                    <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                      <span>{name}</span>
                      <span style={{ fontWeight: 600 }}>{F(value)}원</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {d.incByGroup.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>}
          </div>
        </Card>
      </Section>

      {/* ============ 구성 분해 ============ */}
      <Section storageKey="income-section-composition" title="구성 분해">
        <Card title="수입원 순위 (중분류)" span={2}>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            {incData.map(({ name, value }, i) => {
              const top = incData[0]?.value ?? 1;
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ fontSize: 11, color: i < 3 ? "var(--chart-income)" : "var(--text-faint)", width: 20, textAlign: "right", fontWeight: 700 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                    <div style={{ height: 4, background: "var(--surface-hover)", borderRadius: 2, marginTop: 3 }}>
                      <div style={{ height: 4, background: C[i % 12], borderRadius: 2, width: `${top > 0 ? (value / top) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--chart-income)" }}>{F(value)}원</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{totalIncome > 0 ? Math.round(value / totalIncome * 100) : 0}%</div>
                  </div>
                </div>
              );
            })}
            {incData.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>}
          </div>
        </Card>

        <Card title="장부 vs 실질 수입" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ padding: "12px 14px", background: "var(--success-light)", borderRadius: 10, border: "1px solid var(--success)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>장부 수입 (퇴직연금·투자수익 제외)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--chart-income)" }}>{F(d.pIncome)}원</div>
            </div>
            {d.settlementTotal > 0 && (
              <div style={{ padding: "10px 14px", background: "var(--warning-light)", borderRadius: 8, border: "1px solid var(--warning)", fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>− 정산 (비용분담 회수)</span>
                <span style={{ float: "right", fontWeight: 700, color: "var(--warning)" }}>−{F(d.settlementTotal)}원</span>
              </div>
            )}
            {d.tempIncomeTotal > 0 && (
              <div style={{ padding: "10px 14px", background: "var(--accent-light)", borderRadius: 8, border: "1px solid var(--accent)", fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>− 일시소득 (용돈·지원·이월·대출·처분소득)</span>
                <span style={{ float: "right", fontWeight: 700, color: "var(--accent)" }}>−{F(d.tempIncomeTotal)}원</span>
              </div>
            )}
            {d.carryOverIncome > 0 && (
              <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>− 이월·원래 보유 자산 (번 돈이 아님)</span>
                <span style={{ float: "right", fontWeight: 700 }}>−{F(d.carryOverIncome)}원</span>
              </div>
            )}
            {d.incomeOutsideLedger !== 0 && (
              <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>{d.incomeOutsideLedger > 0 ? "+" : "−"} 투자수익 (장부 수입에선 재테크로 빠짐)</span>
                <span style={{ float: "right", fontWeight: 700 }}>{d.incomeOutsideLedger > 0 ? "+" : "−"}{F(Math.abs(d.incomeOutsideLedger))}원</span>
              </div>
            )}
            <div className="ins-dark-surface" style={{ padding: "12px 14px", borderRadius: 10, color: "var(--text)" }}>
              <div style={{ fontSize: 11, color: "var(--ins-faint)" }}>= 실질 수입 (진짜 내가 번 돈)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--chart-income)" }}>{F(d.realIncome)}원</div>
              <div style={{ fontSize: 11, color: "var(--ins-faint)", marginTop: 4 }}>
                장부 대비 {d.pIncome > 0 ? Math.round((d.realIncome / d.pIncome) * 100) : 0}%
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ============ 추이·성장 ============ */}
      <Section storageKey="income-section-trends" title="추이·성장">
        {thNow && (
          <Card title="실질 월급 추이 — 그 달까지 12개월 평균 실수령" span={4}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.6 }}>
              {thYearAgo
                ? `지금 월 ${F(thNow.monthlyAvg)}원 — 1년 전(${fmtMonth(thYearAgo.month)}까지 12개월) 월 ${F(thYearAgo.monthlyAvg)}원보다 ${thNow.monthlyAvg >= thYearAgo.monthlyAvg ? "+" : ""}${F(thNow.monthlyAvg - thYearAgo.monthlyAvg)}원 (${Pct((thNow.monthlyAvg / thYearAgo.monthlyAvg - 1) * 100)}).`
                : thFirstFull && thFirstFull !== thNow
                  ? `지금 월 ${F(thNow.monthlyAvg)}원 — 기록이 12개월 찬 첫 시점(${fmtMonth(thFirstFull.month)}) 월 ${F(thFirstFull.monthlyAvg)}원 대비 ${thNow.monthlyAvg >= thFirstFull.monthlyAvg ? "+" : ""}${F(thNow.monthlyAvg - thFirstFull.monthlyAvg)}원.`
                  : `지금 월 ${F(thNow.monthlyAvg)}원.`}
              {" "}상여·수당이 든 달이 12개월 창에 들어오고 나갈 때 움직입니다(월급날 전인 진행 중 달은 제외). 점선 구간은 기록이 12개월이 안 돼 있는 달로만 나눈 값.
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={takeHomeTrend.map((p) => ({ l: fmtMonth(p.month).slice(2), 평균: p.monthlyAvg, 부분: p.partial || p === thFirstFull ? p.monthlyAvg : null, 정식: p.partial ? null : p.monthlyAvg }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="l" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => F(v)} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                <Line type="monotone" dataKey="부분" name="12개월 평균(기록 부족)" stroke="var(--chart-income)" strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="정식" name="12개월 평균" stroke="var(--chart-income)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
        <Card title={`근로소득 성장률 — MoM ${d.incomeGrowth.mom != null ? Pct(d.incomeGrowth.mom) : "–"} · YoY ${d.incomeGrowth.yoy != null ? Pct(d.incomeGrowth.yoy) : "–"} · 3M평균 ${d.incomeGrowth.avg3MoM != null ? Pct(d.incomeGrowth.avg3MoM) : "–"}${d.incomeGrowth.partialDay != null ? ` (이번 달 1~${d.incomeGrowth.partialDay}일 동기 비교)` : ""}`} span={4}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={monthlyInc}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tickFormatter={F} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + "%"} tick={{ fontSize: 11 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} yAxisId="left" dataKey="수입" name="근로소득" fill="var(--chart-income)" radius={[4, 4, 0, 0]} />
              <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="momPct" name="MoM%" stroke="var(--chart-warning)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            수입 = 근로소득(월급·수당·상여)만. 정산·용돈·지원·배당·이자 등 비근로 유입은 추세에서 제외.
          </div>
        </Card>

        <Card title="회사소득 vs 비회사소득 추이" span={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.salaryTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} dataKey="salary" stackId="a" fill="var(--chart-income)" name="회사소득" />
              <Bar isAnimationActive={false} dataKey="nonSalary" stackId="a" fill="var(--chart-primary)" name="비회사소득" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {monthsWithoutIncome.length > 0 && (
            <div className="hint" style={{ marginTop: 8, fontSize: 12 }}>
              집계 대상 수입 기록 없음: {monthsWithoutIncome.join(", ")}. 계좌이체·초기잔액은 수입에 포함하지 않습니다.
            </div>
          )}
        </Card>

        <Card title="패시브 수입 월별 (배당·이자)" span={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.divTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              <Bar isAnimationActive={false} dataKey="amount" fill="var(--chart-primary)" radius={[4, 4, 0, 0]} name="패시브 수입" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="패시브 수입 비율 추이 (%)" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={passiveRatioTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => v.toFixed(0) + "%"} tick={{ fontSize: 11 }} domain={[0, "auto"]} />
              <Tooltip formatter={(v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`} />
              <Line isAnimationActive={false} type="monotone" dataKey="비율" stroke="var(--chart-primary)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            월별 (배당·이자 등 패시브 수입) / (월 실질수입) × 100. 장기 상승이면 투자 자산 축적 효과.
          </div>
        </Card>
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="income-section-insights" title="인사이트">
        <Card title="수입 종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 10 }}>
            <Insight title="근로소득이 얼마나 일정한가" tone="info">
              {d.incomeStability !== null
                ? `안정성 지수 ${d.incomeStability}% (1 − 표준편차/평균, 상여 포함).${salaryMin && salaryMax && salaryMin.m !== salaryMax.m ? ` 가장 적은 달 ${fmtMonth(salaryMin.m)} ${F(salaryMin.v)}원 · 가장 많은 달 ${fmtMonth(salaryMax.m)} ${F(salaryMax.v)}원.` : ""}`
                : "완료된 달이 2개월 이상 쌓이면 계산합니다."}
            </Insight>
            <Insight title="배당·이자" tone="success">
              {d.passiveIncome > 0
                ? `${d.accumLabel} ${F(d.passiveIncome)}원 · 실질 수입의 ${passivePct.toFixed(1)}% · 월평균 ${F(Math.round(d.passiveIncome / d.monthSpan))}원.${recentDiv.length > 0 ? ` 최근 완료월: ${recentDiv.map((x) => `${x.l} ${x.amount > 0 ? F(x.amount) + "원" : "없음"}`).join(" · ")}.` : ""}`
                : "기간 내 배당·이자 기록이 없습니다."}
            </Insight>
            <Insight title="회사 밖에서 들어온 돈" tone="warning">
              실질 수입 중 회사소득 {salaryPct.toFixed(0)}%. 나머지 {F(Math.max(0, d.realIncome - salaryGroupTotal))}원 = 배당·이자 {F(passiveGroupTotal)}원 + 부수입(캐시백 등) {F(otherRealGroup)}원.
              {" "}실질 수입원 {realIncData.length}개지만 금액 집중도로 보면 실효 {effectiveSources.toFixed(1)}개입니다.
            </Insight>
            <Insight title="실질 수입 분석" color="var(--chart-series-c)" bg="var(--bg)">
              실질 수입 {F(d.realIncome)}원 = 장부 수입 {F(d.pIncome)}원{d.settlementTotal > 0 ? ` − 정산·분담금 ${F(d.settlementTotal)}원 (돌려받은 돈)` : ""}{d.tempIncomeTotal > 0 ? ` − 일시소득·환불·대출 ${F(d.tempIncomeTotal)}원` : ""}{d.carryOverIncome > 0 ? ` − 이월·원래 보유 ${F(d.carryOverIncome)}원` : ""}{d.incomeOutsideLedger !== 0 ? ` ${d.incomeOutsideLedger > 0 ? "+" : "−"} 투자수익 ${F(Math.abs(d.incomeOutsideLedger))}원` : ""}.
              {" "}실질 저축률 {d.realSavRate == null ? "N/A" : `${d.realSavRate.toFixed(1)}%`}{d.datePartnerShare > 0 ? ` (데이트 계좌 ${F(d.dateAccountSpend)}원 중 상대 부담 ${F(Math.round(d.datePartnerShare))}원 반영)` : ""}.
            </Insight>
          </div>
        </Card>

        {d.incSubInsights.length > 0 && (
          <Card title="수입원별 세부 인사이트" span={4}>
            <div className="grid-2" style={{ gap: 10 }}>
              {d.incSubInsights.map((s) => {
                const natureColor = NATURE_COLORS[s.nature] ?? "var(--text-faint)";
                const f = facts.get(s.sub);
                return (
                  <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border-light)", fontSize: 12, color: "var(--text)", opacity: s.isReal ? 1 : 0.85 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 5, background: natureColor, display: "inline-block" }} />
                        {s.sub}
                        <span style={{ fontSize: 11, fontWeight: 700, color: natureColor, border: `1px solid ${natureColor}`, borderRadius: 8, padding: "1px 6px" }}>{NATURE_LABELS[s.nature] ?? s.nature}</span>
                        {!s.isReal && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", background: "var(--surface-hover)", borderRadius: 8, padding: "1px 6px" }}>실질 수입 제외</span>}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: s.isReal ? "var(--success)" : "var(--text-faint)" }}>{F(s.total)}원</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                      <span>{s.isReal && s.realShare !== null ? `실질 수입 대비 ${s.realShare}%` : `장부 비중 ${s.share}%`}</span>
                      <span>{s.count}건 · 건당 {F(s.avg)}원</span>
                      <span>{f ? `완료월 ${f.doneMonths}개월 중 ${f.activeMonths}개월 발생` : `발생월 평균 ${F(s.monthAvg)}원`}</span>
                      <span>{f ? `마지막 ${f.lastDate}` : ""}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border-light)", paddingTop: 4 }}>
                      {f?.prevPair && s.isReal && <div>{pairText(f.prevPair)}</div>}
                      {f?.recentAvg != null && f.earlierAvg != null && f.earlierAvg > 0 && Math.abs(f.recentAvg / f.earlierAvg - 1) >= 0.15 && (
                        <div>최근 3건 건당 {F(Math.round(f.recentAvg))}원 · 그 이전 건당{F(Math.round(f.earlierAvg))}원</div>
                      )}
                      {!s.isReal && NON_REAL_REASON[s.nature] && <div>{NON_REAL_REASON[s.nature]}</div>}
                      {f?.outlier && (
                        <div style={{ color: "var(--warning)", fontWeight: 600 }}>
                          확인 필요: {fmtMonth(f.outlier.m)} {F(f.outlier.v)}원은 평소 달(중앙값 {F(Math.round(f.outlier.med))}원)의 {Math.round(f.outlier.v / f.outlier.med)}배 — 분류·금액이 맞는지 확인하세요.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
});
