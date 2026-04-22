import React, { useMemo } from "react";
import type { LedgerEntry, BudgetGoal } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";
import { formatNumber } from "../../utils/formatter";

interface Props {
  ledger: LedgerEntry[];
  budgetGoals?: BudgetGoal[];
}

const monthOf = (d: string) => (d || "").slice(0, 7);

const currentMonthKey = () => {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
};

export const BudgetAlertWidget: React.FC<Props> = ({ ledger, budgetGoals }) => {
  const currentMonth = useMemo(() => currentMonthKey(), []);

  const alerts = useMemo(() => {
    if (!budgetGoals || budgetGoals.length === 0) return [];
    const catSpend = new Map<string, number>();
    let totalExpense = 0;
    const expenseByMainCat = new Map<string, number>();
    for (const l of ledger) {
      if (l.kind !== "expense" || monthOf(l.date) !== currentMonth) continue;
      const amt = Number(l.amount);
      const cat = l.subCategory || l.category || "";
      if (cat) catSpend.set(cat, (catSpend.get(cat) ?? 0) + amt);
      if (l.category && l.category !== cat) {
        catSpend.set(l.category, (catSpend.get(l.category) ?? 0) + amt);
      }
      totalExpense += amt;
      if (l.category) {
        expenseByMainCat.set(l.category, (expenseByMainCat.get(l.category) ?? 0) + amt);
      }
    }
    return budgetGoals
      .map((g) => {
        let spent: number;
        if (g.category === BUDGET_ALL_CATEGORY) {
          const excluded = (g.excludeCategories ?? []).reduce(
            (s, c) => s + (expenseByMainCat.get(c) ?? 0),
            0
          );
          spent = Math.max(0, totalExpense - excluded);
        } else {
          spent = catSpend.get(g.category) ?? 0;
        }
        const pct = g.monthlyLimit > 0 ? (spent / g.monthlyLimit) * 100 : 0;
        return { ...g, spent, pct };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [ledger, budgetGoals, currentMonth]);

  if (alerts.length === 0) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>예산 관리</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 15 }}>
          예산 목표를 설정하면 초과 알림을 받을 수 있습니다.
        </p>
      </div>
    );
  }

  const overBudget = alerts.filter((a) => a.pct >= 100);
  const nearBudget = alerts.filter((a) => a.pct >= 80 && a.pct < 100);

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
        예산 관리
        {overBudget.length > 0 && (
          <span style={{ fontSize: 13, background: "#ef4444", color: "#fff", borderRadius: 10, padding: "3px 10px" }}>
            {overBudget.length}건 초과
          </span>
        )}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {alerts.slice(0, 8).map((a) => {
          const color = a.pct >= 100 ? "#ef4444" : a.pct >= 80 ? "#f59e0b" : "#22c55e";
          return (
            <div key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 6 }}>
                <span
                  style={{ fontWeight: 600 }}
                  title={
                    a.category === BUDGET_ALL_CATEGORY && (a.excludeCategories ?? []).length > 0
                      ? `제외: ${(a.excludeCategories ?? []).join(", ")}`
                      : undefined
                  }
                >
                  {a.category === BUDGET_ALL_CATEGORY
                    ? `전체${(a.excludeCategories ?? []).length > 0 ? ` (− ${(a.excludeCategories ?? []).join(", ")})` : ""}`
                    : a.category}
                </span>
                <span style={{ color }}>
                  {formatNumber(a.spent)} / {formatNumber(a.monthlyLimit)}
                  <span style={{ marginLeft: 6, fontSize: 13 }}>({Math.round(a.pct)}%)</span>
                </span>
              </div>
              <div style={{ height: 10, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, a.pct))}%`,
                    height: 10,
                    background: color,
                    borderRadius: 4,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {(overBudget.length > 0 || nearBudget.length > 0) && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 15,
            background: overBudget.length > 0 ? "#fef2f2" : "#fffbeb",
            color: overBudget.length > 0 ? "#b91c1c" : "#92400e",
            border: `1px solid ${overBudget.length > 0 ? "#fecaca" : "#fde68a"}`,
          }}
        >
          {overBudget.length > 0
            ? `${overBudget.map((a) => a.category).join(", ")} 예산을 초과했습니다!`
            : `${nearBudget.map((a) => a.category).join(", ")} 예산의 80%를 넘었습니다.`}
        </div>
      )}
    </div>
  );
};
