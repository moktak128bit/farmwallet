/// <reference lib="webworker" />

import { computeAccountBalances, computePositions } from "../calculations";
import type {
  Account,
  AccountBalanceRow,
  LedgerEntry,
  PositionRow,
  StockPrice,
  StockTrade
} from "../types";

interface PortfolioWorkerPayload {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number | null;
  needsBalances: boolean;
  needsPortfolioAggregation: boolean;
}

interface PortfolioWorkerRequest {
  requestId: number;
  payload: PortfolioWorkerPayload;
}

interface PortfolioWorkerResponse {
  requestId: number;
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  error?: string;
}

function adjustPrices(prices: StockPrice[], fxRate: number | null): StockPrice[] {
  if (!fxRate) return prices;
  return prices.map((price) => {
    if (price.currency === "USD") {
      return {
        ...price,
        price: price.price * fxRate,
        currency: "KRW"
      };
    }
    return price;
  });
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<PortfolioWorkerRequest>) => {
  const { requestId, payload } = event.data;

  try {
    const balances = payload.needsBalances
      ? computeAccountBalances(payload.accounts, payload.ledger, payload.trades)
      : [];

    const positions = payload.needsPortfolioAggregation
      ? computePositions(
          payload.trades,
          adjustPrices(payload.prices, payload.fxRate),
          payload.accounts,
          { fxRate: payload.fxRate ?? undefined }
        )
      : [];

    const response: PortfolioWorkerResponse = {
      requestId,
      balances,
      positions
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: PortfolioWorkerResponse = {
      requestId,
      balances: [],
      positions: [],
      error: error instanceof Error ? error.message : String(error)
    };
    workerScope.postMessage(response);
  }
};

export {};
