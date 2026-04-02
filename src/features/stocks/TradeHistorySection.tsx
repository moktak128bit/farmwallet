import React, { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import type { Account, StockPrice, StockTrade, TradeSide } from "../../types";
import { computeRealizedPnlByTradeId } from "../../calculations";
import { isUSDStock, canonicalTickerForMatch } from "../../utils/finance";
import { validateAccountTickerCurrency } from "../../utils/validation";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { formatNumber, formatKRW, formatUSD, formatShortDate } from "../../utils/formatter";

const sideLabel: Record<TradeSide, string> = {
  buy: "매수",
  sell: "매도"
};

type TradeSortKey = "date" | "accountId" | "ticker" | "name" | "side" | "quantity" | "price" | "fee" | "totalAmount";

interface TradeHistorySectionProps {
  trades: StockTrade[];
  accounts: Account[];
  prices: StockPrice[];
  fxRate: number | null;
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onStartEditTrade: (trade: StockTrade) => void;
  onResetTradeForm?: () => void;
  onChangeAccounts?: (next: Account[]) => void;
  highlightTradeId?: string | null;
  onClearHighlightTrade?: () => void;
}

const formatPriceWithCurrency = (value: number, currency?: string, ticker?: string) => {
  const isUSD = currency === "USD" || isUSDStock(ticker);
  if (isUSD) {
    return formatUSD(value);
  }
  return formatKRW(value);
};

const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
  if (activeKey !== key) return "↕";
  return direction === "asc" ? "↑" : "↓";
};

