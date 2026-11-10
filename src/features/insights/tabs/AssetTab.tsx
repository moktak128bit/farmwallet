import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, Insight, Section, pieLabel, type D } from "../insightsShared";
import { useAppStore } from "../../../store/appStore";
import { computeLoanBalancesById, type BalanceSheet } from "../../../calculations";
import { getTodayKST } from "../../../utils/date";
import { BalanceSheetStrip } from "../../../components/BalanceSheetStrip";
import { formatGoalProjectionLine, projectGoal } from "../../../utils/goalProjection";

/** 이보다 먼 ETA는 투영으로서 의미가 없다 — "범위 밖"으로 표시 */
const ETA_HORIZON_MONTHS = 50 * 12;
type Projection = ReturnType<typeof projectGoal>;
function etaLine(p: Projection): string {
  if (p.status === "projected" && p.monthsToTarget != null && p.monthsToTarget > ETA_HORIZON_MONTHS) {
    const pace = p.monthlyDelta != null ? `월 +${F(Math.round(p.monthlyDelta))}원` : "현재";
    return `최근 ${p.windowMonths}개월 페이스(${pace})로는 50년 안에 닿지 않습니다`;
  }
  return formatGoalProjectionLine(p, (n) => F(n) + "원");
}
const REQUIRED_YEARS = [10, 20, 30] as const;
import { FireSimulatorCard } from "../FireSimulatorCard";

