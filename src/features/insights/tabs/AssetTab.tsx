import React from "react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, Insight, Section, pieLabel, type D } from "../insightsShared";
import { useAppStore } from "../../../store/appStore";
import { computeLoanBalanceAt } from "../../../calculations";

export const AssetTab = React.memo(function AssetTab({ d }: { d: D }) {
  const goals = useAppStore((s) => s.data.investmentGoals);
  const loans = useAppStore((s) => s.data.loans ?? []);
  const ledger = useAppStore((s) => s.data.ledger);
  const accounts = useAppStore((s) => s.data.accounts);

  const nw = d.netWorthByMonth;
  const current = nw.length > 0 ? nw[nw.length - 1].total : 0;
  const first = nw.length > 0 ? nw[0].total : 0;
  const growth = first > 0 ? Math.round((current / first - 1) * 100) : 0;
  const maxNW = nw.length > 0 ? Math.max(...nw.map((n) => n.total)) : 0;
  const minNW = nw.length > 0 ? Math.min(...nw.map((n) => n.total)) : 0;
  const monthlyGrowth = nw.length >= 2 ? Math.round((current - first) / (nw.length - 1)) : 0;

  // 부채 합계 (account.debt + 현재 대출 잔금)
  const accountDebtSum = accounts.reduce((s, a) => s + Math.abs(a.debt ?? 0), 0);
  const loanDebtSum = computeLoanBalanceAt(loans, ledger);
  const totalDebt = accountDebtSum + loanDebtSum;

  // 총자산 (부채 추가 전) 근사치 — 순자산 + 부채
  const totalAssets = current + totalDebt;

  // 목표 대비 진척률
  const target = goals?.finalTotalAssetTarget ?? null;
  const targetProgress = target && target > 0 ? (current / target) * 100 : null;

  // 은퇴 목표일까지 남은 개월 (설정 시)
  const retirementDate = goals?.retirementDate ?? null;
  const monthsToRetirement = (() => {
    if (!retirementDate) return null;
    const today = new Date();
    const tgt = new Date(retirementDate);
    const diffMs = tgt.getTime() - today.getTime();
    if (diffMs <= 0) return 0;
    return Math.round(diffMs / (1000 * 60 * 60 * 24 * 30));
  })();

  // 필요 월 저축액 (목표 달성을 위한)
  const requiredMonthlySaving = target && monthsToRetirement && monthsToRetirement > 0
    ? (target - current) / monthsToRetirement
    : null;

  // 자산 집중도 (HHI 기반 실효 자산 카테고리 수)
  const hhi = totalAssets > 0
    ? d.assetAllocation.reduce((s, x) => s + Math.pow(x.value / totalAssets, 2), 0)
    : 0;
  const effectiveCategories = hhi > 0 ? 1 / hhi : 0;

  // 현금성 비율 (입출금 + 저축 계좌)
  const liquidTypes = new Set(["입출금", "저축", "현금"]);
  const liquidAssets = d.assetAllocation.filter((a) => liquidTypes.has(a.name)).reduce((s, x) => s + x.value, 0);
  const liquidPct = totalAssets > 0 ? (liquidAssets / totalAssets) * 100 : 0;

  const periodLabel = d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-";

  return (
    <div>
      {/* 상단 배너 */}
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{d.months.length}개월</strong> ({periodLabel}) · 단위: <strong>원</strong> · 순자산 = 계좌잔액 − account.debt − 대출잔금.
        월별 추이는 <strong>현금 흐름 누적 근사치</strong>이며 주식 평가액·환율 변동은 반영 안 됨 (정확한 트렌드는 대시보드 참조)
      </div>

      {/* ============ 한눈에 ============ */}
      <Section storageKey="asset-section-overview" title="🎯 한눈에">
        <Card accent>
          <Kpi label="현재 순자산" value={F(current) + "원"} sub={`${nw.length}개월 추적`} color="#48c9b0" info="계좌 현재 잔액 − account.debt − 대출 잔금 (주식 평가액 제외)" />
        </Card>
        <Card accent>
          <Kpi label="총 성장률" value={`${growth >= 0 ? "+" : ""}${growth}%`} sub={`시작 ${F(first)}원 → 현재 ${F(current)}원`} color={growth >= 0 ? "#48c9b0" : "#e94560"} info="추적 시작 월 대비 현재 순자산 비율 변화" />
        </Card>
        <Card accent>
          <Kpi
            label="목표 달성률"
            value={targetProgress == null ? "–" : targetProgress.toFixed(1) + "%"}
            sub={target ? `목표 ${F(target)}원` : "목표 미설정"}
            color={targetProgress == null ? "#999" : targetProgress >= 100 ? "#48c9b0" : targetProgress >= 50 ? "#f0c040" : "#3498db"}
            info="투자 요약의 최종 총자산 목표 대비 현재 순자산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="월평균 순자산 증가"
            value={F(monthlyGrowth) + "원"}
            sub={`추적 기간 ${nw.length}개월 평균`}
            color={monthlyGrowth >= 0 ? "#48c9b0" : "#e94560"}
            info="(최근 순자산 − 시작 순자산) / 기간 개월 수"
          />
        </Card>

        <Card title={target ? `🎯 목표 자산 진척 (${F(target)}원)` : "🎯 목표 자산 진척"} span={4}>
          {target == null ? (
            <div style={{ padding: 20, textAlign: "center", color: "#666", fontSize: 13, lineHeight: 1.7 }}>
              최종 총자산 목표가 설정되지 않았습니다.<br />
              <span style={{ fontSize: 11, color: "#999" }}>대시보드 → 투자 요약 카드에서 목표를 설정하면 여기에 진척도가 표시됩니다.</span>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#666" }}>
                  {F(current)}원 / {F(target)}원
                </span>
                <span style={{ fontSize: 22, fontWeight: 800, color: (targetProgress ?? 0) >= 100 ? "#48c9b0" : "#f0c040" }}>
                  {(targetProgress ?? 0).toFixed(1)}%
                </span>
              </div>
              <div style={{ height: 14, background: "#f0f0f0", borderRadius: 7, overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, targetProgress ?? 0)}%`,
                  background: (targetProgress ?? 0) >= 100
                    ? "linear-gradient(90deg, #48c9b0, #10b981)"
                    : (targetProgress ?? 0) >= 50
                      ? "linear-gradient(90deg, #f0c040, #f59e0b)"
                      : "linear-gradient(90deg, #3498db, #2563eb)",
                  transition: "width 0.6s",
                }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, fontSize: 12 }}>
                <div style={{ padding: "8px 10px", background: "#f8f9fa", borderRadius: 6 }}>
                  <div style={{ color: "#999", fontSize: 11 }}>잔여 목표</div>
                  <div style={{ fontWeight: 700 }}>{F(Math.max(0, target - current))}원</div>
                </div>
                {monthsToRetirement != null && (
                  <div style={{ padding: "8px 10px", background: "#f8f9fa", borderRadius: 6 }}>
                    <div style={{ color: "#999", fontSize: 11 }}>은퇴까지</div>
                    <div style={{ fontWeight: 700 }}>{monthsToRetirement}개월</div>
                  </div>
                )}
                {requiredMonthlySaving != null && (
                  <div style={{ padding: "8px 10px", background: monthlyGrowth >= requiredMonthlySaving ? "#f0fdf4" : "#fff5f5", borderRadius: 6 }}>
                    <div style={{ color: "#999", fontSize: 11 }}>필요 월저축</div>
                    <div style={{ fontWeight: 700, color: monthlyGrowth >= requiredMonthlySaving ? "#059669" : "#e94560" }}>
                      {F(Math.round(requiredMonthlySaving))}원
                    </div>
                    <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                      현재 페이스 {F(monthlyGrowth)}원/월
                    </div>
                  </div>
                )}
              </div>
              {requiredMonthlySaving != null && monthlyGrowth > 0 && monthlyGrowth < requiredMonthlySaving && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#e94560", padding: "6px 10px", background: "#fff5f5", borderRadius: 6 }}>
                  ⚠️ 현재 페이스로는 목표 미달. 월 {F(Math.round(requiredMonthlySaving - monthlyGrowth))}원 추가 저축 필요
                </div>
              )}
            </div>
          )}
        </Card>
      </Section>

      {/* ============ 자산 구성 ============ */}
      <Section storageKey="asset-section-composition" title="🏦 자산 구성">
        <Card accent>
          <Kpi
            label="총 자산"
            value={F(totalAssets) + "원"}
            sub="계좌 잔액 합계 (부채 포함)"
            color="#f0c040"
            info="account 잔액 합 — 부채(account.debt)와 대출을 빼기 전 금액"
          />
        </Card>
        <Card accent>
          <Kpi
            label="총 부채"
            value={F(totalDebt) + "원"}
            sub={`신용 ${F(accountDebtSum)}원 + 대출 ${F(loanDebtSum)}원`}
            color="#e94560"
            info="account.debt (신용카드 등) + 대출 잔금 (이자만 내는 동안 loanAmount 그대로)"
          />
        </Card>
        <Card accent>
          <Kpi
            label="현금성 비율"
            value={liquidPct.toFixed(1) + "%"}
            sub={`유동자산 ${F(liquidAssets)}원`}
            color={liquidPct >= 20 ? "#48c9b0" : liquidPct >= 10 ? "#f0c040" : "#e94560"}
            info="입출금+저축+현금 / 총자산. 20% 이상이면 유동성 여유, 10% 미만이면 위험"
          />
        </Card>
        <Card accent>
          <Kpi
            label="실효 자산 카테고리 수"
            value={effectiveCategories.toFixed(1) + "개"}
            sub={`실제 ${d.assetAllocation.length}개 · HHI 기반`}
            color="#533483"
            info="1 / Σ(비중²). 같은 비율 N개면 N, 한 유형에 몰릴수록 작음"
          />
        </Card>

        {d.assetAllocation.length > 0 && (
          <Card title="자산 유형별 배분" span={2}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={d.assetAllocation} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
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
              <div key={a.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                <span>{a.name} <span style={{ fontSize: 10, color: "#999" }}>({a.type})</span></span>
                <span style={{ fontWeight: 700, color: a.balance >= 0 ? "#333" : "#e94560" }}>{F(a.balance)}원</span>
              </div>
            ))}
            {d.accountBalances.filter((a) => a.balance !== 0).length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "#999" }}>데이터 없음</div>
            )}
          </div>
        </Card>
      </Section>

      {/* ============ 추이 ============ */}
      <Section storageKey="asset-section-trend" title="📈 추이">
        {nw.length >= 2 && (
          <Card title="순자산 추이 (현금흐름 누적 기반)" span={4}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={nw}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#48c9b0" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#48c9b0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={F} tick={{ fontSize: 11 }} domain={[Math.max(0, minNW * 0.9), maxNW * 1.05]} />
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                <Area type="monotone" dataKey="total" stroke="#48c9b0" fill="url(#nwGrad)" strokeWidth={2} name="순자산 추이" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="asset-section-insights" title="💡 인사이트">
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
                <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: it.pass ? "#f0fdf4" : "#fff5f5", borderRadius: 6 }}>
                  <span style={{ fontSize: 18 }}>{it.pass ? "✅" : "⚠️"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: it.pass ? "#059669" : "#e94560" }}>{it.label}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>{it.hint}</div>
                  </div>
                </div>
              ));
            })()}
          </div>
        </Card>

        <Card title="요약" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Insight title="순자산 추세" color="#059669" bg="#ecfdf5">
              {nw.length >= 2 ? (() => {
                const last3 = nw.slice(-3);
                const trend3 = last3.length >= 2 ? last3[last3.length - 1].total - last3[0].total : 0;
                if (trend3 > 0) return `최근 3개월 동안 ${F(trend3)}원 증가 추세입니다. 이 속도로 ${monthlyGrowth > 0 ? `연간 ${F(monthlyGrowth * 12)}원 자산 형성 예상` : ""}.`;
                if (trend3 < 0) return `최근 3개월 동안 ${F(Math.abs(trend3))}원 감소했습니다. 지출 점검·수입 증대가 필요합니다.`;
                return "최근 3개월간 순자산이 거의 변동 없습니다. 저축률 점검을 권장합니다.";
              })() : "추적 기간이 2개월 미만입니다."}
            </Insight>
            <Insight title="부채 건강도" color={totalDebt > totalAssets * 0.5 ? "#e94560" : "#2563eb"} bg={totalDebt > totalAssets * 0.5 ? "#fff5f5" : "#f0f8ff"}>
              총 부채 {F(totalDebt)}원 (자산 대비 {totalAssets > 0 ? Math.round((totalDebt / totalAssets) * 100) : 0}%).
              {totalDebt === 0 ? " 부채 없음 — 안정적." :
                totalDebt > totalAssets * 0.5 ? ` 부채 비중 50% 초과 — 상환 계획 필요.` :
                totalDebt > totalAssets * 0.2 ? ` 부채 비중 20-50% — 적정 관리 필요.` :
                ` 부채 비중 20% 이내 — 건강한 수준.`}
              {loanDebtSum > 0 && ` 대출 잔금 ${F(loanDebtSum)}원은 원금 상환 시 차감됨.`}
            </Insight>
            <Insight title="자산 배분" color="#b45309" bg="#fff3cd">
              {d.assetAllocation.length >= 2 ? (() => {
                const top = d.assetAllocation[0];
                const share = totalAssets > 0 ? Math.round((top.value / totalAssets) * 100) : 0;
                return `자산의 ${share}%가 ${top.name}에 집중. ${share > 70 ? "한 곳에 쏠림 — 분산 투자 고려." : share > 40 ? "주력 자산 유형이 명확." : "비교적 분산되어 있음."}`;
              })() : "자산 유형이 단일합니다. 분산 필요."}
            </Insight>
          </div>
        </Card>
      </Section>
    </div>
  );
});
