import type { CategoryPresets, LedgerEntry } from "../types";

/**
 * 카테고리 프리셋에서 "고정비로 간주할 카테고리 이름 집합"을 만든다.
 * - categoryTypes.fixed에 적힌 대분류
 * - 그 대분류에 속하는 모든 중분류 (expenseDetails에서 매핑)
 *
 * 예: fixed=["주거"], expenseDetails=[{main:"주거", subs:["월세","관리비"]}]
 *  → {"주거","월세","관리비"}
 */
export function buildFixedCategorySet(presets: CategoryPresets | undefined): Set<string> {
  const fixedMains = new Set(presets?.categoryTypes?.fixed ?? []);
  const fixedCats = new Set<string>(fixedMains);
  for (const g of presets?.expenseDetails ?? []) {
    if (fixedMains.has(g.main)) {
      for (const s of g.subs) fixedCats.add(s);
    }
  }
  return fixedCats;
}

/**
 * 단일 지출 항목이 고정비인지 판정.
 * 우선순위:
 *  1) 항목의 isFixedExpense 플래그 (사용자가 명시적으로 고정 처리)
 *  2) subCategory 또는 category가 fixedCats에 포함되는지
 *
 * 카테고리 매칭은 trim 후 비교 — 좌우 공백 차이로 인한 누락 방지.
 */
export function isFixedExpense(l: LedgerEntry, fixedCats: Set<string>): boolean {
  if (l.isFixedExpense) return true;
  const cat = (l.subCategory || l.category || "").trim();
  if (fixedCats.has(cat)) return true;
  if (fixedCats.has((l.category || "").trim())) return true;
  return false;
}
