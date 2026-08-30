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
  Lightbulb
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
  | "reports"
  | "workout"
  | "insights";

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

interface TabGroup {
  /** 사이드바 섹션 라벨 — 12개 탭을 "무엇을 하려는지" 단위로 묶는다 */
  title: string;
  items: TabItem[];
}

/**
 * 탭 12개를 평평하게 나열하면 매일 쓰는 화면(가계부·대시보드)이 묻힌다.
 * 목적별 4그룹으로 묶어 스캔 비용을 줄인다. TabId·라우팅은 그대로.
 */
const TAB_GROUPS: TabGroup[] = [
  {
    title: "요약",
    items: [
      { id: "dashboard", label: "대시보드", icon: <LayoutDashboard size={16} /> },
      { id: "insights", label: "인사이트", icon: <Lightbulb size={16} /> },
      { id: "reports", label: "리포트", icon: <FileText size={16} /> }
    ]
  },
  {
    title: "가계부",
    items: [
      { id: "ledger", label: "가계부", icon: <BookOpen size={16} /> },
      { id: "budget", label: "예산/반복", icon: <PiggyBank size={16} /> },
      { id: "categories", label: "카테고리", icon: <Tags size={16} /> }
    ]
  },
  {
    title: "자산",
    items: [
      { id: "accounts", label: "계좌", icon: <Wallet size={16} /> },
      { id: "stocks", label: "주식", icon: <TrendingUp size={16} /> },
      { id: "dividends", label: "배당/이자", icon: <CircleDollarSign size={16} /> },
      { id: "debt", label: "부채", icon: <CreditCard size={16} /> }
    ]
  },
  {
    title: "기타",
    items: [
      { id: "workout", label: "운동", icon: <Dumbbell size={16} /> },
      { id: "settings", label: "백업/설정", icon: <Settings size={16} /> }
    ]
  }
];

/** 헤더 제목 등에서 쓰는 탭 라벨 */
export const TAB_LABELS: Record<TabId, string> = TAB_GROUPS.reduce(
  (acc, group) => {
    for (const item of group.items) acc[item.id] = item.label;
    return acc;
  },
  {} as Record<TabId, string>
);

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
  onPrefetch?: (id: TabId) => void;
  tabBadges?: Partial<Record<TabId, string>>;
}

export const Tabs: React.FC<Props> = ({ active, onChange, onPrefetch, tabBadges }) => {
  return (
    <div className="tabs">
      {TAB_GROUPS.map((group) => (
        <div className="nav-group" key={group.title}>
          <div className="nav-group-title">{group.title}</div>
          {group.items.map((tab) => {
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
                    aria-label={`알림 ${badge}`}
                    title={`알림 ${badge}`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
