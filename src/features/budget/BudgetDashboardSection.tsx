/**
 * 예산 시각화 대시보드 — 이번 달 전체 예산 진행 바 + 카테고리별 카드 그리드.
 * BudgetRecurringView에서 분리 — 자체 상태 없는 순수 표시 컴포넌트.
 * budgetUsage는 부모 memo에서 계산해 내려준다 (자식은 재계산하지 않는다).
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 */
import React from "react";
import type { Account, BudgetGoal } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";

/** 부모(BudgetRecurringView) budgetUsage memo의 행 타입 — 예산 + 이번 달 사용액/잔여 */
export type BudgetUsageRow = BudgetGoal & { spent: number; remain: number };

interface Props {
  budgetUsage: BudgetUsageRow[];
  accounts: Account[];
}

export const BudgetDashboardSection: React.FC<Props> = React.memo(function BudgetDashboardSection({
  budgetUsage,
  accounts,
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  // '전체' 예산은 이미 모든 개별 카테고리를 포함 → 둘을 합치면 이중계상.
  // '전체' 예산이 있으면 그것을 총괄로, 없으면 개별 예산의 합을 총괄로 사용.
  const allBudget = budgetUsage.find((b) => b.category === BUDGET_ALL_CATEGORY);
  const overallSource = allBudget ? [allBudget] : budgetUsage;
  const totalSpent = overallSource.reduce((s, b) => s + b.spent, 0);
  const totalLimit = overallSource.reduce((s, b) => s + b.monthlyLimit, 0);
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
          background: "var(--surface)",
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
                    : "var(--surface)",
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
                    title={(() => {
                      if (b.category !== BUDGET_ALL_CATEGORY) return undefined;
                      const cats = b.excludeCategories ?? [];
                      const accts = (b.excludeAccountIds ?? []).map((id) => accounts.find(a => a.id === id)?.name ?? id);
                      const all = [...cats, ...accts];
                      return all.length > 0 ? `제외: ${all.join(", ")}` : undefined;
                    })()}
                  >
                    {(() => {
                      if (b.category !== BUDGET_ALL_CATEGORY) return (b.category || "(미분류)");
                      const cats = b.excludeCategories ?? [];
                      const accts = (b.excludeAccountIds ?? []).map((id) => accounts.find(a => a.id === id)?.name ?? id);
                      const all = [...cats, ...accts];
                      return `전체${all.length > 0 ? ` (− ${all.join(", ")})` : ""}`;
                    })()}
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
});
