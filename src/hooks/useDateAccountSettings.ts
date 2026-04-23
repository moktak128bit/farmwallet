import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";

function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function useStorageValue(key: string): string | null {
  const [val, setVal] = useState<string | null>(() => readRaw(key));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setVal(e.newValue);
    };
    const onLocalChange = () => setVal(readRaw(key));
    window.addEventListener("storage", onStorage);
    window.addEventListener("fw-date-account-change", onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fw-date-account-change", onLocalChange);
    };
  }, [key]);
  return val;
}

export function useDateAccountId(): string | null {
  return useStorageValue(STORAGE_KEYS.DATE_ACCOUNT_ID);
}

export function useDateAccountRatio(): number {
  const raw = useStorageValue(STORAGE_KEYS.DATE_ACCOUNT_RATIO);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 50;
}

export function notifyDateAccountChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("fw-date-account-change"));
}
