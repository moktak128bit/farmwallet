import { useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry } from "../../../types";
import { parseAmount } from "../../../utils/parseAmount";

interface Props {
  account: Account;
  checkingAccounts: Account[];
  currentDebt: number;
  onAddPayment: (entry: LedgerEntry) => void;
  formatKRW: (n: number) => string;
}

export function CardPaymentSection({
  account,
  checkingAccounts,
  currentDebt,
  onAddPayment,
  formatKRW,
}: Props) {
  const [fromAccountId, setFromAccountId] = useState(() => checkingAccounts[0]?.id ?? "");
  const [payAmount, setPayAmount] = useState("");
  const debtAmount = currentDebt < 0 ? Math.abs(currentDebt) : 0;

  const handlePay = () => {
    if (!fromAccountId) return;
    const amount = payAmount.trim() ? Math.round(parseAmount(payAmount)) : debtAmount;
    if (amount <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry: LedgerEntry = {
      id: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      date: today,
      kind: "transfer",
      category: "이체",
      subCategory: "카드결제이체",
      description: `${account.name} 결제`,
      fromAccountId,
      toAccountId: account.id,
      amount,
    };
    onAddPayment(entry);
    toast.success(`카드 결제 추가됨: ${formatKRW(amount)}`);
    setPayAmount("");
  };

  return (
    <div style={{ marginBottom: 20, padding: 16, background: "var(--surface-alt)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>결제하기</div>
      {debtAmount > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          현재 부채: <span style={{ fontWeight: 600, color: "var(--danger)" }}>{formatKRW(debtAmount)}</span>
        </div>
      )}
      {checkingAccounts.length > 0 ? (
        <>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>결제 출금계좌</label>
          <select
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 10, borderRadius: 6 }}
          >
            {checkingAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.institution || "-"})</option>
            ))}
          </select>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>결제 금액</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder={debtAmount > 0 ? `전액 ${formatKRW(debtAmount)}` : "0"}
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9,]/g, ""))}
            style={{ width: "100%", padding: 8, marginBottom: 10, borderRadius: 6 }}
          />
          <button
            type="button"
            className="primary"
            onClick={handlePay}
            disabled={debtAmount <= 0 && !payAmount.trim()}
            style={{ width: "100%" }}
          >
            {debtAmount > 0 && !payAmount.trim() ? "전액 결제 추가" : "카드 결제 추가"}
          </button>
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>입출금/저축 계좌를 추가한 뒤 결제를 등록할 수 있습니다.</p>
      )}
    </div>
  );
}
