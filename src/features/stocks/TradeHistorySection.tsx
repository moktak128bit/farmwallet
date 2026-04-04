import React, { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import type { Account, AccountBalanceRow, StockPrice, StockTrade, TradeSide } from "../../types";
import { computeRealizedPnlByTradeId, computeRealizedPnlDetailByTradeId } from "../../calculations";
import { isUSDStock, canonicalTickerForMatch } from "../../utils/finance";
import { computeTradeCashImpact } from "../../utils/tradeCashImpact";
import { validateAccountTickerCurrency } from "../../utils/validation";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { formatNumber, formatKRW, formatUSD, formatShortDate } from "../../utils/formatter";

const sideLabel: Record<TradeSide, string> = {
  buy: "매수",
  sell: "매도"
};

const TRADE_ROW_HEIGHT = 52;
const TRADE_OVERSCAN = 10;
const TRADE_VIRTUALIZE_THRESHOLD = 200;

type TradeSortKey = "date" | "accountId" | "ticker" | "name" | "side" | "quantity" | "price" | "fee" | "totalAmount";

interface TradeHistorySectionProps {
  trades: StockTrade[];
  accounts: Account[];
  balances?: AccountBalanceRow[];
  prices: StockPrice[];
  fxRate: number | null;
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onStartEditTrade: (trade: StockTrade) => void;
  onResetTradeForm?: () => void;
  onChangeAccounts?: (next: Account[]) => void;
  highlightTradeId?: string | null;
  onClearHighlightTrade?: () => void;
}

const inferTradeCurrency = (trade: StockTrade, priceCurrency?: string): "USD" | "KRW" =>
  trade.fxRateAtTrade && trade.fxRateAtTrade > 0
    ? "USD"
    : priceCurrency === "USD" || isUSDStock(trade.ticker)
      ? "USD"
      : "KRW";

const formatPriceWithCurrency = (value: number, currency?: string, ticker?: string) => {
  const isUSD = currency === "USD" || isUSDStock(ticker);
  if (isUSD) {
    return formatUSD(value);
  }
  return formatKRW(value);
};

const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
  if (activeKey !== key) return "";
  return direction === "asc" ? "^" : "v";
};

