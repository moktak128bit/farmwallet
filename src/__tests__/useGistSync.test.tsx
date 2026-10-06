// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode } from "react";
import { toast, useToasterStore } from "react-hot-toast";
import { useGistSync, checkRemoteChanged, isTimeSeriesOnlyDiff, hasUnsyncedLocalData } from "../hooks/useGistSync";
import * as gistSync from "../services/gistSync";
import { hashGistPayload } from "../services/gistSync";
import { GIST_AUTO_PUSH_DEBOUNCE_MS, GIST_REMOTE_CHECK_THROTTLE_MS } from "../constants/config";
import type { AppData } from "../types";
import { useUIStore } from "../store/uiStore";
import { useAppStore } from "../store/appStore";
import { getEmptyData, toUserDataJson } from "../services/dataService";
import { saveSafetySnapshot } from "../services/backupService";

vi.mock("../services/gistSync", async () => {
  const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
  return {
    ...actual,
    saveToGist: vi.fn(),
    saveToGistWithRetry: vi.fn(),
    loadFromGist: vi.fn(),
    getGistVersions: vi.fn(),
    getGistVersionsWithCredentials: vi.fn(),
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

// 실제 구현을 그대로 감싸 호출 여부만 본다 (강제 덮어쓰기 직전 안전 스냅샷)
vi.mock("../services/backupService", async () => {
  const actual = await vi.importActual<typeof import("../services/backupService")>("../services/backupService");
  return { ...actual, saveSafetySnapshot: vi.fn(actual.saveSafetySnapshot) };
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

    // 1-6: before/after 데이터가 다르면 즉시 반영되지 않고 ApplyConfirmModal 게이트(uiStore.pendingApply)를
    // 거친다 — [적용]에 해당하는 onConfirm을 호출해야 실제 반영된다.
    const pending = useUIStore.getState().pendingApply;
    expect(pending).not.toBeNull();
    act(() => {
      pending?.onConfirm();
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
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS / 2);
    rerender({ d: makeData(2) });
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS / 2);
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
    // 적용 직전 다시 읽은 원격이 모달의 원격본과 같음 (낡은 모달 아님)
    mocked.loadFromGist.mockResolvedValue({ dataJson: '{"x":1}', updatedAt: "2026-04-20T07:00:00Z" });

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

    // 저장하려던 데이터 = 지금 이 기기 데이터, 덮기 직전 다시 읽은 원격 = 모달의 원격본 (낡은 모달 아님)
    const localJson = toUserDataJson(makeData(0));
    mocked.loadFromGist.mockResolvedValue({ dataJson: '{"x":1}', updatedAt: "2026-04-20T07:00:00Z" });
    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: localJson,
    });

    await act(async () => {
      await result.current.resolveGistConflict("force-push-local");
    });

    expect(mocked.saveToGist).toHaveBeenCalledWith(localJson);
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
    mocked.loadFromGist.mockResolvedValue({ dataJson: remoteJson, updatedAt: "2026-04-21T07:00:00Z" });

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
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(remoteJson));
  });

  it("force-push-local: 원격 시계열을 로컬 payload에 union해 push하고, 로컬 스토어에도 같은 union을 반영한다", async () => {
    const localData: AppData = { ...makeData(7), ...localSeries };
    useAppStore.setState({ data: localData });
    const { result } = renderHook(() => useGistSync(localData, vi.fn()));
    await flush();
    mocked.saveToGist.mockClear();
    mocked.loadFromGist.mockResolvedValue({ dataJson: remoteJson, updatedAt: "2026-04-21T07:00:00Z" }); // 낡은 모달 아님

    useUIStore.getState().setGistConflict({
      remoteDataJson: remoteJson,
      remoteUpdatedAt: "2026-04-21T07:00:00Z",
      pendingLocalDataJson: toUserDataJson(localData),
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
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(mocked.saveToGist.mock.calls[0][0]));
  });

  it("시계열이 없는 충돌은 기존 동작 그대로 (payload 재직렬화 없음·스토어 무변경)", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(0), onApply));
    await flush();
    onApply.mockClear();
    const before = useAppStore.getState().data;
    mocked.loadFromGist.mockResolvedValue({ dataJson: '{"x":1}', updatedAt: "2026-04-20T07:00:00Z" });
    const localJson = toUserDataJson(makeData(0));

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: localJson,
    });
    await act(async () => {
      await result.current.resolveGistConflict("apply-remote");
    });
    expect(onApply).toHaveBeenCalledWith('{"x":1}', "2026-04-20T07:00:00Z");

    useUIStore.getState().setGistConflict({
      remoteDataJson: '{"x":1}',
      remoteUpdatedAt: "2026-04-20T07:00:00Z",
      pendingLocalDataJson: localJson,
    });
    await act(async () => {
      await result.current.resolveGistConflict("force-push-local");
    });
    expect(mocked.saveToGist).toHaveBeenLastCalledWith(localJson);
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

  it("visible 복귀: 원격이 새롭지 않으면 경량 조회만 하고 loadFromGist 호출 없음 + throttle", async () => {
    const { onApply } = await mountSettled(makeData(0));

    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    // throttle 직전 다시 복귀 → 조회조차 안 함
    await vi.advanceTimersByTimeAsync(GIST_REMOTE_CHECK_THROTTLE_MS - 1000);
    await act(async () => {
      setVisibility("visible");
      await flushMicro();
    });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);

    // throttle 경과 후 복귀 → 다시 조회
    await vi.advanceTimersByTimeAsync(2000);
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

describe("useGistSync — 탭 표시 중 원격 폴링", () => {
  const MOUNT_REMOTE = { sha: "v1", committedAt: "2026-04-20T01:00:00Z", url: "u" };
  const POLL_MS = 180_000;

  function setVisibilityQuiet(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  }

  // 주의: interval이 있으므로 flush()(runAllTimersAsync)는 쓰지 않는다 — 무한 루프
  async function mountPolling(withPoll: boolean) {
    const hook = renderHook(() => useGistSync(makeData(0), vi.fn(), withPoll ? { remotePollMs: POLL_MS } : undefined));
    // 첫 자동 push까지 소진 (push 충돌 확인용 getGistVersions 호출 포함)
    await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000);
    mocked.getGistVersions.mockClear();
    return hook;
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
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T02:00:00Z");
    mocked.getGistVersions.mockResolvedValue([MOUNT_REMOTE]);
    mocked.saveToGist.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    mocked.loadFromGist.mockResolvedValue({ dataJson: "{}", updatedAt: "2026-04-20T01:00:00Z" });
    setVisibilityQuiet("visible");
  });

  afterEach(() => {
    setVisibilityQuiet("visible");
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
  });

  it("원격 폴링: 표시 중 3분마다 확인", async () => {
    await mountPolling(true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(2);
  });

  it("원격 폴링: 숨김 탭·충돌 모달 시 건너뜀", async () => {
    await mountPolling(true);

    setVisibilityQuiet("hidden");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(0);

    setVisibilityQuiet("visible");
    useUIStore.getState().setGistConflict({ remoteDataJson: "{}", remoteUpdatedAt: "x", pendingLocalDataJson: "{}" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(0);
  });

  it("원격 폴링: 옵션 없으면 interval 없음", async () => {
    await mountPolling(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(0);
  });
});

describe("useGistSync — 동기화 건강 상태", () => {
  const MOUNT_REMOTE = { sha: "v1", committedAt: "2026-04-20T01:00:00Z", url: "u" };
  const NET_ERR = "네트워크 연결을 확인해주세요.";

  const setVisibilityQuiet = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  };
  const flushMicro = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T02:00:00Z");
    mocked.getGistVersions.mockResolvedValue([MOUNT_REMOTE]);
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    setVisibilityQuiet("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
  });

  it("마운트 확인 실패는 1회로 기록", async () => {
    mocked.getGistVersions.mockRejectedValue(new Error(NET_ERR));
    const { result } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), { initialProps: { d: makeData(0) } });
    await act(async () => { await flushMicro(); });
    expect(result.current.syncHealth.consecutiveFailures).toBe(1);
    expect(result.current.syncHealth.lastError).toBe(NET_ERR);
  });

  it("연속 실패 누적과 성공 시 리셋", async () => {
    const { result } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), { initialProps: { d: makeData(0) } });
    await flush();
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    await flush();

    const visibleCheck = async () => {
      await vi.advanceTimersByTimeAsync(GIST_REMOTE_CHECK_THROTTLE_MS + 1000);
      await act(async () => {
        setVisibilityQuiet("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        await flushMicro();
      });
    };

    mocked.getGistVersions.mockRejectedValue(new Error(NET_ERR));
    await visibleCheck();
    expect(result.current.syncHealth.consecutiveFailures).toBe(1);
    await visibleCheck();
    expect(result.current.syncHealth.consecutiveFailures).toBe(2);
    expect(result.current.syncHealth.lastError).toBe(NET_ERR);

    mocked.getGistVersions.mockResolvedValue([]);
    await visibleCheck();
    expect(result.current.syncHealth.consecutiveFailures).toBe(0);
    expect(result.current.syncHealth.lastCheckAt).not.toBeNull();
  });
});

