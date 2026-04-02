import React, { createContext, useContext } from "react";
import { useFxRate } from "../hooks/useFxRate";

const FxRateContext = createContext<number | null>(null);

/** 앱 전역에서 USD/KRW 환율을 한 번만 조회합니다. */
export function FxRateProvider({ children }: { children: React.ReactNode }) {
  const fxRate = useFxRate();
  return <FxRateContext.Provider value={fxRate}>{children}</FxRateContext.Provider>;
}

export function useFxRateValue(): number | null {
  return useContext(FxRateContext);
}
