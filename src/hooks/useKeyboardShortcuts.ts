import { useEffect } from "react";
import type { TabId } from "../components/Tabs";
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
}

export function useKeyboardShortcuts({
  tab,
  setTab,
  onUndo,
  onRedo,
  onSearch,
  onShortcutsHelp,
  onSave,
  onAddLedger
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S (저장)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }

      // Ctrl+N (가계부 추가)
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
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
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        onSearch();
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
  }, [tab, setTab, onUndo, onRedo, onSearch, onShortcutsHelp, onSave, onAddLedger]);
}
