import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry } from "../../types";
import { fetchYahooQuotes } from "../../yahooFinanceApi";
import { formatKRW, formatUSD } from "../../utils/format";
import { validateTransfer } from "../../utils/validation";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

interface FxFormSectionProps {
  accounts: Account[];
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
  fxRate: number | null;
}

export const FxFormSection: React.FC<FxFormSectionProps> = ({ accounts, ledger, onChangeLedger, fxRate }) => {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: "",
    toAccountId: "",
    fromAmount: "",
    toAmount: "",
    rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
    description: ""
  });
  const [loadingRate, setLoadingRate] = useState(false);

  const krwAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const name = (a.name + a.id).toLowerCase();
      return !name.includes("usd") && !name.includes("dollar") && !name.includes("달러");
    });
  }, [accounts]);

  const usdAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const name = (a.name + a.id).toLowerCase();
      return name.includes("usd") || name.includes("dollar") || name.includes("달러");
    });
  }, [accounts]);

  const handleRateChange = (newRate: string) => {
    const rate = parseFloat(newRate) || 0;
    setForm((prev) => {
      if (prev.fromAmount && rate > 0) {
        const fromAmount = parseFloat(prev.fromAmount) || 0;
        const toAmount = fromAmount * rate;
        return { ...prev, rate: newRate, toAmount: String(Math.round(toAmount * 100) / 100) };
      }
      return { ...prev, rate: newRate };
    });
  };

  const handleFromAmountChange = (value: string) => {
    const amount = parseFloat(value) || 0;
    const rate = parseFloat(form.rate) || 0;
    setForm((prev) => ({
      ...prev,
      fromAmount: value,
      toAmount: rate > 0 ? String(Math.round(amount * rate * 100) / 100) : prev.toAmount
    }));
  };

  const handleToAmountChange = (value: string) => {
    const amount = parseFloat(value) || 0;
    const rate = parseFloat(form.rate) || 0;
    setForm((prev) => ({
      ...prev,
      toAmount: value,
      fromAmount: rate > 0 ? String(Math.round((amount / rate) * 100) / 100) : prev.fromAmount
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.fromAccountId || !form.toAccountId) {
      toast.error(ERROR_MESSAGES.FX_ACCOUNTS_REQUIRED);
      return;
    }
    const transferValidation = validateTransfer(form.fromAccountId, form.toAccountId, { from: "출발", to: "도착" });
    if (!transferValidation.valid) {
      toast.error(transferValidation.error ?? ERROR_MESSAGES.FX_SAME_ACCOUNT);
      return;
    }

    const fromAmount = parseFloat(form.fromAmount) || 0;
    const toAmount = parseFloat(form.toAmount) || 0;
    const rate = parseFloat(form.rate) || 0;

    if (fromAmount <= 0 || toAmount <= 0 || rate <= 0) {
      toast.error(ERROR_MESSAGES.FX_AMOUNT_RATE_REQUIRED);
      return;
    }

    const isKrwToUsd = krwAccounts.some((a) => a.id === form.fromAccountId) && 
                       usdAccounts.some((a) => a.id === form.toAccountId);
    const isUsdToKrw = usdAccounts.some((a) => a.id === form.fromAccountId) && 
                       krwAccounts.some((a) => a.id === form.toAccountId);

    if (!isKrwToUsd && !isUsdToKrw) {
      toast.error(ERROR_MESSAGES.FX_KRW_USD_ONLY);
      return;
    }

    const description = form.description || 
      (isKrwToUsd 
        ? `환전: ${formatKRW(fromAmount)} → ${formatUSD(toAmount)} (환율: ${rate.toFixed(2)})`
        : `환전: ${formatUSD(fromAmount)} → ${formatKRW(toAmount)} (환율: ${rate.toFixed(2)})`);

    const newEntry: LedgerEntry = {
      id: `fx-${Date.now()}`,
      date: form.date,
      kind: "transfer",
      category: "환전",
      description: description,
      fromAccountId: form.fromAccountId,
      toAccountId: form.toAccountId,
      amount: fromAmount
    };

    onChangeLedger([...ledger, newEntry]);
    toast.success("환전 거래가 추가되었습니다");
    setForm({
      date: new Date().toISOString().slice(0, 10),
      fromAccountId: "",
      toAccountId: "",
      fromAmount: "",
      toAmount: "",
      rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
      description: ""
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>거래일</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>출발 계좌</span>
          <select
            value={form.fromAccountId}
            onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          >
            <option value="">선택</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} {a.name ? `(${a.name})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>도착 계좌</span>
          <select
            value={form.toAccountId}
            onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          >
            <option value="">선택</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} {a.name ? `(${a.name})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            출발 금액 {krwAccounts.some((a) => a.id === form.fromAccountId) ? "(KRW)" : usdAccounts.some((a) => a.id === form.fromAccountId) ? "(USD)" : ""}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.fromAmount}
            onChange={(e) => handleFromAmountChange(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>환율 (USD/KRW)</span>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.rate}
              onChange={(e) => handleRateChange(e.target.value)}
              style={{ padding: "6px 8px", fontSize: 14, flex: 1 }}
              required
            />
            {loadingRate ? (
              <button type="button" disabled style={{ padding: "6px 12px", fontSize: 12 }}>
                조회 중...
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setLoadingRate(true);
                    const res = await fetchYahooQuotes(["USDKRW=X"]);
                    if (res[0]?.price) {
                      const rate = Math.round(res[0].price * 100) / 100;
                      handleRateChange(String(rate));
                      toast.success(`현재 환율: ${rate.toFixed(2)}`);
                    }
                  } catch (err) {
                    toast.error(ERROR_MESSAGES.QUOTE_FETCH_FAILED);
                  } finally {
                    setLoadingRate(false);
                  }
                }}
                className="secondary"
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                현재 환율
              </button>
            )}
          </div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            도착 금액 {krwAccounts.some((a) => a.id === form.toAccountId) ? "(KRW)" : usdAccounts.some((a) => a.id === form.toAccountId) ? "(USD)" : ""}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.toAmount}
            onChange={(e) => handleToAmountChange(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>메모 (선택)</span>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="환전 거래 메모"
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setForm({
            date: new Date().toISOString().slice(0, 10),
            fromAccountId: "",
            toAccountId: "",
            fromAmount: "",
            toAmount: "",
            rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
            description: ""
          })}
          className="secondary"
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          초기화
        </button>
        <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
          환전 거래 추가
        </button>
      </div>
    </form>
  );
};
