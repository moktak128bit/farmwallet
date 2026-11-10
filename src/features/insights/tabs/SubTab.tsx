import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { F, W, Card, Kpi, Insight, Section, CT, type D } from "../insightsShared";
import { getThisMonthKST, getTodayKST } from "../../../utils/date";
import { useAppStore } from "../../../store/appStore";
import { useFxRateValue } from "../../../context/FxRateContext";
import { detectRecurringCandidates } from "../../../utils/recurringDetection";
import { RecurringCandidateList } from "../../budget/RecurringSuggestionsSection";

const CATEGORY_PATTERNS: { label: string; color: string; regex: RegExp }[] = [
  { label: "AI/생산성", color: "var(--danger)", regex: /chatgpt|claude|cursor|\bai\b|gpt|copilot|notion|slack|figma/i },
  { label: "영상/엔터", color: "var(--chart-series-b)", regex: /유튜브|넷플릭스|왓챠|디즈니|웨이브|티빙|애플tv|apple\s?tv|프리미엄/i },
  { label: "커머스/배송", color: "var(--chart-primary)", regex: /쿠팡|로켓|네이버플러스|멤버십|ssg|마켓컬리|오아시스/i },
  { label: "음악", color: "var(--chart-series-c)", regex: /멜론|지니|플로|스포티파이|애플뮤직|유튜브\s?뮤직|bugs/i },
  { label: "클라우드/저장소", color: "var(--accent)", regex: /icloud|google\s?one|dropbox|onedrive|mega|아이클라우드/i },
  { label: "독서/학습", color: "var(--chart-series-d)", regex: /밀리|리디|윌라|교보|yes24|인프런|유데미|udemy/i },
  { label: "운동/건강", color: "var(--success)", regex: /헬스|필라테스|요가|짐|피트니스|런데이|gym/i },
];

/**
 * 감지된 정기 결제 — 문자열 '구독' 판정과 별개로 가계부 패턴(간격·금액)으로 찾은 후보.
 * 읽기전용: 등록은 예산/반복 지출 탭의 "반복지출로 등록"에서 (폼 prefill, 자동 생성 없음).
 * 데이터는 useAppStore 셀렉터·FxRateContext 직접 — D(필터된 인사이트 데이터)와 독립적으로 최근 12개월 전체를 본다.
 */
const DetectedRecurringSection = React.memo(function DetectedRecurringSection() {
  const ledger = useAppStore((s) => s.data.ledger);
  const recurring = useAppStore((s) => s.data.recurringExpenses);
  const accounts = useAppStore((s) => s.data.accounts);
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const fxRate = useFxRateValue();
  const today = getTodayKST();
  const candidates = React.useMemo(
    () => detectRecurringCandidates(ledger, recurring ?? [], today, { lookbackMonths: 12, fxRate, categoryPresets }),
    [ledger, recurring, today, fxRate, categoryPresets]
  );
  const newCount = candidates.filter((c) => c.status === "new").length;
  const stoppedCount = candidates.filter((c) => c.status === "stopped").length;
  const changedCount = candidates.filter((c) => c.status === "amountChanged").length;
  const unregistered = candidates.filter((c) => !c.alreadyRegistered && c.status !== "stopped").length;
  const summary =
    candidates.length === 0
      ? "감지된 정기 결제 없음"
      : `${candidates.length}개 감지 · 신규 ${newCount} · 금액변경 ${changedCount} · 해지추정 ${stoppedCount} · 미등록 ${unregistered}`;
  return (
    <Section storageKey="sub-section-detected" title="감지된 정기 결제" defaultOpen={candidates.length > 0}>
      <Card title={summary} span={4}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.6 }}>
          최근 12개월 가계부에서 같은 상호·출금계좌로 매주/매월/매년 간격, ±10% 금액으로 3회 이상 반복된 지출입니다.
          '구독' 분류 여부와 무관하게 찾으며, 등록은 <b>예산/반복 지출</b> 탭의 "반복지출로 등록"에서 할 수 있습니다(자동 생성 없음).
        </div>
        <RecurringCandidateList candidates={candidates} accounts={accounts} />
      </Card>
    </Section>
  );
});

