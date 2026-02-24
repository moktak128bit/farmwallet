import type { TabId } from "../components/Tabs";

export const TAB_ORDER: TabId[] = [
  "dashboard",
  "accounts",
  "ledger",
  "stocks",
  "dividends",
  "debt",
  "budget",
  "workout",
  "categories",
  "reports",
  "settings"
];

export const TAB_NAMES: Record<TabId, string> = {
  dashboard: "대시보드",
  accounts: "계좌",
  ledger: "가계부",
  stocks: "주식",
  dividends: "배당",
  debt: "대출",
  budget: "예산",
  workout: "운동",
  categories: "카테고리",
  reports: "리포트",
  settings: "설정"
};
