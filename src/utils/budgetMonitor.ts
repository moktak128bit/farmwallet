/**
 * 예산 모니터링 및 알림 시스템
 */

import type { LedgerEntry, BudgetGoal, RecurringExpense } from "../types";

export interface BudgetAlert {
  type: "warning" | "danger";
  message: string;
  category?: string;
  current: number;
  limit: number;
  percentage: number;
}

/**
 * 예산 초과 여부 확인
 */
export function checkBudgetExceeded(
  budgets: BudgetGoal[],
  ledger: LedgerEntry[],
  currentMonth?: string
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  const month = currentMonth || new Date().toISOString().slice(0, 7);

  budgets.forEach((budget) => {
    const monthExpenses = ledger
      .filter((l) => l.kind === "expense" && l.date.startsWith(month))
      .filter((l) => {
        if (budget.category) {
          return l.category === budget.category || l.subCategory === budget.category;
        }
        return true;
      })
      .reduce((sum, l) => sum + l.amount, 0);

    const percentage = budget.monthlyLimit > 0 ? (monthExpenses / budget.monthlyLimit) * 100 : 0;

    if (percentage >= 100) {
      alerts.push({
        type: "danger",
        message: `${budget.category || "전체"} 예산을 초과했습니다`,
        category: budget.category,
        current: monthExpenses,
        limit: budget.monthlyLimit,
        percentage
      });
    } else if (percentage >= 80) {
      alerts.push({
        type: "warning",
        message: `${budget.category || "전체"} 예산의 ${percentage.toFixed(1)}%를 사용했습니다`,
        category: budget.category,
        current: monthExpenses,
        limit: budget.monthlyLimit,
        percentage
      });
    }
  });

  return alerts;
}

/**
 * 예산 경고 임계값 확인
 */
export function checkBudgetThreshold(
  budgets: BudgetGoal[],
  ledger: LedgerEntry[],
  threshold: number = 80,
  currentMonth?: string
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  const month = currentMonth || new Date().toISOString().slice(0, 7);

  budgets.forEach((budget) => {
    const monthExpenses = ledger
      .filter((l) => l.kind === "expense" && l.date.startsWith(month))
      .filter((l) => {
        if (budget.category) {
          return l.category === budget.category || l.subCategory === budget.category;
        }
        return true;
      })
      .reduce((sum, l) => sum + l.amount, 0);

    const percentage = budget.monthlyLimit > 0 ? (monthExpenses / budget.monthlyLimit) * 100 : 0;

    if (percentage >= threshold) {
      alerts.push({
        type: percentage >= 100 ? "danger" : "warning",
        message: `${budget.category || "전체"} 예산의 ${percentage.toFixed(1)}% 사용`,
        category: budget.category,
        current: monthExpenses,
        limit: budget.monthlyLimit,
        percentage
      });
    }
  });

  return alerts;
}

/**
 * 반복 지출 예상 금액 계산
 */
export function calculateExpectedRecurringExpenses(
  recurring: RecurringExpense[],
  month?: string
): number {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  return recurring
    .filter((r) => {
      if (r.startDate && r.startDate > `${targetMonth}-31`) return false;
      if (r.endDate && r.endDate < `${targetMonth}-01`) return false;
      return true;
    })
    .reduce((sum, r) => {
      // 빈도에 따른 계산 (간단한 버전)
      if (r.frequency === "monthly") return sum + r.amount;
      if (r.frequency === "weekly") return sum + r.amount * 4; // 대략 4주
      if (r.frequency === "yearly") return sum + r.amount / 12;
      return sum + r.amount;
    }, 0);
}
