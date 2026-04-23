import React from "react";
import {
  BarChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, LineChart,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { WDN, C, F, W, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";

export const DateTab = React.memo(function DateTab({ d }: { d: D }) {
  const allMonthData = d.months.map((m) => ({ name: d.ml[m], 금액: d.dateExpMonthly[m] ?? 0 }));
  const total = Object.values(d.dateExpMonthly).reduce((a, b) => a + b, 0);
  const monthsActive = Object.values(d.dateExpMonthly).filter((v) => v > 0).length;
  const avgPerActiveMonth = monthsActive > 0 ? total / monthsActive : 0;
  const avgPerPeriodMonth = d.months.length > 0 ? total / d.months.length : 0;
  const splitTotal = d.dateMoim + d.datePersonal;
  const moimPct = splitTotal > 0 ? Math.round((d.dateMoim / splitTotal) * 100) : 0;
  const subPie = d.dateSubCats.slice(0, 8).map(([name, value]) => ({ name, value }));
  const avgPerTx = d.dateTxCount > 0 ? Math.round(total / d.dateTxCount) : 0;

  const dateVsTotal = d.months.filter((m) => d.monthly[m].expense > 0).map((m) => ({
    name: d.ml[m],
    비율: d.dateExpMonthly[m] && d.monthly[m].expense > 0 ? Math.round((d.dateExpMonthly[m] / d.monthly[m].expense) * 100) : 0,
  }));

  /* 요일별 데이트 지출 */
  const dateDow = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const e of d.dateEntries) {
    if (!e.date) continue;
    const js = new Date(e.date).getDay();
    const idx = js === 0 ? 6 : js - 1;
    dateDow[idx].total += e.amount;
    dateDow[idx].count++;
  }
  const dowData = WDN.map((name, i) => ({ name, 금액: dateDow[i].total, 건수: dateDow[i].count }));

  /* 데이트 날짜 집합 + 빈도 지표 */
  const dateSet = new Set(d.dateEntries.map((e) => e.date).filter(Boolean));
  const uniqueDateDays = dateSet.size;

  const totalDaysSpan = (() => {
    if (d.dateEntries.length === 0 || d.months.length === 0) return 0;
    const start = new Date(d.months[0] + "-01");
    const [y, mo] = d.months[d.months.length - 1].split("-").map(Number);
    const end = new Date(y, mo, 0); // last day of last month
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  })();
  const datesPerWeek = totalDaysSpan > 0 ? (uniqueDateDays / totalDaysSpan) * 7 : 0;
  const datesPerMonth = d.months.length > 0 ? uniqueDateDays / d.months.length : 0;

  /* 가장 긴 공백 (최근 데이트 이후 경과일 포함) */
  const longestGap = (() => {
    const sorted = Array.from(dateSet).sort();
    if (sorted.length === 0) return 0;
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const a = new Date(sorted[i - 1]);
      const b = new Date(sorted[i]);
      const gap = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
      if (gap > maxGap) maxGap = gap;
    }
    return maxGap;
  })();
  const daysSinceLast = (() => {
    const sorted = Array.from(dateSet).sort();
    if (sorted.length === 0) return null;
    const last = new Date(sorted[sorted.length - 1]);
    const today = new Date();
    return Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  })();

  /* 건당 평균 추이 (월별) */
  const avgPerTxTrend = d.months.map((m) => {
    const monthEntries = d.dateEntries.filter((e) => e.date?.startsWith(m));
    const sum = monthEntries.reduce((s, e) => s + e.amount, 0);
    return { name: d.ml[m], 건당평균: monthEntries.length > 0 ? Math.round(sum / monthEntries.length) : 0 };
  });

  /* 누적 데이트 지출 */
  const cumDate = (() => {
    let c = 0;
    return d.months.map((m) => { c += d.dateExpMonthly[m] ?? 0; return { name: d.ml[m], 누적: c }; });
  })();

  /* 단일 건 TOP — 기념일·큰 이벤트 감지 */
  const bigSingles = [...d.dateEntries].sort((a, b) => b.amount - a.amount).slice(0, 10);

  const maxMonth = allMonthData.reduce((max, m) => (m.금액 > max.금액 ? m : max), allMonthData[0] || { name: "", 금액: 0 });
  const minMonth = allMonthData.filter((m) => m.금액 > 0).reduce((min, m) => (m.금액 < min.금액 ? m : min), allMonthData.find((m) => m.금액 > 0) || { name: "", 금액: 0 });

  const noData = d.dateTxCount === 0;
  const periodLabel = d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-";

  return (
    <div>
      {/* 상단 배너 */}
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{d.months.length}개월</strong> ({periodLabel}) · 단위: <strong>원</strong> · 감지 조건: 대분류/중분류에 <strong>"데이트"</strong> 포함 · 모임통장: 계좌명에 "모임" 포함
      </div>

      {noData ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 20px", color: "#999", borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💕</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>데이트 지출 데이터가 없습니다</div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            가계부에서 <b>대분류</b> 또는 <b>중분류</b>에 "데이트"가 포함된 항목을 자동 감지합니다.<br />
            예: category="데이트비" / subCategory="데이트비" 등
          </div>
        </div>
      ) : (
        <>
          {/* ============ 한눈에 ============ */}
          <Section storageKey="date-section-overview" title="📊 한눈에 보기">
            <Card accent><Kpi label="총 데이트 지출" value={F(total) + "원"} sub={`${d.dateTxCount}건 · 내 부담 ~${F(Math.round(total / 2))}원 (50%)`} color="#e94560" info="데이트 관련 모든 지출 합계. 50/50 분담이므로 실 부담은 절반" /></Card>
            <Card accent><Kpi label="월평균" value={F(Math.round(avgPerPeriodMonth)) + "원"} sub={`활성월 ${monthsActive}개 평균 ${F(Math.round(avgPerActiveMonth))}원`} color="#f0c040" info="전체 기간 월 평균 (데이트 없었던 월 포함)" /></Card>
            <Card accent><Kpi label="건당 평균" value={F(avgPerTx) + "원"} sub={`단일 최고 ${F(bigSingles[0]?.amount ?? 0)}원`} color="#0f3460" info="1건당 평균 지출. 기념일 등 큰 건이 평균을 올릴 수 있음" /></Card>
            <Card accent><Kpi label="모임 : 개인 비율" value={`${moimPct} : ${100 - moimPct}`} sub={`모임 ${F(d.dateMoim)}원 / 개인 ${F(d.datePersonal)}원`} color="#2ecc71" info="계좌명에 '모임' 포함된 계좌로 결제한 비율" /></Card>

            <Card title="월별 데이트 지출" span={2}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={allMonthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CT />} />
                  <Bar dataKey="금액" fill="#e94560" radius={[6, 6, 0, 0]} />
                  <Line type="monotone" dataKey="금액" stroke="#f0c040" strokeWidth={2} dot={{ r: 3 }} name="추세" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            <Card title="중분류 구성" span={2}>
              {subPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={subPie} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
                      {subPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>중분류 없음</div>}
            </Card>
          </Section>

          {/* ============ 빈도·패턴 ============ */}
          <Section storageKey="date-section-frequency" title="💕 데이트 빈도·패턴">
            <Card accent>
              <Kpi
                label="데이트한 날짜"
                value={`${uniqueDateDays}일`}
                sub={`총 ${totalDaysSpan}일 중 ${totalDaysSpan > 0 ? Math.round((uniqueDateDays / totalDaysSpan) * 100) : 0}%`}
                color="#e94560"
                info="중복 제외 고유 날짜 수. 하루에 여러 건이어도 1일로 카운트"
              />
            </Card>
            <Card accent>
              <Kpi
                label="주평균"
                value={`${datesPerWeek.toFixed(2)}일`}
                sub={`월평균 ${datesPerMonth.toFixed(1)}일`}
                color="#f0c040"
                info="(데이트한 날짜 / 총 일수) × 7"
              />
            </Card>
            <Card accent>
              <Kpi
                label="최장 공백"
                value={`${longestGap}일`}
                sub="데이트 사이 최장 간격"
                color={longestGap > 30 ? "#e94560" : longestGap > 14 ? "#f0c040" : "#48c9b0"}
                info="연속된 데이트 날짜 사이 최대 간격. 30일 초과면 주의 신호"
              />
            </Card>
            <Card accent>
              <Kpi
                label="마지막 데이트"
                value={daysSinceLast == null ? "-" : `${daysSinceLast}일 전`}
                sub={daysSinceLast == null ? "-" : daysSinceLast === 0 ? "오늘" : daysSinceLast === 1 ? "어제" : ""}
                color={daysSinceLast == null ? "#999" : daysSinceLast > 14 ? "#e94560" : daysSinceLast > 7 ? "#f0c040" : "#48c9b0"}
                info="오늘과 마지막 데이트 날짜 사이의 일수"
              />
            </Card>

            <Card title="요일별 데이트 지출" span={2}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dowData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: ValueType | undefined, _n, p) => [W(Number(v ?? 0)), `${p.payload.건수}건`]} />
                  <Bar dataKey="금액" radius={[6, 6, 0, 0]}>
                    {dowData.map((e, i) => <Cell key={i} fill={e.금액 === Math.max(...dowData.map((x) => x.금액)) ? "#e94560" : "#0f3460"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
                {(() => { const best = dowData.reduce((m, cur) => cur.금액 > m.금액 ? cur : m, dowData[0]); return best.금액 > 0 ? `${best.name}요일에 가장 많이 지출 (${best.건수}건)` : ""; })()}
              </div>
            </Card>

            <Card title="건당 평균 추이 (월별)" span={2}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={avgPerTxTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                  <Line type="monotone" dataKey="건당평균" stroke="#e94560" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
                월별 총액 / 건수. 상승 추세면 건당 지출이 커지는 중
              </div>
            </Card>
          </Section>

          {/* ============ 구성·상세 ============ */}
          <Section storageKey="date-section-breakdown" title="🔍 구성·상세">
            <Card title="지출처 TOP 20" span={2}>
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                {d.dateTop.map(([name, value], i) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{name}</span>
                    <span style={{ fontWeight: 700, color: "#e94560" }}>{F(value)}원</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="🎁 단일 건 TOP 10 (기념일 감지)" span={2}>
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                {bigSingles.map((e, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.desc || "(설명 없음)"}</div>
                      <div style={{ fontSize: 10, color: "#999" }}>{e.date} · {e.sub || "-"}</div>
                    </div>
                    <span style={{ fontWeight: 700, color: "#e94560" }}>{F(e.amount)}원</span>
                  </div>
                ))}
                {bigSingles.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#999" }}>데이터 없음</div>}
              </div>
            </Card>

            {d.dateByDetail.length > 1 && (
              <Card title="소분류별 데이트 지출" span={2}>
                <div style={{ maxHeight: 300, overflow: "auto" }}>
                  {d.dateByDetail.map(([name, value], i) => {
                    const dtTotal = d.dateByDetail.reduce((s, [, v]) => s + v, 0);
                    return (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />{name}
                        </span>
                        <span style={{ fontWeight: 700 }}>{F(value)}원 <span style={{ fontSize: 10, color: "#999" }}>({dtTotal > 0 ? Math.round((value / dtTotal) * 100) : 0}%)</span></span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card title="데이트 내역 상세 (최근 30건)" span={2}>
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
                      <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(e.amount)}원</td>
                    </tr>
                  ))}</tbody>
                </table>
                {d.dateEntries.length > 30 && <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>+{d.dateEntries.length - 30}건 더</div>}
              </div>
            </Card>
          </Section>

          {/* ============ 추이·비중 ============ */}
          <Section storageKey="date-section-trends" title="📈 추이·비중">
            <Card title="누적 데이트 지출" span={2}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={cumDate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                  <Line type="monotone" dataKey="누적" stroke="#e94560" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="전체 지출 대비 데이트비 비율 (%)" span={2}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dateVsTotal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: ValueType | undefined) => v + "%"} />
                  <Bar dataKey="비율" fill="#e94560" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
                월별 (데이트 지출 / 월 총지출) × 100
              </div>
            </Card>
          </Section>

          {/* ============ 인사이트 ============ */}
          <Section storageKey="date-section-insights" title="💡 인사이트">
            <Card title="데이트비 종합 인사이트" span={4}>
              <div className="grid-2" style={{ gap: 12 }}>
                <Insight title="지출처 분석" color="#e94560" bg="#fff5f5">
                  {d.dateTop.length > 0 ? `최다 지출처: ${d.dateTop[0][0]}에 총 ${F(d.dateTop[0][1])}원 (전체의 ${total > 0 ? Math.round((d.dateTop[0][1] / total) * 100) : 0}%).` : "데이터 없음"}
                  {d.dateTop.length > 1 ? ` 2위 ${d.dateTop[1][0]}(${F(d.dateTop[1][1])}원)${d.dateTop.length > 2 ? `, 3위 ${d.dateTop[2][0]}(${F(d.dateTop[2][1])}원)` : ""}.` : ""}
                  {d.dateTop.length > 3 ? ` 상위 3곳이 ${total > 0 ? Math.round((d.dateTop[0][1] + d.dateTop[1][1] + (d.dateTop[2]?.[1] ?? 0)) / total * 100) : 0}% 차지.` : ""}
                </Insight>
                <Insight title="모임통장 활용" color="#2ecc71" bg="#f5fff5">
                  {splitTotal > 0 ? `모임통장 ${F(d.dateMoim)}원 (${moimPct}%), 개인 ${F(d.datePersonal)}원 (${100 - moimPct}%). ${moimPct >= 50 ? "모임통장 적극 활용 중 — 분담이 잘 되고 있습니다." : moimPct >= 30 ? "활용도 적당. 더 늘리면 개인 부담이 줄어듭니다." : "개인 결제 비중이 높음. 공동 지출을 모임통장으로 돌리면 정산·관리가 편해집니다."}` : "모임통장 사용 내역 없음. 모임통장을 만들면 데이트 비용 관리가 편해집니다."}
                </Insight>
                <Insight title="데이트 빈도" color="#b45309" bg="#fff3cd">
                  {uniqueDateDays > 0 ? `${d.months.length}개월 동안 ${uniqueDateDays}회 데이트 (주평균 ${datesPerWeek.toFixed(2)}회). ${daysSinceLast != null && daysSinceLast > 14 ? `⚠️ 마지막 데이트 ${daysSinceLast}일 전 — 한동안 공백이 있었습니다.` : daysSinceLast != null && daysSinceLast <= 7 ? "최근에 데이트 — 꾸준히 만나는 중!" : ""} 최장 공백 ${longestGap}일.` : "기록 없음"}
                </Insight>
                <Insight title="데이트 비중" color="#533483" bg="rgba(83,52,131,0.08)">
                  {d.pExpense > 0 ? `전체 지출의 ${Math.round((total / d.pExpense) * 100)}%가 데이트. ${total / d.pExpense > 0.15 ? "비중이 높은 편입니다. 가성비 데이트 고려." : total / d.pExpense > 0.05 ? "적정 수준." : "알뜰 수준."} 월평균 ${F(Math.round(avgPerPeriodMonth))}원 · 건당 ${F(avgPerTx)}원.` : ""}
                </Insight>
              </div>
            </Card>

            {d.dateSubInsights.length > 0 && (
              <Card title="중분류별 데이트 상세 인사이트" span={4}>
                <div className="grid-2" style={{ gap: 10 }}>
                  {d.dateSubInsights.map((s, i) => (
                    <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fcc", fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                          {s.sub}
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}원</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                        <span>비중 {s.share}%</span>
                        <span>{s.count}건</span>
                        <span>건당 {F(s.avg)}원</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                        {s.comment}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title="데이트 활동 요약" span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, fontSize: 12 }}>
                {[
                  { label: "최대 지출월", value: maxMonth.name ? `${maxMonth.name} (${F(maxMonth.금액)}원)` : "-", color: "#e94560" },
                  { label: "최소 지출월", value: minMonth.name ? `${minMonth.name} (${F(minMonth.금액)}원)` : "-", color: "#48c9b0" },
                  { label: "단일 최고", value: bigSingles[0] ? `${bigSingles[0].date} (${F(bigSingles[0].amount)}원)` : "-", color: "#f0c040" },
                  { label: "활성 월 수", value: `${monthsActive} / ${d.months.length}개월`, color: "#533483" },
                ].map((s) => (
                  <div key={s.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8 }}>
                    <div style={{ color: "#999", fontSize: 11, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Section>
        </>
      )}
    </div>
  );
});
