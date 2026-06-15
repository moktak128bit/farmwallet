/**
 * 예산/목표 추가 폼 (two-column 오른쪽 카드) — "전체" 모드의 제외 카테고리·제외 계좌 칩 포함.
 * BudgetRecurringView에서 분리 — budForm 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(BudgetRecurringView)를 재렌더하지 않는다.
 * React.memo로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 */
import React, { useMemo, useState } from "react";
import type { Account, BudgetGoal, CategoryPresets } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";
import { newIdWithPrefix } from "../../utils/id";

const createBudget = (): BudgetGoal => ({
  id: newIdWithPrefix("B"),
  category: "",
  monthlyLimit: 0,
  note: ""
});

interface Props {
  accounts: Account[];
  categoryPresets: CategoryPresets;
  budgets: BudgetGoal[];
  onChangeBudgets: (next: BudgetGoal[]) => void;
}

export const BudgetFormCard: React.FC<Props> = React.memo(function BudgetFormCard({
  accounts,
  categoryPresets,
  budgets,
  onChangeBudgets,
}) {
  const [budForm, setBudForm] = useState<BudgetGoal>(createBudget);

  const totalBudget = useMemo(
    () => budgets.reduce((s, b) => s + (b.monthlyLimit || 0), 0),
    [budgets]
  );

  const addBudget = () => {
    if (!budForm.category || !budForm.monthlyLimit) return;
    onChangeBudgets([budForm, ...budgets]);
    setBudForm(createBudget());
  };

  return (
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
              // 개별 카테고리 모드로 바뀌면 제외 목록 둘 다 비움
              excludeCategories: next === BUDGET_ALL_CATEGORY ? (prev.excludeCategories ?? []) : undefined,
              excludeAccountIds: next === BUDGET_ALL_CATEGORY ? (prev.excludeAccountIds ?? []) : undefined,
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
      {budForm.category === BUDGET_ALL_CATEGORY && (
        <label className="wide">
          <span>제외 계좌 (출금 기준)</span>
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
            {accounts.length === 0 && (
              <span className="hint">계좌가 없습니다.</span>
            )}
            {accounts.map((a) => {
              const checked = (budForm.excludeAccountIds ?? []).includes(a.id);
              return (
                <label
                  key={a.id}
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
                      const set = new Set(budForm.excludeAccountIds ?? []);
                      if (e.target.checked) set.add(a.id);
                      else set.delete(a.id);
                      setBudForm({ ...budForm, excludeAccountIds: [...set] });
                    }}
                    style={{ margin: 0 }}
                  />
                  {a.name || a.id}
                </label>
              );
            })}
          </div>
          <span className="hint" style={{ display: "block", marginTop: 4, fontSize: 11 }}>
            체크한 계좌에서 빠져나간 지출(fromAccount)은 집계에서 제외됩니다. 예: 모임통장 결제는 본인 부담 아님 → 예산 외.
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
  );
});
