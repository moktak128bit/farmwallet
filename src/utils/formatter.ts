// Shared formatter utilities.

/**
 * 표시 정밀도 정책
 * - 집계·평가액·합계: 반올림 (기본값). 소수점 노이즈 없이 읽히게.
 * - 사용자가 직접 입력한 값(단가·수수료·수량·주당배당금): 입력한 소수를 그대로.
 *   → `{ exact: true }` 를 넘긴다. 입력은 212.25를 받아 놓고 표시가 212로 잘리면
 *     "왜 내가 넣은 값이 사라지지?"가 된다.
 */
export interface FormatOptions {
  /** 소수를 반올림하지 않고 그대로 보여준다 (뒤따르는 0은 제거) */
  exact?: boolean;
  /** exact일 때 최대 소수 자릿수 (기본 2) */
  maxDecimals?: number;
}

/** 소수 자릿수를 자르되 뒤따르는 0은 없앤다: 212.250 → "212.25", 212 → "212" */
const trimDecimals = (value: number, maxDecimals: number): string => {
  const fixed = value.toFixed(Math.max(0, maxDecimals));
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  const [int, frac] = trimmed.split(".");
  const intWithCommas = Number(int).toLocaleString("ko-KR");
  return frac ? `${intWithCommas}.${frac}` : intWithCommas;
};

export const formatNumber = (value?: number | null, locale: string = "ko-KR"): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value == null) return "0";
  return Math.round(value).toLocaleString(locale);
};

export const formatKRW = (value: number, options?: FormatOptions): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0 원";
  if (options?.exact) return `${trimDecimals(value, options.maxDecimals ?? 2)} 원`;
  return `${formatNumber(value)} 원`;
};

export const formatUSD = (value: number, options?: FormatOptions): string => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "$0.000";
  if (options?.exact) return `$${trimDecimals(value, options.maxDecimals ?? 4)}`;
  const formatted = value.toFixed(3);
  const parts = formatted.split(".");
  parts[0] = parseInt(parts[0], 10).toLocaleString("en-US");
  return `$${parts.join(".")}`;
};

/**
 * 수량 표시 — 주식은 정수, 미국주식은 소수점 매수, 코인은 8자리까지.
 * 정수면 콤마만, 소수면 있는 자릿수까지만 보여준다 (0.00382828 → "0.00382828", 0.5 → "0.5").
 */
export const formatQuantity = (value?: number | null, maxDecimals: number = 8): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return value.toLocaleString("ko-KR");
  return trimDecimals(value, maxDecimals);
};

// YYYY-MM-DD -> YY.MM.DD
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return dateStr;
  }
}
