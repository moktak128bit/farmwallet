/**
 * 예산/목표 테이블 — 더블클릭 인라인 셀 편집(카테고리/월 예산/메모) + 달성률 진행 바 + 삭제.
 * BudgetRecurringView에서 분리 — 인라인 편집(editingBudgetField/editingBudgetValue) 상태를
 * 이 컴포넌트가 소유해 셀 편집 타이핑이 부모를 재렌더하지 않는다.
 * budgetUsage(사용액·잔여 포함)는 부모 memo에서 계산해 내려준다 (자식은 재계산하지 않는다).
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React, { useState } from "react";
import type { BudgetGoal } from "../../types";
import type { BudgetUsageRow } from "./BudgetDashboardSection";

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
    </>
  );
});
