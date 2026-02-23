import React, { useState, useMemo } from "react";
import type { Account, StockPrice } from "../../types";
import type { AccountBalanceRow, PositionRow } from "../../calculations";
import { isUSDStock } from "../../utils/tickerUtils";
import { formatNumber, formatKRW, formatUSD } from "../../utils/format";

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
};

interface PositionListSectionProps {
  positionsByAccount: Array<{
    accountId: string;
    accountName: string;
    rows: PositionWithPrice[];
  }>;
  balances: AccountBalanceRow[];
  accounts: Account[];
  prices: StockPrice[];
  fxRate: number | null;
  accountOrder: string[];
  onAccountReorder: (accountId: string, newPosition: number) => void;
  onPositionClick: (position: PositionWithPrice) => void;
  onQuickSell: (position: PositionWithPrice, e: React.MouseEvent) => void;
  onQuickBuy: (position: PositionWithPrice, e: React.MouseEvent) => void;
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

export const PositionListSection: React.FC<PositionListSectionProps> = ({
  positionsByAccount,
  balances,
  accounts,
  prices,
  fxRate,
  accountOrder,
  onAccountReorder,
  onPositionClick,
  onQuickSell,
  onQuickBuy
}) => {
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: "asc" | "desc" }>({
    key: "marketValue",
    direction: "desc"
  });
  const [draggingAccountId, setDraggingAccountId] = useState<string | null>(null);
  const [isAccountReorderMode, setIsAccountReorderMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("fw-account-reorder-mode");
      return saved === "true";
    } catch {
      return false;
    }
  });

  const sortPositions = (rows: PositionWithPrice[]) => {
    const dir = positionSort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const key = positionSort.key;
      const va = (a as any)[key] ?? 0;
      const vb = (b as any)[key] ?? 0;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return (va - vb) * dir;
    });
  };

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
  }, [positionsByAccount, positionSort]);

  return (
    <>
      <h3>
        보유 종목 현황 (계좌별)
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
      </h3>
      {sortedPositionsByAccount.map((group, groupIndex) => {
        const balance = balances.find((b) => b.account.id === group.accountId);
        const account = accounts.find((a) => a.id === group.accountId);
        const isSecuritiesAccount = account?.type === "securities";
        
        let cashBalance = 0;
        if (isSecuritiesAccount) {
          const usdBalance = (account?.usdBalance ?? 0) + (balance?.usdTransferNet ?? 0);
          const krwBalance = balance?.currentBalance ?? 0;
          cashBalance = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
        } else {
          cashBalance = balance?.currentBalance ?? 0;
        }
        
        const stockValue = group.rows.reduce((sum, p) => sum + p.marketValue, 0);
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
            <h4 style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
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
              {isSecuritiesAccount && (() => {
                const effUsd = (account?.usdBalance ?? 0) + (balance?.usdTransferNet ?? 0);
                return (
                <>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
                    달러: <span className={effUsd >= 0 ? "positive" : "negative"}>
                      {formatUSD(effUsd)}
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
                    원화: <span className={(balance?.currentBalance ?? 0) >= 0 ? "positive" : "negative"}>
                      {formatKRW(Math.round(balance?.currentBalance ?? 0))}
                    </span>
                  </span>
                </>
                );
              })()}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
                현금+예수금: <span className={cashBalance >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(cashBalance))}</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
                주식평가액: {formatKRW(Math.round(stockValue))}
              </span>
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
                총자산: <span className={totalAsset >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(totalAsset))}</span>
              </span>
            </h4>
            <div>
              <table className="data-table positions-table" style={{ width: "100%" }}>
                <colgroup>
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
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
                          {p.ticker}
                        </td>
                        <td 
                          style={{ 
                            fontSize: "12px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "200px"
                          }}
                          title={p.name}
                        >
                          {p.name}
                        </td>
                        <td 
                          className="number"
                          style={{ 
                            color: p.pnl >= 0 ? "#f43f5e" : "#0ea5e9",
                            fontWeight: "600"
                          }}
                        >
                          {formatPriceWithCurrency(p.pnl, p.currency, p.ticker)}
                        </td>
                        <td 
                          className="number"
                          style={{ 
                            color: p.pnl >= 0 ? "#f43f5e" : "#0ea5e9",
                            fontWeight: "600"
                          }}
                        >
                          {(p.pnlRate * 100).toFixed(2)}%
                        </td>
                        <td className="number">
                          {formatPriceWithCurrency(p.displayMarketPrice, p.currency, p.ticker)}
                        </td>
                        <td className="number">{formatPriceWithCurrency(Math.round(p.avgPrice), p.currency, p.ticker)}</td>
                        <td className="number">{p.quantity % 1 === 0 ? formatNumber(p.quantity) : p.quantity.toFixed(6)}</td>
                        <td className="number">{formatPriceWithCurrency(p.totalBuyAmount, p.currency, p.ticker)}</td>
                        <td className={`number ${p.marketValue >= p.totalBuyAmount ? "positive" : "negative"}`}>
                          {formatPriceWithCurrency(p.marketValue, p.currency, p.ticker)}
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
