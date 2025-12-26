// 공통 포맷 유틸리티 함수

export const formatNumber = (value?: number | null, locale: string = "ko-KR"): string => {
  if (typeof value !== "number" || isNaN(value) || value == null) return "0";
  return Math.round(value).toLocaleString(locale);
};

export const formatKRW = (value: number): string => {
  if (typeof value !== "number" || isNaN(value)) return "0 원";
  return `${formatNumber(value)} 원`;
};

export const formatUSD = (value: number): string => {
  if (typeof value !== "number" || isNaN(value)) return "0";
  return formatNumber(value, "en-US");
};

// 날짜 형식 단축: YYYY-MM-DD → YY.MM.DD
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // 유효하지 않은 날짜면 원본 반환
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return dateStr; // 에러 발생 시 원본 반환
  }
}