describe("useGistSync — connectDevice", () => {
  const P = { gistId: "0123456789abcdef0123456789abcdef", token: "ghp_SECRET999" };
  const REMOTE = JSON.stringify(makeData(5));
  const VERSION = { sha: "v", committedAt: "2026-10-02T01:00:00Z", url: "u" };
  const AUTH_ERR = "Gist 불러오기 실패: 토큰이 유효하지 않습니다.";

  const flushMicro = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  /** 마지막 pull/push 시각 저장소 흉내 — set이 get에 반영돼야 기준점 초기화를 검증할 수 있다 */
  const stamps = { pull: "", push: "" };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
    useUIStore.getState().setPendingConnect(null);
    // 미연결 기기로 마운트(토큰·ID 없음) — 연결 후에는 실제 setGistToken/setGistId가 쓴 값을 읽는다
    mocked.getGistAutoSync.mockReturnValue(false);
    mocked.getGistToken.mockImplementation(() => window.localStorage.getItem("fw-gist-token") ?? "");
    mocked.getGistId.mockImplementation(() => window.localStorage.getItem("fw-gist-id") ?? "");
    stamps.pull = "";
    stamps.push = "";
    mocked.getGistLastPullAt.mockImplementation(() => stamps.pull);
    mocked.setGistLastPullAt.mockImplementation((iso: string) => { stamps.pull = iso; });
    mocked.getGistLastPushAt.mockImplementation(() => stamps.push);
    mocked.setGistLastPushAt.mockImplementation((iso: string) => { stamps.push = iso; });
    // 연결 후 부팅용 불러오기(Effect 1)가 다시 돈다면 원격이 '새로움'으로 보여 loadFromGist를 한 번 더 부른다
    mocked.getGistVersions.mockResolvedValue([VERSION]);
    mocked.getGistVersionsWithCredentials.mockResolvedValue([VERSION]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: REMOTE, updatedAt: "2026-10-02T00:59:59Z" });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: P.gistId, updatedAt: "2026-10-02T01:05:00Z", committedAt: "2026-10-02T01:05:00Z" });
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
    useUIStore.getState().setPendingConnect(null);
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("connectDevice: 연결 테스트 실패 시 아무것도 저장 안 함", async () => {
    mocked.getGistVersionsWithCredentials.mockRejectedValue(new Error(AUTH_ERR));
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(getEmptyData(), onApply));
    await flush();

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.connectDevice(P); });

    expect(outcome).toBe("failed");
    expect(mocked.getGistVersionsWithCredentials).toHaveBeenCalledWith(P.token, P.gistId, 1);
    expect(window.localStorage.getItem("fw-gist-token")).toBeNull();
    expect(window.sessionStorage.getItem("fw-gist-token")).toBeNull();
    expect(window.localStorage.getItem("fw-gist-id")).toBeNull();
    expect(mocked.setGistAutoSync).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    // 아직 설정되지 않은 기기 — 잘못 입력한 링크로 '동기화 오류' 경보를 띄우지 않는다
    expect(result.current.syncHealth.consecutiveFailures).toBe(0);
  });

  it("connectDevice: 실패 로그에 토큰 미포함", async () => {
    const toastError = vi.spyOn(toast, "error");
    try {
      mocked.getGistVersionsWithCredentials.mockRejectedValue(new Error(AUTH_ERR));
      const onLog = vi.fn();
      const { result } = renderHook(() => useGistSync(getEmptyData(), vi.fn(), { onLog }));
      await flush();

      await act(async () => { await result.current.connectDevice(P); });
      expect(onLog).toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(AUTH_ERR);

      // 오류 메시지가 토큰을 그대로 담고 있어도(응답 본문 echo 등) 로그·토스트에는 남기지 않는다
      mocked.getGistVersionsWithCredentials.mockRejectedValue(new Error(`bad credentials ${P.token}`));
      await act(async () => { await result.current.connectDevice(P); });

      for (const args of onLog.mock.calls) {
        for (const a of args) expect(String(a)).not.toContain("ghp_SECRET999");
      }
      for (const args of toastError.mock.calls) {
        expect(JSON.stringify(args)).not.toContain("ghp_SECRET999");
      }
    } finally {
      toastError.mockRestore();
    }
  });

  it("connectDevice: 빈 기기는 미리보기 없이 적용 + 토큰 영속 + 자동 동기화 ON + 이중 불러오기 없음", async () => {
    // onApplyPulledData가 실제 앱처럼 데이터를 바꾼다 — 연결 직후 자동 업로드가 빈 데이터를 올리지 않는지 함께 확인
    let current: AppData = getEmptyData();
    const onApply = vi.fn((json: string) => { current = JSON.parse(json) as AppData; });
    const { result } = renderHook(() => useGistSync(current, onApply));
    await flush();

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.connectDevice(P); });

    expect(outcome).toBe("connected");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(REMOTE, "2026-10-02T01:00:00Z");
    expect(window.localStorage.getItem("fw-gist-token")).toBe("ghp_SECRET999");
    expect(window.localStorage.getItem("fw-gist-id")).toBe(P.gistId);
    expect(mocked.setGistAutoSync).toHaveBeenCalledWith(true);
    expect(result.current.autoSyncEnabled).toBe(true);
    expect(useUIStore.getState().pendingApply).toBeNull();
    // 동기화 상태는 정식 불러오기 경로와 동일하게 갱신
    expect(mocked.setGistLastPullAt).toHaveBeenCalledWith("2026-10-02T01:00:00Z");
    expect(result.current.lastPullAt).toBe("2026-10-02T01:00:00Z");
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(REMOTE));
    expect(result.current.syncHealth.lastCheckAt).not.toBeNull();

    await act(async () => { await flush(); });
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
    // 연결 직후 자동 업로드는 정확히 1회(원격 payload에서 캐시 필드를 뺀 정규화본) — 빈 데이터가 아니라 원격 가계부를 올린다
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    const pushed = JSON.parse(mocked.saveToGistWithRetry.mock.calls[0][0]) as AppData;
    expect(pushed.ledger).toEqual(makeData(5).ledger);
  });

  it("connectDevice: 데이터 있는 기기는 미리보기, 취소하면 자동 동기화 OFF", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await flush();

    let promise!: Promise<string>;
    await act(async () => {
      promise = result.current.connectDevice(P);
      await flushMicro();
    });
    const pending = useUIStore.getState().pendingApply;
    expect(pending).not.toBeNull();
    expect(pending?.title).toBe("연결한 Gist에서 불러오기");

    await act(async () => {
      pending?.onCancel?.();
      await flushMicro();
    });
    await expect(promise).resolves.toBe("cancelled");
    expect(onApply).not.toHaveBeenCalled();
    expect(mocked.setGistAutoSync).not.toHaveBeenCalled();
    expect(result.current.autoSyncEnabled).toBe(false);
  });

  it("connectDevice: 데이터 있는 기기에서 미리보기 [적용]이면 연결 완료", async () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await flush();

    let promise!: Promise<string>;
    await act(async () => {
      promise = result.current.connectDevice(P);
      await flushMicro();
    });
    const pending = useUIStore.getState().pendingApply;
    expect(pending).not.toBeNull();

    await act(async () => {
      pending?.onConfirm();
      await flushMicro();
    });
    await expect(promise).resolves.toBe("connected");
    expect(onApply).toHaveBeenCalledWith(REMOTE, "2026-10-02T01:00:00Z");
    expect(mocked.setGistAutoSync).toHaveBeenCalledWith(true);
    expect(result.current.autoSyncEnabled).toBe(true);
  });

  it("connectDevice: 적용 중 예외가 나면 실패로 끝내고 자동 동기화를 켜지 않음 (모달이 멈추지 않게)", async () => {
    const onApply = vi.fn(() => { throw new Error("apply boom"); });
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await flush();

    let promise!: Promise<string>;
    await act(async () => {
      promise = result.current.connectDevice(P);
      await flushMicro();
    });
    const pending = useUIStore.getState().pendingApply;
    expect(pending).not.toBeNull();
    await act(async () => {
      pending?.onConfirm();
      await flushMicro();
    });
    await expect(promise).resolves.toBe("failed");
    expect(mocked.setGistAutoSync).not.toHaveBeenCalledWith(true);
    expect(result.current.autoSyncEnabled).toBe(false);
  });

  it("connectDevice: 원격 검증 실패 시 자동 동기화를 켜지 않음", async () => {
    mocked.loadFromGist.mockResolvedValue({ dataJson: "not json", updatedAt: "2026-10-02T00:59:59Z" });
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(getEmptyData(), onApply));
    await flush();

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.connectDevice(P); });

    expect(outcome).toBe("failed");
    expect(onApply).not.toHaveBeenCalled();
    expect(mocked.setGistAutoSync).not.toHaveBeenCalled();
    expect(result.current.autoSyncEnabled).toBe(false);
    // 빈 기기가 빈 데이터를 원격에 덮어쓰지 않는다
    await act(async () => { await flush(); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(mocked.saveToGist).not.toHaveBeenCalled();
  });

  it("connectDevice: 충돌 모달이 열려 있으면 연결 테스트도 하지 않고 실패", async () => {
    const { result } = renderHook(() => useGistSync(getEmptyData(), vi.fn()));
    await flush();
    useUIStore.getState().setGistConflict({ remoteDataJson: "{}", remoteUpdatedAt: "x", pendingLocalDataJson: "{}" });

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.connectDevice(P); });

    expect(outcome).toBe("failed");
    expect(mocked.getGistVersionsWithCredentials).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("fw-gist-id")).toBeNull();
  });

  it("connectDevice: 다른 Gist에 연결된 기기 — 연결 중 자동 업로드 보류, 취소하면 자동 동기화 OFF", async () => {
    // 기존 Gist(OLD)에 자동 동기화 ON으로 연결된 기기. 부팅 pull은 건너뛰게(원격 01:00 < lastPull 02:00).
    window.localStorage.setItem("fw-gist-token", "old-token");
    window.localStorage.setItem("fw-gist-id", "fedcba9876543210fedcba9876543210");
    mocked.getGistAutoSync.mockReturnValue(true);
    stamps.pull = "2026-10-02T02:00:00Z";
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await act(async () => { await flushMicro(); });
    // 마운트 직후 자동 업로드 디바운스 타이머가 대기 중

    const test = deferred<typeof VERSION[]>();
    mocked.getGistVersionsWithCredentials.mockReturnValue(test.promise);
    let promise!: Promise<string>;
    await act(async () => {
      promise = result.current.connectDevice(P);
      await flushMicro();
    });
    // 연결 테스트 대기 중 디바운스가 만료돼도 업로드하지 않는다 (재시도가 새 Gist로 옛 데이터를 올리는 사고 방지)
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

    await act(async () => {
      test.resolve([VERSION]);
      await flushMicro();
    });
    const pending = useUIStore.getState().pendingApply;
    expect(pending).not.toBeNull();
    await act(async () => {
      pending?.onCancel?.();
      await flushMicro();
    });
    await expect(promise).resolves.toBe("cancelled");
    expect(window.localStorage.getItem("fw-gist-id")).toBe(P.gistId);
    expect(mocked.setGistAutoSync).toHaveBeenCalledWith(false);
    expect(mocked.setGistAutoSync).not.toHaveBeenCalledWith(true);
    expect(result.current.autoSyncEnabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("connectDevice: 진행 중이던 부팅 불러오기는 자격증명 전환 후 폐기", async () => {
    window.localStorage.setItem("fw-gist-token", "old-token");
    window.localStorage.setItem("fw-gist-id", "fedcba9876543210fedcba9876543210");
    mocked.getGistAutoSync.mockReturnValue(true);
    // 부팅 pull의 원격 조회가 느리게 응답
    const boot = deferred<typeof VERSION[]>();
    mocked.getGistVersions.mockReturnValueOnce(boot.promise);
    let current: AppData = getEmptyData();
    const onApply = vi.fn((json: string) => { current = JSON.parse(json) as AppData; });
    const { result } = renderHook(() => useGistSync(current, onApply));
    await act(async () => { await flushMicro(); });

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.connectDevice(P); });
    expect(outcome).toBe("connected");
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);

    // 옛 Gist 기준으로 시작된 부팅 pull이 이제야 응답 — 새 연결 상태를 덮지 않는다
    await act(async () => {
      boot.resolve([{ sha: "old", committedAt: "2026-10-02T03:00:00Z", url: "u" }]);
      await flushMicro();
    });
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(result.current.lastPullAt).toBe("2026-10-02T01:00:00Z");
  });

  describe("다른 Gist로 전환 후 적용하지 않음(취소·실패) — 옛 Gist 기준점으로 새 Gist를 판정하지 않는다", () => {
    const OLD_ID = "fedcba9876543210fedcba9876543210";
    /** A의 known(첫 업로드 committedAt 01:05)보다 오래된 새 Gist 헤드 — 옛 기준이면 detectConflict가 false */
    const B_OLDER = { sha: "b", committedAt: "2026-10-01T00:00:00Z", url: "u" };
    /** A의 known보다 새로운 새 Gist 헤드 — 옛 기준이면 복귀 확인이 '외부 변경'으로 보고 적용 */
    const B_NEWER = { sha: "b", committedAt: "2026-10-02T05:00:00Z", url: "u" };
    /** 새 Gist(P)에 묶인 '아직 맞춰 본 적 없음' 표식 */
    const MARKER_B = `unsynced:${P.gistId}`;

    const setVisibility = (state: "visible" | "hidden") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    /** 옛 Gist(A)에 자동 동기화 ON으로 맞춰진 기기 — 첫 자동 업로드까지 끝내 A 기준점(known·payload·해시)을 세운다 */
    async function mountSyncedToOld() {
      window.localStorage.setItem("fw-gist-token", "old-token");
      window.localStorage.setItem("fw-gist-id", OLD_ID);
      mocked.getGistAutoSync.mockReturnValue(true);
      stamps.pull = "2026-10-02T02:00:00Z"; // 부팅 pull 건너뜀(원격 01:00 < 02:00)
      const onApply = vi.fn();
      const hook = renderHook(() => useGistSync(makeData(1), onApply));
      await act(async () => { await flush(); });
      expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(1))));
      mocked.saveToGistWithRetry.mockClear();
      mocked.setGistAutoSync.mockClear();
      return { ...hook, onApply };
    }

    /** 연결 → 미리보기 취소. 이후 호출 기록을 비워 '다시 켠 뒤'만 본다 */
    async function connectAndCancel(result: { current: ReturnType<typeof useGistSync> }, payload = P) {
      let promise!: Promise<string>;
      await act(async () => {
        promise = result.current.connectDevice(payload);
        await flushMicro();
      });
      const pending = useUIStore.getState().pendingApply;
      expect(pending).not.toBeNull();
      await act(async () => {
        pending?.onCancel?.();
        useUIStore.getState().setPendingApply(null);
        await flushMicro();
      });
      await expect(promise).resolves.toBe("cancelled");
      mocked.getGistVersions.mockClear();
      mocked.loadFromGist.mockClear();
    }

    function expectNeverSyncedBaseline(result: { current: ReturnType<typeof useGistSync> }) {
      expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(MARKER_B);
      expect(stamps.pull).toBe("");
      expect(stamps.push).toBe("");
      expect(result.current.lastPullAt).toBeNull();
      expect(result.current.lastPushAt).toBeNull();
    }

    it("취소 후 다시 켜기 (새 Gist가 옛 기준보다 오래됨): 첫 불러오기로 충돌을 묻고, 로컬을 묻지 않고 올리지 않음", async () => {
      const { result, onApply } = await mountSyncedToOld();
      mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
      mocked.getGistVersions.mockResolvedValue([B_OLDER]);
      await connectAndCancel(result);
      expectNeverSyncedBaseline(result);

      // 사용자가 설정에서 자동 동기화를 다시 켬 → 부팅 불러오기(Effect 1) 경로로 새 Gist를 확인
      await act(async () => {
        result.current.setAutoSyncEnabled(true);
        await flushMicro();
      });
      expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
      expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      expect(useUIStore.getState().gistConflict?.pendingLocalDataJson).toContain('"amount":1');

      // 디바운스가 지나도 묻지 않은 업로드는 없다
      await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

      // 충돌 모달을 [취소]해도 다음 업로드(탭 숨김 flush)는 다시 충돌 확인을 거친다 — 옛 시각 비교로 통과하지 않음
      await act(async () => { await result.current.resolveGistConflict("cancel"); });
      await act(async () => {
        setVisibility("hidden");
        await flushMicro();
      });
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(mocked.saveToGist).not.toHaveBeenCalled();
      expect(onApply).not.toHaveBeenCalled();
    });

    it("취소 후 다시 켜기 (새 Gist가 더 새로움): 다시 켠 뒤 새 Gist가 또 바뀌어도 복귀 확인이 미리보기 없이 적용하지 않음", async () => {
      const { result, onApply } = await mountSyncedToOld();
      mocked.getGistVersionsWithCredentials.mockResolvedValue([B_NEWER]);
      mocked.getGistVersions.mockResolvedValue([B_NEWER]);
      await connectAndCancel(result);
      expectNeverSyncedBaseline(result);

      await act(async () => {
        result.current.setAutoSyncEnabled(true);
        await flushMicro();
      });
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      await act(async () => { await result.current.resolveGistConflict("cancel"); });

      // 다시 켤 때 예약된 자동 업로드(디바운스 = throttle 60초)를 먼저 소진 — 표식이라 업로드 대신 다시 충돌 모달
      await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      await act(async () => { await result.current.resolveGistConflict("cancel"); });

      // 그 뒤 다른 기기가 새 Gist를 또 바꿈 → 복귀 확인(throttle 경과 후 visible)이 실제로 원격을 읽는 경로
      const REMOTE2 = JSON.stringify(makeData(9));
      mocked.getGistVersions.mockResolvedValue([{ sha: "b2", committedAt: "2026-10-02T06:00:00Z", url: "u" }]);
      mocked.loadFromGist.mockResolvedValue({ dataJson: REMOTE2, updatedAt: "2026-10-02T06:00:00Z" });
      mocked.loadFromGist.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIST_REMOTE_CHECK_THROTTLE_MS + 1000); });
      await act(async () => {
        setVisibility("visible");
        await flushMicro();
      });
      expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
      // 사용자가 거절한(맞춰 보지 않은) 새 Gist 데이터를 조용히 적용하지 않고 묻는다
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE2);
      expect(onApply).not.toHaveBeenCalled();
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    });

    it("원격 검증 실패 후 다시 켜기: 첫 불러오기로 충돌을 묻고, 로컬을 묻지 않고 올리지 않음", async () => {
      const { result, onApply } = await mountSyncedToOld();
      mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
      mocked.getGistVersions.mockResolvedValue([B_OLDER]);
      // 연결 시점의 원격은 깨져 있었고, 나중에 (다른 기기가) 고쳐 둠
      mocked.loadFromGist.mockResolvedValueOnce({ dataJson: "not json", updatedAt: "2026-10-01T00:00:00Z" });

      let outcome: string | undefined;
      await act(async () => { outcome = await result.current.connectDevice(P); });
      expect(outcome).toBe("failed");
      expect(result.current.autoSyncEnabled).toBe(false);
      expectNeverSyncedBaseline(result);
      mocked.getGistVersions.mockClear();
      mocked.loadFromGist.mockClear();

      await act(async () => {
        result.current.setAutoSyncEnabled(true);
        await flushMicro();
      });
      expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(mocked.saveToGist).not.toHaveBeenCalled();
      expect(onApply).not.toHaveBeenCalled();
    });

    it("취소 후 수동 저장: 옛 시각 비교로 통과하지 않고 충돌 확인을 거친다", async () => {
      const { result } = await mountSyncedToOld();
      mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
      mocked.getGistVersions.mockResolvedValue([B_OLDER]);
      await connectAndCancel(result);

      await act(async () => { await result.current.manualPush(); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
    });

    it("취소 후 다시 켰는데 새 Gist 버전 조회가 계속 실패: 빈 기준으로 통과하지 않고 충돌 확인을 거친다", async () => {
      const { result } = await mountSyncedToOld();
      mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
      await connectAndCancel(result);
      mocked.getGistVersions.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));

      await act(async () => {
        result.current.setAutoSyncEnabled(true);
        await flushMicro();
      });
      // 부팅 불러오기는 버전 조회 실패로 아무것도 못 함(known 빈 값) — 충돌 모달 없음
      expect(useUIStore.getState().gistConflict).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
      // 업로드 경로까지 실제로 왔고(버전 조회 2회째), 빈 known 때문에 그냥 올리지 않고 내용 비교 → 충돌 모달
      expect(mocked.getGistVersions).toHaveBeenCalledTimes(2);
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(MARKER_B);
    });

    it("S6 같은 Gist 재연결('연결 끊김' 복구): 미리보기 교체 없이 토큰만 저장·자동 동기화 유지, 끊긴 동안 편집은 충돌 확인으로", async () => {
      // 토큰이 사라진 채 부팅(연결 끊김) — 이 기기는 올리기만 했고(pull 기록 없음) 마지막 push는 makeData(1)
      window.localStorage.setItem("fw-gist-id", OLD_ID);
      window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(1))));
      mocked.getGistAutoSync.mockReturnValue(true);
      stamps.push = "2026-10-02T00:00:00Z";
      const onApply = vi.fn();
      const { result, rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, onApply), {
        initialProps: { d: makeData(1) },
      });
      await act(async () => { await flush(); });
      // 끊긴 동안 로컬 편집 + 다른 기기가 원격을 바꿈
      rerender({ d: makeData(2) });
      await act(async () => { await flush(); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      const hashBefore = window.localStorage.getItem("fw-gist-last-push-hash");

      let promise!: Promise<string>;
      await act(async () => {
        promise = result.current.connectDevice({ ...P, gistId: OLD_ID });
        await flushMicro();
      });
      expect(useUIStore.getState().pendingApply).toBeNull();
      await expect(promise).resolves.toBe("connected");
      expect(mocked.loadFromGist).not.toHaveBeenCalled();
      expect(onApply).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("fw-gist-token")).toBe(P.token);
      expect(mocked.setGistAutoSync).not.toHaveBeenCalled();
      expect(result.current.autoSyncEnabled).toBe(true);
      expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashBefore);
      expect(stamps.push).toBe("2026-10-02T00:00:00Z");

      // 끊긴 동안의 편집은 업로드 전에 원격과 내용 비교 → 다른 기기 변경이 있으니 덮지 않고 충돌 모달
      await act(async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
        await flushMicro();
      });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
      expect(useUIStore.getState().gistConflict?.pendingLocalDataJson).toBe(toUserDataJson(makeData(2)));
    });

    describe("표식이 갇히지 않음 — 덮어쓸 데이터가 없거나 Gist가 바뀌면 업로드", () => {
      const NO_FILE = "Gist에 FarmWallet 데이터가 없습니다.";
      const NOT_FOUND = "Gist 불러오기 실패: Gist를 찾을 수 없습니다. 삭제되었을 수 있습니다.";
      const NET = "네트워크 연결을 확인해주세요.";
      const localJson = () => toUserDataJson(makeData(1));

      async function reEnableAndWaitDebounce(result: { current: ReturnType<typeof useGistSync> }) {
        await act(async () => {
          result.current.setAutoSyncEnabled(true);
          await flushMicro();
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
      }

      it("(a) 새 Gist에 FarmWallet 파일이 없음(연결 실패) → 다시 켜면 잃을 것이 없으니 업로드해 파일을 만든다", async () => {
        const { result } = await mountSyncedToOld();
        mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
        mocked.getGistVersions.mockResolvedValue([B_OLDER]);
        mocked.loadFromGist.mockRejectedValue(new gistSync.GistNoRemoteDataError(NO_FILE));

        let outcome: string | undefined;
        await act(async () => { outcome = await result.current.connectDevice(P); });
        expect(outcome).toBe("failed");
        expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(MARKER_B);

        await reEnableAndWaitDebounce(result);
        expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
        expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(localJson());
        expect(useUIStore.getState().gistConflict).toBeNull();
        // 표식이 실제 해시로 바뀌어 이후는 정상 동기화
        expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(localJson()));
      });

      it("(b) 연결 취소 후 설정에서 Gist ID를 비우고 저장(새 Gist 생성) → 다른 Gist의 표식은 막지 않는다", async () => {
        const { result } = await mountSyncedToOld();
        mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
        mocked.getGistVersions.mockResolvedValue([B_OLDER]);
        await connectAndCancel(result);
        expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(MARKER_B);

        // 실제 동작처럼 ID가 없으면 조회·불러오기는 실패 — 저장(saveToGist)만 새 Gist를 만든다
        mocked.getGistVersions.mockRejectedValue(new Error("토큰 또는 Gist ID가 없습니다."));
        mocked.loadFromGist.mockRejectedValue(new Error("Gist ID가 설정되지 않았습니다. 먼저 저장을 해주세요."));
        window.localStorage.removeItem("fw-gist-id"); // GistSyncCard에서 ID를 비움 ("자동 생성됨 (첫 저장 시)")

        await act(async () => { await result.current.manualPush(); });
        expect(mocked.loadFromGist).not.toHaveBeenCalled();
        expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
        expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(localJson());
        expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(localJson()));
      });

      it("(b') 연결 취소 후 설정에서 다른 Gist ID로 바꿈 → 표식은 그 Gist와 무관해 막지 않는다", async () => {
        const { result } = await mountSyncedToOld();
        mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
        mocked.getGistVersions.mockResolvedValue([B_OLDER]);
        await connectAndCancel(result);
        window.localStorage.setItem("fw-gist-id", "1111111111111111111111111111aaaa");

        // 직접 입력한 Gist도 불러온 적이 없으니 덮기 전에 내용 비교(K13) — 데이터가 있으면 충돌로 묻되,
        // 다른 Gist에 세운 표식 때문에 never-synced로 취급하지는 않는다
        mocked.loadFromGist.mockResolvedValueOnce({ dataJson: toUserDataJson(makeData(8)), updatedAt: B_OLDER.committedAt });
        await act(async () => { await result.current.manualPush(); });
        expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
        expect(useUIStore.getState().gistConflict?.reason).toBeUndefined();
        expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(toUserDataJson(makeData(8)));
        await act(async () => { await result.current.resolveGistConflict("cancel"); });

        // 아직 FarmWallet 데이터가 없는 Gist면 잃을 것이 없으니 그대로 업로드 (표식이 막지 않음)
        mocked.loadFromGist.mockRejectedValueOnce(new gistSync.GistNoRemoteDataError("데이터 파일 없음"));
        await act(async () => { await result.current.manualPush(); });
        expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
      });

      it("(c) 연결 취소 후 새 Gist가 삭제됨(404) → 잃을 것이 없으니 업로드 진행 (saveToGist의 404 → 새 Gist 생성 경로)", async () => {
        const { result } = await mountSyncedToOld();
        mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
        mocked.getGistVersions.mockResolvedValue([B_OLDER]);
        await connectAndCancel(result);
        mocked.getGistVersions.mockRejectedValue(new Error("버전 목록 조회 실패: Gist를 찾을 수 없습니다. 삭제되었을 수 있습니다."));
        mocked.loadFromGist.mockRejectedValue(new gistSync.GistNoRemoteDataError(NOT_FOUND));

        await reEnableAndWaitDebounce(result);
        expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
        expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(localJson());
        expect(useUIStore.getState().gistConflict).toBeNull();
      });

      it("(d) 표식 상태에서 그 밖의 불러오기 실패 → 올리지 않고 실패 기록, 수동 저장은 토스트", async () => {
        const toastError = vi.spyOn(toast, "error");
        try {
          const { result } = await mountSyncedToOld();
          mocked.getGistVersionsWithCredentials.mockResolvedValue([B_OLDER]);
          mocked.getGistVersions.mockResolvedValue([B_OLDER]);
          await connectAndCancel(result);
          mocked.loadFromGist.mockRejectedValue(new Error(NET));

          // 다시 켬: 부팅 불러오기 실패(1) → 자동 업로드의 불러오기 실패(2) — 업로드 경로의 버전 조회 성공은
          // 실패 수를 되돌리지 않으므로(#9) 연속 실패가 쌓여 상태 배지가 오류를 띄울 수 있다
          await reEnableAndWaitDebounce(result);
          expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
          expect(result.current.syncHealth.consecutiveFailures).toBe(2);
          expect(result.current.syncHealth.lastError).toBe(NET);

          // 수동 저장: 조용히 끝나지 않고 토스트 + 실패 기록
          toastError.mockClear();
          await act(async () => { await result.current.manualPush(); });
          expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
          expect(toastError).toHaveBeenCalledWith(`Gist 저장 실패: ${NET}`, expect.anything());
          expect(result.current.syncHealth.consecutiveFailures).toBe(3);
          expect(result.current.syncHealth.lastError).toBe(NET);
          expect(useUIStore.getState().gistConflict).toBeNull();
          expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(MARKER_B);
        } finally {
          toastError.mockRestore();
        }
      });
    });
  });
});

