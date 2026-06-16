import { useEffect } from "react";
import type { TabId } from "../components/ui/Tabs";
import { TAB_ORDER } from "../constants/tabs";

interface UseKeyboardShortcutsOptions {
  tab: TabId;
  setTab: (tab: TabId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSearch: () => void;
  onShortcutsHelp: () => void;
  onSave?: () => void;
  onAddLedger?: () => void;
  onQuickEntry?: () => void;
}

export function useKeyboardShortcuts({
  tab,
  setTab,
  onUndo,
  onRedo,
  onSearch,
  onShortcutsHelp,
  onSave,
  onAddLedger,
  onQuickEntry
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S (수동 백업) — 입력 필드 포커스 중에도 동작 (브라우저 저장 다이얼로그 방지 위해 preventDefault 필수)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }

      // 입력 필드(INPUT/TEXTAREA/contentEditable) 포커스 중에는 나머지 전역 단축키 무시
      // — 텍스트 입력 중 Ctrl+Z가 앱 데이터 전체 undo로 발동하는 문제 방지.
      //   Ctrl+Enter(폼 제출)·ESC는 shortcutManager 경로에서 별도 처리됨.
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" || // 드롭다운 조작 중 Ctrl+Z/탭전환 오발동 차단
          target.isContentEditable);
      if (isInputFocused) return;

      // Alt+N (가계부 추가) — Ctrl+N은 브라우저 예약키(새 창)라 동작하지 않아 Alt+N으로 재매핑
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onAddLedger?.();
        return;
      }

      // Ctrl+Z (실행 취소)
      if (e.ctrlKey && e.key === "z" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onUndo();
        return;
      }
      
      // Ctrl+Y 또는 Ctrl+Shift+Z (다시 실행)
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "z")) {
        e.preventDefault();
        onRedo();
        return;
      }
      
      // Alt+화살표 (탭 이동)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const currentIndex = TAB_ORDER.indexOf(tab);
          if (currentIndex === -1) return;
          const nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
          setTab(TAB_ORDER[nextIndex]);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const currentIndex = TAB_ORDER.indexOf(tab);
          if (currentIndex === -1) return;
          const nextIndex = (currentIndex + 1) % TAB_ORDER.length;
          setTab(TAB_ORDER[nextIndex]);
          return;
        }
      }
      
      // Ctrl+K (전역 검색)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        onSearch();
        return;
      }

      // Ctrl+Shift+K (빠른 가계부 입력)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "K" || e.key === "k")) {
        e.preventDefault();
        onQuickEntry?.();
        return;
      }
      
      // Ctrl+/ (단축키 도움말)
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        onShortcutsHelp();
        return;
      }

      // Ctrl+1-9 (탭 이동)
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < TAB_ORDER.length) {
          setTab(TAB_ORDER[index]);
        }
        return;
      }

      // F2 (편집 모드 - 현재 포커스된 항목 편집)
      if (e.key === "F2") {
        e.preventDefault();
        const activeElement = document.activeElement;
        if (activeElement && activeElement instanceof HTMLElement) {
          const editable = activeElement.closest("[data-editable]");
          if (editable) {
            editable.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tab, setTab, onUndo, onRedo, onSearch, onShortcutsHelp, onSave, onAddLedger, onQuickEntry]);
}
