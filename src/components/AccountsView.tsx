import React, { useMemo, useState } from "react";
import type { Account, AccountType } from "../types";
import type { AccountBalanceRow, PositionRow } from "../calculations";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  positions: PositionRow[];
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
  onChangeAccounts,
  onRenameAccountId
}) => {
  const safeAccounts = accounts ?? [];
  const safeBalances = balances ?? [];
  const safePositions = positions ?? [];
  const [showForm, setShowForm] = useState(false);
  const [editingNumber, setEditingNumber] = useState<{
    id: string;
    field: "initialBalance" | "debt" | "savings";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: "id" | "name" | "institution" | "type";
  } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleAddAccount = (account: Account) => {
    onChangeAccounts([...safeAccounts, account]);
    setShowForm(false);
  };

  const handleDeleteAccount = (id: string) => {
    if (confirm("정말 이 계좌를 삭제하시겠습니까? 관련된 거래 내역은 유지됩니다.")) {
      onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
    }
  };

  const startEditNumber = (
    accountId: string,
    field: "initialBalance" | "debt" | "savings",
    currentValue: number
  ) => {
    setEditingNumber({ id: accountId, field });
    setEditValue(String(currentValue));
  };

  const saveNumber = () => {
    if (!editingNumber) return;
    const value = Number(editValue.replace(/,/g, "")) || 0;
    const updated = accounts.map((a) =>
      a.id === editingNumber.id ? { ...a, [editingNumber.field]: value } : a
    );
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
      map.set(p.accountId, (map.get(p.accountId) ?? 0) + p.marketValue);
    });
    return map;
  }, [safePositions]);

  const formatNumber = (n?: number) => Math.round(n ?? 0).toLocaleString();

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

  const renderAccountRow = (row: typeof safeBalances[0], index: number) => (
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
      {["initialBalance", "debt", "savings"].map((field) => {
        const value =
          field === "initialBalance"
            ? row.account.initialBalance
            : field === "debt"
              ? row.account.debt ?? 0
              : row.account.savings ?? 0;
        const isEditing =
          editingNumber &&
          editingNumber.id === row.account.id &&
          editingNumber.field === field;
        return (
          <td className="number" key={`${row.account.id}-${field}`}>
            {isEditing ? (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveNumber();
                    } else if (e.key === "Escape") {
                      cancelEditNumber();
                    }
                  }}
                  onBlur={saveNumber}
                  autoFocus
                  style={{ width: "120px", padding: "4px 8px" }}
                />
                <button
                  type="button"
                  onClick={saveNumber}
                  style={{ padding: "2px 8px", fontSize: "12px" }}
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={cancelEditNumber}
                  style={{ padding: "2px 8px", fontSize: "12px" }}
                >
                  취소
                </button>
              </div>
            ) : (
              <span
                onDoubleClick={() =>
                  startEditNumber(
                    row.account.id,
                    field as "initialBalance" | "debt" | "savings",
                    value
                  )
                }
                style={{
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted"
                }}
                title="더블클릭하여 수정"
              >
                {formatNumber(value)}
              </span>
            )}
          </td>
        );
      })}
      {(() => {
        const cashAsset = row.currentBalance;
        const stockAsset = stockMap.get(row.account.id) ?? 0;
        const debt = row.account.debt ?? 0;
        const savings = row.account.savings ?? 0;
        const totalAsset = cashAsset + stockAsset + savings - debt;
        return (
          <>
            <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
              {formatNumber(cashAsset)}
            </td>
            <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
              {formatNumber(stockAsset)}
            </td>
            <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
              {formatNumber(totalAsset)}
            </td>
          </>
        );
      })()}
      <td>
        <button type="button" className="danger" onClick={() => handleDeleteAccount(row.account.id)}>
          삭제
        </button>
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
            <th>초기잔액</th>
            <th>부채</th>
            <th>적금</th>
            <th>현금자산</th>
            <th>주식자산</th>
            <th>총자산</th>
            <th>작업</th>
          </tr>
        </thead>
              <tbody>
                {accountsOfType.map((row) => renderAccountRow(row, 0))}
              </tbody>
            </table>
          </div>
        );
      })}

      {accounts.length === 0 && <p>아직 계좌가 없습니다. 새 계좌를 추가해 보세요.</p>}
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
    const account: Account = {
      id: form.id.trim(),
      name: form.name.trim(),
      institution: form.institution.trim() || "",
      type: form.type,
      initialBalance: amount,
      debt,
      savings,
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
