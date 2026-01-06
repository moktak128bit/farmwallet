import React, { useMemo, useState, useEffect } from "react";
import type { Account, LedgerEntry, StockPrice, StockTrade, TickerInfo } from "../types";
import { Autocomplete } from "./Autocomplete";
import { formatKRW, formatNumber } from "../utils/format";

interface PositionWithPrice {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  totalBuyAmount: number;
  displayMarketPrice: number;
  currency?: string;
}

interface Props {
  position: PositionWithPrice | null;
  accounts: Account[];
  trades: StockTrade[];
  prices: StockPrice[];
  ledger: LedgerEntry[];
  tickerDatabase: TickerInfo[];
  onClose: () => void;
  onChangeLedger: (ledger: LedgerEntry[]) => void;
  fxRate?: number | null;
}

export const StockDetailModal: React.FC<Props> = ({
  position,
  accounts,
  trades,
  prices,
  ledger,
  tickerDatabase,
  onClose,
  onChangeLedger,
  fxRate: propFxRate = null
}) => {
  const [activeTab, setActiveTab] = useState<"trades" | "dividends">("trades");
  const [showUSD, setShowUSD] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(propFxRate);
  
  // 배당 입력 폼
  const [dividendForm, setDividendForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    amount: "",
    tax: "",
    fee: ""
  });

  // 환율 업데이트 (props에서 전달받은 경우)
  useEffect(() => {
    if (propFxRate !== null) {
      setFxRate(propFxRate);
    }
  }, [propFxRate]);

  if (!position) return null;

  // 선택한 티커의 통화 정보
  const selectedTickerCurrency = useMemo(() => {
    if (!position.ticker) return undefined;
    
    const originalPriceInfo = prices.find((p) => p.ticker === position.ticker);
    if (originalPriceInfo?.currency) {
      return originalPriceInfo.currency;
    }
    
    const tickerInfo = tickerDatabase.find((t) => t.ticker === position.ticker);
    if (tickerInfo?.market === "US") {
      return "USD";
    }
    if (tickerInfo?.market === "KR") {
      return "KRW";
    }
    
    const ticker = position.ticker.toUpperCase();
    if (/^[0-9]{6}$/.test(ticker)) {
      return "KRW";
    }
    if (/^[A-Z]{1,6}$/.test(ticker)) {
      return "USD";
    }
    
    return undefined;
  }, [prices, tickerDatabase, position.ticker]);

  // 해당 종목의 거래 내역
  const positionTrades = useMemo(() => {
    return trades
      .filter((t) => t.ticker === position.ticker && t.accountId === position.accountId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [trades, position]);

  // 해당 종목의 배당 내역
  const positionDividends = useMemo(() => {
    const isDividend = (l: LedgerEntry) => {
      if (l.kind !== "income") return false;
      if (l.category !== "배당" && !(l.description ?? "").includes("배당")) return false;
      
      // 티커 매칭: description이나 category에서 티커 찾기
      const tickerMatch = (l.description ?? "").match(/([0-9]{6}|[0-9A-Z]{1,10})/i) ||
        (l.category ?? "").match(/([0-9]{6}|[0-9A-Z]{1,10})/i);
      const ledgerTicker = tickerMatch ? tickerMatch[1].toUpperCase() : "";
      
      return ledgerTicker === position.ticker.toUpperCase();
    };
    
    return ledger
      .filter(isDividend)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ledger, position]);

  // 배당 총액
  const totalDividend = useMemo(() => {
    return positionDividends.reduce((sum, d) => sum + d.amount, 0);
  }, [positionDividends]);

  // 배당율 계산
  const dividendYield = useMemo(() => {
    if (!dividendForm.amount || !position) return null;
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (amount <= 0 || position.avgPrice <= 0 || position.quantity <= 0) return null;
    
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      amount = amount - tax - fee;
    }
    
    const totalCost = position.avgPrice * position.quantity;
    return (amount / totalCost) * 100;
  }, [dividendForm.amount, dividendForm.tax, dividendForm.fee, position, selectedTickerCurrency, showUSD, fxRate]);

  // 배당 입력 처리
  const handleDividendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (!dividendForm.date || !dividendForm.accountId || !amount || amount <= 0) {
      return;
    }

    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      amount = amount - tax - fee;
    }

    const netAmount = amount;
    const description = `${position.ticker}${position.name ? ` - ${position.name}` : ""} 배당${tax > 0 ? `, 세금: ${Math.round(tax).toLocaleString()}원` : ""}${fee > 0 ? `, 수수료: ${Math.round(fee).toLocaleString()}원` : ""}`;
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: dividendForm.date,
      kind: "income",
      category: "배당",
      description: description,
      toAccountId: dividendForm.accountId,
      amount: netAmount
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: dividendForm.accountId,
      amount: "",
      tax: "",
      fee: ""
    });
  };

  // 배당 삭제
  const handleDeleteDividend = (dividendId: string) => {
    if (confirm("이 배당 기록을 삭제하시겠습니까?")) {
      const newLedger = ledger.filter((l) => l.id !== dividendId);
      onChangeLedger(newLedger);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "900px", width: "90vw", maxHeight: "90vh", overflow: "auto" }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{position.ticker}</h2>
            <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "var(--text-muted)" }}>
              {position.name}
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="modal-body">
          {/* 종목 정보 요약 */}
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>보유 수량</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{position.quantity.toLocaleString()}주</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>평균 단가</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {selectedTickerCurrency === "USD" && showUSD
                    ? `$${formatNumber(position.avgPrice)}`
                    : formatKRW(Math.round(position.avgPrice))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>현재가</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {selectedTickerCurrency === "USD" && showUSD
                    ? `$${formatNumber(position.displayMarketPrice)}`
                    : formatKRW(Math.round(position.displayMarketPrice))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>총 매입 금액</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {selectedTickerCurrency === "USD" && showUSD
                    ? `$${formatNumber(position.totalBuyAmount)}`
                    : formatKRW(Math.round(position.totalBuyAmount))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>총 배당금</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#10b981" }}>
                  {formatKRW(Math.round(totalDividend))}
                </div>
              </div>
            </div>
          </div>

          {/* 탭 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className={activeTab === "trades" ? "primary" : ""}
              onClick={() => setActiveTab("trades")}
              style={{ padding: "8px 16px", fontSize: 14 }}
            >
              거래 내역
            </button>
            <button
              type="button"
              className={activeTab === "dividends" ? "primary" : ""}
              onClick={() => setActiveTab("dividends")}
              style={{ padding: "8px 16px", fontSize: 14 }}
            >
              배당
            </button>
          </div>

          {/* 거래 내역 탭 */}
          {activeTab === "trades" && (
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>거래 내역</h3>
              {positionTrades.length === 0 ? (
                <p className="hint" style={{ textAlign: "center", padding: 20 }}>
                  거래 내역이 없습니다.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>구분</th>
                      <th>수량</th>
                      <th>단가</th>
                      <th>수수료</th>
                      <th>총액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionTrades.map((trade) => (
                      <tr key={trade.id}>
                        <td>{trade.date}</td>
                        <td style={{ color: trade.side === "buy" ? "#0ea5e9" : "#f43f5e", fontWeight: 600 }}>
                          {trade.side === "buy" ? "매수" : "매도"}
                        </td>
                        <td className="number">{trade.quantity.toLocaleString()}주</td>
                        <td className="number">
                          {selectedTickerCurrency === "USD" && showUSD
                            ? `$${formatNumber(trade.price)}`
                            : formatKRW(Math.round(trade.price))}
                        </td>
                        <td className="number">{formatKRW(Math.round(trade.fee))}</td>
                        <td className="number" style={{ fontWeight: 600 }}>
                          {selectedTickerCurrency === "USD" && showUSD
                            ? `$${formatNumber(trade.totalAmount)}`
                            : formatKRW(Math.round(trade.totalAmount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 배당 탭 */}
          {activeTab === "dividends" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
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

              {/* 배당 입력 폼 */}
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
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
                      배당 추가
                    </button>
                  </div>
                </form>
              </div>

              {/* 배당 내역 */}
              <h3 style={{ marginTop: 16 }}>배당 내역</h3>
              {positionDividends.length === 0 ? (
                <p className="hint" style={{ textAlign: "center", padding: 20 }}>
                  배당 내역이 없습니다.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>금액</th>
                      <th>계좌</th>
                      <th>설명</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionDividends.map((dividend) => (
                      <tr key={dividend.id}>
                        <td>{dividend.date}</td>
                        <td className="number positive" style={{ fontWeight: 600 }}>
                          {formatKRW(Math.round(dividend.amount))}
                        </td>
                        <td>{dividend.toAccountId || "-"}</td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                          {dividend.description || "-"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteDividend(dividend.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: 18,
                              padding: "4px 8px",
                              borderRadius: 4
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "#fee2e2";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "transparent";
                            }}
                            title="삭제"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

