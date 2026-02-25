import {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry,
  type CategoryType
} from "./categoryUtils";
import { normalizeCategory, normalizeSubCategory } from "./categoryNormalize";
import { recommendCategory } from "./categoryRecommendation";
import {
  autoCategorize,
  learnFromEntry,
  loadSavedRules,
  saveRules,
  applyAutoCategorization
} from "./autoCategorization";

export type { CategoryType };
export {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry,
  normalizeCategory,
  normalizeSubCategory,
  recommendCategory,
  autoCategorize,
  learnFromEntry,
  loadSavedRules,
  saveRules,
  applyAutoCategorization
};

export const CategoryNormalizer = {
  normalizeCategory,
  normalizeSubCategory
};

export const CategoryClassifier = {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry
};

export const CategoryRecommendation = {
  recommendCategory
};

export const CategoryAutomation = {
  autoCategorize,
  learnFromEntry,
  loadSavedRules,
  saveRules,
  applyAutoCategorization
};
