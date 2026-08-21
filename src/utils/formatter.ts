// Shared formatter utilities.

import { parseIsoLocal } from "./date";

// ---- 프라이버시 블러(5-1): 켜지면 숫자만 마스킹, 부호·통화기호·단위는 유지 ----
// 내보내기(csvExport/excelExport/pdfExport/reportExport/unifiedCsvExport/ledgerMarkdownReport)는
// 이 모듈을 참조하지 않고 자체 raw 포맷을 쓰므로 이 플래그의 영향을 받지 않는다.
let maskAmounts = false;

/** 화면 표시 금액을 마스킹할지 전역 설정. uiStore의 privacyMode와 동기화됨(App 최상단). */
export function setAmountMask(on: boolean): void {
  maskAmounts = on;
}

/** 현재 마스킹 상태 (테스트/디버그용) */
export function isAmountMasked(): boolean {
  return maskAmounts;
}

const MASK_DOTS = "••••";

export const formatNumber = (value?: number | null, locale: string = "ko-KR"): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value == null) return "0";
  if (maskAmounts) return MASK_DOTS;
  // Math.round(-0.4) === -0 → "-0"으로 표기되는 문제 방지 (+0으로 정규화)
  const rounded = Math.round(value) + 0;
  return rounded.toLocaleString(locale);
};

export const formatKRW = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "0 원";
  return `${formatNumber(value)} 원`;
};

/** 소수점 보유(주식 수량·단가 등)까지 표시하는 숫자 포맷 — maskAmounts=true면 숫자 부분을 가린다. */
export const formatDecimal = (
  value?: number | null,
  maxFractionDigits: number = 2,
  locale: string = "ko-KR"
): string => {
  if (typeof value !== "number" || Number.isNaN(value) || value == null) return "0";
  if (maskAmounts) return MASK_DOTS;
  return value.toLocaleString(locale, { maximumFractionDigits: maxFractionDigits });
};

export const formatUSD = (value: number): string => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return "$0.000";
  // 음수는 "-$1,234.567" 형태 (기존 "$-1,234.567"·"$-5.500" 표기 교정)
  const sign = value < 0 ? "-" : "";
  if (maskAmounts) return `${sign}$${MASK_DOTS}`;
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
