import React, { useMemo, useState } from "react";
import type { StockPrice } from "../types";
import { fetchYahooQuotes } from "../yahooFinanceApi";

interface Props {
  prices: StockPrice[];
  onChangePrices: (next: StockPrice[]) => void;
}

const cleanTicker = (raw: string) => raw.trim().toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");

export const PriceLookupView: React.FC<Props> = ({ prices, onChangePrices }) => {
  const initialTickers = useMemo(() => {
    const set = new Set<string>();
    prices.forEach((p) => set.add(p.ticker));
    return Array.from(set).join(", ");
  }, [prices]);

  const [input, setInput] = useState(initialTickers);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    const list = input
      .split(/[,\\s]+/)
      .map(cleanTicker)
      .filter(Boolean);
    const unique = Array.from(new Set(list));
    if (unique.length === 0) return;

    try {
      setIsLoading(true);
      setError(null);
      const results = await fetchYahooQuotes(unique);
      if (!results.length) {
        setError("시세를 가져오지 못했습니다.");
        return;
      }
      const next = [...prices];
      for (const r of results) {
        const idx = next.findIndex((p) => p.ticker === r.ticker);
        const item: StockPrice = {
          ticker: r.ticker,
          name: r.name ?? r.ticker,
          price: r.price,
          currency: r.currency,
          change: r.change,
          changePercent: r.changePercent,
          updatedAt: r.updatedAt
        };
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...item };
        } else {
          next.push(item);
        }
      }
      onChangePrices(next);
    } catch (err) {
      console.error(err);
      setError("조회 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>주식 시세 조회</h2>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <label className="wide">
            <span>티커/종목 코드 (쉼표 또는 공백으로 구분)</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}
            />
          </label>
          <div className="form-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="primary" onClick={handleFetch} disabled={isLoading}>
              {isLoading ? "조회 중..." : "시세 조회"}
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>티커</th>
            <th>종목명</th>
            <th>가격</th>
            <th>통화</th>
            <th>변동</th>
            <th>업데이트</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.ticker}>
              <td>{p.ticker}</td>
              <td>{p.name}</td>
              <td className="number">{p.price.toLocaleString()}</td>
              <td>{p.currency ?? "-"}</td>
              <td className={`number ${p.change && p.change > 0 ? "positive" : p.change && p.change < 0 ? "negative" : ""}`}>
                {p.change != null ? p.change.toLocaleString() : "-"}{" "}
                {p.changePercent != null ? `(${p.changePercent.toFixed(2)}%)` : ""}
              </td>
              <td>{p.updatedAt ? new Date(p.updatedAt).toLocaleString("ko-KR") : "-"}</td>
            </tr>
          ))}
          {prices.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                아직 저장된 시세가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
