/**
 * 계좌 유형별 요약 카드 (현금/저축/부채/주식/순자산).
 * AccountsPage에서 분리 — React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * summary는 부모 useMemo(typeSummary) 결과를 그대로 받아야 memo가 효과를 가진다.
 */
import React from "react";

interface TypeSummary {
  checking: number;
  savings: number;
  /** 기타(other) 유형 계좌 잔액 — 순자산(total)에 포함 */
  other: number;
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
      // 디자인 시스템 원칙(구분은 선으로, 색은 데이터에만) — 혼자 2px 잉크 테두리라 튀었다.
      // 하드코딩 검정 그림자는 다크모드에서 보이지 않아 토큰으로 교체.
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow)",
    }}>
      <div className="type-summary-grid">
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
        {summary.other !== 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>기타</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
              {formatKRW(summary.other)}
            </span>
          </div>
        )}
        <div className="type-summary-total">
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>순자산</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: summary.total >= 0 ? "var(--primary)" : "var(--danger)" }}>
            {formatKRW(summary.total)}
          </span>
        </div>
      </div>
    </div>
  );
});
