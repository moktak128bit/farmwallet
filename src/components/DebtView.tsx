import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import type { Loan, RepaymentMethod, LedgerEntry, Account, CategoryPresets } from "../types";
import { formatKRW } from "../utils/formatter";

const DEFAULT_LOAN_REPAYMENT_SUBS = ["학자금대출", "주담대원금", "주담대이자", "개인대출", "기타대출상환"];

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
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [repayingLoan, setRepayingLoan] = useState<Loan | null>(null);
  const [editingRepayment, setEditingRepayment] = useState<LedgerEntry | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayFromAccountId, setRepayFromAccountId] = useState("");
  const [repaySubCategory, setRepaySubCategory] = useState("");
  const [repayDate, setRepayDate] = useState(new Date().toISOString().slice(0, 10));
  const [editAmount, setEditAmount] = useState("");
  const [editSubCategory, setEditSubCategory] = useState("");
  const [editFromAccountId, setEditFromAccountId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const loanRepaymentSubOptions = useMemo(() => {
    const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === "대출상환");
    const subs = g?.subs;
    return subs && subs.length > 0 ? subs : DEFAULT_LOAN_REPAYMENT_SUBS;
  }, [categoryPresets]);
  const [form, setForm] = useState({
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const loanAmount = Number(form.loanAmount.replace(/,/g, "")) || 0;
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
    setForm({
      institution: "",
      loanName: "",
      subCategory: "",
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
    const sub = loan.subCategory || "";
    setForm({
      institution: loan.institution,
      loanName: loan.loanName,
      subCategory: loanRepaymentSubOptions.includes(sub) ? sub : loanRepaymentSubOptions[0] ?? "",
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

  const handleRepaySubmit = () => {
    if (!repayingLoan || !onChangeLedger) return;
    const amount = Number(repayAmount.replace(/,/g, "")) || 0;
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

    const newEntry: LedgerEntry = {
      id: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      date: repayDate,
      kind: "expense",
      category: "대출상환",
      subCategory: repaySubCategory,
      description: `${repayingLoan.loanName} 상환`,
      fromAccountId: repayFromAccountId,
      amount
    };

    onChangeLedger([...ledger, newEntry]);
    setRepayingLoan(null);
    setRepayAmount("");
    setRepayFromAccountId("");
    setRepaySubCategory("");
    setRepayDate(new Date().toISOString().slice(0, 10));
  };

  // 지금까지 갚은 내역 (가계부 지출 - 대출상환 또는 기존 대출/빚)
  const isLoanRepaymentEntry = (l: LedgerEntry) =>
    l.kind === "expense" &&
    ((l.category === "대출" && l.subCategory === "빚") || l.category === "대출상환");

  const repaymentEntries = useMemo(() => {
    return ledger
      .filter(isLoanRepaymentEntry)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [ledger]);


  const [repaymentFilterDebtId, setRepaymentFilterDebtId] = useState<string>("");

  const matchRepaymentLoan = (entry: LedgerEntry): Loan | null => {
    const description = entry.description || "";
    return loans.find((loan) => description.includes(loan.loanName)) ?? null;
  };

  const repaymentByDebt = useMemo(() => {
    const map = new Map<string, { label: string; entries: LedgerEntry[]; total: number }>();

    loans.forEach((loan) => {
      map.set(loan.id, { label: loan.loanName, entries: [], total: 0 });
    });

    repaymentEntries.forEach((entry) => {
      const loan = matchRepaymentLoan(entry);
      const debtId = loan?.id ?? "__unmatched__";
      const label = loan?.loanName ?? "매칭 안 됨";
      const current = map.get(debtId) ?? { label, entries: [], total: 0 };
      current.entries.push(entry);
      current.total += entry.amount;
      map.set(debtId, current);
    });

    return map;
  }, [repaymentEntries, loans]);

  const debtFilterOptions = useMemo(() => {
    const all = Array.from(repaymentByDebt.entries()).map(([id, group]) => ({
      id,
      label: group.label,
      count: group.entries.length,
      total: group.total
    }));

    all.sort((a, b) => {
      if (a.id === "__unmatched__") return 1;
      if (b.id === "__unmatched__") return -1;
      const ia = loans.findIndex((l) => l.id === a.id);
      const ib = loans.findIndex((l) => l.id === b.id);
      return ia - ib;
    });

    return all;
  }, [repaymentByDebt, loans]);

  const visibleRepaymentGroups = useMemo(() => {
    if (repaymentFilterDebtId) {
      const selected = repaymentByDebt.get(repaymentFilterDebtId);
      return selected ? [[repaymentFilterDebtId, selected] as const] : [];
    }

    return Array.from(repaymentByDebt.entries())
      .filter(([, group]) => group.entries.length > 0)
      .sort((a, b) => {
        if (a[0] === "__unmatched__") return 1;
        if (b[0] === "__unmatched__") return -1;
        const ia = loans.findIndex((l) => l.id === a[0]);
        const ib = loans.findIndex((l) => l.id === b[0]);
        return ia - ib;
      });
  }, [repaymentByDebt, repaymentFilterDebtId, loans]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const openEditRepayment = (entry: LedgerEntry) => {
    setEditingRepayment(entry);
    setEditAmount(String(Math.round(entry.amount)));
    const sub = entry.subCategory || "기타대출상환";
    setEditSubCategory(loanRepaymentSubOptions.includes(sub) ? sub : "기타대출상환");
    setEditFromAccountId(entry.fromAccountId || "");
    setEditDate(entry.date || new Date().toISOString().slice(0, 10));
    setEditDescription(entry.description || "");
  };

  const handleSaveEditRepayment = () => {
    if (!editingRepayment || !onChangeLedger) return;
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
    const updated: LedgerEntry = {
      ...editingRepayment,
      date: editDate,
      amount,
      fromAccountId: editFromAccountId,
      category: "대출상환",
      subCategory: editSubCategory,
      description: editDescription || editingRepayment.description
    };
    onChangeLedger(ledger.map((l) => (l.id === editingRepayment.id ? updated : l)));
    setEditingRepayment(null);
  };

  const handleDeleteRepayment = (entry: LedgerEntry) => {
    if (!onChangeLedger) return;
    if (!window.confirm(`"${entry.description || "상환"}" 내역을 삭제하시겠습니까?`)) return;
    onChangeLedger(ledger.filter((l) => l.id !== entry.id));
  };

  // 대출별 상환 내역 계산 (설명에 대출명 포함된 건 매칭)
  const loanRepayments = useMemo(() => {
    const repayments = new Map<string, number>();
    ledger
      .filter(isLoanRepaymentEntry)
      .forEach((l) => {
        const loan = matchRepaymentLoan(l);
        if (loan) {
          repayments.set(loan.id, (repayments.get(loan.id) || 0) + l.amount);
        }
      });
    return repayments;
  }, [ledger, loans]);

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

  const calculateTotalRepayment = (loan: Loan): number => {
    return loan.loanAmount + calculateTotalInterest(loan);
  };

  const repaymentMethodLabel: Record<RepaymentMethod, string> = {
    equal_payment: "원리금균등",
    equal_principal: "원금균등",
    bullet: "만기일시"
  };

  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.type === "checking" || a.type === "savings" || a.type === "other"),
    [accounts]
  );

  return (
    <div>
      <div className="section-header">
        <h2>대출 관리</h2>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setShowForm(!showForm);
            setEditingLoan(null);
            setForm({
              institution: "",
              loanName: "",
              subCategory: "",
              loanAmount: "",
              annualInterestRate: "",
              repaymentMethod: "equal_payment",
              loanDate: new Date().toISOString().slice(0, 10),
              maturityDate: "",
              gracePeriodYears: ""
            });
          }}
        >
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
                <span>세부 항목 *</span>
                <select
                  value={form.subCategory}
                  onChange={(e) => setForm({ ...form, subCategory: e.target.value })}
                  required
                >
                  <option value="">선택</option>
                  {loanRepaymentSubOptions.map((sub) => (
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
      )}

      {loans.length === 0 ? (
        <p>등록된 대출이 없습니다. 새 대출을 추가해보세요.</p>
      ) : (
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
            const totalPeriod = daysBetween(loan.loanDate, loan.maturityDate);
            const remainingPeriod = daysBetween(today, loan.maturityDate);
            const totalInterest = calculateTotalInterest(loan);
            const totalRepayment = calculateTotalRepayment(loan);
            const accumulatedRepayment = loanRepayments.get(loan.id) || 0;
            const currentBalance = loan.loanAmount - accumulatedRepayment;

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
                        handleEdit(loan);
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

                {onChangeLedger && (
                  <button
                    type="button"
                    className="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRepayingLoan(loan);
                      setRepayAmount("");
                      setRepayFromAccountId(cashAccounts[0]?.id ?? "");
                      const sub = loan.subCategory && loanRepaymentSubOptions.includes(loan.subCategory) ? loan.subCategory : loanRepaymentSubOptions[0] ?? "";
                      setRepaySubCategory(sub);
                      setRepayDate(new Date().toISOString().slice(0, 10));
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
      )}

      {/* 지금까지 갚은 내역 (가계부 지출 반영) */}
      <div
        className="card"
        style={{
          marginTop: 32,
          padding: 0,
          overflow: "hidden",
          border: "2px solid var(--border)",
          borderRadius: 12
        }}
      >
        <button
          type="button"
          onClick={() => setShowRepaymentHistory((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            border: "none",
            background: "var(--surface)",
            cursor: "pointer",
            fontSize: 17,
            fontWeight: 700,
            color: "var(--text)",
            textAlign: "left"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            지금까지 갚은 내역
            {repaymentEntries.length > 0 && (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--primary)",
                  background: "var(--primary-muted)",
                  padding: "4px 10px",
                  borderRadius: 20
                }}
              >
                {repaymentEntries.length}건 · {formatKRW(Math.round(repaymentEntries.reduce((s, e) => s + e.amount, 0)))}
              </span>
            )}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
            {showRepaymentHistory ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
          </span>
        </button>
        {showRepaymentHistory && (
          <>
            {repaymentEntries.length > 0 && (
              <div
                style={{
                  padding: "16px 20px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--bg)"
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>부채별 보기</span>
                  <select
                    value={repaymentFilterDebtId}
                    onChange={(e) => setRepaymentFilterDebtId(e.target.value)}
                    style={{
                      width: "100%",
                      maxWidth: 360,
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      fontSize: 14,
                      fontWeight: 500
                    }}
                  >
                    <option value="">전체 부채</option>
                    {debtFilterOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label} · {opt.count}건 · {formatKRW(Math.round(opt.total))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div
              style={{
                maxHeight: 520,
                overflowY: "auto",
                borderTop: repaymentEntries.length > 0 ? "1px solid var(--border)" : undefined
              }}
            >
              {repaymentEntries.length === 0 ? (
                <div
                  style={{
                    padding: 48,
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: 15,
                    lineHeight: 1.6
                  }}
                >
                  <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--text)" }}>아직 상환 내역이 없습니다</p>
                  <p style={{ margin: 0 }}>부채 카드의 「갚기」 버튼으로 상환하면 가계부 지출에 자동 반영됩니다.</p>
                </div>
              ) : visibleRepaymentGroups.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                  선택한 부채에 해당하는 내역이 없습니다.
                </div>
              ) : (
                visibleRepaymentGroups.map(([debtId, group]) => {
                  const entries = [...group.entries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                  return (
                    <div
                      key={debtId}
                      style={{
                        borderBottom: "2px solid var(--border)",
                        marginBottom: 0
                      }}
                    >
                      <div
                        style={{
                          padding: "14px 20px",
                          background: "var(--surface)",
                          fontWeight: 700,
                          fontSize: 15,
                          color: "var(--primary)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderBottom: "1px solid var(--border)"
                        }}
                      >
                        <span>{group.label}</span>
                        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                          {entries.length}건 · 합계 {formatKRW(Math.round(group.total))}
                        </span>
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                          <tr style={{ background: "var(--bg)" }}>
                            <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>날짜</th>
                            <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>상세</th>
                            <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>금액</th>
                            {onChangeLedger && <th style={{ padding: "10px 20px", width: 72 }} />}
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((e) => (
                            <tr
                              key={e.id}
                              style={{
                                borderBottom: "1px solid var(--border)",
                                transition: "background 0.15s"
                              }}
                              onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--surface)")}
                              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                            >
                              <td style={{ padding: "14px 20px", verticalAlign: "top", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
                                {e.date}
                              </td>
                              <td style={{ padding: "14px 20px", verticalAlign: "top" }}>
                                <div>
                                  <span style={{ fontWeight: 500 }}>{e.description || "(상환)"}</span>
                                  {e.subCategory && (
                                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--primary)" }}>{e.subCategory}</span>
                                  )}
                                  {e.fromAccountId && (
                                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                                      출금: {accountName(e.fromAccountId)}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: "14px 20px", verticalAlign: "top", textAlign: "right", fontWeight: 700, color: "var(--chart-expense)", fontSize: 15 }}>
                                {formatKRW(Math.round(e.amount))}
                              </td>
                              {onChangeLedger && (
                                <td style={{ padding: "10px 20px", verticalAlign: "top" }}>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    <button
                                      type="button"
                                      onClick={() => openEditRepayment(e)}
                                      title="수정"
                                      style={{
                                        padding: 8,
                                        border: "none",
                                        background: "var(--surface)",
                                        cursor: "pointer",
                                        color: "var(--text-muted)",
                                        borderRadius: 6
                                      }}
                                    >
                                      <Pencil size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRepayment(e)}
                                      title="삭제"
                                      style={{
                                        padding: 8,
                                        border: "none",
                                        background: "var(--surface)",
                                        cursor: "pointer",
                                        color: "var(--danger)",
                                        borderRadius: 6
                                      }}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {repayingLoan && onChangeLedger && (
        <div className="modal-backdrop" onClick={() => setRepayingLoan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>{repayingLoan.loanName} 상환</h3>
              <button
                type="button"
                onClick={() => setRepayingLoan(null)}
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
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
                현재 잔금: {formatKRW(Math.round(repayingLoan.loanAmount - (loanRepayments.get(repayingLoan.id) || 0)))}
              </p>
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
                <button type="button" onClick={() => setRepayingLoan(null)}>
                  취소
                </button>
                <button type="button" className="primary" onClick={handleRepaySubmit}>
                  상환 기록
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingRepayment && onChangeLedger && (
        <div className="modal-backdrop" onClick={() => setEditingRepayment(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>상환 내역 수정</h3>
              <button
                type="button"
                onClick={() => setEditingRepayment(null)}
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
                <button type="button" onClick={() => setEditingRepayment(null)}>
                  취소
                </button>
                <button type="button" className="primary" onClick={handleSaveEditRepayment}>
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
