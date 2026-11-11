/**
 * 내 실질 월급 (최근 12개월) — 대시보드 "소득" 섹션.
 * 계산은 utils/annualTakeHome.computeAnnualTakeHome 단일 소스(인사이트 수입 탭과 같은 값). 부모가 1회 계산해 넘긴다.
 */
import React from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnnualTakeHome } from "../../utils/annualTakeHome";
import { Money } from "../../components/ui/Money";
import { formatKRW, formatKrwCompact } from "../../utils/formatter";

const ym = (m: string) => m.replace("-", ".");

export const AnnualTakeHomeCard: React.FC<{ data: AnnualTakeHome }> = React.memo(function AnnualTakeHomeCard({ data }) {
  const yoy =
    data.prevTotal != null && data.prevTotal > 0 && data.divisorMonths === data.byMonth.length
      ? ((data.total / data.prevTotal) - 1) * 100
      : null;
  const chart = data.byMonth.map((r) => ({ l: r.month.slice(2).replace("-", "."), 정기: r.regular, 상여수당: r.extra }));
  const extraLabel = data.extraItems.map((x) => `${x.key} ${formatKrwCompact(x.total)}`).join(" · ");

  return (
    <div className="card">
      <div className="card-title">내 실질 월급 · 최근 {data.divisorMonths}개월</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 32px", alignItems: "flex-end" }}>
        <div>
          <div className="hint" style={{ fontSize: 12 }}>
            한 달 평균 실수령 ({ym(data.from)}~{ym(data.to)} 근로소득 ÷ {data.divisorMonths})
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--chart-income)" }}>
            <Money value={data.monthlyAvg} />
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <div>
            1년 실수령 <strong style={{ color: "var(--text)" }}>{formatKRW(data.total)}</strong>
            {yoy != null && (
              <span style={{ marginLeft: 6, color: yoy >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                직전 12개월 대비 {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
              </span>
            )}
          </div>
          <div>
            정기 {data.regularKey ?? "월급"} 보통 <strong style={{ color: "var(--text)" }}>{formatKRW(data.regularMedian)}</strong>
            {data.extraTotal > 0 && <> · 상여·수당 연 {formatKRW(data.extraTotal)}</>}
          </div>
          {extraLabel && <div className="hint" style={{ fontSize: 12 }}>{extraLabel}</div>}
        </div>
      </div>

      <div style={{ height: 180, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="l" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatKrwCompact(v)} />
            <Tooltip formatter={(v) => formatKRW(Number(v ?? 0))} />
            <Bar dataKey="정기" stackId="pay" fill="var(--chart-income)" isAnimationActive={false} />
            <Bar dataKey="상여수당" name="상여·수당" stackId="pay" fill="var(--warning)" isAnimationActive={false} />
            <ReferenceLine y={data.monthlyAvg} stroke="var(--text-secondary)" strokeDasharray="4 3" label={{ value: `평균 ${formatKrwCompact(data.monthlyAvg)}`, position: "insideTopRight", fontSize: 11, fill: "var(--text-secondary)" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="hint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
        통장에 들어온 세후 금액 기준(급여·상여·수당). 진행 중인 달은 빼고, 배당·캐시백·정산 같은 다른 수입도 넣지 않았어요.
        {data.paidMonths < data.byMonth.length && ` 근로소득이 없던 달 ${data.byMonth.length - data.paidMonths}개월 포함.`}
        {data.divisorMonths < data.byMonth.length && ` 기록이 ${data.divisorMonths}개월뿐이라 그 기간으로 나눴어요.`}
        {data.retirement > 0 && ` 회사 퇴직연금 적립 ${formatKRW(data.retirement)}은 쓸 수 있는 돈이 아니라 따로 뒀어요.`}
      </div>
    </div>
  );
});
