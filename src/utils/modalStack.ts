/**
 * 모달 ESC 중첩 처리용 간단 스택.
 * 모달이 열릴 때 등록 순서대로 쌓고, ESC는 "최상위" 모달만 처리하게 한다.
 * (ShortcutsHelp/ConfirmModal/SearchModal 등이 동시에 열려 있을 때
 *  ESC 한 번에 전부 닫히는 문제 방지)
 *
 * 부가 기능:
 * - subscribeModalStack / getModalDepth — 하단 탭바(모달 열림 시 숨김)·뒤로가기(historyNav) 연동용 구독.
 * - closeTopModal — 뒤로가기(popstate)에서 최상위 모달을 닫기 위한 진입점. 모달마다 닫기 API가 달라
 *   (window keydown ESC / 패널 onKeyDown ESC) 합성 Escape keydown을 포커스 요소에서 버블링시켜 처리한다.
 *   최상위 모달만 ESC를 처리하는 기존 계약(isTopModal) 덕분에 한 번에 하나만 닫힌다.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

let stack: number[] = [];
let seq = 0;
const listeners = new Set<() => void>();
let notifyScheduled = false;

/**
 * 구독자 알림은 microtask로 한 틱 모아서 보낸다(동기 호출 아님).
 * React 18 StrictMode는 개발 모드에서 신규 마운트 시 effect를 "설정→해제→재설정"으로 한 번 더
 * 검증 실행하는데, useModalStackEntry가 이 사이클마다 pushModal/popModal을 그대로 호출하면
 * 구독자(historyNav 등)가 0→1→0→1로 깜빡이는 중간값(0)을 실제 변화로 오인해 반응한다.
 * historyNav는 깊이 감소를 "X 버튼/ESC로 자체 닫힘"으로 해석해 history.back()까지 호출하므로,
 * 이 오인 신호 하나가 방금 연 모달을 즉시 저절로 닫아버리는 결과로 이어진다(재현: 가계부 일괄편집,
 * 반복지출 미등록 팝오버). push/pop이 같은 동기 구간에서 상쇄되면 구독자는 최종값만 봐야 한다.
 */
function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // 구독자 오류가 다른 구독자/모달 동작을 막지 않게
      }
    });
  });
}

/** 모달 열림 시 호출 — 스택에 쌓고 토큰 반환 */
function pushModal(): number {
  seq += 1;
  stack.push(seq);
  notify();
  return seq;
}

/** 모달 닫힘 시 호출 — 스택에서 제거 */
function popModal(token: number): void {
  const before = stack.length;
  stack = stack.filter((t) => t !== token);
  if (stack.length !== before) notify();
}

/** 해당 토큰이 현재 최상위 모달인지 */
function isTopModal(token: number | null): boolean {
  return token != null && stack.length > 0 && stack[stack.length - 1] === token;
}

/** 현재 열린(스택에 등록된) 모달 개수 */
export function getModalDepth(): number {
  return stack.length;
}

/** 모달 스택 변경 구독 — 해제 함수 반환 */
export function subscribeModalStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 최상위 모달 닫기 시도(뒤로가기 연동용). 열린 모달이 없으면 false.
 * 합성 Escape keydown을 현재 포커스 요소(없으면 body)에서 버블링 — 각 모달의 ESC 핸들러가 isTopModal()로
 * 최상위만 반응한다. 실제 닫힘 여부는 모달 구현에 달려 있으므로 호출자는 depth 변화로 확인해야 한다.
 */
export function closeTopModal(): boolean {
  if (stack.length === 0 || typeof document === "undefined") return false;
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

/** 현재 모달 깊이를 구독하는 훅 (하단 탭바 숨김 등) */
export function useModalDepth(): number {
  return useSyncExternalStore(subscribeModalStack, getModalDepth, () => 0);
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
