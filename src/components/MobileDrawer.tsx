/**
 * 모바일 햄버거 메뉴 드로어.
 * - useFocusTrap: 열릴 때 첫 포커스(닫기 버튼) + Tab 순환, 닫힐 때 햄버거 버튼으로 포커스 복귀
 * - useModalStackEntry: 다른 모달과 중첩 시 최상위일 때만 ESC로 닫힘
 * - ESC는 패널 자체(onKeyDown)에서 처리 — aria-hidden 오버레이에 키 핸들러를 두지 않는다
 */
import React from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({ open, onClose, children }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const isTopModal = useModalStackEntry(open);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    // 모달 중첩 시 최상위 모달만 ESC로 닫힘
    if (!isTopModal()) return;
    e.stopPropagation();
    onClose();
  };

  return (
    <>
      <div className="drawer-overlay" role="presentation" onClick={onClose} aria-hidden />
      <div
        ref={trapRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="메뉴"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>메뉴</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        {children}
      </div>
    </>
  );
};
