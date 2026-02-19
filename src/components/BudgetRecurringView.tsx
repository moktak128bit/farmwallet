import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, BudgetGoal, RecurringExpense, Recurrence, LedgerEntry } from "../types";

interface Props {
  accounts: Account[];
  recurring: RecurringExpense[];
  budgets: BudgetGoal[];
  onChangeRecurring: (next: RecurringExpense[]) => void;
  onChangeBudgets: (next: BudgetGoal[]) => void;
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
}

const freqLabel: Record<Recurrence, string> = {
  monthly: "매월",
  weekly: "매주",
  yearly: "매년"
};

const createRecurring = (): RecurringExpense => ({
  id: `R${Date.now()}`,
  title: "",
  amount: 0,
  category: "",
  frequency: "monthly",
  startDate: new Date().toISOString().slice(0, 10),
  fromAccountId: undefined,
  toAccountId: undefined
});

const createBudget = (): BudgetGoal => ({
  id: `B${Date.now()}`,
  category: "",
  monthlyLimit: 0,
  note: ""
});

export const BudgetRecurringView: React.FC<Props> = ({
  accounts,
  recurring,
  budgets,
  onChangeRecurring,
  onChangeBudgets,
  ledger,
  onChangeLedger
}) => {
  const [recForm, setRecForm] = useState<RecurringExpense>(createRecurring);
  const [budForm, setBudForm] = useState<BudgetGoal>(createBudget);
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [editingBudgetField, setEditingBudgetField] = useState<{ id: string; field: string } | null>(null);
  const [editingBudgetValue, setEditingBudgetValue] = useState<string>("");
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set());
  const currentMonth = new Date().toISOString().slice(0, 7); // yyyy-mm

  const formatNextRun = (item: RecurringExpense): string => {
    const start = item.startDate || "";
    if (!start) return "-";
    const d = new Date(start);
    if (isNaN(d.getTime())) return start;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    if (item.frequency === "monthly") return `${day}일`;
    if (item.frequency === "yearly") return `${month}월 ${day}일`;
    return start; // 매주: 전체 날짜
  };

  const totalBudget = useMemo(
    () => budgets.reduce((s, b) => s + (b.monthlyLimit || 0), 0),
    [budgets]
  );

  const addRecurring = () => {
    if (!recForm.title || !recForm.amount) return;
    if (editingRecurringId) {
      // 수정 모드
      onChangeRecurring(recurring.map((r) => (r.id === editingRecurringId ? recForm : r)));
      setEditingRecurringId(null);
    } else {
      // 추가 모드
      onChangeRecurring([recForm, ...recurring]);
    }
    setRecForm(createRecurring());
  };

  const editRecurring = (item: RecurringExpense) => {
    setRecForm(item);
    setEditingRecurringId(item.id);
  };

  const cancelEdit = () => {
    setRecForm(createRecurring());
    setEditingRecurringId(null);
  };

  const deleteRecurring = (id: string) => {
    onChangeRecurring(recurring.filter((r) => r.id !== id));
    if (editingRecurringId === id) {
      setEditingRecurringId(null);
      setRecForm(createRecurring());
    }
    if (editingField?.id === id) {
      setEditingField(null);
    }
  };

  const startEditField = (id: string, field: string, currentValue: string | number) => {
    setEditingField({ id, field });
    setEditingValue(String(currentValue));
  };

  const saveEditField = () => {
    if (!editingField) return;
    const { id, field } = editingField;
    const item = recurring.find((r) => r.id === id);
    if (!item) return;

    const updated = { ...item };
    if (field === "title") {
      updated.title = editingValue;
    } else if (field === "amount") {
      updated.amount = Number(editingValue) || 0;
    } else if (field === "category") {
      updated.category = editingValue;
    } else if (field === "frequency") {
      updated.frequency = editingValue as Recurrence;
    } else if (field === "startDate") {
      updated.startDate = editingValue;
    } else if (field === "endDate") {
      updated.endDate = editingValue || undefined;
    } else if (field === "fromAccountId") {
      updated.fromAccountId = editingValue || undefined;
    } else if (field === "toAccountId") {
      updated.toAccountId = editingValue || undefined;
    }

    onChangeRecurring(recurring.map((r) => (r.id === id ? updated : r)));
    setEditingField(null);
    setEditingValue("");
  };

  const cancelEditField = () => {
    setEditingField(null);
    setEditingValue("");
  };

  const addBudget = () => {
    if (!budForm.category || !budForm.monthlyLimit) return;
    onChangeBudgets([budForm, ...budgets]);
    setBudForm(createBudget());
  };

  const deleteBudget = (id: string) => {
    onChangeBudgets(budgets.filter((b) => b.id !== id));
  };

  const startEditBudgetField = (id: string, field: string, currentValue: string | number) => {
    setEditingBudgetField({ id, field });
    setEditingBudgetValue(String(currentValue));
  };

  const saveEditBudgetField = () => {
    if (!editingBudgetField) return;
    const { id, field } = editingBudgetField;
    const item = budgets.find((b) => b.id === id);
    if (!item) return;

    const updated = { ...item };
    if (field === "category") {
      updated.category = editingBudgetValue;
    } else if (field === "monthlyLimit") {
      updated.monthlyLimit = Number(editingBudgetValue) || 0;
    } else if (field === "note") {
      updated.note = editingBudgetValue || undefined;
    }

    onChangeBudgets(budgets.map((b) => (b.id === id ? updated : b)));
    setEditingBudgetField(null);
    setEditingBudgetValue("");
  };

  const cancelEditBudgetField = () => {
    setEditingBudgetField(null);
    setEditingBudgetValue("");
  };

  const handleApplyCurrentMonth = () => {
    const selectedRecurring = recurring.filter((r) => selectedRecurringIds.has(r.id));
    if (selectedRecurring.length === 0) {
      alert("반영할 항목을 선택해주세요.");
      return;
    }

    const occurrences = generateOccurrencesForMonthFromRecurring(selectedRecurring, currentMonth);
    const deduped = filterDuplicateOccurrences(occurrences, ledger, currentMonth);
    if (deduped.length === 0) {
      toast.error("해당 월에 이미 반영된 항목만 선택되었습니다. 새로운 항목을 선택해주세요.");
      return;
    }
    onChangeLedger([...deduped, ...ledger]);
    setSelectedRecurringIds(new Set());
    const skipped = occurrences.length - deduped.length;
    toast.success(
      skipped > 0
        ? `${deduped.length}건 반영됨 (중복 ${skipped}건 제외)`
        : `${deduped.length}건 가계부에 반영되었습니다.`
    );
  };

  const filterDuplicateOccurrences = (
    occurrences: LedgerEntry[],
    existingLedger: LedgerEntry[],
    month: string
  ): LedgerEntry[] => {
    const monthLedger = existingLedger.filter((l) => l.date?.startsWith(month));
    return occurrences.filter((occ) => {
      const dup = monthLedger.some(
        (l) =>
          l.date === occ.date &&
          l.category === occ.category &&
          l.subCategory === occ.subCategory &&
          l.amount === occ.amount &&
          l.fromAccountId === occ.fromAccountId &&
          l.toAccountId === occ.toAccountId
      );
      return !dup;
    });
  };

  const generateOccurrencesForMonthFromRecurring = (recurringList: RecurringExpense[], month: string): LedgerEntry[] => {
    const [y, m] = month.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const entries: LedgerEntry[] = [];

    for (const r of recurringList) {
      if (!r.startDate || !r.startDate.trim()) continue;
      const start = new Date(r.startDate);
      if (isNaN(start.getTime())) continue;
      if (r.endDate && new Date(r.endDate) < monthStart) continue;

      const pushIfInMonth = (date: Date) => {
        if (date >= monthStart && date <= monthEnd) {
          entries.push({
            id: `L${Date.now()}${Math.random().toString(16).slice(2)}`,
            date: date.toISOString().slice(0, 10),
            kind: r.toAccountId ? "transfer" : "expense",
            category: r.category || (r.toAccountId ? "저축성지출" : "(고정지출)"),
            subCategory: r.title,
            description: r.title,
            amount: r.amount,
            fromAccountId: r.fromAccountId,
            toAccountId: r.toAccountId,
            isFixedExpense: true // LedgerView 이전 달→현재 달 자동 복사에 사용
          });
        }
      };

      if (r.frequency === "monthly") {
        const day = start.getDate();
        if (day >= 1 && day <= 31) {
          const target = new Date(y, m - 1, Math.min(day, new Date(y, m, 0).getDate()));
          pushIfInMonth(target);
        }
      } else if (r.frequency === "yearly") {
        if (start.getMonth() + 1 === m) {
          const target = new Date(y, m - 1, start.getDate());
          pushIfInMonth(target);
        }
      } else if (r.frequency === "weekly") {
        const cursor = new Date(start);
        while (cursor <= monthEnd) {
          if (cursor >= monthStart) pushIfInMonth(new Date(cursor));
          cursor.setDate(cursor.getDate() + 7);
        }
      }
    }
    return entries;
  };

  const budgetUsage = useMemo(() => {
    return budgets.map((b) => {
      const spent = ledger
        .filter((l) => l.kind === "expense" && l.category === b.category && l.date.startsWith(currentMonth))
        .reduce((s, l) => s + l.amount, 0);
      const remain = b.monthlyLimit - spent;
      return { ...b, spent, remain };
    });
  }, [budgets, ledger, currentMonth]);

  return (
    <div>
      <div className="section-header">
        <h2>예산 / 반복 지출</h2>
      </div>

      <div className="two-column">
        <div className="card form-grid">
          <h3>{editingRecurringId ? "고정 지출/구독 수정" : "고정 지출/구독 추가"}</h3>
          <label>
            <span>제목</span>
            <input
              value={recForm.title}
              onChange={(e) => setRecForm({ ...recForm, title: e.target.value })}
              placeholder="예: 넷플릭스"
            />
          </label>
          <label>
            <span>금액</span>
            <input
              type="number"
              value={recForm.amount || ""}
              onChange={(e) => setRecForm({ ...recForm, amount: Number(e.target.value) || 0 })}
              placeholder="17000"
            />
          </label>
          <label>
            <span>카테고리</span>
            <input
              value={recForm.category}
              onChange={(e) => setRecForm({ ...recForm, category: e.target.value })}
              placeholder="구독비"
            />
          </label>
          <label>
            <span>주기</span>
            <select
              value={recForm.frequency}
              onChange={(e) => setRecForm({ ...recForm, frequency: e.target.value as Recurrence })}
            >
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
              <option value="yearly">매년</option>
            </select>
          </label>
          <label>
            <span>시작일</span>
            <input
              type="date"
              value={recForm.startDate}
              onChange={(e) => setRecForm({ ...recForm, startDate: e.target.value })}
            />
          </label>
          <label>
            <span>출금 계좌</span>
            <select
              value={recForm.fromAccountId || ""}
              onChange={(e) => setRecForm({ ...recForm, fromAccountId: e.target.value || undefined })}
            >
              <option value="">선택</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.id} - {acc.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>입금 계좌 (저축성지출/이체용)</span>
            <select
              value={recForm.toAccountId || ""}
              onChange={(e) => setRecForm({ ...recForm, toAccountId: e.target.value || undefined })}
            >
              <option value="">선택</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.id} - {acc.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            {editingRecurringId && (
              <button type="button" className="secondary" onClick={cancelEdit}>
                취소
              </button>
            )}
            <button type="button" className="primary" onClick={addRecurring}>
              {editingRecurringId ? "수정" : "추가"}
            </button>
          </div>
        </div>

        <div className="card form-grid">
          <h3>예산/목표 추가</h3>
          <label>
            <span>카테고리</span>
            <input
              value={budForm.category}
              onChange={(e) => setBudForm({ ...budForm, category: e.target.value })}
              placeholder="식비"
            />
          </label>
          <label>
            <span>월 예산</span>
            <input
              type="number"
              value={budForm.monthlyLimit || ""}
              onChange={(e) => setBudForm({ ...budForm, monthlyLimit: Number(e.target.value) || 0 })}
              placeholder="400000"
            />
          </label>
          <label className="wide">
            <span>메모</span>
            <input value={budForm.note} onChange={(e) => setBudForm({ ...budForm, note: e.target.value })} />
          </label>
          <div className="form-actions">
            <span className="hint">총 예산: {Math.round(totalBudget).toLocaleString()} 원</span>
            <button type="button" className="primary" onClick={addBudget}>
              추가
            </button>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>고정 지출/구독 목록</h3>
      <p className="hint" style={{ marginTop: -8, marginBottom: 8 }}>
        각 셀을 더블클릭하여 수정할 수 있습니다.
      </p>
      <div style={{ overflowX: "auto" }}>
      <table className="data-table recurring-table">
        <colgroup>
          <col style={{ width: 40 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 70 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ width: "40px" }}>
              <input
                type="checkbox"
                checked={recurring.length > 0 && selectedRecurringIds.size === recurring.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedRecurringIds(new Set(recurring.map((r) => r.id)));
                  } else {
                    setSelectedRecurringIds(new Set());
                  }
                }}
                title="전체 선택/해제"
              />
            </th>
            <th>제목</th>
            <th>금액</th>
            <th>카테고리</th>
            <th>주기</th>
            <th>출금 계좌</th>
            <th>입금 계좌</th>
            <th>다음 예정</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {recurring.map((r) => (
            <tr key={r.id}>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={selectedRecurringIds.has(r.id)}
                  onChange={(e) => {
                    const newSet = new Set(selectedRecurringIds);
                    if (e.target.checked) {
                      newSet.add(r.id);
                    } else {
                      newSet.delete(r.id);
                    }
                    setSelectedRecurringIds(newSet);
                  }}
                />
              </td>
              <td
                onDoubleClick={() => startEditField(r.id, "title", r.title)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "title" ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  r.title
                )}
              </td>
              <td
                className="number"
                onDoubleClick={() => startEditField(r.id, "amount", r.amount)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "amount" ? (
                  <input
                    type="number"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  `${Math.round(r.amount).toLocaleString()} 원`
                )}
              </td>
              <td
                onDoubleClick={() => startEditField(r.id, "category", r.category)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "category" ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  r.category
                )}
              </td>
              <td
                onDoubleClick={() => startEditField(r.id, "frequency", r.frequency)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "frequency" ? (
                  <select
                    value={editingValue}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      const item = recurring.find((r) => r.id === editingField.id);
                      if (item) {
                        const updated = { ...item, frequency: newValue as Recurrence };
                        onChangeRecurring(recurring.map((r) => (r.id === editingField.id ? updated : r)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  >
                    <option value="weekly">매주</option>
                    <option value="monthly">매월</option>
                    <option value="yearly">매년</option>
                  </select>
                ) : (
                  freqLabel[r.frequency]
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(r.id, "fromAccountId", r.fromAccountId || "");
                }}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "fromAccountId" ? (
                  <select
                    value={editingValue}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      const item = recurring.find((r) => r.id === editingField.id);
                      if (item) {
                        const updated = { ...item, fromAccountId: newValue || undefined };
                        onChangeRecurring(recurring.map((r) => (r.id === editingField.id ? updated : r)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  r.fromAccountId ? accounts.find((a) => a.id === r.fromAccountId)?.name ?? "-" : "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(r.id, "toAccountId", r.toAccountId || "");
                }}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "toAccountId" ? (
                  <select
                    value={editingValue}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      const item = recurring.find((r) => r.id === editingField.id);
                      if (item) {
                        const updated = { ...item, toAccountId: newValue || undefined };
                        onChangeRecurring(recurring.map((r) => (r.id === editingField.id ? updated : r)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  r.toAccountId ? accounts.find((a) => a.id === r.toAccountId)?.name ?? "-" : "-"
                )}
              </td>
              <td
                onDoubleClick={() => startEditField(r.id, "startDate", r.startDate)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === r.id && editingField.field === "startDate" ? (
                  <input
                    type="date"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  formatNextRun(r)
                )}
              </td>
              <td>
                <button type="button" className="danger" onClick={() => deleteRecurring(r.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {recurring.length === 0 && (
            <tr>
              <td colSpan={9} style={{ textAlign: "center" }}>
                등록된 고정 지출이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
          {selectedRecurringIds.size > 0 ? `${selectedRecurringIds.size}개 항목 선택됨` : "반영할 항목을 선택하세요"}
        </span>
        <button 
          type="button" 
          className="primary" 
          onClick={handleApplyCurrentMonth}
          disabled={selectedRecurringIds.size === 0}
          style={{ opacity: selectedRecurringIds.size === 0 ? 0.5 : 1 }}
        >
          선택한 항목 가계부에 반영 ({selectedRecurringIds.size}개)
        </button>
      </div>

      <h3 style={{ marginTop: 16 }}>예산/목표</h3>
      <p className="hint" style={{ marginTop: -8, marginBottom: 8 }}>
        카테고리, 월 예산, 메모를 더블클릭하여 수정할 수 있습니다.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>카테고리</th>
            <th>월 예산</th>
            <th>지출</th>
            <th>잔여</th>
            <th>메모</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {budgetUsage.map((b) => (
            <tr key={b.id}>
              <td
                onDoubleClick={() => startEditBudgetField(b.id, "category", b.category)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingBudgetField?.id === b.id && editingBudgetField.field === "category" ? (
                  <input
                    type="text"
                    value={editingBudgetValue}
                    onChange={(e) => setEditingBudgetValue(e.target.value)}
                    onBlur={saveEditBudgetField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditBudgetField();
                      if (e.key === "Escape") cancelEditBudgetField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  b.category
                )}
              </td>
              <td
                className="number"
                onDoubleClick={() => startEditBudgetField(b.id, "monthlyLimit", b.monthlyLimit)}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingBudgetField?.id === b.id && editingBudgetField.field === "monthlyLimit" ? (
                  <input
                    type="number"
                    value={editingBudgetValue}
                    onChange={(e) => setEditingBudgetValue(e.target.value)}
                    onBlur={saveEditBudgetField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditBudgetField();
                      if (e.key === "Escape") cancelEditBudgetField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  `${Math.round(b.monthlyLimit).toLocaleString()} 원`
                )}
              </td>
              <td className={`number ${b.remain < 0 ? "negative" : "positive"}`}>
                {Math.round(b.spent).toLocaleString()} 원
              </td>
              <td className={`number ${b.remain < 0 ? "negative" : "positive"}`}>
                {Math.round(b.remain).toLocaleString()} 원
              </td>
              <td
                onDoubleClick={() => startEditBudgetField(b.id, "note", b.note || "")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingBudgetField?.id === b.id && editingBudgetField.field === "note" ? (
                  <input
                    type="text"
                    value={editingBudgetValue}
                    onChange={(e) => setEditingBudgetValue(e.target.value)}
                    onBlur={saveEditBudgetField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditBudgetField();
                      if (e.key === "Escape") cancelEditBudgetField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  b.note || "-"
                )}
              </td>
              <td>
                <button type="button" className="danger" onClick={() => deleteBudget(b.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {budgets.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                설정된 예산이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
