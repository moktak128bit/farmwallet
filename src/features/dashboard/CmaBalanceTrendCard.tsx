import React, { Suspense, lazy, useMemo } from "react";
import { formatKRW } from "../../utils/formatter";

const LazyChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.CmaBalanceChart }))
);

interface Props {
  /** 계좌 잔액 시계열 — DashboardPage에서 이미 계산한 accountBalanceSnapshots 그대로 전달.
   * 각 row는 { date, label, total, [accountId]: balance } 구조. */
  accountBalanceSnapshots: Array<Record<string, number | string>>;
  /** 추적할 계좌 id (예: "CMA") */
  accountId: string;
  /** 표시용 계좌명 */
  accountName: string;
}

export interface CmaTrendRow {
  date: string;
  label: string;
  balance: number;
}

/**
 * 특정 계좌(주로 CMA·현금성)의 잔액 추이 카드.
 *  - 좌측: 현재 잔액·전월 대비·기간 시작 대비 변화율
 *  - 우측: 라인 차트 (월말+15일 스냅샷)
 *
 * accountBalanceSnapshots는 DashboardPage에서 이미 계산되어 있으므로 추가 비용 없음.
 */
export const CmaBalanceTrendCard: React.FC<Props> = ({ accountBalanceSnapshots, accountId, accountName }) => {
  const rows: CmaTrendRow[] = useMemo(
    () =>
      accountBalanceSnapshots.map((s) => ({
        date: String(s.date ?? ""),
        label: String(s.label ?? ""),
        balance: Number(s[accountId] ?? 0),
      })),
    [accountBalanceSnapshots, accountId]
  );

  if (rows.length === 0) {
    return (
      <div className="card" style={{ minHeight: 200 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>{accountName} 잔액 추이</div>
        <div className="hint">데이터가 없습니다.</div>
      </div>
    );
  }

  const latest = rows[rows.length - 1];
  // 전월 대비 — 보통 월말 스냅샷이 2개씩 있으므로 -2 위치가 한 달 전
  const prevForMoM = rows[rows.length - 3] ?? rows[0];
  const first = rows[0];
  const momDelta = latest.balance - prevForMoM.balance;
  const momRate = prevForMoM.balance !== 0 ? (momDelta / Math.abs(prevForMoM.balance)) * 100 : 0;
  const totalDelta = latest.balance - first.balance;
  const totalRate = first.balance !== 0 ? (totalDelta / Math.abs(first.balance)) * 100 : 0;

  const colorOf = (v: number) => (v > 0 ? "var(--success)" : v < 0 ? "var(--danger)" : "var(--muted)");
  const arrowOf = (v: number) => (v > 0 ? "▲" : v < 0 ? "▼" : "–");

  return (
    <div className="card" style={{ minHeight: 320 }}>
      <div className="card-title" style={{ marginBottom: 12 }}>{accountName} 잔액 추이</div>
      <div
        className="dashboard-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 280px) 1fr",
          gap: 20,
          alignItems: "stretch",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
          <div className="card-value" style={{ marginBottom: 0 }}>{formatKRW(Math.round(latest.balance))}</div>
          <div className="hint" style={{ marginTop: 0 }}>{latest.date} 기준</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15 }}>
            <div style={{ color: colorOf(momDelta) }}>
              전월 대비 {arrowOf(momDelta)} {formatKRW(Math.round(Math.abs(momDelta)))}
              {prevForMoM.balance !== 0 && (
                <span> ({momDelta >= 0 ? "+" : ""}{momRate.toFixed(1)}%)</span>
              )}
            </div>
            <div style={{ color: colorOf(totalDelta) }}>
              기간 시작 대비 {arrowOf(totalDelta)} {formatKRW(Math.round(Math.abs(totalDelta)))}
              {first.balance !== 0 && (
                <span> ({totalDelta >= 0 ? "+" : ""}{totalRate.toFixed(1)}%)</span>
              )}
            </div>
            <div className="hint" style={{ marginTop: 4, fontSize: 13 }}>
              {first.date} → {latest.date}
            </div>
          </div>
        </div>

        <div style={{ minHeight: 220 }}>
          <Suspense fallback={<div style={{ height: 220 }} />}>
            <LazyChart rows={rows} />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
