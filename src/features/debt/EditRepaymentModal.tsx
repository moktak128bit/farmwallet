/**
 * 상환 내역 수정 모달 — 금액/세부 항목/출금 계좌/날짜/상세내역 입력 상태를 이 컴포넌트가 소유해
 * 타이핑이 부모(DebtPage)를 재렌더하지 않는다.
 * 부모는 열림 상태(editingRepayment)만 소유하고, 열릴 때마다 key={entry.id}로 마운트해
 * 초기값(신구 카테고리 구조 → 세부 항목 매핑)을 useState 초기화로 계산한다 — 분리 전 openEditRepayment와 동일.
 * React.memo — 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 * cashAccounts/loanRepaymentSubOptions는 부모 memo — 여기서 재계산하지 않는다.
 */
import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry, Loan } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";
import { isInterestRepayment } from "../../calculations";
import { isLoanRepaymentEntry } from "./debtShared";

interface Props {
  /** 수정 대상 상환 내역 (열림 상태는 부모 소유) */
  entry: LedgerEntry;
  ledger: LedgerEntry[];
  /** 부모 memo — 출금 가능 현금성 계좌 */
  cashAccounts: Account[];
  /** 부모 memo — 대출상환 세부 항목 옵션 */
  loanRepaymentSubOptions: string[];
  /** 부모 useCallback — 상환 내역 ↔ 대출 매칭 (잔금 초과 경고용) */
  matchRepaymentLoan?: (entry: LedgerEntry) => Loan | null;
  onChangeLedger: (ledger: LedgerEntry[]) => void;
  /** 부모 useCallback — setEditingRepayment(null) */
  onClose: () => void;
}

export const EditRepaymentModal: React.FC<Props> = React.memo(function EditRepaymentModal({
  entry,
  ledger,
  cashAccounts,
  loanRepaymentSubOptions,
  matchRepaymentLoan,
  onChangeLedger,
  onClose
}) {
  const [editAmount, setEditAmount] = useState(() => String(Math.round(entry.amount)));
  const [editSubCategory, setEditSubCategory] = useState(() => {
    // 세부 항목 위치 (신구 구조 모두 대응):
    //  - 현재 구조: (category="지출", subCategory="대출상환", detailCategory=<세부>)
    //  - 구버전:     (category="대출상환", subCategory=<세부>)
    //  - 최초:       (category="대출", subCategory="빚") → 세부 없음
    const detail =
      entry.category === "지출" && entry.subCategory === "대출상환"
        ? entry.detailCategory
        : entry.category === "대출상환"
          ? entry.subCategory
          : undefined;
    // 새 체계(원금상환/이자상환)에 있으면 그대로, legacy면 "이자" 키워드로 분류
    const interestOption = loanRepaymentSubOptions.find((s) => s.includes("이자")) ?? "이자상환";
    const principalOption = loanRepaymentSubOptions.find((s) => s.includes("원금")) ?? "원금상환";
    return detail && loanRepaymentSubOptions.includes(detail)
      ? detail
      : (detail || "").includes("이자")
        ? interestOption
        : principalOption;
  });
  const [editFromAccountId, setEditFromAccountId] = useState(entry.fromAccountId || "");
  const [editDate, setEditDate] = useState(() => entry.date || getTodayKST());
  const [editDescription, setEditDescription] = useState(entry.description || "");

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

  const handleSaveEditRepayment = () => {
    const amount = Number(editAmount.replace(/[^0-9]/g, "")) || 0;
    if (amount <= 0) {
      alert("상환 금액을 입력해주세요.");
      return;
    }
    if (!editFromAccountId) {
      alert("출금 계좌를 선택해주세요.");
      return;
    }
    if (!editSubCategory) {
      alert("세부 항목을 선택해주세요.");
      return;
    }
    // 날짜 빈값 거부 — date input은 지우기로 빈 문자열이 될 수 있다
    if (!editDate) {
      alert("날짜를 입력해주세요.");
      return;
    }

    // 원금 상환이 해당 대출의 잔금(이 내역 제외)을 초과하면 경고 (저장은 진행 — 잔금은 0으로 클램프)
    if (matchRepaymentLoan && !editSubCategory.includes("이자")) {
      const draft: LedgerEntry = { ...entry, description: editDescription || entry.description };
      const loan = matchRepaymentLoan(draft);
      if (loan) {
        const principalPaidOthers = ledger.reduce((s, l) => {
          if (l.id === entry.id) return s;
          if (!isLoanRepaymentEntry(l)) return s;
          if (isInterestRepayment(l)) return s;
          if (matchRepaymentLoan(l)?.id !== loan.id) return s;
          return s + l.amount;
        }, 0);
        const remaining = Math.max(0, loan.loanAmount - principalPaidOthers);
        if (amount > remaining) {
          toast(
            `상환 금액이 현재 잔금(${formatKRW(Math.round(remaining))})을 초과합니다 — 잔금은 0원으로 처리됩니다.`,
            { icon: "⚠️" }
          );
        }
      }
    }
    const updated: LedgerEntry = {
      ...entry,
      date: editDate,
      amount,
      fromAccountId: editFromAccountId,
      // 저장 시 현재 3단계 구조로 승격 (편집으로 자연 마이그레이션)
      category: "지출",
      subCategory: "대출상환",
      detailCategory: editSubCategory,
      description: editDescription || entry.description
    };
    onChangeLedger(ledger.map((l) => (l.id === entry.id ? updated : l)));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-repayment-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400 }}
      >
        <div className="modal-header">
          <h3 id="edit-repayment-modal-title">상환 내역 수정</h3>
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
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>상세내역</span>
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="예: 학자금대출 상환"
              style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}
            />
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>상환 금액 *</span>
            <input
              type="text"
              inputMode="numeric"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="예: 1000000"
              style={{ width: "100%", padding: "10px 12px", fontSize: 16 }}
              autoFocus
            />
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 8 }}>세부 항목 *</span>
            <select
              value={editSubCategory}
              onChange={(e) => setEditSubCategory(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)"
              }}
            >
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
              value={editFromAccountId}
              onChange={(e) => setEditFromAccountId(e.target.value)}
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
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}
            />
          </label>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              취소
            </button>
            <button type="button" className="primary" onClick={handleSaveEditRepayment}>
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
