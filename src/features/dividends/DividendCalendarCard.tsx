/**
 * 배당 캘린더 & 목표 (C1·C2) — 향후 12개월 예상 배당 일정/금액(현금흐름) + 목표 배당 대비 진행률.
 * 계산은 utils/forwardDividends(순수). 색: 배당=수입 → 빨강 관례(--chart-income/--danger).
 */
import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { LedgerEntry } from "../../types";
import { useAppStore } from "../../store/appStore";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { buildForwardDividends } from "../../utils/forwardDividends";

interface Props {
  ledger: LedgerEntry[];
  fxRate: number | null;
}

export const DividendCalendarCard: React.FC<Props> = ({ ledger, fxRate }) => {
  const targetAnnualDividend = useAppStore((s) => s.data.investmentGoals?.targetAnnualDividend);
  const today = getTodayKST();
  const fd = useMemo(() => buildForwardDividends(ledger, today, fxRate), [ledger, today, fxRate]);

  const chartData = fd.months.map((m) => ({ label: `${Number(m.month.slice(5, 7))}월`, amount: Math.round(m.amountKRW) }));
  const monthlyAvg = fd.annualTotalKRW / 12;
  const hasTarget = typeof targetAnnualDividend === "number" && targetAnnualDividend > 0;
  const pct = hasTarget ? fd.annualTotalKRW / targetAnnualDividend! : 0;
  const shortfall = hasTarget ? Math.max(0, targetAnnualDividend! - fd.annualTotalKRW) : 0;

  if (fd.trailing12KRW <= 0) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">배당 캘린더 & 목표</div>
        <div className="hint" style={{ fontSize: 13, marginTop: 6 }}>
          최근 12개월 배당 기록이 없어 예상 일정을 만들 수 없습니다. 배당을 입력하면 향후 12개월 캘린더가 표시됩니다.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">배당 캘린더 & 목표 — 향후 12개월</div>
        <div className="hint" style={{ fontSize: 12 }}>최근 12개월 실적을 같은 달에 투영 (보유 유지 가정)</div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "10px 0 6px" }}>
        <Stat label="향후 12개월 예상 배당" value={formatKRW(Math.round(fd.annualTotalKRW))} color="var(--chart-income, var(--danger))" />
        <Stat label="월 평균" value={formatKRW(Math.round(monthlyAvg))} />
        {hasTarget && (
          <Stat
            label="목표 대비"
            value={`${(pct * 100).toFixed(0)}%`}
            color={pct >= 1 ? "var(--chart-income, var(--danger))" : "var(--text)"}
          />
        )}
      </div>

      {hasTarget && (
        <>
          <div style={{ height: 8, borderRadius: 5, background: "var(--border)", overflow: "hidden", margin: "4px 0 6px" }}>
            <div style={{ width: `${Math.min(1, pct) * 100}%`, height: "100%", background: "var(--chart-income, var(--danger))" }} />
          </div>
          <div className="hint" style={{ fontSize: 12, marginBottom: 8 }}>
            목표 {formatKRW(targetAnnualDividend!)}
            {shortfall > 0 ? ` · 목표까지 연 ${formatKRW(Math.round(shortfall))} 부족` : " · 목표 달성 페이스 🎉"}
          </div>
        </>
      )}

      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} />
            <Tooltip formatter={(v: number | string | undefined) => formatKRW(Math.round(Number(v ?? 0)))} />
            <Bar dataKey="amount" fill="var(--chart-income, #dc2626)" isAnimationActive={false} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div>
    <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
  </div>
);