export const TradeHistorySection: React.FC<TradeHistorySectionProps> = ({
  trades,
  accounts,
  balances = [],
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
  const tradeViewportRef = useRef<HTMLDivElement | null>(null);
  const [tradeScrollTop, setTradeScrollTop] = useState(0);
  const [tradeViewportHeight, setTradeViewportHeight] = useState(560);

  // Column width ratios (sum to 100): index, date, account, ticker, name, side, quantity, price, fee, total, realized PnL, actions.
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("trades-column-widths");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const arr = parsed.length === 13 ? [...parsed.slice(0, 11), parsed[12]] : parsed;
            if (arr.length === 12) {
              const total = arr.reduce((s: number, w: number) => s + w, 0);
              if (total > 0) return arr.map((w: number) => (w / total) * 100);
            }
          }
        }
      } catch (e) {
        console.warn("[TradeHistorySection] Failed to load saved column widths", e);
      }
    }
    return [3, 7, 6, 6, 14, 5, 6, 9, 8, 11, 11, 6];
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
  /** 계좌별 보기: null = 전체, 값 있으면 해당 계좌만 */
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);

  const tradesFiltered = useMemo(() => {
    if (!filterAccountId) return trades;
    return trades.filter((t) => t.accountId === filterAccountId);
  }, [trades, filterAccountId]);

  const accountIdsWithTrades = useMemo(() => {
    const ids = new Set(trades.map((t) => t.accountId));
    return accounts.filter((a) => ids.has(a.id));
  }, [trades, accounts]);

  // canonical 티커별 최신 시세 (updatedAt 기준)
  const latestPriceByCanonicalTicker = useMemo(() => {
    const map = new Map<string, StockPrice>();
    for (const price of prices) {
      const key = canonicalTickerForMatch(price.ticker);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, price);
        continue;
      }
      const prevUpdated = prev.updatedAt ?? "";
      const nextUpdated = price.updatedAt ?? "";
      if (nextUpdated >= prevUpdated) {
        map.set(key, price);
      }
    }
    return map;
  }, [prices]);

  const realizedPnlByTradeId = useMemo(() => computeRealizedPnlByTradeId(trades), [trades]);
  const realizedPnlDetailByTradeId = useMemo(() => computeRealizedPnlDetailByTradeId(trades), [trades]);

  const balanceAfterByTradeId = useMemo(() => {
    const result = new Map<string, { amount: number; balance: number }>();
    const balanceById = new Map<string, number>();
    for (const row of balances) {
      balanceById.set(row.account.id, row.currentBalance);
    }
    const sorted = [...trades].sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id)
    );
    const futureImpact = new Map<string, number>();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const t = sorted[i];
      const bal = (balanceById.get(t.accountId) ?? 0) - (futureImpact.get(t.accountId) ?? 0);
      result.set(t.id, { amount: t.cashImpact, balance: bal });
      futureImpact.set(t.accountId, (futureImpact.get(t.accountId) ?? 0) + t.cashImpact);
    }
    return result;
  }, [trades, balances]);

  const sortedTrades = useMemo(() => {
    const dir = tradeSort.direction === "asc" ? 1 : -1;
    return [...tradesFiltered].sort((a, b) => {
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
  }, [tradesFiltered, tradeSort]);

  const tradeIndexById = useMemo(() => {
    const map = new Map<string, number>();
    sortedTrades.forEach((trade, index) => {
      map.set(trade.id, index);
    });
    return map;
  }, [sortedTrades]);

  const isTradeVirtualized = sortedTrades.length >= TRADE_VIRTUALIZE_THRESHOLD;
  const tradeWindow = useMemo(() => {
    if (!isTradeVirtualized) {
      return { start: 0, end: sortedTrades.length };
    }
    const start = Math.max(0, Math.floor(tradeScrollTop / TRADE_ROW_HEIGHT) - TRADE_OVERSCAN);
    const end = Math.min(
      sortedTrades.length,
      Math.ceil((tradeScrollTop + tradeViewportHeight) / TRADE_ROW_HEIGHT) + TRADE_OVERSCAN
    );
    return { start, end };
  }, [isTradeVirtualized, sortedTrades.length, tradeScrollTop, tradeViewportHeight]);

  const visibleTrades = useMemo(
    () => sortedTrades.slice(tradeWindow.start, tradeWindow.end),
    [sortedTrades, tradeWindow]
  );

  const topSpacerHeight = isTradeVirtualized ? tradeWindow.start * TRADE_ROW_HEIGHT : 0;
  const bottomSpacerHeight = isTradeVirtualized
    ? Math.max(0, (sortedTrades.length - tradeWindow.end) * TRADE_ROW_HEIGHT)
    : 0;

  // Keep viewport size synced and scroll highlighted rows into view.
  useEffect(() => {
    const viewport = tradeViewportRef.current;
    if (!viewport) return;
    setTradeViewportHeight(viewport.clientHeight || 560);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setTradeViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const highlightClearTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!highlightTradeId || !onClearHighlightTrade) return;

    const highlightIndex = tradeIndexById.get(highlightTradeId);
    if (highlightIndex != null && isTradeVirtualized) {
      const viewport = tradeViewportRef.current;
      if (viewport) {
        const targetTop = Math.max(
          0,
          highlightIndex * TRADE_ROW_HEIGHT - viewport.clientHeight / 2 + TRADE_ROW_HEIGHT / 2
        );
        viewport.scrollTo({ top: targetTop, behavior: "smooth" });
      }
    }

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
  }, [highlightTradeId, onClearHighlightTrade, tradeIndexById, isTradeVirtualized]);

  // Persist column width preferences.
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("trades-column-widths", JSON.stringify(columnWidths));
    }
  }, [columnWidths]);

  // Start column resizing.
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
    const priceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(inlineEdit.ticker));
    const currencyValidation = validateAccountTickerCurrency(selectedAccount, inlineEdit.ticker, priceInfo ?? undefined);
    if (!currencyValidation.valid) {
      toast.error(currencyValidation.error ?? "계좌 통화와 종목 통화가 일치하지 않습니다.");
      return;
    }
    const isUSDCurrency = priceInfo?.currency === "USD" || isUSDStock(inlineEdit.ticker);
    const exchangeRate = isUSDCurrency && fxRate ? fxRate : 1;
    const totalAmount = side === "buy" 
      ? quantity * price + fee 
      : quantity * price - fee;
    const totalAmountKRW = totalAmount * exchangeRate;
    const existingTrade = trades.find((t) => t.id === inlineEdit.id);
    const useUsdBalanceMode =
      (selectedAccount.type === "securities" || selectedAccount.type === "crypto") &&
      isUSDCurrency &&
      Math.abs(existingTrade?.cashImpact ?? 0) < 0.000001;
    const cashImpact = computeTradeCashImpact(side, totalAmountKRW, useUsdBalanceMode);
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
            cashImpact,
            fxRateAtTrade: isUSDCurrency && exchangeRate > 0 ? exchangeRate : t.fxRateAtTrade
          }
        : t
    );
    onChangeTrades(updated);

    if (useUsdBalanceMode && onChangeAccounts && existingTrade) {
      const prevUsdImpact =
        existingTrade.side === "buy" ? -existingTrade.totalAmount : existingTrade.totalAmount;
      const nextUsdImpact = side === "buy" ? -totalAmount : totalAmount;
      const delta = nextUsdImpact - prevUsdImpact;
      if (delta !== 0) {
        const updatedAccounts = accounts.map((a) =>
          a.id === inlineEdit.accountId
            ? { ...a, usdBalance: (a.usdBalance ?? 0) + delta }
            : a
        );
        setTimeout(() => {
          onChangeAccounts(updatedAccounts);
        }, 0);
      }
    }

    setInlineEdit(null);
    setInlineEditField(null);
  };

  const handleDeleteTrade = (id: string) => {
    const tradeToDelete = trades.find((t) => t.id === id);
    if (!tradeToDelete) return;
    
    let updatedAccounts = accounts;
    const account = accounts.find((a) => a.id === tradeToDelete.accountId);
    if ((account?.type === "securities" || account?.type === "crypto") && onChangeAccounts) {
      const priceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(tradeToDelete.ticker));
      const isUSD = priceInfo?.currency === "USD" || isUSDStock(tradeToDelete.ticker);
      
      const usesUsdBalanceMode = Math.abs(tradeToDelete.cashImpact ?? 0) < 0.000001;
      if (isUSD && usesUsdBalanceMode) {
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
    
    if ((account?.type === "securities" || account?.type === "crypto") && onChangeAccounts && updatedAccounts !== accounts) {
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
    const currentIndex = tradeIndexById.get(id);
    if (currentIndex == null) return;
    const clamped = Math.max(0, Math.min(sortedTrades.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const dir = tradeSort.direction === "asc" ? 1 : -1;
    const comparator = (a: StockTrade, b: StockTrade) => {
      const key = tradeSort.key;
      const va = (a as any)[key];
      const vb = (b as any)[key];
      if (key === "date") return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    };
    const fullSorted = [...trades].sort(comparator);
    const currentInFull = fullSorted.findIndex((t) => t.id === id);
    if (currentInFull === -1) return;
    const [item] = fullSorted.splice(currentInFull, 1);
    const filteredIndices = fullSorted
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !filterAccountId || t.accountId === filterAccountId);
    const insertAt = clamped >= filteredIndices.length ? fullSorted.length : filteredIndices[clamped].i;
    fullSorted.splice(insertAt, 0, item);
    onChangeTrades(fullSorted);
  };

  // Aggregate summary by currency (filtered by selected account).
  const krwTrades = tradesFiltered.filter(t => !isUSDStock(t.ticker));
  const usdTrades = tradesFiltered.filter(t => isUSDStock(t.ticker));
  
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
      <h3>매매 내역</h3>
      {accountIdsWithTrades.length > 1 && (
        <div style={{ marginBottom: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className={filterAccountId === null ? "primary" : "secondary"}
            style={{ fontSize: 12, padding: "4px 12px" }}
            onClick={() => setFilterAccountId(null)}
          >
            전체 <span style={{ opacity: 0.7 }}>({trades.length})</span>
          </button>
          {accountIdsWithTrades.map((acc) => {
            const count = trades.filter((t) => t.accountId === acc.id).length;
            return (
              <button
                key={acc.id}
                type="button"
                className={filterAccountId === acc.id ? "primary" : "secondary"}
                style={{ fontSize: 12, padding: "4px 12px" }}
                onClick={() => setFilterAccountId(filterAccountId === acc.id ? null : acc.id)}
              >
                {acc.name} <span style={{ opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
          {krwBuyAmount + krwSellAmount + krwFee > 0 && (
            <>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매수 (원):</span>
                <span className="negative">{formatKRW(Math.round(krwBuyAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매도 (원):</span>
                <span className="positive">{formatKRW(Math.round(krwSellAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 수수료 (원):</span>
                <span className="negative">{formatKRW(Math.round(krwFee))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>실현 손익 (원):</span>
                <span className={krwRealizedPnl >= 0 ? "positive" : "negative"}>
                  {krwRealizedPnl >= 0 ? "+" : ""}{formatKRW(Math.round(krwRealizedPnl))}
                </span>
              </div>
            </>
          )}
          {usdBuyAmount + usdSellAmount + usdFee > 0 && (
            <>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매수 (달러):</span>
                <span className="negative">{formatUSD(usdBuyAmount)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매도 (달러):</span>
                <span className="positive">{formatUSD(usdSellAmount)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 수수료 (달러):</span>
                <span className="negative">{formatUSD(usdFee)}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>실현 손익 (달러):</span>
                <span className={usdRealizedPnl >= 0 ? "positive" : "negative"}>
                  {usdRealizedPnl >= 0 ? "+" : ""}{formatUSD(usdRealizedPnl)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div
          ref={tradeViewportRef}
          onScroll={(e) => setTradeScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
          style={{
            maxHeight: isTradeVirtualized ? "68vh" : undefined,
            overflowY: isTradeVirtualized ? "auto" : "visible",
            overflowX: "auto"
          }}
        >
        <table className="data-table trades-table" style={{ width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            {columnWidths.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ position: "relative" }}>
                #
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
                  구분 <span className="arrow">{sortIndicator(tradeSort.key, "side", tradeSort.direction)}</span>
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
                  합계 <span className="arrow">{sortIndicator(tradeSort.key, "totalAmount", tradeSort.direction)}</span>
                </button>
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 9)} />
              </th>
              <th style={{ position: "relative" }} title="거래별 실현 손익 (선입선출)">
                실현 손익
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 10)} />
              </th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden>
                <td colSpan={12} style={{ height: `${topSpacerHeight}px`, padding: 0, border: 0 }} />
              </tr>
            )}
            {visibleTrades.map((t, index) => {
              const actualIndex = tradeWindow.start + index;
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
                    handleReorderTrade(draggingTradeId, actualIndex);
                    setDraggingTradeId(null);
                  }}
                  onDragStart={() => setDraggingTradeId(t.id)}
                  onDragEnd={() => setDraggingTradeId(null)}
                >
                  <td className="drag-cell">
                    <span className="drag-handle" title="드래그하여 순서 변경">
                      ::
                    </span>
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
                        <option value="">Select</option>
                        {accounts
                          .filter((a) => a.type === "securities" || a.type === "crypto")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.id} - {a.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <>
                        <div>{t.accountId}</div>
                        {balanceAfterByTradeId.get(t.id) && (
                          <div
                            style={{
                              fontSize: 10,
                              color: balanceAfterByTradeId.get(t.id)!.amount >= 0 ? "var(--danger)" : "var(--primary)",
                              marginTop: 2
                            }}
                          >
                            {balanceAfterByTradeId.get(t.id)!.amount >= 0 ? "+" : ""}
                            {formatKRW(Math.round(balanceAfterByTradeId.get(t.id)!.amount))}
                            {" / "}
                            {formatKRW(Math.round(balanceAfterByTradeId.get(t.id)!.balance))}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td 
                    onClick={() => onStartEditTrade(t)}
                    style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                    title="클릭하여 수정"
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
                    title={
                      (t.name && t.name !== t.ticker
                        ? t.name
                        : latestPriceByCanonicalTicker.get(canonicalTickerForMatch(t.ticker))?.name || t.name || t.ticker) ?? t.ticker
                    }
                  >
                    {t.name && t.name !== t.ticker
                      ? t.name
                      : latestPriceByCanonicalTicker.get(canonicalTickerForMatch(t.ticker))?.name || t.name || t.ticker}
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
                        min={0}
                        step="any"
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
                        const currency = inferTradeCurrency(t, priceInfo?.currency);
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
                        const currency = inferTradeCurrency(t, priceInfo?.currency);
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
                        const currency = inferTradeCurrency(t, priceInfo?.currency);
                        return formatPriceWithCurrency(t.totalAmount, currency, t.ticker);
                      })()
                    )}
                  </td>
                  <td
                    className="number"
                    title={t.side === "sell" ? "매도 거래 실현 손익 (선입선출)" : "매수 거래에는 해당 없음"}
                  >
                    {t.side === "sell" ? (() => {
                      const detail = realizedPnlDetailByTradeId.get(t.id);
                      if (detail === undefined) return "-";
                      const priceInfo = prices.find((p) => p.ticker === t.ticker);
                      const currency = inferTradeCurrency(t, priceInfo?.currency);
                      const fmt = formatPriceWithCurrency(detail.pnl, currency, t.ticker);
                      const avgPrice = detail.quantity > 0 ? detail.costBasis / detail.quantity : 0;
                      const rate = detail.costBasis > 0 ? (detail.pnl / detail.costBasis) * 100 : 0;
                      const avgFmt = formatPriceWithCurrency(avgPrice, currency, t.ticker);
                      return (
                        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                          <span className={detail.pnl >= 0 ? "positive" : "negative"}>
                            {detail.pnl >= 0 ? "+" : ""}{fmt}
                          </span>
                          {detail.costBasis > 0 && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }} title={`평균 매수가 ${avgFmt} 대비`}>
                              평균 {avgFmt} {rate >= 0 ? "+" : ""}{rate.toFixed(2)}%
                            </span>
                          )}
                        </span>
                      );
                    })() : "-"}
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
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden>
                <td colSpan={12} style={{ height: `${bottomSpacerHeight}px`, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {sortedTrades.length > 0 && (
          <div style={{ marginTop: "12px", padding: "12px", background: "var(--surface)", borderRadius: "8px" }}>
            <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
              총 {sortedTrades.length}건, {Math.min(sortedTrades.length, visibleTrades.length)}행 표시 중
              {isTradeVirtualized ? " (가상 스크롤)" : ""}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

