import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGistSync } from "../hooks/useGistSync";
import * as gistSync from "../services/gistSync";
import { GIST_AUTO_PUSH_DEBOUNCE_MS } from "../constants/config";
import type { AppData } from "../types";
import { useUIStore } from "../store/uiStore";

vi.mock("../services/gistSync", async () => {
  const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
  return {
    ...actual,
    saveToGist: vi.fn(),
    loadFromGist: vi.fn(),
    getGistVersions: vi.fn(),
    getGistToken: vi.fn(() => "test-token"),
    getGistId: vi.fn(() => "test-gist-id"),
    getGistAutoSync: vi.fn(() => true),
    getGistLastPushAt: vi.fn(() => ""),
    getGistLastPullAt: vi.fn(() => ""),
    setGistLastPushAt: vi.fn(),
    setGistLastPullAt: vi.fn(),
    setGistAutoSync: vi.fn(),
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

// 모든 보류 중인 micro/macro task 처리. fake timer + async effect 조합에 필수.
async function flush() {
  for (let i = 0; i < 5; i++) {
    await vi.runAllTimersAsync();
    await Promise.resolve();
  }
}

describe("useGistSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useUIStore.getState().setGistConflict(null);
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("");
    mocked.getGistVersions.mockResolvedValue([]);
    mocked.saveToGist.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T00:00:00Z" });
    mocked.loadFromGist.mockResolvedValue({ dataJson: "{}", updatedAt: "2026-04-20T00:00:00Z" });
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
  });

  it("초기 마운트 시 원격이 더 새로우면 자동 pull", async () => {
    mocked.getGistVersions.mockResolvedValue([
      { sha: "abc", committedAt: "2026-04-20T01:00:00Z", url: "https://api.github.com/gists/x/abc" },
    ]);
    mocked.getGistLastPullAt.mockReturnValue("2026-04-19T00:00:00Z");
    mocked.loadFromGist.mockResolvedValue({
      dataJson: '{"accounts":[]}',
      updatedAt: "2026-04-20T01:00:00Z",
    });
    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    expect(onApply).toHaveBeenCalledWith('{"accounts":[]}', "2026-04-20T01:00:00Z");
    expect(mocked.setGistLastPullAt).toHaveBeenCalledWith("2026-04-20T01:00:00Z");
  });

  it("원격이 더 새롭지 않으면 pull 건너뜀", async () => {
    mocked.getGistVersions.mockResolvedValue([
      { sha: "abc", committedAt: "2026-04-19T00:00:00Z", url: "u" },
    ]);
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T00:00:00Z");
    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    expect(onApply).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
  });

  it("자동 동기화가 꺼져 있으면 어떤 호출도 안 함", async () => {
    mocked.getGistAutoSync.mockReturnValue(false);
    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(mocked.saveToGist).not.toHaveBeenCalled();
  });

  it("토큰/Gist ID가 없으면 동기화 건너뜀", async () => {
    mocked.getGistToken.mockReturnValue("");
    mocked.getGistId.mockReturnValue("");
    renderHook(() => useGistSync(makeData(0), vi.fn()));
    await flush();
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.saveToGist).not.toHaveBeenCalled();
  });

  it("데이터 변경 시 debounce 시간 후 자동 push", async () => {
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    mocked.saveToGist.mockClear();

    rerender({ d: makeData(1) });
    // debounce 미만에선 push 없음
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS - 1000);
    expect(mocked.saveToGist).not.toHaveBeenCalled();

    // debounce 경과 후 push
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
  });

  it("debounce 내 연속 변경 시 마지막 값 1번만 push", async () => {
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    mocked.saveToGist.mockClear();

    rerender({ d: makeData(1) });
    await vi.advanceTimersByTimeAsync(60_000);
    rerender({ d: makeData(2) });
    await vi.advanceTimersByTimeAsync(60_000);
    rerender({ d: makeData(3) });
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();

    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
    const lastPushedJson = mocked.saveToGist.mock.calls[0][0];
    expect(JSON.parse(lastPushedJson).ledger[0].amount).toBe(3);
  });

  it("push 직전 원격이 새로 변경되어 있으면 충돌 감지 → 자동 pull 후 uiStore에 conflict 설정", async () => {
    mocked.getGistVersions.mockResolvedValue([
      { sha: "remote-new", committedAt: "2026-04-20T05:00:00Z", url: "u" },
    ]);
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T03:00:00Z");
    mocked.loadFromGist.mockResolvedValue({
      dataJson: '{"accounts":[],"ledger":[{"id":"R1"}]}',
      updatedAt: "2026-04-20T05:00:00Z",
    });

    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    // 초기 effect 처리 (원격이 더 새로 자동 pull됨, knownRemoteCommitRef = 5시)
    await flush();
    mocked.saveToGist.mockClear();
    mocked.loadFromGist.mockClear();

    // 원격이 다시 더 새로워짐 (6시)
    mocked.getGistVersions.mockResolvedValue([
      { sha: "remote-newer", committedAt: "2026-04-20T06:00:00Z", url: "u" },
    ]);
    mocked.loadFromGist.mockResolvedValue({
      dataJson: '{"accounts":[],"ledger":[{"id":"R2"}]}',
      updatedAt: "2026-04-20T06:00:00Z",
    });

    rerender({ d: makeData(1) });
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();

    expect(mocked.saveToGist).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.remoteUpdatedAt).toBe("2026-04-20T06:00:00Z");
    expect(conflict?.pendingLocalDataJson).toContain('"amount":1');
  });

  it("resolveGistConflict('apply-remote'): onApplyPulledData 호출 + 충돌 클리어", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    mocked.saveToGist.mockClear();
    onApply.mockClear();

    // 충돌 상태를 직접 set
    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: '{"y":2}',
    });

    await act(async () => {
      await result.current.resolveGistConflict("apply-remote");
    });

    expect(onApply).toHaveBeenCalledWith('{"x":1}', "2026-04-20T07:00:00Z");
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.saveToGist).not.toHaveBeenCalled();
  });

  it("resolveGistConflict('force-push-local'): saveToGist 호출 + 충돌 클리어", async () => {
    const { result } = renderHook(() => useGistSync(makeData(0), vi.fn()));
    await flush();
    mocked.saveToGist.mockClear();

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: '{"y":2}',
    });

    await act(async () => {
      await result.current.resolveGistConflict("force-push-local");
    });

    expect(mocked.saveToGist).toHaveBeenCalledWith('{"y":2}');
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("resolveGistConflict('cancel'): 어떤 호출도 없음 + 충돌 클리어", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    mocked.saveToGist.mockClear();
    onApply.mockClear();

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: '{"y":2}',
    });

    await act(async () => {
      await result.current.resolveGistConflict("cancel");
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(mocked.saveToGist).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toBeNull();
  });
});

