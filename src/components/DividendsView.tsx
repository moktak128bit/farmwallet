import React, { useMemo, useState, useEffect } from "react";
import { Autocomplete } from "./Autocomplete";
import type { Account, LedgerEntry, StockPrice, StockTrade, TickerInfo } from "../types";
import { computePositions } from "../calculations";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { formatNumber, formatKRW } from "../utils/format";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
}

interface DividendRow {
  month: string;
  source: string;
  amount: number;
  ticker?: string;
  yieldRate?: number;
}

type TabType = "dividend" | "interest";

export const DividendsView: React.FC<Props> = ({ accounts, ledger, trades, prices, tickerDatabase, onChangeLedger }) => {
  const [activeTab, setActiveTab] = useState<TabType>("dividend");
  const [showUSD, setShowUSD] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(null);
  
  // 배당 입력 폼
  const [dividendForm, setDividendForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    ticker: "",
    name: "",
    amount: "",
    tax: "", // 세금
    fee: "" // 수수료
  });

  // 이자 입력 폼
  const [interestForm, setInterestForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    amount: "",
    rate: "", // 이율 (%)
    tax: "" // 세금
  });

  // USD를 원화로 변환한 가격 (주식 탭과 동일)
  const adjustedPrices = useMemo(() => {
    if (!fxRate) return prices;
    return prices.map((p) => {
      if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
        return { ...p, price: p.price * fxRate, currency: "KRW" };
      }
      return p;
    });
  }, [prices, fxRate]);

  // 보유 종목 정보 계산 (주식 탭과 동일: adjustedPrices 사용)
  const positions = useMemo(() => {
    return computePositions(trades, adjustedPrices, accounts);
  }, [trades, adjustedPrices, accounts]);

  // 티커 자동완성 옵션 (보유 종목만)
  const tickerOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; subLabel?: string }> = [];
    
    // 보유 종목만 추가
    positions.forEach((pos) => {
      if (pos.quantity > 0) {
        options.push({
          value: pos.ticker,
          label: pos.name,
          subLabel: `보유: ${pos.quantity}주, 평균단가: ${Math.round(pos.avgPrice).toLocaleString()}원`
        });
      }
    });
    
    return options.sort((a, b) => a.value.localeCompare(b.value));
  }, [positions]);

  // 선택한 티커의 보유 정보 (주식 탭과 동일: 원화 기준)
  const selectedPosition = useMemo(() => {
    if (!dividendForm.ticker) return null;
    return positions.find((p) => p.ticker === dividendForm.ticker && p.quantity > 0);
  }, [positions, dividendForm.ticker]);

  // 선택한 티커의 통화 정보 (StocksView와 동일한 방식)
  const selectedTickerCurrency = useMemo(() => {
    if (!dividendForm.ticker) return undefined;
    
    // 1. 원본 prices에서 통화 정보 가져오기 (StocksView와 동일)
    const originalPriceInfo = prices.find((p) => p.ticker === dividendForm.ticker);
    if (originalPriceInfo?.currency) {
      return originalPriceInfo.currency;
    }
    
    // 2. prices에 없으면 tickerDatabase에서 market 정보로 판단
    const tickerInfo = tickerDatabase.find((t) => t.ticker === dividendForm.ticker);
    if (tickerInfo?.market === "US") {
      return "USD";
    }
    if (tickerInfo?.market === "KR") {
      return "KRW";
    }
    
    // 3. tickerDatabase에도 없으면 티커 패턴으로 판단
    // 한국 주식: 6자리 숫자 (예: 005930)
    // 미국 주식: 영문자 (예: AAPL, SCHD)
    const ticker = dividendForm.ticker.toUpperCase();
    if (/^[0-9]{6}$/.test(ticker)) {
      return "KRW";
    }
    if (/^[A-Z]{1,6}$/.test(ticker)) {
      return "USD";
    }
    
    return undefined;
  }, [prices, tickerDatabase, dividendForm.ticker]);

  // 환율 조회
  useEffect(() => {
    const updateFxRate = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          setFxRate(r.price);
        }
      } catch (err) {
        console.warn("FX fetch failed", err);
      }
    };
    updateFxRate();
  }, []);

  const formatUSD = (value: number) => Math.round(value).toLocaleString("en-US");
  const formatCurrency = (value: number, currency?: string, originalValue?: number) => {
    // value는 이미 원화로 변환된 값 (adjustedPrices 사용)
    // originalValue는 원본 USD 가격 (표시용)
    if (currency === "USD" && showUSD && originalValue != null) {
      const base = `${formatUSD(originalValue)} USD`;
      if (fxRate) {
        return `${base} (약 ${formatKRW(Math.round(originalValue * fxRate))})`;
      }
      return base;
    }
    if (currency === "USD" && fxRate && !showUSD) {
      // 원화로 표시 (이미 원화로 변환된 값 사용)
      return `${formatKRW(Math.round(value))}`;
    }
    if (currency && currency !== "KRW" && showUSD && originalValue != null) {
      return `${Math.round(originalValue).toLocaleString("en-US")} ${currency}`;
    }
    return `${formatKRW(Math.round(value))}`;
  };

  // 배당율 계산 (주식 탭과 동일: 항상 원화 기준, 순 배당금 기준)
  const dividendYield = useMemo(() => {
    if (!dividendForm.amount || !selectedPosition) return null;
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (amount <= 0 || selectedPosition.avgPrice <= 0 || selectedPosition.quantity <= 0) return null;
    
    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
      // 세금과 수수료도 USD로 입력받았으면 원화로 변환
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      // 원화로 입력받았으면 세금/수수료 차감
      amount = amount - tax - fee;
    }
    
    // totalCost는 이미 원화 기준 (positions는 adjustedPrices 사용)
    const totalCost = selectedPosition.avgPrice * selectedPosition.quantity;
    return (amount / totalCost) * 100;
  }, [dividendForm.amount, dividendForm.tax, dividendForm.fee, selectedPosition, selectedTickerCurrency, showUSD, fxRate]);

  // 이전 배당 입력 내역 (빠른 재입력용)
  const recentDividends = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" && (l.category === "배당" || (l.description ?? "").includes("배당"));

    const tickerMap = new Map<string, { ticker: string; name: string; amount: number; accountId: string; date: string }>();
    
    // 최근 배당 내역을 티커별로 추출 (최신 것만)
    for (const l of ledger) {
      if (!isDividend(l)) continue;
      const tickerMatch = (l.description ?? "").match(/([0-9]{6}|[A-Z]{1,6})/);
      if (!tickerMatch) continue;
      
      const ticker = tickerMatch[1].toUpperCase();
      const name = prices.find((p) => p.ticker === ticker)?.name || 
                   trades.find((t) => t.ticker === ticker)?.name || 
                   "";
      
      // 같은 티커가 이미 있으면 날짜가 더 최신인 것만 유지
      const existing = tickerMap.get(ticker);
      if (!existing || (l.date && existing.date < l.date)) {
        tickerMap.set(ticker, {
          ticker,
          name,
          amount: l.amount,
          accountId: l.toAccountId || "",
          date: l.date || ""
        });
      }
    }
    
    return Array.from(tickerMap.values())
      .filter((d) => positions.some((p) => p.ticker === d.ticker && p.quantity > 0)) // 보유 종목만
      .sort((a, b) => b.date.localeCompare(a.date)); // 최신순 정렬
  }, [ledger, prices, trades, positions]);

  // 빠른 입력: 이전 배당 내역 적용 (수정 가능)
  const applyRecentDividend = (recent: { ticker: string; name: string; amount: number; accountId: string }) => {
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: recent.accountId || dividendForm.accountId,
      ticker: recent.ticker,
      name: recent.name,
      amount: recent.amount.toString(),
      tax: "", // 세금은 매번 새로 입력
      fee: "" // 수수료는 매번 새로 입력
    });
  };

  const handleDividendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (!dividendForm.date || !dividendForm.accountId || !dividendForm.ticker || !amount || amount <= 0) {
      return;
    }

    // 주식 탭과 동일: 항상 원화(KRW) 기준으로 저장
    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate; // USD → KRW 변환
      // 세금과 수수료도 USD로 입력받았으면 원화로 변환
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      // 원화로 입력받았으면 그대로 사용하고 세금/수수료 차감
      amount = amount - tax - fee;
    }

    // 순 배당금 (세금, 수수료 제외)
    const netAmount = amount;

    const description = `${dividendForm.ticker}${dividendForm.name ? ` - ${dividendForm.name}` : ""} 배당${tax > 0 ? `, 세금: ${Math.round(tax).toLocaleString()}원` : ""}${fee > 0 ? `, 수수료: ${Math.round(fee).toLocaleString()}원` : ""}`;
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: dividendForm.date,
      kind: "income",
      category: "배당",
      description: description,
      toAccountId: dividendForm.accountId,
      amount: netAmount // 순 배당금 (세금, 수수료 제외) - 항상 원화 기준으로 저장
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: dividendForm.accountId,
      ticker: "",
      name: "",
      amount: "",
      tax: "",
      fee: ""
    });
  };

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
      id: `I${Date.now()}`,
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
      date: new Date().toISOString().slice(0, 10),
      accountId: interestForm.accountId,
      amount: "",
      rate: "",
      tax: ""
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
        <h2>배당/이자 (수입)</h2>
      </div>

      {/* 탭 버튼 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={activeTab === "dividend" ? "primary" : ""}
          onClick={() => setActiveTab("dividend")}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          배당 입력
        </button>
        <button
          type="button"
          className={activeTab === "interest" ? "primary" : ""}
          onClick={() => setActiveTab("interest")}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          이자 입력
        </button>
      </div>

      {/* 배당 입력 폼 */}
      {activeTab === "dividend" && (
        <>
          {/* 빠른 입력: 이전 배당 내역 */}
          {recentDividends.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16, backgroundColor: "#f8fafc" }}>
              <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>빠른 입력 (이전 배당 내역)</h4>
              <p className="hint" style={{ marginBottom: 12, fontSize: 13 }}>
                이전에 입력한 배당 내역을 클릭하면 자동으로 폼이 채워집니다. 모든 필드를 수정할 수 있습니다.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {recentDividends.map((recent, idx) => {
                  const pos = positions.find((p) => p.ticker === recent.ticker);
                  // 통화 정보 가져오기 (StocksView와 동일한 방식)
                  const originalPriceInfo = prices.find((p) => p.ticker === recent.ticker);
                  let currency = originalPriceInfo?.currency;
                  if (!currency) {
                    const tickerInfo = tickerDatabase.find((t) => t.ticker === recent.ticker);
                    if (tickerInfo?.market === "US") {
                      currency = "USD";
                    } else if (tickerInfo?.market === "KR") {
                      currency = "KRW";
                    } else {
                      // 티커 패턴으로 판단
                      const ticker = recent.ticker.toUpperCase();
                      if (/^[0-9]{6}$/.test(ticker)) {
                        currency = "KRW";
                      } else if (/^[A-Z]{1,6}$/.test(ticker)) {
                        currency = "USD";
                      }
                    }
                  }
                  return (
                    <button
                      key={`${recent.ticker}-${idx}`}
                      type="button"
                      onClick={() => applyRecentDividend(recent)}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        border: "1px solid var(--border, #ddd)",
                        borderRadius: 6,
                        backgroundColor: "white",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        minWidth: "140px"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#eef2ff";
                        e.currentTarget.style.borderColor = "#2563eb";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "white";
                        e.currentTarget.style.borderColor = "var(--border, #ddd)";
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#1e40af" }}>
                        {recent.ticker}
                      </div>
                      {recent.name && (
                        <div style={{ fontSize: 12, color: "#666" }}>
                          {recent.name.length > 15 ? recent.name.slice(0, 15) + "..." : recent.name}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 500 }}>
                        {formatKRW(Math.round(recent.amount))}
                      </div>
                      {pos && (
                        <div style={{ fontSize: 11, color: "#888" }}>
                          보유: {pos.quantity}주
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>배당 입력</h3>
              {selectedTickerCurrency && selectedTickerCurrency !== "KRW" && (
                <button
                  type="button"
                  className={showUSD ? "primary" : "secondary"}
                  onClick={() => setShowUSD((v) => !v)}
                  style={{ padding: "6px 12px", fontSize: 13 }}
                >
                  {showUSD ? "USD ON" : "USD OFF"}
                </button>
              )}
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              받은 배당금을 입력하세요. 보유 종목의 평균 단가와 수량이 자동으로 표시됩니다.
            </p>
            <form onSubmit={handleDividendSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
                <input
                  type="date"
                  value={dividendForm.date}
                  onChange={(e) => setDividendForm({ ...dividendForm, date: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
                <select
                  value={dividendForm.accountId}
                  onChange={(e) => setDividendForm({ ...dividendForm, accountId: e.target.value })}
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
                <span style={{ fontSize: 13, fontWeight: 500 }}>티커</span>
                <Autocomplete
                  value={dividendForm.ticker}
                  onChange={(val) => setDividendForm({ ...dividendForm, ticker: val.toUpperCase(), name: "" })}
                  options={tickerOptions}
                  onSelect={(option) => {
                    setDividendForm({
                      ...dividendForm,
                      ticker: option.value,
                      name: option.label || ""
                    });
                  }}
                  placeholder="티커를 입력하거나 선택하세요"
                />
              </label>
              {selectedPosition && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>평균 단가</span>
                    <input
                      type="text"
                      value={formatKRW(Math.round(selectedPosition.avgPrice))}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>보유 수량</span>
                    <input
                      type="text"
                      value={`${selectedPosition.quantity}주`}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>총 매입 금액</span>
                    <input
                      type="text"
                      value={formatKRW(Math.round(selectedPosition.avgPrice * selectedPosition.quantity))}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                </>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  배당 금액
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                  {selectedTickerCurrency === "USD" && showUSD && fxRate && dividendForm.amount && (
                    <span style={{ fontSize: 11, color: "#666", marginLeft: 4 }}>
                      ≈ {formatKRW(Math.round(Number(dividendForm.amount) * fxRate))}
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={dividendForm.amount}
                  onChange={(e) => setDividendForm({ ...dividendForm, amount: e.target.value })}
                  placeholder={selectedTickerCurrency === "USD" && showUSD ? "USD로 입력" : "원화로 입력"}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  세금
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={dividendForm.tax}
                  onChange={(e) => setDividendForm({ ...dividendForm, tax: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  수수료
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={dividendForm.fee}
                  onChange={(e) => setDividendForm({ ...dividendForm, fee: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              {dividendYield != null && (
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>배당율</span>
                  <input
                    type="text"
                    value={`${dividendYield.toFixed(2)}%`}
                    disabled
                    style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5", color: "#2563eb", fontWeight: 600 }}
                  />
                </label>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
                추가
              </button>
            </div>
          </form>
        </div>
        </>
      )}

      {/* 이자 입력 폼 */}
      {activeTab === "interest" && (
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
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.id}
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
      )}


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

