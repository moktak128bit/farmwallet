/**
 * 모바일(≤768px) 하단 탭바 + 빠른 입력 FAB.
 * - 표시/숨김은 CSS(.bottom-nav/.fab는 768px 초과에서 display:none)
 * - 모달·드로어 열림(modalStack 깊이>0) 또는 텍스트 입력 포커스/iOS 키보드(visualViewport 축소) 중엔 렌더하지 않음
 * - 상태는 uiStore 직접 구독(App.tsx props 불변). "더보기"는 기존 드로어(전체 탭)를 연다.
 */
import React, { useEffect, useState } from "react";
import { LayoutDashboard, BookOpen, TrendingUp, CircleDollarSign, Menu, Plus } from "lucide-react";
import type { TabId } from "./ui/Tabs";
import { useUIStore } from "../store/uiStore";
import { useModalDepth } from "../utils/modalStack";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const ITEMS: NavItem[] = [
  { id: "dashboard", label: "대시보드", icon: <LayoutDashboard size={20} aria-hidden /> },
  { id: "ledger", label: "가계부", icon: <BookOpen size={20} aria-hidden /> },
  { id: "stocks", label: "주식", icon: <TrendingUp size={20} aria-hidden /> },
  { id: "dividends", label: "배당", icon: <CircleDollarSign size={20} aria-hidden /> },
];

const PRIMARY_IDS = new Set<TabId>(ITEMS.map((i) => i.id));

function isTextInput(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset", "range", "file", "color"].includes(type);
  }
  return el.isContentEditable;
}

/** 텍스트 입력 포커스 또는 iOS 소프트 키보드(visualViewport 축소) 감지 */
function useKeyboardOpen(): boolean {
  const [inputFocused, setInputFocused] = useState(false);
  const [viewportShrunk, setViewportShrunk] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onFocusIn = (e: FocusEvent) => setInputFocused(isTextInput(e.target as Element | null));
    const onFocusOut = () => setInputFocused(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      // 키보드가 뜨면 visualViewport 높이만 줄어든다(레이아웃 뷰포트는 그대로) — 150px 이상 차이를 키보드로 간주
      setViewportShrunk(window.innerHeight - vv.height > 150);
    };
    vv.addEventListener("resize", check);
    check();
    return () => vv.removeEventListener("resize", check);
  }, []);

  return inputFocused || viewportShrunk;
}

export const MobileBottomNav: React.FC = () => {
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);
  const setMobileDrawerOpen = useUIStore((s) => s.setMobileDrawerOpen);
  const setShowQuickEntry = useUIStore((s) => s.setShowQuickEntry);
  const modalDepth = useModalDepth();
  const keyboardOpen = useKeyboardOpen();

  if (modalDepth > 0 || keyboardOpen) return null;

  const moreActive = !PRIMARY_IDS.has(tab);

  return (
    <>
      <button
        type="button"
        className="fab"
        aria-label="빠른 입력"
        title="빠른 입력 (Ctrl+Shift+K)"
        onClick={() => setShowQuickEntry(true)}
      >
        <Plus size={26} aria-hidden />
      </button>
      <nav className="bottom-nav" aria-label="하단 탭">
        {ITEMS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setMobileDrawerOpen(false);
                setTab(item.id);
              }}
            >
              {item.icon}
              <span className="bottom-nav-label">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-item${moreActive ? " active" : ""}`}
          aria-haspopup="dialog"
          aria-label={moreActive ? "더보기 (현재 탭 포함)" : "더보기"}
          onClick={() => setMobileDrawerOpen(true)}
        >
          <Menu size={20} aria-hidden />
          <span className="bottom-nav-label">더보기</span>
        </button>
      </nav>
    </>
  );
};
