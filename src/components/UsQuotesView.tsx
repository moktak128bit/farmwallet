import React, { useEffect, useMemo, useState } from "react";
import type { StockPrice } from "../types";
import { fetchYahooBatchQuotes, fetchYahooQuotes } from "../yahooFinanceApi";

interface Props {
  usTickers: string[];
  prices: StockPrice[];
  onChangeUsTickers: (tickers: string[]) => void;
  onChangePrices: (next: StockPrice[]) => void;
}

const cleanTicker = (raw: string) => raw.trim().toUpperCase();

export const UsQuotesView: React.FC<Props> = ({
  usTickers,
  prices,
  onChangeUsTickers,
  onChangePrices
}) => {
  const [input, setInput] = useState(usTickers.join(", "));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<StockPrice[]>([]);

  useEffect(() => {
    setInput(usTickers.join(", "));
    const listSet = new Set(usTickers);
    setRows(prices.filter((p) => listSet.has(p.ticker)));
  }, [usTickers, prices]);

  const placeholder = useMemo(
    () => "예: AAPL, MSFT, SPY, QQQ ... (미국 티커 여러 개를 쉼표나 줄바꿈으로 입력)",
    []
  );

  const handleSaveTickers = () => {
    const list = input
      .split(/[,\s]+/)
      .map(cleanTicker)
      .filter(Boolean);
    const unique = Array.from(new Set(list));
    if (!unique.length) return;
    setIsSaving(true);
    setSaveMessage(null);
    onChangeUsTickers(unique);
    window.setTimeout(() => {
      setIsSaving(false);
      setSaveMessage(`목록 ${unique.length}개 저장 완료`);
    }, 200);
  };

  const handleFetch = async () => {
    const list = input
      .split(/[,\s]+/)
      .map(cleanTicker)
      .filter(Boolean);
    const unique = Array.from(new Set(list));
    if (!unique.length) return;

    try {
      setIsLoading(true);
      setError(null);
      setProgressMessage(null);
      onChangeUsTickers(unique);
      let results: StockPrice[] = [];
      try {
        results = await fetchYahooBatchQuotes(unique);
      } catch (batchErr) {
        console.warn("batch fetch failed, fallback to single", batchErr);
        results = await fetchYahooQuotes(unique);
      }

      const succeeded = new Set(results.map((r) => r.ticker.toUpperCase()));
      const remaining = unique.filter((t) => !succeeded.has(t.toUpperCase()));

      // 남은 건 개별 조회 (느리지만 확실)
      for (const t of remaining) {
        try {
          const single = await fetchYahooQuotes([t]);
          if (single.length) {
            results.push(single[0]);
            succeeded.add(t.toUpperCase());
          }
        } catch (e) {
          console.warn("single fetch failed", t, e);
        }
      }

      const failCount = unique.length - succeeded.size;
      if (!results.length) {
        setError("시세를 가져오지 못했습니다. 틱커를 다시 확인해주세요.");
        return;
      }
      if (failCount > 0) {
        setProgressMessage(`성공 ${succeeded.size}개, 실패 ${failCount}개 (일부 티커는 미상장/폐지 가능)`);
      } else {
        setProgressMessage(`총 ${succeeded.size}개 시세 갱신 완료`);
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
      setRows(results);
    } catch (err) {
      console.error(err);
      setError("조회 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const displayRows = rows.length ? rows : prices.filter((p) => usTickers.includes(p.ticker));

  return (
    <div>
      <div className="section-header">
        <h2>미국 주식 시세</h2>
        <p className="subtitle">티커 목록을 저장해 두고 버튼 한 번으로 시세를 업데이트하세요.</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <label className="wide">
            <span>티커 목록 (쉼표 또는 줄바꿈으로 구분)</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              rows={4}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}
            />
          </label>
          <div className="form-actions" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={handleSaveTickers} disabled={isLoading || isSaving}>
              {isSaving ? "저장 중..." : "목록 저장"}
            </button>
            <button type="button" className="primary" onClick={handleFetch} disabled={isLoading}>
              {isLoading ? "시세 조회 중..." : "미국 시세 조회"}
            </button>
          </div>
        </div>
        <p className="hint">
          붙여넣기 후 "목록 저장"을 누르면 데이터 파일에 보관됩니다. "미국 시세 조회"를 누르면 즉시
          가격을 갱신합니다.
        </p>
        {saveMessage && <p className="hint positive">{saveMessage}</p>}
        {progressMessage && <p className="hint">{progressMessage}</p>}
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
          {displayRows.map((p) => (
            <tr key={p.ticker}>
              <td>{p.ticker}</td>
              <td>{p.name ?? "-"}</td>
              <td className="number">{p.price != null ? p.price.toLocaleString() : "-"}</td>
              <td>{p.currency ?? "-"}</td>
              <td className={`number ${p.change && p.change > 0 ? "positive" : p.change && p.change < 0 ? "negative" : ""}`}>
                {p.change != null ? p.change.toLocaleString() : "-"}{" "}
                {p.changePercent != null ? `(${p.changePercent.toFixed(2)}%)` : ""}
              </td>
              <td>{p.updatedAt ? new Date(p.updatedAt).toLocaleString("ko-KR") : "-"}</td>
            </tr>
          ))}
          {displayRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                저장된 미국 시세가 없습니다. 목록을 붙여넣고 조회해주세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
