/**
 * 인사이트 탭 네비게이션 — InsightsPage에서 분리. React.memo.
 * setTab(setState)은 참조가 안정적이므로 memo가 효과를 가진다.
 */
import React from "react";

export type TabId = "overview" | "expense" | "income" | "asset" | "invest" | "date" | "pattern";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "종합 대시보드", icon: "📊" },
  { id: "expense", label: "지출·구독", icon: "💸" },
  { id: "income", label: "수입 구조", icon: "💰" },
  { id: "asset", label: "자산 분석", icon: "🏦" },
  { id: "invest", label: "투자 포트폴리오", icon: "📈" },
  { id: "date", label: "데이트", icon: "💕" },
  { id: "pattern", label: "패턴·재미", icon: "🔍" },
];

interface Props {
  tab: TabId;
  onSelectTab: (id: TabId) => void;
  /** 특정 월 선택 시 우측에 표시할 라벨 (예: "6월"). 없으면 null. */
  selMonthLabel: string | null;
}

export const InsightsTabNav = React.memo(function InsightsTabNav({ tab, onSelectTab, selMonthLabel }: Props) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #eee", overflowX: "auto", flexWrap: "nowrap" }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => onSelectTab(t.id)} style={{
          padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
          fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
          background: tab === t.id ? "#1a1a2e" : "transparent", color: tab === t.id ? "#fff" : "#666", transition: "all 0.2s",
        }}>{t.icon} {t.label}</button>
      ))}
      {selMonthLabel && <span style={{ marginLeft: "auto", fontSize: 12, color: "#e94560", fontWeight: 700, alignSelf: "center", whiteSpace: "nowrap" }}>{selMonthLabel} 선택됨</span>}
    </div>
  );
});
