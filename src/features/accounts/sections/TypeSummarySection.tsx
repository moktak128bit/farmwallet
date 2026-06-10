/**
 * 계좌 유형별 요약 카드 (현금/저축/부채/주식/순자산).
 * AccountsPage에서 분리 — React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * summary는 부모 useMemo(typeSummary) 결과를 그대로 받아야 memo가 효과를 가진다.
 */
import React from "react";

interface TypeSummary {
  checking: number;
  savings: number;
  cardNet: number;
  cardDebt: number;
  cardCredit: number;
  securities: number;
  total: number;
}

interface Props {
  summary: TypeSummary;
  formatKRW: (n: number) => string;
}

export const TypeSummarySection = React.memo(function TypeSummarySection({ summary, formatKRW }: Props) {
  return (
    <div style={{
      marginBottom: "24px",
      padding: "16px 20px",
      background: "var(--surface)",
      borderRadius: "8px",
      border: "2px solid var(--primary)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "16px 24px",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>현금</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            {formatKRW(summary.checking)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>저축</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            {formatKRW(summary.savings)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>부채</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: summary.cardDebt > 0 ? "var(--danger)" : "var(--text-muted)" }}>
            {formatKRW(summary.cardDebt)}
          </span>
          {summary.cardCredit > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              크레딧: <span style={{ fontWeight: 700, color: "var(--primary)" }}>{formatKRW(summary.cardCredit)}</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>주식</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            {formatKRW(summary.securities)}
          </span>
        </div>
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          paddingLeft: "24px",
          borderLeft: "2px solid var(--border)",
          gridColumn: "span 1",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>순자산</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: summary.total >= 0 ? "var(--primary)" : "var(--danger)" }}>
            {formatKRW(summary.total)}
          </span>
        </div>
      </div>
    </div>
  );
});
