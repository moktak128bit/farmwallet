import { create } from "zustand";
import type { AppData } from "../types";
import { getEmptyData } from "../services/dataService";

interface AppStore {
  data: AppData;
  setData: (next: AppData | ((prev: AppData) => AppData)) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  data: getEmptyData(),
  setData: (next) =>
    set((state) => ({
      data: typeof next === "function" ? next(state.data) : next
    }))
}));
