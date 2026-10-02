/**
 * 앱 전역 시세 갱신 — App에서 1회 마운트.
 *
 * 예전엔 시세 갱신이 주식 탭 안에서만 돌았다(탭 진입 시 stale 갱신 + 옵트인 30분 자동 갱신).
 * 대시보드·가계부만 쓰는 날이 이어지면 시세가 열흘씩 멈춰 순자산·평가손익·포트폴리오 비중이 전부 옛값이었다.
 * 이제 어느 탭에서든:
 *  - 앱을 열 때(보유 종목이 로드된 직후) · 다시 볼 때(visibilitychange) 마지막 갱신 "시도"가 STALE_MS 넘었으면 1회 갱신
 *  - 가격 API 자동 갱신(설정 옵트인, 30분)도 여기서 — 주식 탭 인스턴스와 중복 interval을 만들지 않는다
 * 갱신은 useQuoteRefresh의 자동 경로(handleRefreshQuotesAuto: tickerDatabase·ticker.json 미변경, 토스트 없음)를 쓴다.
 * 판정 기준은 시세 updatedAt(체결 시각)이 아니라 "시도" 시각 — 장외엔 체결 시각이 멈춰 매번 발사되는 것을 막는다.
 */
import { useCallback, useEffect, useRef } from "react";
import type { StockPrice, StockTrade, TickerInfo } from "../../types";
import { usePriceAutoRefresh } from "../../hooks/usePriceAutoRefresh";
import { getLastQuoteRefreshAt, useQuoteRefresh } from "./useQuoteRefresh";

/** 마지막 갱신 시도 후 이 시간이 지나야 앱 열기·복귀 시 다시 갱신 */
const STALE_MS = 10 * 60 * 1000;

export function useBackgroundQuoteRefresh(params: {
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  fxRate: number | null;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[] | ((prev: TickerInfo[]) => TickerInfo[])) => void;
  /** 데이터 로드 실패 등으로 저장이 막힌 상태면 false — 갱신 결과가 저장 차단 상태를 흔들지 않게 */
  enabled: boolean;
}): void {
  const { trades, prices, tickerDatabase, fxRate, onChangePrices, onChangeTickerDatabase, enabled } = params;
  const fxRef = useRef(fxRate);
  fxRef.current = fxRate;
  // 환율은 FxRateContext가 따로 갱신한다 — 코인 원화 환산에는 지금 값을 쓴다
  const updateFxRate = useCallback(async () => fxRef.current, []);

  const { handleRefreshQuotesAuto } = useQuoteRefresh({
    trades,
    prices,
    tickerDatabase,
    fxRate,
    updateFxRate,
    onChangePrices,
    onChangeTickerDatabase,
  });
  const refreshRef = useRef(handleRefreshQuotesAuto);
  refreshRef.current = handleRefreshQuotesAuto;

  const hasTrades = trades.length > 0;
  useEffect(() => {
    if (!enabled || !hasTrades || typeof document === "undefined") return;
    const refreshIfStale = () => {
      if (document.hidden) return;
      if (Date.now() - getLastQuoteRefreshAt() <= STALE_MS) return;
      void refreshRef.current();
    };
    refreshIfStale();
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => document.removeEventListener("visibilitychange", refreshIfStale);
  }, [enabled, hasTrades]);

  usePriceAutoRefresh({ enabled: enabled ? undefined : false, onRefresh: handleRefreshQuotesAuto });
}
