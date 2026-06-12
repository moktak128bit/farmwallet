/**
 * 모달 ESC 중첩 처리용 간단 스택.
 * 모달이 열릴 때 등록 순서대로 쌓고, ESC는 "최상위" 모달만 처리하게 한다.
 * (ShortcutsHelp/ConfirmModal/SearchModal 등이 동시에 열려 있을 때
 *  ESC 한 번에 전부 닫히는 문제 방지)
 */
import { useCallback, useEffect, useRef } from "react";

let stack: number[] = [];
let seq = 0;

/** 모달 열림 시 호출 — 스택에 쌓고 토큰 반환 */
function pushModal(): number {
  seq += 1;
  stack.push(seq);
  return seq;
}

/** 모달 닫힘 시 호출 — 스택에서 제거 */
function popModal(token: number): void {
  stack = stack.filter((t) => t !== token);
}

/** 해당 토큰이 현재 최상위 모달인지 */
function isTopModal(token: number | null): boolean {
  return token != null && stack.length > 0 && stack[stack.length - 1] === token;
}

/**
 * 모달 컴포넌트용 훅.
 * isOpen 동안 스택에 등록하고, "내가 최상위인가"를 검사하는 안정 함수를 돌려준다.
 * ESC 핸들러에서 `if (!isTop()) return;` 으로 사용.
 */
export function useModalStackEntry(isOpen: boolean): () => boolean {
  const tokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    tokenRef.current = pushModal();
    return () => {
      if (tokenRef.current != null) {
        popModal(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [isOpen]);
  return useCallback(() => isTopModal(tokenRef.current), []);
}
