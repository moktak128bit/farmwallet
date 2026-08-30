/**
 * 계좌 추가 폼 — form 상태를 이 컴포넌트가 소유해 폼 타이핑이 부모(AccountsPage)를 재렌더하지 않는다.
 * React.memo로 감싸므로 부모가 넘기는 onAdd는 useCallback, existingIds는 useMemo로 안정적이어야 한다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, AccountType, TaxShelterKind } from "../../../types";
import { parseAmount } from "../../../utils/parseAmount";
import { TAX_SHELTER_OPTIONS, TAX_SHELTER_ELIGIBLE_TYPES } from "../../../utils/taxShelter";
import { MoneyField } from "../../../components/ui/fields";

interface Props {
  onAdd: (account: Account) => void;
  existingIds: string[];
}

export const AccountForm: React.FC<Props> = React.memo(function AccountForm({ onAdd, existingIds }) {
  const [form, setForm] = useState({
    id: "",
    name: "",
    institution: "",
    type: "checking" as AccountType,
    initialBalance: "",
    debt: "",
    cashAdjustment: "",
    initialCashBalance: "",
    isPension: false,
    taxShelter: "" as TaxShelterKind | "",
    billingCycleStart: "",
    paymentDay: "",
    note: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim()) {
      toast.error("계좌 ID와 계좌명을 입력해 주세요.");
      return;
    }
    if (existingIds.includes(form.id)) {
      toast.error("이미 존재하는 계좌 ID입니다.");
      return;
    }
    const amount = parseAmount(form.initialBalance);
    const rawDebt = parseAmount(form.debt);
    const debt = rawDebt;
    const cashAdjustment = parseAmount(form.cashAdjustment, { allowNegative: true });
    const initialCashBalance = parseAmount(form.initialCashBalance);
    // 신용카드 청구주기 시작일·결제일(1~31, 3-4) — 카드 유형에서만 저장
    const billingCycleStartNum = Number(form.billingCycleStart);
    const paymentDayNum = Number(form.paymentDay);
    const account: Account = {
      id: form.id.trim(),
      name: form.name.trim(),
      institution: form.institution.trim() || "",
      type: form.type,
      initialBalance: amount,
      debt,
      savings: 0,
      cashAdjustment: (form.type === "securities" || form.type === "crypto") ? cashAdjustment : undefined,
      initialCashBalance: (form.type === "securities" || form.type === "crypto") && initialCashBalance > 0 ? initialCashBalance : undefined,
      isPension: form.type === "securities" && form.isPension ? true : undefined,
      // 세제 성격(4-1) — 적격 유형에서만 저장. 편집(AdjustmentModal)도 같은 필드를 쓴다
      taxShelter: TAX_SHELTER_ELIGIBLE_TYPES.has(form.type) && form.taxShelter ? form.taxShelter : undefined,
      // 카드 청구 예정액(3-4)에 쓰임 — 카드 유형에서만, 1~31 유효값일 때만 저장
      billingCycleStart:
        form.type === "card" && billingCycleStartNum >= 1 && billingCycleStartNum <= 31
          ? billingCycleStartNum
          : undefined,
      paymentDay:
        form.type === "card" && paymentDayNum >= 1 && paymentDayNum <= 31 ? paymentDayNum : undefined,
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
      cashAdjustment: "",
      initialCashBalance: "",
      isPension: false,
      taxShelter: "",
      billingCycleStart: "",
      paymentDay: "",
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
        label="부채 (갚을 금액, 양수)"
        hint="금액만 입력 (부호 없이)"
        value={form.debt}
        onChange={(debt) => setForm({ ...form, debt })}
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
      {form.type === "card" && (
        <>
          <label>
            <span>청구주기 시작일 (1~31, 선택)</span>
            <input
              type="number"
              min={1}
              max={31}
              placeholder="예: 13 (13일~익월 12일)"
              value={form.billingCycleStart}
              onChange={(e) => setForm({ ...form, billingCycleStart: e.target.value })}
            />
          </label>
          <label>
            <span>결제일 (1~31, 선택)</span>
            <input
              type="number"
              min={1}
              max={31}
              placeholder="예: 25"
              value={form.paymentDay}
              onChange={(e) => setForm({ ...form, paymentDay: e.target.value })}
            />
          </label>
          {(!form.billingCycleStart || !form.paymentDay) && (
            <div className="hint">둘 다 설정하면 대시보드에 다음 카드 결제 예정액이 표시됩니다.</div>
          )}
        </>
      )}
      {TAX_SHELTER_ELIGIBLE_TYPES.has(form.type) && (
        <label>
          <span>세제 성격 (ISA·연금)</span>
          <select
            value={form.taxShelter}
            onChange={(e) => {
              const v = e.target.value as TaxShelterKind | "";
              // 연금저축·IRP를 고르면 표시용 '연금 계좌'도 같이 켠다 (증권 유형만 해당, 사용자가 해제 가능)
              const autoPension = form.type === "securities" && (v === "pension" || v === "irp");
              setForm({ ...form, taxShelter: v, isPension: autoPension ? true : form.isPension });
            }}
          >
            {TAX_SHELTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      {form.type === "securities" && (
        <label className="wide" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={form.isPension}
            onChange={(e) => setForm({ ...form, isPension: e.target.checked })}
          />
          <span>연금 계좌 (퇴직연금·연금저축 — 자산 추이에서 '연금'으로 구분)</span>
        </label>
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
});
