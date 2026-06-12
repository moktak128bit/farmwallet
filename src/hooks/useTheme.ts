import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";

/** PWA 상태바 색(meta theme-color)을 현재 테마에 맞게 갱신 — index.html의 정적 메타는 초기 페인트용으로 유지 */
function applyThemeColor(dark: boolean) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#0d9488");
}

// ---- 커스텀 테마 (ThemeCustomizer 저장분) ----

export interface CustomThemeColors {
  primary: string;
  primaryHover: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
}

export type FontSizeOption = "small" | "medium" | "large";

const FONT_SIZE_MAP: Record<FontSizeOption, string> = {
  small: "13px",
  medium: "14px",
  large: "16px"
};

/** 커스텀 테마가 덮어쓰는 CSS 변수 목록 (removeProperty 시에도 사용) */
const CUSTOM_THEME_VARS = [
  "--primary",
  "--primary-hover",
  "--accent",
  "--danger",
  "--warning",
  "--success"
] as const;

/** 저장된 커스텀 테마 색상 읽기. 없거나 파싱 실패 시 null. */
export function readSavedCustomTheme(): CustomThemeColors | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_THEME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomThemeColors;
    if (!parsed || typeof parsed.primary !== "string") return null;
    return parsed;
  } catch (e) {
    console.warn("[useTheme] 저장된 커스텀 테마 로드 실패", e);
    return null;
  }
}

/** 저장된 폰트 크기 읽기. 없으면 null. */
export function readSavedFontSize(): FontSizeOption | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
  return raw === "small" || raw === "medium" || raw === "large" ? raw : null;
}

/** 커스텀 색상을 인라인 CSS 변수로 적용 */
export function applyCustomThemeColors(colors: CustomThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty("--primary", colors.primary);
  root.style.setProperty("--primary-hover", colors.primaryHover);
  root.style.setProperty("--accent", colors.accent);
  root.style.setProperty("--danger", colors.danger);
  root.style.setProperty("--warning", colors.warning);
  root.style.setProperty("--success", colors.success);
}

/** 폰트 크기 변수 적용 */
export function applyFontSizeOption(size: FontSizeOption): void {
  document.documentElement.style.setProperty("--base-font-size", FONT_SIZE_MAP[size]);
}

/**
 * 인라인 커스텀 테마 변수를 전부 제거 — 스타일시트(.dark 포함)의 기본 팔레트로 복귀.
 * "기본값으로 리셋" 시 사용.
 */
export function clearCustomThemeVars(): void {
  const root = document.documentElement;
  for (const v of CUSTOM_THEME_VARS) root.style.removeProperty(v);
  root.style.removeProperty("--base-font-size");
}

/**
 * 저장된 커스텀 테마/폰트 크기가 있을 때만 적용.
 * - 앱 시작 시(useTheme 초기화)와 라이트/다크 전환 시 호출.
 * - 저장본이 없으면 setProperty를 전혀 하지 않아 .dark 팔레트가 그대로 살아 있음.
 */
export function applySavedCustomTheme(): void {
  const colors = readSavedCustomTheme();
  if (colors) applyCustomThemeColors(colors);
  const fontSize = readSavedFontSize();
  if (fontSize) applyFontSizeOption(fontSize);
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

    // 저장된 커스텀 테마/폰트 크기 적용 (재시작 시 미적용 문제 해결)
    applySavedCustomTheme();
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(STORAGE_KEYS.THEME, next);
    document.documentElement.classList.toggle("dark", next === "dark");
    applyThemeColor(next === "dark");
    // 커스텀 테마가 저장돼 있으면 전환 후 재적용, 없으면 no-op (.dark 팔레트 유지)
    applySavedCustomTheme();
  };

  return { theme, toggleTheme };
}
