// @vitest-environment jsdom
/** 0-1 — 환율 stale 박제 수정: useDailyFxRecorder가 캐시(어제 이전 fetchedAt)값을 오늘로 적립하지 않고,
 *  뒤이어 도착한 신선값(fetchedAt=오늘 KST)을 적립하는지 훅 수준에서 검증 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FxRateInfo } from "../hooks/useFxRate";
import { useAppStore } from "../store/appStore";
import { getEmptyData } from "../services/dataService";

let fxInfo: FxRateInfo = { rate: null, fetchedAt: null, isStale: false };
let todayKst = "2026-08-20";

vi.mock("../context/FxRateContext", () => ({
  useFxRateInfoValue: () => fxInfo,
  useFxRateValue: () => fxInfo.rate,
}));

vi.mock("../utils/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/date")>();
  return { ...actual, getTodayKST: () => todayKst };
});

import { useDailyFxRecorder } from "../hooks/useDailyFxRecorder";

function dailyFx() {
  return useAppStore.getState().data.historicalDailyFx ?? [];
}

describe("useDailyFxRecorder — 신선도 가드", () => {
  beforeEach(() => {
    useAppStore.setState({ data: { ...getEmptyData(), historicalDailyFx: [] } });
    todayKst = "2026-08-20";
    fxInfo = { rate: null, fetchedAt: null, isStale: false };
  });

  it("①초기 캐시값(며칠 전 fetchedAt)은 오늘 날짜로 적립하지 않는다", () => {
    fxInfo = { rate: 1350, fetchedAt: "2026-08-15T09:00:00.000Z", isStale: true };
    renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([]);
  });

  it("②캐시값으로 시작 → 같은 날 신선값 도착 시 신선값이 적립된다(캐시로 차단되지 않음)", () => {
    fxInfo = { rate: 1350, fetchedAt: "2026-08-15T09:00:00.000Z", isStale: true };
    const { rerender } = renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([]);

    fxInfo = { rate: 1392, fetchedAt: "2026-08-20T01:00:00.000Z", isStale: false };
    rerender();
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1392 }]);
  });

  it("같은 날 두 번째 신선값은 재적립하지 않는다(하루 1회)", () => {
    fxInfo = { rate: 1392, fetchedAt: "2026-08-20T01:00:00.000Z", isStale: false };
    const { rerender } = renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1392 }]);

    fxInfo = { rate: 1399, fetchedAt: "2026-08-20T02:00:00.000Z", isStale: false };
    rerender();
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1392 }]);
  });

  it("③KST 자정 경계 — UTC 전날 15:00 수신(KST 00:00)은 오늘로 적립, 14:59는 어제 값이라 적립 안 함", () => {
    fxInfo = { rate: 1380, fetchedAt: "2026-08-19T14:59:00.000Z", isStale: false };
    const { rerender } = renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([]);

    fxInfo = { rate: 1381, fetchedAt: "2026-08-19T15:00:00.000Z", isStale: false };
    rerender();
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1381 }]);
  });

  it("앱을 켜둔 채 날짜가 넘어가면 새 날짜의 신선값을 다시 적립한다", () => {
    fxInfo = { rate: 1390, fetchedAt: "2026-08-20T05:00:00.000Z", isStale: false };
    const { rerender } = renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1390 }]);

    todayKst = "2026-08-21";
    fxInfo = { rate: 1395, fetchedAt: "2026-08-20T16:00:00.000Z", isStale: false }; // KST 08-21 01:00
    rerender();
    expect(dailyFx()).toEqual([
      { date: "2026-08-20", rate: 1390 },
      { date: "2026-08-21", rate: 1395 },
    ]);
  });

  it("기존 데이터의 다른 날짜 항목은 보존한다", () => {
    useAppStore.setState({
      data: { ...getEmptyData(), historicalDailyFx: [{ date: "2026-08-19", rate: 1370 }] },
    });
    fxInfo = { rate: 1392, fetchedAt: "2026-08-20T01:00:00.000Z", isStale: false };
    renderHook(() => useDailyFxRecorder());
    expect(dailyFx()).toEqual([
      { date: "2026-08-19", rate: 1370 },
      { date: "2026-08-20", rate: 1392 },
    ]);
  });
});
