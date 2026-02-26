import React, { useMemo, useState, useEffect } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow, PositionRow } from "../types";
import { formatNumber, formatShortDate, formatKRW, formatUSD } from "../utils/formatter";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { EmptyState } from "./EmptyState";
import { Wallet } from "lucide-react";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  ledger: LedgerEntry[];
  onChangeAccounts: (next: Account[]) => void;
  onRenameAccountId: (oldId: string, newId: string) => void;
}

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "입출금",
  savings: "저축",
  card: "신용카드",
  securities: "증권",
  other: "기타"
};

function normalizeDebtValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function sanitizeSignedNumericInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9+\-.,]/g, "");
  if (!cleaned) return "";
  const first = cleaned[0];
  const sign = first === "+" || first === "-" ? first : "";
  const body = (sign ? cleaned.slice(1) : cleaned).replace(/[+\-]/g, "");
  return `${sign}${body}`;
}

function parseSignedAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, "");
  if (!normalized) return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export const AccountsView: React.FC<Props> = ({
  accounts,
  balances,
  positions,
  ledger,
  onChangeAccounts,
  onRenameAccountId
}) => {
  const safeAccounts = accounts ?? [];
  const safeBalances = balances ?? [];
  const safePositions = positions ?? [];
  const [showForm, setShowForm] = useState(false);
  const [editingNumber, setEditingNumber] = useState<{
    id: string;
    field: "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance";
  } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [adjustingAccount, setAdjustingAccount] = useState<{
    id: string;
    type: AccountType;
  } | null>(null);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustValueUSD, setAdjustValueUSD] = useState("");
  const [isAdjustingUSD, setIsAdjustingUSD] = useState(false);
  const [isSetDirectly, setIsSetDirectly] = useState(false);
  const [editUsdBalance, setEditUsdBalance] = useState("");
  const [editKrwBalance, setEditKrwBalance] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  /** Opening-balance reverse calc: user-entered actual current balances by account */
  const [actualCurrentInput, setActualCurrentInput] = useState<Record<string, string>>({});

  // Fetch FX rate
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        if (res[0]?.price) {
          setFxRate(res[0].price);
        }
      } catch (err) {
        console.warn("환율 조회 실패", err);
      }
    };
    fetchRate();
    // Refresh FX rate every hour
    const interval = setInterval(fetchRate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleAddAccount = (account: Account) => {
    onChangeAccounts([...safeAccounts, account]);
    setShowForm(false);
  };

  const handleDeleteAccount = (id: string) => {
    onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
  };

  const handleAdjustBalance = () => {
    if (!adjustingAccount) return;
    
    if (adjustingAccount.type === "securities") {
      const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
      const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
      if (!account || !balanceRow) return;
      
      const inputUsd = Number(editUsdBalance.replace(/[^\d.-]/g, "")) || 0;
      const inputKrw = Number(editKrwBalance.replace(/[^\d.-]/g, "")) || 0;
      
      let targetUsd: number;
      let targetKrw: number;
      const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
      const currentKrw = balanceRow.currentBalance ?? 0;
      
      if (isSetDirectly) {
        targetUsd = inputUsd;
        targetKrw = inputKrw;
      } else {
        // 원화/달러
        if (inputUsd === 0 && inputKrw === 0) {
          alert("USD 또는 KRW 중 하나 이상 0이 아닌 값을 입력해주세요.");
          return;
        }
        targetUsd = dispUsd + inputUsd;
        targetKrw = currentKrw + inputKrw;
      }
      
      const usdTransferNet = balanceRow.usdTransferNet ?? 0;
      const newUsdBalance = targetUsd - usdTransferNet;
      const currentCashAdj = account.cashAdjustment ?? 0;
      const baseWithoutAdj = balanceRow.currentBalance - currentCashAdj;
      const newCashAdjustment = targetKrw - baseWithoutAdj;
      
      onChangeAccounts(
        safeAccounts.map((a) => {
          if (a.id !== adjustingAccount.id) return a;
          return { ...a, usdBalance: newUsdBalance, cashAdjustment: newCashAdjustment };
        })
      );
      setAdjustingAccount(null);
      setEditUsdBalance("");
      setEditKrwBalance("");
      setIsSetDirectly(false);
      return;
    }
    
    const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
    const currentBalance = balanceRow?.currentBalance ?? 0;

    let value = 0;
    if (isAdjustingUSD && adjustValueUSD) {
      const usdValue = Number(adjustValueUSD.replace(/,/g, "")) || 0;
      if (usdValue === 0) {
        alert("0이 아닌 값을 입력해주세요.");
        return;
      }
      if (!fxRate) {
        alert("환율 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      value = usdValue * fxRate;
    } else if (adjustValue.trim() !== "") {
      const parsed = parseSignedAmount(adjustValue);
      if (parsed == null) {
        alert("금액 형식이 올바르지 않습니다. 예: +100000, -50000");
        return;
      }
      value = parsed;
      if (value === 0 && !isSetDirectly) {
        alert("0이 아닌 값을 입력해주세요.");
        return;
      }
    } else {
      alert("금액을 입력해주세요.");
      return;
    }

    const updated = safeAccounts.map((a) => {
      if (a.id !== adjustingAccount.id) return a;

      if (adjustingAccount.type === "card") {
        const openingDebt = normalizeDebtValue(a.debt ?? 0);
        const currentTotalDebt = cardDebtMap.get(a.id)?.total ?? openingDebt;

        if (isSetDirectly) {
          const targetDebt = normalizeDebtValue(value);
          const debtFromLedger = currentTotalDebt - openingDebt;
          return { ...a, debt: targetDebt - debtFromLedger };
        }
        return { ...a, debt: openingDebt - value };
      } else {
        if (isSetDirectly) {
          const delta = value - currentBalance;
          return { ...a, initialBalance: (a.initialBalance ?? 0) + delta };
        }
        return { ...a, initialBalance: (a.initialBalance ?? 0) + value };
      }
    });

    onChangeAccounts(updated);
    setAdjustValue("");
    setAdjustValueUSD("");
    setIsAdjustingUSD(false);
    setIsSetDirectly(false);
  };

  const startEditNumber = (
    accountId: string,
    field: "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance",
    currentValue: number
  ) => {
    setEditingNumber({ id: accountId, field });
    setEditValue(String(currentValue));
  };

  const saveNumber = () => {
    if (!editingNumber) return;
    const value = Number(editValue.replace(/,/g, "")) || 0;
    const updated = accounts.map((a) => {
      if (a.id === editingNumber.id) {
        if (editingNumber.field === "cashAdjustment") {
          return { ...a, cashAdjustment: value };
        }
        if (editingNumber.field === "initialCashBalance") {
          return { ...a, initialCashBalance: value };
        }
        if (editingNumber.field === "debt") {
          return { ...a, debt: value };
        }
        if (editingNumber.field === "savings") {
          return { ...a, savings: value };
        }
        return { ...a, [editingNumber.field]: value };
      }
      return a;
    });
    onChangeAccounts(updated);
    setEditingNumber(null);
    setEditValue("");
  };

  const cancelEditNumber = () => {
    setEditingNumber(null);
    setEditValue("");
  };

  const handleReorderAccount = (id: string, newIndex: number) => {
    const currentIndex = accounts.findIndex((a) => a.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(accounts.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const next = [...accounts];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeAccounts(next);
  };

  const startEditCell = (id: string, field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance", current: string | number) => {
    setEditingCell({ id, field });
    setEditingCellValue(String(current));
  };

  const saveCell = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const raw = editingCellValue.trim();
    if (field === "id") {
      if (!raw) {
        alert("계좌 ID를 입력해 주세요.");
        return;
      }
      const nextId = raw.toUpperCase().replace(/\s/g, "_");
      if (nextId === id) {
        setEditingCell(null);
        setEditingCellValue("");
        return;
      }
      const exists = safeAccounts.some((a) => a.id === nextId && a.id !== id);
      if (exists) {
        alert("이미 사용 중인 계좌 ID입니다. 다른 ID를 입력해주세요.");
        return;
      }
      onRenameAccountId(id, nextId);
    } else if (field === "currency") {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? { ...a, currency: (raw === "KRW" || raw === "USD") ? (raw as "KRW" | "USD") : undefined }
          : a
      );
      onChangeAccounts(updated);
    } else {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? {
              ...a,
              [field]: field === "type" 
                ? (editingCellValue as AccountType)
                : field === "usdBalance" || field === "krwBalance"
                ? Number(raw.replace(/[^\d.-]/g, "")) || 0
                : editingCellValue
            }
          : a
      );
      onChangeAccounts(updated);
    }
    setEditingCell(null);
    setEditingCellValue("");
  };

  const cancelCell = () => {
    setEditingCell(null);
    setEditingCellValue("");
  };

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    safePositions.forEach((p) => {
      // Include only positive holdings with positive market value.
      if (p.quantity > 0 && p.marketValue > 0) {
        map.set(p.accountId, (map.get(p.accountId) ?? 0) + p.marketValue);
      }
    });
    return map;
  }, [safePositions]);

  /** 역산 초기잔액: rev = desired - computed + baseBalance */
  const reversedInitialBalance = (accountId: string): number | null => {
    const inputStr = actualCurrentInput[accountId];
    if (inputStr == null || inputStr.trim() === "") return null;
    const desired = Number(String(inputStr).replace(/[^\d.-]/g, "")) || 0;
    const row = safeBalances.find((b) => b.account.id === accountId);
    const account = safeAccounts.find((a) => a.id === accountId);
    if (!row || !account) return null;
    const baseBalance =
      account.type === "securities"
        ? (account.initialCashBalance ?? account.initialBalance ?? 0)
        : (account.initialBalance ?? 0);
    const computedCurrent = row.currentBalance ?? 0;
    return desired - computedCurrent + baseBalance;
  };

  const applyReversedInitial = () => {
    const updates: Account[] = safeAccounts.map((acc) => {
      const rev = reversedInitialBalance(acc.id);
      if (rev == null || acc.type === "card") return acc;
      if (acc.type === "securities") {
        return { ...acc, initialCashBalance: rev, initialBalance: acc.initialBalance ?? 0 };
      }
      return { ...acc, initialBalance: rev };
    });
    onChangeAccounts(updates);
  };


  const cardDebtMap = useMemo(() => {
    const map = new Map<string, { total: number; monthly: number }>();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const totalUsage = new Map<string, number>();
    const totalPayment = new Map<string, number>();
    const monthlyUsage = new Map<string, number>();
    const monthlyPayment = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

    for (const l of ledger) {
      if (l.kind === "expense" && l.fromAccountId) {
        add(totalUsage, l.fromAccountId, l.amount);
        if (l.date?.slice(0, 7) === currentMonth) add(monthlyUsage, l.fromAccountId, l.amount);
      } else if (l.toAccountId) {
        const isPayment =
          (l.kind === "transfer" && l.category === "이체" && l.subCategory === "카드결제이체") ||
          (l.kind === "expense" && l.category === "신용결제");
        if (isPayment) {
          const amt = l.kind === "expense" && l.category === "신용결제" ? l.amount - (l.discountAmount ?? 0) : l.amount;
          add(totalPayment, l.toAccountId, amt);
          if (l.date?.slice(0, 7) === currentMonth) add(monthlyPayment, l.toAccountId, amt);
        }
      }
    }

    safeBalances.forEach((row) => {
      if (row.account.type === "card") {
        const cardId = row.account.id;
        const usage = totalUsage.get(cardId) ?? 0;
        const payment = totalPayment.get(cardId) ?? 0;
        const mUsage = monthlyUsage.get(cardId) ?? 0;
        const mPayment = monthlyPayment.get(cardId) ?? 0;
        const openingDebt = normalizeDebtValue(row.account.debt ?? 0);
        map.set(cardId, {
          total: openingDebt - usage + payment,
          monthly: -mUsage + mPayment
        });
      }
    });

    return map;
  }, [safeBalances, ledger]);

  // 계좌 종류별로 묶어서 표시
  const accountsByType = useMemo(() => {
    const grouped = new Map<AccountType, typeof safeBalances>();
    const typeOrder: AccountType[] = ["checking", "savings", "card", "securities", "other"];

    typeOrder.forEach((type) => {
      grouped.set(type, []);
    });

    safeBalances.forEach((row) => {
      const type = row.account.type;
      const list = grouped.get(type) ?? [];
      list.push(row);
      grouped.set(type, list);
    });

    return grouped;
  }, [safeBalances]);


  // 카드 제외 역산용 순서 (증권·입출금만 역산)
  const orderedRowsForInitialReverse = useMemo(() => {
    const typeOrder: AccountType[] = ["checking", "savings", "card", "securities", "other"];
    return typeOrder
      .flatMap((type) => accountsByType.get(type) ?? [])
      .filter((row) => row.account.type !== "card");
  }, [accountsByType]);

  const fillActualCurrentFromComputed = () => {
    const next: Record<string, string> = {};
    orderedRowsForInitialReverse.forEach((row) => {
      next[row.account.id] = String(Math.round(row.currentBalance ?? 0));
    });
    setActualCurrentInput(next);
  };

  const totalSummary = useMemo(() => {
    // 증권 계좌만
    const securitiesAccounts = safeBalances.filter((row) => row.account.type === "securities");
    
    // USD 잔액 합계 (usdBalance + usdTransferNet)
    const totalUsdBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
    }, 0);
    // KRW 잔액 합계 (ledger 기반 currentBalance)
    const totalKrwBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + row.currentBalance;
    }, 0);
    
    // 주식 평가금액 합계
    const totalStock = securitiesAccounts.reduce((sum, row) => {
      return sum + (stockMap.get(row.account.id) ?? 0);
    }, 0);
    
    // 증권계좌 현금자산 = (USD*환율) + KRW
    const securitiesCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
    
    // 입출금·저축 계좌 잔액 합계
    const checkingSavingsBalance = safeBalances
      .filter((row) => row.account.type === "checking" || row.account.type === "savings")
      .reduce((sum, row) => sum + row.currentBalance, 0);
    
    // 총 현금자산 = 증권 현금 + 입출금·저축 잔액
    const totalCash = securitiesCash + checkingSavingsBalance;
    
    // 총 자산 = 주식 + 총 현금
    const totalAsset = totalStock + totalCash;
    
    // USD 환산용
    const totalStockUSD = fxRate ? totalStock / fxRate : null;
    const totalCashUSD = fxRate ? totalCash / fxRate : null;
    const totalAssetUSD = fxRate ? totalAsset / fxRate : null;
    
    return {
      totalUsdBalance,
      totalKrwBalance,
      totalStock,
      totalCash,
      totalAsset,
      totalStockUSD,
      totalCashUSD,
      totalAssetUSD
    };
  }, [safeBalances, stockMap, fxRate]);

  // Summary by account type
  const typeSummary = useMemo(() => {
    const checking = safeBalances
      .filter((r) => r.account.type === "checking")
      .reduce((s, r) => s + r.currentBalance, 0);
    const savings = safeBalances
      .filter((r) => r.account.type === "savings")
      .reduce((s, r) => s + r.currentBalance, 0);
    const debt = Array.from(cardDebtMap.values()).reduce((s, v) => s + v.total, 0);
    const securities = safeBalances
      .filter((r) => r.account.type === "securities")
      .reduce((s, row) => {
        const stock = stockMap.get(row.account.id) ?? 0;
        const krw = row.currentBalance;
        const usd = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
        const usdKrw = fxRate ? usd * fxRate : 0;
        return s + stock + krw + usdKrw;
      }, 0);
    const total = checking + savings + securities + debt;
    return { checking, savings, debt, securities, total };
  }, [safeBalances, stockMap, cardDebtMap, fxRate]);

  const renderAccountRow = (row: typeof safeBalances[0], index: number, accountType: AccountType) => (
    <tr
      key={row.account.id}
      draggable
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        const currentIndex = safeBalances.findIndex((b) => b.account.id === draggingId);
        handleReorderAccount(draggingId, currentIndex);
        setDraggingId(null);
      }}
      onDragStart={() => setDraggingId(row.account.id)}
      onDragEnd={() => setDraggingId(null)}
    >
      <td className="drag-cell">
        <span className="drag-handle" title="드래그하여 순서 변경">::</span>
      </td>
      <td
        onDoubleClick={() => startEditCell(row.account.id, "id", row.account.id)}
        style={{ cursor: "pointer" }}
        title="더블클릭하여 계좌 ID 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "id" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.id
        )}
      </td>
      <td
        onClick={(e) => {
          if (!editingCell || editingCell.id !== row.account.id || editingCell.field !== "name") {
            e.stopPropagation();
            setSelectedAccount(row.account);
          }
        }}
        onDoubleClick={() => startEditCell(row.account.id, "name", row.account.name)}
        style={{ cursor: "pointer" }}
        title="클릭: 거래 내역 보기, 더블클릭: 계좌명 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "name" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.name
        )}
      </td>
      <td
        onDoubleClick={() =>
          startEditCell(row.account.id, "institution", row.account.institution ?? "")
        }
        style={{ cursor: "pointer" }}
        title="더블클릭하여 기관 수정"
      >
        {editingCell &&
        editingCell.id === row.account.id &&
        editingCell.field === "institution" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.institution
        )}
      </td>
      {accountType === "securities" ? (
        (() => {
          const stockAsset = stockMap.get(row.account.id) ?? 0;
          const usdBalance = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
          const krwBalance = row.currentBalance;

          const cashAsset = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
          const totalAsset = stockAsset + cashAsset;

          const stockAssetUSD = fxRate ? stockAsset / fxRate : null;
          const cashAssetUSD = fxRate ? cashAsset / fxRate : null;
          const totalAssetUSD = fxRate ? totalAsset / fxRate : null;
          
          return (
            <>
              {/* USD 잔액 (더블클릭 수정) */}
              <td
                onDoubleClick={() => startEditCell(row.account.id, "usdBalance", row.account.usdBalance ?? 0)}
                style={{ cursor: "pointer", padding: "8px", textAlign: "right" }}
                title="더블클릭하여 USD 잔액 수정"
                className="number"
              >
                {editingCell && editingCell.id === row.account.id && editingCell.field === "usdBalance" ? (
                  <input
                    type="text"
                    value={editingCellValue}
                    autoFocus
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^\d.-]/g, "");
                      setEditingCellValue(val);
                    }}
                    onBlur={saveCell}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCell();
                      if (e.key === "Escape") {
                        setEditingCell(null);
                        setEditingCellValue("");
                      }
                    }}
                    style={{ padding: "4px", fontSize: "13px", width: "100%", textAlign: "right" }}
                  />
                ) : (
                  <span style={{ fontWeight: 500, color: usdBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                    {formatUSD(usdBalance)}
                  </span>
                )}
              </td>
              {/* KRW 잔액 (ledger에서 자동 반영) */}
              <td
                style={{ padding: "8px", textAlign: "right" }}
                title="KRW 잔액 (원장에서 자동 반영)"
                className="number"
              >
                <span style={{ fontWeight: 500, color: krwBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {formatKRW(krwBalance)}
                </span>
              </td>
              {/* 주식자산 */}
              <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(stockAsset)}</div>
                {stockAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(stockAssetUSD)}
                  </div>
                )}
              </td>
              {/* 현금자산 (주식 제외) */}
              <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(cashAsset)}</div>
                {cashAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(cashAssetUSD)}
                  </div>
                )}
              </td>
              {/* 총 자산 */}
              <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(totalAsset)}</div>
                {totalAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(totalAssetUSD)}
                  </div>
                )}
              </td>
            </>
          );
        })()
      ) : (
        <>
          <td
            onDoubleClick={() => startEditCell(row.account.id, "type", row.account.type)}
            style={{ cursor: "pointer" }}
            title="더블클릭하여 계좌 유형 수정"
          >
            {editingCell && editingCell.id === row.account.id && editingCell.field === "type" ? (
              <select
                value={editingCellValue}
                autoFocus
                onChange={(e) => setEditingCellValue(e.target.value)}
                onBlur={saveCell}
              >
                <option value="checking">입출금</option>
                <option value="savings">저축</option>
                <option value="card">신용카드</option>
                <option value="securities">증권</option>
                <option value="other">기타</option>
              </select>
            ) : (
              ACCOUNT_TYPE_LABEL[row.account.type]
            )}
          </td>
        </>
      )}
      {(() => {
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const currency = isUSD ? "USD" : "KRW";
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        // Securities account is handled above.
        if (accountType === "securities") {
          return null;
        }
        
        // 증권/카드 계좌는 별도 렌더링 (위에서 securities, 아래에서 card 처리)
        if (accountType === "card") {
          return null;
        }
        
        // For checking/savings/other, display current balance.
        const cashAsset = row.currentBalance;
        
        return (
          <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
            {formatAmount(cashAsset)}
          </td>
        );
      })()}
      {(() => {
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        if (accountType === "card") {
          const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
          return (
            <>
              <td className={`number ${debtInfo.total >= 0 ? "positive" : "negative"}`}>
                {formatAmount(debtInfo.total)}
              </td>
              <td className={`number ${debtInfo.monthly >= 0 ? "positive" : "negative"}`}>
                {formatAmount(debtInfo.monthly)}
              </td>
            </>
          );
        }
        return null;
      })()}
      <td style={{ whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setAdjustingAccount({ id: row.account.id, type: accountType });
              const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
              setAdjustValue(accountType === "card" ? String(Math.round(debtInfo.total)) : "");
              setIsSetDirectly(accountType === "card");
              // 증권계좌 수정 시 USD/KRW 잔액 초기화
              if (accountType === "securities") {
                setEditUsdBalance("");
                setEditKrwBalance("");
              }
            }}
            style={{ fontSize: "13px", padding: "6px 12px" }}
          >
            수정
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm(`"${row.account.name}" 계좌를 삭제할까요?\n\n관련 거래 내역은 유지됩니다.`)) {
                handleDeleteAccount(row.account.id);
              }
            }}
            style={{ fontSize: "13px", padding: "6px 12px" }}
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div>
      <div className="section-header">
        <h2>계좌</h2>
        <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "폼 닫기" : "계좌 추가"}
        </button>
      </div>

      {/* 요약: 현금·입출금·주식자산·부채 합계 (종류별 증권/카드 구분 표시) */}
      {safeBalances.length > 0 && (
        <div style={{
          marginBottom: "24px",
          padding: "16px 20px",
          background: "var(--surface)",
          borderRadius: "8px",
          border: "2px solid var(--primary)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "16px 24px",
            alignItems: "center"
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>현금</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.checking)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>저축</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.savings)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>부채</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: typeSummary.debt < 0 ? "var(--danger)" : "var(--text-muted)" }}>
                {formatKRW(typeSummary.debt)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>주식</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.securities)}
              </span>
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingLeft: "24px",
              borderLeft: "2px solid var(--border)",
              gridColumn: "span 1"
            }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>순자산</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: typeSummary.total >= 0 ? "var(--primary)" : "var(--danger)" }}>
                {formatKRW(typeSummary.total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {showForm && <AccountForm onAdd={handleAddAccount} existingIds={safeAccounts.map((a) => a.id)} />}

      {(["checking", "savings", "card", "securities", "other"] as AccountType[]).map((type) => {
        const accountsOfType = accountsByType.get(type) ?? [];
        if (accountsOfType.length === 0) return null;
        
        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              {ACCOUNT_TYPE_LABEL[type]}
            </h3>
            <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>순서</th>
            <th>계좌 ID</th>
            <th>계좌명</th>
            <th>기관</th>
            {type === "securities" ? (
              <>
                <th>USD</th>
                <th>KRW</th>
                <th>주식</th>
                <th>현금</th>
                <th>합계</th>
              </>
            ) : (
              <>
                <th style={{ width: "60px" }}>유형</th>
              </>
            )}
            {type === "card" ? (
              <>
                <th>총 부채</th>
                <th>월 부채</th>
              </>
            ) : (
              <th>현재 잔액</th>
            )}
            <th>작업</th>
          </tr>
        </thead>
              <tbody>
                {accountsOfType.map((row) => renderAccountRow(row, 0, type))}
                {/* 합계 행 */}
                {(() => {
                  if (type === "securities") {
                    const totalStock = accountsOfType.reduce((sum, row) => {
                      return sum + (stockMap.get(row.account.id) ?? 0);
                    }, 0);
                    
                    // USD 잔액 합계, KRW 잔액 합계
                    const totalUsdBalance = accountsOfType.reduce((sum, row) => {
                      return sum + (row.account.usdBalance ?? 0);
                    }, 0);
                    // KRW 잔액 합계 (ledger 기반 currentBalance)
                    const totalKrwBalance = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);
                    
                    // 현금자산 합계 = (USD*환율) + KRW
                    const totalCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
                    const totalAsset = totalStock + totalCash;
                    const totalStockUSD = fxRate ? totalStock / fxRate : null;
                    const totalCashUSD = fxRate ? totalCash / fxRate : null;
                    const totalAssetUSD = fxRate ? totalAsset / fxRate : null;
                    
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={4} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${totalUsdBalance >= 0 ? "positive" : "negative"}`}>
                          {formatUSD(totalUsdBalance)}
                        </td>
                        <td className={`number ${totalKrwBalance >= 0 ? "positive" : "negative"}`}>
                          {formatKRW(totalKrwBalance)}
                        </td>
                        <td className={`number ${totalStock >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalStock)}</div>
                          {totalStockUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalStockUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalCash >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalCash)}</div>
                          {totalCashUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalCashUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalAsset)}</div>
                          {totalAssetUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalAssetUSD)}
                            </div>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else if (type === "card") {
                    const totalDebt = accountsOfType.reduce((sum, row) => {
                      const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
                      return sum + debtInfo.total;
                    }, 0);
                    const totalMonthlyDebt = accountsOfType.reduce((sum, row) => {
                      const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
                      return sum + debtInfo.monthly;
                    }, 0);
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${totalDebt >= 0 ? "positive" : "negative"}`}>
                          {formatNumber(totalDebt)}
                        </td>
                        <td className={`number ${totalMonthlyDebt >= 0 ? "positive" : "negative"}`}>
                          {formatNumber(totalMonthlyDebt)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else {
                    // 입출금·저축 합계
                    const totalBalance = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${totalBalance >= 0 ? "positive" : "negative"}`}>
                          {formatNumber(totalBalance)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  }
                })()}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* 계좌 초기 금액 역산: 현재 보유금액이 맞지 않을 때 역산하여 초기 금액 적용 */}
      {orderedRowsForInitialReverse.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 20 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>계좌 초기 금액 역산</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
            각 계좌의 <strong>현재 보유금액(역산)</strong>이 맞지 않을 때, 이체·거래 내역으로부터 역산한 계좌 초기 금액을 일괄 조정합니다.
          </p>
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>계좌명</th>
                <th style={{ textAlign: "right" }}>현재 보유금액(역산)</th>
                <th style={{ textAlign: "right" }}>계좌 초기 금액 역산</th>
              </tr>
            </thead>
            <tbody>
              {orderedRowsForInitialReverse.map((row) => {
                  const rev = reversedInitialBalance(row.account.id);
                  return (
                    <tr key={row.account.id}>
                      <td>
                        {row.account.name} ({row.account.institution || "-"})
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={actualCurrentInput[row.account.id] ?? ""}
                          onChange={(e) =>
                            setActualCurrentInput((prev) => ({
                              ...prev,
                              [row.account.id]: e.target.value
                            }))
                          }
                          placeholder="비어있음"
                          style={{
                            width: 120,
                            padding: "6px 8px",
                            borderRadius: 4,
                            textAlign: "right"
                          }}
                        />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {rev != null ? formatKRW(Math.round(rev)) : "-"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              onClick={fillActualCurrentFromComputed}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              실제값으로 채우기
            </button>
            <button
              type="button"
              className="primary"
              onClick={applyReversedInitial}
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              계좌 초기 금액 역산을 계좌에 적용
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 && (
        <EmptyState
          icon={<Wallet size={48} />}
          title="아직 계좌가 없습니다"
          message="첫 계좌를 추가해 보세요."
          action={{ label: "계좌 추가", onClick: () => setShowForm(true) }}
        />
      )}

      {/* 수정 모달: 잔액/부채 조정 */}
      {adjustingAccount && (() => {
        const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
        if (!account) return null;

        // 카드: 부채 합계, 그 외: 초기잔액
        const currentAdjustment =
          adjustingAccount.type === "card"
            ? (cardDebtMap.get(account.id)?.total ?? normalizeDebtValue(account.debt ?? 0))
            : (account.initialBalance ?? 0);

        return (
          <div className="modal-backdrop" onClick={() => setAdjustingAccount(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "500px" }}>
              <div className="modal-header">
                <h3>
                  {(() => {
                    const label = `${account.name} (${ACCOUNT_TYPE_LABEL[adjustingAccount.type]})`;
                    if (adjustingAccount.type === "card") {
                      return `${label} - 부채 조정`;
                    } else if (adjustingAccount.type === "securities") {
                      return `${label} - 보유금액 설정`;
                    } else {
                      return `${label} - 보유금액 조정`;
                    }
                  })()}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustingAccount(null);
                    setAdjustValue("");
                    setAdjustValueUSD("");
                    setIsAdjustingUSD(false);
                    setIsSetDirectly(false);
                    setEditUsdBalance("");
                    setEditKrwBalance("");
                  }}
                  style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                {/* 카드: 부채 잔액 표시 */}
                {(() => {
                  const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
                  const currentBalance = balanceRow?.currentBalance ?? 0;
                  const accountName = (account.name + account.id).toLowerCase();
                  const isUSD = account.currency === "USD" || 
                               accountName.includes("usd") || 
                               accountName.includes("dollar") || 
                               accountName.includes("달러");
                  const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
                  
                  if (adjustingAccount.type === "securities" && balanceRow) {
                    const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
                    return (
                      <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 보유금액</div>
                        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                          <div>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>USD: </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: dispUsd >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {formatUSD(dispUsd)}
                            </span>
                          </div>
                          <div>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>KRW: </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {formatKRW(currentBalance)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 계좌 잔액</div>
                      <div style={{ fontSize: "24px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {formatAmount(currentBalance)}
                      </div>
                    </div>
                  );
                })()}
                
                {/* 증권계좌: USD/KRW 잔액·주식자산 표시 */}
                {adjustingAccount.type === "securities" ? (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        직접 목표 잔액 설정 (체크 시 입력값이 현재 잔액이 됨)
                      </span>
                    </label>
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "USD 잔액" : "USD 증감 (음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editUsdBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditUsdBalance(val);
                        }}
                        placeholder={isSetDirectly ? "USD 잔액 (예: 1000.50)" : "USD 증감 (예: 100 또는 -50)"}
                        autoFocus
                        style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setEditUsdBalance("");
                            setEditKrwBalance("");
                          }
                        }}
                      />
                      {editUsdBalance && fxRate && (
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                          원화 환산 약 {formatNumber(Number(editUsdBalance.replace(/,/g, "")) * fxRate)}원
                        </div>
                      )}
                    </label>
                    
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "원화 잔액 (KRW)" : "원화 증감 (KRW, 음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editKrwBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditKrwBalance(val);
                        }}
                        placeholder={isSetDirectly ? "KRW 잔액 (예: 1000000)" : "KRW 증감 (예: 100000 또는 -50000)"}
                        style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setEditUsdBalance("");
                            setEditKrwBalance("");
                          }
                        }}
                      />
                    </label>
                    
                    {fxRate && (
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", padding: "8px", background: "var(--bg)", borderRadius: "4px" }}>
                        FX rate: {formatNumber(fxRate)} KRW/USD
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 부채/잔액 조정 입력 */}
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                        {adjustingAccount.type === "card" ? "현재 부채" : "현재 보유금액 조정값"}
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)}
                      </div>
                    </div>

                    {/* 부채/잔액 조정 안내 */}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        {adjustingAccount.type === "card"
                          ? "직접 목표 부채 설정 (입력값이 현재 부채가 됨)"
                          : "직접 목표 잔액 설정 (입력값이 현재 잔액이 됨)"}
                      </span>
                    </label>
                    <label>
                      <span>
                        {isSetDirectly
                          ? (adjustingAccount.type === "card" ? "목표 부채 금액" : "목표 잔액")
                          : (adjustingAccount.type === "card"
                              ? "부채 조정 금액 (+ 증가, - 감소)"
                              : "잔액 증감 (음수 입력 시 차감)")}
                      </span>
                      
                      <input
                        type="text"
                        value={adjustValue}
                        onChange={(e) => {
                          const val = sanitizeSignedNumericInput(e.target.value);
                          setAdjustValue(val);
                        }}
                        placeholder={
                          adjustingAccount.type === "card"
                            ? (isSetDirectly ? "금액 (예: +100000 또는 -100000)" : "금액 (예: +100000 또는 -50000)")
                            : "금액 입력 (예: +100000 또는 -50000)"
                        }
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                            setAdjustValue("");
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setAdjustValue("");
                          }
                        }}
                      />
                    </label>
                  </>
                )}
                <div className="form-actions" style={{ marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustingAccount(null);
                      setAdjustValue("");
                      setAdjustValueUSD("");
                      setIsAdjustingUSD(false);
                      setEditUsdBalance("");
                      setEditKrwBalance("");
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      handleAdjustBalance();
                    }}
                  >
                    {isSetDirectly ? "설정" : "적용"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedAccount && (() => {
        const accountTransactions = ledger
          .filter((l) => {
          if (l.fromAccountId === selectedAccount.id || l.toAccountId === selectedAccount.id) {
            return true;
          }
          return false;
        })
          .sort((a, b) => b.date.localeCompare(a.date));

        const KIND_LABEL: Record<string, string> = {
          income: "수입",
          expense: "지출",
          transfer: "이체"
        };

        return (
          <div className="modal-backdrop" onClick={() => setSelectedAccount(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "900px", maxHeight: "80vh" }}>
              <div className="modal-header">
                <h3>{selectedAccount.name} ({selectedAccount.id}) - 거래 내역</h3>
                <button
                  type="button"
                  onClick={() => setSelectedAccount(null)}
                  style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
                >
                  ×
                </button>
              </div>
              <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(80vh - 120px)" }}>
                {accountTransactions.length === 0 ? (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                    이 계좌에 거래 내역이 없습니다.
                  </p>
                ) : (
                  <table className="data-table" style={{ fontSize: "13px" }}>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>유형</th>
                        <th>카테고리</th>
                        <th>하위카테고리</th>
                        <th>설명</th>
                        <th>출금</th>
                        <th>입금</th>
                        <th style={{ textAlign: "right" }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountTransactions.map((l) => {
                        const isFrom = l.fromAccountId === selectedAccount.id;
                        const isTo = l.toAccountId === selectedAccount.id;
                        const amount = l.amount;
                        const displayAmount = isFrom ? -amount : amount; // 출금은 음수, 입금은 양수

                        return (
                          <tr key={l.id}>
                            <td>{formatShortDate(l.date)}</td>
                            <td>{KIND_LABEL[l.kind] || l.kind}</td>
                            <td>{l.category || "-"}</td>
                            <td>{l.subCategory || "-"}</td>
                            <td>{l.description || "-"}</td>
                            <td>{l.fromAccountId || "-"}</td>
                            <td>{l.toAccountId || "-"}</td>
                            <td style={{ textAlign: "right", color: displayAmount >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {displayAmount >= 0 ? "+" : ""}{formatNumber(displayAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

interface AccountFormProps {
  onAdd: (account: Account) => void;
  existingIds: string[];
}

const AccountForm: React.FC<AccountFormProps> = ({ onAdd, existingIds }) => {
  const [form, setForm] = useState({
    id: "",
    name: "",
    institution: "",
    type: "checking" as AccountType,
    initialBalance: "",
    debt: "",
    savings: "",
    cashAdjustment: "",
    initialCashBalance: "",
    note: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim()) {
      alert("계좌 ID와 계좌명을 입력해 주세요.");
      return;
    }
    if (existingIds.includes(form.id)) {
      alert("이미 존재하는 계좌 ID입니다.");
      return;
    }
    const amount = Number(form.initialBalance.replace(/,/g, "")) || 0;
    const rawDebt = Number(form.debt.replace(/,/g, "")) || 0;
    const debt = rawDebt;
    const savings = Number(form.savings.replace(/,/g, "")) || 0;
    const cashAdjustment = Number(form.cashAdjustment.replace(/,/g, "")) || 0;
    const initialCashBalance = Number(form.initialCashBalance.replace(/,/g, "")) || 0;
    const account: Account = {
      id: form.id.trim(),
      name: form.name.trim(),
      institution: form.institution.trim() || "",
      type: form.type,
      initialBalance: amount,
      debt,
      savings,
      cashAdjustment: form.type === "securities" ? cashAdjustment : undefined,
      initialCashBalance: form.type === "securities" && initialCashBalance > 0 ? initialCashBalance : undefined,
      note: form.note.trim() || undefined
    };
    onAdd(account);
    setForm({
      id: "",
      name: "",
      institution: "",
      type: "checking",
      initialBalance: "",
      debt: "",
      savings: "",
      cashAdjustment: "",
      initialCashBalance: "",
      note: ""
    });
  };

  return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h3>계좌 추가</h3>
      <label>
        <span>계좌 ID *</span>
        <input
          type="text"
          required
          placeholder="예: CHK_KB"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase().replace(/\s/g, "_") })}
        />
      </label>
      <label>
        <span>계좌명 *</span>
        <input
          type="text"
          required
          placeholder="예: 월급통장"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span>기관 / 증권사</span>
        <input
          type="text"
          placeholder="예: 농협은행"
          value={form.institution}
          onChange={(e) => setForm({ ...form, institution: e.target.value })}
        />
      </label>
      <label>
        <span>계좌 유형</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
          <option value="checking">입출금</option>
          <option value="savings">저축</option>
          <option value="card">신용카드</option>
          <option value="securities">증권</option>
          <option value="other">기타</option>
        </select>
      </label>
      <label>
        <span>초기 잔액</span>
        <input
          type="number"
          min={0}
          placeholder="0"
          value={form.initialBalance}
          onChange={(e) => setForm({ ...form, initialBalance: e.target.value })}
        />
      </label>
      <label>
        <span>부채</span>
        <input
          type="number"
          placeholder="-100000"
          value={form.debt}
          onChange={(e) => setForm({ ...form, debt: e.target.value })}
        />
      </label>
      <label>
        <span>저축</span>
        <input
          type="number"
          min={0}
          placeholder="0"
          value={form.savings}
          onChange={(e) => setForm({ ...form, savings: e.target.value })}
        />
      </label>
      {form.type === "securities" && (
        <>
          <label>
            <span>초기 현금 잔액</span>
            <input
              type="number"
              placeholder="0"
              value={form.initialCashBalance}
              onChange={(e) => setForm({ ...form, initialCashBalance: e.target.value })}
            />
          </label>
          <label>
            <span>현금 조정 (선택)</span>
            <input
              type="number"
              placeholder="0"
              value={form.cashAdjustment}
              onChange={(e) => setForm({ ...form, cashAdjustment: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="wide">
        <span>메모</span>
        <input
          type="text"
          placeholder="메모 입력"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary">
          계좌 추가
        </button>
      </div>
    </form>
  );
};
