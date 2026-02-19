import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME) as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle("dark", saved === "dark");
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
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
  };

  return { theme, toggleTheme };
}
