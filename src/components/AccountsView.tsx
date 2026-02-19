import React, { useMemo, useState, useEffect } from "react";
import type { Account, AccountType, LedgerEntry } from "../types";
import type { AccountBalanceRow, PositionRow } from "../calculations";
import { formatNumber, formatShortDate, formatKRW, formatUSD } from "../utils/format";
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
  card: "카드",
  securities: "증권",
  other: "기타"
};

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
  const [isSetDirectly, setIsSetDirectly] = useState(false); // true: 목표 잔액으로 설정, false: 추가
  const [editUsdBalance, setEditUsdBalance] = useState("");
  const [editKrwBalance, setEditKrwBalance] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);

  // 환율 가져오기
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
    // 1시간마다 환율 업데이트
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
    
    // 증권계좌: 다른 계좌처럼 추가/감소 또는 목표로 설정
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
        // 추가/감소 모드
        if (inputUsd === 0 && inputKrw === 0) {
          alert("달러 또는 원화 중 하나 이상 0이 아닌 값을 입력해주세요.");
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
        alert("환율 정보를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      value = usdValue * fxRate;
    } else if (adjustValue) {
      value = Number(adjustValue.replace(/,/g, "")) || 0;
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
        if (isSetDirectly) {
          return { ...a, debt: value };
        }
        return { ...a, debt: (a.debt ?? 0) + value };
      } else {
        // 입출금, 저축, 기타
        if (isSetDirectly) {
          // 목표 잔액으로 설정: initialBalance = 목표 - (currentBalance - initialBalance)
          const delta = value - currentBalance;
          return { ...a, initialBalance: (a.initialBalance ?? 0) + delta };
        }
        return { ...a, initialBalance: (a.initialBalance ?? 0) + value };
      }
    });

    onChangeAccounts(updated);
    // 모달을 닫지 않고 입력 필드만 초기화하여 계속 추가할 수 있게 함
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
        alert("계좌ID는 비워 둘 수 없습니다.");
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
        alert("이미 사용 중인 계좌ID입니다. 다른 ID를 입력해 주세요.");
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
      // 보유 수량이 0보다 크고 평가금액이 0보다 큰 경우만 합산
      if (p.quantity > 0 && p.marketValue > 0) {
        map.set(p.accountId, (map.get(p.accountId) ?? 0) + p.marketValue);
      }
    });
    return map;
  }, [safePositions]);


  // 카드 계좌의 부채 계산 (카드 사용 - 카드대금 결제 + 계좌의 debt 필드)
  const cardDebtMap = useMemo(() => {
    const map = new Map<string, { total: number; monthly: number }>();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    safeBalances.forEach((row) => {
      if (row.account.type === "card") {
        // 카드 사용 합계 (expense)
        const totalUsage = ledger
          .filter((l) => l.kind === "expense" && l.fromAccountId === row.account.id)
          .reduce((sum, l) => sum + l.amount, 0);
        
        // 카드대금 결제 합계 (transfer, 이체>카드결제이체)
        // 카드 계좌로 들어온 결제 (실제 계좌에서 카드 계좌로 이체된 금액)
        const totalPayment = ledger
          .filter((l) =>
            l.kind === "transfer" &&
            l.category === "이체" &&
            l.subCategory === "카드결제이체" &&
            l.toAccountId === row.account.id
          )
          .reduce((sum, l) => sum + l.amount, 0);
        
        // 계좌의 debt 필드 값 (수동으로 추가한 부채)
        const accountDebt = row.account.debt ?? 0;
        
        // 전체 부채 = 사용 - 결제 + 계좌의 debt 필드
        const totalDebt = totalUsage - totalPayment + accountDebt;
        
        // 월 부채: 이번 달 사용 - 이번 달 결제
        const monthlyUsage = ledger
          .filter((l) => {
            if (l.kind !== "expense" || l.fromAccountId !== row.account.id) return false;
            if (!l.date) return false;
            return l.date.slice(0, 7) === currentMonth;
          })
          .reduce((sum, l) => sum + l.amount, 0);
        
        const monthlyPayment = ledger
          .filter((l) =>
            l.kind === "transfer" &&
            l.category === "이체" &&
            l.subCategory === "카드결제이체" &&
            l.toAccountId === row.account.id &&
            l.date &&
            l.date.slice(0, 7) === currentMonth
          )
          .reduce((sum, l) => sum + l.amount, 0);
        
        const monthlyDebt = monthlyUsage - monthlyPayment;
        
        map.set(row.account.id, { total: totalDebt, monthly: monthlyDebt });
      }
    });
    
    return map;
  }, [safeBalances, ledger]);

  // 계좌를 타입별로 그룹화
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

  // 전체 계좌 총합 계산 (모든 계좌 타입)
  const totalSummary = useMemo(() => {
    // 증권계좌
    const securitiesAccounts = safeBalances.filter((row) => row.account.type === "securities");
    
    // 달러 보유량 합계 (usdBalance + usdTransferNet)
    const totalUsdBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
    }, 0);
    // 원화 보유량: ledger를 기반으로 계산된 currentBalance 사용
    const totalKrwBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + row.currentBalance;
    }, 0);
    
    // 주식 자산 합계
    const totalStock = securitiesAccounts.reduce((sum, row) => {
      return sum + (stockMap.get(row.account.id) ?? 0);
    }, 0);
    
    // 증권계좌 현금 합계 = 달러(환율 적용) + 원화
    const securitiesCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
    
    // 입출금, 저축 계좌 잔액 합계
    const checkingSavingsBalance = safeBalances
      .filter((row) => row.account.type === "checking" || row.account.type === "savings")
      .reduce((sum, row) => sum + row.currentBalance, 0);
    
    // 전체 현금 = 증권계좌 현금 + 입출금/저축 계좌 잔액
    const totalCash = securitiesCash + checkingSavingsBalance;
    
    // 총액 = 주식 + 전체 현금
    const totalAsset = totalStock + totalCash;
    
    // USD로 변환
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

  // 타입별 요약: 입출금→현금, 저축→저축, 카드→부채, 증권→주식
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
    const total = checking + savings + securities - debt;
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
        <span className="drag-handle" title="잡고 위/아래로 끌어서 순서 변경">☰</span>
      </td>
      <td
        onDoubleClick={() => startEditCell(row.account.id, "id", row.account.id)}
        style={{ cursor: "pointer" }}
        title="더블클릭하여 계좌ID를 수정"
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
        title="더블클릭하여 기관을 수정"
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
          
          // 달러 보유량 = 주식거래 기준값 + 이체(USD) 순액
          const usdBalance = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
          // 원화 보유량: ledger를 기반으로 계산된 currentBalance 사용 (배당 등이 반영됨)
          // 증권계좌의 경우 currentBalance는 initialCashBalance + income - expense + transfer + tradeCashImpact
          const krwBalance = row.currentBalance;
          
          // 현금 = 달러(환율 적용) + 원화
          const cashAsset = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
          const totalAsset = stockAsset + cashAsset;
          
          // USD로 변환 (환율이 있을 때만)
          const stockAssetUSD = fxRate ? stockAsset / fxRate : null;
          const cashAssetUSD = fxRate ? cashAsset / fxRate : null;
          const totalAssetUSD = fxRate ? totalAsset / fxRate : null;
          
          return (
            <>
              {/* 달러 보유량 */}
              <td
                onDoubleClick={() => startEditCell(row.account.id, "usdBalance", row.account.usdBalance ?? 0)}
                style={{ cursor: "pointer", padding: "8px", textAlign: "right" }}
                title="더블클릭하여 달러 보유량 수정"
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
              {/* 원화 보유량 (ledger 기반 계산값, 수정 불가) */}
              <td
                style={{ padding: "8px", textAlign: "right" }}
                title="원화 보유량 (배당 등 ledger 내역이 자동 반영됨)"
                className="number"
              >
                <span style={{ fontWeight: 500, color: krwBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {formatKRW(krwBalance)}
                </span>
              </td>
              {/* 주식 */}
              <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(stockAsset)}</div>
                {stockAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(stockAssetUSD)}
                  </div>
                )}
              </td>
              {/* 현금 (주식 탭과 동일한 값) */}
              <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(cashAsset)}</div>
                {cashAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(cashAssetUSD)}
                  </div>
                )}
              </td>
              {/* 총액 */}
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
            title="더블클릭하여 계좌종류를 수정"
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
                <option value="card">카드</option>
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
        // 계좌 통화 감지 (USD 또는 KRW)
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const currency = isUSD ? "USD" : "KRW";
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        // 증권계좌는 이미 위에서 처리됨
        if (accountType === "securities") {
          return null;
        }
        
        // 카드계좌: 초기잔액 등의 열은 표시하지 않음 (부채 정보는 아래에서 별도 처리)
        if (accountType === "card") {
          return null;
        }
        
        // 입출금, 저축, 기타 계좌: 현재 잔액 표시
        const cashAsset = row.currentBalance;
        
        return (
          <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
            {formatAmount(cashAsset)}
          </td>
        );
      })()}
      {(() => {
        // 계좌 통화 감지
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        if (accountType === "card") {
          // 카드계좌: 전체 부채, 월 부채만 표시
          const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
          return (
            <>
              <td className={`number ${debtInfo.total >= 0 ? "negative" : "positive"}`}>
                {formatAmount(debtInfo.total)}
              </td>
              <td className={`number ${debtInfo.monthly >= 0 ? "negative" : "positive"}`}>
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
              setAdjustValue("");
              setIsSetDirectly(false);
              // 증권계좌: 다른 계좌처럼 추가/감소 모드로 초기화 (빈 입력)
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
              if (window.confirm(`정말 "${row.account.name}" 계좌를 삭제하시겠습니까?\n\n관련된 거래 내역은 유지됩니다.`)) {
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
        <h2>계좌 목록</h2>
        <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "입력 닫기" : "새 계좌 추가"}
        </button>
      </div>

      {/* 타입별 요약: 입출금→현금, 저축→저축, 카드→부채, 증권→주식 (맨 위에 표시) */}
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
              <span style={{ fontSize: 18, fontWeight: 700, color: typeSummary.debt > 0 ? "var(--danger)" : "var(--text-muted)" }}>
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
            <th>계좌ID</th>
            <th>계좌명</th>
            <th>기관</th>
            {type === "securities" ? (
              <>
                <th>달러</th>
                <th>원화</th>
                <th>주식</th>
                <th>현금</th>
                <th>총액</th>
              </>
            ) : (
              <>
                <th style={{ width: "60px" }}>종류</th>
              </>
            )}
            {type === "card" ? (
              <>
                <th>전체 부채</th>
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
                    
                    // 달러 보유량 합계와 원화 보유량 합계
                    const totalUsdBalance = accountsOfType.reduce((sum, row) => {
                      return sum + (row.account.usdBalance ?? 0);
                    }, 0);
                    // 원화 보유량: ledger를 기반으로 계산된 currentBalance 사용
                    const totalKrwBalance = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);
                    
                    // 현금 합계 = 달러(환율 적용) + 원화
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
                        <td className={`number ${totalDebt >= 0 ? "negative" : "positive"}`}>
                          {formatNumber(totalDebt)}
                        </td>
                        <td className={`number ${totalMonthlyDebt >= 0 ? "negative" : "positive"}`}>
                          {formatNumber(totalMonthlyDebt)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else {
                    // 입출금, 저축, 기타 계좌
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

      {accounts.length === 0 && (
        <EmptyState
          icon={<Wallet size={48} />}
          title="아직 계좌가 없습니다"
          message="새 계좌를 추가해 보세요."
          action={{ label: "계좌 추가", onClick: () => setShowForm(true) }}
        />
      )}

      {/* 금액 조정 모달 */}
      {adjustingAccount && (() => {
        const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
        if (!account) return null;

        // 현재 조정된 총액 계산 (증권계좌는 제외)
        let currentAdjustment = 0;
        let initialValue = 0;
        if (adjustingAccount.type === "card") {
          initialValue = 0; // 부채는 초기값이 0
          currentAdjustment = account.debt ?? 0;
        } else {
          initialValue = 0; // 입출금/저축은 초기값이 0일 수 있음
          currentAdjustment = account.initialBalance ?? 0;
        }

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
                      return `${label} - 보유금액 수정`;
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
                {/* 현재 계좌 잔액 표시 */}
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
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>달러: </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: dispUsd >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {formatUSD(dispUsd)}
                            </span>
                          </div>
                          <div>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>원화: </span>
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
                
                {/* 증권계좌인 경우 달러/원화 추가/감소 또는 목표 설정 */}
                {adjustingAccount.type === "securities" ? (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        목표 잔액으로 직접 설정 (체크 시 입력값이 현재 잔액이 됨)
                      </span>
                    </label>
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "달러 보유량 (USD)" : "달러 추가/감소 (USD, 음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editUsdBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditUsdBalance(val);
                        }}
                        placeholder={isSetDirectly ? "달러 보유량 (예: 1000.50)" : "추가할 달러 (예: 100 또는 -50)"}
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
                          ≈ {formatNumber(Number(editUsdBalance.replace(/,/g, "")) * fxRate)} 원
                        </div>
                      )}
                    </label>
                    
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "원화 보유량 (KRW)" : "원화 추가/감소 (KRW, 음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editKrwBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditKrwBalance(val);
                        }}
                        placeholder={isSetDirectly ? "원화 보유량 (예: 1000000)" : "추가할 원화 (예: 100000 또는 -50000)"}
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
                        환율: {formatNumber(fxRate)} 원/USD
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 조정 내역 표시 */}
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                        {adjustingAccount.type === "card" ? "현재 부채" : "현재 보유금액 조정액"}
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)} 원
                      </div>
                    </div>

                    {/* 추가/직접 설정 모드 */}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        목표 잔액으로 직접 설정 (체크 시 입력값이 현재 잔액이 됨)
                      </span>
                    </label>
                    <label>
                      <span>
                        {isSetDirectly
                          ? (adjustingAccount.type === "card" ? "목표 부채 금액" : "목표 잔액")
                          : (adjustingAccount.type === "card"
                              ? "추가할 부채 금액 (음수 입력 시 차감)"
                              : "추가할 보유금액 (음수 입력 시 차감)")}
                      </span>
                      
                      <input
                        type="text"
                        value={adjustValue}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9-]/g, "");
                          setAdjustValue(val);
                        }}
                        placeholder="금액을 입력하세요 (예: 100000 또는 -50000)"
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
                    닫기
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      handleAdjustBalance();
                    }}
                  >
                    {adjustingAccount.type === "securities" ? (isSetDirectly ? "저장" : "추가") : "추가"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 계좌 상세 내역 모달 */}
      {selectedAccount && (() => {
        // 해당 계좌와 관련된 거래 내역 필터링
        const accountTransactions = ledger.filter((l) => {
          if (l.fromAccountId === selectedAccount.id || l.toAccountId === selectedAccount.id) {
            return true;
          }
          return false;
        }).sort((a, b) => b.date.localeCompare(a.date)); // 최신순 정렬

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
                    이 계좌와 관련된 거래 내역이 없습니다.
                  </p>
                ) : (
                  <table className="data-table" style={{ fontSize: "13px" }}>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>구분</th>
                        <th>대분류</th>
                        <th>항목</th>
                        <th>상세내역</th>
                        <th>출금계좌</th>
                        <th>입금계좌</th>
                        <th style={{ textAlign: "right" }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountTransactions.map((l) => {
                        const isFrom = l.fromAccountId === selectedAccount.id;
                        const isTo = l.toAccountId === selectedAccount.id;
                        const amount = l.amount;
                        const displayAmount = isFrom ? -amount : amount; // 출금이면 음수, 입금이면 양수

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
                              {displayAmount >= 0 ? "+" : ""}{formatNumber(displayAmount)} 원
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
      alert("계좌ID와 계좌명은 필수입니다.");
      return;
    }
    if (existingIds.includes(form.id)) {
      alert("이미 존재하는 계좌ID입니다.");
      return;
    }
    const amount = Number(form.initialBalance.replace(/,/g, "")) || 0;
    const debt = Number(form.debt.replace(/,/g, "")) || 0;
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
      <h3>새 계좌 추가</h3>
      <label>
        <span>계좌ID *</span>
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
          placeholder="예: 국민입출금"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span>은행/증권사</span>
        <input
          type="text"
          placeholder="예: 국민은행"
          value={form.institution}
          onChange={(e) => setForm({ ...form, institution: e.target.value })}
        />
      </label>
      <label>
        <span>계좌종류</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
          <option value="checking">입출금</option>
          <option value="savings">저축</option>
          <option value="card">카드</option>
          <option value="securities">증권</option>
          <option value="other">기타</option>
        </select>
      </label>
      <label>
        <span>초기잔액</span>
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
          min={0}
          placeholder="0"
          value={form.debt}
          onChange={(e) => setForm({ ...form, debt: e.target.value })}
        />
      </label>
      <label>
        <span>적금/예금</span>
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
            <span>기타 (현금 조정)</span>
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
        <span>비고</span>
        <input
          type="text"
          placeholder="선택사항"
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
