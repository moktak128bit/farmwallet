/**
 * 이자 입력 폼.
 * DividendsPage에서 분리 — interestForm 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(DividendsPage)를 재렌더하지 않는다.
 * React.memo로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 탭 전환(배당/이자) 시에도 폼 상태가 유지되도록 부모는 이 컴포넌트를 항상 마운트하고,
 * visible=false면 null을 렌더한다 (상태 보존 + DOM 제거 — 분리 전 동작과 동일).
 */
import React, { useState } from "react";
import type { Account, LedgerEntry } from "../../types";
import { getTodayKST } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";

interface Props {
  /** 이자 탭에서만 표시 — false면 null 렌더 (폼 상태는 유지) */
  visible: boolean;
  accounts: Account[];
  ledger: LedgerEntry[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
}

export const InterestFormSection: React.FC<Props> = React.memo(function InterestFormSection({
  visible,
  accounts,
  ledger,
  onChangeLedger
}) {
  // 이자 입력 폼
  const [interestForm, setInterestForm] = useState({
    date: getTodayKST(),
    accountId: "",
    amount: "",
    rate: "", // 이율 (%)
    tax: "" // 세금
  });

  const handleInterestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(interestForm.amount);
    const rate = interestForm.rate ? Number(interestForm.rate) : null;
    const tax = interestForm.tax ? Number(interestForm.tax) : 0;

    if (!interestForm.date || !interestForm.accountId || !amount || amount <= 0) {
      return;
    }

    const description = `이자${rate != null ? ` (이율: ${rate}%)` : ""}${tax > 0 ? `, 세금: ${tax.toLocaleString()}원` : ""}`;
    const entry: LedgerEntry = {
      id: newIdWithPrefix("I"),
      date: interestForm.date,
      kind: "income",
      category: "이자",
      description: description,
      toAccountId: interestForm.accountId,
      amount: amount - tax // 세금 제외한 순 이자
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setInterestForm({
      date: getTodayKST(),
      accountId: interestForm.accountId,
      amount: "",
      rate: "",
      tax: ""
    });
  };

  if (!visible) return null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>이자 입력</h3>
      <p className="hint" style={{ marginBottom: 12 }}>
        받은 이자를 입력하세요. 이율과 세금을 함께 기록할 수 있습니다.
      </p>
      <form onSubmit={handleInterestSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
            <input
              type="date"
              value={interestForm.date}
              onChange={(e) => setInterestForm({ ...interestForm, date: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
            <select
              value={interestForm.accountId}
              onChange={(e) => setInterestForm({ ...interestForm, accountId: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
              required
            >
              <option value="">선택</option>
              {accounts
                .filter((acc) => !acc.archived || acc.id === interestForm.accountId)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name || acc.id}
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>이자 금액</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={interestForm.amount}
              onChange={(e) => setInterestForm({ ...interestForm, amount: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>이율 (%)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={interestForm.rate}
              onChange={(e) => setInterestForm({ ...interestForm, rate: e.target.value })}
              placeholder="선택사항"
              style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>세금</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={interestForm.tax}
              onChange={(e) => setInterestForm({ ...interestForm, tax: e.target.value })}
              placeholder="선택사항"
              style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
});
