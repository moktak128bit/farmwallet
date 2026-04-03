/**
 * 폼 검증 유틸리티 함수들
 */

import type { Account } from "../types";
import { isUSDStock } from "./finance";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 금액 검증
 * @param value 입력값 (문자열)
 * @param allowNegative 음수 허용 여부
 * @param min 최소값
 * @param max 최대값
 * @param allowDecimal 소수점 허용 여부 (기본값: false)
 */
export function validateAmount(
  value: string,
  allowNegative: boolean = false,
  min?: number,
  max?: number,
  allowDecimal: boolean = false
): ValidationResult {
  if (!value || value.trim() === "") {
    return { valid: false, error: "금액을 입력해주세요" };
  }

  // allowNegative 여부에 따라 정규식에 '-' 포함, 쉼표는 항상 제거
  let numeric: string;
  if (allowDecimal) {
    const regex = allowNegative ? /[^\d.-]/g : /[^\d.]/g;
    numeric = value.replace(regex, "");

    const dotCount = (numeric.match(/\./g) || []).length;
    if (dotCount > 1) {
      return { valid: false, error: "올바른 숫자 형식이 아닙니다 (소수점은 하나만 허용)" };
    }
    if (numeric.startsWith(".") || numeric.endsWith(".") || numeric.startsWith("-.")) {
      return { valid: false, error: "올바른 숫자 형식이 아닙니다" };
    }
  } else {
    const regex = allowNegative ? /[^\d-]/g : /[^\d]/g;
    numeric = value.replace(regex, "");
  }

  // 마이너스 기호는 맨 앞 한 개만 허용
  if (numeric.indexOf("-") > 0 || (numeric.match(/-/g) || []).length > 1) {
    return { valid: false, error: "올바른 숫자 형식이 아닙니다" };
  }
  if (!numeric || numeric === "-") {
    return { valid: false, error: "금액을 입력해주세요" };
  }

  const numValue = Number(numeric);
  
  if (isNaN(numValue)) {
    return { valid: false, error: "올바른 숫자를 입력해주세요" };
  }

  if (!allowNegative && numValue < 0) {
    return { valid: false, error: "음수는 입력할 수 없습니다" };
  }

  if (min !== undefined && numValue < min) {
    return { valid: false, error: `최소값은 ${min.toLocaleString()}입니다` };
  }

  if (max !== undefined && numValue > max) {
    return { valid: false, error: `최대값은 ${max.toLocaleString()}입니다` };
  }

  return { valid: true };
}

/**
 * 날짜 검증
 * @param date 날짜 문자열 (YYYY-MM-DD 형식)
 * @param maxDate 최대 허용 날짜 (미래 날짜 제한, undefined면 미래 날짜 허용)
 *                 - LedgerView: 현재 날짜까지만 허용 (미래 날짜 제한)
 *                 - StocksView: 미래 날짜 허용 (과거 거래 기록 입력, 예약 주문 등)
 * @param minDate 최소 허용 날짜
 */
export function validateDate(
  date: string,
  maxDate?: Date,
  minDate?: Date
): ValidationResult {
  if (!date || date.trim() === "") {
    return { valid: false, error: "날짜를 선택해주세요" };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return { valid: false, error: "올바른 날짜 형식이 아닙니다 (YYYY-MM-DD)" };
  }

  // 날짜 문자열을 직접 파싱하여 타임존 문제 방지
  const [year, month, day] = date.split("-").map(Number);
  
  // 유효한 날짜인지 확인
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, error: "유효하지 않은 날짜입니다" };
  }
  
  // 실제로 유효한 날짜인지 확인 (예: 2월 30일 같은 경우)
  const testDate = new Date(year, month - 1, day);
  if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
    return { valid: false, error: "유효하지 않은 날짜입니다" };
  }

  // 날짜 비교를 위해 날짜만 사용 (시간 제외)
  const dateOnly = new Date(year, month - 1, day);
  const maxDateOnly = maxDate ? new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()) : null;
  const minDateOnly = minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()) : null;

  if (maxDateOnly && dateOnly > maxDateOnly) {
    const maxDateStr = maxDateOnly.toISOString().slice(0, 10);
    return { valid: false, error: `${maxDateStr} 이전 날짜만 선택할 수 있습니다` };
  }

  if (minDateOnly && dateOnly < minDateOnly) {
    const minDateStr = minDateOnly.toISOString().slice(0, 10);
    return { valid: false, error: `${minDateStr} 이후 날짜만 선택할 수 있습니다` };
  }

  return { valid: true };
}

/**
 * 티커 검증
 * @param ticker 티커 심볼
 */
