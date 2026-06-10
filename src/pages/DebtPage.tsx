/**
 * 대출 관리 (DebtPage) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 무거운 파생값(loanRepayments/loanRepaymentSubOptions/cashAccounts/matchRepaymentLoan)은
 * 여기서 useMemo/useCallback으로 계산해 분리 컴포넌트(features/debt/*)에 props로 내려준다.
 * 자식은 재계산하지 않는다.
 *
 * 입력 상태 소유권 (타이핑이 이 페이지를 재렌더하지 않도록 자식이 소유):
 *   - LoanFormSection         : 대출 추가/수정 폼 상태 (editingLoan 포함, ref API로 적재/초기화)
 *   - RepayLoanModal          : 상환 입력 상태 (금액/세부 항목/출금 계좌/날짜)
 *   - EditRepaymentModal      : 상환 내역 수정 입력 상태
 *   - RepaymentHistorySection : 부채별 그룹/필터 파생값 (이 섹션 전용 memo)
 * 부모는 폼 열림(showForm)·어떤 모달이 열렸는지(repayingLoan/editingRepayment)와
 * 카드↔상환 내역이 공유하는 상태(showRepaymentHistory/repaymentFilterDebtId)만 소유한다.
 *
 * 자식은 모두 React.memo — 부모가 넘기는 콜백은 setState 그대로 또는 useCallback으로 참조 고정.
 */
import React, { useState, useMemo, useCallback, useRef } from "react";
import type { Loan, LedgerEntry, Account, CategoryPresets } from "../types";
import { isInterestRepayment } from "../calculations";
import { isLoanRepaymentEntry } from "../features/debt/debtShared";
import { LoanFormSection, type LoanFormSectionHandle } from "../features/debt/LoanFormSection";
import { LoanCardsSection } from "../features/debt/LoanCardsSection";
import { RepaymentHistorySection } from "../features/debt/RepaymentHistorySection";
import { RepayLoanModal } from "../features/debt/RepayLoanModal";
import { EditRepaymentModal } from "../features/debt/EditRepaymentModal";

/** ledger detailCategory용 — 원금/이자만 구분 */
const DEFAULT_LOAN_REPAYMENT_SUBS = ["원금상환", "이자상환"];

interface Props {
  loans?: Loan[];
  ledger: LedgerEntry[];
  accounts?: Account[];
  categoryPresets?: CategoryPresets;
  onChangeLoans: (loans: Loan[]) => void;
  onChangeLedger?: (ledger: LedgerEntry[]) => void;
}

