/**
 * 통합 현금흐름 — 12개월 잔고 곡선 (3-5). DashboardPage에서 렌더.
 * 데이터는 utils/cashFlowProjection.buildCashFlowProjection(순수)이 전부 계산 — 이 카드는 표시만.
 * 차트(recharts)는 DashboardInlineCharts에서 lazy-import(초기 번들에서 제외).
 */
import React, { Suspense, lazy, useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry, Loan, RecurringExpense } from "../../types";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { buildCashFlowProjection } from "../../utils/cashFlowProjection";
import type { CashFlowProjectionRow } from "./DashboardInlineCharts";

const LazyCashFlowProjectionChart = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.CashFlowProjectionChart }))
);

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  loans: Loan[];
  recurring: RecurringExpense[];
  fxRate: number | null;
  categoryPresets?: CategoryPresets;
}

function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${m}월`;
}

export const CashFlowProjectionCard: React.FC<Props> = React.memo(function CashFlowProjectionCard({
  accounts,
  ledger,
  loans,
  recurring,
  fxRate,
  categoryPresets,
}) {
  const todayIso = getTodayKST();
  const projection = useMemo(
    () => buildCashFlowProjection(todayIso, accounts, ledger, loans, recurring, { horizonMonths: 12, fxRate, categoryPresets }),
    [todayIso, accounts, ledger, loans, recurring, fxRate, categoryPresets]
  );

  const rows: CashFlowProjectionRow[] = useMemo(
    () => projection.points.map((p) => ({ month: p.month, label: monthLabel(p.month), balance: p.balance })),
    [projection.points]
  );
  const minBalanceMonth = projection.minBalanceDate ? projection.minBalanceDate.slice(0, 7) : null;
  const firstNegativeMonth = projection.firstNegativeDate ? projection.firstNegativeDate.slice(0, 7) : null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <div className="card-title">통합 현금흐름 (12개월)</div>
          <div className="hint" style={{ fontSize: 13 }}>
            가용 현금(입출금·저축) + 반복지출/수입 + 대출 상환 + 카드 청구 + 변동 지출 추정 — 가정 기반, 확정 아님
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ textAlign: "right" }}>
            <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>현재 가용 현금</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{formatKRW(Math.round(projection.openingBalance))}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>최저 예상 잔고</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: projection.minBalance < 0 ? "var(--danger)" : "var(--text)" }}>
              {formatKRW(Math.round(projection.minBalance))}
            </div>
          </div>
        </div>
      </div>
      {projection.firstNegativeDate ? (
        <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 8 }}>
          ⚠ {projection.firstNegativeDate} 무렵 잔고가 마이너스로 예상됩니다.
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--success)", marginBottom: 8 }}>12개월 동안 마이너스 없이 유지될 것으로 예상됩니다.</div>
      )}
      <div style={{ width: "100%", height: 260 }}>
        {rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
            입출금·저축 계좌가 없어 현금흐름을 계산할 수 없습니다.
          </div>
        ) : (
          <Suspense fallback={<div style={{ height: 260 }} />}>
            <LazyCashFlowProjectionChart rows={rows} minBalanceMonth={minBalanceMonth} firstNegativeMonth={firstNegativeMonth} />
          </Suspense>
        )}
      </div>
    </div>
  );
});
