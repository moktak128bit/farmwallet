/**
 * 브라우저 뒤로가기 ↔ 앱 내 네비게이션 연동 (Android PWA에서 뒤로가기가 곧장 앱 종료되는 문제 대응).
 *
 * 모델: 앱 내부 스택(entries)을 브라우저 히스토리와 1:1로 미러링한다.
 *   - 탭 전환     → entries.push({tab})   + history.pushState({fwIdx})
 *   - 모달 열림   → entries.push({modal}) + history.pushState({fwIdx})
 *   - popstate    → state.fwIdx 위치까지 entries를 잘라내고:
 *       · 잘린 구간에 (아직 열린) 모달 항목이 있으면 최상위 모달 닫기(closeTopModal = 합성 ESC)
 *       · 남은 스택의 마지막 탭(없으면 base 탭)으로 setTab
 *   - 스택이 비면(기본) 브라우저 기본 동작(페이지 이탈/앱 종료)에 맡긴다.
 *
 * 모달이 뒤로가기가 아닌 방법(X 버튼·ESC)으로 닫히면 대응하는 히스토리 항목이 남는다(stale).
 *   - 최상위가 그 모달이면 history.back()으로 즉시 소비 → 다음 뒤로가기가 곧장 이전 탭으로 간다.
 *   - 중간에 끼어 있으면(드로어 열고 탭 전환 등) stale 표시만 해두고, 뒤로가기로 그 위치에 내려앉았을 때
 *     한 번 더 history.back()으로 건너뛴다(사용자는 한 번만 누른다).
 *
 * 같은 탭 연속 setTab은 push하지 않는다(pushState 폭주 방지). forward 이동(state.fwIdx가 스택 밖)은 무시.
 */
import { useEffect } from "react";
import type { TabId } from "../components/ui/Tabs";
import { useUIStore } from "../store/uiStore";
import { closeTopModal, getModalDepth, subscribeModalStack } from "./modalStack";

type Entry = { kind: "tab"; tab: TabId } | { kind: "modal"; stale: boolean };

export interface HistoryLike {
  pushState(state: unknown): void;
  replaceState(state: unknown): void;
  back(): void;
}

interface HistoryNavDeps {
  hist: HistoryLike;
  initialTab: TabId;
  getTab: () => TabId;
  setTab: (tab: TabId) => void;
  getModalDepth: () => number;
  /** 최상위 모달 닫기 시도 — 실제로 닫혔는지는 이후 깊이 변화로 판단 */
  closeTopModal: () => boolean;
}

export interface HistoryNavController {
  /** popstate 핸들러 — event.state 전달 */
  handlePop(state: unknown): void;
  /** 탭 값이 바뀌었을 때(스토어 구독) */
  onTabChange(tab: TabId): void;
  /** 모달 스택 깊이가 바뀌었을 때(modalStack 구독) */
  onModalDepthChange(depth: number): void;
  /** 테스트/진단용 — 현재 내부 스택 스냅샷 */
  getEntries(): ReadonlyArray<Readonly<Entry>>;
  dispose(): void;
}

interface FwState {
  fwIdx: number;
}

/** 우리가 남긴 state만 해석 — 다른 코드/외부 항목(state null 등)은 null → 관여하지 않음 */
function readIdx(state: unknown): number | null {
  if (state && typeof state === "object" && typeof (state as FwState).fwIdx === "number") {
    return (state as FwState).fwIdx;
  }
  return null;
}

/** closeTopModal 이후 닫힘 알림이 오지 않을 때(모달이 ESC를 무시 등) 기대 카운터를 풀어주는 시간 */
const EXPECTED_POP_RESET_MS = 1000;

