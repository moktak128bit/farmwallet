// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmptyData } from "../storage";
import { useLocalFileRecovery } from "../hooks/useLocalFileRecovery";
import { LocalFileRecoveryBanner } from "../components/LocalFileRecoveryBanner";
import { STORAGE_KEYS } from "../constants/config";
import { hasUserRecords, wouldEraseUserRecords } from "../utils/userDataPresence";

const populated = () => ({ ...getEmptyData(), ledger: [
  { id: "L1", date: "2026-10-21", kind: "expense" as const, category: "식비", description: "식사", amount: 10000 },
] });
const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("장부 파일 복구", () => {
  it("Gist에 연결된 새 기기는 로컬 복구 대기로 클라우드 불러오기를 막지 않음", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLocalFileRecovery(getEmptyData(), false, false, true));
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(result.current.blocksSaving).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("파일 조회 도중 Gist가 연결되면 파일 응답을 폐기하고 클라우드에 맡김", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { result, rerender } = renderHook(({ connected }) => useLocalFileRecovery(getEmptyData(), false, false, connected), { initialProps: { connected: false } });
    rerender({ connected: true });
    await act(async () => { resolve(reply(populated())); });
    expect(result.current.state.status).toBe("idle");
    expect(result.current.blocksSaving).toBe(false);
  });

  it("브라우저 장부 로드가 끝나기 전에는 조회·저장을 시작하지 않음", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(populated()));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ loading }) => useLocalFileRecovery(getEmptyData(), loading, false), { initialProps: { loading: true } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.blocksSaving).toBe(true);
    rerender({ loading: false });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it.each([false, true])("새 브라우저/저장된 빈 장부에서 현재 파일을 제시하고 자동 적용하지 않음 (기존 키 %s)", async (savedEmpty) => {
    const empty = getEmptyData();
    if (savedEmpty) localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(empty));
    const before = localStorage.getItem(STORAGE_KEYS.DATA);
    const fetcher = vi.fn().mockResolvedValue(reply({ ...populated(), _exportedAt: "2026-10-21T08:06:07.999Z" }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLocalFileRecovery(empty, false, false));
    expect(result.current.blocksSaving).toBe(true);
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/farmwallet-data", expect.objectContaining({ cache: "no-store" }));
    expect(result.current.blocksSaving).toBe(true);
    expect(empty.ledger).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEYS.DATA)).toBe(before);
  });

  it("브라우저에 계좌만 있어도 자동으로 파일을 교체하지 않음", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const data = { ...getEmptyData(), accounts: [{ id: "A1", name: "기존 계좌", institution: "은행", type: "checking" as const, initialBalance: 0 }] };
    const { result } = renderHook(() => useLocalFileRecovery(data, false, false));
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.blocksSaving).toBe(false);
  });

  it("현재 파일이 없으면 백업을 제시함", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply(populated()));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLocalFileRecovery(getEmptyData(), false, false));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/farmwallet-data", "/api/restore-latest-backup"]);
    if (result.current.state.status === "ready") expect(result.current.state.candidate.source).toBe("최근 파일 백업");
  });

  it("파일 조회 실패 시 빈 데이터 저장을 계속 차단하며 재시도할 수 있음", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLocalFileRecovery(getEmptyData(), false, false));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.blocksSaving).toBe(true);
    fetcher.mockResolvedValue(reply(populated()));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("파일을 불러온 후 보호 상태를 해제함", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(populated())));
    const { result, rerender } = renderHook(({ data }) => useLocalFileRecovery(data, false, false), { initialProps: { data: getEmptyData() } });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    rerender({ data: populated() });
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(result.current.blocksSaving).toBe(false);
  });

  it("조회 중 사용자 데이터가 생기면 늦은 파일 응답을 폐기함", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { result, rerender } = renderHook(({ data }) => useLocalFileRecovery(data, false, false), { initialProps: { data: getEmptyData() } });
    rerender({ data: populated() });
    await act(async () => { resolve(reply(populated())); });
    expect(result.current.state.status).toBe("idle");
  });

  it("사용자에게 파일 건수와 불러오기 버튼을 표시함", () => {
    const onRestore = vi.fn();
    render(<LocalFileRecoveryBanner recovery={{ state: { status: "ready", candidate: { data: populated(), source: "저장된 가계부 파일" } }, retry: vi.fn(), blocksSaving: true }} onRestore={onRestore} />);
    expect(screen.getByText(/가계부 1건 · 주식 거래 0건/)).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장된 가계부 불러오기" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("불러오기와 Gist 업로드를 잇는 동작을 직접 선택할 수 있음", () => {
    const onRestore = vi.fn();
    const onRestoreAndUpload = vi.fn();
    render(<LocalFileRecoveryBanner recovery={{ state: { status: "ready", candidate: { data: populated(), source: "저장된 가계부 파일" } }, retry: vi.fn(), blocksSaving: true }} onRestore={onRestore} onRestoreAndUpload={onRestoreAndUpload} />);
    fireEvent.click(screen.getByRole("button", { name: "불러오고 Gist에 업로드" }));
    expect(onRestoreAndUpload).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe("빈 장부 파일 덮어쓰기 방지", () => {
  it("자동 시세·기본 운동 루틴은 사용자 장부로 간주하지 않음", () => {
    const empty = { ...getEmptyData(), benchmarkDailyCloses: [{ date: "2026-10-21", close: 100 }], workoutRoutines: [{ id: "default" }] };
    expect(hasUserRecords(empty)).toBe(false);
    expect(wouldEraseUserRecords(populated(), empty)).toBe(true);
  });
  it("일부 항목을 삭제한 정상 수정과 최초 저장은 허용함", () => {
    expect(wouldEraseUserRecords({ ...populated(), trades: [{ id: "T1" }] }, populated())).toBe(false);
    expect(wouldEraseUserRecords(null, populated())).toBe(false);
    expect(wouldEraseUserRecords(populated(), null)).toBe(true);
  });
});
