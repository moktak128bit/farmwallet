// @vitest-environment jsdom
/** 5-8 — useFxBackfill: 결번이 있으면 마운트당 1회 USDKRW=X 6mo를 받아 없는 날짜만 append,
 *  12h throttle(FX_BACKFILL_LAST_AT), 기존 값 불변, 첫 보강 시 토스트, 결번 없으면 호출 0건 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppStore } from "../store/appStore";
import { getEmptyData } from "../services/dataService";
import { STORAGE_KEYS } from "../constants/config";

const fetchHistoricalClosesMock = vi.fn<(symbol: string, range?: string) => Promise<Array<{ date: string; close: number }>>>();
const toastMock = vi.fn();

vi.mock("../yahooFinanceApi", () => ({
  fetchHistoricalCloses: (symbol: string, range?: string) => fetchHistoricalClosesMock(symbol, range),
}));
vi.mock("react-hot-toast", () => ({
  toast: Object.assign((...args: unknown[]) => toastMock(...args), { success: vi.fn(), error: vi.fn() }),
}));

let todayKst = "2026-08-21";
vi.mock("../utils/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/date")>();
  return { ...actual, getTodayKST: () => todayKst };
});

import { useFxBackfill } from "../hooks/useFxBackfill";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function dailyFx() {
  return useAppStore.getState().data.historicalDailyFx ?? [];
}

/** 최근 영업일이 전부 채워진 이력 — 결번 0 */
function fullHistory(today: string, days: number) {
  const out: Array<{ date: string; rate: number }> = [];
  const base = new Date(`${today}T00:00:00`);
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: iso, rate: 1380 });
  }
  return out;
}

describe("useFxBackfill", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchHistoricalClosesMock.mockReset();
    toastMock.mockReset();
    todayKst = "2026-08-21";
    useAppStore.setState({ data: { ...getEmptyData(), historicalDailyFx: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("결번이 있으면 USDKRW=X 6mo를 1회 받아 없는 날짜만 append하고 토스트로 고지한다", async () => {
    useAppStore.setState({
      data: { ...getEmptyData(), historicalDailyFx: [{ date: "2026-08-19", rate: 1380 }] },
    });
    fetchHistoricalClosesMock.mockResolvedValue([
      { date: "2026-08-18", close: 1370 },
      { date: "2026-08-19", close: 9999 }, // 기존 값 → 불변
      { date: "2026-08-20", close: 1385 },
      { date: "2026-08-21", close: 1390 }, // 오늘 → 무시
    ]);

    const { rerender } = renderHook(({ enabled }) => useFxBackfill(enabled), { initialProps: { enabled: true } });
    await flush();

    expect(fetchHistoricalClosesMock).toHaveBeenCalledTimes(1);
    expect(fetchHistoricalClosesMock).toHaveBeenCalledWith("USDKRW=X", "6mo");
    expect(dailyFx()).toEqual([
      { date: "2026-08-18", rate: 1370 },
      { date: "2026-08-19", rate: 1380 },
      { date: "2026-08-20", rate: 1385 },
    ]);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(String(toastMock.mock.calls[0][0])).toContain("환율 이력 2일 보강");
    expect(Number(localStorage.getItem(STORAGE_KEYS.FX_BACKFILL_LAST_AT))).toBeGreaterThan(0);

    // 같은 마운트에서 재렌더해도 재호출 없음
    rerender({ enabled: true });
    await flush();
    expect(fetchHistoricalClosesMock).toHaveBeenCalledTimes(1);
  });

  it("enabled=false(초기 로드 전)면 아무것도 하지 않고, true가 되면 그때 1회 실행한다", async () => {
    fetchHistoricalClosesMock.mockResolvedValue([{ date: "2026-08-20", close: 1385 }]);
    const { rerender } = renderHook(({ enabled }) => useFxBackfill(enabled), { initialProps: { enabled: false } });
    await flush();
    expect(fetchHistoricalClosesMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await flush();
    expect(fetchHistoricalClosesMock).toHaveBeenCalledTimes(1);
    expect(dailyFx()).toEqual([{ date: "2026-08-20", rate: 1385 }]);
  });

  it("12시간 이내에 시도한 기록이 있으면 호출하지 않는다(throttle) — 12시간 지나면 다시 시도", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T03:00:00+09:00"));
    localStorage.setItem(STORAGE_KEYS.FX_BACKFILL_LAST_AT, String(Date.now() - 11 * 60 * 60 * 1000));
    fetchHistoricalClosesMock.mockResolvedValue([{ date: "2026-08-20", close: 1385 }]);

    const first = renderHook(() => useFxBackfill(true));
    await flush();
    expect(fetchHistoricalClosesMock).not.toHaveBeenCalled();
    first.unmount();

    vi.setSystemTime(new Date("2026-08-21T05:00:00+09:00")); // 마지막 시도로부터 13시간
    renderHook(() => useFxBackfill(true));
    await flush();
    expect(fetchHistoricalClosesMock).toHaveBeenCalledTimes(1);
  });

  it("최근 180일 영업일이 전부 있으면(주말만 비어도) 호출하지 않는다", async () => {
    useAppStore.setState({ data: { ...getEmptyData(), historicalDailyFx: fullHistory(todayKst, 185) } });
    fetchHistoricalClosesMock.mockResolvedValue([{ date: "2026-08-20", close: 1385 }]);
    renderHook(() => useFxBackfill(true));
    await flush();
    expect(fetchHistoricalClosesMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.FX_BACKFILL_LAST_AT)).toBeNull();
  });

  it("받은 날짜가 전부 이미 있으면 데이터 참조를 바꾸지 않고 토스트도 없다", async () => {
    const existing = [{ date: "2026-08-20", rate: 1385 }];
    useAppStore.setState({ data: { ...getEmptyData(), historicalDailyFx: existing } });
    const before = useAppStore.getState().data;
    fetchHistoricalClosesMock.mockResolvedValue([{ date: "2026-08-20", close: 1386 }]);
    renderHook(() => useFxBackfill(true));
    await flush();
    expect(fetchHistoricalClosesMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().data).toBe(before);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("fetch 실패는 조용히 넘어간다(데이터 불변, 토스트 없음)", async () => {
    fetchHistoricalClosesMock.mockRejectedValue(new Error("offline"));
    const before = useAppStore.getState().data;
    renderHook(() => useFxBackfill(true));
    await flush();
    expect(useAppStore.getState().data).toBe(before);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
