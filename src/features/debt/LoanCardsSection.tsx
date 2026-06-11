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

const calculateTotalInterest = (loan: Loan): number => {
  const totalDays = daysBetween(loan.loanDate, loan.maturityDate);
  const totalYears = totalDays / 365;
  const graceYears = loan.gracePeriodYears || 0;
  const repaymentYears = totalYears - graceYears;

  if (repaymentYears <= 0) return 0;

  const monthlyRate = loan.annualInterestRate / 100 / 12;
  const months = repaymentYears * 12;

  if (loan.repaymentMethod === "equal_payment") {
    if (monthlyRate === 0) return 0;
    const monthlyPayment =
      (loan.loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
    return monthlyPayment * months - loan.loanAmount;
  } else if (loan.repaymentMethod === "equal_principal") {
    const monthlyPrincipal = loan.loanAmount / months;
    let totalInterest = 0;
    let remainingPrincipal = loan.loanAmount;
    for (let i = 0; i < months; i++) {
      totalInterest += remainingPrincipal * monthlyRate;
      remainingPrincipal -= monthlyPrincipal;
    }
    return totalInterest;
  } else {
    return loan.loanAmount * (loan.annualInterestRate / 100) * repaymentYears;
  }
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
    if (window.confirm("정말 이 대출을 삭제하시겠습니까?")) {
      onChangeLoans(loans.filter((l) => l.id !== id));
    }
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
        const today = new Date().toISOString().slice(0, 10);
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
