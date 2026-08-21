/**
 * 예산 시각화 대시보드 — 이번 달 전체 예산 진행 바 + 카테고리별 카드 그리드.
 * BudgetRecurringView에서 분리 — 자체 상태 없는 순수 표시 컴포넌트.
 * budgetUsage는 부모 memo에서 계산해 내려준다 (자식은 재계산하지 않는다).
 * React.memo로 감싸 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 */
import React from "react";
import type { Account, BudgetGoal } from "../../types";
import { BUDGET_ALL_CATEGORY } from "../../types";
import { getTodayKST, getLastDayOfMonth } from "../../utils/date";
import type { BudgetPace, BudgetPaceStatus } from "../../utils/budgetPace";
import { formatNumber } from "../../utils/formatter";

/** 부모(BudgetRecurringView) budgetUsage memo의 행 타입 — 예산 + 이번 달 사용액/잔여 + 페이스(월말 예상·허용액·전월 동기) */
export type BudgetUsageRow = BudgetGoal & { spent: number; remain: number; pace: BudgetPace };

/** 페이스 배지 — 상태색 컨벤션: 초과/초과 예상=danger, 주의=warning, 순조로움=success */
const PACE_BADGE: Record<BudgetPaceStatus, { label: string; color: string; bg: string }> = {
  exceeded: { label: "초과", color: "var(--danger)", bg: "var(--danger-light)" },
  "over-pace": { label: "초과 예상", color: "var(--danger)", bg: "var(--danger-light)" },
  watch: { label: "주의", color: "var(--warning)", bg: "var(--warning-light)" },
  ok: { label: "순조로움", color: "var(--success)", bg: "var(--success-light)" },
};

const signedPct = (pct: number) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;

interface Props {
  budgetUsage: BudgetUsageRow[];
  accounts: Account[];
}

export const BudgetDashboardSection: React.FC<Props> = React.memo(function BudgetDashboardSection({
  budgetUsage,
  accounts,
}) {
  // '오늘'은 KST 기준 — new Date()(브라우저 로컬/UTC)를 쓰면 KST 자정 전후(UTC 15:00)에 하루 어긋남
  const today = getTodayKST();
  const [year, month1, dayOfMonth] = today.split("-").map(Number); // month1: 1-based
  const daysInMonth = getLastDayOfMonth(year, month1);
  const daysRemaining = daysInMonth - dayOfMonth;

  // '전체' 예산은 이미 모든 개별 카테고리를 포함 → 둘을 합치면 이중계상.
  // '전체' 예산이 있으면 그것을 총괄로, 없으면 개별 예산의 합을 총괄로 사용.
  const allBudget = budgetUsage.find((b) => b.category === BUDGET_ALL_CATEGORY);
  const overallSource = allBudget ? [allBudget] : budgetUsage;
  const totalSpent = overallSource.reduce((s, b) => s + b.spent, 0);
  const totalLimit = overallSource.reduce((s, b) => s + b.monthlyLimit, 0);
  const overallPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;
  const overallBarColor =
    overallPct >= 100 ? "var(--danger)" : overallPct >= 80 ? "var(--warning)" : "var(--success)";

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
            <strong>{formatNumber(totalLimit)}원</strong> 중{" "}
            <strong style={{ color: overallBarColor }}>
              {formatNumber(totalSpent)}원
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
            <strong style={{ color: totalLimit - totalSpent >= 0 ? "var(--success)" : "var(--danger)" }}>
              {formatNumber(totalLimit - totalSpent)}원
            </strong>
          </span>
        </div>

        {/* '전체' 예산이 있을 때만 총괄 페이스 표시 (개별 예산 합은 단일 페이스가 없다) */}
        {allBudget && allBudget.monthlyLimit > 0 && (
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: allBudget.pace.status === "ok" ? "var(--text-muted, #888)" : PACE_BADGE[allBudget.pace.status].color,
            }}
          >
            {allBudget.pace.message}
            <span style={{ marginLeft: 8, color: "var(--text-muted, #888)" }}>
              · 전월 {allBudget.pace.prevSamePeriodLabel} {formatNumber(allBudget.pace.prevSamePeriodSpent)}원
            </span>
          </div>
        )}
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
              catPct >= 100 ? "var(--danger)" : catPct >= 80 ? "var(--warning)" : "var(--success)";
            const accentColor = cardColors[idx % cardColors.length];

            // 페이스 — computeBudgetPace(월말 예상·남은 하루 허용액·전월 동기). 예전 '경과일/총일×한도' 선형 판정 대체
            const badge = PACE_BADGE[b.pace.status];
            const prevDiffPct =
              b.pace.prevSamePeriodSpent > 0
                ? ((b.spent - b.pace.prevSamePeriodSpent) / b.pace.prevSamePeriodSpent) * 100
                : null;

            return (
              <div
                key={b.id}
                style={{
                  background: isOver
                    ? "var(--danger-light)"
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
                      color: badge.color,
                      background: badge.bg,
                      borderRadius: 20,
                      padding: "2px 8px",
                    }}
                  >
                    {badge.label}
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
                      {formatNumber(b.spent)}
                    </span>
                    <span style={{ color: "var(--text-muted, #888)" }}>
                      {" "}/ {formatNumber(b.monthlyLimit)}원
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color:
                        b.remain >= 0 ? "var(--text-muted, #888)" : "var(--danger)",
                    }}
                  >
                    {b.remain >= 0
                      ? `잔여 ${formatNumber(b.remain)}원`
                      : `초과 ${formatNumber(Math.abs(b.remain))}원`}
                  </span>
                </div>

                {/* 페이스 한 줄: 이 페이스면 월말 N원(한도 ±x%) · 남은 N일 하루 N원 */}
                {b.monthlyLimit > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: b.pace.status === "ok" ? "var(--text-muted, #888)" : badge.color,
                      lineHeight: 1.4,
                    }}
                  >
                    {b.pace.message}
                  </div>
                )}

                {/* 전월 동기(1~N일) 비교 + 사용률 */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--text-muted, #888)",
                  }}
                >
                  <span>
                    전월 {b.pace.prevSamePeriodLabel} {formatNumber(b.pace.prevSamePeriodSpent)}원
                    {prevDiffPct != null && (
                      // 지출 증가=빨강(danger), 감소=파랑(accent) — 국내 관례
                      <span style={{ marginLeft: 4, color: prevDiffPct > 0 ? "var(--danger)" : "var(--accent)" }}>
                        ({signedPct(prevDiffPct)})
                      </span>
                    )}
                  </span>
                  <span>{catPct.toFixed(1)}% 사용</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
