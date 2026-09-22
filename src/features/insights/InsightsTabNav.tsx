/**
 * 인사이트 탭 네비게이션 — InsightsPage에서 분리. React.memo.
 * setTab(setState)은 참조가 안정적이므로 memo가 효과를 가진다.
 */
import React from "react";

export type TabId = "overview" | "expense" | "income" | "asset" | "invest" | "date" | "pattern";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "종합" },
  { id: "expense", label: "지출·구독" },
  { id: "income", label: "수입 구조" },
  { id: "asset", label: "자산 분석" },
  { id: "invest", label: "투자 포트폴리오" },
  { id: "date", label: "데이트" },
  { id: "pattern", label: "패턴·재미" },
];

interface Props {
  tab: TabId;
  onSelectTab: (id: TabId) => void;
  /** 특정 월 선택 시 우측에 표시할 라벨 (예: "6월"). 없으면 null. */
  selMonthLabel: string | null;
}

export const InsightsTabNav = React.memo(function InsightsTabNav({ tab, onSelectTab, selMonthLabel }: Props) {
  return (
    <div role="tablist" aria-label="인사이트 탭" style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", flexWrap: "nowrap", alignItems: "center" }}>
      {TABS.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onSelectTab(t.id)}
          className={tab === t.id ? "primary" : "secondary"}
          style={{ fontSize: 13, padding: "6px 12px", whiteSpace: "nowrap" }}
        >{t.label}</button>
      ))}
      {selMonthLabel && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", fontWeight: 600, alignSelf: "center", whiteSpace: "nowrap" }}>{selMonthLabel} 선택됨</span>}
    </div>
  );
});
