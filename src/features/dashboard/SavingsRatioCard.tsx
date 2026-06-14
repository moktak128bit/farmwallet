/**
 * 저축률(이체 기준) · 저번달 카드 — DashboardPage에서 분리.
 * 저번달 요약·재테크 세부 집계를 카드가 소유한다 (공용 순수 함수 summaryMath 사용).
 * 저축률 수식은 utils/savingsRate.computeTransferSavingsRate 단일 소스.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { shiftMonth } from "../../utils/date";
import { computeTransferSavingsRate } from "../../utils/savingsRate";
import { computeLedgerSummary, computeRecheckBreakdown } from "./summaryMath";

interface Props {
  ledger: LedgerEntry[];
  fxRate: number | null;
  currentMonth: string;
  /** 레거시 저축성지출(재테크) 분류용 — 이번달 요약 카드와 동일 기준 */
  categoryPresets?: CategoryPresets;
  /** 근로소득 키 — 지정 시 저축률 분모(수입)는 근로소득(월급·수당·상여)만 */
  salaryKeys?: Set<string>;
}

export const SavingsRatioCard: React.FC<Props> = React.memo(function SavingsRatioCard({
  ledger,
  fxRate,
  currentMonth,
  categoryPresets,
  salaryKeys,
}) {
  const lastMonth = useMemo(() => shiftMonth(currentMonth, -1), [currentMonth]);

  /** 저번달 요약 (저축 대비 비교 위젯용) */
  const lastMonthSummary = useMemo(() => ({
    month: lastMonth,
    ...computeLedgerSummary(ledger, fxRate, lastMonth, categoryPresets, salaryKeys),
  }), [ledger, fxRate, lastMonth, categoryPresets, salaryKeys]);

  /** 저번달 재테크 세부 (저축 대비 비교 위젯용) */
  const lastMonthRecheckBreakdown = useMemo(
    () => computeRecheckBreakdown(ledger, fxRate, lastMonth),
    [ledger, fxRate, lastMonth]
  );

  const lastMonthSavingsRate = useMemo(() => {
    const { income, investing } = lastMonthSummary;
    // 저축률(이체 기준) = (transfer 저축이체+투자이체) / 수입. 투자손실(실소비)은 제외. 수입 없으면 null.
    return computeTransferSavingsRate(income, investing);
  }, [lastMonthSummary]);

  const lastMonthInvestingRatio = useMemo(() => {
    const 저축 = lastMonthRecheckBreakdown.저축;
    const 투자 = lastMonthRecheckBreakdown.투자;
    const total = 저축 + 투자;
    if (total <= 0) return { stockPct: 0, savingsPct: 0 };
    return {
      stockPct: (투자 / total) * 100,
      savingsPct: (저축 / total) * 100
    };
  }, [lastMonthRecheckBreakdown]);

  const lastMonthLabel = lastMonthSummary.month;

  return (
    <div className="card" style={{ minHeight: 200 }}>
      <div className="card-title">저축률(이체 기준) · 저번달</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
        <div>
          <div className="hint" style={{ fontSize: 14, marginBottom: 6 }}>저번달 저축 ({lastMonthLabel})</div>
          <div
            className="card-value"
            style={{ fontSize: 26, color: lastMonthSavingsRate != null ? "var(--chart-primary)" : "var(--text-muted)" }}
          >
            {lastMonthSavingsRate != null ? `${lastMonthSavingsRate.toFixed(1)}%` : "-"}
          </div>
          <div className="hint" style={{ fontSize: 14, marginTop: 6 }}>근로소득 대비 재테크 이체 비율</div>
        </div>
        <div>
          <div className="hint" style={{ fontSize: 14, marginBottom: 6 }}>지출 구성 (주식 대비 저축)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
            주식 {lastMonthInvestingRatio.stockPct.toFixed(0)}% / 저축 {lastMonthInvestingRatio.savingsPct.toFixed(0)}%
          </div>
          <div className="hint" style={{ fontSize: 14, marginTop: 6 }}>
            {formatKRW(Math.round(lastMonthRecheckBreakdown.투자))} / {formatKRW(Math.round(lastMonthRecheckBreakdown.저축))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, height: 8, display: "flex", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${lastMonthInvestingRatio.stockPct}%`,
            background: "var(--chart-primary)",
            minWidth: lastMonthInvestingRatio.stockPct > 0 ? 4 : 0,
          }}
        />
        <div
          style={{
            width: `${lastMonthInvestingRatio.savingsPct}%`,
            background: "var(--chart-positive)",
            minWidth: lastMonthInvestingRatio.savingsPct > 0 ? 4 : 0,
          }}
        />
      </div>
    </div>
  );
});
