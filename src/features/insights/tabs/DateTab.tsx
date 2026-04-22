import React from "react";
import {
  BarChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { WDN, C, F, W, Card, Kpi, Insight, CT, pieLabel, type D } from "../insightsShared";

export const DateTab = React.memo(function DateTab({ d }: { d: D }) {
  const allMonthData = d.months.map(m => ({ name: d.ml[m], 금액: d.dateExpMonthly[m] ?? 0 }));
  const total = Object.values(d.dateExpMonthly).reduce((a, b) => a + b, 0);
  const monthsWithData = Object.values(d.dateExpMonthly).filter(v => v > 0).length;
  const avg = monthsWithData > 0 ? total / monthsWithData : 0;
  const splitTotal = d.dateMoim + d.datePersonal;
  const moimPct = splitTotal > 0 ? Math.round(d.dateMoim / splitTotal * 100) : 0;
  const subPie = d.dateSubCats.slice(0, 8).map(([name, value]) => ({ name, value }));
  const dateVsTotal = d.months.filter(m => d.monthly[m].expense > 0).map(m => ({
    name: d.ml[m], 비율: d.dateExpMonthly[m] && d.monthly[m].expense > 0 ? Math.round(d.dateExpMonthly[m] / d.monthly[m].expense * 100) : 0,
  }));
  const maxMonth = allMonthData.reduce((max, m) => m.금액 > max.금액 ? m : max, allMonthData[0] || { name: "", 금액: 0 });
  const minMonth = allMonthData.filter(m => m.금액 > 0).reduce((min, m) => m.금액 < min.금액 ? m : min, allMonthData.find(m => m.금액 > 0) || { name: "", 금액: 0 });
  const avgPerTx = d.dateTxCount > 0 ? Math.round(total / d.dateTxCount) : 0;

  /* 요일별 데이트 지출 */
  const dateDow = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const e of d.dateEntries) {
    if (!e.date) continue;
    const js = new Date(e.date).getDay();
    const idx = js === 0 ? 6 : js - 1;
    dateDow[idx].total += e.amount; dateDow[idx].count++;
  }
  const dowData = WDN.map((name, i) => ({ name, 금액: dateDow[i].total, 건수: dateDow[i].count }));

  const noData = d.dateTxCount === 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="총 데이트 지출" value={F(total)} sub={`${d.dateTxCount}건`} color="#e94560" /></Card>
      <Card accent><Kpi label="월평균 · 건당평균" value={F(Math.round(avg))} sub={`건당 ${F(avgPerTx)}`} color="#f0c040" /></Card>
      <Card accent><Kpi label="모임통장 vs 개인" value={`${moimPct}% : ${100 - moimPct}%`} sub={`모임 ${F(d.dateMoim)} / 개인 ${F(d.datePersonal)}`} color="#48c9b0" /></Card>

      {noData && (
        <Card span={3}>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💕</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>데이트 지출 데이터가 없습니다</div>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              가계부에서 <b>대분류</b> 또는 <b>중분류</b>에 "데이트"가 포함된 항목을 자동 감지합니다.<br />
              예: category="데이트비" / subCategory="데이트비" 등
            </div>
          </div>
        </Card>
      )}

      {!noData && <>
        <Card title="월별 데이트 지출" span={2}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={allMonthData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
              <Bar dataKey="금액" fill="#e94560" radius={[6, 6, 0, 0]} /><Line type="monotone" dataKey="금액" stroke="#f0c040" strokeWidth={2} dot={{ r: 3 }} name="추세" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="중분류별 비중">
          {subPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart><Pie data={subPie} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={40} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
                {subPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
              </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>중분류 없음</div>}
        </Card>

        {d.dateByDetail.length > 1 && (
          <Card title="소분류별 데이트 지출">
            <div style={{ maxHeight: 280, overflow: "auto" }}>
              {d.dateByDetail.map(([name, value], i) => {
                const dtTotal = d.dateByDetail.reduce((s, [, v]) => s + v, 0);
                return (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />{name}
                    </span>
                    <span style={{ fontWeight: 700 }}>{F(value)} <span style={{ fontSize: 10, color: "#999" }}>({dtTotal > 0 ? Math.round(value / dtTotal * 100) : 0}%)</span></span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card title="지출처 TOP 20 (설명/내역)" span={2}>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {d.dateTop.map(([name, value], i) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{name}</span>
                <span style={{ fontWeight: 700, color: "#e94560" }}>{F(value)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="요일별 데이트 지출">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dowData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
              <Bar dataKey="금액" radius={[6, 6, 0, 0]}>
                {dowData.map((e, i) => <Cell key={i} fill={e.금액 === Math.max(...dowData.map(x => x.금액)) ? "#e94560" : "#0f3460"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            {(() => { const best = dowData.reduce((m, d) => d.금액 > m.금액 ? d : m, dowData[0]); return best.금액 > 0 ? `${best.name}요일에 가장 많이 지출 (${best.건수}건, ${F(best.금액)})` : ""; })()}
          </div>
        </Card>

        <Card title="전체 지출 대비 데이트비 비율" span={1}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dateVsTotal}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 10 }} /><Tooltip formatter={(v: ValueType | undefined) => v + "%"} />
              <Bar dataKey="비율" fill="#e94560" radius={[4, 4, 0, 0]} name="비율" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="데이트 내역 상세" span={2}>
          <div style={{ overflowX: "auto", maxHeight: 320 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid #eee" }}>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>날짜</th>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>내용</th>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>중분류</th>
                <th style={{ padding: "6px", textAlign: "right", color: "#999" }}>금액</th>
              </tr></thead>
              <tbody>{d.dateEntries.slice(0, 30).map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "5px 6px", color: "#666" }}>{e.date}</td>
                  <td style={{ padding: "5px 6px", fontWeight: 500 }}>{e.desc || "-"}</td>
                  <td style={{ padding: "5px 6px", color: "#888" }}>{e.sub || "-"}</td>
                  <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(e.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
            {d.dateEntries.length > 30 && <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>+{d.dateEntries.length - 30}건 더</div>}
          </div>
        </Card>

        <Card title="통계" span={1}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "총 건수", value: `${d.dateTxCount}건`, color: "#e94560" },
              { label: "건당 평균", value: F(avgPerTx), color: "#0f3460" },
              { label: "최대 지출월", value: `${maxMonth.name} (${F(maxMonth.금액)})`, color: "#f39c12" },
              { label: "최소 지출월", value: `${minMonth.name} (${F(minMonth.금액)})`, color: "#48c9b0" },
              { label: "전체 지출 대비", value: d.pExpense > 0 ? Math.round(total / d.pExpense * 100) + "%" : "-", color: "#533483" },
              { label: "모임통장 비율", value: moimPct + "%", color: "#2ecc71" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "#f8f9fa", borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: "#666" }}>{s.label}</span>
                <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="데이트비 종합 인사이트" span={3}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Insight title="지출처 분석" color="#e94560" bg="#fff5f5">
              {d.dateTop.length > 0 ? `최다 지출처: ${d.dateTop[0][0]}에 총 ${F(d.dateTop[0][1])} (전체의 ${total > 0 ? Math.round(d.dateTop[0][1] / total * 100) : 0}%).` : "데이터 없음"}
              {d.dateTop.length > 1 ? ` 2위 ${d.dateTop[1][0]}(${F(d.dateTop[1][1])}), ${d.dateTop.length > 2 ? `3위 ${d.dateTop[2][0]}(${F(d.dateTop[2][1])}).` : "."}` : ""}
              {d.dateTop.length > 3 ? ` 상위 3곳이 ${total > 0 ? Math.round((d.dateTop[0][1] + d.dateTop[1][1] + (d.dateTop[2]?.[1] ?? 0)) / total * 100) : 0}% 차지. ${d.dateTop.length > 5 ? "다양한 곳에서 데이트를 즐기고 있네요!" : "자주 가는 곳이 집중되어 있습니다."}` : ""}
            </Insight>
            <Insight title="모임통장 활용 분석" color="#2ecc71" bg="#f5fff5">
              {splitTotal > 0 ? `모임통장 ${F(d.dateMoim)}(${moimPct}%), 개인 ${F(d.datePersonal)}(${100 - moimPct}%). ${moimPct >= 50 ? "모임통장을 잘 활용하고 있습니다! 데이트 비용을 효과적으로 분담하고 있어요." : moimPct >= 30 ? "모임통장 활용도가 적당합니다. 더 늘리면 개인 부담이 줄어들 수 있어요." : "개인 결제 비중이 높습니다. 데이트 모임통장 활용을 더 늘려보세요. 공동 지출은 모임통장으로 결제하면 정산이 편합니다."}` : "모임통장 사용 내역이 없습니다. 모임통장을 만들면 데이트 비용 관리가 더 쉬워집니다."}
            </Insight>
            <Insight title="월별 추세 분석" color="#0f3460" bg="#f0f8ff">
              {allMonthData.length >= 2 ? `최고 ${maxMonth.name}(${F(maxMonth.금액)}), 최저 ${minMonth.name}(${F(minMonth.금액)}). 변동폭 ${F(maxMonth.금액 - minMonth.금액)}. ${maxMonth.금액 > avg * 2 ? `${maxMonth.name}에 특별 이벤트나 큰 지출이 있었습니다. 평균 대비 ${Math.round(maxMonth.금액 / Math.max(avg, 1) * 100)}% 수준.` : "비교적 안정적인 데이트 지출 패턴입니다."} 월평균 ${F(Math.round(avg))}, 건당 평균 ${F(avgPerTx)}.` : "데이터 부족"}
            </Insight>
            <Insight title="데이트 지출 비중" color="#533483" bg="rgba(83,52,131,0.08)">
              {d.pExpense > 0 ? `전체 지출의 ${Math.round(total / d.pExpense * 100)}%가 데이트 비용입니다. ${total / d.pExpense > 0.15 ? "데이트 비용 비중이 높은 편입니다. 가성비 좋은 데이트 활동을 찾아보세요." : total / d.pExpense > 0.05 ? "적정한 데이트 비용 비중입니다." : "데이트 비용이 전체에서 낮은 비중을 차지합니다."} 월평균 ${F(Math.round(avg))}로, ${avg > 300000 ? "월 30만원 이상 지출 중입니다." : avg > 150000 ? "월 15~30만원 수준입니다." : "알뜰하게 데이트하고 있습니다!"}` : ""}
            </Insight>
          </div>
        </Card>

        {d.dateSubInsights.length > 0 && (
          <Card title="중분류별 데이트 상세 인사이트" span={3}>
            <div className="grid-2" style={{ gap: 10 }}>
              {d.dateSubInsights.map((s, i) => (
                <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fcc", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {s.sub}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                    <span>비중 {s.share}%</span>
                    <span>{s.count}건</span>
                    <span>건당 {F(s.avg)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                    {s.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </>}
    </div>
  );
});
