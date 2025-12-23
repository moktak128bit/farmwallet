import React, { useState } from "react";
import type { Account, LedgerEntry } from "../types";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
}

export const DebtView: React.FC<Props> = ({ accounts, ledger, onChangeLedger }) => {
  const [debtForm, setDebtForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    description: "",
    amount: "",
    isSettled: true
  });

  const [debtInterestForm, setDebtInterestForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    description: "",
    amount: "",
    isSettled: true
  });

  const handleDebtSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(debtForm.amount);
    if (!debtForm.date || !debtForm.accountId || !debtForm.description || !amount || amount <= 0) {
      return;
    }

    // Ledger 항목 추가 (expense)
    // 정리된 경우에만 fromAccountId를 설정하여 computeAccountBalances에서 자동 계산되도록 함
    const entry: LedgerEntry = {
      id: `DEBT${Date.now()}`,
      date: debtForm.date,
      kind: "expense",
      category: "대출",
      subCategory: "빚",
      description: debtForm.description,
      fromAccountId: debtForm.isSettled ? debtForm.accountId : undefined,
      amount: amount,
      note: debtForm.isSettled ? "정리됨" : "미정리"
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setDebtForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: debtForm.accountId,
      description: "",
      amount: "",
      isSettled: true
    });
  };

  const handleDebtInterestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(debtInterestForm.amount);
    if (!debtInterestForm.date || !debtInterestForm.accountId || !debtInterestForm.description || !amount || amount <= 0) {
      return;
    }

    // Ledger 항목 추가 (expense)
    // 정리된 경우에만 fromAccountId를 설정하여 computeAccountBalances에서 자동 계산되도록 함
    const entry: LedgerEntry = {
      id: `DEBTINT${Date.now()}`,
      date: debtInterestForm.date,
      kind: "expense",
      category: "대출",
      subCategory: "빚이자",
      description: debtInterestForm.description,
      fromAccountId: debtInterestForm.isSettled ? debtInterestForm.accountId : undefined,
      amount: amount,
      note: debtInterestForm.isSettled ? "정리됨" : "미정리"
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setDebtInterestForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: debtInterestForm.accountId,
      description: "",
      amount: "",
      isSettled: true
    });
  };

  // 부채 관련 거래 필터링
  const debtEntries = ledger.filter(
    (l) =>
      l.kind === "expense" &&
      (l.category === "대출" || l.subCategory === "빚" || l.subCategory === "빚이자")
  );

  const totalDebt = debtEntries
    .filter((l) => l.subCategory === "빚")
    .reduce((sum, l) => sum + l.amount, 0);
  const totalDebtInterest = debtEntries
    .filter((l) => l.subCategory === "빚이자")
    .reduce((sum, l) => sum + l.amount, 0);

  return (
    <div>
      <div className="section-header">
        <h2>부채 관리</h2>
      </div>

      <div className="cards-row">
        <div className="card highlight">
          <div className="card-title">총 부채</div>
          <div className="card-value">
            {Math.round(totalDebt).toLocaleString()} 원
          </div>
        </div>
        <div className="card">
          <div className="card-title">총 부채 이자</div>
          <div className="card-value">
            {Math.round(totalDebtInterest).toLocaleString()} 원
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>빚 입력</h3>
        <form onSubmit={handleDebtSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
              <input
                type="date"
                value={debtForm.date}
                onChange={(e) => setDebtForm({ ...debtForm, date: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
              <select
                value={debtForm.accountId}
                onChange={(e) => setDebtForm({ ...debtForm, accountId: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              >
                <option value="">선택</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.id}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>빚 설명</span>
              <input
                type="text"
                value={debtForm.description}
                placeholder="예: 학자금대출, 주담대 등"
                onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>금액</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={debtForm.amount}
                onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={debtForm.isSettled}
                  onChange={(e) => setDebtForm({ ...debtForm, isSettled: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>정리됨 (체크하면 해당 계좌에서 금액이 차감됩니다)</span>
              </div>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
              추가
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>빚 이자 입력</h3>
        <form onSubmit={handleDebtInterestSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
              <input
                type="date"
                value={debtInterestForm.date}
                onChange={(e) => setDebtInterestForm({ ...debtInterestForm, date: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
              <select
                value={debtInterestForm.accountId}
                onChange={(e) => setDebtInterestForm({ ...debtInterestForm, accountId: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              >
                <option value="">선택</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.id}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>빚 이자 설명</span>
              <input
                type="text"
                value={debtInterestForm.description}
                placeholder="예: 학자금대출 이자, 주담대 이자 등"
                onChange={(e) => setDebtInterestForm({ ...debtInterestForm, description: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>금액</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={debtInterestForm.amount}
                onChange={(e) => setDebtInterestForm({ ...debtInterestForm, amount: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={debtInterestForm.isSettled}
                  onChange={(e) => setDebtInterestForm({ ...debtInterestForm, isSettled: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>정리됨 (체크하면 해당 계좌에서 금액이 차감됩니다)</span>
              </div>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
              추가
            </button>
          </div>
        </form>
      </div>

      <h3>부채 내역</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>계좌</th>
            <th>설명</th>
            <th>구분</th>
            <th>금액</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {debtEntries.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                부채 내역이 없습니다.
              </td>
            </tr>
          ) : (
            debtEntries
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>{entry.fromAccountId || "-"}</td>
                  <td>{entry.description}</td>
                  <td>{entry.subCategory === "빚이자" ? "빚이자" : "빚"}</td>
                  <td className="number negative">{Math.round(entry.amount).toLocaleString()} 원</td>
                  <td>{entry.note || "-"}</td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  );
};




