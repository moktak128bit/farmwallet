// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { useModalStackEntry } from "../utils/modalStack";
import { useUIStore } from "../store/uiStore";

function FakeModal({ open }: { open: boolean }) {
  useModalStackEntry(open);
  return open ? <div role="dialog">m</div> : null;
}

describe("MobileBottomNav", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUIStore.setState({ tab: "dashboard", showQuickEntry: false, mobileDrawerOpen: false });
  });
  afterEach(() => cleanup());

  it("4개 탭 + 더보기 + FAB를 렌더하고 현재 탭에 aria-current=page", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "하단 탭" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대시보드" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "가계부" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "더보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "빠른 입력" })).toBeInTheDocument();
  });

  it("탭 버튼 클릭 → uiStore.tab 변경 + 드로어 닫힘, 더보기 → 드로어 열림, FAB → 빠른 입력", () => {
    useUIStore.setState({ mobileDrawerOpen: true });
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole("button", { name: "주식" }));
    expect(useUIStore.getState().tab).toBe("stocks");
    expect(useUIStore.getState().mobileDrawerOpen).toBe(false);
    expect(screen.getByRole("button", { name: "주식" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "더보기" }));
    expect(useUIStore.getState().mobileDrawerOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "빠른 입력" }));
    expect(useUIStore.getState().showQuickEntry).toBe(true);
  });

  it("4개 밖의 탭이 활성이면 더보기가 active 표시", () => {
    useUIStore.setState({ tab: "settings" });
    render(<MobileBottomNav />);
    expect(screen.getByRole("button", { name: /더보기/ })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "대시보드" })).not.toHaveAttribute("aria-current");
  });

  it("모달(modalStack)이 열려 있으면 숨긴다", async () => {
    const { rerender } = render(
      <>
        <FakeModal open={false} />
        <MobileBottomNav />
      </>
    );
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeInTheDocument();
    rerender(
      <>
        <FakeModal open />
        <MobileBottomNav />
      </>
    );
    // modalStack 구독 알림은 microtask로 한 틱 모아 보낸다(StrictMode 이중 마운트 방지) — 플러시 후 확인.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeNull();
    expect(screen.queryByRole("button", { name: "빠른 입력" })).toBeNull();
    rerender(
      <>
        <FakeModal open={false} />
        <MobileBottomNav />
      </>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeInTheDocument();
  });

  it("텍스트 입력 포커스 중엔 숨기고 blur 시 복귀", () => {
    render(
      <>
        <input aria-label="메모" />
        <button type="button">기타</button>
        <MobileBottomNav />
      </>
    );
    const input = screen.getByLabelText("메모");
    act(() => {
      input.focus();
    });
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeNull();
    act(() => {
      input.blur();
    });
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeInTheDocument();
    // 버튼 포커스는 숨기지 않는다
    act(() => {
      screen.getByRole("button", { name: "기타" }).focus();
    });
    expect(screen.queryByRole("navigation", { name: "하단 탭" })).toBeInTheDocument();
  });
});
