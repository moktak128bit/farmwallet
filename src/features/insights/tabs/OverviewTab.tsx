import React from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Pct, SD, Card, Kpi, Insight, CT, pieLabel, type D } from "../insightsShared";

export const OverviewTab = React.memo(function OverviewTab({ d }: { d: D }) {
  const barData = d.months.map(m => ({ name: d.ml[m], 수입: d.monthly[m].income, 지출: d.monthly[m].expense, 투자: d.monthly[m].investment }));
  const flowData = d.months.slice(0, -1).map(m => ({ name: d.ml[m], 순현금흐름: d.monthly[m].income - d.monthly[m].expense - d.monthly[m].investment }));
  const expBadge = d.prev ? Pct(SD(d.pExpense - d.prev.expense, d.prev.expense) * 100) + " vs 전월" : undefined;
  const top3Sub = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제").slice(0, 3);
  const top3pct = d.pExpense > 0 ? Math.round(top3Sub.reduce((s, x) => s + x.amount, 0) / d.pExpense * 100) : 0;
  const pieData = [{ name: "수입", value: d.pIncome }, { name: "지출", value: d.pExpense }, { name: "투자", value: d.pInvest }].filter(x => x.value > 0);
  const pieCols = ["#f0c040", "#e94560", "#48c9b0"];

  return (
    <div className="grid-4">
      {/* 실질 기준 KPI (정산/일시소득 제외) */}
      <Card accent><Kpi label="실질 수입" value={F(d.realIncome)} sub={d.settlementTotal > 0 ? `정산 ${F(d.settlementTotal)} 제외` : "근로+투자 소득"} color="#f0c040" /></Card>
      <Card accent><Kpi label="실질 지출" value={F(d.realExpense)} sub={d.settlementTotal > 0 ? `정산분 차감 반영` : ""} badge={expBadge} color="#e94560" /></Card>
      <Card accent><Kpi label="실질 순수익" value={F(d.netProfit)} sub="실질수입 − 실질지출" color={d.netProfit >= 0 ? "#48c9b0" : "#e94560"} /></Card>
      <Card accent><Kpi label="실질 저축률" value={d.realSavRate.toFixed(1) + "%"} sub={`월평균 지출 ${F(Math.round(d.avgMonthExp))}`} color="#fff" /></Card>

      {/* 장부 vs 실질 비교 */}
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
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>정산 (비용분담 회수)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#d97706" }}>{F(d.settlementTotal)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>수입·지출 양쪽에서 차감</div>
            </div>
          )}
          <div style={{ padding: "12px 14px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde" }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>패시브 수입</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb" }}>{F(d.passiveIncome)}</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>배당·이자 등 투자수익</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "#999", lineHeight: 1.6, padding: "8px 12px", background: "#f8f9fa", borderRadius: 8 }}>
          실질 수입 = 장부 수입 − 정산 − 일시소득(용돈·지원 등). 실질 지출 = 장부 지출 − 정산분. 저축률은 실질 기준으로 계산해야 진짜 재산 형성 능력을 알 수 있습니다.
        </div>
      </Card>

      <Card title="핵심 재무 지표" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          {[
            { label: "순수익", value: F(d.netProfit), sub: "실질수입 - 실질지출", color: d.netProfit >= 0 ? "#059669" : "#e94560", bg: d.netProfit >= 0 ? "#f0fdf4" : "#fff5f5", border: d.netProfit >= 0 ? "#86efac" : "#fcc" },
            { label: "실질 저축률", value: d.realSavRate.toFixed(1) + "%", sub: "정산·보유자산 제외 기준", color: d.realSavRate >= 30 ? "#059669" : d.realSavRate >= 0 ? "#f0c040" : "#e94560", bg: "#f0f8ff", border: "#bde" },
            { label: "지출/수입 비율", value: d.expToIncRatio.toFixed(1) + "%", sub: d.expToIncRatio > 80 ? "지출 비중 높음!" : "양호", color: d.expToIncRatio > 80 ? "#e94560" : "#2563eb", bg: "#f8f9fa", border: "#eee" },
            { label: "패시브 수입", value: F(d.passiveIncome), sub: `수입 대비 ${d.pIncome > 0 ? Math.round(SD(d.passiveIncome, d.pIncome) * 100) : 0}%`, color: "#48c9b0", bg: "#f0fdf4", border: "#86efac" },
            { label: "일 평균 지출", value: F(d.dailyAvgExp), sub: `${d.totalDays}일 기준`, color: "#533483", bg: "rgba(83,52,131,0.06)", border: "rgba(83,52,131,0.2)" },
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
            { label: "순현금흐름", value: F(d.netCashFlow), sub: "수입-지출-투자", color: d.netCashFlow >= 0 ? "#059669" : "#e94560" },
            { label: "투자 수익률", value: d.investReturnRate !== 0 ? d.investReturnRate.toFixed(1) + "%" : "-", sub: "실현손익/투자원금", color: d.investReturnRate >= 0 ? "#059669" : "#e94560" },
            { label: "고정비", value: F(d.fixedExpense), sub: `전체 지출의 ${Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%`, color: "#0f3460" },
            { label: "변동비", value: F(d.variableExpense), sub: `전체 지출의 ${Math.round(SD(d.variableExpense, d.pExpense) * 100)}%`, color: "#f39c12" },
            { label: "수입 안정성", value: d.incomeStability !== null ? d.incomeStability + "%" : "-", sub: d.incomeStability !== null && d.incomeStability >= 70 ? "안정적" : "변동 있음", color: "#2563eb" },
          ].map(m => (
            <div key={m.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8, border: "1px solid #eee", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#999", fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="월별 수입 · 지출 · 투자 추이" span={4}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={barData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="수입" fill="#f0c040" radius={[4, 4, 0, 0]} /><Bar dataKey="지출" fill="#e94560" radius={[4, 4, 0, 0]} /><Bar dataKey="투자" fill="#48c9b0" radius={[4, 4, 0, 0]} />
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

      <Card title="재무 건강 점수" span={1}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0" }}>
          <div style={{ position: "relative", width: 120, height: 120, borderRadius: "50%", background: `conic-gradient(${d.score.total >= 70 ? "#48c9b0" : d.score.total >= 40 ? "#f0c040" : "#e94560"} ${d.score.total * 3.6}deg, #f0f0f0 ${d.score.total * 3.6}deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{d.score.total}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e94560" }}>{d.score.grade}</span>
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, textAlign: "center" }}>{d.score.comment}</span>
        </div>
      </Card>

      <Card title="수입 · 지출 · 투자 비중" span={1}>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {pieData.map((_, i) => <Cell key={i} fill={pieCols[i]} />)}
          </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="상위 지출 (중분류)" span={1}>
        <div style={{ fontSize: 13 }}>
          {top3Sub.map((s, i) => (
            <div key={s.sub} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
              <span><span style={{ color: C[i], fontWeight: 800, marginRight: 6 }}>{i + 1}</span>{s.sub} <span style={{ fontSize: 10, color: "#bbb" }}>{s.cat}</span></span>
              <span style={{ fontWeight: 700 }}>{F(s.amount)}</span>
            </div>
          ))}
          {d.pExpense > 0 && <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>상위 3개가 전체의 {top3pct}%</div>}
        </div>
      </Card>

      <Card title="월별 거래 건수" span={1}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={d.txCntTrend}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
            <Bar dataKey="count" fill="#533483" radius={[4, 4, 0, 0]} name="건수" />
          </BarChart>
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
            고정비(보험/통신/월세/구독/교육/대출) {F(d.fixedExpense)} ({Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%), 변동비 {F(d.variableExpense)} ({Math.round(SD(d.variableExpense, d.pExpense) * 100)}%).
            {SD(d.fixedExpense, d.pExpense) > 0.5 ? " 고정비 비중이 50%를 초과합니다. 통신비, 구독, 보험 등 재협상 가능한 항목을 점검하세요." : SD(d.fixedExpense, d.pExpense) > 0.3 ? " 고정비와 변동비가 균형 잡혀 있습니다." : " 변동비 비중이 높아 지출 통제 여지가 큽니다. 예산 관리로 효과적인 절약이 가능합니다."}
            {d.subTotal > 0 ? ` 구독 비용만 ${F(d.subTotal)}로 수입 대비 ${(SD(d.subTotal, d.pIncome) * 100).toFixed(1)}%.` : ""}
          </Insight>
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
    </div>
  );
});