export const DebtView: React.FC<Props> = ({
  loans = [],
  ledger,
  accounts = [],
  categoryPresets,
  onChangeLoans,
  onChangeLedger
}) => {
  const [showForm, setShowForm] = useState(false);
  const [showRepaymentHistory, setShowRepaymentHistory] = useState(true);
  const [repayingLoan, setRepayingLoan] = useState<Loan | null>(null);
  const [editingRepayment, setEditingRepayment] = useState<LedgerEntry | null>(null);
  const [repaymentFilterDebtId, setRepaymentFilterDebtId] = useState<string>("");

  // 폼 외부 접점 (카드 "수정" → 적재, 헤더 토글 → 초기화)
  const loanFormRef = useRef<LoanFormSectionHandle>(null);

  const loanRepaymentSubOptions = useMemo(() => {
    const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === "대출상환");
    const subs = g?.subs;
    return subs && subs.length > 0 ? subs : DEFAULT_LOAN_REPAYMENT_SUBS;
  }, [categoryPresets]);

  const matchRepaymentLoan = useCallback((entry: LedgerEntry): Loan | null => {
    const description = entry.description || "";
    return loans.find((loan) => description.includes(loan.loanName)) ?? null;
  }, [loans]);

  // 대출별 원금/이자 상환 누적. 현재 잔금은 원금 상환분만 차감한다.
  const loanRepayments = useMemo(() => {
    const principal = new Map<string, number>();
    const interest = new Map<string, number>();
    ledger
      .filter(isLoanRepaymentEntry)
      .forEach((l) => {
        const loan = matchRepaymentLoan(l);
        if (!loan) return;
        const bucket = isInterestRepayment(l) ? interest : principal;
        bucket.set(loan.id, (bucket.get(loan.id) || 0) + l.amount);
      });
    return { principal, interest };
  }, [ledger, matchRepaymentLoan]);

  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.type === "checking" || a.type === "savings" || a.type === "other"),
    [accounts]
  );

  // memo된 LoanCardsSection에 넘기므로 참조 안정성 필요 — 폼 ref 적재 + 폼 열기
  const handleEditLoan = useCallback((loan: Loan) => {
    loanFormRef.current?.startEdit(loan);
    setShowForm(true);
  }, []);

  // memo된 모달들에 넘기는 닫기 콜백 — 참조 고정
  const handleCloseRepay = useCallback(() => setRepayingLoan(null), []);
  const handleCloseEditRepayment = useCallback(() => setEditingRepayment(null), []);

  return (
    <div>
      <div className="section-header">
        <h2>대출 관리</h2>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setShowForm(!showForm);
            loanFormRef.current?.resetForm();
          }}
        >
          {showForm ? "입력 닫기" : "새 대출 추가"}
        </button>
      </div>

      {/* 대출 추가/수정 폼 — 분리 컴포넌트 (React.memo + forwardRef). 폼·수정 모드 상태는 자식 소유 */}
      <LoanFormSection
        ref={loanFormRef}
        visible={showForm}
        loans={loans}
        onChangeLoans={onChangeLoans}
        setShowForm={setShowForm}
      />

      {/* 대출 카드 그리드 — 분리 컴포넌트 (React.memo). 카드 클릭은 상환 내역 필터와 공유 상태 */}
      <LoanCardsSection
        loans={loans}
        loanRepayments={loanRepayments}
        repaymentFilterDebtId={repaymentFilterDebtId}
        setRepaymentFilterDebtId={setRepaymentFilterDebtId}
        setShowRepaymentHistory={setShowRepaymentHistory}
        onEditLoan={handleEditLoan}
        onChangeLoans={onChangeLoans}
        canRepay={!!onChangeLedger}
        onStartRepay={setRepayingLoan}
      />

      {/* 지금까지 갚은 내역 — 분리 컴포넌트 (React.memo). 그룹/필터 파생값은 자식 소유 */}
      <RepaymentHistorySection
        loans={loans}
        ledger={ledger}
        accounts={accounts}
        showRepaymentHistory={showRepaymentHistory}
        setShowRepaymentHistory={setShowRepaymentHistory}
        repaymentFilterDebtId={repaymentFilterDebtId}
        setRepaymentFilterDebtId={setRepaymentFilterDebtId}
        matchRepaymentLoan={matchRepaymentLoan}
        onEditRepayment={setEditingRepayment}
        onChangeLedger={onChangeLedger}
      />

      {repayingLoan && onChangeLedger && (
        <RepayLoanModal
          key={repayingLoan.id}
          loan={repayingLoan}
          ledger={ledger}
          loanRepayments={loanRepayments}
          cashAccounts={cashAccounts}
          loanRepaymentSubOptions={loanRepaymentSubOptions}
          onChangeLedger={onChangeLedger}
          onClose={handleCloseRepay}
        />
      )}

      {editingRepayment && onChangeLedger && (
        <EditRepaymentModal
          key={editingRepayment.id}
          entry={editingRepayment}
          ledger={ledger}
          cashAccounts={cashAccounts}
          loanRepaymentSubOptions={loanRepaymentSubOptions}
          onChangeLedger={onChangeLedger}
          onClose={handleCloseEditRepayment}
        />
      )}
    </div>
  );
};
