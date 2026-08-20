// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGistSync, checkRemoteChanged, isTimeSeriesOnlyDiff } from "../hooks/useGistSync";
import * as gistSync from "../services/gistSync";
import { GIST_AUTO_PUSH_DEBOUNCE_MS } from "../constants/config";
import type { AppData } from "../types";
import { useUIStore } from "../store/uiStore";
import { useAppStore } from "../store/appStore";
import { getEmptyData, toUserDataJson } from "../services/dataService";

vi.mock("../services/gistSync", async () => {
  const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
  return {
    ...actual,
    saveToGist: vi.fn(),
    saveToGistWithRetry: vi.fn(),
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
    // hashGistPayload/getGistLastPushedHash 등은 actual 구현(localStorage 기반)을 쓰므로
    // 테스트 간 상태 누수를 막기 위해 항상 초기화
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("");
    mocked.getGistVersions.mockResolvedValue([]);
    mocked.saveToGist.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T00:00:00Z", committedAt: "2026-04-20T00:00:00Z" });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T00:00:00Z", committedAt: "2026-04-20T00:00:00Z" });
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
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
  });

  it("토큰/Gist ID가 없으면 동기화 건너뜀", async () => {
    mocked.getGistToken.mockReturnValue("");
    mocked.getGistId.mockReturnValue("");
    renderHook(() => useGistSync(makeData(0), vi.fn()));
    await flush();
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
  });

  it("부팅 시 토큰이 없어도 나중에 입력하면 자동 push가 동작 (hasMounted 순서 회귀 방지)", async () => {
    // 부팅 시점: 토큰 없음 → 초기 pull 건너뜀, 그러나 마운트 플래그는 세워져야 함
    mocked.getGistToken.mockReturnValue("");
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

    // 사용자가 설정 카드에서 토큰 입력
    mocked.getGistToken.mockReturnValue("test-token");

    // 데이터 변경 → 디바운스 후 자동 push가 살아 있어야 함
    rerender({ d: makeData(1) });
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
  });

  it("부팅 자동 pull: 로컬에 미push 변경이 있으면 덮어쓰지 않고 충돌 모달", async () => {
    // 원격이 더 새로움 (외부 기기 변경)
    mocked.getGistVersions.mockResolvedValue([
      { sha: "abc", committedAt: "2026-04-20T01:00:00Z", url: "u" },
    ]);
    mocked.getGistLastPullAt.mockReturnValue("2026-04-19T00:00:00Z");
    mocked.loadFromGist.mockResolvedValue({
      dataJson: '{"accounts":[],"ledger":[{"id":"REMOTE"}]}',
      updatedAt: "2026-04-20T01:00:00Z",
    });
    // 마지막 push payload 해시가 기록돼 있고 현재 로컬과 다름 → 로컬 dirty
    window.localStorage.setItem("fw-gist-last-push-hash", "stale-hash-mismatch");

    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(7), onApply));
    await flush();

    expect(onApply).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.remoteDataJson).toContain("REMOTE");
    expect(conflict?.pendingLocalDataJson).toContain('"amount":7');
  });

  it("부팅 자동 pull: push 해시 기록이 없으면(구버전 상태) 기존처럼 원격 적용", async () => {
    mocked.getGistVersions.mockResolvedValue([
      { sha: "abc", committedAt: "2026-04-20T01:00:00Z", url: "u" },
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
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("manualPull: loadFromGist 결과를 적용하고 lastPullAt 갱신", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    onApply.mockClear();
    mocked.setGistLastPullAt.mockClear();

    mocked.loadFromGist.mockResolvedValue({
      dataJson: '{"accounts":[],"ledger":[{"id":"PULL"}]}',
      updatedAt: "2026-04-21T00:00:00Z",
    });

    await act(async () => {
      await result.current.manualPull();
    });

    expect(onApply).toHaveBeenCalledWith('{"accounts":[],"ledger":[{"id":"PULL"}]}', "2026-04-21T00:00:00Z");
    expect(mocked.setGistLastPullAt).toHaveBeenCalledWith("2026-04-21T00:00:00Z");
    expect(result.current.lastPullAt).toBe("2026-04-21T00:00:00Z");
  });

  it("manualPull: 토큰 없으면 아무것도 하지 않음", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    onApply.mockClear();
    mocked.loadFromGist.mockClear();
    mocked.getGistToken.mockReturnValue("");

    await act(async () => {
      await result.current.manualPull();
    });

    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("데이터 변경 시 debounce 시간 후 자동 push", async () => {
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    mocked.saveToGistWithRetry.mockClear();

    rerender({ d: makeData(1) });
    // debounce 미만에선 push 없음
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS - 1000);
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

    // debounce 경과 후 push
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
  });

  it("debounce 내 연속 변경 시 마지막 값 1번만 push", async () => {
    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    mocked.saveToGistWithRetry.mockClear();

    rerender({ d: makeData(1) });
    await vi.advanceTimersByTimeAsync(60_000);
    rerender({ d: makeData(2) });
    await vi.advanceTimersByTimeAsync(60_000);
    rerender({ d: makeData(3) });
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();

    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    const lastPushedJson = mocked.saveToGistWithRetry.mock.calls[0][0];
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
    mocked.saveToGistWithRetry.mockClear();
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

    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.remoteUpdatedAt).toBe("2026-04-20T06:00:00Z");
    expect(conflict?.pendingLocalDataJson).toContain('"amount":1');
  });

  it("가짜 충돌 방지: push 후 동일 commit이 원격에 보여도 충돌 모달 없이 저장 (known을 committed_at로 갱신)", async () => {
    // GitHub은 같은 push의 updated_at(00s)과 commit committed_at(01s)이 다를 수 있어,
    // 예전엔 known=updated_at(00s) < 원격 committed_at(01s) → 매 push마다 가짜 충돌이 떴다.
    mocked.getGistVersions.mockResolvedValue([]); // 첫 push 전 원격 비어있음 → 충돌 없음
    mocked.saveToGistWithRetry.mockResolvedValue({
      gistId: "g", updatedAt: "2026-04-20T05:00:00Z", committedAt: "2026-04-20T05:00:01Z",
    });

    const { rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(0) },
    });
    await flush();
    mocked.saveToGistWithRetry.mockClear(); // 마운트 시 초기 push 무시

    rerender({ d: makeData(1) }); // 첫 변경 → push. known = committed_at(01s)
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);

    // 원격엔 방금 push한 commit(committed_at=01s)이 보임 — 예전 코드면 01s>known(00s)로 가짜 충돌
    mocked.getGistVersions.mockResolvedValue([{ sha: "v", committedAt: "2026-04-20T05:00:01Z", url: "u" }]);
    mocked.saveToGistWithRetry.mockClear();

    rerender({ d: makeData(2) }); // 두 번째 변경 → push
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    await flush();

    expect(useUIStore.getState().gistConflict).toBeNull(); // 가짜 충돌 모달 없음
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1); // 정상 저장
  });

  it("resolveGistConflict('apply-remote'): onApplyPulledData 호출 + 충돌 클리어", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    mocked.saveToGist.mockClear();
    mocked.saveToGistWithRetry.mockClear();
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
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
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
    mocked.saveToGistWithRetry.mockClear();
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
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toBeNull();
  });
});

