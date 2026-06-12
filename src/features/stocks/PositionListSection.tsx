import React, { useState, useMemo, useEffect } from "react";
import type { Account, StockPrice, AccountBalanceRow, PositionRow, TickerInfo } from "../../types";
import { isUSDStock, canonicalTickerForMatch, cryptoDisplaySymbol } from "../../utils/finance";
import { formatNumber, formatKRW, formatUSD } from "../../utils/formatter";

type PositionSortKey =
  | "ticker"
  | "name"
  | "quantity"
  | "avgPrice"
  | "marketPrice"
  | "diff"
  | "marketValue"
  | "totalBuyAmount"
  | "pnl"
  | "pnlRate";

type PositionWithPrice = PositionRow & {
  displayMarketPrice: number;
  originalMarketPrice?: number;
  currency?: string;
  diff: number;
  sector?: string;
  industry?: string;
};

const MARKET_OPTIONS = [
  { value: "KOSPI", label: "코스피", market: "KR" as const, exchange: "KOSPI" },
  { value: "KOSDAQ", label: "코스닥", market: "KR" as const, exchange: "KOSDAQ" },
  { value: "US", label: "미장", market: "US" as const, exchange: undefined },
  { value: "CRYPTO", label: "코인", market: "CRYPTO" as const, exchange: undefined }
];

function getMarketValue(db: TickerInfo | undefined): string {
  if (!db) return "";
  if (db.exchange === "KOSPI") return "KOSPI";
  if (db.exchange === "KOSDAQ") return "KOSDAQ";
  if (db.market === "US") return "US";
  if (db.market === "CRYPTO") return "CRYPTO";
  if (db.market === "KR") return db.exchange || "";
  return db.market || "";
}

interface PositionListSectionProps {
  positionsByAccount: Array<{
    accountId: string;
    accountName: string;
    rows: PositionWithPrice[];
  }>;
  balances: AccountBalanceRow[];
  accounts: Account[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  onChangeTickerDatabase: (next: TickerInfo[] | ((prev: TickerInfo[]) => TickerInfo[])) => void;
  fxRate: number | null;
  accountOrder: string[];
  onAccountReorder: (accountId: string, newPosition: number) => void;
  onPositionClick: (position: PositionWithPrice) => void;
  onQuickSell: (position: PositionWithPrice, e: React.MouseEvent) => void;
  onQuickBuy: (position: PositionWithPrice, e: React.MouseEvent) => void;
}

const STORAGE_KEY_PREFIX = "fw-position-display-currency-";

/**
 * 포지션 금액을 표시 통화로 변환. 달러→원화: ×환율, 원화→달러: ÷환율.
 * 환율이 없어 변환할 수 없으면 원본 값·원본 통화를 그대로 반환한다 —
 * 호출부는 반환된 currency로 포맷해 단위 표기가 항상 실제 통화와 일치한다.
 */
const toDisplayValue = (
  value: number,
  positionCurrency: string | undefined,
  ticker: string | undefined,
  displayCurrency: "USD" | "KRW",
  fxRate: number
): { value: number; currency: "USD" | "KRW" } => {
  const posIsUSD = positionCurrency === "USD" || isUSDStock(ticker);
  const posCurrency: "USD" | "KRW" = posIsUSD ? "USD" : "KRW";
  if (posCurrency === displayCurrency) return { value, currency: displayCurrency };
  if (fxRate > 0) {
    return {
      value: displayCurrency === "KRW" ? value * fxRate : value / fxRate,
      currency: displayCurrency
    };
  }
  // 환율 미로드 — 변환 불가: 원본 통화로 표시 (잘못된 단위 표기 방지)
  return { value, currency: posCurrency };
};

const formatByDisplayCurrency = (value: number, displayCurrency: "USD" | "KRW") =>
  displayCurrency === "USD" ? formatUSD(value) : formatKRW(Math.round(value));

const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
  if (activeKey !== key) return "↕";
  return direction === "asc" ? "↑" : "↓";
};

