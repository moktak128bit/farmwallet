import React from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, SD, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";
import { SubTab } from "./SubTab";
import { computeDateAccountUtilization } from "../../../utils/dateAccounting";

const WDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

export const ExpenseTab = React.memo(function ExpenseTab({ d }: { d: D }) {
  const subs = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제");
  const topSub = subs[0];

  const trendCats = d.topCats.filter(c => c !== "신용결제");
  const trendData = d.months.map(m => { const o: Record<string, string | number> = { name: d.ml[m] }; trendCats.forEach(c => { o[c] = d.monthlyCatTrend[m]?.[c] || 0; }); return o; });

  const cats = d.expByCat.filter(([k]) => k !== "신용결제");
  const subCatByCat = new Map<string, { sub: string; amount: number; count: number }[]>();
  for (const s of d.expBySubCat) {
    if (s.cat === "신용결제") continue;
    const arr = subCatByCat.get(s.cat) ?? [];
    arr.push({ sub: s.sub, amount: s.amount, count: s.count });
    subCatByCat.set(s.cat, arr);
  }

  const topDescs = d.expByDesc.filter(x => x.cat !== "신용결제").slice(0, 25);
  const subAvg = subs.slice(0, 10).map(s => ({ name: s.sub, avg: Math.round(SD(s.amount, d.monthSpan)) }));

  // DOM 월 가중치 보정 — 일평균 기준
  const domData = d.spendByDOMAvg.map((v, i) => ({ day: i + 1, 일평균: Math.round(v), 월수: d.domOccurrences[i] }));
  const domAvg = d.spendByDOMAvg.reduce((s, v) => s + v, 0) / 31;

  // 요일별 지출 — 일평균
  const wdData = d.wdSpend.map((w, i) => ({ name: WDAY_LABELS[i], 일평균: w.count > 0 ? Math.round(w.total / w.count) : 0, 건수: w.count, 총액: w.total }));

  // 누적 지출 속도 비교 (velocity 흡수) — 월별 누적 곡선
  const validMonths = d.months.filter((m) => { const c = d.cumSpend[m]; return c && c[30] > 0; });
  const velocityLineData = Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
    const o: Record<string, number> = { day };
    validMonths.forEach((m) => { o[d.ml[m]] = d.cumSpend[m]?.[day - 1] ?? 0; });
    return o;
  });
  const velocityColors = ["#e94560", "#0f3460", "#f0c040", "#533483", "#48c9b0", "#f39c12", "#3498db", "#e74c3c", "#2ecc71"];

  // 월간 지출 변동계수 (CV) — velocity 흡수
  const monthlyTotals = validMonths.map((m) => d.cumSpend[m]?.[30] ?? 0);
  const monthlyMean = monthlyTotals.length > 0 ? monthlyTotals.reduce((s, v) => s + v, 0) / monthlyTotals.length : 0;
  const monthlyStd = monthlyTotals.length > 0 ? Math.sqrt(monthlyTotals.reduce((s, v) => s + Math.pow(v - monthlyMean, 2), 0) / monthlyTotals.length) : 0;
  const monthlyCV = monthlyMean > 0 ? Math.round((monthlyStd / monthlyMean) * 100) : null;

  // 15일 기준선 분석 (텍스트용)
  const midSpend = validMonths.map((m) => ({ m, mid: d.cumSpend[m]?.[14] ?? 0, total: d.cumSpend[m]?.[30] ?? 0 }));

  // 고정 vs 변동 파이
  const fvData = [
    { name: "고정비", value: d.fixedExpense },
    { name: "변동비", value: d.variableExpense },
  ].filter(x => x.value > 0);
  const fvColors = ["#0f3460", "#f39c12"];

  const periodLabel = d.selMonth
    ? d.selMonth
    : (d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-");
  const rangeLabel = d.selMonth ? `1개월 (${d.ml[d.selMonth] ?? d.selMonth})` : `${d.months.length}개월`;

  return (
    <div>
      {/* 상단 기간·단위 배너 */}
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{rangeLabel}</strong> ({periodLabel}) · 단위: <strong>원</strong> · 신용결제·재테크·환전 제외 · 이상치/성장률은 <strong>{d.anomalyTargetMonth ?? "-"}</strong> 기준 최근 3개월 비교
      </div>

      {/* ============ 한눈에 보기 ============ */}
      <Section storageKey="expense-section-overview" title="📊 한눈에 보기">
        <Card title={`중분류 지출 순위 (${d.accumLabel})`} span={2}>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            {subs.slice(0, 20).map((s, i) => (
              <div key={s.sub} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: 11, color: i < 3 ? "#e94560" : "var(--text-faint)", width: 20, textAlign: "right", fontWeight: 700 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.sub} <span style={{ fontSize: 10, color: "var(--text-faint)" }}>({s.cat})</span></div>
                  <div style={{ height: 4, background: "var(--surface-hover)", borderRadius: 2, marginTop: 3 }}>
                    <div style={{ height: 4, background: C[i % 12], borderRadius: 2, width: `${topSub ? s.amount / topSub.amount * 100 : 0}%` }} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e94560" }}>{F(s.amount)}원</div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{s.count}건</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="고정비 vs 변동비" span={2}>
          {fvData.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>데이터 없음</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "center" }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie isAnimationActive={false} data={fvData} dataKey="value" cx="50%" cy="50%" outerRadius={90} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 11 }}>
                    {fvData.map((_, i) => <Cell key={i} fill={fvColors[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ color: "#0f3460", fontWeight: 700 }}>■ 고정비</span>
                  <span style={{ fontWeight: 700 }}>{F(d.fixedExpense)}원</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 0 8px", borderBottom: "1px solid var(--border-light)" }}>
                  {d.pExpense > 0 ? Math.round(SD(d.fixedExpense, d.pExpense) * 100) : 0}% · 보험·통신·구독·월세·대출 등
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ color: "#f39c12", fontWeight: 700 }}>■ 변동비</span>
                  <span style={{ fontWeight: 700 }}>{F(d.variableExpense)}원</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 0" }}>
                  {d.pExpense > 0 ? Math.round(SD(d.variableExpense, d.pExpense) * 100) : 0}% · 나머지 재량 지출
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, padding: "8px 10px", background: "var(--bg)", borderRadius: 6, lineHeight: 1.5 }}>
                  {SD(d.fixedExpense, d.pExpense) > 0.5 ? "고정비 비중 >50%: 재협상·해지 가능 항목 점검 필요" : SD(d.fixedExpense, d.pExpense) > 0.3 ? "균형 잡힌 구조" : "변동비 비중 높음: 예산 관리로 통제 효과 큼"}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card title="🔄 분담 통장 활용률 (데이트)" span={4}>
          {(() => {
            const u = computeDateAccountUtilization({ dateMoim: d.dateMoim, datePersonal: d.datePersonal });
            const span = d.monthSpan;
            if (u.totalDate === 0) {
              return <div style={{ padding: 24, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>데이트성 지출이 없습니다.</div>;
            }
            const ratePct = Math.round(u.utilizationRate * 100);
            const personalPct = 100 - ratePct;
            const rateColor = ratePct >= 80 ? "#059669" : ratePct >= 50 ? "#f59e0b" : "#dc2626";
            const rateLabel = ratePct >= 80 ? "양호" : ratePct >= 50 ? "보통" : "낮음 — 본인 카드 결제 비중이 큼";
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
                {/* 활용률 시각화 */}
                <div style={{ padding: "16px 18px", background: "var(--bg)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>분담 통장 활용률</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: rateColor, lineHeight: 1.1 }}>{ratePct}%</div>
                  <div style={{ fontSize: 12, color: rateColor, fontWeight: 600, marginBottom: 12 }}>{rateLabel}</div>
                  <div style={{ height: 14, background: "var(--border)", borderRadius: 7, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${ratePct}%`, background: "#48c9b0", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                      {ratePct >= 15 ? "분담통장" : ""}
                    </div>
                    <div style={{ width: `${personalPct}%`, background: "#e94560", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                      {personalPct >= 15 ? "본인 카드" : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                    <span>분담통장 {F(Math.round(u.viaSharedAccount))}원</span>
                    <span>본인 카드 {F(Math.round(u.viaPersonal))}원</span>
                  </div>
                </div>

                {/* 잠재 절감액 */}
                <div style={{ padding: "16px 18px", background: u.lostShareSavings > 0 ? "#fef3c7" : "#f0fdf4", borderRadius: 10, border: `1px solid ${u.lostShareSavings > 0 ? "#fde68a" : "#86efac"}` }}>
                  <div style={{ fontSize: 12, color: "#78350f", marginBottom: 4 }}>본인 부담 비교</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>현재 본인 부담</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{F(Math.round(u.currentSelfBurden))}원</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>월 {F(Math.round(u.currentSelfBurden / span))}원</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>100% 활용 시 (50/50)</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#059669" }}>{F(Math.round(u.optimalSelfBurden))}원</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>월 {F(Math.round(u.optimalSelfBurden / span))}원</div>
                    </div>
                  </div>
                  {u.lostShareSavings > 0 && (
                    <div style={{ padding: "10px 12px", background: "#fff", borderRadius: 8, fontSize: 12, color: "#78350f", lineHeight: 1.6 }}>
                      <strong style={{ color: "#dc2626" }}>분담 미활용으로 추가 부담:</strong>{" "}
                      <strong>{F(Math.round(u.lostShareSavings))}원</strong>
                      {" "}(<strong>월 {F(Math.round(u.lostShareSavings / span))}원</strong>)
                      <div style={{ fontSize: 11, color: "#92400e", marginTop: 6 }}>
                        💡 본인 카드 결제 데이트의 절반은 분담통장 카드를 사용했다면 상대가 부담했을 금액입니다.
                        지갑에 분담통장 체크카드를 디폴트로 두면 자동으로 줄어듭니다.
                      </div>
                    </div>
                  )}
                  {u.lostShareSavings === 0 && (
                    <div style={{ padding: "10px 12px", background: "#fff", borderRadius: 8, fontSize: 12, color: "#065f46" }}>
                      ✓ 분담 시스템 100% 가동 중. 추가 손실 없음.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </Card>

        <Card title="📐 가계부 raw vs 실 부담 — 정산·분담 반영" span={4}>
          {(() => {
            const raw = d.pExpense;
            const afterSplit = raw - d.datePartnerShare;          // 모임통장 50% 차감 (= realExpense)
            const afterSettle = afterSplit - d.settlementTotal;    // 정산 income 회수 추가 차감
            const topSingle = d.topTx?.[0];
            const oneOffThreshold = 500000;
            const hasOneOff = topSingle && topSingle.amount >= oneOffThreshold;
            const afterOneOff = hasOneOff ? afterSettle - topSingle.amount : afterSettle;
            const span = d.monthSpan;
            // 텍스트는 CSS 변수 — 하드코딩 다크 텍스트(#0f172a)는 다크모드에서 검정-on-검정이 됨
            const Row: React.FC<{ label: string; sub?: string; value: number; delta?: number; bold?: boolean; bg?: string }> = ({ label, sub, value, delta, bold, bg }) => (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 14px", background: bg ?? "transparent", borderRadius: 8, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: bold ? "var(--text)" : "var(--text-secondary)" }}>{label}</span>
                  {sub && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{sub}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontSize: bold ? 18 : 14, fontWeight: bold ? 800 : 600, color: bold ? "var(--text)" : "var(--text-secondary)" }}>{F(Math.round(value))}원</span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>월 {F(Math.round(value / span))}원</span>
                  {delta != null && delta !== 0 && (
                    <span style={{ fontSize: 11, color: delta < 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                      {delta < 0 ? "−" : "+"}{F(Math.abs(Math.round(delta)))}원
                    </span>
                  )}
                </div>
              </div>
            );
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
                <div>
                  <Row label="① 가계부 raw 지출" sub="신용결제·재테크·환전 제외" value={raw} bg="var(--bg)" />
                  <Row label="② 모임통장 50% (상대 부담)" sub={d.datePartnerShare > 0 ? `데이트 계좌 출금 ${F(Math.round(d.dateAccountSpend))}원의 절반` : "데이트 계좌 미설정 또는 출금 없음"} value={afterSplit} delta={-d.datePartnerShare} bg="var(--primary-light)" />
                  <Row label="③ 정산 income 회수" sub={d.settlementTotal > 0 ? "subCategory에 '정산' 포함된 수입" : "정산 내역 없음"} value={afterSettle} delta={-d.settlementTotal} bg="var(--primary-light)" />
                  {hasOneOff && (
                    <Row
                      label="④ 일회성 큰 단건 제외"
                      sub={`${topSingle.date} ${topSingle.desc || topSingle.sub || "-"} (50만+)`}
                      value={afterOneOff}
                      delta={-topSingle.amount}
                      bg="var(--warning-light)"
                    />
                  )}
                  <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
                  <Row label={hasOneOff ? "💰 일상 실 부담 (정산·분담·일회성 차감)" : "💰 실 부담 (정산·분담 차감)"} value={hasOneOff ? afterOneOff : afterSettle} bold bg="var(--warning-bg)" />
                </div>
                <div style={{ padding: "12px 14px", background: "var(--bg)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>📖 왜 라벨마다 숫자가 다른가요?</div>
                  <div style={{ marginBottom: 6 }}>
                    <strong>① raw</strong>: 가계부에 입력된 그대로의 지출 합. <span style={{ color: "var(--text-faint)" }}>실은 "이 정도 결제했음" 통계.</span>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <strong>② 모임통장 50%</strong>: 데이트 계좌 출금은 상대와 반반 부담이라고 가정 (Settings에서 데이트 계좌 지정 시).
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <strong>③ 정산</strong>: 본인이 결제 후 상대에게서 돌려받은 금액. 수입의 "정산" 카테고리로 잡힘.
                  </div>
                  {hasOneOff && (
                    <div style={{ marginBottom: 6 }}>
                      <strong>④ 일회성</strong>: 50만 이상 단건 1개 (자동차 수리 같은). 평균을 왜곡하므로 별도 표시.
                    </div>
                  )}
                  <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--warning-bg)", borderRadius: 6, color: "var(--text)", fontWeight: 600 }}>
                    💡 "내가 진짜 한 달에 쓴 돈"은 마지막 줄로 보세요.
                  </div>
                </div>
              </div>
            );
          })()}
        </Card>

      </Section>

      {/* ============ 드릴다운 ============ */}
      <Section storageKey="expense-section-drilldown" title="🔍 드릴다운">
        {d.moimFlow.months.length > 0 && d.moimFlow.months.some(m => m.myTransfer + m.partnerDeposit + m.spending > 0) && (
          <Card title="💸 분담 통장 자금 흐름 (월별)" span={4}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", background: "var(--bg)" }}>
                    <th style={{ padding: "10px 8px", textAlign: "left", color: "var(--text-muted)" }}>월</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)" }}>내 이체 →</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)" }}>상대 입금 →</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)" }}>← 결제(데이트)</th>
                    <th style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)" }}>잔액 변화</th>
                    <th style={{ padding: "10px 8px", textAlign: "left", color: "var(--text-muted)" }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {d.moimFlow.months.map((row) => {
                    const anomaly = d.moimFlow.anomalies.find(a => a.month === row.month);
                    const isHighlight = !!anomaly;
                    return (
                      <tr key={row.month} style={{ borderBottom: "1px solid var(--border-light)", background: isHighlight ? "rgba(245,158,11,0.12)" : "transparent" }}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>{d.ml[row.month] ?? row.month}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: "var(--text)" }}>{row.myTransfer > 0 ? F(row.myTransfer) + "원" : "-"}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: anomaly ? "#dc2626" : "var(--text)" }}>
                          {row.partnerDeposit > 0 ? F(row.partnerDeposit) + "원" : "-"}
                          {anomaly && " ⚠"}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", color: "#dc2626" }}>{row.spending > 0 ? F(row.spending) + "원" : "-"}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, color: row.balanceChange >= 0 ? "#059669" : "#dc2626" }}>
                          {row.balanceChange >= 0 ? "+" : ""}{F(row.balanceChange)}원
                        </td>
                        <td style={{ padding: "8px", fontSize: 11, color: "var(--warning)" }}>
                          {anomaly?.message ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg)", fontWeight: 700 }}>
                    <td style={{ padding: "10px 8px" }}>누적</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>{F(d.moimFlow.months.reduce((s,r)=>s+r.myTransfer,0))}원</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>{F(d.moimFlow.months.reduce((s,r)=>s+r.partnerDeposit,0))}원</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>{F(d.moimFlow.months.reduce((s,r)=>s+r.spending,0))}원</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: d.moimFlow.cumBalance >= 0 ? "#059669" : "#dc2626" }}>
                      {d.moimFlow.cumBalance >= 0 ? "+" : ""}{F(d.moimFlow.cumBalance)}원
                    </td>
                    <td style={{ padding: "10px 8px" }}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {d.moimFlow.cumBalance > 0
                ? `누적 잔액 ${F(d.moimFlow.cumBalance)}원이 모임통장에 쌓이고 있습니다 — 입금이 결제보다 많은 상태. 큰 이벤트(여행·기념일) 적립 효과.`
                : d.moimFlow.cumBalance < 0
                  ? `누적 잔액 ${F(d.moimFlow.cumBalance)}원 — 결제가 입금보다 많아 잔액 부족. 곧 본인 카드 backup 결제가 늘어날 수 있습니다.`
                  : `입금과 결제가 거의 균형 — 안정적 운영 중.`}
              {d.moimFlow.anomalies.length > 0 && (
                <span style={{ color: "var(--warning)", fontWeight: 600 }}>
                  {" "}⚠ {d.moimFlow.anomalies.length}개월의 상대 입금이 평균 대비 50% 미만 — 자동이체 누락 가능성 확인.
                </span>
              )}
            </div>
          </Card>
        )}

        <Card title="대분류 → 중분류 상세" span={2}>
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {cats.slice(0, 10).map(([catName, catTotal], ci) => {
              const csubs = subCatByCat.get(catName) ?? [];
              return (
                <div key={catName} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `2px solid ${C[ci % 12]}` }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C[ci % 12] }}>{catName}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#e94560" }}>{F(catTotal)}원</span>
                  </div>
                  {csubs.slice(0, 8).map((s, si) => (
                    <div key={si} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0 4px 16px", borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                      <span style={{ color: "var(--text-secondary)" }}>{s.sub} <span style={{ color: "var(--text-faint)", fontSize: 10 }}>({s.count}건)</span></span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 60, height: 4, background: "var(--surface-hover)", borderRadius: 2 }}>
                          <div style={{ height: 4, background: C[ci % 12], borderRadius: 2, width: `${catTotal > 0 ? s.amount / catTotal * 100 : 0}%`, opacity: 0.7 }} />
                        </div>
                        <span style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}>{F(s.amount)}원</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="지출 내역 TOP 25 (설명)" span={2}>
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {topDescs.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "var(--text-faint)", width: 20, textAlign: "right" }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{item.desc}</div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{item.cat}{item.sub ? ` · ${item.sub}` : ""}</div>
                </div>
                <span style={{ fontWeight: 700, color: "#e94560" }}>{F(item.amount)}원</span>
              </div>
            ))}
            {topDescs.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "var(--text-faint)" }}>데이터 없음</div>}
          </div>
        </Card>

        <Card title={d.selMonth ? `중분류 지출 (${d.ml[d.selMonth] ?? d.selMonth}, Top 10)` : "중분류 월평균 지출 (Top 10)"} span={2}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={subAvg} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis type="number" tickFormatter={F} tick={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              <Bar isAnimationActive={false} dataKey="avg" fill="#533483" radius={[0, 4, 4, 0]} name="월평균 (원)" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="TOP 10 단건 지출" span={2}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid var(--border-light)" }}>
                <th style={{ padding: "8px 6px", textAlign: "left", color: "var(--text-faint)" }}>#</th>
                <th style={{ padding: "8px 6px", textAlign: "left", color: "var(--text-faint)" }}>날짜</th>
                <th style={{ padding: "8px 6px", textAlign: "left", color: "var(--text-faint)" }}>내용</th>
                <th style={{ padding: "8px 6px", textAlign: "left", color: "var(--text-faint)" }}>중분류</th>
                <th style={{ padding: "8px 6px", textAlign: "right", color: "var(--text-faint)" }}>금액</th>
              </tr></thead>
              <tbody>{d.topTx.map((t, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <td style={{ padding: "6px", fontWeight: 700, color: i < 3 ? "#e94560" : "var(--text-faint)" }}>{i + 1}</td>
                  <td style={{ padding: "6px", color: "var(--text-muted)" }}>{t.date}</td>
                  <td style={{ padding: "6px", fontWeight: 500 }}>{t.desc || "-"}</td>
                  <td style={{ padding: "6px", color: "var(--text-muted)" }}>{t.sub || t.cat || "-"}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(t.amount)}원</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </Section>

      {/* ============ 패턴·트렌드 ============ */}
      <Section storageKey="expense-section-patterns" title="📈 패턴·트렌드">
        <Card title="📏 월별 누적 지출 속도 비교" span={3}>
          {validMonths.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={velocityLineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} label={{ value: "일차", position: "insideBottomRight", fontSize: 10 }} />
                <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
                <Tooltip content={<CT />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {validMonths.map((m, i) => (
                  <Line isAnimationActive={false} key={m} type="monotone" dataKey={d.ml[m]} stroke={velocityColors[i % velocityColors.length]} strokeWidth={1.5} dot={false} strokeOpacity={0.7} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            여러 달의 월초부터 월말까지 누적 지출 곡선 — 가파르게 올라가는 달이 소비 급증
          </div>
        </Card>

        <Card title="월간 지출 변동성" span={1}>
          <Kpi
            label="변동계수 (CV)"
            value={monthlyCV != null ? `${monthlyCV}%` : "-"}
            sub={monthlyCV == null ? "데이터 부족" : monthlyCV > 30 ? "변동 큼" : monthlyCV > 15 ? "적정" : "매우 안정"}
            color={monthlyCV == null ? "var(--text-faint)" : monthlyCV > 30 ? "#e94560" : monthlyCV > 15 ? "#f0c040" : "#48c9b0"}
            info="월별 총지출의 표준편차 / 평균 × 100. 낮을수록 예측 가능한 패턴"
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.6, padding: "8px 10px", background: "var(--bg)", borderRadius: 6 }}>
            {monthlyCV == null ? "2개월 이상 데이터가 필요합니다." :
              monthlyCV > 30 ? "월별 지출 편차 큼. 고정/변동비 분리로 변동비 통제 필요." :
              monthlyCV > 15 ? "월별 지출이 대체로 일정한 패턴." :
              "매우 안정적인 지출 패턴 — 예산 관리 우수."}
            {midSpend.length >= 2 && (() => {
              const avgMidRatio = midSpend.reduce((s, x) => s + (x.total > 0 ? x.mid / x.total : 0), 0) / midSpend.length;
              return ` 15일차 평균 ${(avgMidRatio * 100).toFixed(0)}% 소진.`;
            })()}
          </div>
        </Card>

        <Card title="월별 대분류 트렌드 (stacked)" span={4}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip content={<CT />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {trendCats.map((c, i) => <Area isAnimationActive={false} key={c} type="monotone" dataKey={c} stackId="1" stroke={C[i]} fill={C[i]} fillOpacity={0.6} />)}
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="요일별 지출 (일평균, 원)" span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={wdData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: ValueType | undefined, _n, p) => [W(Number(v ?? 0)), `${p.payload.건수}건 · 총 ${W(p.payload.총액)}`]} />
              <Bar isAnimationActive={false} dataKey="일평균" radius={[4, 4, 0, 0]}>
                {wdData.map((e, i) => <Cell key={i} fill={i >= 5 ? "#e94560" : "#0f3460"} opacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, textAlign: "center" }}>
            토·일(빨강) vs 평일(파랑). 해당 요일 총 지출 / 발생일수.
          </div>
        </Card>

        <Card title="일자별 지출 패턴 (1~31일, 일평균)" span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={domData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={2} />
              <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: ValueType | undefined, _n, p) => [W(Number(v ?? 0)), `${p.payload.월수}개월 평균`]}
              />
              <Bar isAnimationActive={false} dataKey="일평균" radius={[2, 2, 0, 0]}>
                {domData.map((e, i) => <Cell key={i} fill={e.일평균 > domAvg * 1.3 ? "#e94560" : "#0f3460"} opacity={0.75} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, textAlign: "center" }}>
            월별 일수 차이 보정(∑지출 / N개월). 붉은색 = 전체 평균 대비 30%↑
          </div>
        </Card>
      </Section>

      {/* ============ 인사이트·이상치 ============ */}
      <Section storageKey="expense-section-insights" title="💡 인사이트·이상치">
        <Card title={`📈 카테고리 성장률 TOP (vs 최근 3개월 ${d.categoryGrowth.partialDay != null ? `동기 1~${d.categoryGrowth.partialDay}일 ` : ""}평균)`} span={2}>
          {d.categoryGrowth.up.length === 0 && d.categoryGrowth.down.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
              비교할 과거 데이터가 부족합니다.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e94560", marginBottom: 6 }}>▲ 가장 많이 늘어남</div>
                {d.categoryGrowth.up.map((r) => (
                  <div key={r.sub} style={{ padding: "6px 10px", background: "var(--danger-light)", borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span>{r.sub}</span>
                      <span style={{ color: "var(--danger)", fontWeight: 800 }}>
                        {r.isNew ? "NEW" : `+${r.pctChange.toFixed(0)}%`}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{F(r.avg3)}원 → {F(r.cur)}원</div>
                  </div>
                ))}
                {d.categoryGrowth.up.length === 0 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>해당 없음</div>}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 6 }}>▼ 가장 많이 줄어듦</div>
                {d.categoryGrowth.down.map((r) => (
                  <div key={r.sub} style={{ padding: "6px 10px", background: "var(--primary-light)", borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span>{r.sub}</span>
                      <span style={{ color: "var(--success)", fontWeight: 800 }}>{r.pctChange.toFixed(0)}%</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{F(r.avg3)}원 → {F(r.cur)}원</div>
                  </div>
                ))}
                {d.categoryGrowth.down.length === 0 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>해당 없음</div>}
              </div>
            </div>
          )}
        </Card>

        <Card title="⚠️ 단건 이상치 TOP 10 (카테고리 평균 대비 z≥2)" span={2}>
          {d.entryOutliers.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
              이상치가 감지되지 않았습니다.
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflow: "auto" }}>
              {d.entryOutliers.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                  <span style={{ padding: "2px 6px", borderRadius: 10, background: Math.abs(e.zScore) >= 3 ? "#e94560" : "#f0c040", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 44, textAlign: "center" }}>
                    z {e.zScore.toFixed(1)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.desc || "(설명 없음)"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{e.date} · {e.sub} (평균 {F(Math.round(e.avg))}원)</div>
                  </div>
                  <span style={{ fontWeight: 700, color: "#e94560" }}>{F(e.amount)}원</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="지출 분석 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 10 }}>
            <Insight title="최다 지출 중분류" tone="danger">
              {topSub ? `${topSub.sub}에 총 ${F(topSub.amount)}원 (${topSub.count}건, 건당 평균 ${F(Math.round(SD(topSub.amount, topSub.count)))}원). ${d.pExpense > 0 ? `전체 지출의 ${Math.round(SD(topSub.amount, d.pExpense) * 100)}%를 차지합니다.` : ""} ${topSub.count > 10 ? "잦은 소비가 누적되고 있습니다. 건수를 줄이는 것만으로도 효과적입니다." : "고단가 지출이 비중을 높이고 있습니다."}` : "데이터 없음"}
            </Insight>
            <Insight title="최다 지출 항목(설명)" tone="info">
              {topDescs.length > 0 ? `${topDescs[0].desc}에 총 ${F(topDescs[0].amount)}원을 사용했습니다 (${topDescs[0].cat} · ${topDescs[0].sub || "기타"}). ${topDescs.length > 1 ? `2위 ${topDescs[1].desc}(${F(topDescs[1].amount)}원), 3위 ${topDescs.length > 2 ? `${topDescs[2].desc}(${F(topDescs[2].amount)}원)` : "없음"}.` : ""}` : "데이터 없음"}
            </Insight>
            <Insight title="요일 패턴" tone="warning">
              {(() => {
                const sorted = [...wdData].sort((a, b) => b.일평균 - a.일평균);
                const top = sorted[0]; const bot = sorted[sorted.length - 1];
                if (!top) return "데이터 없음";
                return `가장 많이 쓰는 요일: ${top.name}요일 (일평균 ${F(top.일평균)}원). 가장 적게 쓰는 요일: ${bot.name}요일 (${F(bot.일평균)}원).`;
              })()}
            </Insight>
            <Insight title="지출 효율성" tone="success">
              {d.pExpense > 0 && d.totalDays > 0 ? `일 평균 ${F(Math.round(d.pExpense / d.totalDays))}원 지출. 총 ${d.expByCat.length}개 대분류, ${subs.length}개 중분류에 분산. ${subs.length > 15 ? "지출처가 많아 관리가 복잡합니다. 통합할 수 있는 항목이 있는지 확인하세요." : subs.length > 8 ? "적당한 수의 카테고리에 분산되어 있습니다." : "소수 카테고리에 집중되어 있어 관리가 용이합니다."}` : "데이터 없음"}
            </Insight>
          </div>
        </Card>

        {d.subInsights.length > 0 && (
          <Card title="중분류별 세부 인사이트" span={4}>
            <div className="grid-2" style={{ gap: 10 }}>
              {d.subInsights.map((s, i) => (
                <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "var(--danger-light)" : s.monthTrend === "down" ? "var(--primary-light)" : "var(--bg)", border: "1px solid var(--border-light)", fontSize: 12, color: "var(--text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {s.sub}
                      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-faint)" }}>{s.cat}</span>
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}원</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                    <span>비중 {s.share}%</span>
                    <span>{s.count}건</span>
                    <span>건당 {F(s.avg)}원</span>
                    <span>월평균 {F(s.monthAvg)}원</span>
                    <span>피크 {s.peak || "-"}</span>
                    <span>최대건 {F(s.maxSingle)}원</span>
                  </div>
                  <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "var(--danger)" : s.monthTrend === "down" ? "var(--success)" : "var(--text-faint)", fontWeight: 600, marginBottom: 4 }}>
                    {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                    {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가!`}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border-light)", paddingTop: 4 }}>
                    {s.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {/* ============ 구독 (흡수: 구독은 반복 지출의 세부) ============ */}
      <SubTab d={d} />
    </div>
  );
});
