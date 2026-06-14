import React from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Pct, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";
import type { IncomeNature } from "../../../utils/realIncome";

// 그룹 색은 이름 고정 매핑 — incByGroup은 금액순 정렬이라 인덱스 기반이면 순서 따라 색이 바뀜
const GROUP_COLOR_BY_NAME: Record<string, string> = {
  "회사소득": "#f0c040", "투자/패시브": "#48c9b0", "기타수입": "#3498db", "비실질": "#95a5a6",
};

const NATURE_COLORS: Record<IncomeNature, string> = {
  근로: "#3498db", 패시브: "#48c9b0", 기타: "#533483",
  일시: "#f0c040", 환급: "#95a5a6", 부채: "#e94560",
};
const NATURE_LABELS: Record<IncomeNature, string> = {
  근로: "근로소득", 패시브: "패시브", 기타: "부수입",
  일시: "일시·이전", 환급: "환급·정산", 부채: "부채",
};

export const IncomeTab = React.memo(function IncomeTab({ d }: { d: D }) {
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

  return (
    <div>
      {/* 상단 기간·단위 배너 */}
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{rangeLabel}</strong> ({periodLabel}) · 단위: <strong>원</strong> · 분류: 회사소득(급여·수당·상여) / 투자·패시브(배당·이자·투자수익) / 기타수입(캐시백 등 부수입) / 비실질(정산·환불·지원·용돈·대출 — 실질 수입 제외)
      </div>

      {/* ============ 한눈에 보기 ============ */}
      <Section storageKey="income-section-overview" title="📊 한눈에 보기">
        <Card accent><Kpi label="총 수입 (장부)" value={F(totalIncome) + "원"} sub={`실질 ${F(d.realIncome)}원 · ${d.accumLabel}`} color="#f0c040" info="장부 수입 기준. 실질 수입 = 장부 수입 − 정산·환불·일시소득·대출" /></Card>
        <Card accent><Kpi label="회사소득 의존도" value={salaryPct.toFixed(1) + "%"} sub={`${F(salaryGroupTotal)}원 / 실질 ${F(d.realIncome)}원`} color={salaryPct > 80 ? "#e94560" : salaryPct > 50 ? "#f0c040" : "#48c9b0"} info="회사소득 그룹(급여·수당·상여)이 실질 수입에서 차지하는 비율. 80% 초과 시 다각화 권장" /></Card>
        <Card accent><Kpi label="패시브 수입 비율" value={passivePct.toFixed(1) + "%"} sub={`월평균 ${F(Math.round(passiveGroupTotal / d.monthSpan))}원`} color={passivePct >= 10 ? "#48c9b0" : "#3498db"} info="배당·이자·투자수익 합 / 실질 수입. 10%↑ 권장" /></Card>
        <Card accent><Kpi label="실효 수입원 수" value={effectiveSources.toFixed(1) + "개"} sub={`실질 수입원 ${realIncData.length}개 · 집중도 반영`} color="#533483" info="실질 수입원만 대상 1 / HHI. 같은 비율 N개면 N, 한 곳에 몰릴수록 작음" /></Card>

        <Card title="수입 구조 (그룹별)" span={2}>
          {d.incByGroup.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie isAnimationActive={false} data={d.incByGroup} dataKey="value" cx="50%" cy="50%" outerRadius={95} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
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
      <Section storageKey="income-section-composition" title="🎯 구성 분해">
        <Card title="수입원 순위 (중분류)" span={2}>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            {incData.map(({ name, value }, i) => {
              const top = incData[0]?.value ?? 1;
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ fontSize: 11, color: i < 3 ? "#059669" : "var(--text-faint)", width: 20, textAlign: "right", fontWeight: 700 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                    <div style={{ height: 4, background: "var(--surface-hover)", borderRadius: 2, marginTop: 3 }}>
                      <div style={{ height: 4, background: C[i % 12], borderRadius: 2, width: `${top > 0 ? (value / top) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>{F(value)}원</div>
                    <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{totalIncome > 0 ? Math.round(value / totalIncome * 100) : 0}%</div>
                  </div>
                </div>
              );
            })}
            {incData.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>}
          </div>
        </Card>

        <Card title="장부 vs 실질 수입" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ padding: "12px 14px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
              <div style={{ fontSize: 11, color: "#666" }}>장부 수입 (총액)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#059669" }}>{F(d.pIncome)}원</div>
            </div>
            {d.settlementTotal > 0 && (
              <div style={{ padding: "10px 14px", background: "#fdf5e6", borderRadius: 8, border: "1px solid #f0c040", fontSize: 12 }}>
                <span style={{ color: "#666" }}>− 정산 (비용분담 회수)</span>
                <span style={{ float: "right", fontWeight: 700, color: "#d97706" }}>−{F(d.settlementTotal)}원</span>
              </div>
            )}
            {d.tempIncomeTotal > 0 && (
              <div style={{ padding: "10px 14px", background: "#f0f8ff", borderRadius: 8, border: "1px solid #bde", fontSize: 12 }}>
                <span style={{ color: "#666" }}>− 일시소득 (용돈·지원·이월·대출·처분소득)</span>
                <span style={{ float: "right", fontWeight: 700, color: "#2563eb" }}>−{F(d.tempIncomeTotal)}원</span>
              </div>
            )}
            <div style={{ padding: "12px 14px", background: "linear-gradient(135deg, #1a1a2e, #16213e)", borderRadius: 10, color: "#fff" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>= 실질 수입 (진짜 내가 번 돈)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f0c040" }}>{F(d.realIncome)}원</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                장부 대비 {d.pIncome > 0 ? Math.round((d.realIncome / d.pIncome) * 100) : 0}%
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ============ 추이·성장 ============ */}
      <Section storageKey="income-section-trends" title="📈 추이·성장">
        <Card title={`📈 근로소득 성장률 — MoM ${d.incomeGrowth.mom != null ? Pct(d.incomeGrowth.mom) : "–"} · YoY ${d.incomeGrowth.yoy != null ? Pct(d.incomeGrowth.yoy) : "–"} · 3M평균 ${d.incomeGrowth.avg3MoM != null ? Pct(d.incomeGrowth.avg3MoM) : "–"}${d.incomeGrowth.partialDay != null ? ` (이번 달 1~${d.incomeGrowth.partialDay}일 동기 비교)` : ""}`} span={4}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={monthlyInc}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tickFormatter={F} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + "%"} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} yAxisId="left" dataKey="수입" name="근로소득" fill="#f0c040" radius={[4, 4, 0, 0]} />
              <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="momPct" name="MoM%" stroke="#e94560" strokeWidth={2} dot={{ r: 3 }} />
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
              <Bar isAnimationActive={false} dataKey="salary" stackId="a" fill="#f0c040" name="회사소득" />
              <Bar isAnimationActive={false} dataKey="nonSalary" stackId="a" fill="#48c9b0" name="비회사소득" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="패시브 수입 월별 (배당·이자)" span={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.divTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              <Bar isAnimationActive={false} dataKey="amount" fill="#48c9b0" radius={[4, 4, 0, 0]} name="패시브 수입" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="패시브 수입 비율 추이 (%)" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={passiveRatioTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => v.toFixed(0) + "%"} tick={{ fontSize: 10 }} domain={[0, "auto"]} />
              <Tooltip formatter={(v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`} />
              <Line isAnimationActive={false} type="monotone" dataKey="비율" stroke="#48c9b0" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            월별 (배당+이자+투자수익) / (월 실질수입) × 100. 장기 상승이면 투자 자산 축적 효과.
          </div>
        </Card>
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="income-section-insights" title="💡 인사이트">
        <Card title="수입 종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 10 }}>
            <Insight title="수입 안정성" tone="info">
              {d.incomeStability !== null ? `안정성 지수 ${d.incomeStability}% (1 − 표준편차/평균). ${d.incomeStability >= 70 ? "매우 안정적인 수입 흐름. 지출 계획과 투자 전략 세우기 좋은 환경." : d.incomeStability >= 40 ? "수입에 변동이 있지만 관리 가능 수준. 변동 원인 파악하면 더 안정화 가능." : "수입 변동이 큼. 비상자금(재정 활주로 6개월 이상) 확보 필수, 안정 수입원 늘리기 권장."}` : "데이터 부족 (최소 2개월 이상 필요)"}
            </Insight>
            <Insight title="패시브 수입 현황" tone="success">
              {d.passiveIncome > 0 ? `배당·이자·투자수익 합산 ${F(d.passiveIncome)}원 (실질 수입의 ${passivePct.toFixed(1)}%). 월평균 ${F(Math.round(d.passiveIncome / d.monthSpan))}원의 패시브 수입이 발생. ${passivePct >= 10 ? "패시브 비중 10% 달성. 자산이 돈을 벌어주는 구조!" : "10% 이상으로 늘리면 FIRE 가능성이 커집니다. 배당 ETF 적립식 투자가 시작점."}` : "패시브 수입 없음. 배당주/ETF/예금 이자 등 소액부터 시작해 보세요. 월 1만원도 의미 있는 첫걸음."}
            </Insight>
            <Insight title="수입 다각화 점검" tone="warning">
              실질 수입원 {realIncData.length}개 · 실효 {effectiveSources.toFixed(1)}개.
              {salaryPct > 80
                ? ` 회사소득 의존도 ${salaryPct.toFixed(0)}%로 매우 높습니다. 비회사 실질 수입 ${F(Math.max(0, d.realIncome - salaryGroupTotal))}원에 불과. 부업·투자 수입·프리랜서로 다각화 권장.`
                : salaryPct > 50
                  ? ` 회사소득 ${salaryPct.toFixed(0)}%로 적정. 비회사 실질 수입(${F(Math.max(0, d.realIncome - salaryGroupTotal))}원)이 버퍼 역할.`
                  : ` 회사소득 의존도 ${salaryPct.toFixed(0)}% — 훌륭한 다각화!`}
              {effectiveSources < 2 && " 실효 수입원이 2 미만 = 사실상 단일 의존. 분산 필요."}
            </Insight>
            <Insight title="실질 수입 분석" color="#7c3aed" bg="rgba(139,92,246,0.08)">
              실질 수입 {F(d.realIncome)}원 = 장부 수입 {F(d.pIncome)}원{d.settlementTotal > 0 ? ` − 정산·분담금 ${F(d.settlementTotal)}원 (돌려받은 돈)` : ""}{d.tempIncomeTotal > 0 ? ` − 일시소득·환불·대출 ${F(d.tempIncomeTotal)}원` : ""}.
              {" "}회사소득 {F(salaryGroupTotal)}원과 패시브 {F(passiveGroupTotal)}원이 지속 가능한 재산 형성의 핵심.
              {" "}실질 저축률 {d.realSavRate.toFixed(1)}%{d.datePartnerShare > 0 ? ` (데이트 계좌 ${F(d.dateAccountSpend)}원 중 상대 부담 ${F(Math.round(d.datePartnerShare))}원 반영)` : ""}.
            </Insight>
          </div>
        </Card>

        {d.incSubInsights.length > 0 && (
          <Card title="수입원별 세부 인사이트" span={4}>
            <div className="grid-2" style={{ gap: 10 }}>
              {d.incSubInsights.map((s) => {
                const natureColor = NATURE_COLORS[s.nature] ?? "var(--text-faint)";
                // 추세 색 배경은 정기 수입원에만 — 비정기·환급·부채에 "급감" 빨강은 노이즈
                const tinted = s.isReal && s.recurring;
                return (
                  <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: tinted && s.monthTrend === "up" ? "var(--primary-light)" : tinted && s.monthTrend === "down" ? "var(--danger-light)" : "var(--bg)", border: "1px solid var(--border-light)", fontSize: 12, color: "var(--text)", opacity: s.isReal ? 1 : 0.85 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 5, background: natureColor, display: "inline-block" }} />
                        {s.sub}
                        <span style={{ fontSize: 10, fontWeight: 700, color: natureColor, border: `1px solid ${natureColor}`, borderRadius: 8, padding: "1px 6px" }}>{NATURE_LABELS[s.nature] ?? s.nature}</span>
                        {!s.isReal && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", background: "var(--surface-hover)", borderRadius: 8, padding: "1px 6px" }}>실질 수입 제외</span>}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: s.isReal ? "var(--success)" : "var(--text-faint)" }}>{F(s.total)}원</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                      <span>{s.isReal && s.realShare !== null ? `실질 수입 대비 ${s.realShare}%` : `장부 비중 ${s.share}%`}</span>
                      <span>{s.count}건 · 건당 {F(s.avg)}원</span>
                      <span>발생월 평균: {F(s.monthAvg)}원</span>
                      <span>안정성: {s.stability === null ? "— (표본 부족)" : `${s.stability}%`}</span>
                    </div>
                    <div style={{ fontSize: 11, color: tinted && s.monthTrend === "up" ? "var(--success)" : tinted && s.monthTrend === "down" ? "var(--danger)" : "var(--text-faint)", fontWeight: 600, marginBottom: 4 }}>
                      {tinted
                        ? (s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사")
                        : "비정기 발생"}
                      {s.maxMonth ? ` · 최대: ${s.maxMonth} (${F(s.maxMonthAmt)}원)` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border-light)", paddingTop: 4 }}>
                      {s.comment}
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
