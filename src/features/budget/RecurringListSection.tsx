/**
 * 고정 지출/구독 목록 — 더블클릭 인라인 셀 편집 + 체크박스 선택 + "이번 달 반복 지출 생성"
 * 미리보기 패널 + "선택한 항목 가계부에 반영" 액션.
 * BudgetRecurringView에서 분리 — 인라인 편집(editingField/editingValue), 선택(selectedRecurringIds),
 * 생성 미리보기(previewEntries) 상태를 이 컴포넌트가 소유해 셀 편집 타이핑이 부모를 재렌더하지 않는다.
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *   - onRecurringDeleted: 항목 삭제 시 부모 경유로 RecurringFormCard 수정 모드를 해제하는 ref 브리지
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import type { Account, CategoryPresets, LedgerEntry, Recurrence, RecurringExpense } from "../../types";
import { parseIsoLocal } from "../../utils/date";
import {
  filterDuplicateOccurrences,
  generateOccurrencesForMonthFromRecurring as generateOccurrences,
  getDefaultExpenseCategory,
  type RecurringOccurrence
} from "../../utils/recurringGenerate";
import { isCoarsePointer } from "../../utils/pointer";
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";
import { useAppStore } from "../../store/appStore";

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
  /** "수정" 버튼 → 상단 폼(RecurringFormCard)을 수정 모드로 전환 (부모 useCallback → ref) */
  onRequestEdit: (item: RecurringExpense) => void;
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
  onRequestEdit,
}) {
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set());
  const [previewEntries, setPreviewEntries] = useState<LedgerEntry[] | null>(null);
  // 미리보기 생성 시점의 원본 occurrences(주기 포함) — 확인 시 현재 ledger로 재중복검사에 사용.
  // previewEntries(LedgerEntry[])만으로는 weekly/monthly 판정에 필요한 frequency가 없다.
  const previewOccurrencesRef = useRef<RecurringOccurrence[] | null>(null);

  // 반복 목록이 편집·삭제되면 열려 있던 미리보기는 stale — 무효화(구 값으로 확인 시 오생성 방지)
  useEffect(() => {
    setPreviewEntries(null);
    previewOccurrencesRef.current = null;
  }, [recurring]);

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
    const index = recurring.findIndex((r) => r.id === id);
    const item = index >= 0 ? recurring[index] : undefined;
    if (!item) return;
    // 고정 지출 영구 유실 방지 — confirm + 복원 토스트 (BudgetGoalsTable 패턴과 통일, 불변식 #8)
    if (!window.confirm(`"${item.title}" 고정 지출을 삭제하시겠습니까?`)) return;
    onChangeRecurring(recurring.filter((r) => r.id !== id));
    onRecurringDeleted(id);
    if (editingField?.id === id) {
      setEditingField(null);
    }
    showDeleteUndoToast(
      `"${item.title}" 고정 지출이 삭제되었습니다.`,
      buildRestoreById(() => useAppStore.getState().data.recurringExpenses ?? [], onChangeRecurring, item, index)
    );
  };

  // 터치 환경 여부 — 렌더당 1회 평가 (coarse 포인터는 더블클릭 대신 단일 탭으로 편집 진입)
  const coarsePointer = isCoarsePointer();
  // 셀 툴팁/안내 문구 — 입력 방식에 맞게 분기
  const cellEditHint = coarsePointer ? "탭하여 수정" : "더블클릭하여 수정";

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
      // 빈 입력/NaN으로 금액을 0으로 조용히 덮어쓰지 않음 — 실수 blur 방지
      const trimmed = editingValue.trim();
      const n = Number(trimmed.replace(/,/g, ""));
      if (trimmed === "" || !Number.isFinite(n)) {
        cancelEditField();
        return;
      }
      updated.amount = n;
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

  // "이번 달 반복 지출 생성" — 선택 반영 경로와 동일한 generateOccurrencesForMonthFromRecurring 기반.
  // (과거 구현은 frequency를 무시해 매년 항목이 매달, 매주 항목이 월 1회 전액으로 생성되고
  //  미래 시작일도 생성되는 결함이 있었음 — 주기·시작일·종료일을 모두 반영하는 단일 경로로 통일)
  const generateRecurringEntries = () => {
    const occurrences = generateOccurrencesForMonthFromRecurring(recurring, currentMonth);
    const toCreate = filterDuplicateOccurrences(occurrences, ledger, currentMonth);

    if (toCreate.length === 0) {
      toast.error("이번 달에 생성할 새 반복 지출 항목이 없습니다 (이미 모두 반영됨).");
      return;
    }

    previewOccurrencesRef.current = occurrences;
    setPreviewEntries(toCreate);
  };

  const confirmGenerateEntries = () => {
    if (!previewEntries || previewEntries.length === 0) return;
    // 미리보기 생성 후 다른 경로(선택 반영·수동 입력·탭 동기화)로 이미 들어온 항목과 재대조 —
    // stale 스냅샷을 재검증 없이 삽입해 같은 달 고정지출이 이중 생성되던 문제 수정.
    const source = previewOccurrencesRef.current;
    const toInsert = source ? filterDuplicateOccurrences(source, ledger, currentMonth) : previewEntries;
    setPreviewEntries(null);
    previewOccurrencesRef.current = null;
    if (toInsert.length === 0) {
      toast.error("이미 모두 반영되어 추가할 항목이 없습니다.");
      return;
    }
    onChangeLedger([...toInsert, ...ledger]);
    toast.success(`${toInsert.length}건의 반복 지출이 가계부에 추가되었습니다.`);
  };

  const handleApplyCurrentMonth = () => {
    const selectedRecurring = recurring.filter((r) => selectedRecurringIds.has(r.id));
    if (selectedRecurring.length === 0) {
      toast.error("반영할 항목을 선택해주세요.");
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
    // 열려 있던 미리보기는 이제 stale — 무효화(이어서 '확인'을 눌러 이중 생성되던 경로 차단)
    setPreviewEntries(null);
    previewOccurrencesRef.current = null;
    const skipped = occurrences.length - deduped.length;
    toast.success(
      skipped > 0
        ? `${deduped.length}건 반영됨 (중복 ${skipped}건 제외)`
        : `${deduped.length}건 가계부에 반영되었습니다.`
    );
  };

  // 프리셋 지출 대분류 중 첫 항목 (반복 반영 시 카테고리 비었을 때 사용) — 생성기(utils/recurringGenerate)에 주입
  const defaultExpenseCategory = useMemo(() => getDefaultExpenseCategory(categoryPresets), [categoryPresets]);

  // 생성·중복제거는 utils/recurringGenerate 단일 경로(헤더 미등록 배지 원클릭 반영과 공유)
  const generateOccurrencesForMonthFromRecurring = (recurringList: RecurringExpense[], month: string) =>
    generateOccurrences(recurringList, month, defaultExpenseCategory);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>고정 지출/구독 목록</h3>
        <button type="button" className="primary" onClick={generateRecurringEntries}>
          이번 달 반복 지출 생성
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
        {coarsePointer
          ? "각 셀을 탭하여 수정하거나, 작업 열의 수정 버튼으로 상단 폼에서 수정할 수 있습니다."
          : "각 셀을 더블클릭하여 수정하거나, 작업 열의 수정 버튼으로 상단 폼에서 수정할 수 있습니다."}
      </p>

      {previewEntries && (
        <div
          style={{
            background: "var(--surface)",
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
                {e.date} · {e.description} — {e.amount.toLocaleString()}원 ({e.subCategory || e.category})
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
          <col style={{ width: 110 }} />
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                title={cellEditHint}
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
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" className="secondary" onClick={() => onRequestEdit(r)} title="상단 폼에서 수정">
                    수정
                  </button>
                  <button type="button" className="danger" onClick={() => deleteRecurring(r.id)}>
                    삭제
                  </button>
                </div>
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