describe("loadFromGist — 덮어쓸 원격 데이터 없음 신호", () => {
  // 모듈 mock과 별개로 실제 구현을 fetch stub으로 검증 (메시지는 기존 문구 그대로)
  const ID = "0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("fw-gist-token", "t");
    window.localStorage.setItem("fw-gist-id", ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  async function actualLoad() {
    const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
    return { load: actual.loadFromGist, NoData: actual.GistNoRemoteDataError };
  }

  it("404 → GistNoRemoteDataError (기존 문구)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));
    const { load, NoData } = await actualLoad();
    const err = await load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoData);
    expect(err).toBeInstanceOf(gistSync.GistNoRemoteDataError);
    expect((err as Error).message).toBe("Gist 불러오기 실패: Gist를 찾을 수 없습니다. 삭제되었을 수 있습니다.");
  });

  it("데이터 파일 없음 → GistNoRemoteDataError (기존 문구)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: {} }), { status: 200 })));
    const { load, NoData } = await actualLoad();
    const err = await load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoData);
    expect((err as Error).message).toBe("Gist에 FarmWallet 데이터가 없습니다.");
  });

  it("description의 스키마 버전이 이 앱보다 높으면 GistSchemaTooNewError, 같거나 없으면 정상", async () => {
    const actual = await vi.importActual<typeof gistSync>("../services/gistSync");
    const body = (description: string) =>
      JSON.stringify({ description, files: { "farmwallet-data.json": { content: "{}" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body("FarmWallet 데이터 백업 (schema v999)"), { status: 200 })));
    const err = await actual.loadFromGist().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(actual.GistSchemaTooNewError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body("FarmWallet 데이터 백업"), { status: 200 })));
    await expect(actual.loadFromGist()).resolves.toMatchObject({ dataJson: "{}" });
  });

  it("본문을 못 읽은 200(비JSON·빈 객체)은 '원격 없음'이 아니라 일반 오류 — 미동기 표식 상태에서 덮어쓰기 방지", async () => {
    const { load, NoData } = await actualLoad();
    for (const body of ["<html>garbage", "{}"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
      const err = await load().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NoData);
    }
  });

  it("그 밖의 실패(401·ID 없음)는 일반 오류", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 401 })));
    const { load, NoData } = await actualLoad();
    const authErr = await load().catch((e: unknown) => e);
    expect(authErr).toBeInstanceOf(Error);
    expect(authErr).not.toBeInstanceOf(NoData);

    window.localStorage.removeItem("fw-gist-id");
    const noIdErr = await load().catch((e: unknown) => e);
    expect(noIdErr).not.toBeInstanceOf(NoData);
    expect((noIdErr as Error).message).toBe("Gist ID가 설정되지 않았습니다. 먼저 저장을 해주세요.");
  });
});

