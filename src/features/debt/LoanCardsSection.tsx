/**
 * 대출 카드 그리드 — 대출별 이자/잔금 요약 카드 + 수정/삭제 + 「갚기」 진입.
 * DebtPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 * loanRepayments(대출별 원금/이자 누적)는 부모 memo — 여기서 재계산하지 않는다.
 * 카드 클릭 → 상환 내역 필터(repaymentFilterDebtId)·펼침(showRepaymentHistory)은 부모 소유 상태.
 */
import React from "react";
import type { Loan, RepaymentMethod } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";
import { graceEndDate } from "./debtShared";

const daysBetween = (date1: string, date2: string): number => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
};

const formatPeriod = (days: number): string => {
  if (days < 0) return "만료";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (remainingDays > 0 && years === 0) parts.push(`${remainingDays}일`);
  return parts.length > 0 ? parts.join(" ") : "0일";
};

/**
 * 총 대출이자 추정.
 * - 거치기간 동안은 원금 전액에 대한 이자만 납부 — 이 이자도 총액에 가산한다 (기존엔 누락).
 * - 만기일시(bullet)는 전 기간(거치 포함) 원금 전액 이자.
 * - 상환 개월수는 정수로 보정 — 소수 개월(예: 53.4)로 회차 수·월 원금이 어긋나는 문제 방지.
 * (테스트용 export)
 */
