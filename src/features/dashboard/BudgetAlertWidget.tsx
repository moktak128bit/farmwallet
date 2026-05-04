import React, { useMemo } from "react";
import type { LedgerEntry, BudgetGoal, Account } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";
import { formatNumber } from "../../utils/formatter";
import { isCreditPayment } from "../../utils/category";

interface Props {
  ledger: LedgerEntry[];
  budgetGoals?: BudgetGoal[];
  /** 예산 표시에 계좌명 변환용 (excludeAccountIds → 이름) */
  accounts?: Account[];
}

const monthOf = (d: string) => (d || "").slice(0, 7);

const currentMonthKey = () => {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
};

export const BudgetAlertWidget: React.FC<Props> = ({ ledger, budgetGoals, accounts }) => {
  const currentMonth = useMemo(() => currentMonthKey(), []);

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts ?? []) m.set(a.id, a.name || a.id);
    return m;
  }, [accounts]);

  const alerts = useMemo(() => {
    if (!budgetGoals || budgetGoals.length === 0) return [];
    // 이번달 expense만 — 신용결제는 카드 사용 시점에 이미 잡혔으므로 제외 (이중계상 방지).
    // 이체(kind="transfer")는 expense가 아니라 이 루프에 자연스럽게 포함되지 않음.
    const monthExp = ledger.filter(
      (l) => l.kind === "expense" && monthOf(l.date) === currentMonth && !isCreditPayment(l) && Number(l.amount) > 0
    );
    const catSpend = new Map<string, number>();
    let totalExpense = 0;
    for (const l of monthExp) {
      const amt = Number(l.amount);
      const cat = l.subCategory || l.category || "";
      if (cat) catSpend.set(cat, (catSpend.get(cat) ?? 0) + amt);
      if (l.category && l.category !== cat) {
        catSpend.set(l.category, (catSpend.get(l.category) ?? 0) + amt);
      }
      totalExpense += amt;
    }
    return budgetGoals
      .map((g) => {
        let spent: number;
        if (g.category === BUDGET_ALL_CATEGORY) {
          // excludeCategories: category·subCategory 어느 쪽으로도 매칭
          // excludeAccountIds: fromAccountId 매칭 (모임통장 등 공동 계좌 제외용)
          const exclCats = new Set(g.excludeCategories ?? []);
          const exclAccts = new Set(g.excludeAccountIds ?? []);
          const noFilter = exclCats.size === 0 && exclAccts.size === 0;
          spent = noFilter
            ? totalExpense
            : monthExp
                .filter((l) =>
                  !exclCats.has(l.category || "") &&
                  !exclCats.has(l.subCategory || "") &&
                  !exclAccts.has(l.fromAccountId || "")
                )
                .reduce((s, l) => s + Number(l.amount), 0);
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
                {(() => {
                  const exclCats = a.excludeCategories ?? [];
                  const exclAccts = (a.excludeAccountIds ?? []).map((id) => accountNameById.get(id) ?? id);
                  const allExcl = [...exclCats, ...exclAccts];
                  return (
                    <span
                      style={{ fontWeight: 600 }}
                      title={a.category === BUDGET_ALL_CATEGORY && allExcl.length > 0 ? `제외: ${allExcl.join(", ")}` : undefined}
                    >
                      {a.category === BUDGET_ALL_CATEGORY
                        ? `전체${allExcl.length > 0 ? ` (− ${allExcl.join(", ")})` : ""}`
                        : a.category}
                    </span>
                  );
                })()}
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