describe("useGistSync — 원격을 반영하지 못한 부팅·로드 실패 중 동기화 (데이터 유실 회귀)", () => {
  /** 다른 기기가 올린 원격 — 이 기기의 마지막 push(makeData(1))와 다르다 */
  const REMOTE_JSON = toUserDataJson(makeData(5));
  const REMOTE_V = { sha: "r", committedAt: "2026-04-20T01:00:00Z", url: "u" };
  const flushMicro = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
    mocked.getGistAutoSync.mockReturnValue(true);
    mocked.getGistToken.mockReturnValue("test-token");
    mocked.getGistId.mockReturnValue("test-gist-id");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("2026-04-19T00:00:00Z");
    mocked.getGistVersions.mockResolvedValue([REMOTE_V]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: REMOTE_JSON, updatedAt: REMOTE_V.committedAt });
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T02:00:00Z", committedAt: "2026-04-20T02:00:00Z" });
    // 이 기기는 makeData(1)을 마지막으로 올렸고 로컬도 그대로(dirty 아님)
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(1))));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
  });

  it("S1 StrictMode 이중 실행: 첫 실행이 정리돼도 부팅 불러오기가 원격을 적용한다", async () => {
    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(1), onApply), { wrapper: StrictMode });
    await act(async () => { await flushMicro(); });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(REMOTE_JSON, REMOTE_V.committedAt);
  });

  it("S1 부팅 불러오기 실패(타임아웃): 다음 자동 업로드가 다른 기기 변경을 충돌 확인 없이 덮지 않는다", async () => {
    mocked.loadFromGist.mockRejectedValueOnce(new Error("요청 시간 초과"));
    const onApply = vi.fn();
    // 마지막 push(makeData(1)) 이후 로컬 편집이 있음 — 편집이 없으면 올릴 것이 없어 업로드 자체를 건너뛴다(G102)
    renderHook(() => useGistSync(makeData(2), onApply));
    await act(async () => { await flushMicro(); });
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE_JSON);
  });

  it("S1 로컬 시계가 빨라 '우리 push'로 보인 원격(pull 기록 없음): known·lastPullAt을 올리지 않고 업로드 전 내용 비교", async () => {
    mocked.getGistLastPullAt.mockReturnValue(""); // Gist를 만든 PC — 올리기만 했다
    mocked.getGistLastPushAt.mockReturnValue("2026-04-20T05:00:00Z"); // 로컬 시계가 빨라 원격 commit(01:00)보다 늦게 찍힘
    renderHook(() => useGistSync(makeData(2), vi.fn())); // 미push 로컬 편집 있음 (없으면 업로드를 건너뜀)
    await act(async () => { await flushMicro(); });
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(mocked.setGistLastPullAt).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE_JSON);
  });

  it("S1 같은 상황에서 원격이 실제로 우리 마지막 push면 내용 비교 후 그대로 업로드 (가짜 충돌 없음)", async () => {
    mocked.getGistLastPullAt.mockReturnValue("");
    mocked.getGistLastPushAt.mockReturnValue("2026-04-20T05:00:00Z");
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: REMOTE_V.committedAt });
    renderHook(() => useGistSync(makeData(2), vi.fn()));
    await act(async () => { await flushMicro(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(2)));
  });

  it("S2 disabled(로드 실패·로딩 중): 부팅 불러오기·자동 업로드·복귀 확인·수동 저장/불러오기 모두 안 함, 풀리면 부팅 불러오기", async () => {
    const onApply = vi.fn();
    const { result, rerender } = renderHook(
      ({ disabled }: { disabled: boolean }) => useGistSync(getEmptyData(), onApply, { disabled }),
      { initialProps: { disabled: true } }
    );
    await act(async () => { await flushMicro(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + GIST_REMOTE_CHECK_THROTTLE_MS + 1000); });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await flushMicro();
    });
    await act(async () => {
      await result.current.manualPush();
      await result.current.manualPull();
    });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    rerender({ disabled: false });
    await act(async () => { await flushMicro(); });
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(1);
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
  });

  it("원격이 더 새 스키마(GistSchemaTooNewError)면 적용하지 않고, 이후 로컬 편집도 업로드하지 않는다(새 필드 보존)", async () => {
    mocked.loadFromGist.mockRejectedValue(new gistSync.GistSchemaTooNewError(99));
    const onApply = vi.fn();
    const { result, rerender } = renderHook(
      ({ d }: { d: ReturnType<typeof makeData> }) => useGistSync(d, onApply),
      { initialProps: { d: makeData(1) } }
    );
    await act(async () => { await flushMicro(); });
    expect(onApply).not.toHaveBeenCalled();

    rerender({ d: makeData(2) }); // 로컬 편집
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + GIST_REMOTE_CHECK_THROTTLE_MS + 1000); });
    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("S5 hasUnsyncedLocalData: 마지막 동기화 내용·받을 내용과 같으면 false(스냅샷 생략), 미동기화 편집이나 기록 없음은 true", () => {
    const synced = toUserDataJson(makeData(1));
    expect(hasUnsyncedLocalData(synced, REMOTE_JSON)).toBe(false);
    expect(hasUnsyncedLocalData(REMOTE_JSON, REMOTE_JSON)).toBe(false);
    expect(hasUnsyncedLocalData(toUserDataJson(makeData(2)), REMOTE_JSON)).toBe(true);
    window.localStorage.removeItem("fw-gist-last-push-hash"); // 구버전 상태 — 판단 불가
    expect(hasUnsyncedLocalData(synced, REMOTE_JSON)).toBe(true);
  });
});

