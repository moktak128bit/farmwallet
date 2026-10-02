// @vitest-environment jsdom
/**
 * 앱 전역 시세 갱신(useBackgroundQuoteRefresh) — 시세가 주식 탭에서만 갱신돼 대시보드가 열흘씩 옛값이던 회귀 방지.
 * 마지막 갱신 "시도" 시각으로 stale 판정, 앱 열기(마운트)·복귀(visibilitychange) 때만 1회.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { StockTrade } from "../types";

const refreshAuto = vi.fn(() => Promise.resolve());
let lastAttemptAt = 0;

vi.mock("../features/stocks/useQuoteRefresh", () => ({
  getLastQuoteRefreshAt: () => lastAttemptAt,
  useQuoteRefresh: () => ({ handleRefreshQuotesAuto: refreshAuto }),
}));

import { useBackgroundQuoteRefresh } from "../features/stocks/useBackgroundQuoteRefresh";

const trade = { id: "T1", date: "2026-09-01", accountId: "ISA", ticker: "0183J0", name: "우주", side: "buy", quantity: 1, price: 8000, fee: 0, totalAmount: 8000, cashImpact: -8000 } as StockTrade;

const baseParams = (over: Partial<Parameters<typeof useBackgroundQuoteRefresh>[0]> = {}) => ({
  trades: [trade],
  prices: [],
  tickerDatabase: [],
  fxRate: 1400,
  onChangePrices: vi.fn(),
  onChangeTickerDatabase: vi.fn(),
  enabled: true,
  ...over,
});

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
};

beforeEach(() => {
  refreshAuto.mockClear();
  setHidden(false);
});

afterEach(() => {
  setHidden(false);
});

describe("useBackgroundQuoteRefresh", () => {
  it("마지막 시도가 10분 넘게 지났으면 앱을 열 때(어느 탭이든) 보유 종목을 1회 갱신", () => {
    lastAttemptAt = Date.now() - 11 * 60 * 1000;
    renderHook(() => useBackgroundQuoteRefresh(baseParams()));
    expect(refreshAuto).toHaveBeenCalledTimes(1);
  });

  it("10분 안에 시도했으면 갱신하지 않는다", () => {
    lastAttemptAt = Date.now() - 2 * 60 * 1000;
    renderHook(() => useBackgroundQuoteRefresh(baseParams()));
    expect(refreshAuto).not.toHaveBeenCalled();
  });

  it("로드 중·로드 실패(enabled=false)거나 거래가 없으면 갱신하지 않는다", () => {
    lastAttemptAt = 0;
    renderHook(() => useBackgroundQuoteRefresh(baseParams({ enabled: false })));
    renderHook(() => useBackgroundQuoteRefresh(baseParams({ trades: [] })));
    expect(refreshAuto).not.toHaveBeenCalled();
  });

  it("데이터가 늦게 로드되면 그때 갱신한다 (빈 거래로 마운트 → 거래 로드)", () => {
    lastAttemptAt = 0;
    const { rerender } = renderHook((p: ReturnType<typeof baseParams>) => useBackgroundQuoteRefresh(p), {
      initialProps: baseParams({ trades: [], enabled: false }),
    });
    expect(refreshAuto).not.toHaveBeenCalled();
    rerender(baseParams());
    expect(refreshAuto).toHaveBeenCalledTimes(1);
  });

  it("화면이 숨겨진 채로 열리면 건너뛰고, 다시 보일 때(visibilitychange) stale이면 갱신", () => {
    lastAttemptAt = 0;
    setHidden(true);
    renderHook(() => useBackgroundQuoteRefresh(baseParams()));
    expect(refreshAuto).not.toHaveBeenCalled();
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshAuto).toHaveBeenCalledTimes(1);
  });
});
