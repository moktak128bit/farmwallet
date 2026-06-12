import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { F, W, Card, Kpi, Insight, Section, CT, type D } from "../insightsShared";
import { getThisMonthKST } from "../../../utils/date";

const CATEGORY_PATTERNS: { label: string; color: string; regex: RegExp }[] = [
  { label: "AI/생산성", color: "#e94560", regex: /chatgpt|claude|cursor|\bai\b|gpt|copilot|notion|slack|figma/i },
  { label: "영상/엔터", color: "#0f3460", regex: /유튜브|넷플릭스|왓챠|디즈니|웨이브|티빙|애플tv|apple\s?tv|프리미엄/i },
  { label: "커머스/배송", color: "#48c9b0", regex: /쿠팡|로켓|네이버플러스|멤버십|ssg|마켓컬리|오아시스/i },
  { label: "음악", color: "#9b59b6", regex: /멜론|지니|플로|스포티파이|애플뮤직|유튜브\s?뮤직|bugs/i },
  { label: "클라우드/저장소", color: "#3498db", regex: /icloud|google\s?one|dropbox|onedrive|mega|아이클라우드/i },
  { label: "독서/학습", color: "#f39c12", regex: /밀리|리디|윌라|교보|yes24|인프런|유데미|udemy/i },
  { label: "운동/건강", color: "#2ecc71", regex: /헬스|필라테스|요가|짐|피트니스|런데이|gym/i },
];

