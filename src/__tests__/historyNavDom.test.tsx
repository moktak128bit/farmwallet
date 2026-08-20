// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React, { useEffect } from "react";
import { useHistoryNav } from "../utils/historyNav";
import { useModalStackEntry, getModalDepth, closeTopModal } from "../utils/modalStack";
import { useUIStore } from "../store/uiStore";

/** window keydown ESC로 닫히는 실제 모달 패턴(QuickEntryModal 등)과 동일 */
function FakeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isTop = useModalStackEntry(open);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop()) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose, isTop]);
  if (!open) return null;
  return <div role="dialog">modal</div>;
}

function Harness() {
  useHistoryNav();
  const open = useUIStore((s) => s.showQuickEntry);
  const setOpen = useUIStore((s) => s.setShowQuickEntry);
  return <FakeModal open={open} onClose={() => setOpen(false)} />;
}

/** jsdom의 history.back()은 비동기(popstate) — 잠깐 기다린다 */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

/** 브라우저 뒤로가기 — jsdom이 popstate를 못 내면 state를 직접 전달 */
const userBack = async () => {
  const before = window.history.length;
  const stateBefore = window.history.state;
  await act(async () => {
    window.history.back();
  });
  await settle();
  if (window.history.length === before && window.history.state === stateBefore) {
    // fallback: popstate 수동 발화(state는 직전 항목이라고 가정할 수 없으니 테스트가 이 경로에 의존하지 않게 구성)
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }
};

describe("useHistoryNav — jsdom 통합", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUIStore.setState({ tab: "dashboard", showQuickEntry: false, mobileDrawerOpen: false });
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("설치 시 base 표식, 탭 전환 시 pushState(fwIdx)", async () => {
    render(<Harness />);
    expect(window.history.state).toEqual({ fwIdx: -1 });
    act(() => useUIStore.getState().setTab("ledger"));
    expect(window.history.state).toEqual({ fwIdx: 0 });
    act(() => useUIStore.getState().setTab("ledger"));
    expect(window.history.state).toEqual({ fwIdx: 0 }); // 같은 탭 연속 — push 없음
    act(() => useUIStore.getState().setTab("stocks"));
    expect(window.history.state).toEqual({ fwIdx: 1 });
  });

  it("popstate(뒤로) → 이전 탭으로 돌아가고 다시 push하지 않는다", async () => {
    render(<Harness />);
    act(() => useUIStore.getState().setTab("ledger"));
    act(() => useUIStore.getState().setTab("stocks"));
    const lenBefore = window.history.length;
    await userBack();
    expect(useUIStore.getState().tab).toBe("ledger");
    expect(window.history.length).toBe(lenBefore);
    await userBack();
    expect(useUIStore.getState().tab).toBe("dashboard");
  });

  it("모달 열림 → 항목 push, 뒤로가기 → 합성 ESC로 최상위 모달만 닫힘", async () => {
    render(<Harness />);
    act(() => useUIStore.getState().setTab("ledger"));
    act(() => useUIStore.getState().setShowQuickEntry(true));
    await settle();
    expect(getModalDepth()).toBe(1);
    expect(window.history.state).toEqual({ fwIdx: 1 });
    await userBack();
    expect(useUIStore.getState().showQuickEntry).toBe(false);
    expect(getModalDepth()).toBe(0);
    expect(useUIStore.getState().tab).toBe("ledger"); // 탭은 유지
    await settle();
    // 모달 언마운트 알림이 self-close로 오인되어 back이 추가 호출되지 않았는지: 다음 뒤로가기가 곧장 대시보드
    await userBack();
    expect(useUIStore.getState().tab).toBe("dashboard");
  });

  it("closeTopModal은 열린 모달이 없으면 false", () => {
    expect(getModalDepth()).toBe(0);
    expect(closeTopModal()).toBe(false);
  });
});
