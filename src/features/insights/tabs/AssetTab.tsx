import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, Insight, Section, pieLabel, type D } from "../insightsShared";
import { useAppStore } from "../../../store/appStore";
import type { BalanceSheet } from "../../../calculations";
import { BalanceSheetStrip } from "../../../components/BalanceSheetStrip";
import { formatGoalProjectionLine, projectGoal } from "../../../utils/goalProjection";
import { FireSimulatorCard } from "../FireSimulatorCard";

export const AssetTab = React.memo(function AssetTab({ d, bs }: { d: D; bs: BalanceSheet }) {
  const goals = useAppStore((s) => s.data.investmentGoals);

  const nw = d.netWorthByMonth;
  // 현재 순자산 = 대차 단일 소스(계좌 탭·대시보드와 같은 숫자). 타임라인 마지막 행(현재 월)과 같은 식이라 추이와도 이어진다.
  const current = bs.netWorth;
  const first = nw.length > 0 ? nw[0].total : 0;
  // 시작 순자산이 0 이하(부채 > 자산으로 출발)면 비율 성장이 정의되지 않음 — 증가액으로 표시
  const growthAbs = current - first;
  const growthPct = first > 0 ? Math.round((current / first - 1) * 100) : null;
  const maxNW = nw.length > 0 ? Math.max(...nw.map((n) => n.total)) : 0;
  const minNW = nw.length > 0 ? Math.min(...nw.map((n) => n.total)) : 0;
  const monthlyGrowth = nw.length >= 2 ? Math.round((current - first) / (nw.length - 1)) : 0;

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
  const goalSeries = React.useMemo(() => nw.map((n) => ({ month: n.month, value: n.total })), [nw]);
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
            sub={`시작 ${F(first)}원 → 현재 ${F(current)}원${first <= 0 && current > 0 ? " · 순부채에서 순자산으로 전환" : ""}`}
            color={growthAbs >= 0 ? "var(--success)" : "var(--danger)"}
            info="추적 시작 월 대비. 시작 순자산이 0 이하(부채로 출발)면 비율이 정의되지 않아 증가액으로 표시"
          />
        </Card>
        <Card accent>
          <Kpi
            label="목표 달성률"
            value={targetProgress == null ? "–" : targetProgress.toFixed(1) + "%"}
            sub={target ? `목표 ${F(target)}원` : "목표 미설정"}
            color={targetProgress == null ? "var(--text-faint)" : targetProgress >= 100 ? "var(--success)" : targetProgress >= 50 ? "var(--warning)" : "var(--accent)"}
            info="투자 요약의 최종 순자산 목표 대비 현재 순자산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="월평균 순자산 증가"
            value={F(monthlyGrowth) + "원"}
            sub={`추적 기간 ${nw.length}개월 평균`}
            color={monthlyGrowth >= 0 ? "var(--success)" : "var(--danger)"}
            info="(최근 순자산 − 시작 순자산) / 기간 개월 수"
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
                      {formatGoalProjectionLine(eta6, (n) => F(n) + "원")}
                    </div>
                    {eta12 && eta12.windowMonths > eta6.windowMonths && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        12개월 페이스 기준: {formatGoalProjectionLine(eta12, (n) => F(n) + "원")}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  현재 월 순자산 증가 페이스 {F(monthlyGrowth)}원/월 (추적 전체 평균) · ETA는 최근 페이스가 유지된다는 가정의 단순 투영
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
            color={liquidPct >= 20 ? "var(--success)" : liquidPct >= 10 ? "var(--warning)" : "var(--danger)"}
            info="입출금 + 저축 계좌 / 총자산. 20% 이상이면 유동성 여유, 10% 미만이면 위험"
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
                <YAxis tickFormatter={F} tick={{ fontSize: 11 }} domain={[Math.max(0, minNW * 0.9), maxNW * 1.05]} />
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
              const items: { label: string; pass: boolean; hint: string }[] = [
                { label: "순자산 플러스", pass: current > 0, hint: "빚이 자산보다 많지 않음" },
                { label: "유동성 ≥ 10%", pass: liquidPct >= 10, hint: "비상자금 최소 확보 (현금성 자산)" },
                { label: "자산 다각화 (실효 2개 이상)", pass: effectiveCategories >= 2, hint: "한 유형에만 쏠려있지 않음" },
                { label: "최근 3개월 순자산 증가", pass: nw.length >= 4 && nw[nw.length - 1].total > nw[nw.length - 4].total, hint: "최근 추세가 상승세" },
                { label: "목표 달성률 > 0%", pass: (targetProgress ?? 0) > 0, hint: "목표 설정 + 진행 중" },
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
                const trend3 = last3.length >= 2 ? last3[last3.length - 1].total - last3[0].total : 0;
                if (trend3 > 0) return `최근 3개월 동안 ${F(trend3)}원 증가 추세입니다. 이 속도로 ${monthlyGrowth > 0 ? `연간 ${F(monthlyGrowth * 12)}원 자산 형성 예상` : ""}.`;
                if (trend3 < 0) return `최근 3개월 동안 ${F(Math.abs(trend3))}원 감소했습니다. 지출 점검·수입 증대가 필요합니다.`;
                return "최근 3개월간 순자산이 거의 변동 없습니다. 저축률 점검을 권장합니다.";
              })() : "추적 기간이 2개월 미만입니다."}
            </Insight>
            <Insight title="부채 건강도" tone={totalDebt > totalAssets * 0.5 ? "danger" : "info"}>
              총 부채 {F(totalDebt)}원 (자산 대비 {totalAssets > 0 ? Math.round((totalDebt / totalAssets) * 100) : 0}%).
              {totalDebt === 0 ? " 부채 없음 — 안정적." :
                totalDebt > totalAssets * 0.5 ? ` 부채 비중 50% 초과 — 상환 계획 필요.` :
                totalDebt > totalAssets * 0.2 ? ` 부채 비중 20-50% — 적정 관리 필요.` :
                ` 부채 비중 20% 이내 — 건강한 수준.`}
              {bs.loanDebt > 0 && ` 대출 잔금 ${F(bs.loanDebt)}원은 원금 상환 시 차감됨.`}
            </Insight>
            <Insight title="자산 배분" tone="warning">
              {d.assetAllocation.length >= 2 ? (() => {
                const top = d.assetAllocation[0];
                const share = totalAssets > 0 ? Math.round((top.value / totalAssets) * 100) : 0;
                return `자산의 ${share}%가 ${top.name}에 집중. ${share > 70 ? "한 곳에 쏠림 — 분산 투자 고려." : share > 40 ? "주력 자산 유형이 명확." : "비교적 분산되어 있음."}`;
              })() : "자산 유형이 단일합니다. 분산 필요."}
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
