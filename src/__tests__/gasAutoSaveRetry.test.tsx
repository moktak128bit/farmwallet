// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGistSync } from "../hooks/useGistSync";
import * as gistSync from "../services/gistSync";
import { GAS_AUTO_SAVE_DEBOUNCE_MS } from "../constants/config";
import type { AppData } from "../types";
import { useUIStore } from "../store/uiStore";

/**
 * 무한 로딩·멈춘 저장 회귀(2026-11-11): 시트 자동 저장이 한 번 실패하면(서버 응답 없음 등) 다음 편집이나
 * 앱 전환 전까지 다시 시도하지 않아 편집이 시트에 안 올라간 채 남았다. GAS에서는 30초 뒤 스스로 다시 저장한다.
 */

vi.mock("../services/gas", async () => {
  const actual = await vi.importActual<typeof import("../services/gas")>("../services/gas");
  return { ...actual, isGas: () => true };
});

vi.mock("../services/gistSync", async () => {
  const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
  return {
    ...actual,
    saveToGistWithRetry: vi.fn(),
    loadFromGist: vi.fn(),
    getGistVersions: vi.fn(),
    getGistToken: vi.fn(() => "gas"),
    getGistId: vi.fn(() => "gas"),
    getGistAutoSync: vi.fn(() => true),
    getGistLastPushAt: vi.fn(() => ""),
    getGistLastPullAt: vi.fn(() => ""),
    setGistLastPushAt: vi.fn(),
    setGistLastPullAt: vi.fn(),
  };
});

const mocked = vi.mocked(gistSync);

function makeData(stamp: number): AppData {
  return {
    accounts: [],
    ledger: [{ id: `L${stamp}`, date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: stamp }],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
  };
}

describe("시트 자동 저장 실패 뒤 지연 재시도", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    mocked.getGistVersions.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("실패하면 30초 뒤 다시 저장하고, 성공하면 멈춘다", async () => {
    const ok = { gistId: "gas", updatedAt: "2026-11-11T00:00:00Z", committedAt: "2026-11-11T00:00:00Z" };
    mocked.saveToGistWithRetry
      .mockRejectedValueOnce(new Error("서버 응답 없음 (saveData, 120초)"))
      .mockResolvedValue(ok);
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), { initialProps: { d: makeData(0) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerender({ d: makeData(1) });
    await act(async () => { await vi.advanceTimersByTimeAsync(GAS_AUTO_SAVE_DEBOUNCE_MS + 100); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(2);

    // 성공 뒤에는 더 이상 저장하지 않는다(편집 없음)
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(2);
  });
});
