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

function isDividendCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return DIVIDEND_EXACT.test(name);
}

function isInterestCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return INTEREST_EXACT.test(name);
}

export function isDividendEntry(entry: { category?: string | null; subCategory?: string | null }): boolean {
  return isDividendCategoryName(entry.category) || isDividendCategoryName(entry.subCategory);
}

export function isInterestEntry(entry: { category?: string | null; subCategory?: string | null }): boolean {
  return isInterestCategoryName(entry.category) || isInterestCategoryName(entry.subCategory);
}

type LooseEntry = { category?: string | null; subCategory?: string | null; description?: string | null };

/**
 * 느슨한 배당 판정 — category/subCategory 정확 매칭(isDividendEntry) 또는 description에 "배당" 포함.
 * 앱이 생성한 배당 항목은 본문에 "TICKER - Name 배당"을 기록하므로, 화면 집계(배당 합계·평단·커버리지 등)
 * 에서는 description fallback이 필요하다. 여러 화면이 같은 술어를 복붙하던 것을 단일화한다.
 * ⚠ 세금·리포트 등 '정확'만 필요한 곳은 description 위양성 방지를 위해 isDividendEntry(정확)를 쓸 것.
 */
export function isDividendEntryLoose(entry: LooseEntry): boolean {
  return isDividendEntry(entry) || (entry.description ?? "").includes("배당");
}

/** 느슨한 이자 판정 — isInterestEntry(정확) 또는 description에 "이자" 포함. (배당 loose와 동일 정책) */
export function isInterestEntryLoose(entry: LooseEntry): boolean {
  return isInterestEntry(entry) || (entry.description ?? "").includes("이자");
}
