import React from "react";
import {
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart, Bar,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Pct, SD, Card, Kpi, Insight, CT, Section, type D } from "../insightsShared";
import { useAppStore } from "../../../store/appStore";

export const OverviewTab = React.memo(function OverviewTab({ d }: { d: D }) {
  const flowData = d.months.slice(0, -1).map(m => ({ name: d.ml[m], 순현금흐름: d.monthly[m].income - d.monthly[m].expense - d.monthly[m].investment }));
  const expBadge = d.prev ? Pct(SD(d.pExpense - d.prev.expense, d.prev.expense) * 100) + " vs 전월" : undefined;
  const top3Sub = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제").slice(0, 3);
  const top3pct = d.pExpense > 0 ? Math.round(top3Sub.reduce((s, x) => s + x.amount, 0) / d.pExpense * 100) : 0;

  /* 재정 활주로 (Financial Runway): 현금성 자산 / 월평균 지출 */
  const liquidAssets = d.accountBalances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const runwayMonths = d.avgMonthExp > 0 ? liquidAssets / d.avgMonthExp : null;
  const runwayColor = runwayMonths == null ? "#999" : runwayMonths >= 12 ? "#48c9b0" : runwayMonths >= 6 ? "#f0c040" : "#e94560";
  const runwayLabel = runwayMonths == null
    ? "-"
    : runwayMonths >= 24 ? "매우 여유" : runwayMonths >= 12 ? "안정권" : runwayMonths >= 6 ? "주의" : "위험";

  /* 저축률 목표 vs 실제 */
  const goals = useAppStore((s) => s.data.investmentGoals);
  const monthsCount = Math.max(1, d.months.length);
  const monthlyRealIncome = d.realIncome / monthsCount;
  const monthlyDepositTarget = goals?.annualDepositTarget ? goals.annualDepositTarget / 12 : null;
  const targetSavRate = monthlyDepositTarget && monthlyRealIncome > 0
    ? (monthlyDepositTarget / monthlyRealIncome) * 100
    : 30;
  const targetSavRateSrc = monthlyDepositTarget ? "목표 설정값" : "기본 벤치마크 30%";
  const actualSavRate = d.realSavRate;
  const savRateOk = actualSavRate >= targetSavRate;

  /* 수입 성장률 요약 */
  const ig = d.incomeGrowth;
  const igMomColor = ig.mom == null ? "#999" : ig.mom >= 0 ? "#48c9b0" : "#e94560";
  const igYoyColor = ig.yoy == null ? "#999" : ig.yoy >= 0 ? "#48c9b0" : "#e94560";
  const igAvgColor = ig.avg3MoM == null ? "#999" : ig.avg3MoM >= 0 ? "#48c9b0" : "#e94560";

  /* 지출 관성 */
  const si = d.spendingInertia;
  const siColor = si?.deviation == null ? "#999" : si.deviation > 20 ? "#e94560" : si.deviation > 5 ? "#f0c040" : si.deviation < -10 ? "#48c9b0" : "#3498db";
  const siLabel = si?.deviation == null ? "데이터 부족" : si.deviation > 20 ? "과열" : si.deviation > 5 ? "상승세" : si.deviation < -10 ? "절약 모드" : "평상시";

  return (
    <div>
      {/* ============ SECTION 1: 이번달 핵심 ============ */}
      <Section storageKey="overview-section-hero" title="🎯 이번달 핵심">
        {/* 이상치 주목 배너 */}
        {d.topAnomaly && d.anomalyTargetMonth && (
          <div style={{
            gridColumn: "span 4",
            padding: "14px 18px",
            borderRadius: 12,
            background: d.topAnomaly.severity === "extreme"
              ? "linear-gradient(90deg, #e94560 0%, #dc2626 100%)"
              : "linear-gradient(90deg, #f59e0b 0%, #f0c040 100%)",
            color: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                  {d.ml[d.anomalyTargetMonth]} 주목할 한 가지
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
                  <strong>{d.topAnomaly.category}</strong> 지출이 평소보다{" "}
                  <span style={{ fontWeight: 800 }}>
                    {d.topAnomaly.percentChange >= 0 ? "+" : ""}{d.topAnomaly.percentChange.toFixed(0)}%
                  </span>
                  {" "}({W(Math.round(d.topAnomaly.currentMonthAmount))} vs 평균 {W(Math.round(d.topAnomaly.averageAmount))})
                </div>
              </div>
            </div>
            <span style={{ padding: "4px 10px", borderRadius: 12, background: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: 700 }}>
              z-score {d.topAnomaly.zScore.toFixed(1)}
            </span>
          </div>
        )}

        <Card accent><Kpi label="실질 수입" value={F(d.realIncome)} sub={d.settlementTotal > 0 ? `정산 ${F(d.settlementTotal)} 제외` : "근로+투자 소득"} color="#f0c040" info="장부 수입 − 정산 회수액 − 일시소득(용돈·지원·이월·대출·처분소득 등)" /></Card>
        <Card accent><Kpi label="실질 지출" value={F(d.realExpense)} sub={d.datePartnerShare > 0 ? `데이트 50% (${F(Math.round(d.datePartnerShare))}) 제외` : ""} badge={expBadge} color="#e94560" info="장부 지출 − 데이트 계좌 지출의 50% (상대 부담분). 재테크·환전 제외" /></Card>
        <Card accent><Kpi label="실질 순수익" value={F(d.netProfit)} sub="실질수입 − 실질지출" color={d.netProfit >= 0 ? "#48c9b0" : "#e94560"} info="실질수입 − 실질지출. 양수=흑자(자산 증가), 음수=적자" /></Card>
        <Card accent><Kpi label="실질 저축률" value={d.realSavRate.toFixed(1) + "%"} sub={`월평균 지출 ${F(Math.round(d.avgMonthExp))}`} color="#fff" info="(실질수입 − 실질지출) / 실질수입 × 100. 30% 이상이 건강한 수준" /></Card>

        <Card title="🛫 재정 활주로 — 수입 없이 버틸 수 있는 기간" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, fontWeight: 800, color: runwayColor, lineHeight: 1 }}>
                {runwayMonths == null ? "–" : runwayMonths.toFixed(1)}
                <span style={{ fontSize: 20, marginLeft: 6, fontWeight: 600 }}>개월</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: runwayColor, marginTop: 6 }}>{runwayLabel}</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "#555" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#999" }}>현금성 자산 (모든 계좌 합계)</span>
                <span style={{ fontWeight: 700 }}>{F(liquidAssets)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#999" }}>월평균 지출</span>
                <span style={{ fontWeight: 700 }}>{F(Math.round(d.avgMonthExp))}</span>
              </div>
              <div style={{ padding: "8px 12px", background: "#f8f9fa", borderRadius: 6, marginTop: 8, fontSize: 12, color: "#666" }}>
                수입이 갑자기 끊겨도 현재 지출 수준으로 {runwayMonths != null ? `약 ${runwayMonths.toFixed(1)}개월` : "—"} 유지 가능.
                일반적으로 <strong>6개월 이상</strong>은 안전, 12개월 이상이면 여유 있음.
                {runwayMonths != null && runwayMonths < 6 && " 비상자금 확보를 권장합니다."}
              </div>
            </div>
          </div>
        </Card>

        <Card title={`🎯 저축률 목표 vs 실제 (${targetSavRateSrc})`} span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#999", fontWeight: 600 }}>현재 저축률</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: savRateOk ? "#48c9b0" : actualSavRate >= 0 ? "#f0c040" : "#e94560" }}>
                {actualSavRate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>목표 {targetSavRate.toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ position: "relative", height: 36, background: "#f0f0f0", borderRadius: 18, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: `${Math.min(100, (targetSavRate / Math.max(targetSavRate, actualSavRate, 50)) * 100)}%`,
                  width: 2, background: "#1a1a2e", zIndex: 2,
                }} />
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (Math.max(0, actualSavRate) / Math.max(targetSavRate, actualSavRate, 50)) * 100)}%`,
                  background: savRateOk
                    ? "linear-gradient(90deg, #48c9b0, #10b981)"
                    : actualSavRate >= 0
                      ? "linear-gradient(90deg, #f0c040, #f59e0b)"
                      : "linear-gradient(90deg, #e94560, #dc2626)",
                  transition: "width 0.4s",
                }} />
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0 12px", fontSize: 11, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                }}>
                  <span>0%</span>
                  <span style={{ color: "#333", textShadow: "none" }}>목표 {targetSavRate.toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                {savRateOk
                  ? `✅ 목표 ${targetSavRate.toFixed(0)}%를 달성 중입니다. 월 실질수입 ${F(Math.round(monthlyRealIncome))} 중 ${F(Math.round(monthlyRealIncome * actualSavRate / 100))} 저축.`
                  : actualSavRate >= 0
                    ? `목표까지 ${(targetSavRate - actualSavRate).toFixed(1)}%p 부족. 월 ${F(Math.round(monthlyRealIncome * (targetSavRate - actualSavRate) / 100))} 더 절약 or 수입 증가 필요.`
                    : `⚠️ 현재 적자 상태. 수입보다 지출이 많습니다. 우선 지출 축소가 시급합니다.`}
                {!monthlyDepositTarget && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#999" }}>
                    ℹ️ 대시보드 {">"} 투자 요약에서 연 입금액 목표를 설정하면 개인화된 목표 저축률이 적용됩니다.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ============ SECTION 2: 장기 트렌드 ============ */}
      <Section storageKey="overview-section-trends" title="📊 장기 트렌드">
        {/* 수입 성장률 (NEW) */}
        <Card title="📈 수입 성장률 (MoM · YoY · 3M 평균)" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
            <div style={{ padding: "12px 14px", background: "#f8f9fa", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>전월 대비 (MoM)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igMomColor, marginTop: 4 }}>
                {ig.mom == null ? "–" : Pct(ig.mom)}
              </div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                {ig.prevInc > 0 ? `${F(ig.prevInc)} → ${F(ig.targetInc)}` : "비교 데이터 없음"}
              </div>
            </div>
            <div style={{ padding: "12px 14px", background: "#f8f9fa", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>전년 동월 대비 (YoY)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igYoyColor, marginTop: 4 }}>
                {ig.yoy == null ? "–" : Pct(ig.yoy)}
              </div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                {ig.yoy == null ? "1년 전 데이터 없음" : "작년 동월 비교"}
              </div>
            </div>
            <div style={{ padding: "12px 14px", background: "#f8f9fa", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>최근 3개월 평균 성장률</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igAvgColor, marginTop: 4 }}>
                {ig.avg3MoM == null ? "–" : Pct(ig.avg3MoM)}
              </div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>월평균 MoM</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={ig.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={F} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + "%"} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="income" name="수입" fill="#f0c040" radius={[4, 4, 0, 0]} opacity={0.5} />
              <Line yAxisId="right" type="monotone" dataKey="momPct" name="MoM%" stroke="#e94560" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="순 현금흐름 (수입 - 지출 - 투자)" span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={flowData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
              <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e94560" stopOpacity={0.3} /><stop offset="95%" stopColor="#e94560" stopOpacity={0} /></linearGradient></defs>
              <Area dataKey="순현금흐름" stroke="#e94560" fill="url(#fg)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="누적 저축률 추이" span={2}>
          <p style={{ fontSize: 11, color: "#999", margin: "0 0 4px", textAlign: "right" }}>월급이 월말 지급이므로 월별 저축률 대신 누적 기준 표시</p>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={d.savRateTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 11 }} /><Tooltip formatter={(v: ValueType | undefined) => Number(v ?? 0).toFixed(1) + "%"} />
              <Bar dataKey="rate" name="월별" radius={[4, 4, 0, 0]} opacity={0.35}>
                {d.savRateTrend.map((e, i) => <Cell key={i} fill={e.rate >= 30 ? "#48c9b0" : e.rate >= 0 ? "#f0c040" : "#e94560"} />)}
              </Bar>
              <Line dataKey="cumRate" name="누적" stroke="#0f3460" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="누적 수입 vs 누적 지출" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.cumIE}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="누적수입" stroke="#f0c040" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="누적지출" stroke="#e94560" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </Section>

      {/* ============ SECTION 3: 심층 분석 ============ */}
      <Section storageKey="overview-section-analysis" title="🔬 심층 분석">
        <Card title="장부 vs 실질 비교 (왜 다른가?)" span={4}>
          <div className="grid-4" style={{ gap: 12, fontSize: 13 }}>
            <div style={{ padding: "12px 14px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>장부 수입 (전체)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#059669" }}>{F(d.pIncome)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>→ 실질 수입: {F(d.realIncome)}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#fff5f5", borderRadius: 10, border: "1px solid #fcc" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>장부 지출 (전체)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#e94560" }}>{F(d.pExpense)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>→ 실질 지출: {F(d.realExpense)}</div>
            </div>
            {d.settlementTotal > 0 && (
              <div style={{ padding: "12px 14px", background: "#fdf5e6", borderRadius: 10, border: "1px solid #f0c040" }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>정산 (상대가 돌려준 돈)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#d97706" }}>{F(d.settlementTotal)}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>실 수입에서 차감 (내 돈 아님)</div>
              </div>
            )}
            {d.datePartnerShare > 0 && (
              <div style={{ padding: "12px 14px", background: "#ffe8ee", borderRadius: 10, border: "1px solid #f8b4c7" }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>데이트 계좌 상대 부담 (50%)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#c74562" }}>{F(Math.round(d.datePartnerShare))}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>데이트 지출 {F(d.dateAccountSpend)} × 0.5 · 실 지출에서 차감</div>
              </div>
            )}
            <div style={{ padding: "12px 14px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>패시브 수입</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>{F(d.passiveIncome)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>배당·이자 등 투자수익</div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#999", lineHeight: 1.6, padding: "8px 12px", background: "#f8f9fa", borderRadius: 8 }}>
            <strong>실질 수입</strong> = 장부 수입 − 정산(상대가 돌려준 돈) − 일시소득(용돈·지원·이월·대출·처분소득).{" "}
            <strong>실질 지출</strong> = 장부 지출 − 데이트 계좌 지출 × 50%(상대 부담분).{" "}
            저축률은 실질 기준으로 계산해야 실제 재산 형성 능력을 반영합니다.
          </div>
        </Card>

        {/* 지출 관성 (NEW) */}
        <Card title="⚡ 지출 관성" span={2}>
          {si == null ? (
            <div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>
              비교할 과거 데이터가 부족합니다.
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>이번달 지출</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>{F(Math.round(si.curExp))}</div>
                </div>
                <div style={{ fontSize: 24, color: "#ccc" }}>↔</div>
                <div>
                  <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>최근 {si.lookbackMonths}개월 평균</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#666" }}>{F(Math.round(si.avg))}</div>
                </div>
              </div>
              <div style={{
                padding: "12px 14px",
                background: si.deviation != null && si.deviation > 20 ? "#fff5f5" : si.deviation != null && si.deviation > 5 ? "#fff7e6" : si.deviation != null && si.deviation < -10 ? "#f0fdf4" : "#f0f8ff",
                borderRadius: 8, marginTop: 8, textAlign: "center",
              }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: siColor }}>
                  {si.deviation == null ? "–" : Pct(si.deviation)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: siColor, marginTop: 2 }}>{siLabel}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 6, lineHeight: 1.5 }}>
                  {si.deviation == null ? "" :
                    si.deviation > 20 ? "지출이 평소보다 크게 늘었어요. 카테고리 점검을 권장합니다." :
                    si.deviation > 5 ? "최근 지출 증가 추세. 이상치 배너도 확인하세요." :
                    si.deviation < -10 ? "평소보다 절약 중입니다. 좋은 흐름이에요!" :
                    "지출이 평소 수준입니다."}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card title="재무 건강 점수" span={2}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 16, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ position: "relative", width: 120, height: 120, borderRadius: "50%", background: `conic-gradient(${d.score.total >= 70 ? "#48c9b0" : d.score.total >= 40 ? "#f0c040" : "#e94560"} ${d.score.total * 3.6}deg, #f0f0f0 ${d.score.total * 3.6}deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 96, height: 96, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 28, fontWeight: 800 }}>{d.score.total}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#e94560" }}>{d.score.grade}</span>
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, textAlign: "center" }}>{d.score.comment}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              {(() => {
                const sr = d.pSavRate;
                const srPts = sr >= 50 ? 40 : sr >= 30 ? 30 : sr >= 20 ? 20 : sr >= 10 ? 10 : 0;
                const zeroRatio = d.totalDays > 0 ? d.zeroDays / d.totalDays : 0;
                const zPts = zeroRatio > 0.2 ? 20 : zeroRatio > 0.1 ? 10 : 0;
                const iPts = d.pInvest > 0 ? 20 : 5;
                const nDiv = d.incByCat.length;
                const dPts = nDiv >= 5 ? 20 : nDiv >= 3 ? 15 : nDiv >= 2 ? 10 : 5;
                const items = [
                  { label: "저축률", pts: srPts, max: 40, hint: `${sr.toFixed(0)}% (50%=만점)`, color: "#48c9b0" },
                  { label: "무지출 비율", pts: zPts, max: 20, hint: `${(zeroRatio * 100).toFixed(0)}% (20%=만점)`, color: "#3498db" },
                  { label: "투자 활동", pts: iPts, max: 20, hint: d.pInvest > 0 ? "활성" : "없음", color: "#f0c040" },
                  { label: "수입 다양성", pts: dPts, max: 20, hint: `${nDiv}개 수입원 (5+=만점)`, color: "#e94560" },
                ];
                return items.map((it) => (
                  <div key={it.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontWeight: 600 }}>{it.label} <span style={{ color: "#999", fontWeight: 400, marginLeft: 4 }}>{it.hint}</span></span>
                      <span style={{ fontWeight: 700 }}>{it.pts} / {it.max}</span>
                    </div>
                    <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(it.pts / it.max) * 100}%`, background: it.color, transition: "width 0.4s" }} />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </Card>

        <Card title={`핵심 재무 지표 — ${d.months.length}개월 누적 기준`} span={4}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 10, padding: "6px 10px", background: "#f8f9fa", borderRadius: 6, lineHeight: 1.5 }}>
            ℹ️ 금액 단위는 <strong>원</strong>. 표시 범위는 상단 기간 필터({d.months.length}개월, {d.months[0] ?? "-"} ~ {d.months[d.months.length - 1] ?? "-"})에 해당.
            <strong>누적</strong> 기준 표기가 기본이며, 일평균·투자수익률은 별도 기준.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            {[
              { label: "순수익", value: F(d.netProfit) + "원", sub: `${d.months.length}개월 누적 · 실질수입 − 실질지출`, color: d.netProfit >= 0 ? "#059669" : "#e94560", bg: d.netProfit >= 0 ? "#f0fdf4" : "#fff5f5", border: d.netProfit >= 0 ? "#86efac" : "#fcc" },
              { label: "실질 저축률", value: d.realSavRate.toFixed(1) + "%", sub: `${d.months.length}개월 누적 기준`, color: d.realSavRate >= 30 ? "#059669" : d.realSavRate >= 0 ? "#f0c040" : "#e94560", bg: "#f0f8ff", border: "#bde" },
              { label: "지출/수입 비율", value: d.expToIncRatio.toFixed(1) + "%", sub: d.expToIncRatio > 80 ? "⚠ 지출 비중 높음" : `${d.months.length}개월 누적`, color: d.expToIncRatio > 80 ? "#e94560" : "#2563eb", bg: "#f8f9fa", border: "#eee" },
              { label: "패시브 수입", value: F(d.passiveIncome) + "원", sub: `${d.months.length}개월 누적 · 수입 대비 ${d.pIncome > 0 ? Math.round(SD(d.passiveIncome, d.pIncome) * 100) : 0}%`, color: "#48c9b0", bg: "#f0fdf4", border: "#86efac" },
              { label: "일 평균 지출", value: F(d.dailyAvgExp) + "원", sub: `하루당 · ${d.totalDays}일 기준`, color: "#533483", bg: "rgba(83,52,131,0.06)", border: "rgba(83,52,131,0.2)" },
            ].map(m => (
              <div key={m.label} style={{ padding: "12px 14px", background: m.bg, borderRadius: 10, border: `1px solid ${m.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.color }}>{m.value}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{m.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 10 }}>
            {[
              { label: "순현금흐름", value: F(d.netCashFlow) + "원", sub: `${d.months.length}개월 누적 · 수입−지출−투자`, color: d.netCashFlow >= 0 ? "#059669" : "#e94560" },
              { label: "투자 수익률", value: d.investReturnRate !== 0 ? d.investReturnRate.toFixed(1) + "%" : "-", sub: "전 기간 · 실현손익 / 투자원금", color: d.investReturnRate >= 0 ? "#059669" : "#e94560" },
              { label: "고정비", value: F(d.fixedExpense) + "원", sub: `${d.months.length}개월 누적 · 지출의 ${Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%`, color: "#0f3460" },
              { label: "변동비", value: F(d.variableExpense) + "원", sub: `${d.months.length}개월 누적 · 지출의 ${Math.round(SD(d.variableExpense, d.pExpense) * 100)}%`, color: "#f39c12" },
              { label: "수입 안정성", value: d.incomeStability !== null ? d.incomeStability + "%" : "-", sub: d.incomeStability !== null && d.incomeStability >= 70 ? "월별 편차 작음" : "월별 편차 큼", color: "#2563eb" },
            ].map(m => (
              <div key={m.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8, border: "1px solid #eee", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#999", fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
                <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </Card>

        {d.subInsights.length > 0 && (
          <Card title="중분류별 상세 분석" span={4}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {d.subInsights.slice(0, 9).map((s, i) => (
                <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {s.sub}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "#555" }}>
                    <span>비중: {s.share}%</span>
                    <span>건수: {s.count}건</span>
                    <span>건당 평균: {F(s.avg)}</span>
                    <span>월평균: {F(s.monthAvg)}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600 }}>
                    {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                    {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가`}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 6 }}>
                    {s.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {/* ============ SECTION 4: 종합 인사이트 ============ */}
      <Section storageKey="overview-section-insights" title="💡 종합 인사이트" defaultOpen={false}>
        <Card title="종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Insight title="저축률 분석" color="#059669" bg="#d4edda">
              {d.pSavRate >= 30
                ? `저축률 ${d.pSavRate.toFixed(0)}%로 매우 건강한 수준입니다. 수입 ${F(d.pIncome)} 중 ${F(Math.round(d.pIncome * d.pSavRate / 100))}을 저축하고 있습니다. 이 속도라면 연간 약 ${F(Math.round(d.pIncome * d.pSavRate / 100 * 12 / Math.max(d.months.length, 1)))} 이상 자산 증가가 가능합니다.`
                : d.pSavRate >= 0
                ? `저축률 ${d.pSavRate.toFixed(0)}%로 개선 여지가 있습니다. 30% 이상을 목표로 월 ${F(Math.round(d.pExpense * 0.1))} 정도 추가 절약하면 장기적으로 큰 차이를 만들 수 있습니다.`
                : `마이너스 저축률! 수입보다 지출이 ${F(d.pExpense - d.pIncome)} 더 많습니다. 고정비와 변동비를 점검하고, 상위 지출 카테고리부터 줄여보세요.`}
            </Insight>
            <Insight title="지출 집중도 분석" color="#b45309" bg="#fff3cd">
              상위 3개 중분류({top3Sub.map(s => s.sub).join(", ")})가 전체 지출의 {top3pct}%를 차지합니다.
              {top3pct > 70 ? ` 지출이 소수 카테고리에 집중되어 있어 해당 항목의 절약이 전체 지출 감소에 큰 효과를 줍니다. 특히 1위 ${top3Sub[0]?.sub}(${F(top3Sub[0]?.amount ?? 0)})에 집중해 보세요.` : ` 비교적 골고루 분산되어 있어 특정 항목보다 전반적인 소비 습관 개선이 효과적입니다.`}
              {top3Sub[0] && d.pExpense > 0 && ` 1위 ${top3Sub[0].sub}만 10% 줄여도 월 ${F(Math.round(top3Sub[0].amount * 0.1 / Math.max(d.months.length, 1)))} 절약.`}
            </Insight>
            <Insight title="투자 현황" color="#2563eb" bg="#cce5ff">
              {d.pIncome > 0
                ? `수입 대비 투자 비율 ${Math.round(d.pInvest / d.pIncome * 100)}%. 총 ${F(d.pInvest)}를 투자에 할당했습니다.`
                : ""}
              {d.pInvest > 0
                ? ` 월평균 ${F(Math.round(d.pInvest / Math.max(d.months.length, 1)))} 투자. ${d.pInvest / Math.max(d.pIncome, 1) > 0.2 ? "적극적으로 투자하고 있어 장기적 자산 성장이 기대됩니다." : "투자 비중을 수입의 20% 이상으로 높이면 복리 효과가 커집니다."}`
                : " 투자 활동이 없습니다. 소액이라도 ETF 적립식 투자를 시작해 보세요."}
            </Insight>
            <Insight title="소비 습관" color="#7c3aed" bg="rgba(139,92,246,0.08)">
              {d.zeroDays > 0 ? `${d.totalDays}일 중 ${d.zeroDays}일 무지출 달성 (${Math.round(d.zeroDays / Math.max(d.totalDays, 1) * 100)}%).` : "무지출일이 없습니다."}
              {d.weekendTot + d.weekdayTot > 0 && ` 주말 지출 ${Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100)}%, 주중 ${Math.round(d.weekdayTot / (d.weekendTot + d.weekdayTot) * 100)}%.`}
              {d.zeroDays > d.totalDays * 0.2 ? " 무지출 비율이 높아 소비 통제력이 좋습니다!" : d.zeroDays > 0 ? " 무지출일을 더 늘려보세요. 주 1~2일 무지출 챌린지를 추천합니다." : " 주 1일이라도 무지출 챌린지를 시작해 보세요."}
              {d.pExpense > 0 && ` 일 평균 지출 ${F(d.dailyAvgExp)}.`}
            </Insight>
            {d.prev && (
              <Insight title="전월 대비 변화" color="#0f3460" bg="#f0f8ff">
                수입 {d.pIncome >= d.prev.income ? "+" : ""}{F(d.pIncome - d.prev.income)} ({d.prev.income > 0 ? Pct((d.pIncome - d.prev.income) / d.prev.income * 100) : "N/A"}),
                지출 {d.pExpense >= d.prev.expense ? "+" : ""}{F(d.pExpense - d.prev.expense)} ({d.prev.expense > 0 ? Pct((d.pExpense - d.prev.expense) / d.prev.expense * 100) : "N/A"}).
                {d.pExpense > d.prev.expense ? ` 지출이 ${F(d.pExpense - d.prev.expense)} 증가했습니다. 어떤 카테고리에서 증가했는지 지출 분석 탭에서 확인하세요.` : ` 지출이 ${F(d.prev.expense - d.pExpense)} 감소했습니다. 좋은 흐름입니다!`}
              </Insight>
            )}
            <Insight title="수입 다각화" color="#e94560" bg="#fff5f5">
              {d.incByCat.length}개 수입원 보유.
              {d.incByCat.length >= 5 ? " 수입 다각화가 잘 되어 있습니다. 하나의 수입원이 줄어도 타격이 적습니다." : d.incByCat.length >= 3 ? " 수입원이 적당히 분산되어 있습니다." : " 수입원이 1~2개로 집중되어 있어 리스크가 있습니다. 부업이나 투자 수입을 늘려보세요."}
              {d.incByCat[0] && d.pIncome > 0 && ` 최대 수입원: ${d.incByCat[0][0]}(${Math.round(SD(d.incByCat[0][1], d.pIncome) * 100)}%).`}
            </Insight>
            <Insight title="순수익 분석" color="#059669" bg="#ecfdf5">
              순수익(실질수입-실질지출) {d.netProfit >= 0 ? "+" : ""}{F(d.netProfit)}.
              {d.netProfit > 0
                ? ` 매월 평균 ${F(Math.round(SD(d.netProfit, Math.max(d.months.length, 1))))} 흑자 구조입니다. 연간 환산 시 약 ${F(Math.round(d.netProfit * SD(12, Math.max(d.months.length, 1))))} 순자산 증가가 예상됩니다.`
                : ` 적자 상태입니다. 매월 ${F(Math.abs(Math.round(SD(d.netProfit, Math.max(d.months.length, 1)))))}씩 자산이 감소하고 있습니다. 고정비 점검이 시급합니다.`}
              {d.pInvest > 0 && d.netProfit > 0 ? ` 투자(${F(d.pInvest)})를 포함하면 실질 자산배분 여력이 충분합니다.` : ""}
            </Insight>
            <Insight title="고정비 vs 변동비" color="#7c3aed" bg="rgba(124,58,237,0.06)">
              고정비 {F(d.fixedExpense)} ({Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%), 변동비 {F(d.variableExpense)} ({Math.round(SD(d.variableExpense, d.pExpense) * 100)}%).
              {SD(d.fixedExpense, d.pExpense) > 0.5 ? " 고정비 비중이 50%를 초과합니다. 통신비, 구독, 보험 등 재협상 가능한 항목을 점검하세요." : SD(d.fixedExpense, d.pExpense) > 0.3 ? " 고정비와 변동비가 균형 잡혀 있습니다." : " 변동비 비중이 높아 지출 통제 여지가 큽니다. 예산 관리로 효과적인 절약이 가능합니다."}
              {d.subTotal > 0 ? ` 구독 비용만 ${F(d.subTotal)}로 수입 대비 ${(SD(d.subTotal, d.pIncome) * 100).toFixed(1)}%.` : ""}
            </Insight>
          </div>
        </Card>
      </Section>
    </div>
  );
});
