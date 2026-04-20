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

const APP_LOG_MAX = 200;
let appLogIdCounter = 0;

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

  appLog: [],
  addAppLog: (message, type = "success") =>
    set((state) => {
      const id = ++appLogIdCounter;
      const time = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return {
        appLog: [...state.appLog.slice(-(APP_LOG_MAX - 1)), { id, message, type, time }],
      };
    }),
}));
