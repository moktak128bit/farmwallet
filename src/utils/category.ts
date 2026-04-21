import {
  getCategoryType,
  getSavingsCategories,
  isSavingsExpenseEntry,
  makeIsSavingsExpense,
  type CategoryType
} from "./categoryUtils";
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
  makeIsSavingsExpense,
  recommendCategory,
  autoCategorize,
  learnFromEntry,
  loadSavedRules,
  saveRules,
  applyAutoCategorization
};

