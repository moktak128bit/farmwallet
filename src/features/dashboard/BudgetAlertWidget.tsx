import React, { useMemo } from "react";
import type { LedgerEntry, BudgetGoal, Account, CategoryPresets } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";
import { formatNumber } from "../../utils/formatter";
import { getThisMonthKST } from "../../utils/date";
import { computeBudgetGoalSpent } from "../../utils/budgetUsage";

interface Props {
  ledger: LedgerEntry[];
  budgetGoals?: BudgetGoal[];
  /** 예산 표시에 계좌명 변환용 (excludeAccountIds → 이름) */
  accounts?: Account[];
  /** USD 지출 원화 환산용 — 다른 위젯과 동일 기준 */
  fxRate?: number | null;
  /** 저축성지출 판정용 (categoryTypes.savings) — 예산 탭과 동일 기준 */
  categoryPresets?: CategoryPresets;
}


// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조)이어야 한다.
export const BudgetAlertWidget: React.FC<Props> = React.memo(function BudgetAlertWidget({ ledger, budgetGoals, accounts, fxRate = null, categoryPresets }) {
  // 이번달 키 — 다른 위젯과 동일하게 KST 기준 (로컬 타임존 new Date() 사용 금지)
  const currentMonth = useMemo(() => getThisMonthKST(), []);

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts ?? []) m.set(a.id, a.name || a.id);
    return m;
  }, [accounts]);

  const alerts = useMemo(() => {
    if (!budgetGoals || budgetGoals.length === 0) return [];
    // 사용액은 computeBudgetGoalSpent 단일 소스 — 예산 탭과 같은 숫자 보장.
    // (예전엔 이 위젯만 재테크·환전·저축성지출을 안 걸렀고, 금액을 category·subCategory
    //  양쪽 키에 이중 등록해 같은 예산의 게이지가 탭과 다른 위치에 있었다.)
    return budgetGoals
      .map((g) => {
        const spent = computeBudgetGoalSpent(g, ledger, currentMonth, { categoryPresets, fxRate });
        const pct = g.monthlyLimit > 0 ? (spent / g.monthlyLimit) * 100 : 0;
        return { ...g, spent, pct };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [ledger, budgetGoals, currentMonth, categoryPresets, fxRate]);

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
          <span style={{ fontSize: 13, background: "var(--danger)", color: "#fff", borderRadius: 10, padding: "3px 10px" }}>
            {overBudget.length}건 초과
          </span>
        )}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {alerts.slice(0, 8).map((a) => {
          // 상태색 컨벤션: 초과=danger / 임박=warning / 여유=success (테마 변수 — 다크모드 대응)
          const color = a.pct >= 100 ? "var(--danger)" : a.pct >= 80 ? "var(--warning)" : "var(--success)";
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
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(100, Math.max(0, a.pct)))}
                aria-label={`${a.category === BUDGET_ALL_CATEGORY ? "전체" : a.category} 예산 사용률 ${Math.round(a.pct)}%`}
                style={{ height: 10, background: "var(--border)", borderRadius: 5, overflow: "hidden" }}
              >
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
            background: overBudget.length > 0 ? "var(--danger-light)" : "var(--warning-light)",
            color: overBudget.length > 0 ? "var(--danger)" : "var(--warning)",
            border: `1px solid ${overBudget.length > 0 ? "var(--danger)" : "var(--warning)"}`,
          }}
        >
          {overBudget.length > 0
            ? `${overBudget.map((a) => a.category).join(", ")} 예산을 초과했습니다!`
            : `${nearBudget.map((a) => a.category).join(", ")} 예산의 80%를 넘었습니다.`}
        </div>
      )}
    </div>
  );
});
