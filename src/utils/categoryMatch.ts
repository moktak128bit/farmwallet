/**
 * 배당·이자 카테고리 판정 헬퍼.
 *
 * 기존 코드는 substring `includes("배당")`을 사용해
 * "비배당주식", "세금감면-배당" 같은 다른 문자열에도 매치되는 위양성이 있었음.
 * 정확 매칭을 위한 단일 진입점.
 *
 * 정책:
 * - category 또는 subCategory가 정확히 "배당" / "이자"여야 함
 * - 또는 끝이 "-배당" / "-이자"인 경우(예: "수입-배당")까지 허용
 * - description은 필요한 화면에서만 별도로 fallback
 */

const DIVIDEND_EXACT = /^(배당|.+-배당)$/;
const INTEREST_EXACT = /^(이자|.+-이자)$/;

export function isDividendCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return DIVIDEND_EXACT.test(name);
}

export function isInterestCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return INTEREST_EXACT.test(name);
}

export function isDividendEntry(entry: { category?: string | null; subCategory?: string | null }): boolean {
  return isDividendCategoryName(entry.category) || isDividendCategoryName(entry.subCategory);
}

export function isInterestEntry(entry: { category?: string | null; subCategory?: string | null }): boolean {
  return isInterestCategoryName(entry.category) || isInterestCategoryName(entry.subCategory);
}
