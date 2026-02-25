// 티커 관련 유틸리티 함수

/**
 * 티커 문자열을 표준화 (대문자, 야후 접미사 제거)
 * @param raw 원본 티커 문자열
 * @returns 표준화된 티커
 */
export const cleanTicker = (raw: string): string => {
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
};

/**
 * 목표/보유 비교용: 한국형 티커(4~5자 영숫자)는 앞을 0으로 채워 6자로 통일
 * "23A0"과 "0023A0"이 같은 종목으로 매칭되도록 함
 */
export const canonicalTickerForMatch = (raw: string): string => {
  const c = cleanTicker((raw || "").trim());
  if (!c) return c;
  if (c.length >= 4 && c.length <= 5 && /^[0-9A-Z]+$/.test(c)) {
    return c.padStart(6, "0");
  }
  return c;
};

/**
 * 티커가 USD 종목인지 판단
 * 규칙: 4자 이하 = 미국(USD), 6자 이상 = 한국(KRW)
 * @param ticker 티커 심볼
 * @returns USD 종목이면 true, 아니면 false
 */
export const isUSDStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  return cleanTicker(ticker).length <= 4;
};

/**
 * 티커가 한국 종목인지 판단
 * 규칙: 6자 이상 = 한국(KRW), 4자 이하 = 미국(USD)
 * @param ticker 티커 심볼
 * @returns 한국 종목이면 true, 아니면 false
 */
export const isKRWStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
};

/** 텍스트에서 티커 추출 (한국 6자리 우선, 없으면 미국 1~10자 영숫자) */
export function extractTickerFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  // 한국 6자리 티커 우선 (예: "TIGER 미국배당다우존스 458730 배당"에서 458730 선택)
  const sixDigit = text.match(/([0-9]{6})/);
  if (sixDigit) return sixDigit[1];
  const m = text.match(/([0-9A-Z]{1,10})/i);
  return m ? m[1] : null;
}
 
