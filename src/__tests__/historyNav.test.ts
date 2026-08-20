import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHistoryNav, type HistoryLike, type HistoryNavController } from "../utils/historyNav";
import type { TabId } from "../components/ui/Tabs";

/**
 * 브라우저 히스토리 흉내: 항목 배열 + 현재 인덱스.
 * back()은 실제 브라우저처럼 비동기(popstate)지만, 여기선 flush()로 명시적으로 흘려보낸다.
 */
function makeFakeHistory() {
  const states: unknown[] = [null];
  let idx = 0;
  let ctrl: HistoryNavController | null = null;
  const pendingPops: unknown[] = [];
  const hist: HistoryLike = {
    pushState(state) {
      states.splice(idx + 1);
      states.push(state);
      idx = states.length - 1;
    },
    replaceState(state) {
      states[idx] = state;
    },
    back() {
      if (idx === 0) return; // 첫 항목에서 back → 페이지 이탈(여기선 무시)
      idx -= 1;
      pendingPops.push(states[idx]);
    },
  };
  return {
    hist,
    bind(c: HistoryNavController) {
      ctrl = c;
    },
    /** 사용자가 브라우저 뒤로가기를 누름 */
    userBack() {
      hist.back();
    },
    /** 대기 중 popstate 전부 전달(체인된 back까지 끝까지) */
    flush() {
      let guard = 0;
      while (pendingPops.length > 0 && guard++ < 20) {
        const s = pendingPops.shift();
        ctrl?.handlePop(s);
      }
    },
    get length() {
      return states.length;
    },
    get index() {
      return idx;
    },
    get state() {
      return states[idx];
    },
  };
}

function setup(initialTab: TabId = "dashboard") {
  const fake = makeFakeHistory();
  let tab: TabId = initialTab;
  let modalDepth = 0;
  const closeTopModal = vi.fn(() => {
    if (modalDepth === 0) return false;
    // 실제 앱: 합성 ESC → 모달 onClose → 언마운트 → popModal 알림(비동기). 여기선 flushModalClose()로 흉내
    pendingModalCloses += 1;
    return true;
  });
  let pendingModalCloses = 0;
  const setTab = vi.fn((t: TabId) => {
    tab = t;
    // zustand subscribe는 set 안에서 동기 호출 → onTabChange가 즉시 불린다
    ctrl.onTabChange(t);
  });
  const ctrl = createHistoryNav({
    hist: fake.hist,
    initialTab,
    getTab: () => tab,
    setTab,
    getModalDepth: () => modalDepth,
    closeTopModal,
  });
  fake.bind(ctrl);
  const api = {
    ctrl,
    fake,
    setTab,
    closeTopModal,
    get tab() {
      return tab;
    },
    get modalDepth() {
      return modalDepth;
    },
    /** 사용자가 탭 클릭 */
    userSetTab(t: TabId) {
      setTab(t);
    },
    /** 모달 열림(useModalStackEntry push) */
    openModal() {
      modalDepth += 1;
      ctrl.onModalDepthChange(modalDepth);
    },
    /** 사용자가 X/ESC로 모달 닫음 */
    userCloseModal() {
      modalDepth -= 1;
      ctrl.onModalDepthChange(modalDepth);
    },
    /** 뒤로가기로 닫힌 모달의 언마운트 알림 도착 */
    flushModalClose() {
      while (pendingModalCloses > 0) {
        pendingModalCloses -= 1;
        modalDepth -= 1;
        ctrl.onModalDepthChange(modalDepth);
      }
    },
  };
  return api;
}

