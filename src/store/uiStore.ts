import { create } from "zustand";
import type { TabId } from "../components/ui/Tabs";
import type { LedgerEntry } from "../types";
import { isGistConfigured } from "../services/gistSync";

export interface AppLogEntry {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  time: string;
}

export interface PendingAction {
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: "primary" | "danger";
  onConfirm: () => void;
}

export interface IntegritySummary {
  error: number;
  warning: number;
}

/**
 * Gist 자동 push 중 원격 변경이 감지된 경우의 충돌 정보.
 * 모달이 표시되며 사용자가 원격 적용/로컬 강제 푸시/취소를 선택.
 */
export interface GistConflict {
  /** 원격에서 새로 fetch한 Gist 데이터 JSON 문자열 */
  remoteDataJson: string;
  /** 원격 커밋 시각 (ISO) */
  remoteUpdatedAt: string;
  /** push하려고 시도했던 로컬 데이터 JSON */
  pendingLocalDataJson: string;
}

/** 자동저장 상태 머신. saving/saved는 디바운스 콜백 진입·완료에 매핑. error는 다음 시도까지 sticky. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * 다른 탭에서 저장된 변경이 도착했을 때, 현재 탭에 미저장 dirty 변경이 있어
 * 단순 덮어쓰기로는 데이터 유실이 발생할 수 있는 충돌 상황.
 */
export interface TabConflict {
  /** 다른 탭이 저장한 데이터 (localStorage에서 읽은 직렬화 payload) */
  remoteDataJson: string;
  /** 우리 탭의 현재 store 데이터 직렬화 (충돌 해결 후 그대로 push할 수 있도록) */
  localDataJson: string;
  /** 충돌 감지 시각 (ms epoch) */
  detectedAt: number;
}

/**
 * 디바운스 대기 중 크래시로 유실될 뻔한 미저장 변경이 boot 시점에 발견된 경우.
 * 사용자가 [복구]/[폐기]를 선택할 때까지 banner로 노출.
 */
export interface DraftRecovery {
  /** 드래프트 슬롯에 보관됐던 직렬화 데이터 */
  draftJson: string;
  /** 드래프트 작성 시각 (ms epoch) */
  draftAt: number;
}

const APP_LOG_MAX = 200;
/** localStorage에 보관할 최근 로그 (세션 복원용 + 사용자 내보내기) */
const APP_LOG_PERSIST_MAX = 500;
const APP_LOG_STORAGE_KEY = "fw-app-log-v1";

function loadPersistedLog(): AppLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APP_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 최근 APP_LOG_MAX만 UI로 올림
    return parsed
      .filter((e): e is AppLogEntry =>
        !!e && typeof e === "object" &&
        typeof (e as AppLogEntry).id === "number" &&
        typeof (e as AppLogEntry).message === "string" &&
        typeof (e as AppLogEntry).time === "string")
      .slice(-APP_LOG_MAX);
  } catch { return []; }
}

/** 부팅 시 복원된 영속 로그 — id 카운터를 최대 id 다음부터 시작해 React key 중복 방지 */
const initialAppLog = loadPersistedLog();
let appLogIdCounter = initialAppLog.reduce(
  (max, e) => (Number.isFinite(e.id) && e.id > max ? e.id : max),
  0
);

