/**
 * 고정 지출/구독 목록 — 더블클릭 인라인 셀 편집 + 체크박스 선택 + "이번 달 반복 지출 생성"
 * 미리보기 패널 + "선택한 항목 가계부에 반영" 액션.
 * BudgetRecurringView에서 분리 — 인라인 편집(editingField/editingValue), 선택(selectedRecurringIds),
 * 생성 미리보기(previewEntries) 상태를 이 컴포넌트가 소유해 셀 편집 타이핑이 부모를 재렌더하지 않는다.
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *   - onRecurringDeleted: 항목 삭제 시 부모 경유로 RecurringFormCard 수정 모드를 해제하는 ref 브리지
 */
import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import type { Account, CategoryPresets, LedgerEntry, Recurrence, RecurringExpense } from "../../types";
import { parseIsoLocal, formatIsoLocal } from "../../utils/date";
import { newIdWithPrefix } from "../../utils/id";
import { isCoarsePointer } from "../../utils/pointer";

const freqLabel: Record<Recurrence, string> = {
  monthly: "매월",
  weekly: "매주",
  yearly: "매년"
};

interface Props {
  accounts: Account[];
  recurring: RecurringExpense[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  /** KST 기준 현재 월 (yyyy-mm) — 부모에서 계산해 내려줌 */
  currentMonth: string;
  onChangeRecurring: (next: RecurringExpense[]) => void;
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** 삭제된 항목을 폼이 수정 중이었다면 수정 모드 해제 (부모 useCallback → RecurringFormCard ref) */
  onRecurringDeleted: (id: string) => void;
}

export const RecurringListSection: React.FC<Props> = React.memo(function RecurringListSection({
  accounts,
  recurring,
  ledger,
  categoryPresets,
  currentMonth,
  onChangeRecurring,
  onChangeLedger,
  onRecurringDeleted,
}) {
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set());
  const [previewEntries, setPreviewEntries] = useState<LedgerEntry[] | null>(null);

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

  const deleteRecurring = (id: string) => {
    onChangeRecurring(recurring.filter((r) => r.id !== id));
    onRecurringDeleted(id);
    if (editingField?.id === id) {
      setEditingField(null);
    }
  };

  // 터치 환경 여부 — 렌더당 1회 평가 (coarse 포인터는 더블클릭 대신 단일 탭으로 편집 진입)
  const coarsePointer = isCoarsePointer();

  const startEditField = (id: string, field: string, currentValue: string | number) => {
    setEditingField({ id, field });
    setEditingValue(String(currentValue));
  };

  // 터치(coarse) 단일 탭 편집 진입 — 이미 해당 셀을 편집 중이면(입력 내부 탭 등) 재진입으로 입력값이 초기화되지 않게 막는다
  const tapToEditField = (id: string, field: string, currentValue: string | number) => {
    if (editingField?.id === id && editingField.field === field) return;
    startEditField(id, field, currentValue);
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

  const generateRecurringEntries = () => {
    const activeRecurring = recurring.filter((r) => {
      if (!r.startDate) return false;
      if (r.endDate && r.endDate < `${currentMonth}-01`) return false;
      return true;
    });

    const toCreate: LedgerEntry[] = [];
    for (const rec of activeRecurring) {
      // 중복 검사 — 3-level 구조 기준: sub === rec.category, det === rec.title
      const alreadyExists = ledger.some(
        (l) =>
          l.date?.startsWith(currentMonth) &&
          l.subCategory === rec.category &&
          l.detailCategory === rec.title &&
          Math.abs(l.amount - rec.amount) < 100
      );
      if (!alreadyExists) {
        const isTransfer = !!rec.toAccountId;
        const userCat = rec.category || defaultExpenseCategory;
        toCreate.push({
          id: `REC-${rec.id}-${currentMonth}`,
          date: `${currentMonth}-01`,
          kind: isTransfer ? "transfer" : "expense",
          category: isTransfer ? "이체" : "지출",
          subCategory: userCat,
          detailCategory: rec.title || undefined,
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
          // 3-level 구조로 저장:
          //   - kind = transfer(저축성지출) 또는 expense
          //   - category = "이체"/"지출" (대분류)
          //   - subCategory = r.category (예: "구독비") — 사용자가 폼에 적은 카테고리
          //   - detailCategory = r.title (예: "넷플릭스") — 구체 항목
          const userCat =
            (r.category && r.category.trim()) ||
            (r.toAccountId ? "저축성지출" : defaultExpenseCategory);
          const isTransfer = !!r.toAccountId;
          entries.push({
            id: newIdWithPrefix("L"),
            date: formatIsoLocal(date), // UTC가 아닌 로컬 yyyy-mm-dd
            kind: isTransfer ? "transfer" : "expense",
            category: isTransfer ? "이체" : "지출",
            subCategory: userCat,
            detailCategory: r.title || undefined,
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

  return (
    <>
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
                className="cell-editable"
                onDoubleClick={() => startEditField(r.id, "title", r.title)}
                onClick={coarsePointer ? () => tapToEditField(r.id, "title", r.title) : undefined}
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
                className="number cell-editable"
                onDoubleClick={() => startEditField(r.id, "amount", r.amount)}
                onClick={coarsePointer ? () => tapToEditField(r.id, "amount", r.amount) : undefined}
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
                className="cell-editable"
                onDoubleClick={() => startEditField(r.id, "category", r.category)}
                onClick={coarsePointer ? () => tapToEditField(r.id, "category", r.category) : undefined}
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
                className="cell-editable"
                onDoubleClick={() => startEditField(r.id, "frequency", r.frequency)}
                onClick={coarsePointer ? () => tapToEditField(r.id, "frequency", r.frequency) : undefined}
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
                className="cell-editable"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(r.id, "fromAccountId", r.fromAccountId || "");
                }}
                onClick={coarsePointer ? () => tapToEditField(r.id, "fromAccountId", r.fromAccountId || "") : undefined}
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
                className="cell-editable"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(r.id, "toAccountId", r.toAccountId || "");
                }}
                onClick={coarsePointer ? () => tapToEditField(r.id, "toAccountId", r.toAccountId || "") : undefined}
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
                className="cell-editable"
                onDoubleClick={() => startEditField(r.id, "startDate", r.startDate)}
                onClick={coarsePointer ? () => tapToEditField(r.id, "startDate", r.startDate) : undefined}
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
                등록된 고정 지출이 없습니다 — 위 폼에서 구독·고정 지출을 추가해 보세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {recurring.length > 0 && (
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
      )}
    </>
  );
});
