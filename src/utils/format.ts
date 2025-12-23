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

