import type { TabId } from "../components/ui/Tabs";

export const TAB_ORDER: TabId[] = [
  "dashboard",
  "investment-record",
  "accounts",
  "ledger",
  "stocks",
  "insights",
  "dividends",
  "debt",
  "spend",
  "budget",
  "workout",
  "categories",
  "reports",
  "settings"
];

export const TAB_NAMES: Record<TabId, string> = {
  dashboard: "대시보드",
  "investment-record": "투자기록",
  accounts: "계좌",
  ledger: "가계부",
  stocks: "주식",
  insights: "인사이트",
  dividends: "배당",
  debt: "대출",
  spend: "소비",
  budget: "예산",
  workout: "운동",
  categories: "카테고리",
  reports: "리포트",
  settings: "설정"
};
