// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useState } from "react";
import { useUIStore } from "../store/uiStore";

// vite-plugin-pwa 가상 모듈 모킹 — needRefresh 상태를 외부에서 제어
const updateServiceWorker = vi.fn(() => Promise.resolve());
let setNeedRefreshExternal: ((v: boolean) => void) | null = null;

vi.mock("../components/pwaRegister", () => ({
  useRegisterSW: () => {
    const [needRefresh, setNeedRefresh] = useState(false);
    const [offlineReady, setOfflineReady] = useState(false);
    setNeedRefreshExternal = setNeedRefresh;
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      offlineReady: [offlineReady, setOfflineReady],
      updateServiceWorker,
    };
  },
}));

import { PWAStatus } from "../components/PWAStatus";

describe("PWAStatus (registerType: prompt)", () => {
  beforeEach(() => {
    updateServiceWorker.mockClear();
    setNeedRefreshExternal = null;
    useUIStore.setState({ newVersionAvailable: false, applyPwaUpdate: null });
  });
  afterEach(() => {
    cleanup();
  });

  it("마운트 시 applyPwaUpdate가 uiStore에 등록되고 newVersionAvailable은 false", () => {
    render(<PWAStatus />);
    const st = useUIStore.getState();
    expect(st.newVersionAvailable).toBe(false);
    expect(typeof st.applyPwaUpdate).toBe("function");
    expect(screen.queryByText("새 버전이 있습니다")).toBeNull();
  });

  it("needRefresh=true → uiStore.newVersionAvailable=true + 업데이트 알림 표시", () => {
    render(<PWAStatus />);
    act(() => setNeedRefreshExternal?.(true));
    expect(useUIStore.getState().newVersionAvailable).toBe(true);
    expect(screen.getByText("새 버전이 있습니다")).toBeInTheDocument();
  });

  it("uiStore.applyPwaUpdate() 호출 → updateServiceWorker(true) (헤더 pill 경로)", async () => {
    render(<PWAStatus />);
    act(() => setNeedRefreshExternal?.(true));
    const apply = useUIStore.getState().applyPwaUpdate;
    expect(apply).not.toBeNull();
    await act(async () => {
      await apply!();
    });
    expect(updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("알림의 '업데이트' 버튼 → updateServiceWorker(true)", () => {
    render(<PWAStatus />);
    act(() => setNeedRefreshExternal?.(true));
    fireEvent.click(screen.getByText("업데이트"));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("'닫기' → needRefresh=false → uiStore.newVersionAvailable=false (pill도 함께 숨김)", () => {
    render(<PWAStatus />);
    act(() => setNeedRefreshExternal?.(true));
    expect(useUIStore.getState().newVersionAvailable).toBe(true);
    fireEvent.click(screen.getByText("닫기"));
    expect(useUIStore.getState().newVersionAvailable).toBe(false);
    expect(screen.queryByText("새 버전이 있습니다")).toBeNull();
  });

  it("언마운트 시 applyPwaUpdate 해제(null)", () => {
    const { unmount } = render(<PWAStatus />);
    expect(useUIStore.getState().applyPwaUpdate).not.toBeNull();
    unmount();
    expect(useUIStore.getState().applyPwaUpdate).toBeNull();
  });
});
