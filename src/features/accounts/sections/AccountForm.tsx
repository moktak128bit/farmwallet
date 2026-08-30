import React, { useState } from "react";
import type { Account, AccountType } from "../../../types";
import { parseAmount } from "../../../utils/parseAmount";
import { MoneyField } from "../../../components/ui/fields";

interface Props {
  onAdd: (account: Account) => void;
  existingIds: string[];
}

export const AccountForm: React.FC<Props> = ({ onAdd, existingIds }) => {
  const [form, setForm] = useState({
    id: "",
    name: "",
    institution: "",
    type: "checking" as AccountType,
    initialBalance: "",
    debt: "",
    savings: "",
    cashAdjustment: "",
    initialCashBalance: "",
    note: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim()) {
      alert("계좌 ID와 계좌명을 입력해 주세요.");
      return;
    }
    if (existingIds.includes(form.id)) {
      alert("이미 존재하는 계좌 ID입니다.");
      return;
    }
    const amount = parseAmount(form.initialBalance);
    const rawDebt = parseAmount(form.debt);
    const debt = rawDebt;
    const savings = parseAmount(form.savings);
    const cashAdjustment = parseAmount(form.cashAdjustment, { allowNegative: true });
    const initialCashBalance = parseAmount(form.initialCashBalance);
    const account: Account = {
      id: form.id.trim(),
      name: form.name.trim(),
      institution: form.institution.trim() || "",
      type: form.type,
      initialBalance: amount,
      debt,
      savings,
      cashAdjustment: (form.type === "securities" || form.type === "crypto") ? cashAdjustment : undefined,
      initialCashBalance: (form.type === "securities" || form.type === "crypto") && initialCashBalance > 0 ? initialCashBalance : undefined,
      note: form.note.trim() || undefined,
    };
    onAdd(account);
    setForm({
      id: "",
      name: "",
      institution: "",
      type: "checking",
      initialBalance: "",
      debt: "",
      savings: "",
      cashAdjustment: "",
      initialCashBalance: "",
      note: "",
    });
  };

  return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h3>계좌 추가</h3>
      <label>
        <span>계좌 ID *</span>
        <input
          type="text"
          required
          placeholder="예: CHK_KB"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase().replace(/\s/g, "_") })}
        />
      </label>
      <label>
        <span>계좌명 *</span>
        <input
          type="text"
          required
          placeholder="예: 월급통장"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span>기관 / 증권사</span>
        <input
          type="text"
          placeholder="예: 농협은행"
          value={form.institution}
          onChange={(e) => setForm({ ...form, institution: e.target.value })}
        />
      </label>
      <label>
        <span>계좌 유형</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
          <option value="checking">입출금</option>
          <option value="savings">저축</option>
          <option value="card">신용카드</option>
          <option value="securities">증권</option>
          <option value="crypto">암호화폐</option>
          <option value="other">기타</option>
        </select>
      </label>
      <MoneyField
        label="초기 잔액"
        value={form.initialBalance}
        onChange={(initialBalance) => setForm({ ...form, initialBalance })}
      />
      <MoneyField
        label="부채"
        hint="금액만 입력 (부호 없이)"
        value={form.debt}
        onChange={(debt) => setForm({ ...form, debt })}
      />
      <MoneyField
        label="저축"
        value={form.savings}
        onChange={(savings) => setForm({ ...form, savings })}
      />
      {(form.type === "securities" || form.type === "crypto") && (
        <>
          <MoneyField
            label="초기 현금 잔액"
            value={form.initialCashBalance}
            onChange={(initialCashBalance) => setForm({ ...form, initialCashBalance })}
          />
          <MoneyField
            label="현금 조정 (선택)"
            hint="잔액에 그대로 더해진다 — 차감은 -1000 처럼 음수로"
            allowNegative
            value={form.cashAdjustment}
            onChange={(cashAdjustment) => setForm({ ...form, cashAdjustment })}
          />
        </>
      )}
      <label className="wide">
        <span>메모</span>
        <input
          type="text"
          placeholder="메모 입력"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary">
          계좌 추가
        </button>
      </div>
    </form>
  );
};