describe("createHistoryNav — 순수 컨트롤러", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("설치 시 base 표식(replaceState fwIdx=-1)을 남긴다", () => {
    const s = setup();
    expect(s.fake.state).toEqual({ fwIdx: -1 });
    expect(s.fake.length).toBe(1);
  });

  it("탭 전환은 pushState 1회, 같은 탭 연속은 push하지 않는다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    expect(s.fake.length).toBe(2);
    expect(s.fake.state).toEqual({ fwIdx: 0 });
    s.userSetTab("ledger");
    s.userSetTab("ledger");
    expect(s.fake.length).toBe(2);
    s.userSetTab("stocks");
    expect(s.fake.length).toBe(3);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "stocks"]);
  });

  it("뒤로가기 → 이전 탭, 더 뒤로 → base 탭, base에서는 관여하지 않음", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.userSetTab("stocks");
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("ledger");
    // popstate가 부른 setTab은 다시 push하면 안 된다
    expect(s.fake.length).toBe(3);
    expect(s.fake.index).toBe(1);
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
    expect(s.fake.index).toBe(0);
    const before = s.setTab.mock.calls.length;
    s.fake.userBack(); // 첫 항목 — 브라우저 기본(여기선 no-op)
    s.fake.flush();
    expect(s.setTab.mock.calls.length).toBe(before);
    expect(s.tab).toBe("dashboard");
  });

  it("뒤로가기 후 새 탭으로 가면 forward 항목은 잘리고 스택이 일관된다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.userSetTab("stocks");
    s.fake.userBack();
    s.fake.flush();
    s.userSetTab("budget");
    expect(s.fake.length).toBe(3);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "budget"]);
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("ledger");
  });

  it("모달 열림 → push, 뒤로가기 → 최상위 모달 닫기(탭은 유지)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    expect(s.fake.length).toBe(3);
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
    expect(s.tab).toBe("ledger");
    s.flushModalClose(); // 언마운트 알림 — self-close로 오인해 back()을 추가 호출하면 안 됨
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().length).toBe(1);
    // 다음 뒤로가기는 곧장 이전 탭
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
  });

  it("X/ESC로 닫은 최상위 모달 → 히스토리 항목을 즉시 소비(back)하고 다음 뒤로가기는 이전 탭", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    expect(s.fake.index).toBe(2);
    s.userCloseModal();
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().length).toBe(1);
    expect(s.closeTopModal).not.toHaveBeenCalled();
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
  });

  it("드로어(모달) 열고 탭 전환 후 드로어 닫힘 → stale 항목은 한 번의 뒤로가기로 건너뛴다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal(); // 드로어
    s.userSetTab("stocks"); // 드로어에서 탭 선택 — 탭 push가 먼저
    s.userCloseModal(); // 드로어 언마운트 — 최상위가 탭이라 stale 표시만
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : `modal${e.stale ? ":stale" : ""}`))).toEqual([
      "ledger",
      "modal:stale",
      "stocks",
    ]);
    s.fake.userBack(); // 사용자 1회
    s.fake.flush(); // 체인 back까지
    expect(s.tab).toBe("ledger");
    expect(s.closeTopModal).not.toHaveBeenCalled();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
  });

  it("뒤로가기로 여러 항목을 한 번에 건너뛰어도(긴 누름) 목표 탭으로 간다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.userSetTab("stocks");
    s.userSetTab("budget");
    // fwIdx 0(ledger)으로 곧장 점프
    s.ctrl.handlePop({ fwIdx: 0 });
    expect(s.tab).toBe("ledger");
    expect(s.ctrl.getEntries().length).toBe(1);
  });

  it("스택 밖 인덱스(forward·새로고침 잔여)는 무시한다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.ctrl.handlePop({ fwIdx: 7 });
    s.ctrl.handlePop("garbage");
    expect(s.tab).toBe("ledger");
    expect(s.ctrl.getEntries().length).toBe(1);
  });

  it("모달이 ESC를 무시해 닫히지 않으면 기대 카운터가 타임아웃으로 풀린다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
    // 닫힘 알림이 오지 않음 — 1초 후 리셋
    vi.advanceTimersByTime(1100);
    // 이후 사용자가 X로 닫으면 self-close로 정상 처리(항목이 없으니 back도 없음)
    const idxBefore = s.fake.index;
    s.userCloseModal();
    s.fake.flush();
    expect(s.fake.index).toBe(idxBefore);
  });

  it("dispose 후에는 아무 동작도 하지 않는다", () => {
    const s = setup("dashboard");
    s.ctrl.dispose();
    s.userSetTab("ledger");
    expect(s.fake.length).toBe(1);
    s.ctrl.handlePop({ fwIdx: -1 });
    expect(s.tab).toBe("ledger");
  });
});
