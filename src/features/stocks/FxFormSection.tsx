import React, { useMemo, useState, useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry } from "../../types";
import { fetchYahooQuotes } from "../../yahooFinanceApi";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

type FxCurrency = "KRW" | "USD";

interface FxFormSectionProps {
  accounts: Account[];
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
  fxRate: number | null;
}

export const FxFormSection: React.FC<FxFormSectionProps> = ({ accounts, ledger, onChangeLedger, fxRate }) => {
  const [form, setForm] = useState({
    date: getTodayKST(),
    fromAccountId: "",
    toAccountId: "",
    fromCurrency: "KRW" as FxCurrency,
    toCurrency: "USD" as FxCurrency,
    fromAmount: "",
    toAmount: "",
    rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
    fee: "",
    feeCurrency: "KRW" as FxCurrency,
    description: ""
  });
  const [loadingRate, setLoadingRate] = useState(false);
  // 사용자가 직접 입력한 필드는 자동 계산이 덮어쓰지 않음 — 거래소·증권사가 표시한 환전 결과를 그대로 기록 가능.
  // false인 필드만 다른 필드 변경 시 자동 채워짐. 폼 reset 시 함께 초기화.
  const [manualEdits, setManualEdits] = useState({ fromAmount: false, toAmount: false, rate: false });
  // 환전 모드 — 기본은 "같은 계좌 내 환전" (증권사·거래소 내부 KRW↔USD 환전이 일반적).
  // 체크 시에만 출발/도착 계좌를 따로 지정 (예: 은행 KRW → 증권사 USD).
  const [crossAccount, setCrossAccount] = useState(false);

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

  /** 계좌명 휴리스틱("usd"/"달러" 포함 여부)으로 통화 추정 — 기본값 용도로만 사용 */
  const guessCurrency = (accountId: string): FxCurrency =>
    krwAccounts.some((a) => a.id === accountId) ? "KRW" : "USD";

  // 출발/도착 통화: 항상 폼의 명시 select 값 사용 — 계좌명 휴리스틱은 계좌 선택 시 기본값으로만 적용
  const fromCurrency: FxCurrency = form.fromCurrency;
  const toCurrency: FxCurrency = form.toCurrency;

  // 환율: 1 USD = rate KRW
  const rateNum = parseFloat(form.rate) || 0;
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

  // value === "" 면 manual flag 해제 (지웠으니 다시 자동 채움 허용)
  const markEdited = (field: "fromAmount" | "toAmount" | "rate", value: string) => {
    setManualEdits((prev) => ({ ...prev, [field]: value !== "" }));
  };

  const handleRateChange = (newRate: string) => {
    const rate = parseFloat(newRate) || 0;
    markEdited("rate", newRate);
    setForm((prev) => {
      // 도착 금액이 사용자 입력값이면 덮어쓰지 않음 — 비어 있을 때만 환율로 자동 채움
      if (prev.fromAmount && rate > 0 && !manualEdits.toAmount) {
        const fromAmount = parseFloat(prev.fromAmount) || 0;
        // 직전 렌더의 rateNum(stale)이 아닌 방금 입력된 새 환율로 계산
        const toAmount =
          fromCurrency === "KRW" && toCurrency === "USD"
            ? fromAmount / rate
            : fromCurrency === "USD" && toCurrency === "KRW"
              ? fromAmount * rate
              : fromAmount;
        return {
          ...prev,
          rate: newRate,
          toAmount: toCurrency === "USD" ? String(Math.round(toAmount * 100) / 100) : String(Math.round(toAmount))
        };
      }
      return { ...prev, rate: newRate };
    });
  };

  const handleFromAmountChange = (value: string) => {
    const amount = parseFloat(value) || 0;
    markEdited("fromAmount", value);
    setForm((prev) => ({
      ...prev,
      fromAmount: value,
      // 도착 금액을 사용자가 직접 입력한 상태면 덮어쓰지 않음
      toAmount:
        !manualEdits.toAmount && rateNum > 0
          ? toCurrency === "USD"
            ? String(Math.round(computeToFromFrom(amount) * 100) / 100)
            : String(Math.round(computeToFromFrom(amount)))
          : prev.toAmount
    }));
  };

  const handleToAmountChange = (value: string) => {
    const amount = parseFloat(value) || 0;
    markEdited("toAmount", value);
    setForm((prev) => ({
      ...prev,
      toAmount: value,
      // 출발 금액을 사용자가 직접 입력한 상태면 덮어쓰지 않음
      fromAmount:
        !manualEdits.fromAmount && rateNum > 0
          ? fromCurrency === "USD"
            ? String(Math.round(computeFromFromTo(amount) * 100) / 100)
            : String(Math.round(computeFromFromTo(amount)))
          : prev.fromAmount
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.fromAccountId || !form.toAccountId) {
      toast.error(ERROR_MESSAGES.FX_ACCOUNTS_REQUIRED);
      return;
    }

    const fromAmount = parseFloat(form.fromAmount) || 0;
    const toAmount = parseFloat(form.toAmount) || 0;
    const rate = parseFloat(form.rate) || 0;
    const fee = parseFloat(form.fee) || 0;

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
      `환전: ${fromCurrency === "KRW" ? formatKRW(fromAmount) : formatUSD(fromAmount)} → ${toCurrency === "KRW" ? formatKRW(toAmount) : formatUSD(toAmount)} (환율: ${rate.toFixed(2)})${fee > 0 ? ` (수수료 ${form.feeCurrency === "KRW" ? formatKRW(fee) : formatUSD(fee)})` : ""}`;

    const baseId = newIdWithPrefix("fx");
    // 사용자 카테고리 체계와 일치:
    //   transfer (환전 자체) → 이체 > 환전이체
    //   expense  (수수료)    → 지출 > 수수료 > 환전수수료
    const entries: LedgerEntry[] = [
      {
        id: `${baseId}-from`,
        date: form.date,
        kind: "transfer",
        category: "이체",
        subCategory: "환전이체",
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
        category: "이체",
        subCategory: "환전이체",
        description: desc,
        fromAccountId: undefined,
        toAccountId: form.toAccountId,
        amount: toAmount,
        currency: toCurrency
      }
    ];

    if (fee > 0) {
      entries.push({
        id: `${baseId}-fee`,
        date: form.date,
        kind: "expense",
        category: "지출",
        subCategory: "수수료",
        detailCategory: "환전수수료",
        description: `환전 수수료${form.description ? ` — ${form.description}` : ""}`,
        fromAccountId: form.fromAccountId,
        amount: fee,
        currency: form.feeCurrency
      });
    }

    onChangeLedger([...ledger, ...entries]);
    toast.success("환전 거래가 추가되었습니다");
    setForm({
      date: getTodayKST(),
      fromAccountId: "",
      toAccountId: "",
      fromCurrency: "KRW",
      toCurrency: "USD",
      fromAmount: "",
      toAmount: "",
      rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
      fee: "",
      feeCurrency: "KRW",
      description: ""
    });
    setManualEdits({ fromAmount: false, toAmount: false, rate: false });
  };

  const resetForm = () => {
    setForm({
      date: getTodayKST(),
      fromAccountId: "",
      toAccountId: "",
      fromCurrency: "KRW",
      toCurrency: "USD",
      fromAmount: "",
      toAmount: "",
      rate: fxRate ? String(Math.round(fxRate * 100) / 100) : "",
      fee: "",
      feeCurrency: "KRW",
      description: ""
    });
    setManualEdits({ fromAmount: false, toAmount: false, rate: false });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* 모드 토글 — 같은 계좌 환전이 기본, 필요할 때만 다른 계좌 모드로 전환 */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={crossAccount}
          onChange={(e) => {
            const checked = e.target.checked;
            setCrossAccount(checked);
            if (!checked) {
              // 같은 계좌 모드로 복귀 — 도착 계좌를 출발 계좌와 같게 맞춤
              setForm((prev) => ({ ...prev, toAccountId: prev.fromAccountId }));
            }
          }}
        />
        <span>다른 계좌로 환전 (예: 은행 → 증권). 체크 안 하면 같은 계좌 내 환전 (KRW ↔ USD).</span>
      </label>

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

        {!crossAccount ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
            <select
              value={form.fromAccountId}
              onChange={(e) => {
                const v = e.target.value;
                // 같은 계좌 모드 — 출발·도착 동시에 같은 계좌로 설정
                setForm((prev) => ({ ...prev, fromAccountId: v, toAccountId: v }));
              }}
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
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>출발 계좌</span>
              <select
                value={form.fromAccountId}
                onChange={(e) => {
                  const v = e.target.value;
                  // 계좌명 휴리스틱은 기본값으로만 — 아래 통화 select로 언제든 바꿀 수 있음
                  const guessed = v ? guessCurrency(v) : undefined;
                  setForm((prev) => ({
                    ...prev,
                    fromAccountId: v,
                    toAccountId: prev.toAccountId === prev.fromAccountId ? v : prev.toAccountId,
                    ...(guessed
                      ? { fromCurrency: guessed, toCurrency: guessed === "KRW" ? ("USD" as FxCurrency) : ("KRW" as FxCurrency) }
                      : {})
                  }));
                }}
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
                onChange={(e) => {
                  const v = e.target.value;
                  const guessed = v ? guessCurrency(v) : undefined;
                  setForm((prev) => ({
                    ...prev,
                    toAccountId: v,
                    ...(guessed
                      ? { toCurrency: guessed, fromCurrency: guessed === "KRW" ? ("USD" as FxCurrency) : ("KRW" as FxCurrency) }
                      : {})
                  }));
                }}
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
          </>
        )}

        {/* 통화 select는 모드와 무관하게 항상 표시 — 휴리스틱 추정이 틀려도 직접 지정 가능 */}
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

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>출발 금액 ({fromCurrency})</span>
          <input
            type="number"
            min={0}
            step={fromCurrency === "USD" ? "0.01" : "1"}
            value={form.fromAmount}
            onChange={(e) => handleFromAmountChange(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>환율 (1 USD = ? KRW)</span>
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

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>도착 금액 ({toCurrency})</span>
          <input
            type="number"
            min={0}
            step={toCurrency === "USD" ? "0.01" : "1"}
            value={form.toAmount}
            onChange={(e) => handleToAmountChange(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
            required
          />
        </label>

        {/* 수수료 금액 — 별도 셀로 분리해 입력칸이 항상 충분히 보이도록 */}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>수수료 금액 (선택)</span>
          <input
            type="number"
            min={0}
            step={form.feeCurrency === "USD" ? "0.01" : "1"}
            value={form.fee}
            onChange={(e) => setForm({ ...form, fee: e.target.value })}
            placeholder="0"
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </label>

        {/* 수수료 통화 — 출발 통화와 독립적 (국내 증권사는 보통 KRW) */}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>수수료 통화</span>
          <select
            value={form.feeCurrency}
            onChange={(e) => setForm({ ...form, feeCurrency: e.target.value as FxCurrency })}
            style={{ padding: "6px 8px", fontSize: 14 }}
          >
            <option value="KRW">KRW (원)</option>
            <option value="USD">USD (달러)</option>
          </select>
        </label>

        {/* 수수료 설명 한 줄 — 풀너비 */}
        <p className="hint" style={{ fontSize: 12, margin: 0, gridColumn: "1 / -1" }}>
          수수료 입력 시 출발 계좌에서 추가로 차감되며, 가계부에 <strong>지출 &gt; 수수료 &gt; 환전수수료</strong>로 기록됩니다.
          환전 자체는 <strong>이체 &gt; 환전이체</strong>로 분류됩니다.
        </p>

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