export const TradeHistorySection: React.FC<TradeHistorySectionProps> = ({
  trades,
  accounts,
  prices,
  fxRate,
  onChangeTrades,
  onStartEditTrade,
  onResetTradeForm,
  onChangeAccounts,
  highlightTradeId,
  onClearHighlightTrade
}) => {
  const [tradeSort, setTradeSort] = useState<{ key: TradeSortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
  });
  const [tradeCurrentPage, setTradeCurrentPage] = useState(1);
  const [tradePageSize] = useState(50);

  // 컬럼 너비 (퍼센트, 합계 100). 순서, 날짜, 계좌, 티커, 종목명, 매매, 수량, 단가, 수수료, 총금액, 실현손익, 초기보유, 작업
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("trades-column-widths");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length === 13) {
            const total = parsed.reduce((s: number, w: number) => s + w, 0);
            if (total > 0) return parsed.map((w: number) => (w / total) * 100);
          }
        }
      } catch (e) {
        console.warn("[TradeHistorySection] 로컬 저장 로드 실패", e);
      }
    }
    return [3, 7, 6, 6, 14, 5, 6, 9, 8, 11, 10, 5, 6];
  });
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);
  const [draggingTradeId, setDraggingTradeId] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{
    id: string;
    date: string;
    accountId: string;
    ticker: string;
    name: string;
    side: TradeSide;
    quantity: string;
    price: string;
    fee: string;
  } | null>(null);
  const [inlineEditField, setInlineEditField] = useState<"date" | "accountId" | "quantity" | "price" | "fee" | "totalAmount" | null>(null);

  const realizedPnlByTradeId = useMemo(() => computeRealizedPnlByTradeId(trades), [trades]);

  const sortedTrades = useMemo(() => {
    const dir = tradeSort.direction === "asc" ? 1 : -1;
    return [...trades].sort((a, b) => {
      const key = tradeSort.key;
      const va = (a as any)[key];
      const vb = (b as any)[key];
      if (key === "date") {
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      }
      if (typeof va === "string" || typeof vb === "string") {
        return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
      }
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  }, [trades, tradeSort]);

  const paginatedTrades = useMemo(() => {
    const startIndex = (tradeCurrentPage - 1) * tradePageSize;
    const endIndex = startIndex + tradePageSize;
    return sortedTrades.slice(startIndex, endIndex);
  }, [sortedTrades, tradeCurrentPage, tradePageSize]);

  const tradeTotalPages = useMemo(() => {
    return Math.ceil(sortedTrades.length / tradePageSize);
  }, [sortedTrades.length, tradePageSize]);

  // 검색에서 이동: 해당 거래가 있는 페이지로 전환
  useEffect(() => {
    if (!highlightTradeId) return;
    const idx = sortedTrades.findIndex((t) => t.id === highlightTradeId);
    if (idx === -1) return;
    const page = Math.max(1, Math.ceil((idx + 1) / tradePageSize));
    if (page !== tradeCurrentPage) setTradeCurrentPage(page);
  }, [highlightTradeId, sortedTrades, tradePageSize, tradeCurrentPage]);

  const highlightClearTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!highlightTradeId || !onClearHighlightTrade) return;
    const t1 = window.setTimeout(() => {
      const el = document.querySelector(`tr[data-trade-id="${highlightTradeId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ledger-row-highlight");
      highlightClearTimerRef.current = window.setTimeout(() => {
        el.classList.remove("ledger-row-highlight");
        onClearHighlightTrade();
        highlightClearTimerRef.current = null;
      }, 2500);
    }, 150);
    return () => {
      window.clearTimeout(t1);
      if (highlightClearTimerRef.current !== null) {
        window.clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = null;
      }
    };
  }, [highlightTradeId, onClearHighlightTrade]);

  useEffect(() => {
    setTradeCurrentPage(1);
  }, [tradeSort.key, tradeSort.direction]);

  // 컬럼 너비 변경 시 localStorage에 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("trades-column-widths", JSON.stringify(columnWidths));
    }
  }, [columnWidths]);

  // 컬럼 리사이즈 핸들러
  const handleResizeStart = (e: React.MouseEvent, columnIndex: number) => {
    e.preventDefault();
    setResizingColumn(columnIndex);
    setResizeStartX(e.clientX);
    setResizeStartWidth(columnWidths[columnIndex]);
  };

  useEffect(() => {
    if (resizingColumn === null) return;

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const table = document.querySelector(".trades-table") as HTMLElement;
      if (!table) return;

      const tableWidth = table.offsetWidth;
      const deltaX = e.clientX - resizeStartX;
      const deltaPercent = (deltaX / tableWidth) * 100;

      const newWidths = [...columnWidths];
      const newWidth = Math.max(2, Math.min(35, resizeStartWidth + deltaPercent));
      newWidths[resizingColumn] = newWidth;

      const total = newWidths.reduce((sum, w) => sum + w, 0);
      if (total > 0) {
        const scale = 100 / total;
        const adjustedWidths = newWidths.map((w) => w * scale);
        setColumnWidths(adjustedWidths);
      }
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth, columnWidths]);

  const toggleTradeSort = (key: TradeSortKey) => {
    setTradeSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const startInlineEdit = (t: StockTrade, field?: "date" | "accountId" | "quantity" | "price" | "fee" | "totalAmount") => {
    setInlineEdit({
      id: t.id,
      date: t.date,
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee)
    });
    setInlineEditField(field || null);
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setInlineEditField(null);
  };

  const saveInlineEdit = () => {
    if (!inlineEdit) return;
    const quantity = Number(inlineEdit.quantity);
    const price = Number(inlineEdit.price);
    const fee = Number(inlineEdit.fee || "0");
    if (!inlineEdit.date || !inlineEdit.accountId || !inlineEdit.ticker || !quantity || !price) {
      return;
    }
    const side = inlineEdit.side;
    
    const selectedAccount = accounts.find((a) => a.id === inlineEdit.accountId);
    if (!selectedAccount) {
      toast.error(ERROR_MESSAGES.ACCOUNT_REQUIRED);
      return;
    }
    const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(inlineEdit.ticker));
    const currencyValidation = validateAccountTickerCurrency(selectedAccount, inlineEdit.ticker, priceInfo);
    if (!currencyValidation.valid) {
      toast.error(currencyValidation.error ?? "계좌와 종목 통화가 일치하지 않습니다.");
      return;
    }
    const isUSDCurrency = priceInfo?.currency === "USD" || isUSDStock(inlineEdit.ticker);
    const exchangeRate = isUSDCurrency && fxRate ? fxRate : 1;
    const totalAmount = side === "buy" 
      ? quantity * price + fee 
      : quantity * price - fee;
    const totalAmountKRW = totalAmount * exchangeRate;
    const cashImpact = side === "buy" ? -totalAmountKRW : totalAmountKRW;
    const updated = trades.map((t) =>
      t.id === inlineEdit.id
        ? {
            ...t,
            date: inlineEdit.date,
            accountId: inlineEdit.accountId,
            ticker: inlineEdit.ticker,
            name: inlineEdit.name || inlineEdit.ticker,
            side: inlineEdit.side,
            quantity,
            price,
            fee,
            totalAmount,
            cashImpact
          }
        : t
    );
    onChangeTrades(updated);
    setInlineEdit(null);
    setInlineEditField(null);
  };

  const handleDeleteTrade = (id: string) => {
    const tradeToDelete = trades.find((t) => t.id === id);
    if (!tradeToDelete) return;
    
    let updatedAccounts = accounts;
    const account = accounts.find((a) => a.id === tradeToDelete.accountId);
    if (account?.type === "securities" && onChangeAccounts) {
      const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(tradeToDelete.ticker));
      const isUSD = priceInfo?.currency === "USD" || isUSDStock(tradeToDelete.ticker);
      
      if (isUSD) {
        const usdImpact = tradeToDelete.side === "buy" ? tradeToDelete.totalAmount : -tradeToDelete.totalAmount;
        updatedAccounts = accounts.map((a) => {
          if (a.id === tradeToDelete.accountId) {
            const currentUsdBalance = a.usdBalance ?? 0;
            const newUsdBalance = currentUsdBalance + usdImpact;
            return { ...a, usdBalance: newUsdBalance };
          }
          return a;
        });
      }
    }
    
    onChangeTrades((prevTrades) => prevTrades.filter((t) => t.id !== id));
    
    if (account?.type === "securities" && onChangeAccounts && updatedAccounts !== accounts) {
      setTimeout(() => {
        onChangeAccounts(updatedAccounts);
      }, 0);
    }
    if (onResetTradeForm) {
      onResetTradeForm();
    }
    if (inlineEdit?.id === id) {
      setInlineEdit(null);
    }
  };

  const handleReorderTrade = (id: string, newIndex: number) => {
    const currentIndex = trades.findIndex((t) => t.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(trades.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const next = [...trades];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeTrades(next);
  };

  const toggleInitialHolding = (trade: StockTrade) => {
    if (trade.side !== "buy") return;
    const isCurrentlyInitial = trade.cashImpact === 0;
    const priceInfo = prices.find((p) => p.ticker === trade.ticker);
    const currency = priceInfo?.currency;
    const isUSD = currency === "USD" || isUSDStock(trade.ticker);
    const exchangeRate = isUSD && fxRate ? fxRate : 1;
    const totalAmountKRW = trade.totalAmount * exchangeRate;
    
    const updated = trades.map((t) =>
      t.id === trade.id
        ? {
            ...t,
            cashImpact: isCurrentlyInitial ? -totalAmountKRW : 0
          }
        : t
    );
    onChangeTrades(updated);
  };

  // 통화별로 합계 계산
  const krwTrades = trades.filter(t => !isUSDStock(t.ticker));
  const usdTrades = trades.filter(t => isUSDStock(t.ticker));
  
  const krwBuyAmount = krwTrades.filter(t => t.side === "buy").reduce((sum, t) => sum + t.totalAmount, 0);
  const krwSellAmount = krwTrades.filter(t => t.side === "sell").reduce((sum, t) => sum + t.totalAmount, 0);
  const krwFee = krwTrades.reduce((sum, t) => sum + t.fee, 0);
  const krwRealizedPnl = krwTrades
    .filter(t => t.side === "sell")
    .reduce((sum, t) => sum + (realizedPnlByTradeId.get(t.id) ?? 0), 0);

  const usdBuyAmount = usdTrades.filter(t => t.side === "buy").reduce((sum, t) => sum + t.totalAmount, 0);
  const usdSellAmount = usdTrades.filter(t => t.side === "sell").reduce((sum, t) => sum + t.totalAmount, 0);
  const usdFee = usdTrades.reduce((sum, t) => sum + t.fee, 0);
  const usdRealizedPnl = usdTrades
    .filter(t => t.side === "sell")
    .reduce((sum, t) => sum + (realizedPnlByTradeId.get(t.id) ?? 0), 0);

  return (
    <>
      <h3>거래 내역</h3>
      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
          {krwBuyAmount + krwSellAmount + krwFee > 0 && (
            <>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매수 (KRW):</span>
                <span className="negative">{formatKRW(Math.round(krwBuyAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매도 (KRW):</span>
                <span className="positive">{formatKRW(Math.round(krwSellAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 수수료 (KRW):</span>
                <span className="negative">{formatKRW(Math.round(krwFee))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 실현손익 (KRW):</span>
                <span className={krwRealizedPnl >= 0 ? "positive" : "negative"}>
                  {krwRealizedPnl >= 0 ? "+" : ""}{formatKRW(Math.round(krwRealizedPnl))}
                </span>
              </div>
            </>
          )}
          {usdBuyAmount + usdSellAmount + usdFee > 0 && (
            <>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매수 (USD):</span>
                <span className="negative">{formatUSD(usdBuyAmount)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매도 (USD):</span>
                <span className="positive">{formatUSD(usdSellAmount)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 수수료 (USD):</span>
                <span className="negative">{formatUSD(usdFee)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 실현손익 (USD):</span>
                <span className={usdRealizedPnl >= 0 ? "positive" : "negative"}>
                  {usdRealizedPnl >= 0 ? "+" : ""}{formatUSD(usdRealizedPnl)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table trades-table" style={{ width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            {columnWidths.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ position: "relative" }}>
                순서
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 0)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("date")}>
                  날짜 <span className="arrow">{sortIndicator(tradeSort.key, "date", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 1)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("accountId")}>
                  계좌 <span className="arrow">{sortIndicator(tradeSort.key, "accountId", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 2)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("ticker")}>
                  티커 <span className="arrow">{sortIndicator(tradeSort.key, "ticker", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 3)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("name")}>
                  종목명 <span className="arrow">{sortIndicator(tradeSort.key, "name", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 4)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("side")}>
                  매매 <span className="arrow">{sortIndicator(tradeSort.key, "side", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 5)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("quantity")}>
                  수량 <span className="arrow">{sortIndicator(tradeSort.key, "quantity", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 6)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("price")}>
                  단가 <span className="arrow">{sortIndicator(tradeSort.key, "price", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 7)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("fee")}>
                  수수료 <span className="arrow">{sortIndicator(tradeSort.key, "fee", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 8)} />
              </th>
              <th style={{ position: "relative" }}>
                <button type="button" className="sort-header" onClick={() => toggleTradeSort("totalAmount")}>
                  총금액 <span className="arrow">{sortIndicator(tradeSort.key, "totalAmount", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 9)} />
              </th>
              <th style={{ position: "relative" }} title="매도 건당 FIFO 기준 실현손익">
                실현손익
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 10)} />
              </th>
              <th style={{ position: "relative" }}>
                초기보유
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 11)} />
              </th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((t, index) => {
              const actualIndex = (tradeCurrentPage - 1) * tradePageSize + index;
              return (
                <tr
                  key={t.id}
                  data-trade-id={t.id}
                  draggable
                  onDragOver={(e) => {
                    if (!draggingTradeId) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!draggingTradeId) return;
                    e.preventDefault();
                    handleReorderTrade(draggingTradeId, index);
                    setDraggingTradeId(null);
                  }}
                  onDragStart={() => setDraggingTradeId(t.id)}
                  onDragEnd={() => setDraggingTradeId(null)}
                >
                  <td className="drag-cell">
                    <span className="drag-handle" title="잡고 위/아래로 끌어서 순서 변경">☰</span>
                  </td>
                  <td 
                    onDoubleClick={() => startInlineEdit(t, "date")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정"
                  >
                    {inlineEdit?.id === t.id && inlineEditField === "date" ? (
                      <input
                        type="date"
                        value={inlineEdit.date}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, date: e.target.value })}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus
                        style={{ padding: "2px 4px", fontSize: 13 }}
                      />
                    ) : (
                      formatShortDate(t.date)
                    )}
                  </td>
                  <td 
                    onDoubleClick={() => startInlineEdit(t, "accountId")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정"
                  >
                    {inlineEdit?.id === t.id && inlineEditField === "accountId" ? (
                      <select
                        value={inlineEdit.accountId}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, accountId: e.target.value })}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus
                        style={{ padding: "2px 4px", fontSize: 13 }}
                      >
                        <option value="">선택</option>
                        {accounts
                          .filter((a) => a.type === "securities")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.id} - {a.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      t.accountId
                    )}
                  </td>
                  <td 
                    onClick={() => onStartEditTrade(t)}
                    style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                    title="클릭하여 편집하기"
                  >
                    {t.ticker}
                  </td>
                  <td 
                    className="name-cell" 
                    onClick={() => onStartEditTrade(t)}
                    style={{ 
                      cursor: "pointer", 
                      textDecoration: "underline", 
                      color: "var(--primary)",
                      fontSize: "12px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                    title={t.name}
                  >
                    {t.name}
                  </td>
                  <td>{sideLabel[t.side]}</td>
                  <td 
                    className="number"
                    onDoubleClick={() => startInlineEdit(t, "quantity")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정"
                  >
                    {inlineEdit?.id === t.id ? (
                      <input
                        type="number"
                        value={inlineEdit.quantity}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, quantity: e.target.value })}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus={inlineEditField === "quantity"}
                        style={{ width: "80px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                      />
                    ) : (
                      t.quantity % 1 === 0 ? formatNumber(t.quantity) : t.quantity.toFixed(6)
                    )}
                  </td>
                  <td 
                    className={`number ${t.price >= 0 ? "positive" : "negative"}`}
                    onDoubleClick={() => startInlineEdit(t, "price")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정"
                  >
                    {inlineEdit?.id === t.id ? (
                      <input
                        type="number"
                        value={inlineEdit.price}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, price: e.target.value })}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus={inlineEditField === "price"}
                        style={{ width: "100px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                      />
                    ) : (
                      (() => {
                        const priceInfo = prices.find((p) => p.ticker === t.ticker);
                        const currency = priceInfo?.currency;
                        return formatPriceWithCurrency(t.price, currency, t.ticker);
                      })()
                    )}
                  </td>
                  <td 
                    className={`number ${t.fee >= 0 ? "positive" : "negative"}`}
                    onDoubleClick={() => startInlineEdit(t, "fee")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정"
                  >
                    {inlineEdit?.id === t.id ? (
                      <input
                        type="number"
                        value={inlineEdit.fee}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, fee: e.target.value })}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus={inlineEditField === "fee"}
                        style={{ width: "100px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                      />
                    ) : (
                      (() => {
                        const priceInfo = prices.find((p) => p.ticker === t.ticker);
                        const currency = priceInfo?.currency;
                        return formatPriceWithCurrency(t.fee, currency, t.ticker);
                      })()
                    )}
                  </td>
                  <td 
                    className={`number ${t.totalAmount >= 0 ? "positive" : "negative"}`}
                    onDoubleClick={() => startInlineEdit(t, "totalAmount")}
                    style={{ cursor: "pointer" }}
                    title="더블클릭하여 수정 (수량 자동 조정)"
                  >
                    {inlineEdit?.id === t.id && inlineEditField === "totalAmount" ? (
                      <input
                        type="number"
                        value={Math.round(Number(inlineEdit.quantity) * Number(inlineEdit.price) + Number(inlineEdit.fee || 0))}
                        onChange={(e) => {
                          const newTotal = Number(e.target.value);
                          const fee = Number(inlineEdit.fee || 0);
                          const price = Number(inlineEdit.price);
                          if (price > 0) {
                            const newQuantity = (newTotal - fee) / price;
                            setInlineEdit({ ...inlineEdit, quantity: String(Math.max(0, Math.round(newQuantity * 100) / 100)) });
                          }
                        }}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit();
                          if (e.key === "Escape") cancelInlineEdit();
                        }}
                        autoFocus
                        style={{ width: "120px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                      />
                    ) : (
                      (() => {
                        const priceInfo = prices.find((p) => p.ticker === t.ticker);
                        const currency = priceInfo?.currency;
                        return formatPriceWithCurrency(t.totalAmount, currency, t.ticker);
                      })()
                    )}
                  </td>
                  <td
                    className="number"
                    title={t.side === "sell" ? "매도 건당 실현손익 (FIFO)" : "매수 건은 해당 없음"}
                  >
                    {t.side === "sell" ? (() => {
                      const pnl = realizedPnlByTradeId.get(t.id);
                      if (pnl === undefined) return "-";
                      const priceInfo = prices.find((p) => p.ticker === t.ticker);
                      const currency = priceInfo?.currency;
                      const fmt = formatPriceWithCurrency(pnl, currency, t.ticker);
                      return (
                        <span className={pnl >= 0 ? "positive" : "negative"}>
                          {pnl >= 0 ? "+" : ""}{fmt}
                        </span>
                      );
                    })() : "-"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {t.side === "buy" && (
                      <input
                        type="checkbox"
                        checked={t.cashImpact === 0}
                        onChange={() => toggleInitialHolding(t)}
                        title="체크 시 현금 차감 안 함 (초기 보유)"
                      />
                    )}
                  </td>
                  <td style={{ padding: "4px" }}>
                    <button 
                      type="button" 
                      className="danger" 
                      onClick={() => handleDeleteTrade(t.id)}
                      style={{ padding: "4px 8px", fontSize: 12 }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedTrades.length > 0 && tradeTotalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "12px", background: "var(--surface)", borderRadius: "8px" }}>
            <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
              총 {sortedTrades.length}건 중 {((tradeCurrentPage - 1) * tradePageSize) + 1}-{Math.min(tradeCurrentPage * tradePageSize, sortedTrades.length)}건 표시
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setTradeCurrentPage(1)}
                disabled={tradeCurrentPage === 1}
              >
                처음
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setTradeCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={tradeCurrentPage === 1}
              >
                이전
              </button>
              <span style={{ padding: "0 12px", fontSize: "14px" }}>
                {tradeCurrentPage} / {tradeTotalPages}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setTradeCurrentPage(prev => Math.min(tradeTotalPages, prev + 1))}
                disabled={tradeCurrentPage === tradeTotalPages}
              >
                다음
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setTradeCurrentPage(tradeTotalPages)}
                disabled={tradeCurrentPage === tradeTotalPages}
              >
                마지막
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
