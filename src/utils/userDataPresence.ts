/** 기본 분류·운동 루틴·자동 수집 시계열은 빈 브라우저에도 있으므로 제외한다. */
export const USER_COLLECTION_KEYS = [
  "ledger", "accounts", "trades", "loans", "recurringExpenses", "budgetGoals", "savingsGoals",
  "workoutWeeks", "customExercises", "ledgerTemplates", "stockPresets", "targetPortfolios",
] as const;

export function hasUserRecords(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return USER_COLLECTION_KEYS.some((key) => Array.isArray(record[key]) && record[key].length > 0);
}

/** 새 브라우저의 빈 자동저장으로 공유 장부 파일이 사라지는 것을 차단한다. */
export function wouldEraseUserRecords(existing: unknown, incoming: unknown): boolean {
  return hasUserRecords(existing) && !hasUserRecords(incoming);
}
