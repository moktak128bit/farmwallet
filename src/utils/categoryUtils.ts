/**
 * 카테고리 타입 판단 유틸리티
 */

import type { LedgerKind, CategoryPresets, LedgerEntry, Account } from "../types";

export type CategoryType = "income" | "transfer" | "savings" | "fixed" | "variable";

/**
 * 카테고리 타입을 판단하는 함수
 */
export function getCategoryType(
  category: string,
  subCategory: string | undefined,
  kind: LedgerKind,
  categoryPresets: CategoryPresets,
  entry?: LedgerEntry,
  accounts?: Account[]
): CategoryType {
  // 수입은 항상 "income"
  if (kind === "income") {
    return "income";
  }

  // 저축성지출 판단 (transfer→증권/저축, expense+저축성지출) — "이체" 일반 이체 제외
  if (isSavingsExpense(category, subCategory, kind, entry, accounts, categoryPresets)) {
    return "savings";
  }

  // 일반 이체(이체 탭에서 입력, category "이체")는 "transfer"
  if (kind === "transfer") {
    return "transfer";
  }

  // 고정지출 판단
  if (isFixedExpense(category, subCategory, categoryPresets)) {
    return "fixed";
  }

  // 나머지는 변동지출
  return "variable";
}

/**
 * 저축성지출인지 판단
 */
function isSavingsExpense(
  category: string,
  subCategory: string | undefined,
  kind: LedgerKind,
  entry: LedgerEntry | undefined,
  accounts: Account[] | undefined,
  categoryPresets: CategoryPresets
): boolean {
  // 일반 이체(이체·계좌이체·카드결제이체)는 저축성 지출이 아님
  const generalTransferCategories = ["이체", "계좌이체", "카드결제이체"];
  if (generalTransferCategories.includes(category)) {
    return false;
  }

  // categoryTypes에 정의된 저축성지출 카테고리 확인
  const savingsCategories = categoryPresets.categoryTypes?.savings ?? ["저축성지출"];
  if (savingsCategories.includes(category)) {
    return true;
  }

  // transfer이고 toAccountId가 증권/저축 계좌인 경우 (저축성 지출 탭에서 입력한 적금·ISA 등)
  if (entry && kind === "transfer" && entry.toAccountId && accounts) {
    const toAccount = accounts.find(a => a.id === entry.toAccountId);
    if (toAccount && (toAccount.type === "securities" || toAccount.type === "savings")) {
      return true;
    }
  }

  // expense이고 대분류가 저축성지출인 경우
  if (kind === "expense" && category === "저축성지출") {
    return true;
  }

  return false;
}

/**
 * 가계부 단일 소스: 저축성지출 여부 (entry + accounts만 사용, 대시보드·리포트 등 동일 로직)
 */
export function isSavingsExpenseEntry(entry: LedgerEntry, accounts: Account[]): boolean {
  const generalTransferCategories = ["이체", "계좌이체", "카드결제이체"];
  if (generalTransferCategories.includes(entry.category)) return false;
  if (entry.kind === "transfer" && entry.toAccountId) {
    const to = accounts.find((a) => a.id === entry.toAccountId);
    if (to && (to.type === "securities" || to.type === "savings")) return true;
  }
  if (entry.kind === "expense" && entry.category === "저축성지출") return true;
  return false;
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
