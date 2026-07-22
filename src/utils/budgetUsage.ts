/**
 * 예산 사용액 단일 소스 — 예산 탭(BudgetRecurringView)과 대시보드 예산 위젯(BudgetAlertWidget)이
 * 같은 예산 목표에 대해 같은 숫자를 내도록 한 곳에서 계산한다.
 *
 * 예전엔 두 벌이 서로 다른 방향으로 틀렸다:
 *  - 예산 탭: 제외 필터는 온전하나 USD 미환산
 *  - 위젯: USD는 환산하나 재테크·환전·저축성지출 미제외 + 금액을 category·subCategory 양쪽 키에 이중 등록
 * → 같은 예산인데 탭 50% / 위젯 90%처럼 게이지가 갈라졌다.
 *
 * 기준: 지출 판정 = classifyLedgerFlow "expense"(신용결제·환전·저축성지출·투자손익 제외 — 대시보드 요약과 동일),
 *       대분류 매칭 = expenseMainName, 금액 = toKrwAmount(USD 환산).
 */
import type { BudgetGoal, CategoryPresets, LedgerEntry } from "../types";
import { BUDGET_ALL_CATEGORY } from "../types";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";
import { expenseMainName } from "./categoryMerge";

interface BudgetUsageOptions {
  categoryPresets?: CategoryPresets;
  fxRate?: number | null;
}

/** 한 예산 목표의 이번 달 사용액(KRW). month는 "YYYY-MM". */
export function computeBudgetGoalSpent(
  goal: BudgetGoal,
  ledger: LedgerEntry[],
  month: string,
  opts: BudgetUsageOptions = {}
): number {
  const { categoryPresets, fxRate = null } = opts;
  const isTotal = goal.category === BUDGET_ALL_CATEGORY;
  const exclCats = isTotal ? new Set(goal.excludeCategories ?? []) : null;
  const exclAccts = isTotal ? new Set(goal.excludeAccountIds ?? []) : null;

  let spent = 0;
  for (const l of ledger) {
    if (!l.date?.startsWith(month)) continue;
    if (classifyLedgerFlow(l, categoryPresets) !== "expense") continue;
    const mainName = expenseMainName(l);
    if (!mainName) continue;
    if (isTotal) {
      // "전체" 예산 — 사용자 지정 대분류·계좌 제외 후 합산
      if (exclCats!.has(mainName)) continue;
      if (l.fromAccountId && exclAccts!.has(l.fromAccountId)) continue;
    } else if (mainName !== goal.category) {
      continue;
    }
    spent += toKrwAmount(l, fxRate);
  }
  return spent;
}
