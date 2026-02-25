// Shared formatter utilities.

export const formatNumber = (value?: number | null, locale: string = "ko-KR"): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value == null) return "0";
  return Math.round(value).toLocaleString(locale);
};

export const formatKRW = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0 원";
  return `${formatNumber(value)} 원`;
};

export const formatUSD = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "$0.000";
  const formatted = value.toFixed(3);
  const parts = formatted.split(".");
  parts[0] = parseInt(parts[0], 10).toLocaleString("en-US");
  return `$${parts.join(".")}`;
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
