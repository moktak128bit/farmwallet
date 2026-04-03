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

