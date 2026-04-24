/**
 * 카테고리 분류 헬퍼 모음 (barrel).
 *
 * 도메인 분리:
 * - categoryUtils: 카테고리 타입 분류 (저축성/투자/이체)
 * - categoryRecommendation: 메모 기반 추천 (QuickEntry 등에서 직접 import 권장)
 * - autoCategorization: 룰 기반 학습 분류 — 현재 미사용으로 별도 import 없음
 */

import {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry,
  makeIsSavingsExpense,
  isInvestmentEntry,
  type CategoryType,
} from "./categoryUtils";

export type { CategoryType };
export {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry,
  makeIsSavingsExpense,
  isInvestmentEntry,
};
