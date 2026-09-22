import React from "react";
import { formatKRW } from "../../utils/formatter";
import { Money } from "../../components/ui/Money";
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
  allTimeSummary: Summary;
  /** 전월 근로소득 — "급여 아직 없음" 판정의 기준선 (0이면 income===0 규칙만 적용) */
  prevMonthIncome?: number;
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(useMemo 결과)이어야 한다.
export const MonthlySummaryCards: React.FC<Props> = React.memo(function MonthlySummaryCards({ monthlySummary, allTimeSummary, prevMonthIncome = 0 }) {
  const balance = monthlySummary.income - monthlySummary.expense;
  /**
   * 이번 달 급여가 아직 안 들어온 상태 — 과거엔 받았는데 이번 달만 (거의) 0.
   * 월급일(보통 25일) 전에는 정상인데, 큰 빨강 "0 원" + 빨간 마이너스 수지가 경보처럼 보인다.
   * 정확히 0만 보면 1원 인증 송금 같은 푼돈에 뚫려 "3 원"이 히어로 숫자가 됐다 → 전월 급여의 5% 미만도 '아직 없음'으로.
   * 의미색은 값이 있을 때만 쓰고, 0인 이유를 한 줄로 밝힌다.
   */
  const beforePayday =
    allTimeSummary.income > 0 &&
    (monthlySummary.income === 0 || (prevMonthIncome > 0 && monthlySummary.income < prevMonthIncome * 0.05));
  const balanceColor = beforePayday ? "var(--text-muted)" : balance >= 0 ? "var(--success)" : "var(--danger)";
  return (
    <div className="kpi-grid">
      <div className="card" style={{ borderLeft: `4px solid ${beforePayday ? "var(--border-strong)" : "var(--chart-income)"}` }}>
        <div className="card-title">이번 달 수입 (근로소득)</div>
        <div className="card-value" style={{ color: beforePayday ? "var(--text-muted)" : "var(--chart-income)" }}>
          <Money value={Math.round(monthlySummary.income)} />
        </div>
        {beforePayday && (
          <div className="hint kpi-note" style={{ marginTop: 6, fontWeight: 600 }}>이번 달 급여 아직 없음</div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.income)} · 월급·수당·상여만</div>
      </div>

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
        <div className="hint" style={{ marginTop: 8 }}>
          전체 기간: {formatKRW(allTimeSummary.expense)}
        </div>
      </div>

      <div className="card" style={{ borderLeft: "4px solid var(--chart-primary)" }}>
        <div className="card-title">이번 달 재테크</div>
        <div className="card-value" style={{ color: "var(--chart-primary)" }}>
          <Money value={Math.round(monthlySummary.investing)} />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.investing)}</div>
      </div>

      {/* 좌측 바도 숫자와 같은 상태색 — 바는 초록인데 숫자는 빨강이던 불일치 제거 */}
      <div className="card" style={{ borderLeft: `4px solid ${beforePayday ? "var(--border-strong)" : balanceColor}` }}>
        <div className="card-title">이번 달 수지</div>
        <div className="card-value" style={{ color: balanceColor }}>
          <Money value={Math.round(balance)} />
        </div>
        <div className={`hint${beforePayday ? " kpi-note" : ""}`} style={{ marginTop: 8 }}>
          {beforePayday ? "급여 입금 전 · 지출만 반영" : "근로소득 − 지출"}
        </div>
      </div>
    </div>
  );
});