export const SubTab = React.memo(function SubTab({ d }: { d: D }) {
  const subs = d.subs;
  // 월 비용 = 최근 완료 12개월 실제 결제 합 ÷ 개월 수 (slice subMonthly). 서비스별 건당 평균을 더하면
  // 해지·일회성 결제까지 매달 내는 것처럼 잡혀 실장부에서 월 118만(실제 25.6만)이 나왔다.
  const totalMonthly = d.subMonthly;
  const totalAnnual = totalMonthly * 12;
  const activeSubs = subs.filter((s) => s.active);
  const stoppedSubs = subs.filter((s) => !s.active);
  const totalSubsSum = subs.reduce((a, s) => a + s.total, 0);
  const subPctIncome = d.pIncome > 0 ? (totalSubsSum / d.pIncome) * 100 : 0;
  const costPerDay = totalMonthly > 0 ? Math.round(totalMonthly / 30) : 0;
  const windowLabel = d.subWindow ? `${d.subWindow.start.replace("-", ".")}~${d.subWindow.end.replace("-", ".")} ${d.subWindow.months}개월` : "최근 완료월 없음";

  // 카테고리 분류 (다중 키워드 지원) — 지금 결제 중인 서비스만, 월 비용은 최근 12개월 평균
  const categorized = CATEGORY_PATTERNS.map((cat) => {
    const items = activeSubs.filter((s) => cat.regex.test(s.name));
    const monthly = items.reduce((sum, s) => sum + s.monthly, 0);
    return { ...cat, items, monthly };
  }).filter((c) => c.items.length > 0);
  const uncategorized = activeSubs.filter((s) => !CATEGORY_PATTERNS.some((c) => c.regex.test(s.name)));

  // 상위 3개 집중도 — 지금 결제 중인 서비스의 월비용 기준
  const topSubs = [...activeSubs].sort((a, b) => b.monthly - a.monthly).slice(0, 3);
  const top3Monthly = topSubs.reduce((s, x) => s + x.monthly, 0);
  const top3Share = totalMonthly > 0 ? (top3Monthly / totalMonthly) * 100 : 0;

  // 신규/해지/금액변경 감지는 DetectedRecurringSection(utils/recurringDetection, 가계부 패턴 기반)이 담당.
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

  if (subs.length === 0) {
    return (
      <>
        <Section storageKey="sub-section-empty" title="구독 관리">
          <div style={{ gridColumn: "span 4", textAlign: "center", padding: "40px 20px", color: "var(--text-faint)" }}>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              구독 데이터가 없습니다. 가계부 항목의 <b>대분류</b> 또는 <b>중분류</b>에 "구독"이 포함되어 있으면 자동 감지됩니다.
            </div>
          </div>
        </Section>
        <DetectedRecurringSection />
      </>
    );
  }

  return (
    <>
          {/* ============ 한눈에 ============ */}
          <Section storageKey="sub-section-overview" title="구독 한눈에 보기">
            <Card accent><Kpi label="지금 결제 중인 구독" value={`${activeSubs.length}개`} sub={`기간 내 결제 기록 ${subs.length}개 중 · 끊긴 것 ${stoppedSubs.length}개`} color="var(--text)" info="최근 2개 완료월 또는 이번 달에 결제가 있는 서비스(설명 문구 기준)" /></Card>
            <Card accent><Kpi label="월 구독 비용" value={F(totalMonthly) + "원"} sub={`${windowLabel} 평균 · 일 ${W(costPerDay)}${subMoM != null ? ` · 전월 대비 ${subMoM >= 0 ? "+" : ""}${subMoM.toFixed(0)}%` : isPartialMonth ? " · 이번 달 집계 중" : ""}`} color="var(--text)" info="최근 완료 12개월 구독 결제 합 ÷ 개월 수 (전체 장부, 기간 필터 무관). 해지한 서비스는 결제가 있던 달만 들어간다" /></Card>
            <Card accent><Kpi label="연간 구독 비용" value={F(totalAnnual) + "원"} sub="월 구독 비용 × 12" color="var(--text)" info="최근 12개월 평균이 유지된다는 가정" /></Card>
            <Card accent><Kpi label="수입 대비 비율" value={subPctIncome.toFixed(1) + "%"} sub={`기간 구독 결제 ${F(totalSubsSum)}원 / 장부 수입`} color="var(--text)" info="기간 내 구독 결제 합 / 장부 수입 합" /></Card>

            <Card title="월별 구독 지출 추이" span={4}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.subTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="l" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CT />} />
                  <Bar isAnimationActive={false} dataKey="amount" fill="var(--chart-series-c)" radius={[4, 4, 0, 0]} name="구독비" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Section>

          {/* ============ 감지된 정기 결제 (패턴 기반) ============ */}
          <DetectedRecurringSection />

          {/* ============ 구독 상세 ============ */}
          <Section storageKey="sub-section-details" title="구독 상세" defaultOpen={false}>
            <Card title={`구독 서비스 ${subs.length}개 (지금 결제 중 → 월 비용 순)`} span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {[...subs].sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly).map(({ name, count, total, avg, monthly, lastMonth, active }, i) => {
                  const cat = CATEGORY_PATTERNS.find((c) => c.regex.test(name));
                  return (
                    <div key={name} style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: `1px solid ${cat ? cat.color + "33" : "var(--border-light)"}`, borderLeft: `3px solid ${cat?.color ?? "var(--border)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
                        <span style={{ fontSize: 11, color: i < 3 ? "var(--danger)" : "var(--text-faint)", fontWeight: 700 }}>#{i + 1}</span>
                      </div>
                      {cat && <div style={{ fontSize: 11, color: cat.color, marginTop: 2, fontWeight: 600 }}>{cat.label}</div>}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                        <span>{active ? `월 평균 ${W(monthly)}` : "최근 2개월 결제 없음"}</span>
                        <span>{count}회 · 건당 {W(avg)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        누적 {W(total)}{lastMonth ? ` · 마지막 ${lastMonth.replace("-", ".")}` : ""}
                      </div>
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
                <div style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, borderLeft: "4px solid var(--border)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>상위 3개를 끊는다면</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    최근 12개월 평균 기준 연 <strong>{W(savingsIfCutTop3)}</strong> (계산일 뿐 — 약정·환불 조건은 직접 확인)
                  </div>
                </div>
                {stoppedSubs.length > 0 && (
                  <div style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, borderLeft: "4px solid var(--border)" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>최근 2개월 결제가 없는 서비스</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      {stoppedSubs.map((x) => `${x.name}(마지막 ${x.lastMonth.replace("-", ".")})`).join(" · ")}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </Section>

          {/* ============ 최적화 제안 ============ */}
          <Section storageKey="sub-section-optimization" title="구독 최적화 제안" defaultOpen={false}>
            <Card title="카테고리별 점검" span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {categorized.filter((g) => g.items.length > 1).map((g) => (
                  <Insight key={g.label} title={`${g.label} 중복 점검`} color={g.color} bg={g.color + "15"}>
                    <strong>{g.items.map((s) => `${s.name}(월 ${F(s.monthly)}원)`).join(" + ")}</strong>
                    <br />같은 종류 {g.items.length}개, 합계 월 {F(g.monthly)}원.
                  </Insight>
                ))}
                {subMoM != null && Math.abs(subMoM) >= 20 && (
                  <Insight title={subMoM > 0 ? "구독비 급증" : "구독비 감소"} tone={subMoM > 0 ? "danger" : "success"}>
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