let persistScheduled = false;
function schedulePersist(getEntries: () => AppLogEntry[]) {
  if (persistScheduled || typeof window === "undefined") return;
  persistScheduled = true;
  // 연속된 log 추가를 한 번에 묶어 쓰도록 idle/next-tick에 지연
  setTimeout(() => {
    persistScheduled = false;
    try {
      const trimmed = getEntries().slice(-APP_LOG_PERSIST_MAX);
      window.localStorage.setItem(APP_LOG_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // quota 초과 등 — 조용히 실패, 다음 호출에서 재시도
    }
  }, 500);
}

interface UIStore {
  // Navigation
  tab: TabId;
  setTab: (tab: TabId) => void;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;

  // Modals
  pendingAction: PendingAction | null;
  setPendingAction: (action: PendingAction | null) => void;
  showShortcutsHelp: boolean;
  setShowShortcutsHelp: (show: boolean | ((prev: boolean) => boolean)) => void;
  showQuickEntry: boolean;
  setShowQuickEntry: (show: boolean) => void;
  showGistVersionModal: boolean;
  setShowGistVersionModal: (show: boolean) => void;

  // Gist 충돌
  gistConflict: GistConflict | null;
  setGistConflict: (conflict: GistConflict | null) => void;

  // 자동저장 상태 표시기
  saveStatus: SaveStatus;
  saveStatusError: string | null;
  /** saved/error 진입 시각 — pill의 "N초 전" 표시·자동 idle 복귀 타이머용 */
  saveStatusAt: number;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;

  /** 사용자 편집이 디바운스 큐에 있고 아직 디스크에 안 들어간 dirty 윈도우 신호 */
  hasDirtyChanges: boolean;
  setHasDirtyChanges: (v: boolean) => void;

  // 탭 간 충돌 / 드래프트 복구
  tabConflict: TabConflict | null;
  setTabConflict: (conflict: TabConflict | null) => void;
  draftRecovery: DraftRecovery | null;
  setDraftRecovery: (recovery: DraftRecovery | null) => void;

  // Cross-page navigation
  copyRequest: LedgerEntry | null;
  setCopyRequest: (entry: LedgerEntry | null) => void;
  highlightLedgerId: string | null;
  setHighlightLedgerId: (id: string | null) => void;
  highlightTradeId: string | null;
  setHighlightTradeId: (id: string | null) => void;

  // Sync UI flags
  isPushingToGit: boolean;
  setIsPushingToGit: (val: boolean) => void;
  isPullingFromGit: boolean;
  setIsPullingFromGit: (val: boolean) => void;
  isGistSaving: boolean;
  setIsGistSaving: (val: boolean) => void;
  isGistLoading: boolean;
  setIsGistLoading: (val: boolean) => void;

  // Misc UI
  newVersionAvailable: boolean;
  setNewVersionAvailable: (val: boolean) => void;
  gistConfigured: boolean;
  setGistConfigured: (val: boolean) => void;
  integritySummary: IntegritySummary | null;
  setIntegritySummary: (summary: IntegritySummary | null) => void;

  // App log
  appLog: AppLogEntry[];
  addAppLog: (message: string, type?: AppLogEntry["type"]) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  tab: "dashboard",
  setTab: (tab) => set({ tab }),
  mobileDrawerOpen: false,
  setMobileDrawerOpen: (mobileDrawerOpen) => set({ mobileDrawerOpen }),

  pendingAction: null,
  setPendingAction: (pendingAction) => set({ pendingAction }),
  showShortcutsHelp: false,
  setShowShortcutsHelp: (show) =>
    set((state) => ({
      showShortcutsHelp: typeof show === "function" ? show(state.showShortcutsHelp) : show,
    })),
  showQuickEntry: false,
  setShowQuickEntry: (showQuickEntry) => set({ showQuickEntry }),
  showGistVersionModal: false,
  setShowGistVersionModal: (showGistVersionModal) => set({ showGistVersionModal }),

  gistConflict: null,
  setGistConflict: (gistConflict) => set({ gistConflict }),

  saveStatus: "idle",
  saveStatusError: null,
  saveStatusAt: 0,
  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveStatusError: error, saveStatusAt: Date.now() }),

  hasDirtyChanges: false,
  setHasDirtyChanges: (hasDirtyChanges) => set({ hasDirtyChanges }),

  tabConflict: null,
  setTabConflict: (tabConflict) => set({ tabConflict }),
  draftRecovery: null,
  setDraftRecovery: (draftRecovery) => set({ draftRecovery }),

  copyRequest: null,
  setCopyRequest: (copyRequest) => set({ copyRequest }),
  highlightLedgerId: null,
  setHighlightLedgerId: (highlightLedgerId) => set({ highlightLedgerId }),
  highlightTradeId: null,
  setHighlightTradeId: (highlightTradeId) => set({ highlightTradeId }),

  isPushingToGit: false,
  setIsPushingToGit: (isPushingToGit) => set({ isPushingToGit }),
  isPullingFromGit: false,
  setIsPullingFromGit: (isPullingFromGit) => set({ isPullingFromGit }),
  isGistSaving: false,
  setIsGistSaving: (isGistSaving) => set({ isGistSaving }),
  isGistLoading: false,
  setIsGistLoading: (isGistLoading) => set({ isGistLoading }),

  newVersionAvailable: false,
  setNewVersionAvailable: (newVersionAvailable) => set({ newVersionAvailable }),
  gistConfigured: typeof window !== "undefined" ? isGistConfigured() : false,
  setGistConfigured: (gistConfigured) => set({ gistConfigured }),
  integritySummary: null,
  setIntegritySummary: (integritySummary) => set({ integritySummary }),

  appLog: initialAppLog,
  addAppLog: (message, type = "success") =>
    set((state) => {
      const id = ++appLogIdCounter;
      const time = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const next = [...state.appLog.slice(-(APP_LOG_MAX - 1)), { id, message, type, time }];
      // 백그라운드 영속화 — quota 초과 시 조용히 실패
      schedulePersist(() => useUIStore.getState().appLog);
      return { appLog: next };
    }),
}));