describe("detectConflict", () => {
  it("known/latest 둘 중 하나라도 비어 있으면 false", async () => {
    const { detectConflict } = await import("../services/gistSync");
    expect(detectConflict("", "2026-04-20T00:00:00Z")).toBe(false);
    expect(detectConflict("2026-04-20T00:00:00Z", "")).toBe(false);
    expect(detectConflict(null, "2026-04-20T00:00:00Z")).toBe(false);
    expect(detectConflict(undefined, undefined)).toBe(false);
  });

  it("latest > known이면 true", async () => {
    const { detectConflict } = await import("../services/gistSync");
    expect(detectConflict("2026-04-20T05:00:00Z", "2026-04-20T03:00:00Z")).toBe(true);
  });

  it("latest <= known이면 false", async () => {
    const { detectConflict } = await import("../services/gistSync");
    expect(detectConflict("2026-04-20T03:00:00Z", "2026-04-20T05:00:00Z")).toBe(false);
    expect(detectConflict("2026-04-20T03:00:00Z", "2026-04-20T03:00:00Z")).toBe(false);
  });

  it("ISO 파싱 실패 시 false", async () => {
    const { detectConflict } = await import("../services/gistSync");
    expect(detectConflict("not-a-date", "2026-04-20T03:00:00Z")).toBe(false);
  });
});
