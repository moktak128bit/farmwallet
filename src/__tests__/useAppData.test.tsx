import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppData } from "../hooks/useAppData";
import { useAppStore } from "../store/appStore";
import * as storage from "../storage";
import type { AppData } from "../types";

vi.mock("../storage", async () => {
  const actual = await vi.importActual<typeof storage>("../storage");
  return {
    ...actual,
    loadData: vi.fn(),
    saveData: vi.fn(),
    preloadKrNames: vi.fn(() => Promise.resolve()),
    applyKoreanStockNames: vi.fn((d: AppData) => ({ data: d, changed: false })),
  };
});

const mocked = vi.mocked(storage);

function makeData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

describe("useAppData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ data: makeData() });
    // 기본: 백업 없음
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(null) } as Response)
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("초기 마운트 시 loadData 호출 후 store에 반영, isLoading=false", async () => {
    const fixture = makeData({
      ledger: [{ id: "L1", date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: 1 }],
    });
    mocked.loadData.mockReturnValue(fixture);

    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mocked.loadData).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().data.ledger).toHaveLength(1);
    expect(result.current.loadFailed).toBe(false);
  });

  it("loadData가 throw하면 loadFailed=true로 설정", async () => {
    mocked.loadData.mockImplementation(() => { throw new Error("corrupt"); });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadFailed).toBe(true);
    consoleSpy.mockRestore();
  });

  it("clearLoadFailed가 loadFailed 플래그 리셋", async () => {
    mocked.loadData.mockImplementation(() => { throw new Error("corrupt"); });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    result.current.clearLoadFailed();
    await waitFor(() => expect(result.current.loadFailed).toBe(false));
    consoleSpy.mockRestore();
  });

  it("ledger 비어 있으면 /api/restore-latest-backup 호출", async () => {
    mocked.loadData.mockReturnValue(makeData()); // ledger 빈 상태

    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(null) } as Response)
    );
    globalThis.fetch = fetchSpy as typeof fetch;

    renderHook(() => useAppData());
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/restore-latest-backup",
        expect.objectContaining({ signal: expect.anything() })
      )
    );
  });

  it("백업이 ledger를 포함하면 saveData + reload로 복원", async () => {
    mocked.loadData
      .mockReturnValueOnce(makeData()) // 첫 호출 (빈 데이터)
      .mockReturnValueOnce(
        makeData({
          ledger: [{ id: "B1", date: "2026-01-01", kind: "income", category: "x", description: "n", amount: 1 }],
        })
      );

    const backupBody = makeData({
      ledger: [{ id: "B1", date: "2026-01-01", kind: "income", category: "x", description: "n", amount: 1 }],
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(backupBody) } as Response)
    ) as typeof fetch;

    renderHook(() => useAppData());
    await waitFor(() => expect(mocked.saveData).toHaveBeenCalled());
    await waitFor(() => expect(useAppStore.getState().data.ledger).toHaveLength(1));
    expect(useAppStore.getState().data.ledger[0].id).toBe("B1");
  });

  it("ledger가 이미 있으면 백업 복원 시도하지 않음", async () => {
    mocked.loadData.mockReturnValue(
      makeData({
        ledger: [{ id: "L1", date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: 1 }],
      })
    );
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(null) } as Response)
    );
    globalThis.fetch = fetchSpy as typeof fetch;

    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 추가로 잠시 대기 — restore 호출이 없어야 함
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/restore-latest-backup",
      expect.anything()
    );
  });

  it("초기 로드 후 preloadKrNames 호출, 변경 시 store 업데이트", async () => {
    const orig = makeData({
      ledger: [{ id: "L1", date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: 1 }],
    });
    const updated = makeData({
      ledger: [{ id: "L1", date: "2026-01-01", kind: "expense", category: "x", description: "korean", amount: 1 }],
    });
    mocked.loadData.mockReturnValue(orig);
    mocked.applyKoreanStockNames.mockReturnValue({ data: updated, changed: true });

    renderHook(() => useAppData());
    await waitFor(() => expect(mocked.preloadKrNames).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAppStore.getState().data.ledger[0].description).toBe("korean")
    );
    expect(mocked.saveData).toHaveBeenCalledWith(updated);
  });

  it("data.prices 변경 시 applyKoreanStockNames 재실행 (시세 갱신 후 한글명 교체 보장)", async () => {
    const initial = makeData({
      ledger: [{ id: "L1", date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: 1 }],
    });
    mocked.loadData.mockReturnValue(initial);
    // 기본: 변경 없음 (데이터에 영문 종목명이 없음)
    mocked.applyKoreanStockNames.mockReturnValue({ data: initial, changed: false });

    renderHook(() => useAppData());
    // 마운트 + 플래그 진입으로 applyKoreanStockNames가 한 번 이상 호출됨
    await waitFor(() => expect(mocked.applyKoreanStockNames.mock.calls.length).toBeGreaterThanOrEqual(1));
    const callsBeforePriceChange = mocked.applyKoreanStockNames.mock.calls.length;

    // 새 시세 fetch 시뮬레이션: store.prices 갱신
    const withNewPrices = {
      ...initial,
      prices: [{ ticker: "005930", name: "Samsung Electronics", price: 70000 }],
    };
    // 한글명 적용 결과 준비
    const withKorean = {
      ...withNewPrices,
      prices: [{ ticker: "005930", name: "삼성전자", price: 70000 }],
    };
    mocked.applyKoreanStockNames.mockReturnValue({ data: withKorean, changed: true });
    useAppStore.setState({ data: withNewPrices });

    // prices 변경으로 effect 재발화 → applyKoreanStockNames 추가 호출
    await waitFor(() =>
      expect(mocked.applyKoreanStockNames.mock.calls.length).toBeGreaterThan(callsBeforePriceChange)
    );
    await waitFor(() =>
      expect(useAppStore.getState().data.prices[0].name).toBe("삼성전자")
    );
  });
});
