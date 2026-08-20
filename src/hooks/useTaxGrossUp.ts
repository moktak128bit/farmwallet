/**
 * 종합과세 트래커/세금 보고서 "세전 환산(gross-up)" 토글 — localStorage(STORAGE_KEYS.TAX_GROSS_UP) 저장, 기본 off.
 * 배당 탭 카드와 보고서 탭이 같은 값을 읽어야 하므로 같은 창 안 변경은 커스텀 이벤트로, 다른 탭은 storage 이벤트로 전파한다
 * (hooks/useDateAccountSettings 패턴).
 */
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";

const CHANGE_EVENT = "fw-tax-gross-up-change";

export function readTaxGrossUp(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(STORAGE_KEYS.TAX_GROSS_UP) === "true"; } catch { return false; }
}

export function writeTaxGrossUp(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(STORAGE_KEYS.TAX_GROSS_UP, "true");
    else localStorage.removeItem(STORAGE_KEYS.TAX_GROSS_UP);
  } catch { /* 저장 실패(쿼터 등)해도 이번 세션 표시는 이벤트로 맞춘다 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** [켜짐 여부, 설정 함수] — 같은 창의 다른 컴포넌트·다른 탭 변경도 즉시 반영 */
export function useTaxGrossUp(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readTaxGrossUp());
  useEffect(() => {
    const sync = () => setOn(readTaxGrossUp());
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEYS.TAX_GROSS_UP) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);
  const set = useCallback((v: boolean) => writeTaxGrossUp(v), []);
  return [on, set];
}
