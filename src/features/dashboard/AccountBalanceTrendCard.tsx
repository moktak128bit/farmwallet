import React, { Suspense, lazy } from "react";
import type { Account } from "../../types";
import { formatKRW } from "../../utils/formatter";

const LazyAccountBalanceChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.AccountBalanceChart }))
);

interface Props {
  accountBalanceSnapshots: Array<Record<string, number | string>>;
  accountBalanceChartView: string;
  setAccountBalanceChartView: (value: string) => void;
  accounts: Account[];
}

export const AccountBalanceTrendCard: React.FC<Props> = ({
  accountBalanceSnapshots,
  accountBalanceChartView,
  setAccountBalanceChartView,
  accounts,
}) => {
  if (accountBalanceSnapshots.length === 0) return null;

  const lastSnap = accountBalanceSnapshots[accountBalanceSnapshots.length - 1];
  const prevSnap =
    accountBalanceSnapshots[accountBalanceSnapshots.length - 3] ?? accountBalanceSnapshots[0];
  const lastTotal = Number(lastSnap.total) || 0;
  const prevTotal = Number(prevSnap.total) || 0;
  const abDelta = lastTotal - prevTotal;
  const abDeltaPct = prevTotal !== 0 ? (abDelta / Math.abs(prevTotal)) * 100 : 0;
  const abColor = abDelta > 0 ? "var(--success)" : abDelta < 0 ? "var(--danger)" : "var(--muted)";
  const abArrow = abDelta > 0 ? "▲" : abDelta < 0 ? "▼" : "–";

  return (
    <div className="card" style={{ marginTop: 16, padding: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 17 }}>
          계좌별 잔액 추이 <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>(매월 15·월말, 부채 미차감)</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 26, color: "var(--chart-primary)" }}>{formatKRW(Math.round(lastTotal))}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: abColor }}>
            {abArrow} {formatKRW(Math.round(Math.abs(abDelta)))} ({abDelta >= 0 ? "+" : ""}{abDeltaPct.toFixed(1)}%)
          </div>
          <div className="hint" style={{ fontSize: 13 }}>현재 합계 · 지난달 대비</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <select
          value={accountBalanceChartView}
          onChange={(e) => setAccountBalanceChartView(e.target.value)}
          style={{
            minWidth: 180,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 15,
          }}
        >
          <option value="total">전체 합계</option>
          <option value="all">모두 보기 (계좌별 + 합계)</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>
          ))}
        </select>
      </div>
      <div style={{ width: "100%", height: 360 }}>
        <Suspense fallback={<div style={{ height: 360 }} />}>
          <LazyAccountBalanceChart
            accountBalanceSnapshots={accountBalanceSnapshots}
            accountBalanceChartView={accountBalanceChartView}
            accounts={accounts}
          />
        </Suspense>
      </div>
    </div>
  );
};
