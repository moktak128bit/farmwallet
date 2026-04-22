/**
 * 카테고리 타입 판단 유틸리티
 *
 * 구조 (v5 이후):
 * - 수입 (income): kind === "income"
 * - 지출 (expense): kind === "expense"
 * - 이체 (transfer): kind === "transfer"
 *   - 저축/투자: kind === "transfer" && subCategory ∈ {저축, 투자} (= 재테크 이체)
 *
 * 구버전 호환: (kind=expense, category=재테크) 구조가 남아있으면 동일하게 인식.
 */

import type { LedgerKind, CategoryPresets, LedgerEntry, Account } from "../types";

/**
 * 재테크 저축·투자(자산 이동)인지 판별.
 * 현재 구조: kind=transfer + subCategory ∈ {저축이체, 투자이체}
 * 구버전 호환:
 *  - kind=transfer + sub=저축/투자 (v7 임시)
 *  - kind=expense/category=재테크/sub=저축·투자 (v5 이전)
 */
export function isInvestmentEntry(entry: LedgerEntry): boolean {
  const sub = entry.subCategory;
  if (entry.kind === "transfer" && (sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자")) return true;
  if (entry.kind === "expense" && entry.category === "재테크" && (sub === "저축" || sub === "투자")) return true;
  return false;
}

/**
 * 재테크 전체(저축·투자 이체 + 투자수익 수입 + 투자손실 지출).
 * 투자수익: kind=income, subCategory=투자수익
 * 투자손실: kind=expense, category=재테크
 */
export function isInvestmentKind(entry: LedgerEntry): boolean {
  if (isInvestmentEntry(entry)) return true;
  if (entry.kind === "income" && entry.subCategory === "투자수익") return true;
  if (entry.kind === "expense" && entry.category === "재테크") return true;
  return false;
}

export type CategoryType = "income" | "transfer" | "savings" | "fixed" | "variable";

/** 재테크/저축 탭에서 보여줄 대분류 (항상 포함해 이전 저장 데이터와 호환) */
const SAVINGS_CATEGORIES_FALLBACK = ["재테크", "저축성지출"] as const;

/**
 * 재테크·저축성지출 카테고리 목록. 저장된 설정에 "재테크"가 없어도 항상 포함.
 */
export function getSavingsCategories(categoryPresets?: CategoryPresets): string[] {
  const fromPreset = categoryPresets?.categoryTypes?.savings;
  const result = new Set<string>(SAVINGS_CATEGORIES_FALLBACK);
  if (Array.isArray(fromPreset) && fromPreset.length > 0) {
    fromPreset.forEach((c) => result.add(c));
  }
  return Array.from(result);
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

// 저축성지출 카테고리 Set을 categoryPresets 참조별로 캐시.
// 수천 건 ledger 루프에서 매번 Set을 재생성하던 핫 경로 제거.
// (동일 categoryPresets 참조가 들어오면 Set 재사용, 바뀌면 새로 계산)
const _savingsSetCache = new WeakMap<object, Set<string>>();
// categoryPresets가 undefined인 경우(fallback만 사용) 전용 Set — 재사용 가능한 기본값
let _defaultSavingsSet: Set<string> | null = null;

function getSavingsSet(categoryPresets?: CategoryPresets): Set<string> {
  if (!categoryPresets) {
    if (!_defaultSavingsSet) {
      _defaultSavingsSet = new Set<string>(getSavingsCategories());
    }
    return _defaultSavingsSet;
  }
  let cached = _savingsSetCache.get(categoryPresets);
  if (!cached) {
    cached = new Set<string>(getSavingsCategories(categoryPresets));
    _savingsSetCache.set(categoryPresets, cached);
  }
  return cached;
}

/**
 * 가계부 단일 소스: 저축성지출 여부 (= 자산 계좌로 이동한 지출, 실질 소비 아님).
 * kind === "expense" && 대분류가 저축성지출 카테고리.
 * 단, subCategory === "투자손실"은 실질 지출이므로 false 반환 (부풀려 집계 방지).
 */
export function isSavingsExpenseEntry(
  entry: LedgerEntry,
  accounts: Account[],
  categoryPresets?: CategoryPresets
): boolean {
  if (entry.kind !== "expense") return false;
  if (entry.subCategory === "투자손실") return false;
  return getSavingsSet(categoryPresets).has(entry.category);
}

/**
 * 핫 루프 전용 — 저축성지출 카테고리 Set을 한 번만 만들고 반환되는 predicate로
 * 수천 건 배열을 순회할 때 Set/Array 재생성 비용 제거.
 * (isSavingsExpenseEntry도 이제 내부 캐시가 있어서 동일한 성능이지만, 의도가 명확한
 *  hot-loop API로 남겨둠.)
 *
 * 사용 예:
 *   const isSavings = makeIsSavingsExpense(categoryPresets);
 *   for (const l of ledger) if (isSavings(l)) { ... }
 */
export function makeIsSavingsExpense(
  categoryPresets?: CategoryPresets
): (entry: LedgerEntry) => boolean {
  const savingsSet = getSavingsSet(categoryPresets);
  return (entry) =>
    entry.kind === "expense" &&
    entry.subCategory !== "투자손실" &&
    savingsSet.has(entry.category);
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

  // 주거비의 중분류 "주담대이자"도 고정지출로 처리
  if (category === "주거비" && subCategory === "주담대이자") {
    return true;
  }

  return false;
}
