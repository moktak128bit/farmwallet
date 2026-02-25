// Finance/ticker utility helpers.

export const cleanTicker = (raw: string): string => {
  return raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
};

export const canonicalTickerForMatch = (raw: string): string => {
  const c = cleanTicker((raw || "").trim());
  if (!c) return c;
  if (c.length >= 4 && c.length <= 5 && /^[0-9A-Z]+$/.test(c)) {
    return c.padStart(6, "0");
  }
  return c;
};

export const isUSDStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  return cleanTicker(ticker).length <= 4;
};

export const isKRWStock = (ticker?: string): boolean => {
  if (!ticker) return false;
  return cleanTicker(ticker).length >= 6;
};

export function extractTickerFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const sixDigit = text.match(/([0-9]{6})/);
  if (sixDigit) return sixDigit[1];
  const m = text.match(/([0-9A-Z]{1,10})/i);
  return m ? m[1] : null;
}

export const TickerUtils = {
  cleanTicker,
  canonicalTickerForMatch,
  isUSDStock,
  isKRWStock,
  extractTickerFromText
};
