import type { TradeSide } from "../types";
import { canonicalTickerForMatch, isKRWStock } from "./finance";
import { getKrNames } from "../services/dataService";

/** 한국 종목은 krNames 한글명 우선, 그 외는 apiName 그대로 */
export function displayNameForTicker(ticker: string, apiName?: string): string {
  const key = canonicalTickerForMatch(ticker);
  if (!key) return apiName ?? ticker ?? "";
  if (isKRWStock(ticker)) {
    const krName = getKrNames()[key];
    if (krName) return krName;
  }
  return apiName ?? ticker ?? "";
}

export interface TradeFormState {
  id?: string;
  date: string;
  accountId: string;
  ticker: string;
  name: string;
  market?: "KR" | "US" | "CRYPTO";
  exchange?: string;
  side: TradeSide;
  quantity: string;
  price: string;
  fee: string;
  /** 미국 주식용: 단가(원). USD와 원화 둘 다 입력 시 환율 없이 저장 가능 */
  priceKRW: string;
  /** 미국 주식용: 수수료(원) */
  feeKRW: string;
}

/** 기본 거래 폼 상태 팩토리. 매수/오늘/빈 필드. */
export function createDefaultTradeForm(): TradeFormState {
  return {
    id: undefined,
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    ticker: "",
    name: "",
    market: undefined,
    exchange: undefined,
    side: "buy",
    quantity: "",
    price: "",
    fee: "0",
    priceKRW: "",
    feeKRW: "",
  };
}
