import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Pct, SD, Card, Insight, CT, Section, type D } from "../insightsShared";
import { useAppStore } from "../../../store/appStore";
import { getThisMonthKST, shiftMonth } from "../../../utils/date";
import { dayCapLabel } from "../../../utils/ledgerFreshness";
import { isBeforePayday } from "../../dashboard/summaryMath";
import type { BalanceSheet } from "../../../calculations";

export const OverviewTab = React.memo(function OverviewTab({ d, bs }: { d: D; bs: BalanceSheet }) {
  // 잉여·재테크 차트 — 진행 중인 현재 월만 제외 (마지막 월이 완결 월이면 포함)
  const flowMonths = d.months.length > 0 && d.months[d.months.length - 1] === getThisMonthKST()
    ? d.months.slice(0, -1)
    : d.months;
  // 근로소득 잉여(근로소득 − 지출)와 재테크를 나란히 — 예전 "근로소득−지출−투자" 한 줄은 대출·용돈으로 한 투자까지
  // 월급에서 뺀 것처럼 그려 18개월 누적 −8,514만 같은 숫자를 만들었다.
  const flowData = flowMonths.map(m => ({ name: d.ml[m], 근로소득잉여: (d.salaryMonthly[m] ?? 0) - d.monthly[m].expense, 재테크: d.monthly[m].investment }));
  const top3Sub = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제").slice(0, 3);
  const top3pct = d.pExpense > 0 ? Math.round(top3Sub.reduce((s, x) => s + x.amount, 0) / d.pExpense * 100) : 0;
  // 진행 중인 달 동기 비교 라벨 — "1~5일 · 5일까지 기록"
  const capText = (n: number) => dayCapLabel(n);

  /* 재정 활주로 (Financial Runway): 순유동자산(유동 자산 − 카드 대금 − 마이너스 통장) / 월평균 지출.
     예전엔 유동 자산(총자산 − 연금)만 보고 단기 부채를 무시해 부채 4천만이 있어도 34.6개월 "매우 여유"였다.
     대출 잔금은 만기까지 나눠 갚는 장기 부채라 차감하지 않고, 매달 갚는 원금·이자는 장부 지출(대출상환)로 월평균에 들어간다. */
  const liquidAssets = bs.liquidAssets;
  const shortTermDebt = bs.cardDebt + bs.overdraft;
  const netLiquid = liquidAssets - shortTermDebt;
  const runwayMonths = d.avgMonthExp > 0 ? Math.max(0, netLiquid) / d.avgMonthExp : null;
  const runwayColor = runwayMonths == null ? "var(--text-faint)" : runwayMonths >= 12 ? "var(--success)" : runwayMonths >= 6 ? "var(--warning)" : "var(--danger)";
  const runwayLabel = runwayMonths == null
    ? "-"
    : runwayMonths >= 24 ? "매우 여유" : runwayMonths >= 12 ? "안정권" : runwayMonths >= 6 ? "주의" : "위험";

  /* 저축률 목표 vs 실제 */
  const goals = useAppStore((s) => s.data.investmentGoals);
  const monthsCount = d.monthSpan;
  const monthlyRealIncome = d.realIncome / monthsCount;
  const monthlyDepositTarget = goals?.annualDepositTarget ? goals.annualDepositTarget / 12 : null;
  const targetSavRate = monthlyDepositTarget && monthlyRealIncome > 0
    ? (monthlyDepositTarget / monthlyRealIncome) * 100
    : 30;
  const targetSavRateSrc = monthlyDepositTarget ? "목표 설정값" : "기본 벤치마크 30%";
  const actualSavRate = d.realSavRate; // null = 실질 수입 없음(N/A)
  const savRateOk = actualSavRate != null && actualSavRate >= targetSavRate;

  /* 수입 성장률 요약 — 급여 전(월급일 이전)엔 −100%를 그리지 않는다 (대시보드와 같은 판정) */
  const ig = d.incomeGrowth;
  const thisMonth = getThisMonthKST();
  const beforePayday = isBeforePayday(
    d.salaryMonthly[thisMonth] ?? 0,
    d.salaryMonthly[shiftMonth(thisMonth, -1)] ?? 0,
    Object.values(d.salaryMonthly).some((v) => v > 0)
  );
  // 급여 전이면 진행 중인 달의 저축률 막대(급여 0 → −1,900%대)가 차트 축을 망가뜨린다 → 그 달만 제외.
  // YYYY-MM 키로 거른다 — "N월" 라벨로 거르면 작년·재작년 같은 달 막대까지 사라진다.
  const savRateData = beforePayday ? d.savRateTrend.filter((e) => e.m !== thisMonth) : d.savRateTrend;
  // 성장률 카드는 선택 월(없으면 마지막 월)이 대상 — 이번 달을 볼 때만(partialDay 존재) "급여 전"으로 가린다.
  // 지난달을 고른 경우엔 완결된 비교값이 있으므로 그대로 보여준다.
  const igBeforePayday = beforePayday && ig.partialDay != null;
  const igMomColor = igBeforePayday || ig.mom == null ? "var(--text-faint)" : ig.mom >= 0 ? "var(--success)" : "var(--danger)";
  const igYoyColor = igBeforePayday || ig.yoy == null ? "var(--text-faint)" : ig.yoy >= 0 ? "var(--success)" : "var(--danger)";
  const igAvgColor = ig.avg3MoM == null ? "var(--text-faint)" : ig.avg3MoM >= 0 ? "var(--success)" : "var(--danger)";

  /* 지출 관성 */
  const si = d.spendingInertia;
  const siColor = si?.deviation == null ? "var(--text-faint)" : si.deviation > 20 ? "var(--danger)" : si.deviation > 5 ? "var(--warning)" : si.deviation < -10 ? "var(--success)" : "var(--accent)";
  const siLabel = si?.deviation == null ? "데이터 부족" : si.deviation > 20 ? "지출 증가" : si.deviation > 5 ? "상승세" : si.deviation < -10 ? "지출 감소" : "평상시";

  /* 실질 지출 대조 — 실질 지출(realFlows)은 투자손실을 포함하고 장부 지출은 재테크로 뺀다. 남는 차이는 분류 차이로 그대로 노출 */
  const reconResidual = d.realExpense - (d.pExpense + d.investLossInPeriod - d.datePartnerShare);

  /* 재무 기초 체크 — 등급·칭찬 대신 사실. 실질 기준(대출·용돈·정산은 수입 아님), 부채 반영 */
  // 실질 수입원 — 대출·용돈·정산(비실질)은 수입원이 아니다 (incSubInsights.isReal = 근로·패시브·기타, slice 단일 분류)
  const realSources = d.incSubInsights.filter(s => s.isReal);
  const debtRatio = bs.totalAssets > 0 ? bs.totalLiabilities / bs.totalAssets * 100 : null;
  const checks: { label: string; ok: boolean | null; fact: string }[] = [
    { label: "실질 저축률 20% 이상", ok: d.realSavRate == null ? null : d.realSavRate >= 20,
      fact: d.realSavRate == null ? "실질 수입 없음" : `${d.realSavRate.toFixed(1)}% (${d.accumLabel})` },
    { label: "순유동자산으로 지출 6개월 이상", ok: runwayMonths == null ? null : runwayMonths >= 6,
      fact: runwayMonths == null ? "월평균 지출 없음" : `${runwayMonths.toFixed(1)}개월 (${F(Math.max(0, netLiquid))}원 ÷ 월 ${F(Math.round(d.avgMonthExp))}원)` },
    { label: "부채가 자산의 50% 미만", ok: debtRatio == null ? null : debtRatio < 50,
      fact: debtRatio == null ? "자산 없음" : `총부채 ${F(bs.totalLiabilities)}원 / 총자산 ${F(bs.totalAssets)}원 = ${debtRatio.toFixed(0)}%` },
    { label: "단기 부채(카드·마이너스 통장)가 월 지출 이하", ok: d.avgMonthExp > 0 ? shortTermDebt <= d.avgMonthExp : null,
      fact: `카드 ${F(bs.cardDebt)}원 + 마이너스 통장 ${F(bs.overdraft)}원` },
    { label: "근로소득으로 지출을 감당", ok: d.pSalary > 0 ? d.salarySurplus >= 0 : null,
      fact: d.pSalary > 0 ? `근로소득 ${F(d.pSalary)}원 − 지출 ${F(d.pExpense)}원 = ${d.salarySurplus >= 0 ? "+" : "−"}${F(Math.abs(d.salarySurplus))}원` : "근로소득 기록 없음" },
  ];

  return (
    <div>
      {/* ============ SECTION 1: 이번달 핵심 ============ */}
      <Section storageKey="overview-section-hero" title="이번달 핵심">
        {/* 이상치 주목 배너 */}
        {d.topAnomaly && d.anomalyTargetMonth && (
          <div style={{
            gridColumn: "span 4",
            padding: "14px 18px",
            borderRadius: 12,
            background: d.topAnomaly.severity === "extreme"
              ? "var(--danger)"
              : "var(--warning)",
            color: "var(--text-on-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <AlertTriangle size={22} style={{ flexShrink: 0 }} aria-hidden />
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

        {/* 기간 합계는 한 줄 맥락으로 — 대시보드와 같은 KPI 카드 4장이 여기서 다시 서지 않게 (인사이트는 분석만) */}
        <div className="hint" style={{ gridColumn: "span 4", marginTop: 0, fontSize: 13 }}>
          {d.accumLabel} 실질 수입 <strong style={{ color: "var(--chart-income)" }}>{F(d.realIncome)}원</strong>
          {d.settlementTotal > 0 && ` (정산 ${F(d.settlementTotal)} 제외)`} · 실질 지출 <strong style={{ color: "var(--chart-expense)" }}>{F(d.realExpense)}원</strong>
          {d.datePartnerShare > 0 && ` (데이트 50% ${F(Math.round(d.datePartnerShare))} 제외)`} · 순수익 <strong style={{ color: d.netProfit >= 0 ? "var(--success)" : "var(--danger)" }}>{F(d.netProfit)}원</strong>
          {" · 실질 저축률 "}<strong>{d.realSavRate == null ? "N/A" : `${d.realSavRate.toFixed(1)}%`}</strong>
          {d.recorded.lastDate && d.recorded.daysSince != null && d.recorded.daysSince > 0 && (
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
              마지막 기록 {d.recorded.lastDate} ({d.recorded.daysSince}일 전) — 이번 달 비교·스트릭은 이 날짜까지만 셉니다. 그 뒤는 '무지출'이 아니라 아직 입력 전입니다.
            </div>
          )}
        </div>

        <Card title="재정 활주로 — 수입이 끊기면 버틸 수 있는 기간" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 48, fontWeight: 800, color: runwayColor, lineHeight: 1 }}>
                {runwayMonths == null ? "–" : runwayMonths.toFixed(1)}
                <span style={{ fontSize: 20, marginLeft: 6, fontWeight: 600 }}>개월</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: runwayColor, marginTop: 6 }}>{runwayLabel}</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>
              {[
                { k: "유동 자산 (총자산 − 연금)", v: F(liquidAssets) + "원" },
                { k: "− 카드 대금", v: F(bs.cardDebt) + "원" },
                { k: "− 마이너스 통장", v: F(bs.overdraft) + "원" },
                { k: "= 순유동자산", v: F(netLiquid) + "원", strong: true },
                { k: "÷ 월평균 지출 (완결 월 · 장부의 대출 상환 포함)", v: F(Math.round(d.avgMonthExp)) + "원" },
              ].map(r => (
                <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ color: "var(--text-faint)" }}>{r.k}</span>
                  <span style={{ fontWeight: r.strong ? 800 : 700 }}>{r.v}</span>
                </div>
              ))}
              <div style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: 6, marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                대출 잔금 {F(bs.loanDebt)}원은 만기까지 나눠 갚는 장기 부채라 빼지 않았습니다. 유동 자산엔 주식·코인 평가액이 들어 있어 급히 팔면 시세만큼 달라집니다.
              </div>
            </div>
          </div>
        </Card>

        <Card title={`저축률 목표 vs 실제 (${targetSavRateSrc})`} span={4}>
          {actualSavRate == null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
              실질 수입이 없어 저축률을 계산할 수 없습니다 (N/A).
            </div>
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--text-faint)", fontWeight: 600 }}>현재 저축률</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: savRateOk ? "var(--success)" : actualSavRate >= 0 ? "var(--warning)" : "var(--danger)" }}>
                {actualSavRate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>목표 {targetSavRate.toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ position: "relative", height: 36, background: "var(--surface-hover)", borderRadius: 18, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: `${Math.min(100, (targetSavRate / Math.max(targetSavRate, actualSavRate, 50)) * 100)}%`,
                  width: 2, background: "var(--text)", zIndex: 2,
                }} />
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (Math.max(0, actualSavRate) / Math.max(targetSavRate, actualSavRate, 50)) * 100)}%`,
                  background: savRateOk
                    ? "var(--success)"
                    : actualSavRate >= 0
                      ? "var(--warning)"
                      : "var(--danger)",
                  transition: "width 0.4s",
                }} />
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0 12px", fontSize: 11, fontWeight: 700, color: "var(--text-on-color)", textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                }}>
                  <span>0%</span>
                  <span style={{ color: "var(--text-secondary)", textShadow: "none" }}>목표 {targetSavRate.toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {savRateOk
                  ? `목표 ${targetSavRate.toFixed(0)}%를 달성 중입니다. 월 실질수입 ${F(Math.round(monthlyRealIncome))} 중 ${F(Math.round(monthlyRealIncome * actualSavRate / 100))} 저축.`
                  : actualSavRate >= 0
                    ? `목표까지 ${(targetSavRate - actualSavRate).toFixed(1)}%p — 월 실질수입 ${F(Math.round(monthlyRealIncome))}원 기준 월 ${F(Math.round(monthlyRealIncome * (targetSavRate - actualSavRate) / 100))}원 차이.`
                    : `실질 지출이 실질 수입보다 ${F(Math.abs(d.netProfit))}원 많습니다.`}
                {!monthlyDepositTarget && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)" }}>
                    <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />대시보드 {">"} 투자 요약에서 연 입금액 목표를 설정하면 개인화된 목표 저축률이 적용됩니다.
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </Card>
      </Section>

      {/* ============ SECTION 2: 장기 트렌드 ============ */}
      <Section storageKey="overview-section-trends" title="장기 트렌드">
        {/* 수입 성장률 (NEW) — 근로소득 기준 */}
        <Card title="근로소득 성장률 (MoM · YoY · 3M 평균)" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
            <div style={{ padding: "12px 14px", background: "var(--bg)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                {ig.partialDay != null ? `전월 동기 대비 (${capText(ig.partialDay)})` : "전월 대비 (MoM)"}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igMomColor, marginTop: 4 }}>
                {igBeforePayday ? "급여 전" : ig.mom == null ? "–" : Pct(ig.mom)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
                {igBeforePayday ? "이번 달 급여 입금 전 · 비교 생략" : ig.prevInc > 0 ? `${F(ig.prevInc)} → ${F(ig.targetInc)}` : ig.partialDay != null ? `전월 1~${ig.partialDay}일 수입 없음` : "비교 데이터 없음"}
              </div>
            </div>
            <div style={{ padding: "12px 14px", background: "var(--bg)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>전년 동월 대비 (YoY)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igYoyColor, marginTop: 4 }}>
                {igBeforePayday ? "급여 전" : ig.yoy == null ? "–" : Pct(ig.yoy)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
                {igBeforePayday ? "급여 입금 후 비교" : ig.yoy == null ? "1년 전 데이터 없음" : ig.partialDay != null ? `작년 동월 1~${ig.partialDay}일 비교` : "작년 동월 비교"}
              </div>
            </div>
            <div style={{ padding: "12px 14px", background: "var(--bg)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>최근 3개월 평균 성장률</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: igAvgColor, marginTop: 4 }}>
                {ig.avg3MoM == null ? "–" : Pct(ig.avg3MoM)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>월평균 MoM</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={ig.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={F} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + "%"} tick={{ fontSize: 11 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} yAxisId="left" dataKey="income" name="근로소득" fill="var(--chart-income)" radius={[4, 4, 0, 0]} opacity={0.5} />
              <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="momPct" name="MoM%" stroke="var(--chart-warning)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            수입 = 근로소득(월급·수당·상여)만. 정산·용돈·배당 등 비근로 유입 제외.
          </div>
        </Card>

        <Card title="근로소득 잉여 vs 재테크 (월별)" span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={flowData}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} dataKey="근로소득잉여" name="근로소득 − 지출" radius={[4, 4, 0, 0]} opacity={0.6}>
                {flowData.map((e, i) => <Cell key={i} fill={e.근로소득잉여 >= 0 ? "var(--chart-income)" : "var(--chart-expense)"} />)}
              </Bar>
              <Line isAnimationActive={false} type="monotone" dataKey="재테크" name="재테크(순)" stroke="var(--chart-series-b)" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            재테크가 막대보다 크면 그 달 투자는 월급 밖 재원(대출·용돈·기존 자산)으로 채운 것입니다.
          </div>
        </Card>

        <Card title="누적 실질 저축률 추이" span={2}>
          <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "0 0 4px", textAlign: "right" }}>월급이 월말 지급이므로 월별 저축률 대신 누적 기준 표시</p>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={savRateData}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 11 }} /><Tooltip formatter={(v: ValueType | undefined) => v == null ? "N/A" : Number(v).toFixed(1) + "%"} />
              {/* rate null(실질 수입 0) 달은 막대를 그리지 않는다 — 0% 막대는 거짓 */}
              <Bar isAnimationActive={false} dataKey="rate" name="월별" radius={[4, 4, 0, 0]} opacity={0.35}>
                {savRateData.map((e, i) => <Cell key={i} fill={e.rate == null ? "var(--text-faint)" : e.rate >= 30 ? "var(--success)" : e.rate >= 0 ? "var(--warning)" : "var(--danger)"} />)}
              </Bar>
              <Line isAnimationActive={false} dataKey="cumRate" name="누적" stroke="var(--chart-series-b)" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="누적 수입 vs 누적 지출" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.cumIE}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="누적수입" stroke="var(--chart-income)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="누적지출" stroke="var(--chart-expense)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            누적수입 = 근로소득(월급·수당·상여) 누적. 정산·용돈·배당 등 비근로 유입 제외.
          </div>
        </Card>
      </Section>

      {/* ============ SECTION 3: 심층 분석 ============ */}
      <Section storageKey="overview-section-analysis" title="심층 분석">
        <Card title="장부 vs 실질 비교 (왜 다른가?)" span={4}>
          <div className="grid-4" style={{ gap: 12, fontSize: 13 }}>
            <div style={{ padding: "12px 14px", background: "var(--success-light)", borderRadius: 10, border: "1px solid var(--success)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>장부 수입 (전체 · 퇴직연금·투자수익 제외)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>{F(d.pIncome)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>→ 실질 수입: {F(d.realIncome)}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "var(--danger-light)", borderRadius: 10, border: "1px solid var(--danger)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>장부 지출 (전체)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{F(d.pExpense)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>→ 실질 지출: {F(d.realExpense)}</div>
            </div>
            {d.settlementTotal > 0 && (
              <div style={{ padding: "12px 14px", background: "var(--warning-light)", borderRadius: 10, border: "1px solid var(--warning)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>정산 (상대가 돌려준 돈)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--warning)" }}>{F(d.settlementTotal)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>실 수입에서 차감 (내 돈 아님)</div>
              </div>
            )}
            {d.datePartnerShare > 0 && (
              <div style={{ padding: "12px 14px", background: "var(--danger-light)", borderRadius: 10, border: "1px solid var(--danger)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>데이트 계좌 상대 부담 (50%)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{F(Math.round(d.datePartnerShare))}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>데이트 지출 {F(d.dateAccountSpend)} × 0.5 · 실 지출에서 차감</div>
              </div>
            )}
            <div style={{ padding: "12px 14px", background: "var(--accent-light)", borderRadius: 10, border: "1px solid var(--border-light)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>패시브 수입</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>{F(d.passiveIncome)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>배당·이자 등 패시브 수입</div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7, padding: "8px 12px", background: "var(--bg)", borderRadius: 8 }}>
            <div><strong>실질 수입</strong> = 장부 수입 {F(d.pIncome)} − 정산 {F(d.settlementTotal)} − 일시소득(용돈·지원·이월·대출·처분소득) {F(d.tempIncomeTotal)}{d.carryOverIncome > 0 ? ` − 이월·원래 보유 ${F(d.carryOverIncome)}` : ""}{d.incomeOutsideLedger !== 0 ? ` ${d.incomeOutsideLedger > 0 ? "+" : "−"} 투자수익 ${F(Math.abs(d.incomeOutsideLedger))}` : ""} = <strong>{F(d.realIncome)}</strong></div>
            <div>
              <strong>실질 지출</strong> = 장부 지출 {F(d.pExpense)}
              {d.investLossInPeriod > 0 && <> + 투자손실 {F(d.investLossInPeriod)}</>}
              {d.datePartnerShare > 0 && <> − 데이트 상대 부담 {F(Math.round(d.datePartnerShare))}</>}
              {Math.abs(reconResidual) >= 1 && <> {reconResidual > 0 ? "+" : "−"} 분류 차이 {F(Math.abs(Math.round(reconResidual)))}</>}
              {" "}= <strong>{F(d.realExpense)}</strong>
            </div>
            {d.investLossInPeriod > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                투자손실은 장부 지출에선 재테크(순액)로 빠지지만, 실질 지출·저축률 계산(utils/savingsRate)에는 들어갑니다 — 그래서 실질 지출이 장부보다 클 수 있습니다.
              </div>
            )}
          </div>
        </Card>

        {/* 지출 관성 (NEW) */}
        <Card title="지출 관성" span={2}>
          {si == null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
              비교할 과거 데이터가 부족합니다.
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                    이번달 지출{si.partialDay != null ? ` (${capText(si.partialDay)})` : ""}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{F(Math.round(si.curExp))}</div>
                </div>
                <div style={{ fontSize: 24, color: "var(--text-faint)" }}>↔</div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                    최근 {si.lookbackMonths}개월 {si.partialDay != null ? `동기(1~${si.partialDay}일) ` : ""}평균
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-muted)" }}>{F(Math.round(si.avg))}</div>
                </div>
              </div>
              <div style={{
                padding: "12px 14px",
                background: si.deviation != null && si.deviation > 20 ? "var(--danger-light)" : si.deviation != null && si.deviation > 5 ? "var(--warning-light)" : si.deviation != null && si.deviation < -10 ? "var(--success-light)" : "var(--accent-light)",
                borderRadius: 8, marginTop: 8, textAlign: "center",
              }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: siColor }}>
                  {si.deviation == null ? "–" : Pct(si.deviation)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: siColor, marginTop: 2 }}>{siLabel}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                  {si.deviation == null ? "" :
                    `평균 대비 ${si.curExp >= si.avg ? "+" : "−"}${F(Math.abs(Math.round(si.curExp - si.avg)))}원. 어느 항목이 움직였는지는 위 "지출 변화와 확인할 항목"에 있습니다.`}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card title="재무 기초 체크 — 숫자로 확인" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            {checks.map((c) => (
              <div key={c.label} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {c.ok === true
                  ? <CheckCircle2 size={16} style={{ color: "var(--success)", flexShrink: 0, marginTop: 2 }} aria-label="충족" />
                  : c.ok === false
                    ? <AlertTriangle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} aria-label="미충족" />
                    : <Info size={16} style={{ color: "var(--text-faint)", flexShrink: 0, marginTop: 2 }} aria-label="판단 보류" />}
                <div>
                  <div style={{ fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.fact}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6 }}>
              등급·점수는 매기지 않습니다. 기준선(20%·6개월·50%)은 흔히 쓰는 경험칙이며 개인 사정에 따라 다릅니다.
            </div>
          </div>
        </Card>

        <Card title={`핵심 재무 지표 — ${d.accumLabel} 기준`} span={4}>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 10, padding: "6px 10px", background: "var(--bg)", borderRadius: 6, lineHeight: 1.5 }}>
            <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />금액 단위는 <strong>원</strong>. 표시 범위는 상단 기간 필터({d.selMonth ? `1개월 (${d.ml[d.selMonth] ?? d.selMonth})` : `${d.months.length}개월, ${d.months[0] ?? "-"} ~ ${d.months[d.months.length - 1] ?? "-"}`})에 해당.
            <strong>{d.selMonth ? "선택 월" : "누적"}</strong> 기준 표기가 기본이며, 일평균·투자수익률은 별도 기준.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[
              { label: "순수익", value: F(d.netProfit) + "원", sub: `${d.accumLabel} · 실질수입 − 실질지출`, color: d.netProfit >= 0 ? "var(--success)" : "var(--danger)", bg: d.netProfit >= 0 ? "var(--success-light)" : "var(--danger-light)", border: d.netProfit >= 0 ? "var(--success)" : "var(--danger)" },
              { label: "실질 저축률", value: d.realSavRate == null ? "N/A" : d.realSavRate.toFixed(1) + "%", sub: `${d.accumLabel} 기준`, color: d.realSavRate == null ? "var(--text-faint)" : d.realSavRate >= 30 ? "var(--success)" : d.realSavRate >= 0 ? "var(--warning)" : "var(--danger)", bg: "var(--accent-light)", border: "var(--border-light)" },
              { label: "지출/근로소득 비율", value: d.expToIncRatio.toFixed(1) + "%", sub: d.expToIncRatio > 80 ? "지출 비중 높음" : d.accumLabel, color: d.expToIncRatio > 80 ? "var(--danger)" : "var(--accent)", bg: "var(--bg)", border: "var(--border-light)" },
              { label: "패시브 수입", value: F(d.passiveIncome) + "원", sub: `${d.accumLabel} · 실질수입 대비 ${d.realIncome > 0 ? Math.round(SD(d.passiveIncome, d.realIncome) * 100) : 0}%`, color: "var(--success)", bg: "var(--success-light)", border: "var(--success)" },
              { label: "일 평균 지출", value: F(d.dailyAvgExp) + "원", sub: `하루당 · 기록된 ${d.totalDays}일 기준`, color: "var(--text)", bg: "var(--bg)", border: "var(--border-light)" },
            ].map(m => (
              <div key={m.label} style={{ padding: "12px 14px", background: m.bg, borderRadius: 10, border: `1px solid ${m.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.color }}>{m.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{m.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 10 }}>
            {[
              { label: "근로소득 잉여", value: F(d.salarySurplus) + "원", sub: `${d.accumLabel} · 근로소득−지출 · 재테크 ${F(d.pInvest)}${d.loanInflow > 0 ? ` (대출 유입 ${F(d.loanInflow)})` : ""}`, color: d.salarySurplus >= 0 ? "var(--success)" : "var(--danger)" },
              { label: "투자 수익률", value: d.investReturnRate !== 0 ? d.investReturnRate.toFixed(1) + "%" : "-", sub: "전 기간 · 실현손익 / 청산 매도원가", color: d.investReturnRate >= 0 ? "var(--success)" : "var(--danger)" },
              { label: "고정비", value: F(d.fixedExpense) + "원", sub: `${d.accumLabel} · 지출의 ${Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%`, color: "var(--accent)" },
              { label: "변동비", value: F(d.variableExpense) + "원", sub: `${d.accumLabel} · 지출의 ${Math.round(SD(d.variableExpense, d.pExpense) * 100)}%`, color: "var(--warning)" },
              { label: "재량", value: F(d.discretionaryExpense) + "원", sub: `${d.accumLabel} · 지출의 ${Math.round(SD(d.discretionaryExpense, d.pExpense) * 100)}% · 외식·여가·데이트`, color: "var(--danger)" },
              { label: "근로소득 안정성", value: d.incomeStability !== null ? d.incomeStability + "%" : "-", sub: d.incomeStability !== null && d.incomeStability >= 70 ? "월별 편차 작음" : "월별 편차 큼", color: "var(--accent)" },
            ].map(m => (
              <div key={m.label} style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-light)", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </Card>

        {d.subInsights.length > 0 && (
          <Card title="중분류별 상세 분석" span={4}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {d.subInsights.slice(0, 9).map((s, i) => (
                <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "var(--danger-light)" : s.monthTrend === "down" ? "var(--primary-light)" : "var(--bg)", border: "1px solid var(--border-light)", fontSize: 12, color: "var(--text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {s.sub}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--danger)" }}>{F(s.total)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                    <span>비중: {s.share}%</span>
                    <span>건수: {s.count}건</span>
                    <span>건당 평균: {F(s.avg)}</span>
                    <span title="지출이 있었던 완결 월만의 평균">발생월 평균: {F(s.monthAvg)} ({s.activeMonths}/{s.doneMonths}개월)</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: s.monthTrend === "up" ? "var(--danger)" : s.monthTrend === "down" ? "var(--success)" : "var(--text-faint)", fontWeight: 600 }}>
                    {s.trendLabel}
                    {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가`}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border-light)", paddingTop: 6 }}>
                    {s.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {/* ============ SECTION 4: 종합 인사이트 ============
          사실·대조만. 예전 문단은 "ETF 적립식 투자를 시작해 보세요", "무지출 챌린지", "부업으로 다각화" 같은
          누구에게나 같은 조언과, 대출·용돈까지 센 "14개 수입원" 같은 숫자를 붙였다. */}
      <Section storageKey="overview-section-insights" title="종합 인사이트" defaultOpen={false}>
        <Card title="종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Insight title="실질 저축률" tone="success">
              {d.realSavRate == null
                ? "실질 수입이 없어 저축률을 계산할 수 없습니다 (N/A)."
                : `${d.accumLabel} 실질 수입 ${F(d.realIncome)}원 − 실질 지출 ${F(d.realExpense)}원 = ${d.netProfit >= 0 ? "+" : "−"}${F(Math.abs(d.netProfit))}원 (저축률 ${d.realSavRate.toFixed(1)}%). 월평균 ${d.netProfit >= 0 ? "+" : "−"}${F(Math.abs(Math.round(SD(d.netProfit, d.monthSpan))))}원.`}
            </Insight>
            <Insight title="지출 집중도" tone="warning">
              {top3Sub.length > 0
                ? `상위 3개 중분류(${top3Sub.map(s => `${s.sub} ${F(s.amount)}원`).join(", ")})가 지출의 ${top3pct}%.`
                : "지출 기록 없음."}
            </Insight>
            <Insight title="재테크 재원" tone="info">
              {d.pInvest > 0
                ? `재테크(순) ${F(d.pInvest)}원 · 근로소득 잉여 ${d.salarySurplus >= 0 ? "+" : "−"}${F(Math.abs(d.salarySurplus))}원${d.loanInflow > 0 ? ` · 대출 유입 ${F(d.loanInflow)}원` : ""}.${d.pInvest > Math.max(0, d.salarySurplus) ? ` 잉여보다 ${F(d.pInvest - Math.max(0, d.salarySurplus))}원 더 투자 — 대출·용돈·기존 자산이 채운 몫입니다.` : ""}`
                : "기간 내 재테크 기록이 없습니다."}
            </Insight>
            <Insight title="소비 타이밍" color="var(--chart-series-c)" bg="var(--accent-light)">
              {d.totalDays > 0 ? `기록된 ${d.totalDays}일 중 ${d.zeroDays}일 무지출 (${Math.round(d.zeroDays / d.totalDays * 100)}%).` : "기록된 날이 없습니다."}
              {d.weekendTot + d.weekdayTot > 0 && ` 주말 지출 ${Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100)}%, 주중 ${Math.round(d.weekdayTot / (d.weekendTot + d.weekdayTot) * 100)}%.`}
              {d.pExpense > 0 && ` 일 평균 ${F(d.dailyAvgExp)}원.`}
            </Insight>
            {d.prev && (
              <Insight title={d.prev.partialDay != null ? `전월 동기(${capText(d.prev.partialDay)}) 대비` : "전월 대비"} tone="info">
                {`근로소득 ${d.pSalary >= d.prev.salary ? "+" : "−"}${F(Math.abs(d.pSalary - d.prev.salary))}원${d.prev.salary > 0 ? ` (${Pct((d.pSalary - d.prev.salary) / d.prev.salary * 100)})` : ""}, 지출 ${d.pExpense >= d.prev.expense ? "+" : "−"}${F(Math.abs(d.pExpense - d.prev.expense))}원${d.prev.expense > 0 ? ` (${Pct((d.pExpense - d.prev.expense) / d.prev.expense * 100)})` : ""}. 항목별 원인은 중분류 카드의 건수·건당 분해를 보세요.`}
              </Insight>
            )}
            <Insight title="수입원" tone="danger">
              {realSources.length > 0
                ? `실질 수입원 ${realSources.length}개 (대출·용돈·정산 제외). 최대: ${realSources[0].sub} ${F(realSources[0].total)}원${realSources[0].realShare != null ? ` (실질 수입의 ${realSources[0].realShare}%)` : ""}.`
                : "실질 수입 기록이 없습니다."}
            </Insight>
            <Insight title="고정비 · 변동비 · 재량" color="var(--chart-series-c)" bg="var(--accent-light)">
              {`고정비 ${F(d.fixedExpense)}원 (${Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%), 변동비 ${F(d.variableExpense)}원 (${Math.round(SD(d.variableExpense, d.pExpense) * 100)}%), 재량 ${F(d.discretionaryExpense)}원 (${Math.round(SD(d.discretionaryExpense, d.pExpense) * 100)}%).${d.subTotal > 0 && d.pSalary > 0 ? ` 구독 ${F(d.subTotal)}원 = 근로소득의 ${(SD(d.subTotal, d.pSalary) * 100).toFixed(1)}%.` : ""}`}
            </Insight>
          </div>
        </Card>
      </Section>
    </div>
  );
});
