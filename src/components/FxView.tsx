import React, { useState, useMemo, useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Account, LedgerEntry } from "../types";
import { formatShortDate, formatKRW, formatUSD } from "../utils/format";
import { fetchYahooQuotes } from "../yahooFinanceApi";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
}

interface FxForm {
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  description: string;
}

function createDefaultForm(): FxForm {
  return {
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: "",
    toAccountId: "",
    fromAmount: "",
    toAmount: "",
    rate: "",
    description: ""
  };
}

export const FxView: React.FC<Props> = ({ accounts, ledger, onChangeLedger }) => {
  const [form, setForm] = useState<FxForm>(createDefaultForm);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);

  // 환전 거래만 필터링
  const fxEntries = useMemo(() => {
    return ledger.filter((entry) => 
      entry.kind === "transfer" && 
      entry.description.toLowerCase().includes("환전") ||
      entry.description.toLowerCase().includes("fx") ||
      entry.description.toLowerCase().includes("exchange")
    );
  }, [ledger]);

  // 환율 조회
  useEffect(() => {
    const fetchRate = async () => {
      try {
        setLoadingRate(true);
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        if (res[0]?.price) {
          setFxRate(res[0].price);
          if (!form.rate) {
            setForm((prev) => ({ ...prev, rate: String(Math.round(res[0].price * 100) / 100) }));
          }
        }
      } catch (err) {
        console.warn("환율 조회 실패", err);
      } finally {
        setLoadingRate(false);
      }
    };
    fetchRate();
  }, []);

  // KRW 계좌와 USD 계좌 필터링
  const krwAccounts = useMemo(() => {
    return accounts.filter((a) => {
      // 계좌 이름이나 ID에 USD, dollar, 달러 등이 없으면 KRW 계좌로 간주
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

  // 환율 변경 시 금액 자동 계산
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

  // 금액 변경 시 반대편 금액 자동 계산
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
      toast.error("출발 계좌와 도착 계좌를 선택해주세요");
      return;
    }

    if (form.fromAccountId === form.toAccountId) {
      toast.error("출발 계좌와 도착 계좌가 같을 수 없습니다");
      return;
    }

    const fromAmount = parseFloat(form.fromAmount) || 0;
    const toAmount = parseFloat(form.toAmount) || 0;
    const rate = parseFloat(form.rate) || 0;

    if (fromAmount <= 0 || toAmount <= 0 || rate <= 0) {
      toast.error("금액과 환율을 올바르게 입력해주세요");
      return;
    }

    // 환전 거래는 두 개의 ledger entry로 생성
    // 1. KRW 계좌에서 출금 (이체)
    // 2. USD 계좌에 입금 (이체)
    const fromAccount = accounts.find((a) => a.id === form.fromAccountId);
    const toAccount = accounts.find((a) => a.id === form.toAccountId);
    
    const isKrwToUsd = krwAccounts.some((a) => a.id === form.fromAccountId) && 
                       usdAccounts.some((a) => a.id === form.toAccountId);
    const isUsdToKrw = usdAccounts.some((a) => a.id === form.fromAccountId) && 
                       krwAccounts.some((a) => a.id === form.toAccountId);

    if (!isKrwToUsd && !isUsdToKrw) {
      toast.error("KRW 계좌와 USD 계좌 간의 환전만 가능합니다");
      return;
    }

    const description = form.description || 
      (isKrwToUsd 
        ? `환전: ${formatKRW(fromAmount)} → ${formatUSD(toAmount)} (환율: ${rate.toFixed(2)})`
        : `환전: ${formatUSD(fromAmount)} → ${formatKRW(toAmount)} (환율: ${rate.toFixed(2)})`);

    const newEntries: LedgerEntry[] = [
      {
        id: `fx-${Date.now()}-1`,
        date: form.date,
        kind: "transfer",
        category: "환전",
        description: description,
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: fromAmount
      }
    ];

    onChangeLedger([...ledger, ...newEntries]);
    toast.success("환전 거래가 추가되었습니다");
    setForm(createDefaultForm());
  };

  return (
    <div>
      <h2>환전</h2>
      <p className="hint" style={{ marginBottom: 16 }}>
        KRW 계좌와 USD 계좌 간의 환전 거래를 기록합니다.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>환전 거래 입력</h3>
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
                        toast.error("환율 조회 실패");
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
              onClick={() => setForm(createDefaultForm())}
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
      </div>

      <h3>환전 내역</h3>
      {fxEntries.length === 0 ? (
        <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
          환전 거래 내역이 없습니다.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>출발 계좌</th>
                <th>도착 계좌</th>
                <th>금액</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              {fxEntries
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatShortDate(entry.date)}</td>
                    <td>{entry.fromAccountId || "-"}</td>
                    <td>{entry.toAccountId || "-"}</td>
                    <td className="number">{formatKRW(entry.amount)}</td>
                    <td>{entry.description}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};







