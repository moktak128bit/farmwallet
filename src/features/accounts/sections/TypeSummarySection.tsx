/**
 * 계좌 유형별 요약 카드 (현금/저축/부채/주식/순자산).
 * AccountsPage에서 분리 — React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * summary는 부모 useMemo(typeSummary) 결과를 그대로 받아야 memo가 효과를 가진다.
 */
import React from "react";
import { Money } from "../../../components/ui/Money";

interface TypeSummary {
  checking: number;
  savings: number;
  /** 기타(other) 유형 계좌 잔액 — 순자산(total)에 포함 */
  other: number;
  cardNet: number;
  cardDebt: number;
  cardCredit: number;
  /** 대출 잔금 합 (부채 탭 대출) — 순자산에서 차감 */
  loanDebt: number;
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
            <Money value={summary.checking} compact />
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>저축</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            <Money value={summary.savings} compact />
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* 카드 빚만 가리키던 "부채" → 이름을 정직하게. 대출은 옆 칸 */}
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>카드 부채</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: summary.cardDebt > 0 ? "var(--text)" : "var(--text-muted)" }}>
            <Money value={summary.cardDebt} compact />
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
            <Money value={summary.securities} compact />
          </span>
        </div>
        {summary.loanDebt > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>대출</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              <Money value={summary.loanDebt} compact />
            </span>
          </div>
        )}
        {summary.other !== 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>기타</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
              <Money value={summary.other} compact />
            </span>
          </div>
        )}
        <div className="type-summary-total">
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>순자산</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: summary.total >= 0 ? "var(--primary)" : "var(--danger)" }}>
            <Money value={summary.total} compact />
          </span>
        </div>
      </div>
    </div>
  );
});
