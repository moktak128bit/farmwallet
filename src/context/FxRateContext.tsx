import React, { createContext, useContext } from "react";
import { useFxRateInfo, type FxRateInfo } from "../hooks/useFxRate";

const DEFAULT_INFO: FxRateInfo = { rate: null, fetchedAt: null, isStale: false };
const FxRateContext = createContext<FxRateInfo>(DEFAULT_INFO);

/** 앱 전역에서 USD/KRW 환율을 한 번만 조회합니다 (신선도 정보 포함). */
export function FxRateProvider({ children }: { children: React.ReactNode }) {
  const info = useFxRateInfo();
  return <FxRateContext.Provider value={info}>{children}</FxRateContext.Provider>;
}

/** 환율 숫자만 반환 (기존 호환 — 합산·환산용). */
export function useFxRateValue(): number | null {
  return useContext(FxRateContext).rate;
}

/** 환율 + 신선도(isStale/fetchedAt) 반환 — 묵은 환율 경고 표시용. */
export function useFxRateInfoValue(): FxRateInfo {
  return useContext(FxRateContext);
}
