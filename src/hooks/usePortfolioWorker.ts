import { useEffect, useMemo, useRef, useState } from "react";
import { computeAccountBalances, computePositions } from "../calculations";
import type {
  Account,
  AccountBalanceRow,
  LedgerEntry,
  PositionRow,
  StockPrice,
  StockTrade
} from "../types";

interface UsePortfolioWorkerParams {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number | null;
  needsBalances: boolean;
  needsPortfolioAggregation: boolean;
}

interface PortfolioState {
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  isComputing: boolean;
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

function computeSynchronously(params: UsePortfolioWorkerParams): Omit<PortfolioState, "isComputing"> {
  const balances = params.needsBalances
    ? computeAccountBalances(params.accounts, params.ledger, params.trades)
    : [];

  const positions = params.needsPortfolioAggregation
    ? computePositions(
        params.trades,
        adjustPrices(params.prices, params.fxRate),
        params.accounts,
        { fxRate: params.fxRate ?? undefined, priceFallback: "cost" }
      )
    : [];

  return { balances, positions };
}

export function usePortfolioWorker(params: UsePortfolioWorkerParams): PortfolioState {
  const supportsWorker = typeof Worker !== "undefined";
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRequestRef = useRef(0);
  /** 우리가 보낸 request id 중 가장 큰 값. 응답이 이 값과 다르면 stale로 간주 */
  const latestPostedRequestRef = useRef(0);

  const syncResult = useMemo(() => {
    if (supportsWorker) return null;
    return computeSynchronously(params);
  }, [supportsWorker, params]);

  const [state, setState] = useState<PortfolioState>(() => {
    if (syncResult) {
      return { ...syncResult, isComputing: false };
    }
    return { balances: [], positions: [], isComputing: false };
  });

  useEffect(() => {
    if (!supportsWorker) {
      if (!syncResult) return;
      setState({
        balances: syncResult.balances,
        positions: syncResult.positions,
        isComputing: false
      });
      return;
    }

    const worker = new Worker(new URL("../workers/portfolioWorker.ts", import.meta.url), {
      type: "module"
    });

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<{
      requestId: number;
      balances: AccountBalanceRow[];
      positions: PositionRow[];
      error?: string;
    }>) => {
      const { requestId, balances, positions, error } = event.data;
      // 더 최신 요청을 이미 처리했거나, 우리가 가장 최근 보낸 요청이 아니면 폐기 (stale)
      if (requestId < latestHandledRequestRef.current) return;
      if (requestId !== latestPostedRequestRef.current) return;
      latestHandledRequestRef.current = requestId;
      if (error) {
        console.warn("[usePortfolioWorker] worker failed, keeping previous value", error);
        setState((prev) => ({ ...prev, isComputing: false }));
        return;
      }
      setState({
        balances,
        positions,
        isComputing: false
      });
    };

    worker.onerror = (event) => {
      console.warn("[usePortfolioWorker] worker error", event.message);
      setState((prev) => ({ ...prev, isComputing: false }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [supportsWorker, syncResult]);

  useEffect(() => {
    if (!supportsWorker) return;
    const worker = workerRef.current;
    if (!worker) return;

    const requestId = ++requestIdRef.current;
    latestPostedRequestRef.current = requestId;
    setState((prev) => ({ ...prev, isComputing: true }));

    worker.postMessage({
      requestId,
      payload: {
        accounts: params.accounts,
        ledger: params.ledger,
        trades: params.trades,
        prices: params.prices,
        fxRate: params.fxRate,
        needsBalances: params.needsBalances,
        needsPortfolioAggregation: params.needsPortfolioAggregation
      }
    });
  }, [
    supportsWorker,
    params.accounts,
    params.ledger,
    params.trades,
    params.prices,
    params.fxRate,
    params.needsBalances,
    params.needsPortfolioAggregation
  ]);

  return state;
}
