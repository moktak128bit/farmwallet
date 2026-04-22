import { create } from "zustand";
import type { AppData } from "../types";
import { getEmptyData } from "../services/dataService";

interface AppStore {
  data: AppData;
  setData: (next: AppData | ((prev: AppData) => AppData)) => void;
  /** 시세 동기화 로그 (우측 하단 실시간 로그 창) */
  syncLogs: string[];
  addSyncLog: (log: string) => void;
  clearSyncLogs: () => void;
  isSyncing: boolean;
  setIsSyncing: (val: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  data: getEmptyData(),
  setData: (next) =>
    set((state) => ({
      data: typeof next === "function" ? next(state.data) : next
    })),
  syncLogs: [],
  addSyncLog: (log) =>
    set((state) => {
      const next = [...state.syncLogs, log];
      return { syncLogs: next.length > 200 ? next.slice(next.length - 200) : next };
    }),
  clearSyncLogs: () => set({ syncLogs: [] }),
  isSyncing: false,
  setIsSyncing: (val) => set({ isSyncing: val })
}));