describe("useGistSync — 업로드 실패 집계·탭 간 중복 업로드·다른 탭 설정 반영", () => {
  const MOUNT_REMOTE = { sha: "v1", committedAt: "2026-04-20T01:00:00Z", url: "u" };
  const flushMicro = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const waitDebounce = async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
  };

  /** 마운트 → 첫 자동 업로드(makeData(0))까지 끝내 기준점(known=01:00·payload·해시)을 세운 뒤 호출 기록 초기화 */
  async function mountSettled(onLog = vi.fn()) {
    const onApply = vi.fn();
    const hook = renderHook(({ d }: { d: AppData }) => useGistSync(d, onApply, { onLog }), {
      initialProps: { d: makeData(0) },
    });
    await act(async () => { await flush(); });
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockClear();
    mocked.loadFromGist.mockClear();
    mocked.saveToGistWithRetry.mockClear();
    onLog.mockClear();
    return { ...hook, onApply, onLog };
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
    mocked.getGistLastPullAt.mockReturnValue("2026-04-20T02:00:00Z"); // 부팅 pull 건너뜀(원격 01:00 < 02:00)
    mocked.getGistVersions.mockResolvedValue([MOUNT_REMOTE]);
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
  });

  it("#9 버전 조회는 성공하고 저장만 연달아 실패하면 연속 실패가 2회로 쌓여 상태가 오류가 된다", async () => {
    const { result, rerender } = await mountSettled();
    mocked.saveToGistWithRetry.mockRejectedValue(new Error("Gist 저장 실패: 권한 없음 (403)"));

    rerender({ d: makeData(1) });
    await waitDebounce();
    expect(result.current.syncHealth.consecutiveFailures).toBe(1);
    rerender({ d: makeData(2) });
    await waitDebounce();
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(2); // 두 번 모두 조회는 성공
    expect(result.current.syncHealth.consecutiveFailures).toBe(2);

    const { deriveGistSyncStatus } = await import("../services/gistSyncStatus");
    expect(
      deriveGistSyncStatus({ autoSyncEnabled: true, hasToken: true, hasGistId: true, health: result.current.syncHealth }).kind
    ).toBe("error");

    // 저장이 다시 성공하면 리셋
    mocked.saveToGistWithRetry.mockResolvedValue({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
    rerender({ d: makeData(3) });
    await waitDebounce();
    expect(result.current.syncHealth.consecutiveFailures).toBe(0);
  });

  /** 주기 확인을 켠 마운트 — interval 때문에 flush()(runAllTimersAsync)는 쓰지 않는다. 첫 자동 업로드까지 소진 */
  async function mountPolling() {
    // 적용 콜백은 App처럼 고정 참조 — 렌더마다 새 함수면 주기 확인 interval이 매 렌더 다시 시작된다
    const onApply = vi.fn();
    const hook = renderHook(({ d }: { d: AppData }) => useGistSync(d, onApply, { remotePollMs: 180_000 }), {
      initialProps: { d: makeData(0) },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    mocked.getGistVersions.mockClear();
    mocked.saveToGistWithRetry.mockClear();
    return hook;
  }

  it("K2 아직 올리지 못한 변경이 있으면 주기 확인의 조회 성공이 저장 실패 수를 되돌리지 않는다", async () => {
    const { result, rerender } = await mountPolling(); // t≈61s
    mocked.saveToGistWithRetry.mockRejectedValue(new Error("Gist 저장 실패: 권한 없음 (403)"));
    rerender({ d: makeData(1) });
    await waitDebounce(); // t≈122s 저장 실패
    expect(result.current.syncHealth.consecutiveFailures).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); }); // t≈192s 주기 확인(조회 성공, dirty)
    expect(mocked.getGistVersions).toHaveBeenCalledTimes(2); // 업로드 조회 1 + 주기 확인 1
    expect(result.current.syncHealth.consecutiveFailures).toBe(1);

    rerender({ d: makeData(2) });
    await waitDebounce();
    expect(result.current.syncHealth.consecutiveFailures).toBe(2);
  });

  it("K2 깨끗한 기기는 조회 실패 뒤 주기 확인 조회가 성공하면 정상으로 돌아온다", async () => {
    const { result } = await mountPolling(); // t≈61s
    mocked.getGistVersions.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); }); // 180s 확인 실패
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); }); // 360s 확인 실패
    expect(result.current.syncHealth.consecutiveFailures).toBe(2);

    mocked.getGistVersions.mockResolvedValue([MOUNT_REMOTE]);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); }); // 540s 확인 성공
    expect(result.current.syncHealth.consecutiveFailures).toBe(0);
  });

  it("G102 다른 탭이 이미 같은 내용을 올렸으면(공유 해시 일치) 원격 조회·저장 없이 건너뛴다", async () => {
    const { rerender } = await mountSettled();
    // 탭 A가 makeData(1)을 올림 → 공유 해시 갱신, 탭 동기화로 이 탭(B)도 같은 데이터를 받음
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(1))));
    rerender({ d: makeData(1) });
    await waitDebounce();
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

    // 이후 B의 실제 편집은 정상 업로드
    rerender({ d: makeData(2) });
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(2)));
  });

  it("#10 시간 초과로 실패 처리됐지만 GitHub은 커밋한 업로드 — 다음 업로드가 자기 커밋을 외부 변경으로 보지 않는다", async () => {
    const { rerender } = await mountSettled();
    mocked.saveToGistWithRetry.mockRejectedValueOnce(new Error("요청 시간 초과 (15s)"));
    rerender({ d: makeData(1) });
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    // 실패한 PATCH 전에는 공유 해시를 기록하지 않는다 (dirty 기준이 깨끗으로 보이면 원격에 덮임)
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(0))));

    // 실제로는 서버가 makeData(1)을 커밋함
    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-04-20T03:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: "2026-04-20T03:00:00Z" });
    mocked.saveToGistWithRetry.mockClear();

    rerender({ d: makeData(2) }); // 실패 뒤 추가 편집
    await waitDebounce();
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1); // 시각상 새 원격 → 내용 비교
    expect(useUIStore.getState().gistConflict).toBeNull(); // 가짜 충돌 모달 없음
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(2)));
  });

  it("#10 원격이 우리가 시도한 내용과 다르면 여전히 충돌 모달", async () => {
    const { rerender } = await mountSettled();
    mocked.saveToGistWithRetry.mockRejectedValueOnce(new Error("요청 시간 초과 (15s)"));
    rerender({ d: makeData(1) });
    await waitDebounce();

    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-04-20T03:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(7)), updatedAt: "2026-04-20T03:00:00Z" });
    mocked.saveToGistWithRetry.mockClear();

    rerender({ d: makeData(2) });
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(toUserDataJson(makeData(7)));
  });

  it("R1 시간 초과로 실패 처리됐지만 커밋된 업로드 뒤 편집 — 디바운스 전 주기 확인이 자기 커밋을 '다른 기기 변경' 충돌로 띄우지 않고, 다음 자동 저장이 편집을 올린다", async () => {
    const { rerender } = await mountPolling(); // t≈61s (주기 확인 180s·360s…)
    mocked.saveToGistWithRetry.mockRejectedValueOnce(new Error("요청 시간 초과 (15s)"));
    rerender({ d: makeData(1) });
    await waitDebounce(); // t≈122s 저장 '실패' — 실제로는 서버가 makeData(1)을 커밋
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-04-20T03:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: "2026-04-20T03:00:00Z" });
    mocked.saveToGistWithRetry.mockClear();
    mocked.loadFromGist.mockClear();

    rerender({ d: makeData(2) }); // 실패 뒤 편집 — 디바운스는 t≈182s
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); }); // t≈181s: 180s 주기 확인만 실행
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1); // 주기 확인이 새 원격 내용을 비교함
    expect(useUIStore.getState().gistConflict).toBeNull(); // 가짜 충돌 모달 없음
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    // 직전 PATCH를 성공으로 확정 — 새로고침 뒤 부팅 불러오기의 dirty 기준도 맞는다
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(1))));

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // 디바운스 → 편집 업로드
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1); // known=원격 커밋 — 다시 내용 비교하지 않음
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(2)));
  });

  it("G101 맞춰 본 적 없는 Gist(다른 탭이 기기 연결을 취소) — 복귀 확인이 원격을 자동 적용하지 않는다", async () => {
    const { onApply } = await mountSettled();
    window.localStorage.setItem("fw-gist-last-push-hash", "unsynced:test-gist-id");
    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-04-20T03:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(9)), updatedAt: "2026-04-20T03:00:00Z" });

    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_REMOTE_CHECK_THROTTLE_MS + 1000); });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicro();
    });
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.loadFromGist).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe("unsynced:test-gist-id");
  });

  it("G101 다른 탭에서 자동 동기화를 끄면 이 탭도 꺼지고 대기 중 자동 업로드가 취소된다", async () => {
    const { result, rerender } = await mountSettled();
    rerender({ d: makeData(1) }); // 디바운스 대기 중

    // 무관한 키는 무시
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "fw-other", newValue: "x" }));
    });
    expect(result.current.autoSyncEnabled).toBe(true);

    mocked.getGistAutoSync.mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "fw-gist-auto-sync", newValue: "false" }));
    });
    expect(result.current.autoSyncEnabled).toBe(false);
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();

    // 다시 켜면 반영
    mocked.getGistAutoSync.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "fw-gist-auto-sync", newValue: "true" }));
    });
    expect(result.current.autoSyncEnabled).toBe(true);
  });

  /** 복귀 확인(visible)으로 다른 기기 변경을 적용 — 로컬이 깨끗해야 조용히 적용된다 */
  async function applyRemoteViaResume(remote: AppData, committedAt: string) {
    mocked.getGistVersions.mockResolvedValue([{ sha: committedAt, committedAt, url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(remote), updatedAt: committedAt });
    await act(async () => { await vi.advanceTimersByTimeAsync(GIST_REMOTE_CHECK_THROTTLE_MS + 1000); });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicro();
    });
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(remote)));
  }

  it("K0 우리가 올린 X → 다른 기기 Y 적용 → 다른 기기가 원격을 X로 되돌림 → 편집 업로드는 조용히 덮지 않고 충돌 모달", async () => {
    const { rerender, onApply } = await mountSettled(); // X = makeData(0) 업로드 성공
    await applyRemoteViaResume(makeData(5), "2026-04-20T03:00:00Z");
    expect(onApply).toHaveBeenCalledTimes(1);
    rerender({ d: makeData(5) });

    // 다른 기기가 삭제·과거 버전 복원으로 원격을 X(우리가 예전에 올린 내용)로 되돌림
    mocked.getGistVersions.mockResolvedValue([{ sha: "v3", committedAt: "2026-04-20T04:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(0)), updatedAt: "2026-04-20T04:00:00Z" });
    mocked.saveToGistWithRetry.mockClear();
    rerender({ d: makeData(6) });
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(toUserDataJson(makeData(0)));
  });

  it("K0 시간 초과로 결과를 모르는 시도 X는 그 뒤 기준이 바뀌면(Y 적용) 더 이상 '우리 커밋'이 아니다", async () => {
    const { rerender } = await mountSettled();
    mocked.saveToGistWithRetry.mockRejectedValueOnce(new Error("요청 시간 초과 (15s)"));
    rerender({ d: makeData(1) }); // X 시도 — 실패 처리(실제 커밋 여부 모름)
    await waitDebounce();
    rerender({ d: makeData(0) }); // 편집 되돌림 → 깨끗한 상태
    await applyRemoteViaResume(makeData(5), "2026-04-20T03:00:00Z");
    rerender({ d: makeData(5) });

    // 다른 기기가 원격을 우연히 X와 같은 내용으로 만듦
    mocked.getGistVersions.mockResolvedValue([{ sha: "v3", committedAt: "2026-04-20T04:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: "2026-04-20T04:00:00Z" });
    mocked.saveToGistWithRetry.mockClear();
    rerender({ d: makeData(6) });
    await waitDebounce();
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(toUserDataJson(makeData(1)));
  });

  it("#12 자동 업로드 진행 중 수동 저장은 조용히 끝나지 않고 로그·안내를 남긴다", async () => {
    const { result, rerender, onLog } = await mountSettled();
    let release!: () => void;
    mocked.saveToGistWithRetry.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ gistId: "test-gist-id", updatedAt: "2026-04-20T01:00:00Z", committedAt: "2026-04-20T01:00:00Z" });
      })
    );
    rerender({ d: makeData(1) });
    await waitDebounce(); // 자동 업로드가 PATCH 대기 중
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1); // 겹쳐 올리지 않음
    expect(onLog).toHaveBeenCalledWith("Gist 저장: 자동 저장이 진행 중이라 이번 수동 저장은 건너뜀", "info");

    await act(async () => { release(); await flushMicro(); });
  });

  it("#7 오래 저장되지 않음 경고는 '저장' 용어를 쓴다", () => {
    mocked.getGistLastPushAt.mockReturnValue(new Date(Date.now() - 50 * 36e5).toISOString());
    const critical = renderHook(() => useGistSync(makeData(0), vi.fn()));
    expect(critical.result.current.gistStaleWarning?.type).toBe("critical");
    expect(critical.result.current.gistStaleWarning?.message).toBe("50시간 동안 Gist에 저장되지 않았어요. 지금 저장하세요.");
    critical.unmount();

    mocked.getGistLastPushAt.mockReturnValue(new Date(Date.now() - 13 * 36e5).toISOString());
    const warning = renderHook(() => useGistSync(makeData(0), vi.fn()));
    expect(warning.result.current.gistStaleWarning?.type).toBe("warning");
    expect(warning.result.current.gistStaleWarning?.message).toBe("13시간 경과 — Gist 저장 권장");
    warning.unmount();
  });
});

