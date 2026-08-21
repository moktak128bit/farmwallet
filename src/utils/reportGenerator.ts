// reportGenerator.ts — 관심사별로 src/utils/reports/*.ts 로 분해됨 (5-6, 순수 이동).
// 기존 import 경로(`from "../utils/reportGenerator"`)를 그대로 유지하기 위한 re-export 껍데기.
// 새 코드는 가능하면 아래 각 파일에서 직접 import할 것.

export type {
  MonthlyReport,
  MonthlyIncomeDetail,
  CategoryReport,
  StockPerformanceReport,
  AccountReport
} from "./reports/monthly";
export {
  generateMonthlyReport,
  generateYearlyReport,
  generateCategoryReport,
  generateStockPerformanceReport,
  generateAccountReport,
  generateMonthlyIncomeDetail
} from "./reports/monthly";

export type { DailyReport, ClosingReportData } from "./reports/closing";
export { generateDailyReport, generateClosingReportData } from "./reports/closing";

export type {
  AccountPerformanceBreakdownRow,
  InvestmentReconciliation
} from "./reports/investmentReconciliation";
export {
  generateAccountPerformanceBreakdown,
  computeInvestmentReconciliation
} from "./reports/investmentReconciliation";

export type { ConsumptionImpactMonthlyRow } from "./reports/consumption";
export { generateConsumptionImpactMonthlyReport } from "./reports/consumption";

export type { ComprehensiveMonthlyRow } from "./reports/comprehensive";
export { generateComprehensiveMonthlyReport } from "./reports/comprehensive";
