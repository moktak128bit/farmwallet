import React, { useState, useMemo } from "react";
import type { Loan, RepaymentMethod, LedgerEntry } from "../types";
import { formatNumber } from "../utils/formatter";

interface Props {
  loans?: Loan[];
  ledger: LedgerEntry[];
  onChangeLoans: (loans: Loan[]) => void;
}

export const DebtView: React.FC<Props> = ({ loans = [], ledger, onChangeLoans }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [form, setForm] = useState({
    institution: "",
    loanName: "",
    loanAmount: "",
    annualInterestRate: "",
    repaymentMethod: "equal_payment" as RepaymentMethod,
    loanDate: new Date().toISOString().slice(0, 10),
    maturityDate: "",
    gracePeriodYears: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const loanAmount = Number(form.loanAmount.replace(/,/g, "")) || 0;
    const annualInterestRate = Number(form.annualInterestRate) || 0;
    const gracePeriodYears = form.gracePeriodYears ? Number(form.gracePeriodYears) : undefined;

    if (!form.institution || !form.loanName || !loanAmount || !form.loanDate || !form.maturityDate) {
      alert("필수 항목을 모두 입력해주세요.");
      return;
    }

    const loan: Loan = {
      id: editingLoan?.id || `LOAN-${Date.now()}`,
      institution: form.institution,
      loanName: form.loanName,
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
    setForm({
      institution: "",
      loanName: "",
      loanAmount: "",
      annualInterestRate: "",
      repaymentMethod: "equal_payment",
      loanDate: new Date().toISOString().slice(0, 10),
      maturityDate: "",
      gracePeriodYears: ""
    });
  };

  const handleEdit = (loan: Loan) => {
    setEditingLoan(loan);
    setForm({
      institution: loan.institution,
      loanName: loan.loanName,
      loanAmount: String(loan.loanAmount),
      annualInterestRate: String(loan.annualInterestRate),
      repaymentMethod: loan.repaymentMethod,
      loanDate: loan.loanDate,
      maturityDate: loan.maturityDate,
      gracePeriodYears: loan.gracePeriodYears ? String(loan.gracePeriodYears) : ""
    });
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm("정말 이 대출을 삭제하시겠습니까?")) {
      onChangeLoans(loans.filter((l) => l.id !== id));
    }
  };

  // 대출별 상환 내역 계산
  const loanRepayments = useMemo(() => {
    const repayments = new Map<string, number>();
    ledger
      .filter((l) => l.category === "대출" && l.subCategory === "빚")
      .forEach((l) => {
        // 설명에서 대출명을 찾아서 매칭 (간단한 방식)
        const loan = loans.find((loan) => l.description.includes(loan.loanName));
        if (loan) {
          repayments.set(loan.id, (repayments.get(loan.id) || 0) + l.amount);
        }
      });
    return repayments;
  }, [ledger, loans]);

  // 날짜 차이 계산 (일 단위)
  const daysBetween = (date1: string, date2: string): number => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  };

  // 년/월/일 형식으로 변환
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

  // 이자 계산 (간단한 방식)
  const calculateTotalInterest = (loan: Loan): number => {
    const totalDays = daysBetween(loan.loanDate, loan.maturityDate);
    const totalYears = totalDays / 365;
    const graceYears = loan.gracePeriodYears || 0;
    const repaymentYears = totalYears - graceYears;

    if (repaymentYears <= 0) return 0;

    const monthlyRate = loan.annualInterestRate / 100 / 12;
    const months = repaymentYears * 12;

    if (loan.repaymentMethod === "equal_payment") {
      // 원리금균등상환
      if (monthlyRate === 0) return 0;
      const monthlyPayment = (loan.loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
      return monthlyPayment * months - loan.loanAmount;
    } else if (loan.repaymentMethod === "equal_principal") {
      // 원금균등상환
      const monthlyPrincipal = loan.loanAmount / months;
      let totalInterest = 0;
      let remainingPrincipal = loan.loanAmount;
      for (let i = 0; i < months; i++) {
        const monthlyInterest = remainingPrincipal * monthlyRate;
        totalInterest += monthlyInterest;
        remainingPrincipal -= monthlyPrincipal;
      }
      return totalInterest;
    } else {
      // 만기일시상환
      return loan.loanAmount * (loan.annualInterestRate / 100) * repaymentYears;
    }
  };

  const calculateTotalRepayment = (loan: Loan): number => {
    return loan.loanAmount + calculateTotalInterest(loan);
  };

  return (
    <div>
      <div className="section-header">
        <h2>대출 관리</h2>
        <button type="button" className="primary" onClick={() => {
          setShowForm(!showForm);
          setEditingLoan(null);
          setForm({
            institution: "",
            loanName: "",
            loanAmount: "",
            annualInterestRate: "",
            repaymentMethod: "equal_payment",
            loanDate: new Date().toISOString().slice(0, 10),
            maturityDate: "",
            gracePeriodYears: ""
          });
        }}>
          {showForm ? "입력 닫기" : "새 대출 추가"}
        </button>
      </div>

      {showForm && (
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
                <button type="button" onClick={() => {
                  setShowForm(false);
                  setEditingLoan(null);
                }}>
                  취소
                </button>
              )}
              <button type="submit" className="primary">
                {editingLoan ? "수정" : "추가"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loans.length === 0 ? (
        <p>등록된 대출이 없습니다. 새 대출을 추가해보세요.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "50px" }}>No.</th>
              <th>기관명</th>
              <th>대출명</th>
              <th>대출일</th>
              <th>만기일</th>
              <th>가입기간</th>
              <th>남은기간</th>
              <th className="number">대출금액</th>
              <th className="number">총 대출이자</th>
              <th className="number">총 상환금액</th>
              <th className="number">현재누적상환금</th>
              <th className="number">현재대출잔금</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan, index) => {
              const today = new Date().toISOString().slice(0, 10);
              const totalPeriod = daysBetween(loan.loanDate, loan.maturityDate);
              const remainingPeriod = daysBetween(today, loan.maturityDate);
              const totalInterest = calculateTotalInterest(loan);
              const totalRepayment = calculateTotalRepayment(loan);
              const accumulatedRepayment = loanRepayments.get(loan.id) || 0;
              const currentBalance = loan.loanAmount - accumulatedRepayment;

              return (
                <tr key={loan.id}>
                  <td>{index + 1}</td>
                  <td>{loan.institution}</td>
                  <td>{loan.loanName}</td>
                  <td>{loan.loanDate}</td>
                  <td>{loan.maturityDate}</td>
                  <td>{formatPeriod(totalPeriod)}</td>
                  <td>{formatPeriod(remainingPeriod)}</td>
                  <td className="number">{formatNumber(loan.loanAmount)}</td>
                  <td className="number">{formatNumber(Math.round(totalInterest))}</td>
                  <td className="number">{formatNumber(Math.round(totalRepayment))}</td>
                  <td className="number">{formatNumber(Math.round(accumulatedRepayment))}</td>
                  <td className={`number ${currentBalance >= 0 ? "positive" : "negative"}`}>
                    {formatNumber(Math.round(currentBalance))}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="button" className="primary" onClick={() => handleEdit(loan)} style={{ fontSize: "13px", padding: "6px 12px" }}>
                        수정
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(loan.id)} style={{ fontSize: "13px", padding: "6px 12px" }}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
