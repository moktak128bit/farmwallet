// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, within } from "@testing-library/react";
import { GistVersionModal } from "../components/GistVersionModal";
import { ApplyConfirmModal, requestApply } from "../components/ApplyConfirmModal";
import { GistSyncCard } from "../features/settings/GistSyncCard";
import { useUIStore } from "../store/uiStore";
import { useAppStore } from "../store/appStore";
import { getEmptyData } from "../services/dataService";
import { setGistToken, setGistId, setGistAutoSync } from "../services/gistSync";
import type { AppData } from "../types";

/**
 * Gist 불러오기 게이트 회귀 테스트.
 *  - 상태 메뉴 [불러오기] → 버전 선택도 설정 카드 불러오기와 같은 변경 미리보기(requestApply)를 거친다
 *  - 검증 실패 버전은 모달 안 오류로만 표시하고 onLoad를 부르지 않는다
 *  - 설정 카드 불러오기는 window.confirm 없이 manualPull(미리보기 게이트 내장)로 바로 간다
 *  - 토큰이 사라져도 켜져 있는 자동 동기화 토글은 끌 수 있다
 *  - 로컬 출처 적용(propagatesToGist)만 자동 동기화 중 "Gist로 퍼진다" 안내를 보인다
 */

const { getGistVersionsMock, loadFromGistVersionMock } = vi.hoisted(() => ({
  getGistVersionsMock: vi.fn(),
  loadFromGistVersionMock: vi.fn()
}));

vi.mock("../services/gistSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gistSync")>();
  return { ...actual, getGistVersions: getGistVersionsMock, loadFromGistVersion: loadFromGistVersionMock };
});

const VERSION = { sha: "abcdef1234567890", url: "https://example.test/v1", committedAt: "2026-10-01T03:00:00Z" };

function remoteData(): AppData {
  return {
    ...getEmptyData(),
    ledger: [{ id: "L1", date: "2026-09-30", kind: "expense", description: "점심", amount: 9_000, category: "지출" }]
  };
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAppStore.setState({ data: getEmptyData() });
  useUIStore.getState().setPendingApply(null);
  getGistVersionsMock.mockResolvedValue([VERSION]);
  loadFromGistVersionMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GistVersionModal — 변경 미리보기 게이트", () => {
  it("버전을 고르면 바로 덮어쓰지 않고 미리보기를 띄우고, [적용]해야 onLoad가 불린다", async () => {
    const dataJson = JSON.stringify(remoteData());
    loadFromGistVersionMock.mockResolvedValue({ dataJson, committedAt: VERSION.committedAt });
    const confirmSpy = vi.spyOn(window, "confirm");
    const onLoad = vi.fn();
    const onClose = vi.fn();
    render(
      <>
        <GistVersionModal isOpen onClose={onClose} onLoad={onLoad} onLog={() => {}} />
        <ApplyConfirmModal />
      </>
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
    expect(useUIStore.getState().pendingApply?.title).toMatch(/^Gist 버전 불러오기/);
    // Gist에서 온 데이터라 "Gist로 퍼진다" 안내 대상이 아니다
    expect(useUIStore.getState().pendingApply?.propagatesToGist).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onLoad).toHaveBeenCalledWith(dataJson, VERSION.committedAt);
    expect(onClose).toHaveBeenCalled();
    expect(useUIStore.getState().pendingApply).toBeNull();
  });

  it("미리보기에서 취소하면 onLoad 없이 버전 목록이 그대로 남는다", async () => {
    loadFromGistVersionMock.mockResolvedValue({ dataJson: JSON.stringify(remoteData()), committedAt: VERSION.committedAt });
    const onLoad = vi.fn();
    const onClose = vi.fn();
    render(
      <>
        <GistVersionModal isOpen onClose={onClose} onLoad={onLoad} onLog={() => {}} />
        <ApplyConfirmModal />
      </>
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
    await flush();
    const preview = screen.getByRole("dialog", { name: /^Gist 버전 불러오기/ });
    fireEvent.click(within(preview).getByRole("button", { name: "취소" }));

    expect(onLoad).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(useUIStore.getState().pendingApply).toBeNull();
    expect(screen.getByRole("dialog", { name: "Gist 버전 선택" })).toBeTruthy();
  });

  it("검증에 실패하는 버전은 모달 안 오류만 보이고 onLoad·미리보기 모두 없다", async () => {
    loadFromGistVersionMock.mockResolvedValue({ dataJson: "{not json", committedAt: VERSION.committedAt });
    const onLoad = vi.fn();
    render(<GistVersionModal isOpen onClose={() => {}} onLoad={onLoad} onLog={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
    await flush();

    expect(onLoad).not.toHaveBeenCalled();
    expect(useUIStore.getState().pendingApply).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});

describe("GistSyncCard — 불러오기 확인·자동 동기화 토글", () => {
  it("[Gist에서 불러오기]는 window.confirm 없이 manualPull로 간다(확인은 미리보기 모달 담당)", async () => {
    setGistToken("ghp_test", { persist: false });
    setGistId("gist123");
    const confirmSpy = vi.spyOn(window, "confirm");
    const onManualPull = vi.fn().mockResolvedValue(undefined);
    render(<GistSyncCard autoSyncEnabled={false} onManualPull={onManualPull} onManualPush={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gist에서 불러오기" }));
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onManualPull).toHaveBeenCalledTimes(1);
  });

  it("토큰이 없어도 켜져 있는 자동 동기화는 끌 수 있고, 꺼져 있으면 켤 수 없다", () => {
    const { rerender } = render(<GistSyncCard autoSyncEnabled={true} />);
    const toggle = () => screen.getByRole("checkbox", { name: /자동 동기화 사용/ }) as HTMLInputElement;
    expect(toggle().disabled).toBe(false);
    expect(screen.queryByText(/먼저 설정해야 자동 동기화를/)).toBeNull();

    rerender(<GistSyncCard autoSyncEnabled={false} />);
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText(/먼저 설정해야 자동 동기화를/)).toBeTruthy();
  });
});

describe("ApplyConfirmModal — 자동 동기화 전파 안내", () => {
  const PROPAGATE = /1분 안에 Gist와 다른 기기에도 반영/;
  const open = (propagatesToGist: boolean) =>
    act(() =>
      requestApply({ title: "백업 복원", before: getEmptyData(), after: remoteData(), onConfirm: () => {}, propagatesToGist })
    );

  it("로컬 출처 + 자동 동기화 설정 완료일 때만 안내가 보인다", () => {
    setGistToken("ghp_test", { persist: false });
    setGistId("gist123");
    setGistAutoSync(true);
    render(<ApplyConfirmModal />);
    open(true);
    expect(screen.getByText(PROPAGATE)).toBeTruthy();

    act(() => useUIStore.getState().setPendingApply(null));
    open(false); // Gist pull 등
    expect(screen.queryByText(PROPAGATE)).toBeNull();
  });

  it("자동 동기화가 꺼져 있으면 로컬 출처라도 안내하지 않는다", () => {
    setGistToken("ghp_test", { persist: false });
    setGistId("gist123");
    setGistAutoSync(false);
    render(<ApplyConfirmModal />);
    open(true);
    expect(screen.queryByText(PROPAGATE)).toBeNull();
  });
});
