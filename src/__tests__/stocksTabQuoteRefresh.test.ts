/**
 * 주식 탭 진입 자동 갱신 판정 — [시세 조회 (보유)]를 손으로 누르지 않아도 되게 하는 게이트.
 *
 * 회귀 방지: 게이트가 10분이던 시절엔 앱을 열고 바로 주식 탭에 들어가면 늘 걸려서
 * "들어가도 아무 일 없다"로 보였다. 탭 진입은 명시적 의도라 60초로 줄였다.
 */
import { describe, expect, it } from "vitest";
import {
  STOCKS_TAB_REFRESH_GATE_MS,
  shouldRefreshOnStocksTabEnter
} from "../features/stocks/useQuoteRefresh";

const NOW = 1_800_000_000_000;

describe("shouldRefreshOnStocksTabEnter", () => {
  it("보유 종목이 없으면 갱신하지 않는다", () => {
    expect(shouldRefreshOnStocksTabEnter(false, 0, NOW)).toBe(false);
  });

  it("한 번도 갱신한 적 없으면(lastAttemptAt=0) 갱신한다", () => {
    expect(shouldRefreshOnStocksTabEnter(true, 0, NOW)).toBe(true);
  });

  it("게이트를 막 넘기면 갱신한다", () => {
    const last = NOW - STOCKS_TAB_REFRESH_GATE_MS - 1;
    expect(shouldRefreshOnStocksTabEnter(true, last, NOW)).toBe(true);
  });

  it("게이트 이내면 갱신하지 않는다 — 탭을 빠르게 오갈 때 연속 발사 방지", () => {
    expect(shouldRefreshOnStocksTabEnter(true, NOW - 1_000, NOW)).toBe(false);
    expect(shouldRefreshOnStocksTabEnter(true, NOW - STOCKS_TAB_REFRESH_GATE_MS, NOW)).toBe(false);
  });

  it("앱 열기·복귀 게이트(10분)보다 짧다 — 탭 진입이 더 자주 떠야 한다", () => {
    expect(STOCKS_TAB_REFRESH_GATE_MS).toBeLessThan(10 * 60 * 1000);
    // 앱 연 지 2분 뒤 주식 탭 진입: 예전 10분 게이트에선 안 떴지만 이제는 뜬다
    expect(shouldRefreshOnStocksTabEnter(true, NOW - 2 * 60 * 1000, NOW)).toBe(true);
  });
});
