// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmptyData } from "../services/dataService";
import { useAppStore } from "../store/appStore";
import type { StockTrade } from "../types";
import type { StockLookupData } from "../utils/stockLookup";

const fetchLookup = vi.fn<(symbol: string, range?: string) => Promise<StockLookupData | null>>();
const fetchFx = vi.fn();
vi.mock("../yahooFinanceApi", () => ({ fetchStockLookup: (symbol: string, range?: string) => fetchLookup(symbol, range), fetchHistoricalCloses: (...args: unknown[]) => fetchFx(...args) }));
vi.mock("../utils/date", async (original) => ({ ...await original<typeof import("../utils/date")>(), getTodayKST: () => "2026-10-21" }));
import { usePortfolioHistoryBackfill } from "../hooks/usePortfolioHistoryBackfill";

const buy = (ticker: string, date = "2026-10-19"): StockTrade => ({ id: ticker, accountId: "a", ticker, name: ticker, date, side: "buy", quantity: 1, price: 100, fee: 0, totalAmount: 100, cashImpact: -100 });
const lookup = (currency = "KRW"): StockLookupData => ({ meta: { currency }, dividends: [], closes: [{ date: "2026-10-19", close: 100 }, { date: "2026-10-20", close: 110 }] });
beforeEach(() => {
  localStorage.clear(); fetchLookup.mockReset(); fetchFx.mockReset();
  fetchFx.mockResolvedValue([{ date: "2026-10-19", close: 1300 }, { date: "2026-10-20", close: 1310 }]);
  useAppStore.setState({ data: { ...getEmptyData(), trades: [buy("005930")], historicalDailyCloses: [] } });
});
afterEach(cleanup);

describe("usePortfolioHistoryBackfill", () => {
  it("마운트 시 일별 이력을 복원하고 거래·기존 환율은 변경하지 않는다", async () => {
    const before = { ...useAppStore.getState().data, historicalDailyFx: [{ date: "2026-10-19", rate: 1400 }] };
    useAppStore.setState({ data: before });
    fetchLookup.mockResolvedValue(lookup());
    const { result } = renderHook(() => usePortfolioHistoryBackfill());
    await waitFor(() => expect(result.current.completed).toBe(1));
    expect(result.current.loading).toBe(false);
    expect(fetchLookup).toHaveBeenCalledWith("005930", "1y");
    const after = useAppStore.getState().data;
    expect(after.historicalDailyCloses).toHaveLength(2);
    expect(after.trades).toBe(before.trades);
    expect(after.ledger).toBe(before.ledger);
    expect(after.accounts).toBe(before.accounts);
    expect(after.historicalDailyFx).toEqual([{ date: "2026-10-19", rate: 1400 }, { date: "2026-10-20", rate: 1310 }]);
  });

  it("재진입 중복 요청을 막지만 수동 갱신과 캐시 소실 시에는 다시 받는다", async () => {
    fetchLookup.mockResolvedValue(lookup());
    const first = renderHook(() => usePortfolioHistoryBackfill());
    await waitFor(() => expect(first.result.current.completed).toBe(1));
    first.unmount();
    const second = renderHook(() => usePortfolioHistoryBackfill());
    expect(fetchLookup).toHaveBeenCalledTimes(1);
    await act(async () => { await second.result.current.refresh(true); });
    expect(fetchLookup).toHaveBeenCalledTimes(2);
    second.unmount();
    useAppStore.setState({ data: { ...useAppStore.getState().data, historicalDailyCloses: [] } });
    const third = renderHook(() => usePortfolioHistoryBackfill());
    await waitFor(() => expect(third.result.current.completed).toBe(1));
    expect(fetchLookup).toHaveBeenCalledTimes(3);
  });

  it("코인 USD 응답을 원화로 오인하지 않고 실패를 알리며 다른 종목은 계속 처리한다", async () => {
    useAppStore.setState({ data: { ...getEmptyData(), trades: [buy("bitcoin"), buy("005930")], historicalDailyCloses: [] } });
    fetchLookup.mockImplementation(async symbol => lookup(symbol === "BTC-KRW" ? "USD" : "KRW"));
    const { result } = renderHook(() => usePortfolioHistoryBackfill());
    await waitFor(() => expect(result.current.completed).toBe(2));
    expect(result.current.failed).toBe(1);
    expect(useAppStore.getState().data.historicalDailyCloses!.every(c => c.ticker === "005930")).toBe(true);
  });

  it("늦게 도착한 응답이 복원·삭제한 거래를 되살리지 않는다", async () => {
    let resolve!: (data: StockLookupData) => void;
    fetchLookup.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => usePortfolioHistoryBackfill());
    await waitFor(() => expect(fetchLookup).toHaveBeenCalledTimes(1));
    act(() => { useAppStore.setState({ data: { ...getEmptyData(), trades: [], historicalDailyCloses: [] } }); });
    await act(async () => { resolve(lookup()); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(useAppStore.getState().data.trades).toEqual([]);
    expect(useAppStore.getState().data.historicalDailyCloses).toEqual([]);
  });
});
