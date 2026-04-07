import { useRef, useCallback } from "react";

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

/**
 * 좌/우 스와이프 감지 훅
 * @param onSwipeLeft 왼쪽 스와이프 콜백
 * @param onSwipeRight 오른쪽 스와이프 콜백
 * @param threshold 최소 스와이프 거리 (px, 기본 80)
 */
export function useSwipe(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void,
  threshold = 80,
): SwipeHandlers {
  const startX = useRef(0);
  const startY = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      // 수직 스크롤이 아닌 수평 스와이프만 감지
      if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    },
    [onSwipeLeft, onSwipeRight, threshold],
  );

  return { onTouchStart, onTouchEnd };
}
