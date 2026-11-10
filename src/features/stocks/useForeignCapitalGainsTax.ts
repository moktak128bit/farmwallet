/**
 * 미국주식 양도소득세 계산 단일 진입점 — 주식 탭 양도세 카드와 배당 탭·대시보드 '절세 액션'이 같은 입력
 * (store 거래·시세·계좌, FxRateContext 환율, buildFxHistory 환율 이력)으로 같은 결과를 쓴다.
 * 카드마다 따로 계산하면 환율·이력 로딩 시점에 따라 "비과세 338,260"과 "250만 중 275,832 남음"처럼 갈렸다.
 */
import { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { computePositions } from "../../calculations";
import { isUSDStock } from "../../utils/finance";
import { buildFxHistory } from "../../utils/portfolioHistory";
import { buildForeignCapitalGainsTax } from "../../utils/usCapitalGainsTax";

export function useForeignCapitalGainsTax(year: number) {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const prices = useAppStore((s) => s.data.prices);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const hasUsd = useMemo(() => trades.some((t) => isUSDStock(t.ticker)), [trades]);
  const fxHistory = useMemo(() => buildFxHistory(historicalDailyFx, marketEnvSnapshots), [historicalDailyFx, marketEnvSnapshots]);
  return useMemo(() => {
    if (!hasUsd) return null;
    const positions = computePositions(trades, prices, accounts, { fxRate: fxRate ?? undefined });
    return buildForeignCapitalGainsTax({ trades, positions, year, fxHistory, fxRate });
  }, [hasUsd, trades, prices, accounts, fxHistory, fxRate, year]);
}
