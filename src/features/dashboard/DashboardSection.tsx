/**
 * 대시보드 접이식 섹션 — 핵심 카드 아래의 위젯 묶음(자산·투자 / 이번 달 소비 / 배당·저축·세금).
 * 카드 25장이 같은 무게로 세로로 쌓여 10,000px가 넘던 페이지에 위계를 준다:
 * 기본은 접힘, 접힌 줄에는 그 묶음의 대표 숫자 한 줄(summary). 펼침 상태는 localStorage에 기억.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { STORAGE_KEYS } from "../../constants/config";

function readOpenMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DASHBOARD_SECTIONS);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    const map = readOpenMap();
    map[id] = open;
    window.localStorage.setItem(STORAGE_KEYS.DASHBOARD_SECTIONS, JSON.stringify(map));
  } catch {
    // 저장 실패는 치명적이지 않다 — 다음 방문에 기본값으로 돌아갈 뿐
  }
}

interface Props {
  id: string;
  title: string;
  /** 접혀 있을 때 제목 옆에 보여줄 대표 숫자 한 줄 (예: "순자산 6,502만 원") */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const DashboardSection: React.FC<Props> = ({ id, title, summary, defaultOpen = false, children }) => {
  const [open, setOpen] = useState<boolean>(() => readOpenMap()[id] ?? defaultOpen);
  const bodyId = `dash-section-${id}`;
  const toggle = () => {
    setOpen((v) => {
      writeOpen(id, !v);
      return !v;
    });
  };
  return (
    <section>
      <button type="button" className="dash-section-toggle" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="dash-section-title">{title}</span>
        {!open && summary && <span className="dash-section-summary">{summary}</span>}
        <span className="dash-section-hint">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div id={bodyId} style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 16 }}>
          {children}
        </div>
      )}
    </section>
  );
};
