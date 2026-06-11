/**
 * 예산/목표 테이블 — 더블클릭 인라인 셀 편집(카테고리/월 예산/메모) + 달성률 진행 바 + 삭제.
 * BudgetRecurringView에서 분리 — 인라인 편집(editingBudgetField/editingBudgetValue) 상태를
 * 이 컴포넌트가 소유해 셀 편집 타이핑이 부모를 재렌더하지 않는다.
 * budgetUsage(사용액·잔여 포함)는 부모 memo에서 계산해 내려준다 (자식은 재계산하지 않는다).
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import type { BudgetGoal } from "../../types";
import { isCoarsePointer } from "../../utils/pointer";
import { useAppStore } from "../../store/appStore";
import type { BudgetUsageRow } from "./BudgetDashboardSection";

// ─── 삭제 토스트 [실행 취소] — "삭제 항목 재삽입" 복원 ───────────────────
// 풀 스냅샷 undo가 아니다:
//  - 삭제 이후 다른 변경(시세 갱신·Gist pull·탭 동기화·다른 편집)이 있어도
//    그 변경을 보존한 채 삭제된 항목만 되살린다.
//  - 복원은 onChange*(→ setDataWithHistory) 경유의 새 히스토리 write라
//    Ctrl+Z로 복원 자체를 다시 취소할 수 있다.
// 전제: appStore.setData는 동기(zustand) — 클릭 시점 getState() 재조회가 항상 최신.
// useAppStore는 핸들러 내부 getState()만 사용 — 훅 구독 금지(재렌더 유발·memo 무력화 방지).
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";

interface Props {
  budgetUsage: BudgetUsageRow[];
  budgets: BudgetGoal[];
  onChangeBudgets: (next: BudgetGoal[]) => void;
}

export const BudgetGoalsTable: React.FC<Props> = React.memo(function BudgetGoalsTable({
  budgetUsage,
  budgets,
  onChangeBudgets,
}) {
  const [editingBudgetField, setEditingBudgetField] = useState<{ id: string; field: string } | null>(null);
  const [editingBudgetValue, setEditingBudgetValue] = useState<string>("");
  // 터치 환경 여부 — 렌더당 1회 평가 (coarse 포인터는 더블클릭 대신 단일 탭으로 편집 진입)
  const coarsePointer = isCoarsePointer();

  const deleteBudget = (id: string, category: string) => {
    if (!window.confirm(`"${category}" 예산을 삭제하시겠습니까?`)) return;
    // index 전달 — 예산 표는 배열 순서대로 렌더되므로 원래 위치로 복원
    const index = budgets.findIndex((b) => b.id === id);
    const deleted = index >= 0 ? budgets[index] : undefined;
    onChangeBudgets(budgets.filter((b) => b.id !== id));
    if (deleted) {
      showDeleteUndoToast(
        `"${category}" 예산이 삭제되었습니다.`,
        buildRestoreById(() => useAppStore.getState().data.budgetGoals, onChangeBudgets, deleted, index)
      );
    } else {
      toast.success(`"${category}" 예산이 삭제되었습니다.`);
    }
  };

  const startEditBudgetField = (id: string, field: string, currentValue: string | number) => {
    setEditingBudgetField({ id, field });
    setEditingBudgetValue(String(currentValue));
  };

  // 터치(coarse) 단일 탭 편집 진입 — 이미 해당 셀을 편집 중이면(입력 내부 탭 등) 재진입으로 입력값이 초기화되지 않게 막는다
  const tapToEditBudgetField = (id: string, field: string, currentValue: string | number) => {
    if (editingBudgetField?.id === id && editingBudgetField.field === field) return;
    startEditBudgetField(id, field, currentValue);
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

  return (
    <>
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
                className="cell-editable"
                onDoubleClick={() => startEditBudgetField(b.id, "category", b.category)}
                onClick={coarsePointer ? () => tapToEditBudgetField(b.id, "category", b.category) : undefined}
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
                className="number cell-editable"
                onDoubleClick={() => startEditBudgetField(b.id, "monthlyLimit", b.monthlyLimit)}
                onClick={coarsePointer ? () => tapToEditBudgetField(b.id, "monthlyLimit", b.monthlyLimit) : undefined}
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
                className="cell-editable"
                onDoubleClick={() => startEditBudgetField(b.id, "note", b.note || "")}
                onClick={coarsePointer ? () => tapToEditBudgetField(b.id, "note", b.note || "") : undefined}
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
                <button type="button" className="danger" onClick={() => deleteBudget(b.id, b.category)}>
                  삭제
                </button>
              </td>
            </tr>
            );
          })}
          {budgets.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center" }}>
                설정된 예산이 없습니다 — 위 '예산/목표 추가' 폼에서 첫 예산을 만들어 보세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
});
