// 티커 관련 유틸리티 함수

/**
 * 티커가 USD 종목인지 판단
 * @param ticker 티커 심볼
 * @returns USD 종목이면 true, 아니면 false
 */
export const isUSDStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  const upper = ticker.toUpperCase();
  // 알파벳만 1~6자리이고, 6자리 숫자가 아닌 경우 USD
  return /^[A-Z]{1,6}$/.test(upper) && !/^[0-9]{6}$/.test(upper);
};

/**
 * 티커가 한국 종목인지 판단
 * @param ticker 티커 심볼
 * @returns 한국 종목이면 true, 아니면 false
 */
export const isKRWStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  const upper = ticker.toUpperCase();
  // 6자리 숫자인 경우 한국 종목
  return /^[0-9]{6}$/.test(upper);
};

/**
 * 티커 문자열을 표준화 (대문자, 야후 접미사 제거)
 * @param raw 원본 티커 문자열
 * @returns 표준화된 티커
 */
export const cleanTicker = (raw: string): string => {
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
};