describe("useGistSync — 충돌 해소 시 날짜키 시계열 date-union (1-7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    useAppStore.setState({ data: getEmptyData() });
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("");
    mocked.getGistVersions.mockResolvedValue([]);
    mocked.saveToGist.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T00:00:00Z", committedAt: "2026-04-20T00:00:00Z" });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T00:00:00Z", committedAt: "2026-04-20T00:00:00Z" });
    mocked.loadFromGist.mockResolvedValue({ dataJson: "{}", updatedAt: "2026-04-20T00:00:00Z" });
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
    useAppStore.setState({ data: getEmptyData() });
  });

  const localSeries = {
    historicalDailyFx: [{ date: "2026-04-19", rate: 1400 }, { date: "2026-04-20", rate: 1405 }],
    benchmarkDailyCloses: [{ ticker: "^KS11", date: "2026-04-20", close: 2700 }],
    marketEnvSnapshots: [{ date: "2026-04-15", fxRate: 1398, prices: [{ ticker: "AAPL", price: 200, currency: "USD" }], recordedAt: "2026-04-15T01:00:00Z" }],
  };
  const remoteJson = JSON.stringify({
    accounts: [],
    ledger: [{ id: "REMOTE", date: "2026-04-21", kind: "expense", category: "x", description: "r", amount: 99 }],
    trades: [],
    // 다른 기기가 다른 날 열어 쌓은 시계열 — 같은 날짜(04-20)는 값이 다름
    historicalDailyFx: [{ date: "2026-04-20", rate: 1410 }, { date: "2026-04-21", rate: 1412 }],
    benchmarkDailyCloses: [{ ticker: "^GSPC", date: "2026-04-21", close: 5500 }],
    marketEnvSnapshots: [{ date: "2026-04-01", fxRate: 1390, prices: [], recordedAt: "2026-04-01T01:00:00Z" }],
  });

  it("apply-remote: 원격 id 컬렉션은 그대로, 로컬 자동 적립 시계열은 보존(원격 우선 union)되어 적용된다", async () => {
    const onApply = vi.fn();
    const localData: AppData = { ...makeData(7), ...localSeries };
    const { result } = renderHook(() => useGistSync(localData, onApply));
    await flush();
    onApply.mockClear();
    mocked.saveToGist.mockClear();

    useUIStore.getState().setGistConflict({
      remoteDataJson: remoteJson,
      remoteUpdatedAt: "2026-04-21T07:00:00Z",
      pendingLocalDataJson: JSON.stringify(localData),
    });
    await act(async () => {
      await result.current.resolveGistConflict("apply-remote");
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = JSON.parse(onApply.mock.calls[0][0] as string);
    expect(onApply.mock.calls[0][1]).toBe("2026-04-21T07:00:00Z");
    // id 키 컬렉션은 원격 그대로 (로컬 ledger L7은 폐기)
    expect(applied.ledger).toEqual([{ id: "REMOTE", date: "2026-04-21", kind: "expense", category: "x", description: "r", amount: 99 }]);
    // 시계열은 date-union, 같은 날짜는 원격(선택한 쪽) 우선
    expect(applied.historicalDailyFx).toEqual([
      { date: "2026-04-19", rate: 1400 },
      { date: "2026-04-20", rate: 1410 },
      { date: "2026-04-21", rate: 1412 },
    ]);
    expect(applied.benchmarkDailyCloses).toEqual([
      { ticker: "^GSPC", date: "2026-04-21", close: 5500 },
      { ticker: "^KS11", date: "2026-04-20", close: 2700 },
    ]);
    expect(applied.marketEnvSnapshots.map((s: { date: string }) => s.date)).toEqual(["2026-04-01", "2026-04-15"]);
    expect(mocked.saveToGist).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toBeNull();
    // lastPushed 해시는 원격 원본 기준 — 로컬이 원격보다 많아진 상태(dirty)를 다음 push가 올리도록
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(gistSync.hashGistPayload(remoteJson));
  });

  it("force-push-local: 원격 시계열을 로컬 payload에 union해 push하고, 로컬 스토어에도 같은 union을 반영한다", async () => {
    const localData: AppData = { ...makeData(7), ...localSeries };
    useAppStore.setState({ data: localData });
    const { result } = renderHook(() => useGistSync(localData, vi.fn()));
    await flush();
    mocked.saveToGist.mockClear();

    useUIStore.getState().setGistConflict({
      remoteDataJson: remoteJson,
      remoteUpdatedAt: "2026-04-21T07:00:00Z",
      pendingLocalDataJson: JSON.stringify(localData),
    });
    await act(async () => {
      await result.current.resolveGistConflict("force-push-local");
    });

    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
    const pushed = JSON.parse(mocked.saveToGist.mock.calls[0][0]);
    // id 컬렉션은 로컬 그대로
    expect(pushed.ledger.map((l: { id: string }) => l.id)).toEqual(["L7"]);
    // 시계열 union, 같은 날짜는 로컬(선택한 쪽) 우선
    expect(pushed.historicalDailyFx).toEqual([
      { date: "2026-04-19", rate: 1400 },
      { date: "2026-04-20", rate: 1405 },
      { date: "2026-04-21", rate: 1412 },
    ]);
    expect(pushed.benchmarkDailyCloses).toHaveLength(2);
    expect(pushed.marketEnvSnapshots.map((s: { date: string }) => s.date)).toEqual(["2026-04-01", "2026-04-15"]);
    // 로컬 스토어에도 반영 — 다음 자동 push가 원격 시계열을 다시 지우지 않도록
    const store = useAppStore.getState().data;
    expect(store.historicalDailyFx?.map((f) => f.date)).toEqual(["2026-04-19", "2026-04-20", "2026-04-21"]);
    expect(store.historicalDailyFx?.[1].rate).toBe(1405);
    expect(store.benchmarkDailyCloses).toHaveLength(2);
    expect(store.marketEnvSnapshots?.length).toBe(2);
    // ledger는 손대지 않음
    expect(store.ledger.map((l) => l.id)).toEqual(["L7"]);
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(gistSync.hashGistPayload(mocked.saveToGist.mock.calls[0][0]));
  });

  it("시계열이 없는 충돌은 기존 동작 그대로 (payload 재직렬화 없음·스토어 무변경)", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    onApply.mockClear();
    const before = useAppStore.getState().data;

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: '{"y":2}',
    });
    await act(async () => {
      await result.current.resolveGistConflict("apply-remote");
    });
    expect(onApply).toHaveBeenCalledWith('{"x":1}', "2026-04-20T07:00:00Z");

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: '{"y":2}',
    });
    await act(async () => {
      await result.current.resolveGistConflict("force-push-local");
    });
    expect(mocked.saveToGist).toHaveBeenLastCalledWith('{"y":2}');
    expect(useAppStore.getState().data).toBe(before);
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

