import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { WDN, C, F, Card, Kpi, Insight, CT, pieLabel, type D } from "../insightsShared";

export const PatternTab = React.memo(function PatternTab({ d }: { d: D }) {
  const wdData = WDN.map((name, i) => ({ name, total: d.wdSpend[i].total, avg: d.wdSpend[i].count > 0 ? Math.round(d.wdSpend[i].total / d.wdSpend[i].count) : 0, count: d.wdSpend[i].count }));
  const subFreqPie = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제" && s.count > 0).slice(0, 8).map(s => ({ name: s.sub, value: s.count }));
  const sorted = [...wdData].sort((a, b) => b.avg - a.avg);
  const totalExpTx = d.wdSpend.reduce((s, w) => s + w.count, 0);
  const avgDaily = d.totalDays > 0 ? Math.round(d.pExpense / d.totalDays) : 0;
  const weekendPct = d.weekendTot + d.weekdayTot > 0 ? Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100) : 0;

  const byThird = [0, 0, 0];
  d.spendByDOM.forEach((v, i) => { if (i < 10) byThird[0] += v; else if (i < 20) byThird[1] += v; else byThird[2] += v; });
  const thirdData = [{ name: "상순(1~10)", 지출: byThird[0] }, { name: "중순(11~20)", 지출: byThird[1] }, { name: "하순(21~31)", 지출: byThird[2] }];

  return (
    <div className="grid-4">
      <Card accent><Kpi label="무지출 일수" value={`${d.zeroDays}일`} sub={`${d.totalDays}일 중`} color="#48c9b0" /></Card>
      <Card accent><Kpi label="일 평균 지출" value={F(avgDaily)} color="#f0c040" /></Card>
      <Card accent><Kpi label="주말 지출 비중" value={weekendPct + "%"} sub={`주말 ${F(d.weekendTot)} / 주중 ${F(d.weekdayTot)}`} color="#e94560" /></Card>
      <Card accent><Kpi label="총 거래 건수" value={`${totalExpTx}건`} color="#fff" /></Card>

      <Card title="요일별 지출 패턴" span={2}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={wdData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="avg" fill="#533483" radius={[6, 6, 0, 0]} name="건당 평균" />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ textAlign: "center", fontSize: 11, color: "#999", marginTop: 4 }}>건당 평균 금액 기준. 최고: {sorted[0]?.name}({F(sorted[0]?.avg || 0)})</div>
      </Card>

      <Card title="중분류별 지출 빈도" span={1}>
        {subFreqPie.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={subFreqPie} dataKey="value" cx="50%" cy="50%" outerRadius={95} innerRadius={40} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
              {subFreqPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Pie><Tooltip formatter={(v: ValueType | undefined) => `${v}건`} /></PieChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div>}
      </Card>

      <Card title="상·중·하순 지출 비교" span={1}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={thirdData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="지출" radius={[6, 6, 0, 0]}>
              {thirdData.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="지출 많은 날 TOP 5" span={2}>
        {d.topDates.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#999" }}>데이터 없음</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.topDates.map((dt, idx) => (
              <div key={dt.date} style={{ background: idx < 3 ? "#fff5f5" : "#f8f9fa", borderRadius: 10, padding: "10px 14px", border: idx < 3 ? "1px solid #fcc" : "1px solid #eee", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${d.topDates[0] ? dt.total / d.topDates[0].total * 100 : 0}%`, background: "rgba(233,69,96,0.06)", borderRadius: 10 }} />
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: idx < 3 ? "#e94560" : "#999", width: 28 }}>{idx + 1}</span>
                  <span style={{ fontSize: 13, color: "#666", fontWeight: 600, minWidth: 85 }}>{dt.date}</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#e94560", marginLeft: "auto" }}>{F(dt.total)}</span>
                </div>
                <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {dt.items.slice(0, 4).map((it, j) => (
                    <span key={j} style={{ fontSize: 10, color: "#999", background: "#fff", border: "1px solid #eee", borderRadius: 4, padding: "1px 6px" }}>{it.desc} {F(it.amount)}</span>
                  ))}
                  {dt.items.length > 4 && <span style={{ fontSize: 10, color: "#999" }}>+{dt.items.length - 4}건</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="고액 지출 TOP 12" span={2}>
        {d.largeExp.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#999" }}>10만원 이상 지출 없음</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {d.largeExp.slice(0, 12).map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i < 3 ? "#fff5f5" : "#f8f9fa", borderRadius: 8, border: i < 3 ? "1px solid #fcc" : "1px solid #eee" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: i < 3 ? "#e94560" : "#999", width: 24 }}>{i + 1}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{item.desc || item.sub}</div><div style={{ fontSize: 10, color: "#999" }}>{item.date} · {item.sub}</div></div>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#e94560" }}>{F(item.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="소비 패턴 종합 분석" span={4}>
        <div className="grid-2" style={{ gap: 12 }}>
          <Insight title="요일별 소비 패턴" color="#e94560" bg="#f8d7da">
            건당 평균이 가장 높은 요일: {sorted.slice(0, 2).map(w => `${w.name}(${F(w.avg)}, ${w.count}건)`).join(", ")}.
            건당 평균이 가장 낮은 요일: {sorted.slice(-1).map(w => `${w.name}(${F(w.avg)}, ${w.count}건)`).join("")}.
            {sorted[0]?.avg > sorted[sorted.length - 1]?.avg * 3 ? ` 요일간 격차가 ${Math.round(sorted[0].avg / Math.max(sorted[sorted.length - 1].avg, 1))}배로 큽니다. 고액 결제일이 특정 요일에 집중되어 있을 수 있습니다.` : " 요일간 큰 격차는 없습니다."}
          </Insight>
          <Insight title="주말 vs 주중 분석" color="#0f3460" bg="#f0f8ff">
            주말 {weekendPct}% ({F(d.weekendTot)}), 주중 {100 - weekendPct}% ({F(d.weekdayTot)}).
            {weekendPct > 40 ? " 주말 지출 비중이 높습니다. 외식, 여가, 쇼핑 등이 주말에 집중될 수 있습니다. 주말 예산을 정해두면 효과적입니다." : weekendPct > 25 ? " 주중과 주말 지출이 비교적 균형적입니다." : " 주중 지출이 압도적으로 많습니다. 출퇴근 비용이나 점심값 등 고정적 지출이 주중에 집중되는 패턴입니다."}
          </Insight>
          <Insight title="월 상·중·하순 패턴" color="#b45309" bg="#fff3cd">
            상순(1~10일): {F(byThird[0])} ({d.pExpense > 0 ? Math.round(byThird[0] / d.pExpense * 100) : 0}%), 중순(11~20일): {F(byThird[1])} ({d.pExpense > 0 ? Math.round(byThird[1] / d.pExpense * 100) : 0}%), 하순(21~31일): {F(byThird[2])} ({d.pExpense > 0 ? Math.round(byThird[2] / d.pExpense * 100) : 0}%).
            {byThird[2] > byThird[0] && byThird[2] > byThird[1] ? " 하순에 지출이 가장 많습니다. 신용카드 결제일이나 월말 소비 심리가 영향을 줄 수 있습니다." : byThird[0] > byThird[1] ? " 상순에 지출이 집중됩니다. 월초 고정비(월세, 보험 등) 결제 영향일 수 있습니다." : " 중순에 지출이 가장 많습니다."}
          </Insight>
          <Insight title="무지출 & 소비 통제력" color="#059669" bg="#d4edda">
            {d.zeroDays > 0 ? `${d.totalDays}일 중 ${d.zeroDays}일 무지출 (${Math.round(d.zeroDays / Math.max(d.totalDays, 1) * 100)}%).` : "무지출일이 없습니다."}
            {d.zeroDays >= d.totalDays * 0.3 ? " 뛰어난 소비 통제력! 무지출일이 30% 이상으로 매우 절약적입니다." : d.zeroDays >= d.totalDays * 0.15 ? " 적정 수준의 무지출일입니다. 주 1~2일 무지출 습관이 잡혀 있네요." : " 거의 매일 지출이 발생합니다. 주 1일이라도 무지출일을 만들어 보세요. 습관이 되면 자연스럽게 절약됩니다."}
            {d.pExpense > 0 && d.totalDays > 0 ? ` 일 평균 지출 ${F(Math.round(d.pExpense / d.totalDays))}.` : ""}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 소비 패턴 상세" span={4}>
          <div className="grid-2" style={{ gap: 10 }}>
            {d.subInsights.slice(0, 12).map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>{s.count}건</span>
                  <span>건당 {F(s.avg)}</span>
                  <span>비중 {s.share}%</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                  <span>피크 {s.peak || "-"}</span>
                  <span>최대건 {F(s.maxSingle)}</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ ${s.mom}% 증가 추세` : s.monthTrend === "down" ? `▼ ${Math.abs(s.mom)}% 감소 추세` : "안정적 유지"}
                  {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가!`}
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
