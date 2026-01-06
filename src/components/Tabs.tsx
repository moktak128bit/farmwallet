import React from "react";
import {
  LayoutDashboard,
  Wallet,
  BookOpen,
  TrendingUp,
  CircleDollarSign,
  PiggyBank,
  Tags,
  Settings,
  CreditCard,
  FileText
} from "lucide-react";

export type TabId =
  | "accounts"
  | "ledger"
  | "stocks"
  | "dashboard"
  | "dividends"
  | "debt"
  | "budget"
  | "categories"
  | "settings"
  | "reports";

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: "dashboard", label: "대시보드", icon: <LayoutDashboard size={18} /> },
  { id: "accounts", label: "계좌", icon: <Wallet size={18} /> },
  { id: "ledger", label: "가계부", icon: <BookOpen size={18} /> },
  { id: "stocks", label: "주식", icon: <TrendingUp size={18} /> },
  { id: "dividends", label: "배당/이자", icon: <CircleDollarSign size={18} /> },
  { id: "debt", label: "부채", icon: <CreditCard size={18} /> },
  { id: "budget", label: "예산/반복", icon: <PiggyBank size={18} /> },
  { id: "categories", label: "카테고리", icon: <Tags size={18} /> },
  { id: "reports", label: "리포트", icon: <FileText size={18} /> },
  { id: "settings", label: "백업/설정", icon: <Settings size={18} /> }
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
}

export const Tabs: React.FC<Props> = ({ active, onChange }) => {
  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`tab-button ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.icon}
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
};