export function createHistoryNav(deps: HistoryNavDeps): HistoryNavController {
  const { hist } = deps;
  let entries: Entry[] = [];
  const baseTab = deps.initialTab;
  let lastDepth = deps.getModalDepth();
  /** popstate가 setTab을 호출하는 동안 onTabChange가 다시 push하지 않도록 */
  let applyingTab: TabId | null = null;
  /** 뒤로가기로 닫은 모달의 "닫힘 알림"은 self-close로 취급하지 않기 위한 기대 카운터 */
  let expectedModalPops = 0;
  let expectedResetTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const armExpectedReset = () => {
    if (expectedResetTimer) clearTimeout(expectedResetTimer);
    expectedResetTimer = setTimeout(() => {
      expectedResetTimer = null;
      expectedModalPops = 0;
    }, EXPECTED_POP_RESET_MS);
  };

  const currentTopTab = (): TabId => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind === "tab") return e.tab;
    }
    return baseTab;
  };

  const push = (entry: Entry) => {
    entries.push(entry);
    hist.pushState({ fwIdx: entries.length - 1 } satisfies FwState);
  };

  /** 최상위가 stale 모달이면 소비하고 한 칸 더 뒤로 */
  const skipStaleTop = () => {
    const top = entries[entries.length - 1];
    if (top && top.kind === "modal" && top.stale) {
      entries.pop();
      hist.back();
    }
  };

  // base 표식 — 이 항목까지 돌아오면 더 이상 앱이 가로채지 않는다
  hist.replaceState({ fwIdx: -1 } satisfies FwState);

  return {
    onTabChange(tab) {
      if (disposed) return;
      if (applyingTab === tab) {
        applyingTab = null;
        return;
      }
      if (tab === currentTopTab()) return; // 같은 탭 연속 — push 금지
      push({ kind: "tab", tab });
    },

    onModalDepthChange(depth) {
      if (disposed) return;
      const prev = lastDepth;
      lastDepth = depth;
      if (depth > prev) {
        push({ kind: "modal", stale: false });
        return;
      }
      if (depth < prev) {
        if (expectedModalPops > 0) {
          // 뒤로가기로 닫힌 모달 — 히스토리 항목은 이미 popstate에서 제거됨
          expectedModalPops -= 1;
          return;
        }
        // X 버튼/ESC 등 자체 닫힘 — 대응 항목을 stale 처리
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          if (e.kind === "modal" && !e.stale) {
            if (i === entries.length - 1) {
              entries.pop();
              hist.back(); // 최상위면 즉시 소비
            } else {
              e.stale = true; // 중간이면 내려앉을 때 건너뜀
            }
            break;
          }
        }
      }
    },

    handlePop(state) {
      if (disposed) return;
      const idx = readIdx(state);
      if (idx == null) return; // 우리 항목이 아님
      if (idx >= entries.length) return; // forward 이동·새로고침 잔여 항목 — 관여하지 않음
      const popped = entries.splice(idx + 1);
      const liveModalPopped = popped.some((e) => e.kind === "modal" && !e.stale);
      if (liveModalPopped && deps.getModalDepth() > 0 && deps.closeTopModal()) {
        expectedModalPops += 1;
        armExpectedReset();
      }
      const target = currentTopTab();
      if (target !== deps.getTab()) {
        applyingTab = target;
        deps.setTab(target);
        applyingTab = null; // setTab이 동기 구독을 못 깨운 경우를 위해 정리
      }
      skipStaleTop();
    },

    getEntries() {
      return entries;
    },

    dispose() {
      disposed = true;
      entries = [];
      if (expectedResetTimer) clearTimeout(expectedResetTimer);
      expectedResetTimer = null;
    },
  };
}

/**
 * App 마운트 시 1회 설치: uiStore.tab·modalStack·window.popstate를 연결한다.
 * useDeepLink() 다음에 호출할 것(딥링크 적용 후 탭이 base가 되도록).
 */
export function useHistoryNav(): void {
  useEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    const h = window.history;
    const hist: HistoryLike = {
      pushState: (state) => {
        try {
          h.pushState(state, "");
        } catch {
          // 일부 환경(file://·샌드박스)에서 pushState 불가 — 연동 비활성
        }
      },
      replaceState: (state) => {
        try {
          h.replaceState(state, "");
        } catch {
          // 위와 동일
        }
      },
      back: () => h.back(),
    };
    const ctrl = createHistoryNav({
      hist,
      initialTab: useUIStore.getState().tab,
      getTab: () => useUIStore.getState().tab,
      setTab: (tab) => useUIStore.getState().setTab(tab),
      getModalDepth,
      closeTopModal,
    });
    const unsubTab = useUIStore.subscribe((s, prev) => {
      if (s.tab !== prev.tab) ctrl.onTabChange(s.tab);
    });
    const unsubModal = subscribeModalStack(() => ctrl.onModalDepthChange(getModalDepth()));
    const onPop = (e: PopStateEvent) => ctrl.handlePop(e.state);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      unsubModal();
      unsubTab();
      ctrl.dispose();
    };
  }, []);
}
