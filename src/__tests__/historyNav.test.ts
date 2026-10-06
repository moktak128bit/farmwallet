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
  /** go()로 요청된 이동 폭 기록 — 다중 닫힘이 한 번의 traversal로 나가는지 확인용 */
  const goCalls: number[] = [];
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
    go(delta) {
      goCalls.push(delta);
      // 실제 브라우저처럼 범위 밖이면 무시, 이동하면 popstate 1회(도착 항목의 state)
      const target = idx + delta;
      if (delta === 0 || target < 0 || target >= states.length) return;
      idx = target;
      pendingPops.push(states[idx]);
    },
  };
  return {
    hist,
    goCalls,
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
  /** 합성 ESC에 대한 모달 반응: close=정상 닫힘, refuse=busy라 preventDefault로 거부,
   *  refuse-but-close=포커스 입력(Stepper)이 ESC를 preventDefault했지만 모달은 그대로 닫힘(오탐 "refused") */
  let escMode: "close" | "refuse" | "refuse-but-close" = "close";
  const closeTopModal = vi.fn((): boolean | "refused" => {
    if (modalDepth === 0) return false;
    if (escMode === "refuse") return "refused";
    // 실제 앱: 합성 ESC → 모달 onClose → 언마운트 → popModal 알림(비동기). 여기선 flushModalClose()로 흉내
    pendingModalCloses += 1;
    return escMode === "refuse-but-close" ? "refused" : true;
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
    setEscMode(m: typeof escMode) {
      escMode = m;
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
    /** 한 렌더에서 여러 모달이 함께 열림/닫힘 — modalStack.notify가 microtask로 합쳐 알림 1회 */
    setModalDepthBatched(depth: number) {
      modalDepth = depth;
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

  it("모달이 ESC를 무시해 닫히지 않으면 타임아웃 후 모달 항목을 되살려 다음 뒤로가기가 다시 그 모달을 닫으려 한다 (R3/R6)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal(); // busy 중인 충돌 모달
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
    expect(s.fake.index).toBe(1);
    // 닫힘 알림이 오지 않음(합성 ESC 무시 — 깊이 1 유지)
    vi.advanceTimersByTime(1100);
    expect(s.modalDepth).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "modal"]);
    expect(s.fake.index).toBe(2);
    expect(s.fake.state).toEqual({ fwIdx: 1 });
    // 다음 뒤로가기는 탭을 바꾸지 않고 다시 모달 닫기를 시도한다
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(2);
    expect(s.tab).toBe("ledger");
  });

  it("ESC를 무시해 되살린 모달 항목은 이후 모달이 스스로 닫힐 때 소비된다 — 유령 항목 없음 (R3/R6)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.fake.userBack();
    s.fake.flush();
    vi.advanceTimersByTime(1100); // 항목 되살림
    expect(s.fake.index).toBe(2);
    // busy가 끝나 모달이 [해결]/X로 닫힘 → self-close가 되살린 항목을 back()으로 소비
    s.userCloseModal();
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
    // 다음 뒤로가기는 헛돌지 않고 곧장 이전 탭
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
  });

  it("모달이 ESC를 즉시 거부(\"refused\")하면 타이머 없이 그 자리에서 항목을 되살려 탭이 바뀌지 않는다 (Q4)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal(); // busy 중인 충돌 모달
    s.setEscMode("refuse");
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
    // 타이머를 돌리지 않아도 이미 모달 항목이 되살아나 있다
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "modal"]);
    expect(s.fake.index).toBe(2);
    expect(s.fake.state).toEqual({ fwIdx: 1 });
    expect(s.tab).toBe("ledger");
    // 1초 안에 다시 뒤로가기 → 모달을 건너뛰지 않고 다시 닫기를 시도, 탭 유지
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(2);
    expect(s.tab).toBe("ledger");
    expect(s.fake.index).toBe(2);
    // 거부는 기대 카운터를 올리지 않는다 — 타이머가 와도 중복으로 되살리지 않음
    vi.advanceTimersByTime(1100);
    expect(s.fake.index).toBe(2);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "modal"]);
    // busy가 끝나 모달이 스스로 닫히면 되살린 항목을 소비 → 다음 뒤로가기는 곧장 이전 탭
    s.userCloseModal();
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
  });

  it("첫 화면 모달(탭 항목 없음)이 거부해도 항목을 되살려 두 번째 뒤로가기가 base로 빠져나가지 않는다 (Q4)", () => {
    const s = setup("dashboard");
    s.openModal(); // 부팅 직후 충돌 모달 — entries=[modal]
    s.setEscMode("refuse");
    s.fake.userBack();
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.fake.state).toEqual({ fwIdx: 0 });
    s.fake.userBack();
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(2);
    expect(s.fake.index).toBe(1); // base(fwIdx -1)에 머물지 않음 — 앱 종료 경로 아님
    expect(s.setTab).not.toHaveBeenCalled();
  });

  it("\"refused\" 오탐(입력 필드가 ESC를 preventDefault, 모달은 실제로 닫힘)은 self-close가 되살린 항목을 소비해 회복한다 (Q4)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal(); // 운동 세트 편집 모달 — Stepper 입력에 포커스
    s.setEscMode("refuse-but-close");
    s.fake.userBack();
    s.fake.flush();
    expect(s.fake.index).toBe(2); // 일단 되살림
    s.flushModalClose(); // 모달은 실제로 닫힘 → 기대 카운터 0이라 self-close로 처리
    s.fake.flush();
    expect(s.modalDepth).toBe(0);
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
    vi.advanceTimersByTime(1100);
    expect(s.fake.index).toBe(1); // 타이머가 유령 항목을 만들지 않음
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
  });

  it("뒤로가기로 모달이 지연 시간 안에 정상 닫히면 타임아웃 후에도 항목을 되살리지 않는다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.fake.userBack();
    s.fake.flush();
    s.flushModalClose(); // 1초 안에 닫힘 알림 도착
    vi.advanceTimersByTime(1100);
    expect(s.fake.index).toBe(1);
    expect(s.fake.length).toBe(3); // 추가 pushState 없음(forward 항목만 남음)
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
  });

  it("dispose 후 타임아웃이 와도 모달 항목을 되살리지 않는다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.fake.userBack();
    s.fake.flush();
    s.ctrl.dispose();
    vi.advanceTimersByTime(1100);
    expect(s.fake.length).toBe(3);
    expect(s.fake.index).toBe(1);
  });

  it("두 모달이 한 렌더에서 함께 닫히면(2→0) 두 항목을 소비하고 go(-2) 한 번 — 유령 항목 없음 (K10)", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal(); // GistVersionModal
    s.openModal(); // 그 위 ApplyConfirmModal
    expect(s.fake.index).toBe(3);
    s.setModalDepthBatched(0); // [적용] — onClose + setPendingApply(null) 한 커밋
    expect(s.fake.goCalls).toEqual([-2]);
    expect(s.ctrl.getEntries().some((e) => e.kind === "modal" && !e.stale)).toBe(false);
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
    expect(s.closeTopModal).not.toHaveBeenCalled();
    // 다음 뒤로가기는 헛돌지 않고 곧장 이전 탭
    s.fake.userBack();
    s.fake.flush();
    expect(s.tab).toBe("dashboard");
  });

  it("두 모달이 한 렌더에서 함께 열리면(0→2) 항목 두 개를 push한다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.setModalDepthBatched(2);
    expect(s.fake.length).toBe(4);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "modal", "modal"]);
    // 이후 한 번에 닫혀도 짝이 맞는다
    s.setModalDepthBatched(0);
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().length).toBe(1);
  });

  it("단일 X/ESC 닫힘은 기존처럼 back() 한 번 — go는 쓰지 않는다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.openModal();
    s.userCloseModal(); // 2→1
    expect(s.fake.goCalls).toEqual([]);
    s.fake.flush();
    expect(s.fake.index).toBe(2);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger", "modal"]);
  });

  it("뒤로가기로 닫힌 모달과 자체 닫힘이 한 알림에 섞이면 기대 카운터만큼만 상쇄하고 나머지를 소비한다", () => {
    const s = setup("dashboard");
    s.userSetTab("ledger");
    s.openModal();
    s.openModal();
    s.fake.userBack(); // 최상위 모달 항목 제거 + closeTopModal(합성 ESC)
    s.fake.flush();
    expect(s.closeTopModal).toHaveBeenCalledTimes(1);
    expect(s.fake.index).toBe(2);
    // 위 모달이 닫히며 아래 모달도 같은 커밋에서 닫힘 → 알림 1회(2→0)
    s.setModalDepthBatched(0);
    expect(s.fake.goCalls).toEqual([]); // 남은 1개는 back()으로
    s.fake.flush();
    expect(s.fake.index).toBe(1);
    expect(s.ctrl.getEntries().map((e) => (e.kind === "tab" ? e.tab : "modal"))).toEqual(["ledger"]);
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
