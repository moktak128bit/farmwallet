import React, { useMemo, useState, useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry } from "../../types";
import { fetchYahooQuotes } from "../../yahooFinanceApi";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { MoneyField, NumericInput } from "../../components/ui/fields";
import { parseAmount, formatAmount } from "../../utils/parseAmount";

type FxCurrency = "KRW" | "USD";

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
    fromCurrency: "KRW" as FxCurrency,
    toCurrency: "USD" as FxCurrency,
    fromAmount: "",
    toAmount: "",
    rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
    description: ""
  });
  const [loadingRate, setLoadingRate] = useState(false);

  useEffect(() => {
    if (fxRate != null && !form.rate) {
      setForm((prev) => ({ ...prev, rate: String(Math.round(fxRate * 100) / 100) }));
    }
  }, [fxRate, form.rate]);

  const krwAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const name = (a.name + a.id).toLowerCase();
      return !name.includes("usd") && !name.includes("dollar") && !name.includes("달러");
    });
  }, [accounts]);

  const isSameAccount = form.fromAccountId && form.fromAccountId === form.toAccountId;

  // 출발/도착 통화: 같은 계좌면 폼 값, 다른 계좌면 계좌 유형으로 고정
  const fromCurrency: FxCurrency = isSameAccount
    ? form.fromCurrency
    : krwAccounts.some((a) => a.id === form.fromAccountId)
      ? "KRW"
      : "USD";
  const toCurrency: FxCurrency = isSameAccount
    ? form.toCurrency
    : krwAccounts.some((a) => a.id === form.toAccountId)
      ? "KRW"
      : "USD";

  // 환율: 1 USD = rate KRW
  const rateNum = parseAmount(form.rate, { allowDecimal: true });
  const computeToFromFrom = (fromAmt: number) =>
    fromCurrency === "KRW" && toCurrency === "USD"
      ? fromAmt / rateNum
      : fromCurrency === "USD" && toCurrency === "KRW"
        ? fromAmt * rateNum
        : fromAmt;
  const computeFromFromTo = (toAmt: number) =>
    toCurrency === "USD" && fromCurrency === "KRW"
      ? toAmt * rateNum
      : toCurrency === "KRW" && fromCurrency === "USD"
        ? toAmt / rateNum
        : toAmt;

  const handleRateChange = (newRate: string) => {
    const rate = parseAmount(newRate, { allowDecimal: true });
    setForm((prev) => {
      if (prev.fromAmount && rate > 0) {
        const fromAmount = parseAmount(prev.fromAmount, { allowDecimal: true });
        const toAmount = computeToFromFrom(fromAmount);
        return {
          ...prev,
          rate: newRate,
          toAmount: formatAmount(
            toCurrency === "USD" ? String(Math.round(toAmount * 100) / 100) : String(Math.round(toAmount)),
            { allowDecimal: toCurrency === "USD" }
          )
        };
      }
      return { ...prev, rate: newRate };
    });
  };

  const handleFromAmountChange = (value: string) => {
    const amount = parseAmount(value, { allowDecimal: true });
    setForm((prev) => ({
      ...prev,
      fromAmount: value,
      toAmount:
        rateNum > 0
          ? formatAmount(
              toCurrency === "USD"
                ? String(Math.round(computeToFromFrom(amount) * 100) / 100)
                : String(Math.round(computeToFromFrom(amount))),
              { allowDecimal: toCurrency === "USD" }
            )
          : prev.toAmount
    }));
  };

  const handleToAmountChange = (value: string) => {
    const amount = parseAmount(value, { allowDecimal: true });
    setForm((prev) => ({
      ...prev,
      toAmount: value,
      fromAmount:
        rateNum > 0
          ? formatAmount(
              fromCurrency === "USD"
                ? String(Math.round(computeFromFromTo(amount) * 100) / 100)
                : String(Math.round(computeFromFromTo(amount))),
              { allowDecimal: fromCurrency === "USD" }
            )
          : prev.fromAmount
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.fromAccountId || !form.toAccountId) {
      toast.error(ERROR_MESSAGES.FX_ACCOUNTS_REQUIRED);
      return;
    }

    const fromAmount = parseAmount(form.fromAmount, { allowDecimal: true });
    const toAmount = parseAmount(form.toAmount, { allowDecimal: true });
    const rate = parseAmount(form.rate, { allowDecimal: true });

    if (fromAmount <= 0 || toAmount <= 0 || rate <= 0) {
      toast.error(ERROR_MESSAGES.FX_AMOUNT_RATE_REQUIRED);
      return;
    }

    if (fromCurrency === toCurrency) {
      toast.error(isSameAccount ? "출발 통화와 도착 통화가 달라야 합니다. (KRW↔USD)" : ERROR_MESSAGES.FX_KRW_USD_ONLY);
      return;
    }

    const desc =
      form.description ||
      `환전: ${fromCurrency === "KRW" ? formatKRW(fromAmount) : formatUSD(fromAmount)} → ${toCurrency === "KRW" ? formatKRW(toAmount) : formatUSD(toAmount)} (환율: ${rate.toFixed(2)})`;

    const baseId = `fx-${Date.now()}`;
    const entries: LedgerEntry[] = [
      {
        id: `${baseId}-from`,
        date: form.date,
        kind: "transfer",
        category: "환전",
        description: desc,
        fromAccountId: form.fromAccountId,
        toAccountId: undefined,
        amount: fromAmount,
        currency: fromCurrency
      },
      {
        id: `${baseId}-to`,
        date: form.date,
        kind: "transfer",
        category: "환전",
        description: desc,
        fromAccountId: undefined,
        toAccountId: form.toAccountId,
        amount: toAmount,
        currency: toCurrency
      }
    ];

    onChangeLedger([...ledger, ...entries]);
    toast.success("환전 거래가 추가되었습니다");
    setForm({
      date: new Date().toISOString().slice(0, 10),
      fromAccountId: "",
      toAccountId: "",
      fromCurrency: "KRW",
      toCurrency: "USD",
      fromAmount: "",
      toAmount: "",
      rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
      description: ""
    });
  };

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().slice(0, 10),
      fromAccountId: "",
      toAccountId: "",
      fromCurrency: "KRW",
      toCurrency: "USD",
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
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                fromAccountId: e.target.value,
                toAccountId: prev.toAccountId === prev.fromAccountId ? e.target.value : prev.toAccountId
              }))
            }
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

        {isSameAccount && (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>출발 통화</span>
              <select
                value={form.fromCurrency}
                onChange={(e) => {
                  const next: FxCurrency = e.target.value as FxCurrency;
                  setForm((prev) => ({
                    ...prev,
                    fromCurrency: next,
                    toCurrency: next === "KRW" ? "USD" : "KRW",
                    fromAmount: "",
                    toAmount: ""
                  }));
                }}
                style={{ padding: "6px 8px", fontSize: 14 }}
              >
                <option value="KRW">KRW (원)</option>
                <option value="USD">USD (달러)</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>도착 통화</span>
              <select
                value={form.toCurrency}
                onChange={(e) => {
                  const next: FxCurrency = e.target.value as FxCurrency;
                  setForm((prev) => ({
                    ...prev,
                    toCurrency: next,
                    fromCurrency: next === "KRW" ? "USD" : "KRW",
                    fromAmount: "",
                    toAmount: ""
                  }));
                }}
                style={{ padding: "6px 8px", fontSize: 14 }}
              >
                <option value="KRW">KRW (원)</option>
                <option value="USD">USD (달러)</option>
              </select>
            </label>
          </>
        )}

        <MoneyField
          label="출발 금액"
          currency={fromCurrency}
          allowDecimal
          required
          value={form.fromAmount}
          onChange={handleFromAmountChange}
        />

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>환율 (1 USD = ? KRW)</span>
          <div style={{ display: "flex", gap: 4 }}>
            <NumericInput
              allowDecimal
              value={form.rate}
              onChange={handleRateChange}
              style={{ flex: 1 }}
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
                  } catch {
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

        <MoneyField
          label="도착 금액"
          currency={toCurrency}
          allowDecimal
          required
          value={form.toAmount}
          onChange={handleToAmountChange}
        />

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
        <button type="button" onClick={resetForm} className="secondary" style={{ padding: "8px 16px", fontSize: 14 }}>
          초기화
        </button>
        <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
          환전 거래 추가
        </button>
      </div>
    </form>
  );
};
