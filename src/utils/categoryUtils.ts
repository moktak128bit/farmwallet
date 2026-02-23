/**
 * 카테고리 타입 판단 유틸리티
 *
 * 구분 (일관된 정의):
 * - 저축성 지출: kind === "expense" 이고 대분류가 저축성지출 카테고리. (지출의 한 분류, 계좌 잔액 이동 없음)
 * - 이체: kind === "transfer" 전부. (계좌 간 이동, 저축/증권으로 가도 이체)
 */

import type { LedgerKind, CategoryPresets, LedgerEntry, Account } from "../types";

export type CategoryType = "income" | "transfer" | "savings" | "fixed" | "variable";

/**
 * 저축성지출 카테고리 목록 (categoryPresets 미제공 시 기본값)
 */
function getSavingsCategories(categoryPresets?: CategoryPresets): string[] {
  return categoryPresets?.categoryTypes?.savings ?? ["저축성지출"];
}

/**
 * 카테고리 타입을 판단하는 함수
 */
export function getCategoryType(
  category: string,
  subCategory: string | undefined,
  kind: LedgerKind,
  categoryPresets: CategoryPresets,
  _entry?: LedgerEntry,
  _accounts?: Account[]
): CategoryType {
  if (kind === "income") return "income";

  // 저축성 지출 = expense + 저축성지출 카테고리만
  if (kind === "expense" && getSavingsCategories(categoryPresets).includes(category)) {
    return "savings";
  }

  // 이체 = transfer 전부
  if (kind === "transfer") return "transfer";

  if (isFixedExpense(category, subCategory, categoryPresets)) return "fixed";
  return "variable";
}

/**
 * 가계부 단일 소스: 저축성지출 여부.
 * 저축성 지출 = kind === "expense" 이고 대분류가 저축성지출 카테고리.
 * @param categoryPresets - 선택. 미제공 시 기본 ["저축성지출"] 사용
 */
export function isSavingsExpenseEntry(
  entry: LedgerEntry,
  accounts: Account[],
  categoryPresets?: CategoryPresets
): boolean {
  const savingsCategories = getSavingsCategories(categoryPresets);
  return entry.kind === "expense" && savingsCategories.includes(entry.category);
}

/**
 * 고정지출인지 판단
 */
function isFixedExpense(
  category: string,
  subCategory: string | undefined,
  categoryPresets: CategoryPresets
): boolean {
  // categoryTypes에 정의된 고정지출 카테고리 확인
  const fixedCategories = categoryPresets.categoryTypes?.fixed ?? [];
  
  // 대분류가 고정지출인 경우
  if (fixedCategories.includes(category)) {
    return true;
  }

  // 주거비의 세부 항목 "주담대이자"도 고정지출로 처리
  if (category === "주거비" && subCategory === "주담대이자") {
    return true;
  }

  return false;
}