describe("useGistSync — 충돌 모달: 재연결 재시도·안내 사유·낡은 모달·빈 기기 덮어쓰기 확인·결과 토스트", () => {
  const P = { gistId: "0123456789abcdef0123456789abcdef", token: "ghp_RETRY777" };
  const REMOTE = JSON.stringify(makeData(5));
  const VERSION = { sha: "v", committedAt: "2026-10-02T01:00:00Z", url: "u" };

  /** 일반 toast(...) 호출은 spy가 안 돼 토스트 저장소에서 메시지를 읽는다 */
  const toastMessages = () => {
    const { result } = renderHook(() => useToasterStore());
    return result.current.toasts.map((t) => t.message);
  };

  /** 이 Gist에 연결된 기기 (자동 동기화 OFF — 자동 업로드·부팅 불러오기 잡음 없음) */
  const connectToGist = () => {
    window.localStorage.setItem("fw-gist-token", "t");
    window.localStorage.setItem("fw-gist-id", P.gistId);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    toast.removeAll();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
    useAppStore.setState({ data: getEmptyData() });
    mocked.getGistAutoSync.mockReturnValue(false);
    mocked.getGistToken.mockImplementation(() => window.localStorage.getItem("fw-gist-token") ?? "");
    mocked.getGistId.mockImplementation(() => window.localStorage.getItem("fw-gist-id") ?? "");
    mocked.getGistLastPushAt.mockReturnValue("");
    mocked.getGistLastPullAt.mockReturnValue("");
    mocked.getGistVersions.mockResolvedValue([VERSION]);
    mocked.getGistVersionsWithCredentials.mockResolvedValue([VERSION]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: REMOTE, updatedAt: VERSION.committedAt });
    const saved = { gistId: P.gistId, updatedAt: "2026-10-02T02:00:00Z", committedAt: "2026-10-02T02:00:00Z" };
    mocked.saveToGist.mockResolvedValue(saved);
    mocked.saveToGistWithRetry.mockResolvedValue(saved);
  });

  afterEach(() => {
    vi.useRealTimers();
    useUIStore.getState().setGistConflict(null);
    useUIStore.getState().setPendingApply(null);
    useAppStore.setState({ data: getEmptyData() });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("G120 연결이 불러오기 단계에서 실패한 뒤 같은 링크로 다시 시도하면 원격을 불러와 적용한다 (빈 기기 → 미리보기 없이, 자동 동기화 ON)", async () => {
    const toastError = vi.spyOn(toast, "error");
    try {
      let current: AppData = getEmptyData();
      const onApply = vi.fn((json: string) => { current = JSON.parse(json) as AppData; });
      const { result } = renderHook(() => useGistSync(current, onApply));
      await act(async () => { await flush(); });

      mocked.loadFromGist.mockRejectedValueOnce(new Error("네트워크 연결을 확인해주세요."));
      let outcome: string | undefined;
      await act(async () => { outcome = await result.current.connectDevice(P); });
      expect(outcome).toBe("failed");
      expect(toastError).toHaveBeenCalledWith("네트워크 연결을 확인해주세요. 같은 연결 링크로 다시 시도할 수 있어요.");
      expect(window.localStorage.getItem("fw-gist-id")).toBe(P.gistId);
      expect(onApply).not.toHaveBeenCalled();

      // 같은 링크 재시도 — '같은 Gist 재연결(토큰만 저장)'로 삼키지 않고 불러오기부터 다시
      await act(async () => { outcome = await result.current.connectDevice(P); });
      expect(outcome).toBe("connected");
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith(REMOTE, VERSION.committedAt);
      expect(useUIStore.getState().pendingApply).toBeNull();
      expect(mocked.setGistAutoSync).toHaveBeenCalledWith(true);
      expect(result.current.autoSyncEnabled).toBe(true);
      expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(REMOTE));
    } finally {
      toastError.mockRestore();
    }
  });

  it("G121 아직 불러온 적 없는 기기의 [저장]은 never-synced 충돌로 열리고, 빈 데이터로 덮어쓰기는 확인을 거절하면 저장하지 않고 모달을 유지한다", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", `unsynced:${P.gistId}`);
    const { result } = renderHook(() => useGistSync(getEmptyData(), vi.fn()));
    await act(async () => { await flush(); });

    await act(async () => { await result.current.manualPush(); });
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict?.reason).toBe("never-synced");
    expect(conflict?.remoteDataJson).toBe(REMOTE);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(mocked.saveToGist).not.toHaveBeenCalled();
      expect(useUIStore.getState().gistConflict).toBe(conflict);

      // 확인하면 사용자 선택대로 덮어쓴다
      confirmSpy.mockReturnValue(true);
      await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
      expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().gistConflict).toBeNull();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("G110 Gist 과거 버전 복원 뒤 [저장]은 restored 충돌로 열린다 (다른 기기 변경이 아님)", async () => {
    connectToGist();
    const restored = makeData(1);
    const { result } = renderHook(() => useGistSync(restored, vi.fn()));
    await act(async () => { await flush(); });
    act(() => { result.current.syncStateAfterRestore(toUserDataJson(restored), "2026-09-01T00:00:00Z"); });

    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.reason).toBe("restored");
  });

  it("G100 낡은 모달 — 원격이 그사이 또 바뀌었으면 '원격 적용'은 적용하지 않고 모달을 최신 원격으로 바꿔 다시 묻는다 (다시 읽기 실패면 기존대로 적용)", async () => {
    connectToGist();
    const successSpy = vi.spyOn(toast, "success");
    try {
      const onApply = vi.fn();
      const { result } = renderHook(() => useGistSync(makeData(1), onApply));
      await act(async () => { await flush(); });
      const conflict = {
        remoteDataJson: REMOTE,
        remoteUpdatedAt: VERSION.committedAt,
        pendingLocalDataJson: toUserDataJson(makeData(1)),
        reason: "never-synced" as const,
      };

      useUIStore.getState().setGistConflict(conflict);
      const NEWER = JSON.stringify(makeData(9));
      mocked.loadFromGist.mockResolvedValue({ dataJson: NEWER, updatedAt: "2026-10-02T03:00:00Z" });
      await act(async () => { await result.current.resolveGistConflict("apply-remote"); });
      expect(onApply).not.toHaveBeenCalled();
      // 닫고 '다시 확인'을 약속하지 않는다 — 자동 동기화 OFF면 아무것도 다시 확인하지 않는다. 사유(reason)는 유지
      expect(useUIStore.getState().gistConflict).toEqual({
        ...conflict,
        remoteDataJson: NEWER,
        remoteUpdatedAt: "2026-10-02T03:00:00Z",
      });
      expect(toastMessages()).toContain("Gist가 그사이 또 바뀌어 최신본으로 다시 보여 드려요. 다시 선택하세요.");
      expect(successSpy).not.toHaveBeenCalled();

      // 바뀐 모달에서 다시 고르면 그 최신본을 적용
      await act(async () => { await result.current.resolveGistConflict("apply-remote"); });
      expect(onApply).toHaveBeenCalledWith(NEWER, VERSION.committedAt);
      expect(useUIStore.getState().gistConflict).toBeNull();
      onApply.mockClear();
      successSpy.mockClear();

      useUIStore.getState().setGistConflict(conflict);
      mocked.loadFromGist.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
      await act(async () => { await result.current.resolveGistConflict("apply-remote"); });
      expect(onApply).toHaveBeenCalledWith(REMOTE, VERSION.committedAt);
      expect(useUIStore.getState().gistConflict).toBeNull();
      expect(successSpy).toHaveBeenCalledWith("Gist 최신본을 적용했어요");
    } finally {
      successSpy.mockRestore();
    }
  });

  it("G100 낡은 모달 — 이 기기 데이터가 그사이 바뀌었으면(다른 탭) '덮어쓰기'는 모달을 연 시점의 데이터를 올리지 않고 최신 로컬로 다시 묻는다", async () => {
    connectToGist();
    const { result, rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(1) },
    });
    await act(async () => { await flush(); });
    const conflict = {
      remoteDataJson: REMOTE,
      remoteUpdatedAt: VERSION.committedAt,
      pendingLocalDataJson: toUserDataJson(makeData(1)),
      reason: "restored" as const,
    };
    useUIStore.getState().setGistConflict(conflict);
    rerender({ d: makeData(2) }); // 다른 탭의 편집이 탭 동기화로 들어옴

    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toEqual({ ...conflict, pendingLocalDataJson: toUserDataJson(makeData(2)) });
    expect(toastMessages()).toContain("이 기기 데이터가 그사이 바뀌어 최신 상태로 다시 보여 드려요. 다시 선택하세요.");

    // 바뀐 모달에서 다시 고르면 지금 데이터를 올린다
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGist.mock.calls[0][0]).toBe(toUserDataJson(makeData(2)));
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("R0 낡은 모달 — 원격이 그사이 또 바뀌었으면 '덮어쓰기'는 저장하지 않고 모달을 최신 원격으로 바꿔 다시 묻는다 (다시 읽기 실패면 기존대로 저장)", async () => {
    connectToGist();
    const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); });
    const conflict = {
      remoteDataJson: REMOTE,
      remoteUpdatedAt: VERSION.committedAt,
      pendingLocalDataJson: toUserDataJson(makeData(1)),
      reason: "restored" as const,
    };
    useUIStore.getState().setGistConflict(conflict);
    // 모달을 연 뒤 다른 기기가 또 저장함
    const NEWER = JSON.stringify(makeData(9));
    mocked.loadFromGist.mockResolvedValue({ dataJson: NEWER, updatedAt: "2026-10-02T03:00:00Z" });

    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toEqual({
      ...conflict,
      remoteDataJson: NEWER,
      remoteUpdatedAt: "2026-10-02T03:00:00Z",
    });
    expect(toastMessages()).toContain("Gist가 그사이 또 바뀌어 최신본으로 다시 보여 드려요. 다시 선택하세요.");

    // 바뀐 모달(사용자가 본 원격 = 지금 원격)에서 다시 고르면 저장
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGist.mock.calls[0][0]).toBe(toUserDataJson(makeData(1)));
    expect(useUIStore.getState().gistConflict).toBeNull();

    // 다시 읽기가 실패하면 모달의 원격본 기준으로 기존대로 저장
    useUIStore.getState().setGistConflict(conflict);
    mocked.loadFromGist.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).toHaveBeenCalledTimes(2);
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("Q0 모달을 연 뒤 원격이 더 새 앱 버전으로 다시 쓰였으면(GistSchemaTooNewError) 덮어쓰기·원격 적용 모두 진행하지 않고 모달을 유지한다", async () => {
    connectToGist();
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await act(async () => { await flush(); });
    const conflict = {
      remoteDataJson: REMOTE,
      remoteUpdatedAt: VERSION.committedAt,
      pendingLocalDataJson: toUserDataJson(makeData(1)),
      reason: "restored" as const,
    };
    useUIStore.getState().setGistConflict(conflict);
    mocked.loadFromGist.mockRejectedValue(new gistSync.GistSchemaTooNewError(99));
    mocked.getGistVersions.mockClear();
    mocked.setGistLastPullAt.mockClear();
    vi.mocked(saveSafetySnapshot).mockClear();

    // 덮어쓰기 — 구버전 payload로 새 스키마 원격을 덮지 않고, 폐기될 원격(모달의 낡은 본) 스냅샷도 만들지 않는다
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).not.toHaveBeenCalled();
    expect(saveSafetySnapshot).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict).toEqual(conflict);

    // 원격 적용 — 모달의 낡은 원격을 적용하지 않고 기준 시각(known·lastPullAt)도 올리지 않는다
    await act(async () => { await result.current.resolveGistConflict("apply-remote"); });
    expect(onApply).not.toHaveBeenCalled();
    expect(mocked.getGistVersions).not.toHaveBeenCalled();
    expect(mocked.setGistLastPullAt).not.toHaveBeenCalled();
    expect(result.current.lastPullAt).toBeNull();
    expect(useUIStore.getState().gistConflict).toEqual(conflict);

    // 취소는 그대로 닫힌다
    await act(async () => { await result.current.resolveGistConflict("cancel"); });
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("K13 자동 동기화 OFF·불러온 적 없음(known·lastPullAt 빈 값): [저장]은 원격이 우리 마지막 push와 다르면 덮지 않고 충돌 모달", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); });

    // 원격 = 다른 기기가 올린 REMOTE(makeData(5)) — 마지막 push(makeData(0))와 다름
    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict?.remoteDataJson).toBe(REMOTE);
    expect(conflict?.pendingLocalDataJson).toBe(toUserDataJson(makeData(1)));
    expect(conflict?.reason).toBeUndefined();
  });

  it("K13 같은 상황에서 원격이 우리 마지막 push와 같으면 그대로 저장", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(0)), updatedAt: VERSION.committedAt });
    const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); });

    await act(async () => { await result.current.manualPush(); });
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(1)));
  });

  it("K13 [저장]의 원격 확인이 실패하면 저장하지 않고 조용히 끝나지도 않는다(실패 기록·토스트)", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.loadFromGist.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
    const toastError = vi.spyOn(toast, "error");
    try {
      const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
      await act(async () => { await flush(); });
      await act(async () => { await result.current.manualPush(); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Gist 저장 실패: 네트워크 연결을 확인해주세요.", { id: "gist-auto-save-error" });
      expect(result.current.syncHealth.consecutiveFailures).toBe(1);
    } finally {
      toastError.mockRestore();
    }
  });

  it("R4 같은 상황(known·lastPullAt 빈 값)에서 버전 조회가 실패해도 [저장]은 내용을 비교한다 — 원격이 우리 마지막 push와 다르면 충돌 모달, 같으면 저장", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockRejectedValue(new Error("요청 시간 초과 (15s)"));
    const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); });

    // 원격 = 다른 기기가 올린 REMOTE — 버전 조회 실패로 시각 비교를 통과시키지 않는다
    await act(async () => { await result.current.manualPush(); });
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);

    // 원격이 우리 마지막 push면 그대로 저장
    useUIStore.getState().setGistConflict(null);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(0)), updatedAt: VERSION.committedAt });
    await act(async () => { await result.current.manualPush(); });
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry.mock.calls[0][0]).toBe(toUserDataJson(makeData(1)));
  });

  it("R4 자동 저장도 같다 — 버전 조회 실패 + 반영한 원격 기준 없음이면 내용 비교 후 충돌 모달", async () => {
    connectToGist();
    mocked.getGistAutoSync.mockReturnValue(true);
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockRejectedValue(new Error("요청 시간 초과 (15s)"));
    renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); }); // 부팅 확인 실패 → 디바운스 후 자동 저장
    expect(mocked.loadFromGist).toHaveBeenCalledTimes(1);
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(REMOTE);
  });

  it("R4 자동 저장도 버전 조회와 원격 읽기가 모두 실패하면 저장하지 않고 첫 실패부터 토스트로 알린다 (실패 집계는 조회 1회만)", async () => {
    connectToGist();
    mocked.getGistAutoSync.mockReturnValue(true);
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockRejectedValue(new Error("요청 시간 초과 (15s)"));
    mocked.loadFromGist.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
    const toastError = vi.spyOn(toast, "error");
    try {
      const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
      await act(async () => { await flush(); }); // 부팅 확인 실패 → 디바운스 후 자동 저장
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Gist 저장 실패: 네트워크 연결을 확인해주세요.", { id: "gist-auto-save-error" });
      expect(useUIStore.getState().gistConflict).toBeNull();
      // 부팅 조회 실패 1회 + 자동 저장의 조회 실패 1회 — 원격 읽기 실패를 따로 더 세지 않는다
      expect(result.current.syncHealth.consecutiveFailures).toBe(2);
    } finally {
      toastError.mockRestore();
    }
  });

  it("R4 버전 조회와 원격 읽기가 모두 실패하면 [저장]은 저장하지 않고 실패를 알린다", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    mocked.getGistVersions.mockRejectedValue(new Error("요청 시간 초과 (15s)"));
    mocked.loadFromGist.mockRejectedValue(new Error("네트워크 연결을 확인해주세요."));
    const toastError = vi.spyOn(toast, "error");
    try {
      const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
      await act(async () => { await flush(); });
      await act(async () => { await result.current.manualPush(); });
      expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Gist 저장 실패: 네트워크 연결을 확인해주세요.", { id: "gist-auto-save-error" });
      expect(useUIStore.getState().gistConflict).toBeNull();
    } finally {
      toastError.mockRestore();
    }
  });

  it("K14 이 세션에 정상 저장한 뒤 과거 버전을 복원하고 [저장]하면 — 원격이 그 저장본이어도 restored 충돌로 묻는다", async () => {
    connectToGist();
    // 원격 REMOTE는 우리 마지막 push — 첫 [저장]은 가짜 충돌로 그대로 저장
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(REMOTE));
    const { result, rerender } = renderHook(({ d }: { d: AppData }) => useGistSync(d, vi.fn()), {
      initialProps: { d: makeData(1) },
    });
    await act(async () => { await flush(); });
    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
    mocked.saveToGistWithRetry.mockClear();

    // 원격 = 방금 올린 makeData(1). 과거 버전 V 복원 → 편집 → [저장]
    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-10-02T02:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: "2026-10-02T02:00:00Z" });
    act(() => { result.current.syncStateAfterRestore(toUserDataJson(makeData(3)), "2026-09-01T00:00:00Z"); });
    rerender({ d: makeData(4) });
    await act(async () => { await result.current.manualPush(); });
    expect(mocked.saveToGistWithRetry).not.toHaveBeenCalled();
    expect(useUIStore.getState().gistConflict?.reason).toBe("restored");
    expect(useUIStore.getState().gistConflict?.remoteDataJson).toBe(toUserDataJson(makeData(1)));
  });

  it("K5 덮어쓰기 PATCH가 시간 초과로 실패 처리됐지만 커밋된 경우 — 다음 [저장]이 자기 커밋을 외부 변경으로 보지 않는다", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", hashGistPayload(toUserDataJson(makeData(0))));
    const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
    await act(async () => { await flush(); });
    useUIStore.getState().setGistConflict({
      remoteDataJson: REMOTE,
      remoteUpdatedAt: VERSION.committedAt,
      pendingLocalDataJson: toUserDataJson(makeData(1)),
    });
    mocked.saveToGist.mockRejectedValueOnce(new Error("요청 시간 초과 (15s)"));
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("fw-gist-last-push-hash")).toBe(hashGistPayload(toUserDataJson(makeData(0))));

    // 실제로는 서버가 덮어쓰기를 커밋함
    mocked.getGistVersions.mockResolvedValue([{ sha: "v2", committedAt: "2026-10-02T03:00:00Z", url: "u" }]);
    mocked.loadFromGist.mockResolvedValue({ dataJson: toUserDataJson(makeData(1)), updatedAt: "2026-10-02T03:00:00Z" });
    await act(async () => { await result.current.manualPush(); });
    expect(useUIStore.getState().gistConflict).toBeNull();
    expect(mocked.saveToGistWithRetry).toHaveBeenCalledTimes(1);
  });

  it("K1 해결 진행 중(원격 다시 읽기 대기) 다른 선택이 들어오면 무시하고, 끝나면 다시 받는다", async () => {
    connectToGist();
    const onApply = vi.fn();
    const { result } = renderHook(() => useGistSync(makeData(1), onApply));
    await act(async () => { await flush(); });
    const conflict = { remoteDataJson: REMOTE, remoteUpdatedAt: VERSION.committedAt, pendingLocalDataJson: toUserDataJson(makeData(1)) };
    useUIStore.getState().setGistConflict(conflict);

    let releaseLoad!: () => void;
    mocked.loadFromGist.mockImplementationOnce(
      () => new Promise((resolve) => { releaseLoad = () => resolve({ dataJson: REMOTE, updatedAt: VERSION.committedAt }); })
    );
    let first!: Promise<void>;
    act(() => { first = result.current.resolveGistConflict("apply-remote"); });
    await act(async () => { await result.current.resolveGistConflict("cancel"); });
    await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
    expect(useUIStore.getState().gistConflict).toBe(conflict); // 취소가 모달을 닫지 않음
    expect(toastMessages()).not.toContain("Gist에는 저장하지 않았어요");
    expect(mocked.saveToGist).not.toHaveBeenCalled();

    await act(async () => { releaseLoad(); await first; });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().gistConflict).toBeNull();

    // 가드가 풀려 다음 충돌은 정상 처리
    useUIStore.getState().setGistConflict(conflict);
    await act(async () => { await result.current.resolveGistConflict("cancel"); });
    expect(useUIStore.getState().gistConflict).toBeNull();
  });

  it("K3 기기 연결을 취소·실패한 뒤(표식 상태) 자동 동기화를 켜면 부팅 불러오기 충돌은 never-synced 사유로 열린다", async () => {
    connectToGist();
    window.localStorage.setItem("fw-gist-last-push-hash", `unsynced:${P.gistId}`);
    mocked.getGistAutoSync.mockReturnValue(true);
    const onApply = vi.fn();
    renderHook(() => useGistSync(makeData(1), onApply));
    await act(async () => { await flush(); });
    expect(onApply).not.toHaveBeenCalled();
    const conflict = useUIStore.getState().gistConflict;
    expect(conflict?.reason).toBe("never-synced");
    expect(conflict?.remoteDataJson).toBe(REMOTE);
  });

  it("G111 덮어쓰기·취소도 결과를 토스트로 알린다", async () => {
    connectToGist();
    const successSpy = vi.spyOn(toast, "success");
    const dismissSpy = vi.spyOn(toast, "dismiss");
    try {
      const { result } = renderHook(() => useGistSync(makeData(1), vi.fn()));
      await act(async () => { await flush(); });
      const conflict = { remoteDataJson: REMOTE, remoteUpdatedAt: VERSION.committedAt, pendingLocalDataJson: toUserDataJson(makeData(1)) };

      useUIStore.getState().setGistConflict(conflict);
      await act(async () => { await result.current.resolveGistConflict("force-push-local"); });
      expect(mocked.saveToGist).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith("gist-auto-save-error");
      expect(successSpy).toHaveBeenCalledWith("Gist에 저장했어요");

      useUIStore.getState().setGistConflict(conflict);
      await act(async () => { await result.current.resolveGistConflict("cancel"); });
      expect(useUIStore.getState().gistConflict).toBeNull();
      expect(toastMessages()).toContain("Gist에는 저장하지 않았어요");
    } finally {
      successSpy.mockRestore();
      dismissSpy.mockRestore();
    }
  });
});