describe("useGistSync — 앱 복귀 시 원격 변경 확인 (5-7)", () => {
  const MOUNT_REMOTE = { sha: "v1", committedAt: "2026-04-20T01:00:00Z", url: "u" };
  const NEWER_REMOTE = { sha: "v2", committedAt: "2026-04-20T03:00:00Z", url: "u" };
  const REMOTE_JSON = '{"accounts":[],"ledger":[{"id":"REMOTE","date":"2026-04-20","kind":"expense","category":"x","description":"r","amount":99}],"trades":[]}';

  function setVisibilityQuiet(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  }
  const setVisibility = (state: "visible" | "hidden") => {
    setVisibilityQuiet(state);
    document.dispatchEvent(new Event("visibilitychange"));
  };

  // 마이크로태스크만 비움 — 타이머(디바운스 push 등)는 진행시키지 않는다
  const flushMicro = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** 마운트 → 초기 확인(known=01:00) → 16분 경과(throttle 해제·초기 push 완료) → 호출 기록 초기화 */
  async function mountSettled(initial: AppData, onApply = vi.fn()) {
    const hook = renderHook(({ d }: { d: AppData }) => useGistSync(d, onApply), { initialProps: { d: initial } });
    await flush();
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    await flush();
    mocked.getGistVersions.mockClear();
    mocked.loadFromGist.mockClear();
    mocked.setGistLastPullAt.mockClear();
    mocked.saveToGistWithRetry.mockClear();
    onApply.mockClear();
    return { ...hook, onApply };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    // 부팅 pull은 건너뛰게(원격 01:00 < lastPull 02:00) 하되 known=01:00은 잡힌다
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T02:00:00Z");
    mocked.getGistVersions.mockResolvedValue([MOUNT_REMOTE]);
    // 초기 자동 push(마운트+5분)가 known을 01:00 그대로 유지하도록 동일 commit 시각
    mocked.saveToGist.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    mocked.loadFromGist.mockResolvedValue({ dataJson: REMOTE_JSON, updatedAt: "2026-04-20T03:00:00Z" });
    setVisibilityQuiet("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
  });

  it("checkRemoteChanged: known 비어있음/원격 없음/같음 → false, 원격이 더 새로움 → true", () => {
    expect(checkRemoteChanged("", NEWER_REMOTE)).toBe(false);
    expect(checkRemoteChanged("2026-04-20T01:00:00Z", undefined)).toBe(false);
    expect(checkRemoteChanged("2026-04-20T01:00:00Z", { committedAt: "" })).toBe(false);
    expect(checkRemoteChanged("2026-04-20T03:00:00Z", NEWER_REMOTE)).toBe(false);
    expect(checkRemoteChanged("2026-04-20T04:00:00Z", NEWER_REMOTE)).toBe(false);
    expect(checkRemoteChanged("2026-04-20T01:00:00Z", NEWER_REMOTE)).toBe(true);
    expect(checkRemoteChanged("not-a-date", NEWER_REMOTE)).toBe(false);
  });

  it("isTimeSeriesOnlyDiff: 시계열 3종만 다르면 true, id 컬렉션이 다르면 false, 최상위 키 순서는 무시", () => {
    const base = toUserDataJson(makeData(0));
    const seriesOnly = toUserDataJson({ ...makeData(0), historicalDailyFx: [{ date: "2026-04-20", rate: 1400 }] });
    const ledgerDiff = toUserDataJson(makeData(1));
    expect(isTimeSeriesOnlyDiff(base, seriesOnly)).toBe(true);
    expect(isTimeSeriesOnlyDiff(seriesOnly, base)).toBe(true);
    expect(isTimeSeriesOnlyDiff(base, ledgerDiff)).toBe(false);
    expect(isTimeSeriesOnlyDiff('{"b":1,"a":2}', '{"a":2,"b":1,"benchmarkDailyCloses":[]}')).toBe(true);
    expect(isTimeSeriesOnlyDiff("not json", base)).toBe(false);
    expect(isTimeSeriesOnlyDiff("[]", "[]")).toBe(false);
  });

  it("visible 복귀: 원격이 더 새롭고 로컬 dirty 없음 → 자동 pull + lastPullAt=원격 commit 시각, 충돌 없음", async () => {
    const { onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });

    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toBe(REMOTE_JSON);
    expect(onApply.mock.calls[0][1]).toBe("2026-04-20T03:00:00Z");
    expect(mocked.setGistLastPullAt).toHaveBeenCalledWith("2026-04-20T03:00:00Z");
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(gistSync.hashGistPayload(REMOTE_JSON));
  });

  it("visible 복귀: 원격이 더 새롭고 로컬에 미push 가계부 변경 → 덮어쓰지 않고 충돌 모달", async () => {
    const { rerender, onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);
    // 로컬 변경(디바운스 push 전)
    rerender({ d: makeData(1) });

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });

    expect(onApply).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.remoteDataJson).toBe(REMOTE_JSON);
    expect(conflict?.pendingLocalDataJson).toContain('"amount":1');
  });

  it("visible 복귀: 로컬 dirty가 자동 적립 시계열뿐이면 충돌 대신 pull + union(로컬 시계열 보존)", async () => {
    const { rerender, onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);
    // 기록기가 환율만 적립 — id 컬렉션은 마지막 push와 동일
    rerender({ d: { ...makeData(0), historicalDailyFx: [{ date: "2026-04-20", rate: 1400 }] } });

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });

    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = JSON.parse(onApply.mock.calls[0][0] as string);
    expect(applied.ledger.map((l: { id: string }) => l.id)).toEqual(["REMOTE"]);
    expect(applied.historicalDailyFx).toEqual([{ date: "2026-04-20", rate: 1400 }]);
    // lastPushed 해시는 원격 원본 기준 → 로컬(union)이 더 많아 다음 자동 push가 올린다
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(gistSync.hashGistPayload(REMOTE_JSON));
  });

  it("visible 복귀: push/pull 기준이 전혀 없으면(초기 push 실패) 조용히 덮어쓰지 않고 충돌 모달", async () => {
    mocked.saveToGistWithRetry.mockRejectedValue(new Error("offline"));
    const { onApply } = await mountSettled(makeData(0));
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBeNull();
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE_JSON);
  });

  it("visible 복귀: 원격 내용이 우리 마지막 push와 같으면(시각만 다른 가짜 변경) 적용하지 않음", async () => {
    const { onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(0)), updatedAt: "2026-04-20T03:00:00Z" });

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });

    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("visible 복귀: 원격이 새롭지 않으면 경량 조회만 하고 loadFromGist 호출 없음 + 15분 throttle", async () => {
    const { onApply } = await mountSettled(makeData(0));

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    // 1분 뒤 다시 복귀 → throttle로 조회조차 안 함
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);

    // 15분 경과 후 복귀 → 다시 조회
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(2);
  });

  it("복귀 확인 스킵: 충돌 모달 열림 / 복원 직후 / hidden 전환 / 자동 동기화 off", async () => {
    const { result, onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);

    // 충돌 모달 열림
    useUIStore.getState().setGistConflict({ remoteDataJson: "{}", remoteUpdatedAt: "x", pendingLocalDataJson: "{}" });
    await act(async () => { setVisibility("visible"); await flushMicro(); });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    useUIStore.getState().setGistConflict(null);

    // hidden 전환은 확인 안 함 (flush 전용 — dirty 없으니 push도 없음)
    await act(async () => { setVisibility("hidden"); await flushMicro(); });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    setVisibilityQuiet("visible");

    // 복원 직후 (known이 의도적으로 과거) — 최신 원격을 자동 pull해 복원을 되돌리면 안 됨
    act(() => { result.current.syncStateAfterRestore('{"restored":1}', "2026-04-19T00:00:00Z"); });
    await act(async () => { setVisibility("visible"); await flushMicro(); });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    // 자동 동기화 off → 리스너 자체가 없음
    act(() => { result.current.setAutoSyncEnabled(false); });
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await act(async () => { setVisibility("visible"); await flushMicro(); });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("online 복귀: 로컬 dirty 없으면 원격 확인 → 새 변경이면 pull", async () => {
    const { onApply } = await mountSettled(makeData(0));
    mocked.getGistVersions.mockResolvedValue([NEWER_REMOTE]);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flushMicro();
    });

    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toBe(REMOTE_JSON);
  });
});
