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
  FileText,
  Dumbbell,
  ShoppingCart,
  Lightbulb,
  LineChart
} from "lucide-react";

export type TabId =
  | "accounts"
  | "ledger"
  | "stocks"
  | "dashboard"
  | "investment-record"
  | "dividends"
  | "debt"
  | "spend"
  | "budget"
  | "categories"
  | "settings"
  | "reports"
  | "workout"
  | "insights";

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: "dashboard", label: "대시보드", icon: <LayoutDashboard size={18} /> },
  { id: "investment-record", label: "투자기록", icon: <LineChart size={18} /> },
  { id: "accounts", label: "계좌", icon: <Wallet size={18} /> },
  { id: "ledger", label: "가계부", icon: <BookOpen size={18} /> },
  { id: "stocks", label: "주식", icon: <TrendingUp size={18} /> },
  { id: "insights", label: "인사이트", icon: <Lightbulb size={18} /> },
  { id: "dividends", label: "배당/이자", icon: <CircleDollarSign size={18} /> },
  { id: "debt", label: "부채", icon: <CreditCard size={18} /> },
  { id: "spend", label: "소비", icon: <ShoppingCart size={18} /> },
  { id: "budget", label: "예산/반복", icon: <PiggyBank size={18} /> },
  { id: "workout", label: "운동", icon: <Dumbbell size={18} /> },
  { id: "categories", label: "카테고리", icon: <Tags size={18} /> },
  { id: "reports", label: "리포트", icon: <FileText size={18} /> },
  { id: "settings", label: "백업/설정", icon: <Settings size={18} /> }
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
  onPrefetch?: (id: TabId) => void;
  tabBadges?: Partial<Record<TabId, string>>;
}

export const Tabs: React.FC<Props> = ({ active, onChange, onPrefetch, tabBadges }) => {
  return (
    <div className="tabs">
      {TABS.map((tab) => {
        const badge = tabBadges?.[tab.id];
        return (
          <button
            key={tab.id}
            className={`tab-button ${active === tab.id ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
            onMouseEnter={() => onPrefetch?.(tab.id)}
            onFocus={() => onPrefetch?.(tab.id)}
            onTouchStart={() => onPrefetch?.(tab.id)}
            type="button"
            aria-label={tab.label}
            aria-current={active === tab.id ? "true" : undefined}
          >
            {tab.icon}
            <span className="tab-label">{tab.label}</span>
            {badge && (
              <span
                className="tab-badge"
                style={{ marginLeft: 6, fontSize: 10, padding: "2px 6px", borderRadius: 10, background: "var(--danger)", color: "white", fontWeight: 600 }}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