export const AssetTab = React.memo(function AssetTab({ d, bs }: { d: D; bs: BalanceSheet }) {
  const goals = useAppStore((s) => s.data.investmentGoals);
  const loans = useAppStore((s) => s.data.loans);
  const ledger = useAppStore((s) => s.data.ledger);
  // 대출별 잔금·금리·만기 — 부채 문장의 근거 (대차 loanDebt와 같은 computeLoanBalancesById)
  const loanRows = React.useMemo(() => {
    const today = getTodayKST();
    const bal = computeLoanBalancesById(loans, ledger, today);
    return (loans ?? [])
      .map((l) => ({ name: l.loanName || l.institution || "대출", institution: l.institution, remaining: bal.get(l.id) ?? 0, rate: Number(l.annualInterestRate) || 0, maturity: l.maturityDate || "" }))
      .filter((l) => l.remaining > 0)
      .sort((a, b) => b.rate - a.rate || b.remaining - a.remaining);
  }, [loans, ledger]);
  const annualInterest = loanRows.reduce((s, l) => s + l.remaining * l.rate / 100, 0);
  const nearestMaturity = loanRows.filter((l) => l.maturity).sort((a, b) => a.maturity.localeCompare(b.maturity))[0] ?? null;

  const nw = d.netWorthByMonth;
  // 현재 순자산 = 대차 단일 소스(계좌 탭·대시보드와 같은 숫자). 타임라인 마지막 행(현재 월)과 같은 식이라 추이와도 이어진다.
  const current = bs.netWorth;
  const first = nw.length > 0 ? nw[0].total : 0;
  // 시작 순자산이 0 이하(부채 > 자산으로 출발)면 비율 성장이 정의되지 않음 — 증가액으로 표시
  const growthAbs = current - first;
  const growthPct = first > 0 ? Math.round((current / first - 1) * 100) : null;
  // 변화는 같은 기준끼리(changeValue — 원가 평가 구간이 섞이면 전 구간 원가 기준). 과거 점은 원가, 현재 점은 시가로
  // 빼면 보유 종목 평가손익 전체가 "증가"로 몰린다. 시작 + 증가 = 현재를 지키려고 총 증가액(growthAbs)은 그대로 두고
  // 그중 평가손익 몫(valuationPart)을 따로 밝힌다.
  const sameBasisDelta = nw.length >= 2 ? nw[nw.length - 1].changeValue - nw[0].changeValue : 0;
  const valuationPart = nw.length >= 2 ? growthAbs - sameBasisDelta : 0;
  const showValuation = d.netWorthChangeBasis === "cost" && Math.abs(valuationPart) >= 10_000;
  const monthlyGrowth = nw.length >= 2 ? Math.round(sameBasisDelta / (nw.length - 1)) : 0;
  /** i개월 전 대비 같은 기준 변화 */
  const changeOver = (months: number) => (nw.length > months ? nw[nw.length - 1].changeValue - nw[nw.length - 1 - months].changeValue : null);

  // 총 부채/총 자산 — 대차 단일 소스 (마이너스 통장·카드는 부채, 자산에 음수 없음)
  const totalDebt = bs.totalLiabilities;
  const totalAssets = bs.totalAssets;
  const debtParts = [
    bs.loanDebt > 0 ? `대출 ${F(bs.loanDebt)}` : null,
    bs.overdraft > 0 ? `마이너스통장 ${F(bs.overdraft)}` : null,
    bs.cardDebt > 0 ? `카드 ${F(bs.cardDebt)}` : null,
  ].filter(Boolean).join(" · ");

  // 목표 대비 진척률
  const target = goals?.finalTotalAssetTarget ?? null;
  const targetProgress = target && target > 0 ? (current / target) * 100 : null;
  // 목표 ETA — 최근 6/12개월 순자산 페이스 (읽기 전용, 기간 필터 슬라이스 기준이라 범위를 좁히면 '데이터 부족'일 수 있음)
  // 목표 페이스도 같은 기준 시계열 — 마지막 점만 지금 순자산(시가)에 맞춰 평행이동 (대시보드 netWorthSeriesKrw와 같은 방식)
  const goalSeries = React.useMemo(() => {
    if (nw.length === 0) return [];
    const offset = current - nw[nw.length - 1].changeValue;
    return nw.map((n) => ({ month: n.month, value: n.changeValue + offset }));
  }, [nw, current]);
  const eta6 = React.useMemo(() => (target ? projectGoal({ series: goalSeries, target, method: "trailing6" }) : null), [goalSeries, target]);
  const eta12 = React.useMemo(() => (target ? projectGoal({ series: goalSeries, target, method: "trailing12" }) : null), [goalSeries, target]);


  // 자산 집중도 (HHI 기반 실효 자산 카테고리 수) · 현금성 비율 — 분자·분모 모두 배분 합계 기준.
  // 배분은 대차와 같은 규칙(계좌 순가치 양수만)이라 합계 = 총자산이고, 비중 합이 항상 1이 된다.
  const allocTotal = d.assetAllocation.reduce((s, x) => s + x.value, 0);
  const hhi = allocTotal > 0
    ? d.assetAllocation.reduce((s, x) => s + Math.pow(x.value / allocTotal, 2), 0)
    : 0;
  const effectiveCategories = hhi > 0 ? 1 / hhi : 0;

  // 현금성 비율 (입출금 + 저축 계좌)
  const liquidTypes = new Set(["입출금", "저축"]);
  const liquidAssets = d.assetAllocation.filter((a) => liquidTypes.has(a.name)).reduce((s, x) => s + x.value, 0);
  const liquidPct = allocTotal > 0 ? (liquidAssets / allocTotal) * 100 : 0;

  const periodLabel = d.selMonth
    ? d.selMonth
    : (d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-");
  const rangeLabel = d.selMonth ? `1개월 (${d.ml[d.selMonth] ?? d.selMonth})` : `${d.months.length}개월`;

  return (
    <div>
      {/* 상단 배너 */}
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />범위: <strong>{rangeLabel}</strong> ({periodLabel}) · 단위: <strong>원</strong> · 순자산 = 총자산 − 총부채 (계좌 탭·대시보드와 같은 정의).
        월별 추이는 <strong>대시보드 순자산 추이와 동일 계산</strong> (주식 평가액·환율·대출 반영)
      </div>

      {/* ============ 한눈에 ============ */}
      <Section storageKey="asset-section-overview" title="한눈에">
        <div style={{ gridColumn: "span 4" }}>
          <BalanceSheetStrip bs={bs} />
        </div>
        <Card accent>
          <Kpi label="현재 순자산" value={F(current) + "원"} sub={`${nw.length}개월 추적`} color="var(--success)" info="총자산 − 총부채. 계좌 탭·대시보드와 같은 대차 정의" />
        </Card>
        <Card accent>
          <Kpi
            label={growthPct !== null ? "총 성장률" : "순자산 증가액"}
            value={growthPct !== null ? `${growthPct >= 0 ? "+" : ""}${growthPct}%` : `${growthAbs >= 0 ? "+" : "−"}${F(Math.abs(growthAbs))}원`}
            sub={`시작 ${F(first)}원 → 현재 ${F(current)}원${showValuation ? ` · 증가 ${growthAbs >= 0 ? "+" : "−"}${F(Math.abs(growthAbs))}원 중 평가손익 ${valuationPart >= 0 ? "+" : "−"}${F(Math.abs(valuationPart))}원` : ""}${first <= 0 && current > 0 ? " · 순부채에서 순자산으로 전환" : ""}`}
            color={growthAbs >= 0 ? "var(--success)" : "var(--danger)"}
            info="추적 시작 월 대비. 시작 + 증가 = 현재. 지난 월말이 매입원가로 평가된 구간이 있으면 증가액 중 보유 종목 평가손익 몫을 따로 표시. 시작 순자산이 0 이하면 비율 대신 증가액"
          />
        </Card>
        <Card accent>
          <Kpi
            label="목표 달성률"
            value={targetProgress == null ? "–" : targetProgress.toFixed(1) + "%"}
            sub={target ? `목표 ${F(target)}원` : "목표 미설정"}
            color={targetProgress == null ? "var(--text-faint)" : "var(--text)"}
            info="투자 요약의 최종 순자산 목표 대비 현재 순자산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="월평균 순자산 증가"
            value={F(monthlyGrowth) + "원"}
            sub={`추적 기간 ${nw.length}개월 평균${d.netWorthChangeBasis === "cost" ? " · 원가 기준(평가손익 제외)" : ""}`}
            color={monthlyGrowth >= 0 ? "var(--success)" : "var(--danger)"}
            info="같은 기준(지난 월말이 원가 평가면 매입원가 기준) 순자산 변화 ÷ 기간 개월 수 — 평가손익은 빠진다"
          />
        </Card>

        <Card title={target ? `목표 자산 진척 (${F(target)}원)` : "목표 자산 진척"} span={4}>
          {target == null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
              최종 순자산 목표가 설정되지 않았습니다.<br />
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>대시보드 → 투자 요약 카드에서 목표를 설정하면 여기에 진척도가 표시됩니다.</span>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                  {F(current)}원 / {F(target)}원
                </span>
                <span style={{ fontSize: 22, fontWeight: 800, color: (targetProgress ?? 0) >= 100 ? "var(--success)" : "var(--warning)" }}>
                  {(targetProgress ?? 0).toFixed(1)}%
                </span>
              </div>
              <div style={{ height: 14, background: "var(--surface-hover)", borderRadius: 7, overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, targetProgress ?? 0)}%`,
                  background: (targetProgress ?? 0) >= 100
                    ? "var(--success)"
                    : (targetProgress ?? 0) >= 50
                      ? "var(--warning)"
                      : "var(--accent)",
                  transition: "width 0.6s",
                }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, fontSize: 12 }}>
                <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 6 }}>
                  <div style={{ color: "var(--text-faint)", fontSize: 11 }}>잔여 목표</div>
                  <div style={{ fontWeight: 700 }}>{F(Math.max(0, target - current))}원</div>
                </div>
                {eta6 && (
                  <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 6 }}>
                    <div style={{ color: "var(--text-faint)", fontSize: 11 }}>도달 예상 (ETA)</div>
                    <div style={{ fontWeight: 700, color: eta6.status === "projected" || eta6.status === "achieved" ? "var(--text)" : "var(--warning)" }}>
                      {etaLine(eta6)}
                    </div>
                    {eta12 && eta12.windowMonths > eta6.windowMonths && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        12개월 페이스 기준: {etaLine(eta12)}
                      </div>
                    )}
                  </div>
                )}
                {target - current > 0 && (
                  <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 6 }}>
                    <div style={{ color: "var(--text-faint)", fontSize: 11 }}>목표까지 필요한 월 순자산 증가 (수익률 0 가정, 단순 분할)</div>
                    <div style={{ fontWeight: 700 }}>
                      {REQUIRED_YEARS.map((y) => `${y}년 안에: 월 ${F(Math.round((target - current) / (y * 12)))}원`).join(" · ")}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  추적 전체 평균 페이스 {F(monthlyGrowth)}원/월{d.netWorthChangeBasis === "cost" ? " (매입원가 기준 — 평가손익 제외)" : ""} · ETA는 최근 페이스가 유지된다는 가정의 단순 투영
                </div>
              </div>
            </div>
          )}
        </Card>
      </Section>

      {/* ============ 자산 구성 ============ */}
      <Section storageKey="asset-section-composition" title="자산 구성">
        <Card accent>
          <Kpi
            label="총 자산"
            value={F(totalAssets) + "원"}
            sub="빚 빼기 전"
            color="var(--warning)"
            info="계좌별 순가치(잔액 + 평가액 + 달러 환산 − 계좌 부채)가 플러스인 계좌의 합. 마이너스 통장·카드 부채·대출은 총부채로 따로 센다"
          />
        </Card>
        <Card accent>
          <Kpi
            label="총 부채"
            value={F(totalDebt) + "원"}
            sub={debtParts || "부채 없음"}
            color="var(--danger)"
            info="대출 잔금(원금 상환만 차감) + 마이너스 통장 + 카드 부채(지금 갚을 돈)"
          />
        </Card>
        <Card accent>
          <Kpi
            label="현금성 비율"
            value={liquidPct.toFixed(1) + "%"}
            sub={`현금성 자산 ${F(liquidAssets)}원`}
            color="var(--text)"
            info="입출금 + 저축 계좌 / 총자산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="실효 자산 카테고리 수"
            value={effectiveCategories.toFixed(1) + "개"}
            sub={`실제 ${d.assetAllocation.length}개 · HHI 기반`}
            color="var(--chart-series-c)"
            info="1 / Σ(비중²). 같은 비율 N개면 N, 한 유형에 몰릴수록 작음"
          />
        </Card>

        {d.assetAllocation.length > 0 && (
          <Card title="자산 유형별 배분" span={2}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie isAnimationActive={false} data={d.assetAllocation} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 11 }}>
                  {d.assetAllocation.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
                </Pie>
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}

        <Card title="계좌별 잔액" span={2}>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {d.accountBalances.filter((a) => a.balance !== 0).map((a) => (
              <div key={a.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-light)", fontSize: 13 }}>
                <span>{a.name} <span style={{ fontSize: 11, color: "var(--text-faint)" }}>({a.type})</span></span>
                <span style={{ fontWeight: 700, color: a.balance >= 0 ? "var(--text)" : "var(--danger)" }}>{F(a.balance)}원</span>
              </div>
            ))}
            {d.accountBalances.filter((a) => a.balance !== 0).length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>데이터 없음</div>
            )}
          </div>
        </Card>
      </Section>

      {/* ============ 추이 ============ */}
      <Section storageKey="asset-section-trend" title="추이">
        {nw.length >= 2 && (
          <Card title="순자산 추이" span={4}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={nw}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-positive)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--chart-positive)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                {/* 데이터 범위 자동 — 예전 [max(0,min×0.9), max×1.05]는 음수 달을 잘랐고 전부 음수면 [0, 음수]로 뒤집혔다 */}
                <YAxis tickFormatter={F} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                <Area isAnimationActive={false} type="monotone" dataKey="total" stroke="var(--chart-positive)" fill="url(#nwGrad)" strokeWidth={2} name="순자산 추이" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="asset-section-insights" title="인사이트">
        <Card title="자산 건강 체크리스트" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {(() => {
              const shortDebt = bs.overdraft + Math.max(0, bs.cardDebt);
              const monthsCovered = d.avgMonthExp > 0 ? liquidAssets / d.avgMonthExp : null;
              const delta3 = changeOver(3);
              const items: { label: string; pass: boolean; hint: string }[] = [
                { label: "순자산 플러스", pass: current > 0, hint: `총자산 ${F(totalAssets)}원 − 총부채 ${F(totalDebt)}원 = ${F(current)}원` },
                ...(monthsCovered != null ? [{ label: "현금성 자산으로 3개월 생활비", pass: monthsCovered >= 3, hint: `입출금·저축 ${F(liquidAssets)}원 ÷ 월평균 지출 ${F(Math.round(d.avgMonthExp))}원 = ${monthsCovered.toFixed(1)}개월` }] : []),
                ...(shortDebt > 0 ? [{ label: "카드·마이너스 통장을 현금으로 갚을 수 있음", pass: liquidAssets >= shortDebt, hint: `갚을 돈 ${F(shortDebt)}원 · 현금성 자산 ${F(liquidAssets)}원` }] : []),
                ...(delta3 != null ? [{ label: "최근 3개월 순자산 증가", pass: delta3 > 0, hint: `${nw[nw.length - 4].label} → ${nw[nw.length - 1].label} ${delta3 >= 0 ? "+" : "−"}${F(Math.abs(delta3))}원${d.netWorthChangeBasis === "cost" ? " (매입원가 기준)" : " (시세 변동 포함)"}` }] : []),
              ];
              return items.map((it) => (
                <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: it.pass ? "var(--primary-light)" : "var(--danger-light)", borderRadius: 6 }}>
                  {it.pass
                    ? <CheckCircle2 size={18} style={{ color: "var(--success)", flexShrink: 0 }} aria-label="통과" />
                    : <AlertTriangle size={18} style={{ color: "var(--danger)", flexShrink: 0 }} aria-label="주의" />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: it.pass ? "var(--success)" : "var(--danger)" }}>{it.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{it.hint}</div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </Card>

        <Card title="요약" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Insight title="순자산 추세" tone="success">
              {nw.length >= 2 ? (() => {
                const last3 = nw.slice(-3);
                const trend3 = last3.length >= 2 ? last3[last3.length - 1].changeValue - last3[0].changeValue : 0;
                const span = last3.length >= 2 ? `${last3[0].label} → ${last3[last3.length - 1].label}` : "";
                return `${span} ${trend3 >= 0 ? "+" : "−"}${F(Math.abs(trend3))}원 · 추적 ${nw.length}개월 평균 월 ${monthlyGrowth >= 0 ? "+" : "−"}${F(Math.abs(monthlyGrowth))}원. ${d.netWorthChangeBasis === "cost" ? "지난 월말 일부가 매입원가로만 평가돼 있어 보유 종목은 원가 기준으로 비교했습니다(평가손익 제외)." : "주식 평가액·환율 변동이 함께 들어 있습니다."}`;
              })() : "추적 기간이 2개월 미만입니다."}
            </Insight>
            <Insight title="부채 구성" tone={totalDebt > 0 ? "warning" : "info"}>
              {totalDebt === 0 ? "부채가 없습니다." : (
                <>
                  총부채 {F(totalDebt)}원 (총자산의 {totalAssets > 0 ? Math.round((totalDebt / totalAssets) * 100) : 0}%) = {debtParts}.
                  {loanRows.length > 0 && (
                    <>
                      {" "}대출 {loanRows.length}건: {loanRows.map((l) => `${l.name} ${F(l.remaining)}원(연 ${l.rate}%${l.maturity ? `, 만기 ${l.maturity.slice(0, 7)}` : ""})`).join(" · ")}.
                      {annualInterest > 0 && ` 지금 잔금 기준 연 이자 약 ${F(Math.round(annualInterest))}원(월 ${F(Math.round(annualInterest / 12))}원).`}
                      {loanRows[0].rate > 0 && loanRows.length > 1 && ` 금리가 가장 높은 건 ${loanRows[0].name}(${loanRows[0].rate}%).`}
                      {nearestMaturity && ` 가장 가까운 만기 ${nearestMaturity.name} ${nearestMaturity.maturity}.`}
                    </>
                  )}
                </>
              )}
            </Insight>
            <Insight title="자산 배분" tone="info">
              {d.assetAllocation.length >= 1 && totalAssets > 0
                ? d.assetAllocation.slice(0, 3).map((a) => `${a.name} ${Math.round((a.value / allocTotal) * 100)}%(${F(a.value)}원)`).join(" · ") + `. 금액 집중도로 보면 같은 비중 ${effectiveCategories.toFixed(1)}개 유형과 같습니다.`
                : "자산 기록이 없습니다."}
            </Insight>
          </div>
        </Card>
      </Section>

      {/* ============ FIRE ============ */}
      <Section storageKey="asset-section-fire" title="FIRE 시뮬레이터">
        <FireSimulatorCard netWorthKRW={bs.netWorth} />
      </Section>
    </div>
  );
});
