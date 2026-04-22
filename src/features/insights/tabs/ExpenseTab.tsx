import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, SD, Card, Insight, CT, pieLabel, type D } from "../insightsShared";

export const ExpenseTab = React.memo(function ExpenseTab({ d }: { d: D }) {
  /* 중분류 (subCategory) 기준 — 핵심 분석 단위 */
  const subs = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제");
  const subPie = subs.slice(0, 10).map(s => ({ name: s.sub, value: s.amount }));
  const topSub = subs[0];

  /* 대분류 트렌드 (월별 흐름은 대분류가 더 가독성 좋음) */
  const trendCats = d.topCats.filter(c => c !== "신용결제");
  const trendData = d.months.map(m => { const o: Record<string, string | number> = { name: d.ml[m] }; trendCats.forEach(c => { o[c] = d.monthlyCatTrend[m]?.[c] || 0; }); return o; });

  /* 대분류 → 중분류 드릴다운 */
  const cats = d.expByCat.filter(([k]) => k !== "신용결제");
  const subCatByCat = new Map<string, { sub: string; amount: number; count: number }[]>();
  for (const s of d.expBySubCat) {
    if (s.cat === "신용결제") continue;
    const arr = subCatByCat.get(s.cat) ?? [];
    arr.push({ sub: s.sub, amount: s.amount, count: s.count });
    subCatByCat.set(s.cat, arr);
  }

  /* 소분류/설명 기준 */
  const topDescs = d.expByDesc.filter(x => x.cat !== "신용결제").slice(0, 25);
  const domData = d.spendByDOM.map((v, i) => ({ day: i + 1, 지출: v }));

  /* 중분류 월평균 */
  const subAvg = subs.slice(0, 10).map(s => ({ name: s.sub, avg: Math.round(SD(s.amount, d.months.length)) }));

  return (
    <div className="grid-2">
      {/* 중분류 파이차트 */}
      <Card title="중분류별 지출 비중">
        <ResponsiveContainer width="100%" height={320}>
          <PieChart><Pie data={subPie} dataKey="value" cx="50%" cy="50%" outerRadius={120} innerRadius={55} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
            {subPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
          </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
        </ResponsiveContainer>
      </Card>

      {/* 중분류 순위 */}
      <Card title="중분류 지출 순위">
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {subs.slice(0, 20).map((s, i) => (
            <div key={s.sub} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 11, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right", fontWeight: 700 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.sub} <span style={{ fontSize: 10, color: "#bbb" }}>({s.cat})</span></div>
                <div style={{ height: 4, background: "#f0f0f0", borderRadius: 2, marginTop: 3 }}>
                  <div style={{ height: 4, background: C[i % 12], borderRadius: 2, width: `${topSub ? s.amount / topSub.amount * 100 : 0}%` }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e94560" }}>{F(s.amount)}</div>
                <div style={{ fontSize: 10, color: "#999" }}>{s.count}건</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 대분류 → 중분류 드릴다운 */}
      <Card title="대분류 → 중분류 상세" span={2}>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          {cats.slice(0, 10).map(([catName, catTotal], ci) => {
            const csubs = subCatByCat.get(catName) ?? [];
            return (
              <div key={catName} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `2px solid ${C[ci % 12]}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C[ci % 12] }}>{catName}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#e94560" }}>{F(catTotal)}</span>
                </div>
                {csubs.slice(0, 8).map((s, si) => (
                  <div key={si} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0 4px 16px", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ color: "#555" }}>{s.sub} <span style={{ color: "#bbb", fontSize: 10 }}>({s.count}건)</span></span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 60, height: 4, background: "#f0f0f0", borderRadius: 2 }}>
                        <div style={{ height: 4, background: C[ci % 12], borderRadius: 2, width: `${catTotal > 0 ? s.amount / catTotal * 100 : 0}%`, opacity: 0.7 }} />
                      </div>
                      <span style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}>{F(s.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 월별 대분류 트렌드 */}
      <Card title="월별 대분류 트렌드" span={2}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
            {trendCats.map((c, i) => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={C[i]} fill={C[i]} fillOpacity={0.6} />)}
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* 소분류/설명 TOP (어디에 돈을 썼는지) */}
      <Card title="지출 내역 TOP 25 (소분류/설명)">
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          {topDescs.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{item.desc}</div>
                <div style={{ fontSize: 10, color: "#aaa" }}>{item.cat}{item.sub ? ` · ${item.sub}` : ""}</div>
              </div>
              <span style={{ fontWeight: 700, color: "#e94560" }}>{F(item.amount)}</span>
            </div>
          ))}
          {topDescs.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "#999" }}>데이터 없음</div>}
        </div>
      </Card>

      {/* 중분류 월평균 */}
      <Card title="중분류 월평균 지출">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={subAvg} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis type="number" tickFormatter={F} tick={{ fontSize: 10 }} /><YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /><Bar dataKey="avg" fill="#533483" radius={[0, 4, 4, 0]} name="월평균" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 일자별 지출 패턴 */}
      <Card title="일자별 지출 패턴 (1~31일)">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={domData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="day" tick={{ fontSize: 9 }} interval={2} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="지출" radius={[2, 2, 0, 0]}>
              {domData.map((e, i) => <Cell key={i} fill={e.지출 > d.avgMonthExp / 15 ? "#e94560" : "#0f3460"} opacity={0.7} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* TOP 단건 지출 */}
      <Card title="TOP 10 단건 지출" span={2}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: "2px solid #eee" }}>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>#</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>날짜</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>내용</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>대분류</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>중분류</th>
              <th style={{ padding: "8px 6px", textAlign: "right", color: "#999" }}>금액</th>
            </tr></thead>
            <tbody>{d.topTx.map((t, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: "6px", fontWeight: 700, color: i < 3 ? "#e94560" : "#999" }}>{i + 1}</td>
                <td style={{ padding: "6px", color: "#666" }}>{t.date}</td>
                <td style={{ padding: "6px", fontWeight: 500 }}>{t.desc || "-"}</td>
                <td style={{ padding: "6px", color: "#666" }}>{t.cat}</td>
                <td style={{ padding: "6px", color: "#888" }}>{t.sub || "-"}</td>
                <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(t.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      {/* 인사이트 */}
      <Card title="지출 분석 인사이트" span={2}>
        <div className="grid-2" style={{ gap: 10 }}>
          <Insight title="최다 지출 중분류" color="#e94560" bg="#fff5f5">
            {topSub ? `${topSub.sub}에 총 ${F(topSub.amount)} (${topSub.count}건, 건당 평균 ${F(Math.round(SD(topSub.amount, topSub.count)))}). ${d.pExpense > 0 ? `전체 지출의 ${Math.round(SD(topSub.amount, d.pExpense) * 100)}%를 차지합니다.` : ""} ${topSub.count > 10 ? "잦은 소비가 누적되고 있습니다. 건수를 줄이는 것만으로도 효과적입니다." : "고단가 지출이 비중을 높이고 있습니다."}` : "데이터 없음"}
          </Insight>
          <Insight title="최다 지출 항목(설명)" color="#0f3460" bg="#f0f8ff">
            {topDescs.length > 0 ? `${topDescs[0].desc}에 총 ${F(topDescs[0].amount)}을 사용했습니다 (${topDescs[0].cat} · ${topDescs[0].sub || "기타"}). ${topDescs.length > 1 ? `2위 ${topDescs[1].desc}(${F(topDescs[1].amount)}), 3위 ${topDescs.length > 2 ? `${topDescs[2].desc}(${F(topDescs[2].amount)})` : "없음"}.` : ""}` : "데이터 없음"}
          </Insight>
          <Insight title="일자별 지출 패턴" color="#b45309" bg="#fff3cd">
            {(() => {
              const maxD = d.spendByDOM.indexOf(Math.max(...d.spendByDOM));
              const topDays = d.spendByDOM.map((v, i) => ({ day: i + 1, v })).sort((a, b) => b.v - a.v).slice(0, 3);
              return `지출 최고일: ${topDays.map(d => `${d.day}일(${F(d.v)})`).join(", ")}. ${maxD >= 24 ? "월말에 지출이 집중됩니다. 신용카드 결제일 영향일 수 있습니다." : maxD < 5 ? "월초에 지출이 집중됩니다. 고정비 결제 패턴을 확인하세요." : "중순에 지출이 가장 많습니다."}`;
            })()}
          </Insight>
          <Insight title="지출 효율성" color="#059669" bg="#d4edda">
            {d.pExpense > 0 && d.totalDays > 0 ? `일 평균 ${F(Math.round(d.pExpense / d.totalDays))} 지출. 총 ${d.expByCat.length}개 대분류, ${subs.length}개 중분류에 분산. ${subs.length > 15 ? "지출처가 많아 관리가 복잡합니다. 통합할 수 있는 항목이 있는지 확인하세요." : subs.length > 8 ? "적당한 수의 카테고리에 분산되어 있습니다." : "소수 카테고리에 집중되어 있어 관리가 용이합니다."}` : "데이터 없음"}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 세부 인사이트" span={2}>
          <div className="grid-2" style={{ gap: 10 }}>
            {d.subInsights.map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#999" }}>{s.cat}</span>
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중 {s.share}%</span>
                  <span>{s.count}건</span>
                  <span>건당 {F(s.avg)}</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                  <span>피크 {s.peak || "-"}</span>
                  <span>최대건 {F(s.maxSingle)}</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
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
