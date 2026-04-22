import React from "react";
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { C, F, Card, Kpi, Insight, CT, type D } from "../insightsShared";

export const VelocityTab = React.memo(function VelocityTab({ d }: { d: D }) {
  const validMonths = d.months.filter(m => { const c = d.cumSpend[m]; return c && c[30] > 0; });
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const lineData = days.map(day => { const o: Record<string, number> = { day }; validMonths.forEach(m => { o[d.ml[m]] = d.cumSpend[m]?.[day - 1] ?? 0; }); return o; });
  const colors = ["#e94560", "#0f3460", "#f0c040", "#533483", "#48c9b0", "#f39c12", "#3498db", "#e74c3c", "#2ecc71"];

  const maxSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[30] ?? 0 })).sort((a, b) => b.val - a.val);
  const minSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[30] ?? 0 })).filter(x => x.val > 0).sort((a, b) => a.val - b.val);
  const midSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[14] ?? 0 })).sort((a, b) => b.val - a.val);
  const spikeMonth = maxSpend[0]; const stableMonth = minSpend[0];

  const monthlyTotalBar = validMonths.map(m => ({ name: d.ml[m], 총지출: d.cumSpend[m]?.[30] ?? 0 }));
  const avgMonthlySpend = validMonths.length > 0 ? monthlyTotalBar.reduce((s, m) => s + m.총지출, 0) / validMonths.length : 0;

  const latestMonth = d.months[d.months.length - 1];
  const latestCum = d.cumSpend[latestMonth];
  const now = new Date();
  const [ly, lm] = (latestMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-").map(Number);
  const isCurrent = now.getFullYear() === ly && now.getMonth() + 1 === lm;
  const dayOfMonth = isCurrent ? now.getDate() : new Date(ly, lm, 0).getDate();
  const daysInMonth = new Date(ly, lm, 0).getDate();
  const currentSpend = latestCum?.[dayOfMonth - 1] ?? 0;
  const projected = dayOfMonth > 0 ? currentSpend / dayOfMonth * daysInMonth : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="현재 지출" value={F(currentSpend)} sub={`${d.ml[latestMonth] || ""} ${dayOfMonth}일차`} color="#f0c040" /></Card>
      <Card accent><Kpi label="예상 월말 지출" value={F(Math.round(projected))} sub={projected > avgMonthlySpend * 1.2 ? "평균 초과 예상!" : "양호"} color={projected > avgMonthlySpend * 1.2 ? "#e94560" : "#48c9b0"} /></Card>
      <Card accent><Kpi label="월 평균 지출" value={F(Math.round(avgMonthlySpend))} sub={`${validMonths.length}개월 평균`} color="#fff" /></Card>

      <Card title="월별 누적 지출 속도 비교" span={3}>
        {validMonths.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div> : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={lineData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="day" tick={{ fontSize: 11 }} label={{ value: "일", position: "insideBottomRight", fontSize: 11 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {validMonths.map((m, i) => <Line key={m} type="monotone" dataKey={d.ml[m]} stroke={colors[i % colors.length]} strokeWidth={spikeMonth && m === spikeMonth.m ? 3 : 1.5} dot={false} strokeOpacity={spikeMonth && m === spikeMonth.m ? 1 : 0.7} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="월별 총 지출 비교" span={2}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={monthlyTotalBar}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="총지출" radius={[4, 4, 0, 0]}>
              {monthlyTotalBar.map((e, i) => <Cell key={i} fill={e.총지출 > avgMonthlySpend * 1.3 ? "#e94560" : e.총지출 < avgMonthlySpend * 0.8 ? "#48c9b0" : "#0f3460"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>빨강: 평균 130%+, 파랑: 평균, 초록: 평균 80% 미만</div>
      </Card>

      <Card title="속도 통계" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          {[
            { label: "최고 지출월", value: spikeMonth ? `${d.ml[spikeMonth.m]} (${F(spikeMonth.val)})` : "-", color: "#e94560" },
            { label: "최저 지출월", value: stableMonth ? `${d.ml[stableMonth.m]} (${F(stableMonth.val)})` : "-", color: "#48c9b0" },
            { label: "15일차 최고", value: midSpend[0] ? `${d.ml[midSpend[0].m]} (${F(midSpend[0].val)})` : "-", color: "#f0c040" },
            { label: "일 평균 지출", value: F(d.dailyAvgExp), color: "#533483" },
            { label: "예상 vs 평균", value: avgMonthlySpend > 0 ? Math.round(projected / avgMonthlySpend * 100) + "%" : "-", color: "#0f3460" },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#f8f9fa", borderRadius: 8 }}>
              <span style={{ color: "#666" }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="지출 속도 종합 인사이트" span={3}>
        <div className="grid-2" style={{ gap: 12 }}>
          {spikeMonth && <Insight title="최고 지출 월 분석" color="#e94560" bg="#f8d7da">
            {d.ml[spikeMonth.m]} — 총 {F(spikeMonth.val)}.
            {avgMonthlySpend > 0 ? ` 평균 대비 ${Math.round(spikeMonth.val / avgMonthlySpend * 100)}% 수준으로 ` : " "}
            {spikeMonth.val > avgMonthlySpend * 1.5 ? "지출이 크게 튀었습니다. 대형 구매나 특별 이벤트가 있었을 수 있습니다. 25일 전후 급등 패턴을 확인하세요." : "다소 높은 지출이었습니다."}
            {stableMonth ? ` 반면 ${d.ml[stableMonth.m]}은 ${F(stableMonth.val)}로 가장 안정적이었습니다. 변동폭 ${F(spikeMonth.val - stableMonth.val)}.` : ""}
          </Insight>}
          <Insight title="15일 기준선 분석" color="#2563eb" bg="#cce5ff">
            15일차까지 월 지출의 50% 이내면 후반부 지출 여유가 생깁니다.
            {midSpend[0] ? ` 15일차 기준 최다 지출월: ${d.ml[midSpend[0].m]}(${F(midSpend[0].val)}). ${midSpend[0].val > (d.cumSpend[midSpend[0].m]?.[30] ?? 0) * 0.55 ? "전반부에 지출이 집중되어 후반부에 긴축하게 됩니다." : "전후반 균형이 좋았습니다."}` : ""}
            {midSpend.length > 1 ? ` 최소: ${d.ml[midSpend[midSpend.length - 1].m]}(${F(midSpend[midSpend.length - 1].val)}).` : ""}
          </Insight>
          {projected > 0 && <Insight title="이번 달 예측" color={projected > avgMonthlySpend * 1.2 ? "#e94560" : "#059669"} bg={projected > avgMonthlySpend * 1.2 ? "#fff5f5" : "#d4edda"}>
            현재 {dayOfMonth}일차, 지출 {F(currentSpend)}. 이 속도로 가면 월말 예상 {F(Math.round(projected))}.
            {avgMonthlySpend > 0 ? ` 평균({F(Math.round(avgMonthlySpend))}) 대비 ${Math.round(projected / avgMonthlySpend * 100)}%.` : ""}
            {projected > avgMonthlySpend * 1.3 ? " 현재 속도면 평균을 크게 초과합니다. 남은 기간 지출을 줄이면 아직 조정 가능합니다." : projected > avgMonthlySpend * 1.1 ? " 다소 높은 속도이지만 관리 가능합니다." : " 양호한 지출 속도입니다."}
            {daysInMonth - dayOfMonth > 0 ? ` 남은 ${daysInMonth - dayOfMonth}일간 일 ${F(Math.round(Math.max(0, avgMonthlySpend - currentSpend) / (daysInMonth - dayOfMonth)))} 이하로 쓰면 평균 수준 유지.` : ""}
          </Insight>}
          <Insight title="월간 변동성" color="#b45309" bg="#fff3cd">
            {validMonths.length >= 2 ? (() => {
              const vals = validMonths.map(m => d.cumSpend[m]?.[30] ?? 0);
              const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
              const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
              const cv = mean > 0 ? Math.round(std / mean * 100) : 0;
              return `${validMonths.length}개월 분석 결과, 변동계수 ${cv}%. ${cv > 30 ? "월별 지출 변동이 큽니다. 고정비와 변동비를 구분해서 변동비를 줄이면 안정적인 지출 관리가 가능합니다." : cv > 15 ? "적당한 수준의 변동성입니다. 대부분의 월이 비슷한 패턴을 보입니다." : "매우 안정적인 지출 패턴! 예산 관리를 잘 하고 계십니다."}`;
            })() : "분석할 데이터가 부족합니다."}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 지출 추세 상세" span={3}>
          <div className="grid-2" style={{ gap: 10 }}>
            {d.subInsights.filter(s => s.monthTrend !== "flat").slice(0, 10).map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : "#f0fdf4", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : "#86efac"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.monthTrend === "up" ? "▲" : "▼"} {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: s.monthTrend === "up" ? "#e94560" : "#059669" }}>
                    {Math.abs(s.mom)}% {s.monthTrend === "up" ? "증가" : "감소"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>총 {F(s.total)}</span>
                  <span>비중 {s.share}%</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {s.comment}
                </div>
              </div>
            ))}
            {d.subInsights.filter(s => s.monthTrend !== "flat").length === 0 && (
              <div style={{ gridColumn: "span 2", textAlign: "center", padding: 20, color: "#999" }}>모든 중분류가 전월과 비슷한 수준을 유지하고 있습니다. 안정적인 지출 패턴입니다.</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
});
