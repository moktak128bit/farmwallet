import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";

/** PWA 상태바 색(meta theme-color)을 현재 테마에 맞게 갱신 — index.html의 정적 메타는 초기 페인트용으로 유지 */
function applyThemeColor(dark: boolean) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#0d9488");
}

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME) as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle("dark", saved === "dark");
      applyThemeColor(saved === "dark");
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
      applyThemeColor(true);
    }
    
    // 고대비 모드 초기화
    const highContrast = localStorage.getItem(STORAGE_KEYS.HIGH_CONTRAST);
    if (highContrast === "true") {
      document.documentElement.classList.add("high-contrast");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(STORAGE_KEYS.THEME, next);
    document.documentElement.classList.toggle("dark", next === "dark");
    applyThemeColor(next === "dark");
  };

  return { theme, toggleTheme };
}
