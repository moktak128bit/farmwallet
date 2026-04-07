import { useEffect, useRef } from "react";

/**
 * 모달/다이얼로그 포커스 트랩 훅
 * - 열릴 때 첫 포커스 가능 요소에 포커스
 * - Tab/Shift+Tab이 모달 내부에서만 순환
 * - 닫힐 때 이전 포커스 요소로 복원
 */
export function useFocusTrap<T extends HTMLElement>(isOpen: boolean) {
  const ref = useRef<T>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocus.current = document.activeElement as HTMLElement;

    const container = ref.current;
    if (!container) return;

    const focusables = () =>
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

    // 첫 포커스 가능 요소에 포커스
    requestAnimationFrame(() => {
      const els = focusables();
      if (els.length > 0) els[0].focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;

      const first = els[0];
      const last = els[els.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [isOpen]);

  return ref;
}
