import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
  onChangeAccounts?: (accounts: Account[]) => void; // 더 이상 사용하지 않지만 호환성을 위해 유지
}

interface DividendRow {
  month: string;
  source: string;
  amount: number;
  ticker?: string;
  yieldRate?: number;
}

export const DividendsView: React.FC<Props> = ({ accounts, ledger, trades, prices, onChangeLedger, onChangeAccounts }) => {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    ticker: "",
    name: "",
    amount: "",
    category: "배당",
    isSettled: true
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.date || !form.accountId || !amount || amount <= 0) {
      return;
    }

    // Ledger 항목 추가
    // 정리된 경우에만 toAccountId를 설정하여 computeAccountBalances에서 자동 계산되도록 함
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: form.date,
      kind: "income",
      category: form.category,
      description: form.ticker ? `${form.ticker}${form.name ? ` - ${form.name}` : ""} ${form.category}` : form.category,
      toAccountId: form.isSettled ? form.accountId : undefined, // 정리된 경우만 계좌 연결
      amount: amount,
      note: form.isSettled ? "정리됨" : "미정리"
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);
    // initialBalance는 직접 업데이트하지 않음 - computeAccountBalances에서 자동 계산됨

    // 폼 초기화
    setForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: form.accountId, // 계좌는 유지
      ticker: "",
      name: "",
      amount: "",
      category: "배당",
      isSettled: true
    });
  };

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
    // initialBalance는 직접 업데이트하지 않음 - computeAccountBalances에서 자동 계산됨

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
    // initialBalance는 직접 업데이트하지 않음 - computeAccountBalances에서 자동 계산됨

    // 폼 초기화
    setDebtInterestForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: debtInterestForm.accountId,
      description: "",
      amount: "",
      isSettled: true
    });
  };
  const incomeRows = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" &&
      ((l.category ?? "").includes("배당") ||
        (l.category ?? "").includes("이자") ||
        (l.description ?? "").includes("배당") ||
        (l.description ?? "").includes("이자"));

    const buyAmountByTicker = trades
      .filter((t) => t.side === "buy")
      .reduce((map, t) => {
        map.set(t.ticker, (map.get(t.ticker) ?? 0) + t.totalAmount);
        return map;
      }, new Map<string, number>());

    const rows: DividendRow[] = [];
    for (const l of ledger) {
      if (!isDividend(l)) continue;
      const month = l.date?.slice(0, 7) || "기타";
      const tickerMatch =
        (l.description ?? "").match(/([0-9]{6}|[A-Z]{1,6})/) ||
        (l.category ?? "").match(/([0-9]{6}|[A-Z]{1,6})/);
      const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : undefined;
      const name =
        ticker && (prices.find((p) => p.ticker === ticker)?.name || trades.find((t) => t.ticker === ticker)?.name);
      const source = ticker ? `${ticker}${name ? ` - ${name}` : ""}` : l.description || l.category || "기타";
      const basis = ticker ? buyAmountByTicker.get(ticker) ?? 0 : 0;
      const yieldRate = basis > 0 ? l.amount / basis : undefined;
      rows.push({
        month,
        source,
        ticker,
        amount: l.amount,
        yieldRate
      });
    }
    return rows;
  }, [ledger, trades, prices]);

  const monthlyTotal = useMemo(() => {
    const map = new Map<string, number>();
    incomeRows.forEach((r) => {
      map.set(r.month, (map.get(r.month) ?? 0) + r.amount);
    });
    return Array.from(map.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [incomeRows]);

  const byMonthSource = useMemo(() => {
    const map = new Map<string, DividendRow[]>();
    incomeRows.forEach((r) => {
      const list = map.get(r.month) ?? [];
      list.push(r);
      map.set(r.month, list);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [incomeRows]);

  return (
    <div>
      <div className="section-header">
        <h2>배당/이자</h2>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>배당/이자 입력</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
              <select
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
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
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>종류</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
              >
                <option value="배당">배당</option>
                <option value="이자">이자</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>티커 (선택)</span>
              <input
                type="text"
                value={form.ticker}
                placeholder="예: 005930, SCHD"
                onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                style={{ padding: "6px 8px", fontSize: 14 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>종목명 (선택)</span>
              <input
                type="text"
                value={form.name}
                placeholder="종목명"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>금액</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.isSettled}
                  onChange={(e) => setForm({ ...form, isSettled: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>정리됨 (체크하면 해당 계좌에 금액이 추가됩니다)</span>
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

      <div className="cards-row">
        <div className="card highlight">
          <div className="card-title">누적 배당/이자</div>
          <div className="card-value">
            {Math.round(incomeRows.reduce((s, r) => s + r.amount, 0)).toLocaleString()} 원
          </div>
        </div>
        <div className="card">
          <div className="card-title">최근 월 배당/이자</div>
          <div className="card-value">
            {Math.round(monthlyTotal.at(-1)?.total ?? 0).toLocaleString()} 원
          </div>
        </div>
      </div>

      <h3>월별 합계</h3>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>월</th>
            <th>총액</th>
          </tr>
        </thead>
        <tbody>
          {monthlyTotal.map((row) => (
            <tr key={row.month}>
              <td>{row.month}</td>
              <td className="number">{Math.round(row.total).toLocaleString()}</td>
            </tr>
          ))}
          {monthlyTotal.length === 0 && (
            <tr>
              <td colSpan={2} style={{ textAlign: "center" }}>
                배당/이자 내역이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>월별 상세 (종목별)</h3>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>월</th>
            <th>출처</th>
            <th>금액</th>
            <th>배당/이자율</th>
          </tr>
        </thead>
        <tbody>
          {byMonthSource.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center" }}>
                배당/이자 내역이 없습니다.
              </td>
            </tr>
          )}
          {byMonthSource.map(([month, rows]) =>
            rows.map((r, idx) => (
              <tr key={`${month}-${r.source}-${idx}`}>
                <td>{idx === 0 ? month : ""}</td>
                <td>{r.source}</td>
                <td className="number positive">{Math.round(r.amount).toLocaleString()} 원</td>
                <td className="number">
                  {r.yieldRate != null ? `${(r.yieldRate * 100).toFixed(2)}%` : "-"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

