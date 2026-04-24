import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import type { Account, BudgetGoal, CategoryPresets, RecurringExpense, Recurrence, LedgerEntry } from "../types";
import { BUDGET_ALL_CATEGORY } from "../types";
import { parseIsoLocal, formatIsoLocal, getTodayKST } from "../utils/date";
import { newIdWithPrefix } from "../utils/id";

interface Props {
  accounts: Account[];
  recurring: RecurringExpense[];
  budgets: BudgetGoal[];
  categoryPresets: CategoryPresets;
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
  categoryPresets,
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
  const [previewEntries, setPreviewEntries] = useState<LedgerEntry[] | null>(null);
  // KST 기준 현재 월 (UTC 자정 직전 일/월 경계 오차 방지)
  const currentMonth = getTodayKST().slice(0, 7); // yyyy-mm

  const formatNextRun = (item: RecurringExpense): string => {
    const start = item.startDate || "";
    if (!start) return "-";
    const d = parseIsoLocal(start);
    if (!d) return start;
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

  const generateRecurringEntries = () => {
    const activeRecurring = recurring.filter((r) => {
      if (!r.startDate) return false;
      if (r.endDate && r.endDate < `${currentMonth}-01`) return false;
      return true;
    });

    const toCreate: LedgerEntry[] = [];
    for (const rec of activeRecurring) {
      const alreadyExists = ledger.some(
        (l) =>
          l.date?.startsWith(currentMonth) &&
          l.category === rec.category &&
          Math.abs(l.amount - rec.amount) < 100
      );
      if (!alreadyExists) {
        toCreate.push({
          id: `REC-${rec.id}-${currentMonth}`,
          date: `${currentMonth}-01`,
          kind: rec.toAccountId ? "transfer" : "expense",
          category: rec.category || defaultExpenseCategory,
          subCategory: rec.title,
          description: `[반복] ${rec.title}`,
          amount: rec.amount,
          fromAccountId: rec.fromAccountId,
          toAccountId: rec.toAccountId,
          isFixedExpense: true
        });
      }
    }

    if (toCreate.length === 0) {
      toast.error("이번 달에 생성할 새 반복 지출 항목이 없습니다 (이미 모두 반영됨).");
      return;
    }

    setPreviewEntries(toCreate);
  };

  const confirmGenerateEntries = () => {
    if (!previewEntries || previewEntries.length === 0) return;
    onChangeLedger([...previewEntries, ...ledger]);
    toast.success(`${previewEntries.length}건의 반복 지출이 가계부에 추가되었습니다.`);
    setPreviewEntries(null);
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
      toast.error(ERROR_MESSAGES.BUDGET_ALREADY_APPLIED);
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

  // 프리셋 지출 대분류 중 첫 항목 (반복 반영 시 카테고리 비었을 때 사용, 버튼 필터에 잡히도록)
  const defaultExpenseCategory = useMemo(() => {
    const list = categoryPresets?.expense;
    if (!list || list.length === 0) return "(고정지출)";
    const exceptRecheck = list.filter((c) => c !== "재테크");
    return exceptRecheck[0] ?? list[0] ?? "(고정지출)";
  }, [categoryPresets?.expense]);

  const generateOccurrencesForMonthFromRecurring = (recurringList: RecurringExpense[], month: string): LedgerEntry[] => {
    const [y, m] = month.split("-").map(Number);
    // 모두 로컬 Date — toISOString()으로 직렬화하면 UTC로 바뀌어 1일 어긋날 수 있음
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const entries: LedgerEntry[] = [];

    for (const r of recurringList) {
      if (!r.startDate || !r.startDate.trim()) continue;
      const start = parseIsoLocal(r.startDate);
      if (!start) continue;
      const endParsed = r.endDate ? parseIsoLocal(r.endDate) : null;
      if (endParsed && endParsed < monthStart) continue;

      const pushIfInMonth = (date: Date) => {
        if (date >= monthStart && date <= monthEnd) {
          const category =
            (r.category && r.category.trim()) ||
            (r.toAccountId ? "저축성지출" : defaultExpenseCategory);
          entries.push({
            id: newIdWithPrefix("L"),
            date: formatIsoLocal(date), // UTC가 아닌 로컬 yyyy-mm-dd
            kind: r.toAccountId ? "transfer" : "expense",
            category,
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
      const isTotal = b.category === BUDGET_ALL_CATEGORY;
      const excludeSet = new Set(b.excludeCategories ?? []);
      let spent = 0;
      for (const l of ledger) {
        if (l.kind !== "expense") continue;
        if (!l.date?.startsWith(currentMonth)) continue;
        if (isTotal) {
          if (excludeSet.has(l.category)) continue;
          spent += l.amount;
        } else {
          if (l.category === b.category) spent += l.amount;
        }
      }
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
            <select
              value={budForm.category}
              onChange={(e) => {
                const next = e.target.value;
                setBudForm((prev) => ({
                  ...prev,
                  category: next,
                  // 개별 카테고리 모드로 바뀌면 제외 목록 비움
                  excludeCategories: next === BUDGET_ALL_CATEGORY ? (prev.excludeCategories ?? []) : undefined,
                }));
              }}
              style={{ width: "100%" }}
            >
              <option value="">선택하세요</option>
              <option value={BUDGET_ALL_CATEGORY}>⭐ 전체 (제외 카테고리 지정)</option>
              {(categoryPresets?.expense ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          {budForm.category === BUDGET_ALL_CATEGORY && (
            <label className="wide">
              <span>제외 카테고리</span>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg)",
                }}
              >
                {(categoryPresets?.expense ?? []).length === 0 && (
                  <span className="hint">지출 카테고리 프리셋이 비어 있습니다.</span>
                )}
                {(categoryPresets?.expense ?? []).map((c) => {
                  const checked = (budForm.excludeCategories ?? []).includes(c);
                  return (
                    <label
                      key={c}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 10px",
                        borderRadius: 14,
                        fontSize: 13,
                        cursor: "pointer",
                        border: "1px solid var(--border)",
                        background: checked ? "var(--primary-light)" : "var(--surface)",
                        color: checked ? "var(--primary)" : "var(--text)",
                        fontWeight: checked ? 600 : 400,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const set = new Set(budForm.excludeCategories ?? []);
                          if (e.target.checked) set.add(c);
                          else set.delete(c);
                          setBudForm({ ...budForm, excludeCategories: [...set] });
                        }}
                        style={{ margin: 0 }}
                      />
                      {c}
                    </label>
                  );
                })}
              </div>
              <span className="hint" style={{ display: "block", marginTop: 4, fontSize: 11 }}>
                체크한 카테고리의 지출은 이 예산 집계에서 제외됩니다. 예: 데이트비·재테크 제외 월 60만원.
              </span>
            </label>
          )}
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>고정 지출/구독 목록</h3>
        <button type="button" className="primary" onClick={generateRecurringEntries}>
          이번 달 반복 지출 생성
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
        각 셀을 더블클릭하여 수정할 수 있습니다.
      </p>

      {previewEntries && (
        <div
          style={{
            background: "var(--card-bg, #1e1e2e)",
            border: "1px solid var(--border, #2e2e3e)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12
          }}
        >
          <strong>생성 예정 항목 ({previewEntries.length}건)</strong>
          <ul style={{ margin: "8px 0", paddingLeft: 20, fontSize: 14 }}>
            {previewEntries.map((e) => (
              <li key={e.id}>
                {e.description} — {e.amount.toLocaleString()}원 ({e.category})
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="secondary" onClick={() => setPreviewEntries(null)}>
              취소
            </button>
            <button type="button" className="primary" onClick={confirmGenerateEntries}>
              확인 ({previewEntries.length}건 추가)
            </button>
          </div>
        </div>
      )}
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

      {/* ── Budget Visual Dashboard ── */}
      {(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-based
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysRemaining = daysInMonth - dayOfMonth;

        const totalSpent = budgetUsage.reduce((s, b) => s + b.spent, 0);
        const totalLimit = budgetUsage.reduce((s, b) => s + b.monthlyLimit, 0);
        const overallPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;
        const overallBarColor =
          overallPct >= 100 ? "#f43f5e" : overallPct >= 80 ? "#f59e0b" : "#22c55e";

        const cardColors = [
          "#6366f1", "#22c55e", "#f59e0b", "#f43f5e", "#3b82f6",
          "#a855f7", "#14b8a6", "#fb923c", "#e879f9", "#38bdf8",
        ];

        return (
          <div style={{ marginTop: 24, marginBottom: 8 }}>
            {/* Overall summary card */}
            <div
              style={{
                background: "var(--card-bg, #1e1e2e)",
                border: "1px solid var(--border, #2e2e3e)",
                borderRadius: 10,
                padding: "18px 20px",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 10,
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  이번 달 전체 예산
                </span>
                <span style={{ fontSize: 13, color: "var(--text-muted, #888)" }}>
                  {daysRemaining}일 남음 ({dayOfMonth}/{daysInMonth}일차)
                </span>
              </div>

              {/* Progress bar */}
              <div
                style={{
                  background: "var(--border, #2e2e3e)",
                  borderRadius: 6,
                  height: 12,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, overallPct)}%`,
                    height: "100%",
                    background: overallBarColor,
                    borderRadius: 6,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 14,
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <span>
                  총 예산{" "}
                  <strong>{totalLimit.toLocaleString()}원</strong> 중{" "}
                  <strong style={{ color: overallBarColor }}>
                    {totalSpent.toLocaleString()}원
                  </strong>{" "}
                  사용{" "}
                  <span
                    style={{
                      color: overallBarColor,
                      fontWeight: 700,
                    }}
                  >
                    ({overallPct.toFixed(1)}%)
                  </span>
                </span>
                <span style={{ color: "var(--text-muted, #888)", fontSize: 13 }}>
                  잔여{" "}
                  <strong style={{ color: totalLimit - totalSpent >= 0 ? "#22c55e" : "#f43f5e" }}>
                    {(totalLimit - totalSpent).toLocaleString()}원
                  </strong>
                </span>
              </div>
            </div>

            {/* Category cards grid */}
            {budgetUsage.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                {budgetUsage.map((b, idx) => {
                  const catPct =
                    b.monthlyLimit > 0
                      ? (b.spent / b.monthlyLimit) * 100
                      : 0;
                  const isOver = b.spent > b.monthlyLimit && b.monthlyLimit > 0;
                  const barColor =
                    catPct >= 100 ? "#f43f5e" : catPct >= 80 ? "#f59e0b" : "#22c55e";
                  const accentColor = cardColors[idx % cardColors.length];

                  // Pace: expected spend by today vs actual
                  const expectedSpend =
                    b.monthlyLimit > 0
                      ? (dayOfMonth / daysInMonth) * b.monthlyLimit
                      : 0;
                  const isAhead = b.spent > expectedSpend;

                  return (
                    <div
                      key={b.id}
                      style={{
                        background: isOver
                          ? "rgba(244, 63, 94, 0.07)"
                          : "var(--card-bg, #1e1e2e)",
                        border: "1px solid var(--border, #2e2e3e)",
                        borderLeft: `4px solid ${accentColor}`,
                        borderRadius: 8,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {/* Header row */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: accentColor,
                          }}
                          title={
                            b.category === BUDGET_ALL_CATEGORY && (b.excludeCategories ?? []).length > 0
                              ? `제외: ${(b.excludeCategories ?? []).join(", ")}`
                              : undefined
                          }
                        >
                          {b.category === BUDGET_ALL_CATEGORY
                            ? `전체${(b.excludeCategories ?? []).length > 0 ? ` (− ${(b.excludeCategories ?? []).join(", ")})` : ""}`
                            : (b.category || "(미분류)")}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: isAhead ? "#f43f5e" : "#22c55e",
                            background: isAhead
                              ? "rgba(244, 63, 94, 0.12)"
                              : "rgba(34, 197, 94, 0.12)",
                            borderRadius: 20,
                            padding: "2px 8px",
                          }}
                        >
                          {isAhead ? "속도 초과" : "순조로움"}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div
                          style={{
                            background: "var(--border, #2e2e3e)",
                            borderRadius: 5,
                            height: 10,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, catPct)}%`,
                              height: "100%",
                              background: barColor,
                              borderRadius: 5,
                              transition: "width 0.4s ease",
                            }}
                          />
                        </div>
                      </div>

                      {/* Amounts row */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 13,
                          flexWrap: "wrap",
                          gap: 4,
                        }}
                      >
                        <span>
                          <span style={{ color: barColor, fontWeight: 600 }}>
                            {b.spent.toLocaleString()}
                          </span>
                          <span style={{ color: "var(--text-muted, #888)" }}>
                            {" "}/ {b.monthlyLimit.toLocaleString()}원
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color:
                              b.remain >= 0 ? "var(--text-muted, #888)" : "#f43f5e",
                          }}
                        >
                          {b.remain >= 0
                            ? `잔여 ${b.remain.toLocaleString()}원`
                            : `초과 ${Math.abs(b.remain).toLocaleString()}원`}
                        </span>
                      </div>

                      {/* Percentage label */}
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted, #888)",
                          textAlign: "right",
                        }}
                      >
                        {catPct.toFixed(1)}% 사용
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

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
            <th>달성률</th>
            <th>메모</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {budgetUsage.map((b) => {
            const pct = b.monthlyLimit > 0 ? Math.min(100, (b.spent / b.monthlyLimit) * 100) : 0;
            const isOver = b.spent > b.monthlyLimit && b.monthlyLimit > 0;
            return (
            <tr key={b.id} style={isOver ? { backgroundColor: "var(--danger-light, rgba(244, 63, 94, 0.08))" } : undefined}>
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
                {isOver && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, background: "var(--danger)", color: "white", padding: "2px 6px", borderRadius: 4 }}>
                    초과
                  </span>
                )}
              </td>
              <td style={{ minWidth: 120 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      background: "var(--surface-hover)",
                      borderRadius: 4,
                      overflow: "hidden"
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        height: "100%",
                        background: isOver ? "var(--danger)" : pct >= 90 ? "var(--warning)" : "var(--primary)",
                        borderRadius: 4,
                        transition: "width 0.2s"
                      }}
                    />
                  </div>
                  <span className="number" style={{ fontSize: 12, minWidth: 36 }}>
                    {b.monthlyLimit > 0 ? `${pct.toFixed(0)}%` : "-"}
                  </span>
                </div>
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
            );
          })}
          {budgets.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center" }}>
                설정된 예산이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
