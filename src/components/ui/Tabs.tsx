import React, { useState, useRef, useEffect } from "react";
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
  MoreHorizontal
} from "lucide-react";

export type TabId =
  | "accounts"
  | "ledger"
  | "stocks"
  | "dashboard"
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

const CORE_TABS: TabId[] = ["dashboard", "accounts", "ledger", "stocks", "insights"];
const MORE_TABS: TabId[] = ["dividends", "debt", "spend", "budget", "workout", "categories", "reports", "settings"];

export const Tabs: React.FC<Props> = ({ active, onChange, onPrefetch, tabBadges }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const isActiveInMore = MORE_TABS.includes(active);

  const renderTab = (tabId: TabId) => {
    const tab = TABS.find((t) => t.id === tabId);
    if (!tab) return null;
    const badge = tabBadges?.[tab.id];
    return (
      <button
        key={tab.id}
        className={`tab-button ${active === tab.id ? "active" : ""}`}
        onClick={() => { onChange(tab.id); setMoreOpen(false); }}
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
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 10,
              background: "var(--danger)",
              color: "white",
              fontWeight: 600
            }}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="tabs">
      {CORE_TABS.map((tabId) => renderTab(tabId))}

      {/* 현재 활성 탭이 더보기에 있으면 코어 옆에 표시 */}
      {isActiveInMore && renderTab(active)}

      <span
        className="tab-separator"
        style={{
          width: 1,
          alignSelf: "stretch",
          backgroundColor: "var(--border)",
          margin: "4px 4px 4px 0"
        }}
        aria-hidden
      />

      <div ref={moreRef} style={{ position: "relative" }}>
        <button
          type="button"
          className={`tab-button ${isActiveInMore && !moreOpen ? "" : ""}`}
          onClick={() => setMoreOpen((p) => !p)}
          aria-label="더보기"
          style={{ gap: 4 }}
        >
          <MoreHorizontal size={18} />
          <span className="tab-label">더보기</span>
        </button>
        {moreOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 100,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "var(--shadow-lg, 0 4px 24px rgba(0,0,0,.12))",
              padding: "6px 0",
              minWidth: 160,
              display: "flex",
              flexDirection: "column"
            }}
          >
            {MORE_TABS.map((tabId) => renderTab(tabId))}
          </div>
        )}
      </div>
    </div>
  );
};
