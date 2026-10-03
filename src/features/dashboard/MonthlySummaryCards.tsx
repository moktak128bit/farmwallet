import React from "react";
import { formatKRW, formatKrwCompact } from "../../utils/formatter";
import { Money } from "../../components/ui/Money";
import type { BalanceSheet } from "../../calculations";
import { EXPENSE_BOX_EXCLUDED_NAMES } from "./summaryMath";

interface Summary {
  income: number;
  expense: number;
  investing: number;
  /** 지출 중 제외 대상(데이터비 등) 합계 — '제외 후' 보조 표시용 (없으면 0/미정) */
  excludedExpense?: number;
}

const EXCLUDED_LABEL = EXPENSE_BOX_EXCLUDED_NAMES.join("·");

interface Props {
  monthlySummary: Summary;
  /** 대차 단일 소스 — 순자산·총부채 칸 */
  bs: BalanceSheet;
  /** 부모(DashboardPage)가 isBeforePayday로 판정 — 전월 대비 카드와 같은 값 */
  beforePayday: boolean;
}

/**
 * 첫 화면 네 숫자 — 이번 달 지출·수지(흐름, 원 단위) + 순자산·총부채(스톡, 만 단위).
 * 수입·재테크는 수지·지출 칸의 보조 문구로 내렸다 — 첫 화면은 "얼마 썼고, 남았고, 가졌고, 빚졌나"에 답한다.
 */
export const MonthlySummaryCards: React.FC<Props> = React.memo(function MonthlySummaryCards({ monthlySummary, bs, beforePayday }) {
  const balance = monthlySummary.income - monthlySummary.expense;
  const balanceColor = beforePayday ? "var(--text-muted)" : balance >= 0 ? "var(--success)" : "var(--danger)";
  const debtParts = [
    bs.loanDebt > 0 ? `대출 ${formatKrwCompact(bs.loanDebt)}` : null,
    bs.cardDebt > 0 ? `카드 ${formatKrwCompact(bs.cardDebt)}` : null,
    bs.overdraft > 0 ? `마이너스 통장 ${formatKrwCompact(bs.overdraft)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="kpi-grid">
      <div className="card" style={{ borderLeft: "4px solid var(--chart-expense)" }}>
        <div className="card-title">이번 달 지출</div>
        <div className="card-value" style={{ color: "var(--chart-expense)" }}>
          <Money value={Math.round(monthlySummary.expense)} />
        </div>
        {(monthlySummary.excludedExpense ?? 0) > 0 && (
          <div className="hint" style={{ marginTop: 6, fontWeight: 600 }}>
            {EXCLUDED_LABEL} 제외: {formatKRW(Math.round(monthlySummary.expense - (monthlySummary.excludedExpense ?? 0)))}
          </div>
        )}
        {/* investing은 이체 + 투자수익 − 투자손실·수수료 순액 — "이체"라 부르면 손익이 섞인 숫자를 오해한다 */}
        <div className="hint" style={{ marginTop: 8 }}>재테크 순액 {formatKRW(Math.round(monthlySummary.investing))} 별도</div>
      </div>

      {/* 좌측 바도 숫자와 같은 상태색 — 바는 초록인데 숫자는 빨강이던 불일치 제거 */}
      <div className="card" style={{ borderLeft: `4px solid ${beforePayday ? "var(--border-strong)" : balanceColor}` }}>
        <div className="card-title">이번 달 수지</div>
        <div className="card-value" style={{ color: balanceColor }}>
          <Money value={Math.round(balance)} />
        </div>
        <div className={`hint${beforePayday ? " kpi-note" : ""}`} style={{ marginTop: 8 }}>
          {beforePayday ? "급여 입금 전 · 지출만 반영" : `근로소득 ${formatKRW(Math.round(monthlySummary.income))} − 지출`}
        </div>
      </div>

      <div className="card" style={{ borderLeft: "4px solid var(--chart-primary)" }}>
        <div className="card-title">순자산</div>
        <div className="card-value" style={{ color: bs.netWorth >= 0 ? "var(--text)" : "var(--danger)" }}>
          <Money value={bs.netWorth} compact />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>총자산 {formatKrwCompact(bs.totalAssets)}원 − 총부채</div>
      </div>

      <div className="card" style={{ borderLeft: "4px solid var(--border-strong)" }}>
        <div className="card-title">총부채</div>
        <div className="card-value">
          <Money value={bs.totalLiabilities} compact />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>{debtParts || "부채 없음"}</div>
      </div>
    </div>
  );
});
