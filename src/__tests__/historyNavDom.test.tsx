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

/** busy면 ESC를 무시하고 preventDefault로 거부를 알리는 모달(GistConflictModal·ConnectConfirmModal 패턴) */
function BusyModal({ open, busy, onClose }: { open: boolean; busy: boolean; onClose: () => void }) {
  const isTop = useModalStackEntry(open);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTop()) return;
      e.stopPropagation();
      if (busy) e.preventDefault();
      else onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, busy, onClose, isTop]);
  if (!open) return null;
  return <div role="dialog">busy modal</div>;
}

function BusyHarness() {
  useHistoryNav();
  const open = useUIStore((s) => s.showQuickEntry);
  const setOpen = useUIStore((s) => s.setShowQuickEntry);
  return <BusyModal open={open} busy onClose={() => setOpen(false)} />;
}

/** 모달 두 개가 겹쳐 뜨는 경우(GistVersionModal 위 ApplyConfirmModal) — 아래=드로어 플래그, 위=빠른 입력 플래그 재사용 */
function StackedHarness() {
  useHistoryNav();
  const lower = useUIStore((s) => s.mobileDrawerOpen);
  const upper = useUIStore((s) => s.showQuickEntry);
  const setLower = useUIStore((s) => s.setMobileDrawerOpen);
  const setUpper = useUIStore((s) => s.setShowQuickEntry);
  return (
    <>
      <FakeModal open={lower} onClose={() => setLower(false)} />
      <FakeModal open={upper} onClose={() => setUpper(false)} />
    </>
  );
}

/** jsdom의 history.back()은 비동기(popstate) — 잠깐 기다린다 */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

/** popstate가 실제로 올 때까지 기다린다(최대 timeoutMs). 고정 30ms 대기는 병렬 실행 부하에서 jsdom의 비동기
 *  popstate보다 먼저 끝나 "모달이 아직 열려 있음"으로 간헐 실패했다. 앱 리스너가 먼저 등록돼 있어 이 리스너는 그 뒤에 돈다. */
const waitForPopstate = (timeoutMs = 1000) =>
  new Promise<boolean>((resolve) => {
    const onPop = () => {
      window.removeEventListener("popstate", onPop);
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("popstate", onPop);
      resolve(false);
    }, timeoutMs);
    window.addEventListener("popstate", onPop);
  });

/** 브라우저 뒤로가기 — jsdom이 popstate를 못 내면 state를 직접 전달 */
const userBack = async () => {
  let fired = false;
  await act(async () => {
    const popped = waitForPopstate();
    window.history.back();
    fired = await popped;
  });
  await settle();
  if (!fired) {
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

  it("겹친 두 모달이 한 커밋에서 함께 닫혀도(2→0) 히스토리에 유령 항목이 남지 않는다 (K10)", async () => {
    render(<StackedHarness />);
    act(() => useUIStore.getState().setTab("ledger"));
    act(() => useUIStore.getState().setMobileDrawerOpen(true));
    await settle();
    act(() => useUIStore.getState().setShowQuickEntry(true));
    await settle();
    expect(getModalDepth()).toBe(2);
    expect(window.history.state).toEqual({ fwIdx: 2 });
    const goSpy = vi.spyOn(window.history, "go");
    // [적용] 클릭처럼 한 핸들러 안에서 두 모달을 함께 닫음 → 한 커밋, 깊이 알림 1회
    await act(async () => {
      const popped = waitForPopstate();
      useUIStore.getState().setMobileDrawerOpen(false);
      useUIStore.getState().setShowQuickEntry(false);
      await popped;
    });
    await settle();
    expect(getModalDepth()).toBe(0);
    expect(goSpy).toHaveBeenCalledWith(-2);
    expect(window.history.state).toEqual({ fwIdx: 0 }); // ledger 탭 항목으로 내려앉음
    // 다음 뒤로가기는 헛돌지 않고 곧장 대시보드
    await userBack();
    expect(useUIStore.getState().tab).toBe("dashboard");
  });

  it("closeTopModal은 열린 모달이 없으면 false", () => {
    expect(getModalDepth()).toBe(0);
    expect(closeTopModal()).toBe(false);
  });

  it("busy 모달이 합성 ESC를 거부하면 closeTopModal은 \"refused\", 뒤로가기는 즉시 모달 항목을 되살리고 탭을 바꾸지 않는다 (Q4)", async () => {
    render(<BusyHarness />);
    act(() => useUIStore.getState().setTab("ledger"));
    act(() => useUIStore.getState().setShowQuickEntry(true));
    await settle();
    expect(getModalDepth()).toBe(1);
    expect(closeTopModal()).toBe("refused");
    expect(window.history.state).toEqual({ fwIdx: 1 });
    await userBack();
    // 1초 타이머 없이 바로 모달 항목으로 복귀
    expect(window.history.state).toEqual({ fwIdx: 1 });
    expect(useUIStore.getState().showQuickEntry).toBe(true);
    expect(useUIStore.getState().tab).toBe("ledger");
    // 곧바로 한 번 더 — 모달을 건너뛰고 대시보드로 가면 안 된다
    await userBack();
    expect(window.history.state).toEqual({ fwIdx: 1 });
    expect(useUIStore.getState().showQuickEntry).toBe(true);
    expect(useUIStore.getState().tab).toBe("ledger");
  });
});
