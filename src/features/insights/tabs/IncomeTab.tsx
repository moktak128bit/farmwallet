import React from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, Insight, CT, pieLabel, type D } from "../insightsShared";

export const IncomeTab = React.memo(function IncomeTab({ d }: { d: D }) {
  const incData = d.incByCat.map(([name, value]) => ({ name, value }));
  const totalIncome = incData.reduce((s, x) => s + x.value, 0);
  const salary = d.incByCat.find(([c]) => c === "급여")?.[1] ?? 0;
  const salaryPct = totalIncome > 0 ? salary / totalIncome * 100 : 0;
  const passive = d.incByCat.filter(([c]) => ["배당", "이자", "캐시백", "분배금"].includes(c)).reduce((s, [, v]) => s + v, 0);
  const monthlyInc = d.months.filter(m => d.monthly[m].income > 0).map(m => ({ name: d.ml[m], 수입: d.monthly[m].income }));
  const incStability = (() => {
    const vals = d.months.filter(m => d.monthly[m].income > 0).map(m => d.monthly[m].income);
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    return mean > 0 ? Math.round((1 - std / mean) * 100) : 0;
  })();

  return (
    <div className="grid-2">
      <Card accent><Kpi label="급여 의존도" value={salaryPct.toFixed(1) + "%"} sub="급여가 전체 수입에서 차지하는 비율" color="#f0c040" /></Card>
      <Card accent><Kpi label="비급여 수입" value={F(totalIncome - salary)} sub={`패시브: ${F(passive)} | 기타: ${F(totalIncome - salary - passive)}`} color="#48c9b0" /></Card>

      <Card title="수입 구조 (그룹별)">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart><Pie data={d.incByGroup} dataKey="value" cx="50%" cy="50%" outerRadius={105} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {d.incByGroup.map((_, i) => <Cell key={i} fill={["#f0c040", "#48c9b0", "#3498db"][i] ?? C[i]} />)}
          </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="그룹별 상세">
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {d.incByGroup.map((g, gi) => (
            <div key={g.name}>
              <div style={{ padding: "8px 0 4px", fontWeight: 700, fontSize: 13, color: ["#f0c040", "#48c9b0", "#3498db"][gi] ?? "#333", borderBottom: "2px solid", borderColor: ["#f0c040", "#48c9b0", "#3498db"][gi] ?? "#eee" }}>
                {g.name} — {F(g.value)} ({totalIncome > 0 ? Math.round(g.value / totalIncome * 100) : 0}%)
              </div>
              {g.items.map(([name, value]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 16px", fontSize: 12, color: "#555" }}>
                  <span>{name}</span>
                  <span style={{ fontWeight: 600 }}>{F(value)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card title="수입원 구성 (개별)">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart><Pie data={incData.slice(0, 7)} dataKey="value" cx="50%" cy="50%" outerRadius={105} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {incData.slice(0, 7).map((_, i) => <Cell key={i} fill={C[i]} />)}
          </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="수입원 상세">
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {incData.map(({ name, value }, i) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />{name}
              </span>
              <span style={{ fontWeight: 700 }}>{F(value)} <span style={{ fontSize: 10, color: "#999" }}>({totalIncome > 0 ? Math.round(value / totalIncome * 100) : 0}%)</span></span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="월별 수입 추이" span={2}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyInc}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="수입" fill="#f0c040" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="급여 vs 비급여 추이" span={2}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={d.salaryTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="salary" stackId="a" fill="#f0c040" name="급여계" radius={[0, 0, 0, 0]} />
            <Bar dataKey="nonSalary" stackId="a" fill="#48c9b0" name="비급여" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="누적 수입 vs 누적 지출" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={d.cumIE}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Line type="monotone" dataKey="누적수입" stroke="#f0c040" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="누적지출" stroke="#e94560" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="수입 종합 인사이트" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Insight title="수입 안정성" color="#2563eb" bg="#cce5ff">
            {incStability !== null ? `안정성 지수 ${incStability}%. ${incStability >= 70 ? "매우 안정적인 수입 흐름입니다. 일정한 수입이 지출 계획과 투자 전략을 세우기 좋습니다." : incStability >= 40 ? "수입에 변동이 있지만 관리 가능한 수준입니다. 변동 원인을 파악하면 더 안정적으로 만들 수 있습니다." : "수입 변동이 큽니다. 비상자금 확보가 중요하며, 안정적 수입원을 늘려보세요."}` : "데이터 부족"}
          </Insight>
          <Insight title="패시브 수입 현황" color="#059669" bg="#d4edda">
            {passive > 0 ? `배당+이자+캐시백 합산 ${F(passive)} (전체 수입의 ${Math.round(passive / Math.max(totalIncome, 1) * 100)}%). 월평균 ${F(Math.round(passive / Math.max(d.months.length, 1)))}의 패시브 수입이 발생합니다. ${passive / Math.max(totalIncome, 1) > 0.1 ? "패시브 수입 비중이 좋습니다!" : "패시브 수입을 더 늘려보세요. 배당 ETF나 적금 이자가 도움됩니다."}` : "패시브 수입이 없습니다. 배당주, 예금 이자, 캐시백 등 작은 것부터 시작해 보세요. 월 1만원이라도 패시브 수입의 시작입니다."}
          </Insight>
          <Insight title="수입 다각화 점검" color="#b45309" bg="#fff3cd">
            {d.incByCat.length}개 수입원 보유. {salaryPct > 80 ? `급여 의존도 ${salaryPct.toFixed(0)}%로 매우 높습니다. 급여 외 수입이 ${F(totalIncome - salary)}에 불과합니다. 부업, 투자 수입, 프리랜서 활동 등으로 다각화하면 경제적 안정성이 높아집니다.` : salaryPct > 50 ? `급여 비중 ${salaryPct.toFixed(0)}%로 적정 수준입니다. 비급여 수입(${F(totalIncome - salary)})이 있어 좋은 구조입니다.` : `급여 의존도 ${salaryPct.toFixed(0)}%로 매우 낮습니다. 훌륭한 수입 다각화! 여러 수입원에서 골고루 수입이 발생하고 있습니다.`}
          </Insight>
          <Insight title="실질 수입 분석 (진짜 내 힘으로 번 돈)" color="#7c3aed" bg="rgba(139,92,246,0.08)">
            실질 수입 {F(d.realIncome)} = 장부 수입 {F(d.pIncome)}{d.settlementTotal > 0 ? ` − 정산 ${F(d.settlementTotal)}` : ""}{d.tempIncomeTotal > 0 ? ` − 일시소득 ${F(d.tempIncomeTotal)}` : ""}.
            {" "}급여·수당 등 규칙적인 근로소득이 재산을 형성하는 진짜 소득입니다.
            {d.passiveIncome > 0 && ` 패시브 수입(배당·이자) ${F(d.passiveIncome)}은 투자가 벌어다 주는 돈입니다.`}
            {" "}실질 저축률 {d.realSavRate.toFixed(1)}% (실질수입 − 실질지출 기준).
          </Insight>
        </div>
      </Card>

      {d.incSubInsights.length > 0 && (
        <Card title="수입원별 세부 인사이트" span={2}>
          <div className="grid-2" style={{ gap: 10 }}>
            {d.incSubInsights.map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#f0fdf4" : s.monthTrend === "down" ? "#fff5f5" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#86efac" : s.monthTrend === "down" ? "#fcc" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중: {s.share}%</span>
                  <span>{s.count}건 · 건당 {F(s.avg)}</span>
                  <span>월평균: {F(s.monthAvg)}</span>
                  <span>안정성: {s.stability}%</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#059669" : s.monthTrend === "down" ? "#e94560" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                  {s.maxMonth ? ` · 최대: ${s.maxMonth}(${F(s.maxMonthAmt)})` : ""}
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
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