export const SubTab = React.memo(function SubTab({ d }: { d: D }) {
  const subs = d.subs;
  const totalMonthly = subs.reduce((a, s) => a + s.avg, 0);
  const totalAnnual = totalMonthly * 12;
  const totalSubsSum = subs.reduce((a, s) => a + s.total, 0);
  const subPctIncome = d.pIncome > 0 ? (totalSubsSum / d.pIncome) * 100 : 0;
  const costPerDay = totalMonthly > 0 ? Math.round(totalMonthly / 30) : 0;

  // 카테고리 분류 (다중 키워드 지원)
  const categorized = CATEGORY_PATTERNS.map((cat) => {
    const items = subs.filter((s) => cat.regex.test(s.name));
    const monthly = items.reduce((sum, s) => sum + s.avg, 0);
    return { ...cat, items, monthly };
  }).filter((c) => c.items.length > 0);
  const uncategorized = subs.filter((s) => !CATEGORY_PATTERNS.some((c) => c.regex.test(s.name)));

  // 상위 3개 집중도 — 월비용 기준
  const topSubs = [...subs].sort((a, b) => b.avg - a.avg).slice(0, 3);
  const top3Monthly = topSubs.reduce((s, x) => s + x.avg, 0);
  const top3Share = totalMonthly > 0 ? (top3Monthly / totalMonthly) * 100 : 0;

  // 신규/해지 구독 감지는 미구현 — subs에 월별 결제 정보가 없어 월간 비교 불가.
  const currentMonth = d.anomalyTargetMonth;
  // 월별 구독비 변화 감지 (이번달 vs 이전달)
  // subTrend는 d.months와 평행 배열 — YYYY-MM 인덱스로 조회 ("6월" 라벨 find는 다른 해와 충돌)
  // 진행 중인 이번 달은 아직 안 빠진 구독이 많아 전월 전체와 비교하면 항상 "급감" — MoM 표시를 보류
  const isPartialMonth = currentMonth != null && currentMonth === getThisMonthKST();
  const curIdx = currentMonth ? d.months.indexOf(currentMonth) : -1;
  const curSubAmt = curIdx >= 0 ? d.subTrend[curIdx]?.amount ?? 0 : 0;
  const prevSubAmt = curIdx > 0 ? d.subTrend[curIdx - 1]?.amount ?? 0 : 0;
  const subMoM = !isPartialMonth && prevSubAmt > 0 ? ((curSubAmt - prevSubAmt) / prevSubAmt) * 100 : null;

  // 절약 시나리오
  const savingsIfCutTop3 = top3Monthly * 12;
  const savingsIfCutHalf = totalMonthly * 0.5 * 12;

  if (subs.length === 0) {
    return (
      <Section storageKey="sub-section-empty" title="🔄 구독 관리">
        <div style={{ gridColumn: "span 4", textAlign: "center", padding: "40px 20px", color: "var(--text-faint)" }}>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            구독 데이터가 없습니다. 가계부 항목의 <b>대분류</b> 또는 <b>중분류</b>에 "구독"이 포함되어 있으면 자동 감지됩니다.
          </div>
        </div>
      </Section>
    );
  }

  return (
    <>
          {/* ============ 한눈에 ============ */}
          <Section storageKey="sub-section-overview" title="🔄 구독 한눈에 보기">
            <Card accent><Kpi label="활성 구독 수" value={`${subs.length}개`} sub={`${categorized.length}개 카테고리 + 기타 ${uncategorized.length}`} color="#fff" info="기간 내 한 번 이상 결제된 고유 구독 서비스 수" /></Card>
            <Card accent><Kpi label="월 구독 비용" value={F(totalMonthly) + "원"} sub={`일 ${W(costPerDay)} · ${subMoM != null ? (subMoM >= 0 ? "+" : "") + subMoM.toFixed(0) + "% MoM" : isPartialMonth ? "이번 달 집계 중" : "변화 없음"}`} color="#f0c040" info="Σ(서비스별 기간 평균). 실제 월마다 달라질 수 있음" /></Card>
            <Card accent><Kpi label="연간 구독 비용" value={F(totalAnnual) + "원"} sub={totalAnnual >= 1000000 ? "연 100만원 초과" : "적정"} color="#e94560" info="월 구독비 × 12. 실제 총 소요 예상치" /></Card>
            <Card accent><Kpi label="수입 대비 비율" value={subPctIncome.toFixed(1) + "%"} sub={subPctIncome > 5 ? "⚠ 구독 비중 높음" : "적정 수준"} color={subPctIncome > 5 ? "#e94560" : "#48c9b0"} info="구독 누적 / 총 수입. 5% 이하 권장" /></Card>

            <Card title="월별 구독 지출 추이" span={4}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.subTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="l" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CT />} />
                  <Bar isAnimationActive={false} dataKey="amount" fill="#533483" radius={[4, 4, 0, 0]} name="구독비" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Section>

          {/* ============ 구독 상세 ============ */}
          <Section storageKey="sub-section-details" title="📋 구독 상세" defaultOpen={false}>
            <Card title={`구독 서비스 ${subs.length}개 (월 비용 순)`} span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {[...subs].sort((a, b) => b.avg - a.avg).map(({ name, count, total, avg }, i) => {
                  const cat = CATEGORY_PATTERNS.find((c) => c.regex.test(name));
                  return (
                    <div key={name} style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: `1px solid ${cat ? cat.color + "33" : "var(--border-light)"}`, borderLeft: `3px solid ${cat?.color ?? "var(--border)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
                        <span style={{ fontSize: 11, color: i < 3 ? "#e94560" : "var(--text-faint)", fontWeight: 700 }}>#{i + 1}</span>
                      </div>
                      {cat && <div style={{ fontSize: 10, color: cat.color, marginTop: 2, fontWeight: 600 }}>{cat.label}</div>}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                        <span>월 ~{W(avg)}</span>
                        <span>{count}회</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#e94560", fontWeight: 600, marginTop: 4 }}>누적 {W(total)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {categorized.length > 0 && (
              <Card title="카테고리 분류" span={2}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  {categorized.map((g) => (
                    <div key={g.label} style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, borderLeft: `4px solid ${g.color}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 700, color: g.color }}>{g.label}</span>
                        <span style={{ fontWeight: 700 }}>월 {W(g.monthly)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        {g.items.length}개 · {g.items.map((s) => s.name).join(", ")}
                      </div>
                    </div>
                  ))}
                  {uncategorized.length > 0 && (
                    <div style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, borderLeft: "4px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 700, color: "var(--text-muted)" }}>기타 (미분류)</span>
                        <span style={{ fontWeight: 700 }}>월 {W(uncategorized.reduce((s, x) => s + x.avg, 0))}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                        {uncategorized.length}개 · {uncategorized.map((s) => s.name).join(", ")}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Card title="집중도·절약 시나리오" span={2}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                <div style={{ padding: "10px 12px", background: "var(--accent-light)", borderRadius: 8, borderLeft: "4px solid var(--accent)" }}>
                  <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>상위 3개 집중도</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{top3Share.toFixed(0)}%</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {topSubs.map((s) => s.name).join(" · ")} · 월 {W(top3Monthly)}
                  </div>
                </div>
                <div style={{ padding: "10px 12px", background: "var(--primary-light)", borderRadius: 8, borderLeft: "4px solid var(--success)" }}>
                  <div style={{ fontWeight: 700, color: "var(--success)", marginBottom: 4 }}>💡 절약 시나리오</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    상위 3개 해지 시 연 <strong>{W(savingsIfCutTop3)}</strong> 절약<br />
                    전체 구독 50% 정리 시 연 <strong>{W(Math.round(savingsIfCutHalf))}</strong> 절약
                  </div>
                </div>
                <div style={{ padding: "10px 12px", background: "var(--danger-light)", borderRadius: 8, borderLeft: "4px solid var(--danger)" }}>
                  <div style={{ fontWeight: 700, color: "var(--danger)", marginBottom: 4 }}>일·주·월 환산</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    일 {W(costPerDay)} · 주 {W(costPerDay * 7)} · 월 {W(totalMonthly)}<br />
                    {costPerDay > 3000 ? "☕ 하루 커피 한 잔 이상 구독에 지출 중" : "☕ 하루 커피 한 잔 미만"}
                  </div>
                </div>
              </div>
            </Card>
          </Section>

          {/* ============ 최적화 제안 ============ */}
          <Section storageKey="sub-section-optimization" title="💡 구독 최적화 제안" defaultOpen={false}>
            <Card title="카테고리별 점검" span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {categorized.filter((g) => g.items.length > 1).map((g) => (
                  <Insight key={g.label} title={`${g.label} 중복 점검`} color={g.color} bg={g.color + "15"}>
                    <strong>{g.items.map((s) => `${s.name}(${F(s.avg)}원)`).join(" + ")}</strong>
                    <br />합계 월 {F(g.monthly)}원. 모두 필요한지, 하나로 통합 가능한지 점검.
                  </Insight>
                ))}
                {categorized.filter((g) => g.items.length > 1).length === 0 && (
                  <Insight title="카테고리 중복 없음" tone="success">
                    같은 카테고리 내 중복 구독이 없습니다. 효율적으로 관리하고 있어요!
                  </Insight>
                )}
                <Insight title="비용 대비 가치" color="#7c3aed" bg="rgba(139,92,246,0.08)">
                  연간 {F(totalAnnual)}원 지출.
                  {totalAnnual > 1000000 ? " 100만원 초과 — 미사용 구독 정리 시 큰 절감." :
                    totalAnnual > 500000 ? " 50~100만원 수준 — 상위 구독 사용 빈도 점검 권장." :
                    " 적정 수준 — 관리 잘 되고 있음."}
                  {" "}수입 대비 {subPctIncome.toFixed(1)}%.
                </Insight>
                <Insight title="집중도 경고" tone="warning">
                  {top3Share >= 70
                    ? `상위 3개(${topSubs.map((s) => s.name).join(", ")})가 ${top3Share.toFixed(0)}% 차지 — 이 3개가 핵심. 필요성 재검토 시 큰 절약 가능.`
                    : `상위 3개가 ${top3Share.toFixed(0)}% — 비교적 분산되어 있음. 작은 구독들을 일괄 정리하는 것도 방법.`}
                </Insight>
                {subMoM != null && Math.abs(subMoM) >= 20 && (
                  <Insight title={subMoM > 0 ? "⚠️ 구독비 급증" : "✅ 구독비 감소"} tone={subMoM > 0 ? "danger" : "success"}>
                    전월 대비 <strong>{subMoM >= 0 ? "+" : ""}{subMoM.toFixed(0)}%</strong>
                    ({W(prevSubAmt)} → {W(curSubAmt)}).
                    {subMoM > 0 ? " 새로 시작한 구독이 있는지 확인하세요." : " 해지·일시 결제 없는 달일 수 있음."}
                  </Insight>
                )}
              </div>
            </Card>
          </Section>
    </>
  );
});