export const PositionListSection: React.FC<PositionListSectionProps> = ({
  positionsByAccount,
  balances,
  accounts,
  prices: _prices,
  tickerDatabase,
  onChangeTickerDatabase,
  fxRate,
  accountOrder,
  onAccountReorder,
  onPositionClick,
  onQuickSell,
  onQuickBuy
}) => {
  const safeTickerDb = Array.isArray(tickerDatabase) ? tickerDatabase : [];
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: "asc" | "desc" }>({
    key: "marketValue",
    direction: "desc"
  });
  const [accountDisplayCurrency, setAccountDisplayCurrency] = useState<Record<string, "USD" | "KRW">>({});
  const accountIdsKey = useMemo(
    () => positionsByAccount.map((g) => g.accountId).join(","),
    [positionsByAccount]
  );
  useEffect(() => {
    try {
      const next: Record<string, "USD" | "KRW"> = {};
      positionsByAccount.forEach((g) => {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + g.accountId);
        if (raw === "USD" || raw === "KRW") next[g.accountId] = raw;
      });
      if (Object.keys(next).length > 0) {
        setAccountDisplayCurrency((prev) => {
          const merged = { ...prev };
          let changed = false;
          for (const [id, cur] of Object.entries(next)) {
            if (merged[id] !== cur) {
              merged[id] = cur;
              changed = true;
            }
          }
          return changed ? merged : prev;
        });
      }
    } catch {
      //
    }
    // positionsByAccount is represented by accountIdsKey for reference stability
  }, [accountIdsKey, positionsByAccount]);
  const getAccountDisplayCurrency = (accountId: string): "USD" | "KRW" =>
    accountDisplayCurrency[accountId] ?? "KRW";
  const setAccountDisplayCurrencyFor = (accountId: string, currency: "USD" | "KRW") => {
    setAccountDisplayCurrency((prev) => {
      const next = { ...prev, [accountId]: currency };
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + accountId, currency);
      } catch {
        //
      }
      return next;
    });
  };
  const [draggingAccountId, setDraggingAccountId] = useState<string | null>(null);
  const [isAccountReorderMode, setIsAccountReorderMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("fw-account-reorder-mode");
      return saved === "true";
    } catch {
      return false;
    }
  });

  const sortPositions = React.useCallback((rows: PositionWithPrice[]) => {
    const dir = positionSort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const key = positionSort.key as keyof PositionWithPrice;
      const va = (a[key] as unknown) ?? 0;
      const vb = (b[key] as unknown) ?? 0;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
  }, [positionSort]);

  const togglePositionSort = (key: PositionSortKey) => {
    setPositionSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const handleAccountReorder = (accountId: string, newPosition: number) => {
    const currentOrder = accountOrder.length > 0 
      ? accountOrder 
      : positionsByAccount.map((g) => g.accountId);
    const currentIndex = currentOrder.indexOf(accountId);
    if (currentIndex === -1) return;
    
    const clamped = Math.max(0, Math.min(currentOrder.length - 1, newPosition));
    if (clamped === currentIndex) return;
    
    onAccountReorder(accountId, clamped);
  };

  const sortedPositionsByAccount = useMemo(() => {
    return positionsByAccount.map((group) => ({
      ...group,
      rows: sortPositions(group.rows)
    }));
  }, [positionsByAccount, sortPositions]);

  const inferFxFromRows = (rows: PositionWithPrice[]): number => {
    for (const row of rows) {
      const isUsd = row.currency === "USD" || isUSDStock(row.ticker);
      if (!isUsd) continue;
      if ((row.totalBuyAmount ?? 0) > 0 && (row.totalBuyAmountKRW ?? 0) > 0) {
        return row.totalBuyAmountKRW! / row.totalBuyAmount;
      }
    }
    return 0;
  };

  return (
    <>
      <h3>
        보유 종목 현황 (계좌별)
        {positionsByAccount.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: "normal", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isAccountReorderMode}
              onChange={(e) => {
                setIsAccountReorderMode(e.target.checked);
                localStorage.setItem("fw-account-reorder-mode", String(e.target.checked));
              }}
              style={{ cursor: "pointer" }}
            />
            <span>계좌순서 바꾸기</span>
          </label>
        )}
      </h3>
      {positionsByAccount.length === 0 && (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          아직 보유 종목이 없습니다 — 위 거래 입력 폼에서 첫 매수를 기록해 보세요.
        </p>
      )}
      {sortedPositionsByAccount.map((group, groupIndex) => {
        const balance = balances.find((b) => b.account.id === group.accountId);
        const account = accounts.find((a) => a.id === group.accountId);
        const isSecuritiesAccount = account?.type === "securities" || account?.type === "crypto";
        
        let cashBalance = 0;
        if (isSecuritiesAccount) {
          const usdBalance = (account?.usdBalance ?? 0) + (balance?.usdTransferNet ?? 0);
          const krwBalance = balance?.currentBalance ?? 0;
          cashBalance = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
        } else {
          cashBalance = balance?.currentBalance ?? 0;
        }
        
        const inferredRate = inferFxFromRows(group.rows);
        const rate = (fxRate && fxRate > 0) ? fxRate : inferredRate;
        const toKRW = (p: typeof group.rows[0], val: number) =>
          (p.currency === "USD" || isUSDStock(p.ticker)) && rate > 0 ? val * rate : val;
        const stockValue = group.rows.reduce((sum, p) => sum + toKRW(p, p.marketValue), 0);
        const stockCost = group.rows.reduce((sum, p) => {
          if (p.quantity <= 0) return sum;
          const isUsd = p.currency === "USD" || isUSDStock(p.ticker);
          const costKrw = isUsd
            ? (p.totalBuyAmountKRW ?? (rate > 0 ? p.totalBuyAmount * rate : 0))
            : p.totalBuyAmount;
          return sum + costKrw;
        }, 0);
        const stockPnl = stockCost > 0 ? stockValue - stockCost : 0;
        const stockPnlRate = stockCost > 0 ? (stockPnl / stockCost) * 100 : null;
        const totalAsset = cashBalance + stockValue;
        
        return (
          <div 
            key={group.accountId}
            draggable={isAccountReorderMode}
            onDragStart={() => {
              if (isAccountReorderMode) {
                setDraggingAccountId(group.accountId);
              }
            }}
            onDragOver={(e) => {
              if (isAccountReorderMode) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              if (isAccountReorderMode) {
                e.preventDefault();
                if (draggingAccountId && draggingAccountId !== group.accountId) {
                  handleAccountReorder(draggingAccountId, groupIndex);
                }
                setDraggingAccountId(null);
              }
            }}
            onDragEnd={() => {
              if (isAccountReorderMode) {
                setDraggingAccountId(null);
              }
            }}
            style={{ 
              marginBottom: 24,
              opacity: draggingAccountId === group.accountId ? 0.5 : 1,
              cursor: isAccountReorderMode ? "move" : "default"
            }}
          >
            <h4 style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap", width: "100%" }}>
              {isAccountReorderMode && (
                <span 
                  className="drag-handle" 
                  title="잡고 위/아래로 끌어서 계좌 순서 변경"
                  style={{ cursor: "grab", fontSize: 18, userSelect: "none" }}
                >
                  ☰
                </span>
              )}
              <span>{group.accountName}</span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 4 }}>금액 표시:</span>
                <button
                  type="button"
                  className={getAccountDisplayCurrency(group.accountId) === "KRW" ? "primary" : "secondary"}
                  onClick={() => setAccountDisplayCurrencyFor(group.accountId, "KRW")}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  원화
                </button>
                <button
                  type="button"
                  className={getAccountDisplayCurrency(group.accountId) === "USD" ? "primary" : "secondary"}
                  onClick={() => setAccountDisplayCurrencyFor(group.accountId, "USD")}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  달러
                </button>
              </span>
              {isSecuritiesAccount && (() => {
                const effUsd = (account?.usdBalance ?? 0) + (balance?.usdTransferNet ?? 0);
                return (
                <>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                    달러: <span className={effUsd >= 0 ? "positive" : "negative"}>
                      {formatUSD(effUsd)}
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                    원화: <span className={(balance?.currentBalance ?? 0) >= 0 ? "positive" : "negative"}>
                      {formatKRW(Math.round(balance?.currentBalance ?? 0))}
                    </span>
                  </span>
                </>
                );
              })()}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                현금+예수금: <span className={cashBalance >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(cashBalance))}</span>
              </span>
              {stockCost > 0 && (
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                  원금: <span>{formatKRW(Math.round(stockCost))}</span>
                </span>
              )}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                평가금: <span className={stockValue >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(stockValue))}</span>
                {rate > 0 && (
                  <span style={{ marginLeft: 4, fontSize: 12 }}>≈ {formatUSD(stockValue / rate)}</span>
                )}
              </span>
              {stockCost > 0 && (
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                  평가손익:{" "}
                  <span className={stockPnl >= 0 ? "positive" : "negative"} style={{ fontWeight: 600 }}>
                    {stockPnl >= 0 ? "+" : ""}{formatKRW(Math.round(stockPnl))}
                  </span>
                  {stockPnlRate != null && (
                    <span className={stockPnlRate >= 0 ? "positive" : "negative"} style={{ marginLeft: 4, fontSize: 12 }}>
                      ({stockPnlRate >= 0 ? "+" : ""}{stockPnlRate.toFixed(1)}%)
                    </span>
                  )}
                </span>
              )}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>
                총자산: <span className={totalAsset >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(totalAsset))}</span>
                {rate > 0 && (
                  <span style={{ marginLeft: 4, fontSize: 12 }}>≈ {formatUSD(totalAsset / rate)}</span>
                )}
              </span>
            </h4>
            <div>
              <table className="data-table positions-table" style={{ width: "100%" }}>
                {/* 컬럼 11개 (티커·종목명·시장·평가손익·수익률·현재가·평균단가·보유수량·총매입·총평가·작업) */}
                <colgroup>
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "170px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "150px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("ticker")}>
                        티커 <span className="arrow">{sortIndicator(positionSort.key, "ticker", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("name")}>
                        종목명 <span className="arrow">{sortIndicator(positionSort.key, "name", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th style={{ minWidth: "90px" }}>시장</th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("pnl")}>
                        평가손익 <span className="arrow">{sortIndicator(positionSort.key, "pnl", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("pnlRate")}>
                        수익률 <span className="arrow">{sortIndicator(positionSort.key, "pnlRate", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("marketPrice")}>
                        현재가 <span className="arrow">{sortIndicator(positionSort.key, "marketPrice", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("avgPrice")}>
                        평균단가 <span className="arrow">{sortIndicator(positionSort.key, "avgPrice", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("quantity")}>
                        보유수량 <span className="arrow">{sortIndicator(positionSort.key, "quantity", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("totalBuyAmount")}>
                        총매입금액 <span className="arrow">{sortIndicator(positionSort.key, "totalBuyAmount", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-header" onClick={() => togglePositionSort("marketValue")}>
                        총평가금액 <span className="arrow">{sortIndicator(positionSort.key, "marketValue", positionSort.direction)}</span>
                      </button>
                    </th>
                    <th style={{ width: "150px", textAlign: "center" }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((p) => {
                    const displayCurrency = getAccountDisplayCurrency(group.accountId);
                    const r = rate; // 환율 없으면 0 → toDisplayValue가 원본 통화 그대로 반환 (단위 표기 일치)
                    const isUSD = p.currency === "USD";
                    // 외국 종목 원화: 매입가 = 매입 당시 달러×당시 환율(totalBuyAmountKRW), 평가액 = 현재가×현재 환율
                    const totalBuyDisplay =
                      displayCurrency === "KRW" && isUSD && p.totalBuyAmountKRW != null
                        ? { value: p.totalBuyAmountKRW, currency: "KRW" as const }
                        : toDisplayValue(p.totalBuyAmount, p.currency, p.ticker, displayCurrency, r);
                    const marketValDisplay = toDisplayValue(p.marketValue, p.currency, p.ticker, displayCurrency, r);
                    const avgDisplay =
                      displayCurrency === "KRW" && isUSD && p.totalBuyAmountKRW != null && p.quantity > 0
                        ? { value: p.totalBuyAmountKRW / p.quantity, currency: "KRW" as const }
                        : toDisplayValue(p.avgPrice, p.currency, p.ticker, displayCurrency, r);
                    const pnlDisplay =
                      displayCurrency === "KRW" && isUSD && p.totalBuyAmountKRW != null && marketValDisplay.currency === "KRW"
                        ? { value: marketValDisplay.value - totalBuyDisplay.value, currency: "KRW" as const }
                        : toDisplayValue(p.pnl, p.currency, p.ticker, displayCurrency, r);
                    const priceDisplay = toDisplayValue(p.displayMarketPrice, p.currency, p.ticker, displayCurrency, r);
                    return (
                      <tr 
                        key={`${group.accountId}-${p.ticker}`}
                        onClick={() => onPositionClick(p)}
                        style={{ cursor: "pointer" }}
                        title="클릭하여 상세 정보 보기"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "";
                        }}
                      >
                        <td className="ticker-cell" style={{ color: "var(--primary)", fontWeight: 500 }}>
                          {cryptoDisplaySymbol(p.ticker)}
                        </td>
                        <td 
                          style={{ 
                            fontSize: "12px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "170px"
                          }}
                          title={p.name}
                        >
                          {p.name}
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ padding: "4px 6px" }}>
                          <select
                            value={getMarketValue(safeTickerDb.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(p.ticker)))}
                            onChange={(e) => {
                              const opt = MARKET_OPTIONS.find((o) => o.value === e.target.value);
                              if (!opt) return;
                              const tickerClean = canonicalTickerForMatch(p.ticker);
                              const name = p.name || p.ticker;
                              onChangeTickerDatabase((prev) => {
                                const list = Array.isArray(prev) ? prev : [];
                                const next = list.filter((t) => canonicalTickerForMatch(t.ticker) !== tickerClean);
                                next.push({ ticker: tickerClean, name, market: opt.market, exchange: opt.exchange });
                                return next.sort((a, b) => a.ticker.localeCompare(b.ticker));
                              });
                            }}
                            style={{ fontSize: 12, padding: "4px 6px", width: "100%", maxWidth: 100 }}
                            title="시장 선택"
                          >
                            <option value="">선택</option>
                            {MARKET_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td
                          className="number"
                          style={{
                            color: p.pnl >= 0 ? "var(--danger)" : "var(--accent)",
                            fontWeight: "600"
                          }}
                        >
                          {formatByDisplayCurrency(pnlDisplay.value, pnlDisplay.currency)}
                        </td>
                        <td
                          className="number"
                          style={{
                            color: p.pnl >= 0 ? "var(--danger)" : "var(--accent)",
                            fontWeight: "600"
                          }}
                        >
                          {(p.pnlRate * 100).toFixed(2)}%
                        </td>
                        <td className="number">
                          {formatByDisplayCurrency(priceDisplay.value, priceDisplay.currency)}
                        </td>
                        <td className="number">{formatByDisplayCurrency(avgDisplay.value, avgDisplay.currency)}</td>
                        <td className="number">{p.quantity % 1 === 0 ? formatNumber(p.quantity) : p.quantity.toFixed(6)}</td>
                        <td className="number">{formatByDisplayCurrency(totalBuyDisplay.value, totalBuyDisplay.currency)}</td>
                        <td className={`number ${p.marketValue >= p.totalBuyAmount ? "positive" : "negative"}`}>
                          {formatByDisplayCurrency(marketValDisplay.value, marketValDisplay.currency)}
                        </td>
                        <td style={{ textAlign: "center", padding: "4px" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                            <button
                              type="button"
                              className="primary"
                              onClick={(e) => onQuickSell(p, e)}
                              style={{ padding: "4px 8px", fontSize: 11, whiteSpace: "nowrap" }}
                              title="매도 폼에 자동 입력"
                            >
                              매도
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={(e) => onQuickBuy(p, e)}
                              style={{ padding: "4px 8px", fontSize: 11, whiteSpace: "nowrap" }}
                              title="매수 폼에 자동 입력"
                            >
                              매수
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
};
