import React, { useMemo, useState } from "react";
import type { Account, AccountType, LedgerEntry } from "../types";
import type { AccountBalanceRow, PositionRow } from "../calculations";
import { formatNumber } from "../utils/format";

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

export const AccountsView: React.FC<Props> = React.memo(({
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
    field: "id" | "name" | "institution" | "type";
  } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [adjustingAccount, setAdjustingAccount] = useState<{
    id: string;
    type: AccountType;
  } | null>(null);
  const [adjustValue, setAdjustValue] = useState("");

  const handleAddAccount = (account: Account) => {
    onChangeAccounts([...safeAccounts, account]);
    setShowForm(false);
  };

  const handleDeleteAccount = (id: string) => {
    onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
  };

  const handleAdjustBalance = () => {
    if (!adjustingAccount || !adjustValue) return;
    const value = Number(adjustValue.replace(/,/g, "")) || 0;
    if (value === 0) {
      alert("0이 아닌 값을 입력해주세요.");
      return;
    }

    const updated = safeAccounts.map((a) => {
      if (a.id !== adjustingAccount.id) return a;

      if (adjustingAccount.type === "card") {
        // 카드 계좌: 부채에 더하기
        return { ...a, debt: (a.debt ?? 0) + value };
      } else if (adjustingAccount.type === "securities") {
        // 증권 계좌: 현금 조정에 더하기 (또는 initialCashBalance)
        if (a.cashAdjustment !== undefined) {
          return { ...a, cashAdjustment: (a.cashAdjustment ?? 0) + value };
        } else {
          return { ...a, initialCashBalance: (a.initialCashBalance ?? a.initialBalance ?? 0) + value };
        }
      } else {
        // 입출금, 저축, 기타: 초기 잔액에 더하기
        return { ...a, initialBalance: (a.initialBalance ?? 0) + value };
      }
    });

    onChangeAccounts(updated);
    // 모달을 닫지 않고 입력 필드만 초기화하여 계속 추가할 수 있게 함
    setAdjustValue("");
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

  const startEditCell = (id: string, field: "id" | "name" | "institution" | "type", current: string) => {
    setEditingCell({ id, field });
    setEditingCellValue(current);
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
    } else {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? {
              ...a,
              [field]: field === "type" ? (editingCellValue as AccountType) : editingCellValue
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


  // 카드 계좌의 부채 계산 (카드 사용 - 카드대금 결제)
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
        
        // 카드대금 결제 합계 (transfer, 신용카드 > 카드대금)
        // 카드 계좌로 들어온 결제 (실제 계좌에서 카드 계좌로 이체된 금액)
        const totalPayment = ledger
          .filter((l) => 
            l.kind === "transfer" && 
            l.category === "신용카드" && 
            l.subCategory === "카드대금" &&
            l.toAccountId === row.account.id
          )
          .reduce((sum, l) => sum + l.amount, 0);
        
        // 전체 부채 = 사용 - 결제
        const totalDebt = totalUsage - totalPayment;
        
        // 월 부채: 이번 달 사용 - 이번 달 결제
        const monthlyUsage = ledger
          .filter((l) => {
            if (l.kind !== "expense" || l.fromAccountId !== row.account.id) return false;
            if (!l.date) return false;
            return l.date.slice(0, 7) === currentMonth;
          })
          .reduce((sum, l) => sum + l.amount, 0);
        
        const monthlyPayment = ledger
          .filter((l) => {
            if (l.kind !== "transfer" || l.category !== "신용카드" || l.subCategory !== "카드대금") return false;
            if (l.toAccountId !== row.account.id) return false;
            if (!l.date) return false;
            return l.date.slice(0, 7) === currentMonth;
          })
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
        onDoubleClick={() => startEditCell(row.account.id, "name", row.account.name)}
        style={{ cursor: "pointer" }}
        title="더블클릭하여 계좌명을 수정"
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
      {(() => {
        // 증권계좌: 주식, 현금, 총액 표시 (주식 탭과 동일한 계산 방식)
        if (accountType === "securities") {
          const stockAsset = stockMap.get(row.account.id) ?? 0;
          const cashAsset = row.currentBalance; // 주식 탭과 동일하게 계산된 현금 잔액
          const totalAsset = stockAsset + cashAsset;
          
          // 현금은 수정 불가 (거래 내역으로 자동 계산됨)
          return (
            <>
              {/* 주식 */}
              <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
                {formatNumber(stockAsset)}
              </td>
              {/* 현금 (주식 탭과 동일한 값) */}
              <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
                {formatNumber(cashAsset)}
              </td>
              {/* 총액 */}
              <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                {formatNumber(totalAsset)}
              </td>
            </>
          );
        }
        
        // 카드계좌: 초기잔액 등의 열은 표시하지 않음 (부채 정보는 아래에서 별도 처리)
        if (accountType === "card") {
          return null;
        }
        
        // 입출금, 저축, 기타 계좌: 보유 금액(총자산)만 표시
        const cashAsset = row.currentBalance;
        const stockAsset = stockMap.get(row.account.id) ?? 0;
        const debt = row.account.debt ?? 0;
        const savings = row.account.savings ?? 0;
        const totalAsset = cashAsset + stockAsset + savings - debt;
        
        return (
          <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
            {formatNumber(totalAsset)}
          </td>
        );
      })()}
      {(() => {
        if (accountType === "card") {
          // 카드계좌: 전체 부채, 월 부채만 표시
          const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0, monthly: 0 };
          return (
            <>
              <td className={`number ${debtInfo.total >= 0 ? "negative" : "positive"}`}>
                {formatNumber(debtInfo.total)}
              </td>
              <td className={`number ${debtInfo.monthly >= 0 ? "negative" : "positive"}`}>
                {formatNumber(debtInfo.monthly)}
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
            <th>종류</th>
            {type === "securities" ? (
              <>
                <th>주식</th>
                <th>현금</th>
                <th>총액</th>
              </>
            ) : type === "card" ? (
              <>
                <th>전체 부채</th>
                <th>월 부채</th>
              </>
            ) : (
              <th>보유 금액</th>
            )}
            <th>작업</th>
          </tr>
        </thead>
              <tbody>
                {accountsOfType.map((row) => renderAccountRow(row, 0, type))}
              </tbody>
            </table>
          </div>
        );
      })}

      {accounts.length === 0 && <p>아직 계좌가 없습니다. 새 계좌를 추가해 보세요.</p>}

      {/* 금액 조정 모달 */}
      {adjustingAccount && (() => {
        const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
        if (!account) return null;

        // 현재 조정된 총액 계산
        let currentAdjustment = 0;
        let initialValue = 0;
        if (adjustingAccount.type === "card") {
          initialValue = 0; // 부채는 초기값이 0
          currentAdjustment = account.debt ?? 0;
        } else if (adjustingAccount.type === "securities") {
          initialValue = account.initialCashBalance ?? account.initialBalance ?? 0;
          currentAdjustment = (account.cashAdjustment ?? 0) + (account.initialCashBalance ?? account.initialBalance ?? 0) - initialValue;
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
                      return `${label} - 현금 조정`;
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
                  }}
                  style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                {/* 조정 내역 표시 */}
                <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                    {adjustingAccount.type === "card" ? "현재 부채" : adjustingAccount.type === "securities" ? "현재 현금 조정액" : "현재 보유금액 조정액"}
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                    {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)} 원
                  </div>
                </div>

                {/* 새 금액 입력 */}
                <label>
                  <span>
                    {adjustingAccount.type === "card"
                      ? "추가할 부채 금액 (음수 입력 시 차감)"
                      : adjustingAccount.type === "securities"
                      ? "추가할 현금 금액 (음수 입력 시 차감)"
                      : "추가할 보유금액 (음수 입력 시 차감)"}
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
                        setAdjustValue(""); // 입력 필드 초기화
                      } else if (e.key === "Escape") {
                        setAdjustingAccount(null);
                        setAdjustValue("");
                      }
                    }}
                  />
                </label>
                <div className="form-actions" style={{ marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustingAccount(null);
                      setAdjustValue("");
                    }}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      handleAdjustBalance();
                      setAdjustValue(""); // 입력 필드 초기화하여 계속 추가 가능하게
                    }}
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
});

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