export const calculateTotalInterest = (loan: Loan): number => {
  const totalDays = daysBetween(loan.loanDate, loan.maturityDate);
  const totalYears = totalDays / 365;
  if (totalYears <= 0) return 0;
  // 거치기간은 전체 기간을 넘지 않게 클램프
  const graceYears = Math.min(loan.gracePeriodYears || 0, totalYears);
  const repaymentYears = totalYears - graceYears;
  const annualRate = loan.annualInterestRate / 100;
  // 거치기간 이자: 원금 전액 × 연이율 × 거치년수
  const graceInterest = loan.loanAmount * annualRate * graceYears;

  if (loan.repaymentMethod === "bullet") {
    // 만기일시: 거치 여부와 무관하게 전 기간 원금 전액에 이자 발생
    return loan.loanAmount * annualRate * totalYears;
  }

  if (repaymentYears <= 0) return graceInterest;

  const monthlyRate = annualRate / 12;
  const months = Math.max(1, Math.round(repaymentYears * 12));

  if (loan.repaymentMethod === "equal_payment") {
    if (monthlyRate === 0) return graceInterest;
    const monthlyPayment =
      (loan.loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
    return graceInterest + (monthlyPayment * months - loan.loanAmount);
  }

  // equal_principal (원금균등)
  const monthlyPrincipal = loan.loanAmount / months;
  let totalInterest = 0;
  let remainingPrincipal = loan.loanAmount;
  for (let i = 0; i < months; i++) {
    totalInterest += remainingPrincipal * monthlyRate;
    remainingPrincipal -= monthlyPrincipal;
  }
  return graceInterest + totalInterest;
};

const repaymentMethodLabel: Record<RepaymentMethod, string> = {
  equal_payment: "원리금균등",
  equal_principal: "원금균등",
  bullet: "만기일시"
};

interface Props {
  loans: Loan[];
  /** 부모 memo — 대출별 원금/이자 상환 누적 */
  loanRepayments: { principal: Map<string, number>; interest: Map<string, number> };
  repaymentFilterDebtId: string;
  setRepaymentFilterDebtId: React.Dispatch<React.SetStateAction<string>>;
  setShowRepaymentHistory: React.Dispatch<React.SetStateAction<boolean>>;
  /** 부모 useCallback — 폼 ref.startEdit + setShowForm(true) */
  onEditLoan: (loan: Loan) => void;
  onChangeLoans: (loans: Loan[]) => void;
  /** onChangeLedger 존재 여부 — 「갚기」 버튼 표시 조건 */
  canRepay: boolean;
  /** 부모 setState — 상환 모달 열기 */
  onStartRepay: React.Dispatch<React.SetStateAction<Loan | null>>;
}

export const LoanCardsSection: React.FC<Props> = React.memo(function LoanCardsSection({
  loans,
  loanRepayments,
  repaymentFilterDebtId,
  setRepaymentFilterDebtId,
  setShowRepaymentHistory,
  onEditLoan,
  onChangeLoans,
  canRepay,
  onStartRepay
}) {
  const handleDelete = (id: string) => {
    const index = loans.findIndex((l) => l.id === id);
    const deleted = index >= 0 ? loans[index] : undefined;
    if (!deleted) return;
    const ok = window.confirm(
      `"${deleted.loanName}" 대출을 삭제할까요?\n\n가계부의 상환 내역 기록은 삭제되지 않고 그대로 유지됩니다.`
    );
    if (!ok) return;
    onChangeLoans(loans.filter((l) => l.id !== id));
    // 삭제 토스트 [실행 취소] — restore-by-id 재삽입 (showDeleteUndoToast 공용 패턴).
    // 대출 삭제는 상환 내역(ledger)을 건드리지 않으므로 재삽입만으로 완전 복원된다.
    showDeleteUndoToast(
      `"${deleted.loanName}" 대출이 삭제되었습니다. 상환 내역은 가계부에 그대로 남아 있습니다.`,
      buildRestoreById(() => useAppStore.getState().data.loans, onChangeLoans, deleted, index)
    );
  };

  if (loans.length === 0) {
    return (
      <p className="hint" style={{ textAlign: "center", padding: 20 }}>
        등록된 대출이 없습니다 — 위 '새 대출 추가' 버튼으로 첫 대출을 등록해 보세요.
      </p>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 20,
        marginTop: 24
      }}
    >
      {loans.map((loan) => {
        // KST 기준 오늘 — UTC 변환 시 00:00~08:59에 전날로 계산되는 문제 방지
        const today = getTodayKST();
        const remainingPeriod = daysBetween(today, loan.maturityDate);
        const totalInterest = calculateTotalInterest(loan);
        const principalPaid = loanRepayments.principal.get(loan.id) || 0;
        const interestPaid = loanRepayments.interest.get(loan.id) || 0;
        const currentBalance = Math.max(0, loan.loanAmount - principalPaid);
        const graceEnd = graceEndDate(loan);
        const inGrace = graceEnd !== null && today < graceEnd;

        return (
          <div
            key={loan.id}
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => {
              setRepaymentFilterDebtId((prev) => (prev === loan.id ? "" : loan.id));
              setShowRepaymentHistory(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setRepaymentFilterDebtId((prev) => (prev === loan.id ? "" : loan.id));
                setShowRepaymentHistory(true);
              }
            }}
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 260,
              cursor: "pointer",
              border: repaymentFilterDebtId === loan.id ? "2px solid var(--primary)" : undefined,
              boxShadow: repaymentFilterDebtId === loan.id ? "0 0 0 1px var(--primary)" : undefined
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>
                  {loan.loanName}
                </h3>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{loan.institution}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditLoan(loan);
                  }}
                  style={{ fontSize: 12, padding: "6px 10px" }}
                >
                  수정
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(loan.id);
                  }}
                  style={{ fontSize: 12, padding: "6px 10px" }}
                >
                  삭제
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "12px 0",
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>연이자율</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "var(--chart-expense)" }}>
                  {loan.annualInterestRate}%
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>총 대출이자</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {formatKRW(Math.round(totalInterest))}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>대출금액</span>
                <span>{formatKRW(loan.loanAmount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>상환방법</span>
                <span style={{ fontSize: 12 }}>{repaymentMethodLabel[loan.repaymentMethod]}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>남은 기간</span>
                <span>{formatPeriod(remainingPeriod)}</span>
              </div>
              {graceEnd && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    거치 {inGrace ? "중" : "종료"}
                  </span>
                  <span style={{ fontSize: 12, color: inGrace ? "var(--primary)" : "var(--text-muted)" }}>
                    ~ {graceEnd}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>원금 상환</span>
                <span style={{ fontSize: 13 }}>{formatKRW(Math.round(principalPaid))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>이자 납입</span>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{formatKRW(Math.round(interestPaid))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>현재 잔금</span>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: currentBalance > 0 ? "var(--danger)" : "var(--text-muted)"
                  }}
                >
                  {formatKRW(Math.round(currentBalance))}
                </span>
              </div>
            </div>

            {canRepay && (
              <button
                type="button"
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRepay(loan);
                }}
                style={{ width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 600 }}
                disabled={currentBalance <= 0}
              >
                갚기
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
