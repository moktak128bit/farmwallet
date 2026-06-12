// Shared formatter utilities.

import { parseIsoLocal } from "./date";

export const formatNumber = (value?: number | null, locale: string = "ko-KR"): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value == null) return "0";
  // Math.round(-0.4) === -0 → "-0"으로 표기되는 문제 방지 (+0으로 정규화)
  const rounded = Math.round(value) + 0;
  return rounded.toLocaleString(locale);
};

export const formatKRW = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0 원";
  return `${formatNumber(value)} 원`;
};

export const formatUSD = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "$0.000";
  // 음수는 "-$1,234.567" 형태 (기존 "$-1,234.567"·"$-5.500" 표기 교정)
  const sign = value < 0 ? "-" : "";
  const formatted = Math.abs(value).toFixed(3);
  const parts = formatted.split(".");
  parts[0] = parseInt(parts[0], 10).toLocaleString("en-US");
  return `${sign}$${parts.join(".")}`;
};

// YYYY-MM-DD -> YY.MM.DD
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return "";
  // UTC 파싱(new Date("YYYY-MM-DD"))은 음수 타임존에서 하루 밀림 → 로컬 파싱 사용
  const date = parseIsoLocal(dateStr.slice(0, 10));
  if (!date) return dateStr;
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}
