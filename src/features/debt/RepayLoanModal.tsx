/**
 * 대출 상환(「갚기」) 모달 — 상환 금액/세부 항목/출금 계좌/날짜 입력 상태를 이 컴포넌트가 소유해
 * 타이핑이 부모(DebtPage)를 재렌더하지 않는다.
 * 부모는 열림 상태(repayingLoan)만 소유하고, 열릴 때마다 key={loan.id}로 마운트해
 * 초기값(첫 현금성 계좌, 거치기간 기반 세부 항목)을 useState 초기화로 계산한다 — 분리 전 「갚기」 클릭 초기화와 동일.
 * React.memo — 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 * loanRepayments/cashAccounts/loanRepaymentSubOptions는 부모 memo — 여기서 재계산하지 않는다.
 */
import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry, Loan } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { parseAmount } from "../../utils/parseAmount";
import { getTodayKST } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";
import { isInGracePeriod } from "./debtShared";

interface Props {
  loan: Loan;
  ledger: LedgerEntry[];
  /** 부모 memo — 현재 잔금 표시용 (원금 상환 누적) */
  loanRepayments: { principal: Map<string, number>; interest: Map<string, number> };
  /** 부모 memo — 출금 가능 현금성 계좌 */
  cashAccounts: Account[];
  /** 부모 memo — 대출상환 세부 항목 옵션 */
  loanRepaymentSubOptions: string[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
  /** 부모 useCallback — setRepayingLoan(null) */
  onClose: () => void;
}

export const RepayLoanModal: React.FC<Props> = React.memo(function RepayLoanModal({
  loan,
  ledger,
  loanRepayments,
  cashAccounts,
  loanRepaymentSubOptions,
  onChangeLedger,
  onClose
}) {
  const [repayAmount, setRepayAmount] = useState("");
  const [repayFromAccountId, setRepayFromAccountId] = useState(() => cashAccounts[0]?.id ?? "");
  // 거치기간 중이면 "이자상환" 자동 선택, 아니면 "원금상환" (오늘 날짜는 KST 기준)
  const [repaySubCategory, setRepaySubCategory] = useState(() => {
    const inGrace = isInGracePeriod(loan, getTodayKST());
    const interestOption = loanRepaymentSubOptions.find((s) => s.includes("이자"));
    const principalOption =
      loanRepaymentSubOptions.find((s) => s.includes("원금")) ?? loanRepaymentSubOptions[0] ?? "";
    return inGrace && interestOption ? interestOption : principalOption;
  });
  const [repayDate, setRepayDate] = useState(getTodayKST());

  // 접근성: 포커스 트랩 + window 레벨 ESC + 모달 스택 (최상위 모달만 닫힘)
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, isTopModal]);

  const handleRepaySubmit = () => {
    const amount = parseAmount(repayAmount);
    if (amount <= 0) {
      alert("상환 금액을 입력해주세요.");
      return;
    }
    if (!repayFromAccountId) {
      alert("출금 계좌를 선택해주세요.");
      return;
    }
    if (!repaySubCategory) {
      alert("세부 항목을 선택해주세요.");
      return;
    }
    // 날짜 빈값 거부 — date input은 지우기로 빈 문자열이 될 수 있다
    if (!repayDate) {
      alert("날짜를 입력해주세요.");
      return;
    }

    // 원금 상환이 현재 잔금을 초과하면 경고 (저장은 진행 — 잔금은 0으로 클램프되어 집계됨)
    const isPrincipal = !repaySubCategory.includes("이자");
    const currentBalance = Math.max(0, loan.loanAmount - (loanRepayments.principal.get(loan.id) || 0));
    if (isPrincipal && amount > currentBalance) {
      toast(
        `상환 금액이 현재 잔금(${formatKRW(Math.round(currentBalance))})을 초과합니다 — 잔금은 0원으로 처리됩니다.`,
        { icon: "⚠️" }
      );
    }

    const newEntry: LedgerEntry = {
      id: newIdWithPrefix("L"),
      date: repayDate,
      kind: "expense",
      category: "지출",
      subCategory: "대출상환",
      detailCategory: repaySubCategory,
      description: `${loan.loanName} 상환`,
      fromAccountId: repayFromAccountId,
      amount
    };

    onChangeLedger([...ledger, newEntry]);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repay-loan-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400 }}
      >
        <div className="modal-header">
          <h3 id="repay-loan-modal-title">{loan.loanName} 상환</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              padding: 0,
              width: 24,
              height: 24
            }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
            현재 잔금: {formatKRW(Math.round(Math.max(0, loan.loanAmount - (loanRepayments.principal.get(loan.id) || 0))))}
          </p>
          {isInGracePeriod(loan, getTodayKST()) && (
            <p
              style={{
                fontSize: 13,
                color: "var(--primary)",
                background: "var(--primary-light)",
                padding: "8px 12px",
                borderRadius: 6,
                marginBottom: 16
              }}
            >
              ℹ️ 거치기간 중 — 세부 항목에 "이자"가 포함된 옵션을 선택하면 원금 잔금이 차감되지 않습니다.
            </p>
          )}
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>상환 금액 *</span>
            <input
              type="text"
              inputMode="numeric"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="예: 1000000"
              style={{ width: "100%", padding: "10px 12px", fontSize: 16 }}
              autoFocus
            />
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>세부 항목 *</span>
            <select
              value={repaySubCategory}
              onChange={(e) => setRepaySubCategory(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)"
              }}
            >
              <option value="">선택</option>
              {loanRepaymentSubOptions.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>출금 계좌 *</span>
            <select
              value={repayFromAccountId}
              onChange={(e) => setRepayFromAccountId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)"
              }}
            >
              <option value="">선택</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.institution || "-"})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>날짜</span>
            <input
              type="date"
              value={repayDate}
              onChange={(e) => setRepayDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}
            />
          </label>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              취소
            </button>
            <button type="button" className="primary" onClick={handleRepaySubmit}>
              상환 기록
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