export function validateTicker(ticker: string): ValidationResult {
  if (!ticker || ticker.trim() === "") {
    return { valid: false, error: "티커를 입력해주세요" };
  }

  const trimmedTicker = ticker.trim().toUpperCase();
  
  // 기본 형식 검증 (영문, 숫자, 점, 등호 허용)
  const tickerRegex = /^[A-Z0-9.=]+$/;
  if (!tickerRegex.test(trimmedTicker)) {
    return { valid: false, error: "올바른 티커 형식이 아닙니다" };
  }

  // 최소/최대 길이
  if (trimmedTicker.length < 1) {
    return { valid: false, error: "티커는 최소 1자 이상이어야 합니다" };
  }

  if (trimmedTicker.length > 20) {
    return { valid: false, error: "티커는 최대 20자까지 입력할 수 있습니다" };
  }

  return { valid: true };
}

/**
 * 수량 검증
 * @param quantity 수량 (문자열)
 * @param allowDecimal 소수점 허용 여부
 */
export function validateQuantity(
  quantity: string,
  allowDecimal: boolean = false
): ValidationResult {
  if (!quantity || quantity.trim() === "") {
    return { valid: false, error: "수량을 입력해주세요" };
  }

  const cleanQuantity = quantity.replace(/,/g, "");
  const numValue = Number(cleanQuantity);
  
  if (isNaN(numValue)) {
    return { valid: false, error: "올바른 숫자를 입력해주세요" };
  }

  if (numValue <= 0) {
    return { valid: false, error: "수량은 0보다 커야 합니다" };
  }

  if (!allowDecimal && !Number.isInteger(numValue)) {
    return { valid: false, error: "수량은 정수만 입력할 수 있습니다" };
  }

  // 소수 허용 시 최대 8자리까지 (암호화폐 등)
  if (allowDecimal) {
    const parts = cleanQuantity.split(".");
    if (parts.length === 2 && parts[1].length > 8) {
      return { valid: false, error: "수량은 소수점 8자리까지 입력할 수 있습니다" };
    }
  }

  return { valid: true };
}

/**
 * 계좌 ID가 목록에 존재하는지 검증 (가계부 등에서 사용)
 * @param accountId 검사할 계좌 ID
 * @param accounts 계좌 목록 (id 포함)
 */
export function validateAccountExists(
  accountId: string | undefined,
  accounts: { id: string }[]
): ValidationResult {
  if (!accountId || accountId.trim() === "") {
    return { valid: true };
  }
  const exists = accounts.some((a) => a.id === accountId);
  if (!exists) {
    return { valid: false, error: "선택한 계좌가 더 이상 없습니다. 계좌 목록을 확인해 주세요." };
  }
  return { valid: true };
}

/**
 * 필수 필드 검증
 * @param value 입력값
 * @param fieldName 필드 이름 (에러 메시지용)
 */
export function validateRequired(
  value: string | undefined | null,
  fieldName: string
): ValidationResult {
  if (!value || value.trim() === "") {
    return { valid: false, error: `${fieldName}을(를) 입력해주세요` };
  }
  return { valid: true };
}

/**
 * 계좌 통화와 티커 통화 일치 검증 (주식 거래용)
 * 증권계좌는 통과. 일반 계좌는 USD/KRW와 티커 통화가 일치해야 함.
 */
export function validateAccountTickerCurrency(
  account: Account,
  ticker: string,
  priceInfo?: { currency?: string } | null
): ValidationResult {
  if (account.type === "securities" || account.type === "crypto") return { valid: true };
  const accountCurrency = account.currency || "KRW";
  const isUSD = isUSDStock(ticker);
  const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
  const isUSDCurrency = currency === "USD";
  if (accountCurrency === "USD" && !isUSDCurrency)
    return { valid: false, error: "달러 계좌에서는 달러 종목만 거래할 수 있습니다." };
  if (accountCurrency === "KRW" && isUSDCurrency)
    return { valid: false, error: "원화 계좌에서는 원화 종목만 거래할 수 있습니다." };
  return { valid: true };
}

/**
 * 이체 검증 (출금계좌와 입금계좌가 다른지 확인)
 * @param fromAccountId 출금 계좌 ID
 * @param toAccountId 입금 계좌 ID
 * @param labels 환전 등 다른 문맥용 라벨 (기본: 출금/입금)
 */
export function validateTransfer(
  fromAccountId: string,
  toAccountId: string,
  labels?: { from?: string; to?: string }
): ValidationResult {
  if (!fromAccountId || !toAccountId) {
    return { valid: true }; // 필수 필드 검증은 별도로 처리
  }

  const from = labels?.from ?? "출금";
  const to = labels?.to ?? "입금";
  if (fromAccountId === toAccountId) {
    return { valid: false, error: `${from} 계좌와 ${to} 계좌가 같을 수 없습니다` };
  }

  return { valid: true };
}

export type {
  AccountPerformanceInput,
  AccountPerformanceResult
} from "./accountPerformanceValidation";
export {
  calculateAccountPerformance,
  logAccountPerformance
} from "./accountPerformanceValidation";
