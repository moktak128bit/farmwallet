/**
 * 대출 추가/수정 폼 — form/editingLoan 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(DebtPage)를 재렌더하지 않는다.
 * React.memo(forwardRef)로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 그대로)이어야 memo가 효과를 가진다.
 *
 * 부모는 이 컴포넌트를 항상 마운트하고 visible=false면 null을 렌더한다
 * (ref 접점 유지 + DOM 제거 — 분리 전 동작과 동일).
 *
 * 부모 → 폼 외부 접점은 ref API(LoanFormSectionHandle)로 노출:
 *   - startEdit(loan): 대출 카드 "수정" — 기존 대출을 폼에 적재 (부모는 setShowForm(true)도 호출)
 *   - resetForm():     헤더 토글 버튼 — 폼 초기화 + 수정 모드 해제
 */
import React, { useImperativeHandle, useState } from "react";
import type { Loan, RepaymentMethod } from "../../types";
import { parseAmount } from "../../utils/parseAmount";

/** Loan.subCategory용 — 대출 종류 */
const LOAN_TYPE_OPTIONS = ["학자금대출", "주담대", "개인대출", "기타대출"];

/** legacy Loan.subCategory → 새 LOAN_TYPE_OPTIONS 매핑 (편집 UI용) */
function mapLegacyLoanType(sub: string): string {
  if (LOAN_TYPE_OPTIONS.includes(sub)) return sub;
  if (sub.startsWith("주담대")) return "주담대";
  if (sub.includes("기타")) return "기타대출";
  return LOAN_TYPE_OPTIONS[0];
}

const createEmptyForm = () => ({
  institution: "",
  loanName: "",
  subCategory: "",
  loanAmount: "",
  annualInterestRate: "",
  repaymentMethod: "equal_payment" as RepaymentMethod,
  loanDate: new Date().toISOString().slice(0, 10),
  maturityDate: "",
  gracePeriodYears: ""
});

/** 부모(DebtPage)에서 ref로 호출하는 폼 외부 접점 */
export interface LoanFormSectionHandle {
  startEdit: (loan: Loan) => void;
  resetForm: () => void;
}

interface Props {
  /** showForm일 때만 표시 — false면 null 렌더 (ref 접점은 유지) */
  visible: boolean;
  loans: Loan[];
  onChangeLoans: (loans: Loan[]) => void;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
}

export const LoanFormSection = React.memo(React.forwardRef<LoanFormSectionHandle, Props>(
  function LoanFormSection({ visible, loans, onChangeLoans, setShowForm }, ref) {
    const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
    const [form, setForm] = useState(createEmptyForm);

    useImperativeHandle(ref, () => ({
      startEdit: (loan: Loan) => {
        setEditingLoan(loan);
        const sub = loan.subCategory || "";
        setForm({
          institution: loan.institution,
          loanName: loan.loanName,
          subCategory: sub ? mapLegacyLoanType(sub) : LOAN_TYPE_OPTIONS[0],
          loanAmount: String(loan.loanAmount),
          annualInterestRate: String(loan.annualInterestRate),
          repaymentMethod: loan.repaymentMethod,
          loanDate: loan.loanDate,
          maturityDate: loan.maturityDate,
          gracePeriodYears: loan.gracePeriodYears ? String(loan.gracePeriodYears) : ""
        });
      },
      resetForm: () => {
        setEditingLoan(null);
        setForm(createEmptyForm());
      }
    }), []);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const loanAmount = parseAmount(form.loanAmount);
      const annualInterestRate = Number(form.annualInterestRate) || 0;
      const gracePeriodYears = form.gracePeriodYears ? Number(form.gracePeriodYears) : undefined;

      if (!form.institution || !form.loanName || !form.subCategory || !loanAmount || !form.loanDate || !form.maturityDate) {
        alert("필수 항목을 모두 입력해주세요.");
        return;
      }

      const loan: Loan = {
        id: editingLoan?.id || `LOAN-${Date.now()}`,
        institution: form.institution,
        loanName: form.loanName,
        subCategory: form.subCategory,
        loanAmount,
        annualInterestRate,
        repaymentMethod: form.repaymentMethod,
        loanDate: form.loanDate,
        maturityDate: form.maturityDate,
        gracePeriodYears
      };

      if (editingLoan) {
        onChangeLoans(loans.map((l) => (l.id === editingLoan.id ? loan : l)));
        setEditingLoan(null);
      } else {
        onChangeLoans([...loans, loan]);
      }

      setShowForm(false);
      setForm(createEmptyForm());
    };

    if (!visible) return null;

    return (
      <div className="card">
        <h3>{editingLoan ? "대출 수정" : "새 대출 추가"}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              <span>기관명 *</span>
              <input
                type="text"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
                placeholder="예: 국민은행"
                required
              />
            </label>
            <label>
              <span>대출명 *</span>
              <input
                type="text"
                value={form.loanName}
                onChange={(e) => setForm({ ...form, loanName: e.target.value })}
                placeholder="예: 주택담보대출"
                required
              />
            </label>
            <label>
              <span>대출 종류 *</span>
              <select
                value={form.subCategory}
                onChange={(e) => setForm({ ...form, subCategory: e.target.value })}
                required
              >
                <option value="">선택</option>
                {LOAN_TYPE_OPTIONS.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>대출금액 *</span>
              <input
                type="text"
                value={form.loanAmount}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  setForm({ ...form, loanAmount: val });
                }}
                placeholder="예: 300000000"
                required
              />
            </label>
            <label>
              <span>연이자율 (%) *</span>
              <input
                type="number"
                step="0.01"
                value={form.annualInterestRate}
                onChange={(e) => setForm({ ...form, annualInterestRate: e.target.value })}
                placeholder="예: 3.5"
                required
              />
            </label>
            <label>
              <span>상환방법 *</span>
              <select
                value={form.repaymentMethod}
                onChange={(e) => setForm({ ...form, repaymentMethod: e.target.value as RepaymentMethod })}
                required
              >
                <option value="equal_payment">원리금균등상환</option>
                <option value="equal_principal">원금균등상환</option>
                <option value="bullet">만기일시상환</option>
              </select>
            </label>
            <label>
              <span>대출일 *</span>
              <input
                type="date"
                value={form.loanDate}
                onChange={(e) => setForm({ ...form, loanDate: e.target.value })}
                required
              />
            </label>
            <label>
              <span>상환만기일 *</span>
              <input
                type="date"
                value={form.maturityDate}
                onChange={(e) => setForm({ ...form, maturityDate: e.target.value })}
                required
              />
            </label>
            <label>
              <span>거치년도 (선택)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.gracePeriodYears}
                onChange={(e) => setForm({ ...form, gracePeriodYears: e.target.value })}
                placeholder="예: 2"
              />
            </label>
          </div>
          <div className="form-actions">
            {editingLoan && (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingLoan(null);
                }}
              >
                취소
              </button>
            )}
            <button type="submit" className="primary">
              {editingLoan ? "수정" : "추가"}
            </button>
          </div>
        </form>
      </div>
    );
  }
));
