import React, { lazy, Suspense, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Autocomplete, type AutocompleteOption } from "../components/ui/Autocomplete";
import { StockDetailModal } from "../components/StockDetailModal";
import { FxFormSection } from "../features/stocks/FxFormSection";
import { FxHistorySection } from "../features/stocks/FxHistorySection";
import { StockStatsCard } from "../features/stocks/StockStatsCard";
import { PresetSection } from "../features/stocks/PresetSection";
import { TradeHistorySection } from "../features/stocks/TradeHistorySection";
import { PositionListSection } from "../features/stocks/PositionListSection";
import { ChartSkeleton } from "../components/charts/ChartSkeleton";

const LazyPortfolioChartsSection = lazy(() =>
  import("../features/stocks/PortfolioChartsSection").then((m) => ({ default: m.PortfolioChartsSection }))
);
const LazyTargetPortfolioSection = lazy(() =>
  import("../features/stocks/TargetPortfolioSection").then((m) => ({ default: m.TargetPortfolioSection }))
);
import type { Account, StockPrice, StockTrade, TradeSide, SymbolInfo, TickerInfo, StockPreset, LedgerEntry, TargetPortfolio, AccountBalanceRow, HistoricalDailyClose } from "../types";
import { computePositions } from "../calculations";
import { fetchYahooQuotes, fetchTickersFromFile, searchYahooSymbol, type YahooQuoteResult } from "../yahooFinanceApi";
import { fetchCryptoQuotes } from "../coinGeckoApi";
import { saveTickerToJson } from "../storage";
import { formatNumber, formatKRW, formatUSD, formatShortDate } from "../utils/formatter";
import {
  isUSDStock,
  isKRWStock,
  isCryptoStock,
  canonicalTickerForMatch,
  getUniqueTickersFromTrades
} from "../utils/finance";
import { shouldUseUsdBalanceMode as shouldUseUsdBalanceModeUtil, computeTradeCashImpact } from "../utils/tradeCashImpact";
import { getKrNames } from "../storage";
import { toast } from "react-hot-toast";
import { validateDate, validateTicker, validateRequired, validateQuantity, validateAmount, validateAccountTickerCurrency } from "../utils/validation";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { displayNameForTicker, createDefaultTradeForm } from "../utils/stockHelpers";
import { usePriceAutoRefresh } from "../hooks/usePriceAutoRefresh";

/** 환율 미로드 시 미국 주식 저장에 사용하는 기본 환율 (저장 차단 대신 사용) */
const DEFAULT_FX_RATE = 1400;

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  trades: StockTrade[];
  prices: StockPrice[];
  customSymbols: SymbolInfo[];
  tickerDatabase: TickerInfo[];
  historicalDailyCloses?: HistoricalDailyClose[];
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeCustomSymbols: (next: SymbolInfo[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[] | ((prev: TickerInfo[]) => TickerInfo[])) => void;
  onLoadInitialTickers: () => Promise<void>;
  isLoadingTickerDatabase: boolean;
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
  presets?: StockPreset[];
  onChangePresets?: (next: StockPreset[]) => void;
  ledger?: LedgerEntry[];
  onChangeLedger?: (next: LedgerEntry[]) => void;
  onChangeAccounts?: (next: Account[]) => void;
  fxRate?: number | null;
  targetPortfolios?: TargetPortfolio[];
  onChangeTargetPortfolios?: (next: TargetPortfolio[]) => void;
  highlightTradeId?: string | null;
  onClearHighlightTrade?: () => void;
}

const sideLabel: Record<TradeSide, string> = {
  buy: "매수",
  sell: "매도"
};


type PositionSortKey =
  | "ticker"
  | "name"
  | "quantity"
  | "avgPrice"
  | "marketPrice"
  | "diff"
  | "marketValue"
  | "totalBuyAmount"
  | "pnl"
  | "pnlRate";

type TradeSortKey =
  | "date"
  | "accountId"
  | "ticker"
  | "name"
  | "side"
  | "quantity"
  | "price"
  | "fee"
  | "totalAmount"
  | "cashImpact";


export const StocksView: React.FC<Props> = ({
  accounts,
  balances,
  trades,
  prices,
  customSymbols,
  tickerDatabase,
  historicalDailyCloses = [],
  onChangeTrades,
  onChangePrices,
  onChangeCustomSymbols,
  onChangeTickerDatabase,
  onLoadInitialTickers,
  isLoadingTickerDatabase,
  onLog,
  presets = [],
  onChangePresets,
  ledger = [],
  onChangeLedger,
  onChangeAccounts,
  fxRate: propFxRate = null,
  targetPortfolios = [],
  onChangeTargetPortfolios,
  highlightTradeId,
  onClearHighlightTrade
}) => {
  const [tradeForm, setTradeForm] = useState(createDefaultTradeForm);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  /** 에러 시 「다시 시도」에 사용 */
  const lastQuoteRefreshModeRef = useRef<"holdings" | "full" | null>(null);
  const [quoteRefreshProgress, setQuoteRefreshProgress] = useState({ current: 0, total: 1 });
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [yahooUpdatedAt, setYahooUpdatedAt] = useState<string | null>(null);
  const [accountOrder, setAccountOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("fw-account-order");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [fxRate, setFxRate] = useState<number | null>(propFxRate);
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(null);

  // props에서 전달받은 환율 업데이트
  useEffect(() => {
    if (propFxRate !== null) {
      setFxRate(propFxRate);
    }
  }, [propFxRate]);
  // 탭 관리
  const [activeTab, setActiveTab] = useState<"stocks" | "portfolio" | "fx">("stocks");
  const [activeQuoteMarket, setActiveQuoteMarket] = useState<"korea" | "us">("korea");
  const [recentTickers, setRecentTickers] = useState<Array<{ ticker: string; name?: string }>>([]);
  const [favoriteTickers, setFavoriteTickers] = useState<Array<{ ticker: string; name?: string }>>([]);
  const [symbolForm, setSymbolForm] = useState<{ ticker: string; name: string }>({ ticker: "", name: "" });
  const [isUpdatingLibrary, setIsUpdatingLibrary] = useState(false);
  const [dcaForm, setDcaForm] = useState<{ accountId: string; ticker: string; amount: string }>({
    accountId: "",
    ticker: "",
    amount: ""
  });
  const [isLoadingDca, setIsLoadingDca] = useState(false);
  const [dcaMessage, setDcaMessage] = useState<string | null>(null);
  const [buyingPlanId, setBuyingPlanId] = useState<string | null>(null);
  const [isBuyingAll, setIsBuyingAll] = useState(false);
  const [tickerSuggestions, setTickerSuggestions] = useState<TickerInfo[]>([]);
  // showTickerSuggestions 상태 제거 (Autocomplete 내부에서 처리)
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: "asc" | "desc" }>({
    key: "ticker",
    direction: "asc"
  });
  const [dcaPlans, setDcaPlans] = useState<
    Array<{
      id: string;
      accountId: string;
      ticker: string;
      amount: number;
      fee?: number;
      startDate: string;
      lastRunDate?: string;
      active: boolean;
    }>
  >([]);
  const [tickerInfo, setTickerInfo] = useState<{
    ticker: string;
    name?: string;
    price?: number;
    currency?: string;
  } | null>(null);
  const [quoteSearchTicker, setQuoteSearchTicker] = useState("");
  const [quoteSearchSuggestions, setQuoteSearchSuggestions] = useState<TickerInfo[]>([]);
  // showQuoteSearchSuggestions 상태 제거 (Autocomplete 내부에서 처리)
  const [isSearchingQuote, setIsSearchingQuote] = useState(false);
  const [isSearchingTradeFormQuote, setIsSearchingTradeFormQuote] = useState(false);
  const [quickFilter, setQuickFilter] = useState<"pnl" | "volatility" | "sector">("pnl");
  const [simpleSearch, setSimpleSearch] = useState("");
  const [justUpdatedTickers, setJustUpdatedTickers] = useState<string[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<PositionWithPrice | null>(null);

  // 티커 검색 함수
  const searchTickers = useCallback((query: string): TickerInfo[] => {
    if (!query || query.length < 1) return [];
    const q = query.trim().toUpperCase();
    
    return tickerDatabase.filter(t => 
      t.ticker.toUpperCase().includes(q) || 
      t.name.toUpperCase().includes(q)
    ).slice(0, 15); // 상위 15개만 표시
  }, [tickerDatabase]);

  // 티커 입력 시 자동완성
  useEffect(() => {
    if (tradeForm.ticker.length >= 1) {
      const results = searchTickers(tradeForm.ticker);
      setTickerSuggestions(results);
    } else {
      setTickerSuggestions([]);
    }
  }, [tradeForm.ticker, searchTickers]);

  // 시세 검색용 티커 입력 시 자동완성
  useEffect(() => {
    if (quoteSearchTicker.length >= 1) {
      const results = searchTickers(quoteSearchTicker);
      setQuoteSearchSuggestions(results);
    } else {
      setQuoteSearchSuggestions([]);
    }
  }, [quoteSearchTicker, searchTickers]);

  // 거래 입력 폼의 티커 입력 시 자동으로 시세 조회
  useEffect(() => {
    const symbol = canonicalTickerForMatch(tradeForm.ticker.trim());
    if (!symbol || symbol.length < 2) {
      return;
    }

    // debounce: 500ms 후에 시세 조회
    const timer = setTimeout(async () => {
      // 제안 목록이 비어있을 때만 자동 조회 (사용자가 타이핑 중이 아닐 때)
      if (tickerSuggestions.length > 0) return; 
      
      setIsSearchingTradeFormQuote(true);
      try {
        const exchangeMap =
          tradeForm.exchange && (tradeForm.exchange === "KOSPI" || tradeForm.exchange === "KOSDAQ")
            ? { [symbol]: tradeForm.exchange }
            : undefined;
        const results = await fetchYahooQuotes([symbol], { exchangeMap });
        if (results.length > 0) {
          const r = results[0];
          const stockName = r.name ||
            tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === symbol)?.name ||
            tradeForm.name ||
            symbol;
          setTickerInfo({
            ticker: symbol,
            name: stockName,
            price: r.price,
            currency: r.currency
          });
          setTradeForm((prev) => ({ ...prev, name: prev.name || stockName }));
          if (r.name) {
            const market = tradeForm.market ?? (isKRWStock(symbol) ? "KR" : "US");
            if (market !== "CRYPTO") await saveTickerToJson(symbol, r.name, market);
          }
        }
      } catch (err) {
        console.warn("거래 입력 폼 시세 자동 조회 실패:", err);
      } finally {
        setIsSearchingTradeFormQuote(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [tradeForm.ticker, tradeForm.exchange, tradeForm.market, tradeForm.name, tickerSuggestions.length, tickerDatabase]);

  const positions = useMemo(
    () =>
      computePositions(trades, prices, accounts, {
        fxRate: fxRate ?? undefined
      }),
    [trades, prices, accounts, fxRate]
  );

  // canonical 티커별 최신 시세 (updatedAt 기준) — 평가금/일일손익이 항상 최신 시세 반영되도록
  const latestPriceByCanonicalTicker = useMemo(() => {
    const map = new Map<string, StockPrice>();
    for (const price of prices) {
      const key = canonicalTickerForMatch(price.ticker);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, price);
        continue;
      }
      const prevUpdated = prev.updatedAt ?? "";
      const nextUpdated = price.updatedAt ?? "";
      if (nextUpdated >= prevUpdated) {
        map.set(key, price);
      }
    }
    return map;
  }, [prices]);

  type PositionWithPrice = ReturnType<typeof computePositions>[number] & {
    displayMarketPrice: number;
    originalMarketPrice?: number; // USD 원본 가격 (표시용)
    currency?: string;
    diff: number;
    sector?: string;
    industry?: string;
  };

  const positionsWithPrice = useMemo<PositionWithPrice[]>(() => {
    return positions.map((p) => {
      const pNorm = canonicalTickerForMatch(p.ticker);
      const originalPriceInfo = latestPriceByCanonicalTicker.get(pNorm);
      const currency = originalPriceInfo?.currency || (isUSDStock(p.ticker) ? "USD" : "KRW");
      const isUSD = currency === "USD";
      const displayMarketPrice = isUSD
        ? (originalPriceInfo?.price ?? p.marketPrice)
        : (originalPriceInfo?.price ?? p.marketPrice);
      const originalMarketPrice = isUSD ? originalPriceInfo?.price : undefined;

      // 종목명: tickerDatabase 정식명 우선 (거래/시세에 잘못 저장된 이름 방지, 예: BITX→BIT)
      const dbEntry = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === pNorm);
      const displayName = dbEntry?.name ?? p.name ?? p.ticker;

      // 평가금액/손익 계산 (USD 종목은 USD 기준, KRW 종목은 KRW 기준)
      const marketValue = displayMarketPrice * p.quantity;
      const pnl = marketValue - p.totalBuyAmount;
      const pnlRate = p.totalBuyAmount > 0 ? pnl / p.totalBuyAmount : 0;
      // 단가와 현재가 차이
      const diff = displayMarketPrice - Math.round(p.avgPrice);

      return {
        ...p,
        name: displayName,
        displayMarketPrice,
        originalMarketPrice,
        currency,
        marketValue,
        pnl,
        pnlRate,
        diff,
        sector: originalPriceInfo?.sector,
        industry: originalPriceInfo?.industry
      };
    });
  }, [positions, latestPriceByCanonicalTicker, tickerDatabase]);

  const totals = useMemo(() => {
    const rate = fxRate ?? 0;
    const toKRW = (p: PositionWithPrice, val: number) =>
      (p.currency === "USD" || isUSDStock(p.ticker)) && rate ? val * rate : val;
    const totalMarketValueKRW = positionsWithPrice.reduce(
      (sum, p) => sum + toKRW(p, p.marketValue),
      0
    );
    const totalMarketValueUSD = rate > 0 ? totalMarketValueKRW / rate : 0;
    const totalCost = positionsWithPrice.reduce((sum, p) => {
      const costKRW =
        p.currency === "USD" && p.totalBuyAmountKRW != null
          ? p.totalBuyAmountKRW
          : toKRW(p, p.totalBuyAmount);
      return sum + costKRW;
    }, 0);
    const totalPnl = positionsWithPrice.reduce((sum, p) => {
      const costKRW =
        p.currency === "USD" && p.totalBuyAmountKRW != null
          ? p.totalBuyAmountKRW
          : toKRW(p, p.totalBuyAmount);
      return sum + (toKRW(p, p.marketValue) - costKRW);
    }, 0);
    const dayPnl = positionsWithPrice.reduce((sum, p) => {
      const priceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(p.ticker));
      const change = priceInfo?.change ?? 0;
      const dayPnlPos = change * p.quantity;
      return sum + toKRW(p, dayPnlPos);
    }, 0);
    return {
      totalMarketValue: totalMarketValueKRW,
      totalMarketValueUSD: totalMarketValueUSD,
      totalCost,
      totalPnl,
      dayPnl
    };
  }, [positionsWithPrice, latestPriceByCanonicalTicker, fxRate]);

  const getPriceInfoForDca = useCallback(
    (ticker: string) => {
      const symbol = canonicalTickerForMatch(ticker);
      const original = latestPriceByCanonicalTicker.get(symbol ?? "");
      const priceKRW =
        original?.price != null
          ? original.currency === "USD" && fxRate ? original.price * fxRate : original.price
          : 0;
      const name =
        (original?.name ||
          trades.find((t) => canonicalTickerForMatch(t.ticker) === symbol)?.name ||
          symbol) ?? "";
      return {
        priceKRW,
        name,
        currency: original?.currency,
        originalPrice: original?.price ?? 0
      };
    },
    [latestPriceByCanonicalTicker, fxRate, trades]
  );

  const dcaCalc = useMemo(() => {
    try {
      const amount = Number(dcaForm.amount);
      const symbol = canonicalTickerForMatch(dcaForm.ticker.trim());
      if (!amount || amount <= 0 || !symbol) return null;
      const info = getPriceInfoForDca(symbol);
      const price = info.priceKRW;
      const market = getMarketStatus(symbol, info.currency);
      if (!price || price <= 0) {
        return { symbol, ...info, price: 0, amount, shares: 0, estimatedCost: 0, remainder: amount, market };
      }
      const shares = amount / price;
      const estimatedCost = shares * price;
      const remainder = amount - estimatedCost;
      return {
        symbol,
        ...info,
        price,
        amount,
        shares,
        estimatedCost,
        remainder,
        market
      };
    } catch (err) {
      console.error("DCA 계산 오류:", err);
      return null;
    }
  }, [dcaForm, getPriceInfoForDca]);

  const persistDcaPlans = (next: typeof dcaPlans) => {
    setDcaPlans(next);
    try {
      localStorage.setItem("fw-dca-plans", JSON.stringify(next));
    } catch {
      //
    }
  };

  const toggleDcaPlan = (id: string) => {
    const next = dcaPlans.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
    persistDcaPlans(next);
  };

  const deleteDcaPlan = (id: string) => {
    const next = dcaPlans.filter((p) => p.id !== id);
    persistDcaPlans(next);
  };

  const topHoldings = useMemo(
    () => [...positionsWithPrice].sort((a, b) => b.marketValue - a.marketValue).slice(0, 3),
    [positionsWithPrice]
  );

  const getVolatilityScore = (ticker: string) => {
    const priceInfo = prices.find((p) => p.ticker === ticker);
    return Math.abs(priceInfo?.changePercent ?? 0);
  };

  const filteredPositions = useMemo(() => {
    const q = simpleSearch.trim().toLowerCase();
    const sorted = [...positionsWithPrice].sort((a, b) => {
      if (quickFilter === "pnl") return b.pnlRate - a.pnlRate;
      if (quickFilter === "volatility") return getVolatilityScore(b.ticker) - getVolatilityScore(a.ticker);
      return String(a.currency ?? "").localeCompare(String(b.currency ?? "")) || a.ticker.localeCompare(b.ticker);
    });
    const filtered = q
      ? sorted.filter((p) => {
          const name = (p.name || "").toLowerCase();
          return p.ticker.toLowerCase().includes(q) || name.includes(q);
        })
      : sorted;
    return filtered.slice(0, 8);
  }, [positionsWithPrice, quickFilter, simpleSearch, prices]);

  const totalReturnRate = useMemo(
    () => (totals.totalCost ? totals.totalPnl / totals.totalCost : 0),
    [totals]
  );

  const totalDividend = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" &&
      ((l.category ?? "").includes("배당") ||
        (l.subCategory ?? "").includes("배당") ||
        (l.description ?? "").includes("배당"));
    const toKrw = (l: LedgerEntry) =>
      l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount;
    return ledger.filter(isDividend).reduce((s, l) => s + toKrw(l), 0);
  }, [ledger, fxRate]);

  type PositionSortKey =
    | "ticker"
    | "name"
    | "quantity"
    | "avgPrice"
    | "marketPrice"
    | "diff"
    | "marketValue"
    | "totalBuyAmount"
    | "pnl"
    | "pnlRate";

  type TradeSortKey =
    | "date"
    | "accountId"
    | "ticker"
    | "name"
    | "side"
    | "quantity"
    | "price"
    | "fee"
    | "totalAmount"
    | "cashImpact";

  const sortPositions = (rows: PositionWithPrice[]) => {
    const dir = positionSort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const key = positionSort.key;
      const va = (a as any)[key] ?? 0;
      const vb = (b as any)[key] ?? 0;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return (va - vb) * dir;
    });
  };

  const togglePositionSort = (key: PositionSortKey) => {
    setPositionSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
    if (activeKey !== key) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };

  const updateFxRate = async () => {
    try {
      const res = await fetchYahooQuotes(["USDKRW=X"]);
      const r = res[0];
      if (r?.price) {
        setFxRate(r.price);
        setFxUpdatedAt(r.updatedAt ?? new Date().toISOString());
      }
    } catch (err) {
      console.warn("환율 조회 실패", err);
    }
  };

  // (removed) "기존 달러 거래 cashImpact 원화 재계산" 자동 effect.
  // 현재 환율(fxRate)로 과거 거래를 재계산해 사용자의 역사적 환율 기록(fxRateAtTrade)을
  // 덮어쓰던 코드. 새 거래는 submitTradeFromForm에서 올바른 cashImpact를 직접 저장.

  React.useEffect(() => {
    updateFxRate().catch((err) => {
      console.warn("환율 갱신 실패:", err);
    });
    try {
      const recentRaw = localStorage.getItem("fw-recent-tickers");
      if (recentRaw) setRecentTickers(JSON.parse(recentRaw));
      const favRaw = localStorage.getItem("fw-fav-tickers");
      if (favRaw) setFavoriteTickers(JSON.parse(favRaw));
      const plansRaw = localStorage.getItem("fw-dca-plans");
      if (plansRaw) {
        const parsed = JSON.parse(plansRaw) as typeof dcaPlans;
        setDcaPlans(parsed);
      }
    } catch {
      // ignore
    }
  }, []);


  const formatPriceWithCurrency = (value: number, currency?: string, ticker?: string) => {
    // 티커 형식으로 통화 판단
    const isUSD = currency === "USD" || (ticker ? isUSDStock(ticker) : false);
    
    if (isUSD) {
      return formatUSD(value);
    }
    // 한국 종목은 원화로 표시
    return formatKRW(value);
  };

  const getMarketStatus = (ticker: string, currency?: string) => {
    const isKorea = ticker ? isKRWStock(ticker) : (currency === "KRW");
    const zone = isKorea ? "Asia/Seoul" : "America/New_York";
    const label = isKorea ? "한국장" : "미국장";
    const now = new Date();
    const zoned = new Date(now.toLocaleString("en-US", { timeZone: zone }));
    const day = zoned.getDay(); // 0=일,6=토
    const hour = zoned.getHours();
    const minute = zoned.getMinutes();
    const isWeekend = day === 0 || day === 6;
    let isOpen = false;
    if (!isWeekend) {
      if (isKorea) {
        // 09:00~15:30 KST
        isOpen = (hour > 9 || (hour === 9 && minute >= 0)) && (hour < 15 || (hour === 15 && minute <= 30));
      } else {
        // 09:30~16:00 ET
        isOpen =
          (hour > 9 || (hour === 9 && minute >= 30)) &&
          (hour < 16);
      }
    }
    const session = isKorea ? "09:00~15:30 KST" : "09:30~16:00 ET";
    return { isOpen, label: `${label} ${isOpen ? "개장" : "폐장"}`, session };
  };

  // 시세 갱신 대상: 거래 내역(trades)에 실제로 등장한 티커만 (중복 제거·정규화)
  const uniqueTickers = useMemo(() => getUniqueTickersFromTrades(trades), [trades]);

  /** tickerDatabase의 market=CRYPTO 우선, 없으면 티커 문자열 휴리스틱 */
  const uniqueStockTickers = useMemo(() => {
    const dbByKey = new Map(tickerDatabase.map((x) => [canonicalTickerForMatch(x.ticker), x]));
    const isHoldingsCrypto = (t: string) => {
      const db = dbByKey.get(canonicalTickerForMatch(t));
      if (db?.market === "CRYPTO") return true;
      return isCryptoStock(t);
    };
    return uniqueTickers.filter((t) => !isHoldingsCrypto(t)).map((t) => t.toUpperCase());
  }, [uniqueTickers, tickerDatabase]);
  const uniqueCryptoTickers = useMemo(() => {
    const dbByKey = new Map(tickerDatabase.map((x) => [canonicalTickerForMatch(x.ticker), x]));
    const isHoldingsCrypto = (t: string) => {
      const db = dbByKey.get(canonicalTickerForMatch(t));
      if (db?.market === "CRYPTO") return true;
      return isCryptoStock(t);
    };
    return uniqueTickers.filter((t) => isHoldingsCrypto(t)).map((t) => t.toLowerCase());
  }, [uniqueTickers, tickerDatabase]);

  const koreanQuotes = useMemo(
    () => prices.filter((p) => p.currency === "KRW" && !isCryptoStock(p.ticker)),
    [prices]
  );
  const usQuotes = useMemo(() => prices.filter((p) => p.currency === "USD"), [prices]);
  const cryptoQuotes = useMemo(() => prices.filter((p) => isCryptoStock(p.ticker)), [prices]);

  const renderQuoteTable = (items: StockPrice[], marketLabel: string) => (
    <table className="data-table">
      <colgroup>
        <col style={{ width: "12%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "18%" }} />
      </colgroup>
      <thead>
        <tr>
          <th>티커</th>
          <th>종목명</th>
          <th>현재가</th>
          <th>변동</th>
          <th>변동률</th>
          <th>업데이트</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={6} style={{ textAlign: "center" }}>
              {marketLabel} 시세가 없습니다. 티커를 등록하고 시세 갱신 버튼을 눌러보세요.
            </td>
          </tr>
        ) : (
          items.map((item) => {
            const changeClass =
              item.change == null ? "" : item.change >= 0 ? "positive" : "negative";
            const changePercentClass =
              item.changePercent == null ? "" : item.changePercent >= 0 ? "positive" : "negative";
            return (
              <tr key={item.ticker}>
                <td>{item.ticker}</td>
                <td>{item.name ?? "-"}</td>
                <td className="number">{formatPriceWithCurrency(item.price ?? 0, item.currency, item.ticker)}</td>
                <td className={`number ${changeClass}`}>
                  {item.change != null ? formatPriceWithCurrency(item.change, item.currency, item.ticker) : "-"}
                </td>
                <td className={`number ${changePercentClass}`}>
                  {item.changePercent != null ? `${item.changePercent.toFixed(2)}%` : "-"}
                </td>
                <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("ko-KR") : "-"}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const mergeQuoteResultsIntoPrices = useCallback(
    (
      currentPrices: StockPrice[],
      results: StockPrice[],
      opts?: { persistToTickerJson?: boolean }
    ): StockPrice[] => {
      const persistToTickerJson = opts?.persistToTickerJson !== false;
      const next: StockPrice[] = [...currentPrices];
      for (const r of results) {
        if (r.ticker === "USDKRW=X") continue;
        const rKey = canonicalTickerForMatch(r.ticker);
        const displayName = displayNameForTicker(
          r.ticker,
          r.name ??
            next.find((p) => canonicalTickerForMatch(p.ticker) === rKey)?.name ??
            trades.find((t) => canonicalTickerForMatch(t.ticker) === rKey)?.name ??
            undefined
        );
        const nameToSave = displayName || r.name || r.ticker;
        if (persistToTickerJson && nameToSave && !isCryptoStock(r.ticker)) {
          const market = isKRWStock(r.ticker) ? "KR" : "US";
          void saveTickerToJson(r.ticker, nameToSave, market);
        }
        const idx = next.findIndex((p) => canonicalTickerForMatch(p.ticker) === rKey);
        const existingName =
          next[idx]?.name ?? trades.find((t) => canonicalTickerForMatch(t.ticker) === rKey)?.name;
        const item: StockPrice = {
          ticker: r.ticker,
          name: displayName || existingName || r.ticker,
          price: r.price,
          currency: r.currency,
          change: r.change,
          changePercent: r.changePercent,
          updatedAt: r.updatedAt,
          sector: r.sector,
          industry: r.industry
        };
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...item };
        } else {
          next.push(item);
        }
      }
      return next;
    },
    [trades]
  );

  const runQuoteRefresh = useCallback(
    async (params: {
      mode: "holdings" | "full";
      stockTickers: string[];
      cryptoTickers: string[];
      updateTickerDatabase: boolean;
      persistToTickerJson: boolean;
      logLabel: string;
    }) => {
      const {
        mode,
        stockTickers: uniqueStockTickers,
        cryptoTickers: uniqueCryptoTickers,
        updateTickerDatabase,
        persistToTickerJson,
        logLabel
      } = params;

      const totalSymbols = uniqueStockTickers.length + uniqueCryptoTickers.length;
      if (totalSymbols === 0) {
        const msg =
          mode === "holdings"
            ? "거래 내역에 등록된 티커가 없습니다. 먼저 거래를 추가하세요."
            : "ticker.json에서 불러온 종목이 없습니다. 개발 서버(npm run dev)에서 시도하세요.";
        setQuoteError(msg);
        onLog?.(`${logLabel}: ${msg}`, "error");
        return;
      }

      onLog?.(`${logLabel} 시작...`, "info");
      try {
        setIsLoadingQuotes(true);
        setQuoteError(null);
        void updateFxRate();
        setQuoteRefreshProgress({ current: 0, total: Math.max(1, totalSymbols) });
        onLog?.(`[시작] ${logLabel} — ${totalSymbols}개 티커`, "info");

        const allResults: StockPrice[] = [];
        let failedTickers: string[] = [];

        const exchangeMap: Record<string, string> = {};
        for (const t of tickerDatabase) {
          const key = canonicalTickerForMatch(t.ticker);
          if (key && (t.exchange === "KOSPI" || t.exchange === "KOSDAQ")) exchangeMap[key] = t.exchange;
        }
        const exchangeMapOpt = Object.keys(exchangeMap).length ? exchangeMap : undefined;

        if (uniqueStockTickers.length > 0) {
          const onStockProgress = (done: number) =>
            setQuoteRefreshProgress((p) => ({ ...p, current: done }));
          onLog?.(`[${logLabel}] 배치 요청 중… (미국/기타 + 한국 티커 묶음 처리)`, "info");
          const batchStartAt = Date.now();
          let stockResults = await fetchYahooQuotes(uniqueStockTickers, {
            onProgress: (done, total, ticker, status) => {
              onStockProgress(done);
              if (ticker != null && status != null) {
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                onLog?.(`[${logLabel}] [${done}/${total} - ${percent}%] ${ticker} : ${status}`, "info");
              }
            },
            exchangeMap: exchangeMapOpt,
            onBatchPhase: (phase) => {
              const elapsed = ((Date.now() - batchStartAt) / 1000).toFixed(1);
              onLog?.(`[${logLabel}] ${phase} (${elapsed}s)`, "info");
            }
          });
          let successStock = new Set(
            stockResults
              .filter((r) => r.ticker !== "USDKRW=X" && r.price != null && Number.isFinite(r.price))
              .map((r) => r.ticker)
          );
          let failedStock = uniqueStockTickers.filter((t) => !successStock.has(t));
          const maxRetries = 3;
          for (let attempt = 1; attempt < maxRetries && failedStock.length > 0; attempt++) {
            onLog?.(`[${logLabel}] [재시도 ${attempt}/${maxRetries - 1}] 실패 ${failedStock.length}종목...`, "info");
            await new Promise((r) => setTimeout(r, 2000));
            const retryResults = await fetchYahooQuotes(failedStock, {
              onProgress: (done, total, ticker, status) => {
                onStockProgress(uniqueStockTickers.length - failedStock.length + done);
                if (ticker != null && status != null) {
                  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                  onLog?.(`[${logLabel}] [재시도 ${done}/${total} - ${percent}%] ${ticker} : ${status}`, "info");
                }
              },
              exchangeMap: exchangeMapOpt
            });
            const retrySuccess = new Set(
              retryResults.filter((r) => r.price != null && Number.isFinite(r.price)).map((r) => r.ticker)
            );
            failedStock = failedStock.filter((t) => !retrySuccess.has(t));
            stockResults = [...stockResults, ...retryResults];
            successStock = new Set(
              stockResults.filter((r) => r.ticker !== "USDKRW=X" && r.price != null).map((r) => r.ticker)
            );
          }
          setQuoteRefreshProgress((p) => ({ ...p, current: uniqueStockTickers.length }));
          allResults.push(...stockResults.filter((r) => r.ticker !== "USDKRW=X"));
          failedTickers.push(...failedStock);
        }

        if (uniqueCryptoTickers.length > 0) {
          const cryptoResults = await fetchCryptoQuotes(uniqueCryptoTickers, fxRate ?? undefined);
          const cryptoAsStockPrice: StockPrice[] = cryptoResults.map((c) => ({
            ticker: c.ticker,
            name: c.symbol,
            price: c.priceKrw,
            currency: "KRW" as const,
            changePercent: c.changePercent24h,
            updatedAt: c.updatedAt
          }));
          const successCrypto = new Set(cryptoResults.map((c) => c.ticker));
          const failedCrypto = uniqueCryptoTickers.filter((t) => !successCrypto.has(t));
          allResults.push(...cryptoAsStockPrice);
          failedTickers.push(...failedCrypto);
          setQuoteRefreshProgress((p) => ({ ...p, current: p.total }));
        }

        if (allResults.length === 0) {
          setQuoteError("시세를 가져오지 못했습니다. 잠시 후 다시 시도하세요.");
          onLog?.(`${logLabel}: 시세를 가져오지 못했습니다.`, "error");
          return;
        }

        const next = mergeQuoteResultsIntoPrices(prices, allResults, { persistToTickerJson });
        onChangePrices(next);

        if (updateTickerDatabase) {
          onChangeTickerDatabase((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const byKey = new Map(list.map((t) => [canonicalTickerForMatch(t.ticker), t]));
            for (const r of allResults) {
              if (r.ticker === "USDKRW=X") continue;
              const key = canonicalTickerForMatch(r.ticker);
              const name = displayNameForTicker(r.ticker, r.name ?? undefined) || r.name || r.ticker;
              const existing = byKey.get(key);
              byKey.set(key, {
                ticker: key,
                name: name || existing?.name || key,
                market: existing?.market ?? (isCryptoStock(r.ticker) ? "CRYPTO" : isKRWStock(r.ticker) ? "KR" : "US"),
                exchange: existing?.exchange
              });
            }
            return Array.from(byKey.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
          });
        }

        const latestUpdatedAt =
          allResults
            .map((r) => r.updatedAt)
            .filter((v): v is string => Boolean(v))
            .sort()
            .at(-1) ?? new Date().toISOString();
        setYahooUpdatedAt(latestUpdatedAt);
        if (mode === "holdings") {
          setJustUpdatedTickers(allResults.map((r) => r.ticker));
          if (typeof window !== "undefined") {
            window.setTimeout(() => setJustUpdatedTickers([]), 500);
          }
        }

        const successCount = allResults.filter((r) => r.price != null && Number.isFinite(r.price)).length;
        const successMsg =
          failedTickers.length > 0
            ? `[${logLabel}] 시세 반영: ${successCount}종목 (실패 ${failedTickers.length}종목: ${failedTickers.slice(0, 3).join(", ")}${failedTickers.length > 3 ? " …" : ""})`
            : `[${logLabel}] 시세 반영: ${successCount}종목`;
        onLog?.(successMsg, "success");
        toast.success(successMsg.replace(`[${logLabel}] `, ""), {
          duration: failedTickers.length > 0 ? 5000 : 4000
        });
      } catch (err) {
        console.error(err);
        setQuoteError("시세 갱신 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
        onLog?.(`${logLabel} 실패: 오류가 발생했습니다.`, "error");
      } finally {
        setIsLoadingQuotes(false);
      }
    },
    [
      mergeQuoteResultsIntoPrices,
      onChangePrices,
      onChangeTickerDatabase,
      onLog,
      prices,
      tickerDatabase,
      updateFxRate
    ]
  );

  const handleRefreshQuotesHoldings = useCallback(async () => {
    lastQuoteRefreshModeRef.current = "holdings";
    await runQuoteRefresh({
      mode: "holdings",
      stockTickers: uniqueStockTickers,
      cryptoTickers: uniqueCryptoTickers,
      updateTickerDatabase: true,
      persistToTickerJson: true,
      logLabel: "보유 종목"
    });
  }, [runQuoteRefresh, uniqueStockTickers, uniqueCryptoTickers]);

  usePriceAutoRefresh({
    onRefresh: async () => {
      if (uniqueStockTickers.length === 0 && uniqueCryptoTickers.length === 0) return;
      await runQuoteRefresh({
        mode: "holdings",
        stockTickers: uniqueStockTickers,
        cryptoTickers: uniqueCryptoTickers,
        updateTickerDatabase: false,
        persistToTickerJson: false,
        logLabel: "자동 갱신"
      });
    }
  });

  const handleRefreshQuotesFull = useCallback(async () => {
    const rows = await fetchTickersFromFile();
    if (rows.length === 0) {
      const msg =
        "ticker.json을 불러오지 못했습니다. 전체 갱신은 개발 서버(npm run dev)의 /api/ticker-json이 필요합니다.";
      toast.error(msg);
      onLog?.(`전체 시세: ${msg}`, "error");
      return;
    }
    const seen = new Set<string>();
    const stockTickers: string[] = [];
    for (const r of rows) {
      const key = canonicalTickerForMatch(r.ticker);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      stockTickers.push(key.toUpperCase());
    }
    const n = stockTickers.length;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `data/ticker.json 기준 ${n}개 종목 시세를 갱신합니다. 종목이 많으면 매우 오래 걸리고 API 제한에 걸릴 수 있습니다.\n\n` +
          `· prices(시세 캐시)만 갱신합니다.\n` +
          `· tickerDatabase·ticker.json 파일에는 쓰지 않습니다.\n\n계속할까요?`
      )
    ) {
      return;
    }
    lastQuoteRefreshModeRef.current = "full";
    await runQuoteRefresh({
      mode: "full",
      stockTickers,
      cryptoTickers: [],
      updateTickerDatabase: false,
      persistToTickerJson: false,
      logLabel: "전체(ticker.json)"
    });
  }, [runQuoteRefresh, onLog]);

  const applyQuoteResult = (symbol: string, r: StockPrice, fallbackName?: string) => {
    const existingPriceName = prices.find((p) => p.ticker === symbol)?.name;
    const preferredName = displayNameForTicker(
      symbol,
      r.name || (fallbackName && fallbackName.trim()) || existingPriceName || undefined
    ) || symbol;
    setTickerInfo({
      ticker: symbol,
      name: preferredName,
      price: r.price,
      currency: r.currency
    });

    setTradeForm((prev) => ({
      ...prev,
      ticker: symbol,
      name: prev.name || preferredName
    }));

    const next: StockPrice[] = [...prices];
    const idx = next.findIndex((p) => p.ticker === symbol);
    const item: StockPrice = {
      ticker: symbol,
      name: preferredName,
      price: r.price,
      currency: r.currency,
      change: r.change,
      changePercent: r.changePercent,
      updatedAt: r.updatedAt,
      sector: r.sector,
      industry: r.industry
    };
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...item };
    } else {
      next.push(item);
    }
    onChangePrices(next);
  };

  // 시세 검색 핸들러
  const handleSearchQuote = async () => {
    const symbol = canonicalTickerForMatch(quoteSearchTicker.trim());
    if (!symbol) {
      setQuoteError("티커를 입력하세요.");
      return;
    }

    setIsSearchingQuote(true);
    setQuoteError(null);
    onLog?.(`시세 검색: ${symbol} 조회 중...`, "info");
    try {
      const results = await fetchYahooQuotes([symbol]);
      if (results.length > 0) {
        const r = results[0];
        const existingName = tickerDatabase.find(t => t.ticker === symbol)?.name;
        applyQuoteResult(symbol, r, existingName);
        
        // ticker.json에 저장 (한국 종목은 한글명으로)
        const nameToSave = displayNameForTicker(symbol, r.name ?? existingName ?? undefined);
        if (nameToSave) {
          const market = isKRWStock(symbol) ? 'KR' : 'US';
          await saveTickerToJson(symbol, nameToSave, market);
        }
        
        setQuoteSearchTicker("");
        onLog?.(`시세 검색: ${symbol} 조회 완료.`, "success");
      } else {
        setQuoteError("시세를 찾지 못했습니다.");
        onLog?.(`시세 검색: ${symbol} 시세를 찾지 못했습니다.`, "error");
      }
    } catch (err) {
      console.error("시세 검색 오류:", err);
      setQuoteError("시세 검색 중 오류가 발생했습니다.");
      onLog?.("시세 검색: 오류가 발생했습니다.", "error");
    } finally {
      setIsSearchingQuote(false);
    }
  };

  const addRecentTicker = (ticker: string, name?: string) => {
    setRecentTickers((prev) => {
      const filtered = prev.filter((i) => i.ticker !== ticker);
      const next = [{ ticker, name }, ...filtered].slice(0, 8);
      try {
        localStorage.setItem("fw-recent-tickers", JSON.stringify(next));
      } catch {
        //
      }
      return next;
    });
  };

  const toggleFavorite = (ticker: string, name?: string) => {
    setFavoriteTickers((prev) => {
      const exists = prev.some((i) => i.ticker === ticker);
      const next = exists ? prev.filter((i) => i.ticker !== ticker) : [{ ticker, name }, ...prev].slice(0, 12);
      try {
        localStorage.setItem("fw-fav-tickers", JSON.stringify(next));
      } catch {
        //
      }
      return next;
    });
  };

  const quickPrefillTrade = (ticker: string, name?: string, side: TradeSide = "buy") => {
    // 탭 기능 제거됨
    setTradeForm((prev) => ({
      ...prev,
      ticker,
      name: name || prev.name || ticker,
      side,
      quantity: "",
      price: "",
      fee: prev.fee
    }));
  };

  const handlePositionClick = (p: PositionWithPrice) => {
    // 보유 종목 클릭 시 종목 상세 모달 열기
    setSelectedPosition(p);
  };

  const handleQuickSell = (p: PositionWithPrice, e: React.MouseEvent) => {
    e.stopPropagation(); // 상세 모달 열기 방지
    const priceInfo = prices.find((pr) => pr.ticker === p.ticker);
    const currentPrice = priceInfo?.price ?? p.marketPrice;
    const db = tickerDatabase.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(p.ticker));
    setTradeForm({
      ...createDefaultTradeForm(),
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: p.accountId,
      ticker: p.ticker,
      name: p.name,
      market: db?.market,
      exchange: db?.exchange,
      side: "sell",
      quantity: String(p.quantity),
      price: String(currentPrice),
      fee: "0"
    });
    
    // 티커 정보도 설정
    if (priceInfo) {
      setTickerInfo({
        ticker: p.ticker,
        name: p.name,
        price: currentPrice,
        currency: priceInfo.currency
      });
    }
    
    // 거래 입력 폼으로 스크롤
    setTimeout(() => {
      const formElement = document.querySelector('form[class*="card"]');
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleQuickBuy = (p: PositionWithPrice, e: React.MouseEvent) => {
    e.stopPropagation(); // 상세 모달 열기 방지
    const priceInfo = prices.find((pr) => pr.ticker === p.ticker);
    const currentPrice = priceInfo?.price ?? p.marketPrice;
    const db = tickerDatabase.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(p.ticker));
    setTradeForm({
      ...createDefaultTradeForm(),
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: p.accountId,
      ticker: p.ticker,
      name: p.name,
      market: db?.market,
      exchange: db?.exchange,
      side: "buy",
      quantity: "",
      price: String(currentPrice),
      fee: "0"
    });
    
    // 티커 정보도 설정
    if (priceInfo) {
      setTickerInfo({
        ticker: p.ticker,
        name: p.name,
        price: currentPrice,
        currency: priceInfo.currency
      });
    }
    
    // 거래 입력 폼으로 스크롤
    setTimeout(() => {
      const formElement = document.querySelector('form[class*="card"]');
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleRefreshSymbolLibrary = async () => {
    const tradeTickers = getUniqueTickersFromTrades(trades);
    if (tradeTickers.length === 0) {
      setQuoteError("거래 내역에 티커가 없습니다. 먼저 거래를 추가하세요.");
      return;
    }
    const stockSymbols = tradeTickers.filter((t) => !isCryptoStock(t)).map((t) => t.toUpperCase());
    const cryptoSymbols = tradeTickers.filter((t) => isCryptoStock(t)).map((t) => t.toLowerCase());
    try {
      setIsUpdatingLibrary(true);
      setQuoteError(null);

      const exchangeMap: Record<string, string> = {};
      for (const t of tickerDatabase) {
        const key = canonicalTickerForMatch(t.ticker);
        if (key && (t.exchange === "KOSPI" || t.exchange === "KOSDAQ")) exchangeMap[key] = t.exchange;
      }

      const allResults: YahooQuoteResult[] = [];

      if (stockSymbols.length > 0) {
        const stockRes = await fetchYahooQuotes(stockSymbols, {
          exchangeMap: Object.keys(exchangeMap).length ? exchangeMap : undefined
        });
        allResults.push(...stockRes);
      }
      if (cryptoSymbols.length > 0) {
        const cryptoRes = await fetchCryptoQuotes(cryptoSymbols, fxRate ?? undefined);
        for (const c of cryptoRes) {
          allResults.push({
            ticker: c.ticker,
            name: c.symbol,
            price: c.priceKrw,
            currency: "KRW",
            changePercent: c.changePercent24h,
            updatedAt: c.updatedAt
          });
        }
      }

      const updatedPrices: StockPrice[] = [...prices];
      let updatedCustom = [...customSymbols];

      for (const r of allResults) {
        if (r.ticker === "USDKRW=X") continue;
        const name = displayNameForTicker(r.ticker, r.name ?? undefined) || r.name || r.ticker;
        const key = canonicalTickerForMatch(r.ticker);
        const idx = updatedPrices.findIndex((p) => canonicalTickerForMatch(p.ticker) === key);
        const item: StockPrice = {
          ticker: r.ticker,
          name,
          price: r.price,
          currency: r.currency,
          change: r.change,
          changePercent: r.changePercent,
          updatedAt: r.updatedAt
        };
        if (idx >= 0) {
          updatedPrices[idx] = { ...updatedPrices[idx], ...item };
        } else {
          updatedPrices.push(item);
        }

        const customKey = (x: string) => canonicalTickerForMatch(x);
        if (!updatedCustom.some((c) => customKey(c.ticker) === key)) {
          updatedCustom = [{ ticker: r.ticker, name }, ...updatedCustom].slice(0, 150);
        } else {
          updatedCustom = updatedCustom.map((c) =>
            customKey(c.ticker) === key ? { ...c, name: c.name || name || c.ticker } : c
          );
        }
      }
      onChangePrices(updatedPrices);
      onChangeCustomSymbols(updatedCustom);
    } catch (err) {
      console.error(err);
      setQuoteError("심볼 라이브러리 업데이트 중 오류가 발생했습니다.");
    } finally {
      setIsUpdatingLibrary(false);
    }
  };


  const positionsByAccount = useMemo(() => {
    const map = new Map<
      string,
      {
        accountName: string;
        rows: PositionWithPrice[];
      }
    >();
    for (const p of positionsWithPrice) {
      const group = map.get(p.accountId) ?? { accountName: p.accountName, rows: [] };
      group.rows.push(p);
      map.set(p.accountId, group);
    }
    const result = Array.from(map.entries()).map(([accountId, { accountName, rows }]) => ({
      accountId,
      accountName,
      rows
    }));
    
    // 계좌 순서 정렬: 사용자 지정 순서가 있으면 그대로, 없으면 총평가금 큰 순
    if (accountOrder.length > 0) {
      const orderMap = new Map(accountOrder.map((id, idx) => [id, idx]));
      result.sort((a, b) => {
        const aOrder = orderMap.get(a.accountId) ?? 999;
        const bOrder = orderMap.get(b.accountId) ?? 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.accountName.localeCompare(b.accountName);
      });
    } else {
      result.sort((a, b) => {
        const aValue = a.rows.reduce((s, p) => s + p.marketValue, 0);
        const bValue = b.rows.reduce((s, p) => s + p.marketValue, 0);
        if (bValue !== aValue) return bValue - aValue;
        return a.accountName.localeCompare(b.accountName);
      });
    }
    
    return result;
  }, [positionsWithPrice, accountOrder]);

  // 계좌 순서 변경 핸들러
  const handleAccountReorder = (accountId: string, newPosition: number) => {
    const currentOrder = accountOrder.length > 0 
      ? accountOrder 
      : positionsByAccount.map((g) => g.accountId);
    const currentIndex = currentOrder.indexOf(accountId);
    if (currentIndex === -1) return;
    
    const clamped = Math.max(0, Math.min(currentOrder.length - 1, newPosition));
    if (clamped === currentIndex) return;
    
    const next = [...currentOrder];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    
    setAccountOrder(next);
    localStorage.setItem("fw-account-order", JSON.stringify(next));
  };


  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4),
    [trades]
  );

  // 거래 폼 검증
  const tradeFormValidation = useMemo(() => {
    const errors: Record<string, string> = {};
    const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
    
    // 날짜 검증
    // 주의: 주식 거래는 미래 날짜도 허용합니다 (과거 거래 기록 입력, 예약 주문 등)
    // LedgerView와 달리 maxDate를 전달하지 않아 미래 날짜 제한이 없습니다
    const dateValidation = validateDate(tradeForm.date);
    if (!dateValidation.valid) {
      errors.date = dateValidation.error || "";
    }
    
    // 계좌 검증
    const accountValidation = validateRequired(tradeForm.accountId, "계좌");
    if (!accountValidation.valid) {
      errors.accountId = accountValidation.error || "";
    }
    
    // 티커 검증
    if (tradeForm.ticker.trim()) {
      const tickerValidation = validateTicker(tradeForm.ticker);
      if (!tickerValidation.valid) {
        errors.ticker = tickerValidation.error || "";
      }
    } else {
      errors.ticker = "티커를 입력해주세요";
    }
    
    // 수량 검증 (암호화폐·미국주식/ETF는 소수점 허용)
    const allowDecimalQuantity = isCryptoStock(tradeForm.ticker ?? "") || isUSDStock(tradeForm.ticker ?? "");
    const quantityValidation = validateQuantity(tradeForm.quantity, allowDecimalQuantity);
    if (!quantityValidation.valid) {
      errors.quantity = quantityValidation.error || "";
    }
    // 매도 시: 보유 수량 초과 여부
    if (tradeForm.side === "sell" && tradeForm.accountId && tickerClean && !errors.quantity) {
      const q = Number(tradeForm.quantity);
      if (!Number.isNaN(q) && q > 0) {
        const pos = positions.find(
          (p) => p.accountId === tradeForm.accountId && canonicalTickerForMatch(p.ticker) === tickerClean
        );
        if (!pos) {
          errors.quantity = "해당 계좌에 이 종목 보유 내역이 없습니다.";
        } else if (q > pos.quantity) {
          errors.quantity = `보유 수량(${pos.quantity}주)을 초과할 수 없습니다.`;
        }
      }
    }

    // 가격 검증 (소수점 허용). 미국 주식은 단가(USD) 또는 단가(원) 중 하나만 있어도 됨
    const isUSD = tickerClean ? isUSDStock(tickerClean) : false;
    const priceVal = validateAmount(tradeForm.price, false, 0.001, undefined, true);
    const priceKRWVal = validateAmount(tradeForm.priceKRW ?? "", false, 1, undefined, true);
    const hasPriceUSD = priceVal.valid && Number(tradeForm.price) > 0;
    const hasPriceKRW = priceKRWVal.valid && Number(tradeForm.priceKRW || 0) > 0;
    if (isUSD) {
      if (!hasPriceUSD && !hasPriceKRW) {
        errors.price = "단가(USD) 또는 단가(원)을 입력하세요.";
      } else if (!hasPriceUSD && !priceKRWVal.valid && (tradeForm.priceKRW ?? "").trim() !== "") {
        errors.priceKRW = priceKRWVal.error || "";
      } else if (hasPriceUSD && !priceVal.valid) {
        errors.price = priceVal.error || "";
      }
    } else {
      if (!priceVal.valid) errors.price = priceVal.error || "";
    }

    // 수수료 검증 (선택적이지만 입력되면 유효해야 함)
    const feeTrimmed = tradeForm.fee?.trim() || "";
    if (feeTrimmed && feeTrimmed !== "0") {
      const feeValidation = validateAmount(feeTrimmed, false, 0);
      if (!feeValidation.valid) errors.fee = feeValidation.error || "";
    }
    const feeKRWTrimmed = (tradeForm.feeKRW ?? "").trim();
    if (feeKRWTrimmed && feeKRWTrimmed !== "0") {
      const feeKRWValidation = validateAmount(feeKRWTrimmed, false, 0);
      if (!feeKRWValidation.valid) errors.feeKRW = feeKRWValidation.error || "";
    }

    return errors;
  }, [tradeForm, positions]);
  
  const isTradeFormValid = Object.keys(tradeFormValidation).length === 0;

  const shouldUseUsdBalanceMode = useCallback(
    (accountId: string, isSecuritiesAccount: boolean, isUSDCurrency: boolean) =>
      shouldUseUsdBalanceModeUtil(accountId, isSecuritiesAccount, isUSDCurrency, accounts, ledger),
    [accounts, ledger]
  );

  /** 거래 폼 검증 + cashImpact/USD 반영 + 저장. 폼 제출과 Ctrl+S에서 공통 사용 */
  const submitTradeFromForm = useCallback(() => {
    if (!isTradeFormValid) {
      const firstError = Object.values(tradeFormValidation)[0];
      if (firstError) toast.error(firstError);
      return;
    }
    const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
    const quantityRaw = Number(tradeForm.quantity);
    const quantity = isCryptoStock(tickerClean)
      ? Number(quantityRaw.toFixed(8))
      : isUSDStock(tickerClean)
        ? Number(quantityRaw.toFixed(6))
        : quantityRaw;
    let price = Number(tradeForm.price);
    let fee = Number(tradeForm.fee || "0");
    const priceKRWEarly = Number(tradeForm.priceKRW ?? 0);
    const isUSDTicker = isUSDStock(tickerClean);
    let accountId = tradeForm.accountId || (trades.length > 0 ? trades[trades.length - 1].accountId : accounts.filter((a) => a.type === "securities" || a.type === "crypto")[0]?.id || "");
    let date = tradeForm.date || new Date().toISOString().slice(0, 10);
    const hasAnyPrice = price > 0 || (isUSDTicker && priceKRWEarly > 0);
    if (!date || !accountId || !tickerClean || !quantity || !hasAnyPrice) {
      if (!hasAnyPrice) toast.error(ERROR_MESSAGES.QUOTE_UNAVAILABLE);
      return;
    }
    const side = tradeForm.side || "buy";
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      toast.error(ERROR_MESSAGES.ACCOUNT_REQUIRED);
      return;
    }
    const priceInfo = latestPriceByCanonicalTicker.get(tickerClean);
    const currencyValidation = validateAccountTickerCurrency(selectedAccount, tickerClean, priceInfo ?? undefined);
    if (!currencyValidation.valid) {
      toast.error(currencyValidation.error ?? "계좌와 종목 통화가 일치하지 않습니다.");
      return;
    }
    const isSecuritiesAccount = selectedAccount.type === "securities" || selectedAccount.type === "crypto";
    const isUSD = isUSDStock(tickerClean);
    const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
    const isUSDCurrency = currency === "USD";
    const useUsdBalanceMode = shouldUseUsdBalanceMode(accountId, isSecuritiesAccount, isUSDCurrency);

    const priceKRWNum = Number(tradeForm.priceKRW ?? 0);
    const feeKRWNum = Number(tradeForm.feeKRW ?? 0);
    const hasUSDInput = price > 0;
    const hasKRWInput = priceKRWNum > 0;

    let exchangeRate: number;
    if (isUSDCurrency) {
      if (hasUSDInput && hasKRWInput) {
        // 원화·달러 둘 다 입력됨 → 환율 없이 저장, 입력값으로 적용 환율 계산
        const totalAmountKRWFromInput = quantity * priceKRWNum + feeKRWNum;
        const totalAmountUSDFromInput = quantity * price + fee;
        exchangeRate = totalAmountUSDFromInput > 0 ? totalAmountKRWFromInput / totalAmountUSDFromInput : (fxRate ?? DEFAULT_FX_RATE);
      } else if (hasKRWInput && !hasUSDInput) {
        // 단가(원)·수수료(원)만 입력 → USD로 변환 필요 (환율 없으면 기본값)
        const rate = (fxRate && fxRate > 0) ? fxRate : DEFAULT_FX_RATE;
        price = priceKRWNum / rate;
        fee = feeKRWNum / rate;
        exchangeRate = rate;
      } else if (hasUSDInput) {
        // 달러로만 매수/매도 → 계좌가 USD 잔액 모드면 환율 불필요(달러만 차감/증가)
        if (useUsdBalanceMode) {
          exchangeRate = 0; // cashImpact=0, usdBalance만 반영
        } else {
          exchangeRate = (fxRate && fxRate > 0) ? fxRate : DEFAULT_FX_RATE;
        }
      } else {
        toast.error("단가(USD) 또는 단가(원)을 입력하세요.");
        return;
      }
    } else {
      exchangeRate = 1;
    }

    // (원화만 입력한 경우는 위에서 price/fee 이미 변환됨)
    const totalAmount = side === "buy" ? quantity * price + fee : quantity * price - fee;
    const totalAmountKRW = isUSDCurrency ? totalAmount * exchangeRate : totalAmount;
    const cashImpact = computeTradeCashImpact(side, totalAmountKRW, useUsdBalanceMode);
    const fallbackName =
      tradeForm.name ||
      latestPriceByCanonicalTicker.get(tickerClean)?.name ||
      trades.find((t) => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
      tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
      tickerClean;

    const addUsdDelta = (map: Map<string, number>, targetId: string, delta: number) => {
      if (!targetId || !Number.isFinite(delta) || Math.abs(delta) < 0.000001) return;
      map.set(targetId, (map.get(targetId) ?? 0) + delta);
    };
    const usdDeltaByAccount = new Map<string, number>();

    if (tradeForm.id) {
      const oldTrade = trades.find((t) => t.id === tradeForm.id);
      if (oldTrade) {
        const oldAccount = accounts.find((a) => a.id === oldTrade.accountId);
        const oldPriceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(oldTrade.ticker));
        const oldIsUSDCurrency = oldPriceInfo?.currency === "USD" || isUSDStock(oldTrade.ticker);
        const oldUseUsdBalanceMode = shouldUseUsdBalanceMode(oldTrade.accountId, oldAccount?.type === "securities" || oldAccount?.type === "crypto", oldIsUSDCurrency);
        if (oldUseUsdBalanceMode && oldIsUSDCurrency && Math.abs(oldTrade.cashImpact ?? 0) < 0.000001) {
          addUsdDelta(usdDeltaByAccount, oldTrade.accountId, oldTrade.side === "buy" ? oldTrade.totalAmount : -oldTrade.totalAmount);
        }
      }
      if (useUsdBalanceMode && isUSDCurrency) {
        addUsdDelta(usdDeltaByAccount, accountId, side === "buy" ? -totalAmount : totalAmount);
      }
      let updatedAccounts = accounts;
      if (onChangeAccounts && usdDeltaByAccount.size > 0) {
        updatedAccounts = accounts.map((a) => {
          const delta = usdDeltaByAccount.get(a.id);
          if (!delta) return a;
          return { ...a, usdBalance: (a.usdBalance ?? 0) + delta };
        });
      }
      onChangeTrades((prevTrades) =>
        prevTrades.map((t) =>
          t.id === tradeForm.id
            ? {
                ...t,
                date,
                accountId,
                ticker: tickerClean,
                name: fallbackName,
                side,
                quantity,
                price,
                fee,
                totalAmount,
                cashImpact,
                fxRateAtTrade: isUSDCurrency && exchangeRate > 0 ? exchangeRate : t.fxRateAtTrade
              }
            : t
        )
      );
      const marketEdit =
        tradeForm.market ??
        (isKRWStock(tickerClean) ? "KR" : isUSDStock(tickerClean) ? "US" : "CRYPTO");
      onChangeTickerDatabase((prev) => {
        const next = prev.filter((t) => canonicalTickerForMatch(t.ticker) !== tickerClean);
        next.push({ ticker: tickerClean, name: fallbackName, market: marketEdit, exchange: tradeForm.exchange });
        return next.sort((a, b) => a.ticker.localeCompare(b.ticker));
      });
      if (onChangeAccounts && usdDeltaByAccount.size > 0) {
        setTimeout(() => onChangeAccounts(updatedAccounts), 0);
      }
    } else {
      if (useUsdBalanceMode && isUSDCurrency) {
        addUsdDelta(usdDeltaByAccount, accountId, side === "buy" ? -totalAmount : totalAmount);
      }
      let updatedAccounts = accounts;
      if (onChangeAccounts && usdDeltaByAccount.size > 0) {
        updatedAccounts = accounts.map((a) => {
          const delta = usdDeltaByAccount.get(a.id);
          if (!delta) return a;
          return { ...a, usdBalance: (a.usdBalance ?? 0) + delta };
        });
      }
      const id = `T${Date.now()}`;
      const trade: StockTrade = {
        id,
        date,
        accountId,
        ticker: tickerClean,
        name: fallbackName,
        side,
        quantity,
        price,
        fee,
        totalAmount,
        cashImpact,
        fxRateAtTrade: isUSDCurrency && exchangeRate > 0 ? exchangeRate : undefined
      };
      onChangeTrades((prevTrades) => [trade, ...prevTrades]);
      const market =
        tradeForm.market ??
        (isKRWStock(tickerClean) ? "KR" : isUSDStock(tickerClean) ? "US" : "CRYPTO");
      const exchange = tradeForm.exchange;
      onChangeTickerDatabase((prev) => {
        const next = prev.filter((t) => canonicalTickerForMatch(t.ticker) !== tickerClean);
        next.push({ ticker: tickerClean, name: fallbackName, market, exchange });
        return next.sort((a, b) => a.ticker.localeCompare(b.ticker));
      });
      if (onChangeAccounts && usdDeltaByAccount.size > 0) {
        setTimeout(() => onChangeAccounts(updatedAccounts), 0);
      }
    }
    onLog?.("저장 완료: 거래가 저장되었습니다.", "success");
    setTradeForm((prev) => ({ ...createDefaultTradeForm(), side: "buy", accountId: prev.accountId || accountId || "" }));
  }, [
    tradeForm,
    trades,
    accounts,
    prices,
    fxRate,
    tickerDatabase,
    isTradeFormValid,
    tradeFormValidation,
    shouldUseUsdBalanceMode,
    onChangeTrades,
    onChangeAccounts,
    onChangeTickerDatabase,
    onLog,
    createDefaultTradeForm
  ]);

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTradeFromForm();
  };

  const handleDcaFetchPrice = async () => {
    const symbol = canonicalTickerForMatch(dcaForm.ticker.trim().toUpperCase());
    if (!symbol) return;
    try {
      setIsLoadingDca(true);
      setDcaMessage(null);
      // 티커와 환율을 함께 조회
      const results = await fetchYahooQuotes([symbol, "USDKRW=X"]);
      if (!results.length) {
        setDcaMessage("해당 티커로 시세를 찾지 못했습니다.");
        return;
      }
      
      // 환율 업데이트
      const fxQuote = results.find((q) => q.ticker === "USDKRW=X");
      if (fxQuote) {
        setFxRate(fxQuote.price);
      }
      
      // 티커 시세 찾기
      const r = results.find((q) => q.ticker === symbol);
      if (!r) {
        setDcaMessage("해당 티커로 시세를 찾지 못했습니다.");
        return;
      }
      
      const preferredName = displayNameForTicker(
        symbol,
        r.name || trades.find((t) => t.ticker === symbol)?.name || undefined
      ) || symbol;
      const next: StockPrice[] = [...prices];
      const idx = next.findIndex((p) => p.ticker === symbol);
      const item: StockPrice = {
        ticker: symbol,
        name: preferredName,
        price: r.price,
        currency: r.currency,
        change: r.change,
        changePercent: r.changePercent,
        updatedAt: r.updatedAt
      };
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...item };
      } else {
        next.push(item);
      }
      onChangePrices(next);
      setDcaForm((prev) => ({ ...prev, ticker: symbol }));
      // 시세 불러오기 성공 메시지
      const priceDisplay = r.currency === "USD" 
        ? `${formatUSD(r.price)} USD${fxQuote ? ` (약 ${formatKRW(Math.round(r.price * fxQuote.price))})` : ""}`
        : formatKRW(Math.round(r.price));
      setDcaMessage(`시세 불러오기 완료: ${priceDisplay}`);
      
      // 약간의 지연 후 메시지 제거 (시세가 표시되는지 확인할 수 있도록)
      setTimeout(() => {
        setDcaMessage(null);
      }, 2000);
    } catch (err) {
      console.error("DCA 시세 조회 오류:", err);
      setDcaMessage("DCA용 시세 조회 중 오류가 발생했습니다.");
    } finally {
      setIsLoadingDca(false);
    }
  };

  const handleDcaSubmit = () => {
    const symbol = canonicalTickerForMatch(dcaForm.ticker.trim().toUpperCase());
    const amount = Number(dcaForm.amount);
    if (!symbol || !amount || amount <= 0 || !dcaForm.accountId) {
      setDcaMessage("계좌, 티커, 금액을 모두 입력하세요.");
      return;
    }

    // 다음날 날짜 계산
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().slice(0, 10);

    // DCA 플랜 생성 (다음날부터 자동 실행)
    const plan = {
      id: `PLAN-${Date.now()}`,
      accountId: dcaForm.accountId,
      ticker: symbol,
      amount,
      fee: 0,
      startDate,
      active: true,
      lastRunDate: undefined
    };
    const nextPlans = [plan, ...dcaPlans];
    persistDcaPlans(nextPlans);
    
    const isUSD = isUSDStock(symbol);
    setDcaMessage(`DCA 플랜 등록 완료: ${symbol} 매일 ${isUSD ? formatUSD(amount) : formatKRW(Math.round(amount))} (${startDate}부터 시작)`);
    setDcaForm((prev) => ({
      accountId: prev.accountId,
      ticker: "",
      amount: ""
    }));
  };

  // DCA 플랜으로 지금 매수
  const handleDcaBuyNow = async (plan: typeof dcaPlans[0]) => {
    const today = new Date().toISOString().slice(0, 10);
    setBuyingPlanId(plan.id);
    setDcaMessage(null);

    try {
      // API로 현재 가격과 환율 조회
      const quotes = await fetchYahooQuotes([plan.ticker, "USDKRW=X"]);
      const fx = quotes.find((q) => q.ticker === "USDKRW=X")?.price;
      if (fx) setFxRate(fx);
      
      const quote = quotes.find((q) => q.ticker.toUpperCase() === plan.ticker.toUpperCase());
      if (!quote || !quote.price || quote.price <= 0) {
        setDcaMessage("시세를 조회할 수 없습니다. 티커를 확인해주세요.");
        setBuyingPlanId(null);
        return;
      }

      // 선택된 계좌 확인
      const selectedAccount = accounts.find((a) => a.id === plan.accountId);
      if (!selectedAccount) {
        setDcaMessage(ERROR_MESSAGES.ACCOUNT_NOT_FOUND);
        setBuyingPlanId(null);
        return;
      }

      const currencyValidation = validateAccountTickerCurrency(selectedAccount, plan.ticker, quote);
      if (!currencyValidation.valid) {
        setDcaMessage(currencyValidation.error ?? "");
        setBuyingPlanId(null);
        return;
      }
      const tickerIsUSD = isUSDStock(plan.ticker);
      const currency = quote.currency || (tickerIsUSD ? "USD" : "KRW");

      const effectiveFx = fx && fx > 0 ? fx : (fxRate && fxRate > 0 ? fxRate : DEFAULT_FX_RATE);
      const quotePrice = quote.price;
      const priceInPlanCurrency = currency === "USD" ? quotePrice * effectiveFx : quotePrice;

      // 매수 수량 계산 (plan.amount는 KRW 예산)
      const shares = plan.amount / priceInPlanCurrency;
      const quantity = Number(shares.toFixed(6));
      const feeInput = plan.fee ?? 0;
      const feeInTradeCurrency = currency === "USD" ? feeInput / effectiveFx : feeInput;
      const totalAmount = quantity * quotePrice;
      const finalAmount = totalAmount + feeInTradeCurrency;
      const totalAmountKRW = currency === "USD" ? finalAmount * effectiveFx : finalAmount;
      const useUsdBalanceMode = shouldUseUsdBalanceMode(
        plan.accountId,
        selectedAccount.type === "securities" || selectedAccount.type === "crypto",
        currency === "USD"
      );
      const cashImpact = computeTradeCashImpact("buy", totalAmountKRW, useUsdBalanceMode);

      // 매수 기록 생성
      const trade: StockTrade = {
        id: `DCA-${plan.id}-${today}-${Math.random().toString(36).substr(2, 9)}`,
        date: today,
        accountId: plan.accountId,
        ticker: plan.ticker,
        name: quote.name ?? plan.ticker,
        side: "buy",
        quantity,
        price: quotePrice,
        fee: feeInTradeCurrency,
        totalAmount: finalAmount,
        cashImpact,
        fxRateAtTrade: currency === "USD" ? effectiveFx : undefined
      };

      // 거래 기록 추가
      onChangeTrades([trade, ...trades]);

      // 평가액 계산 (현재 가격 기준)
      const marketValue = quantity * quotePrice;
      const profit = marketValue - finalAmount;
      const profitRate = finalAmount > 0 ? (profit / finalAmount) * 100 : 0;
      
      const tickerIsUSDForFormat = isUSDStock(plan.ticker);
      const formatAmount = tickerIsUSDForFormat ? (v: number) => formatUSD(v) : (v: number) => formatKRW(Math.round(v));

      setDcaMessage(
        `매수 완료: ${quantity.toFixed(6)}주, 매수액 ${formatAmount(finalAmount)}, ` +
        `평가액 ${formatAmount(marketValue)} ` +
        `(${profit >= 0 ? '+' : ''}${formatAmount(profit)}, ${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%)`
      );

      // 플랜의 마지막 실행 날짜 업데이트
      const updatedPlans = dcaPlans.map((p) =>
        p.id === plan.id ? { ...p, lastRunDate: today } : p
      );
      persistDcaPlans(updatedPlans);
    } catch (err) {
      console.error("DCA 지금 매수 오류:", err);
      setDcaMessage("DCA 지금 매수 중 오류가 발생했습니다.");
    } finally {
      setBuyingPlanId(null);
    }
  };

  // 모든 활성화된 DCA 플랜 전체 매수
  const handleDcaBuyAll = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const activePlans = dcaPlans.filter((p) => p.active);
    
    if (activePlans.length === 0) {
      setDcaMessage("활성화된 DCA 플랜이 없습니다.");
      return;
    }

    setIsBuyingAll(true);
    setDcaMessage(null);

    try {
      // 모든 티커의 가격과 환율 조회
      const tickers = Array.from(new Set(activePlans.map((p) => p.ticker.toUpperCase())));
      const quotes = await fetchYahooQuotes([...tickers, "USDKRW=X"]);
      const fx = quotes.find((q) => q.ticker === "USDKRW=X")?.price;
      if (fx) setFxRate(fx);

      const quoteMap = new Map(quotes.map((q) => [q.ticker.toUpperCase(), q]));
      const newTrades: StockTrade[] = [];
      const updatedPlans = [...dcaPlans];
      let successCount = 0;
      let failCount = 0;
      const failMessages: string[] = [];

      for (const plan of activePlans) {
        try {
          const q = quoteMap.get(plan.ticker.toUpperCase());
          if (!q || !q.price || q.price <= 0) {
            failCount++;
            failMessages.push(`${plan.ticker}: 시세 조회 실패`);
            continue;
          }

          // 선택된 계좌 확인
          const selectedAccount = accounts.find((a) => a.id === plan.accountId);
          if (!selectedAccount) {
            failCount++;
            failMessages.push(`${plan.ticker}: ${ERROR_MESSAGES.ACCOUNT_NOT_FOUND}`);
            continue;
          }

          const currencyValidation = validateAccountTickerCurrency(selectedAccount, plan.ticker, q);
          if (!currencyValidation.valid) {
            failCount++;
            failMessages.push(`${plan.ticker}: ${currencyValidation.error ?? ""}`);
            continue;
          }
          const isUSD = isUSDStock(plan.ticker);
          const currency = q.currency || (isUSD ? "USD" : "KRW");

      const effectiveFx = fx && fx > 0 ? fx : (fxRate && fxRate > 0 ? fxRate : DEFAULT_FX_RATE);
      const quotePrice = q.price;
      const priceInPlanCurrency = currency === "USD" ? quotePrice * effectiveFx : quotePrice;

      // 매수 수량 계산 (plan.amount는 KRW 예산)
      const shares = plan.amount / priceInPlanCurrency;
          const quantity = Number(shares.toFixed(6));
      const feeInput = plan.fee ?? 0;
      const feeInTradeCurrency = currency === "USD" ? feeInput / effectiveFx : feeInput;
      const totalAmount = quantity * quotePrice;
      const finalAmount = totalAmount + feeInTradeCurrency;
      const totalAmountKRW = currency === "USD" ? finalAmount * effectiveFx : finalAmount;
      const useUsdBalanceMode = shouldUseUsdBalanceMode(
        plan.accountId,
        selectedAccount.type === "securities" || selectedAccount.type === "crypto",
        currency === "USD"
      );
      const cashImpact = computeTradeCashImpact("buy", totalAmountKRW, useUsdBalanceMode);

          // 매수 기록 생성
          const trade: StockTrade = {
            id: `DCA-${plan.id}-${today}-${Math.random().toString(36).substr(2, 9)}`,
            date: today,
            accountId: plan.accountId,
            ticker: plan.ticker,
            name: q.name ?? plan.ticker,
            side: "buy",
            quantity,
            price: quotePrice,
            fee: feeInTradeCurrency,
            totalAmount: finalAmount,
            cashImpact,
            fxRateAtTrade: currency === "USD" ? effectiveFx : undefined
          };

          newTrades.push(trade);
          successCount++;

          // 플랜의 마지막 실행 날짜 업데이트
          const planIndex = updatedPlans.findIndex((p) => p.id === plan.id);
          if (planIndex >= 0) {
            updatedPlans[planIndex] = { ...updatedPlans[planIndex], lastRunDate: today };
          }
        } catch (err) {
          console.error(`DCA 플랜 ${plan.id} 매수 오류:`, err);
          failCount++;
          failMessages.push(`${plan.ticker}: 오류 발생`);
        }
      }

      // 거래 기록 추가
      if (newTrades.length > 0) {
        onChangeTrades([...newTrades, ...trades]);
        persistDcaPlans(updatedPlans);
      }

      // 결과 메시지
      let message = `전체 매수 완료: ${successCount}개 성공`;
      if (failCount > 0) {
        message += `, ${failCount}개 실패`;
        if (failMessages.length > 0) {
          message += ` (${failMessages.slice(0, 3).join(", ")}${failMessages.length > 3 ? "..." : ""})`;
        }
      }
      setDcaMessage(message);
    } catch (err) {
      console.error("DCA 전체 매수 오류:", err);
      setDcaMessage("DCA 전체 매수 중 오류가 발생했습니다.");
    } finally {
      setIsBuyingAll(false);
    }
  };

  // 매일 10:30에 자동 실행
  React.useEffect(() => {
    const timer = setInterval(async () => {
      const now = new Date();
      const hh = now.getHours();
      const mm = now.getMinutes();
      const today = now.toISOString().slice(0, 10);
      if (!(hh > 10 || (hh === 10 && mm >= 30))) return;
      let changed = false;

      // 실행 대상 플랜
      const targets = dcaPlans.filter((p) => p.active && p.startDate <= today && p.lastRunDate !== today);
      if (!targets.length) return;

      // 가격/환율 조회
      const tickers = Array.from(new Set(targets.map((p) => p.ticker.toUpperCase())));
      try {
        const quotes = await fetchYahooQuotes([...tickers, "USDKRW=X"]);
        const fx = quotes.find((q) => q.ticker === "USDKRW=X")?.price;
        if (fx) setFxRate(fx);

        const quoteMap = new Map(quotes.map((q) => [q.ticker.toUpperCase(), q]));
        const newTrades: StockTrade[] = [];
        const updatedPlans = dcaPlans.map((p) => {
          if (!targets.find((t) => t.id === p.id)) return p;
          const q = quoteMap.get(p.ticker.toUpperCase());
          const price = q?.price;
          const currency = q?.currency;
          const selectedAccount = accounts.find((a) => a.id === p.accountId);
          if (!selectedAccount) return p;
          if (!price || price <= 0) return p;
          const effectiveFx = fx && fx > 0 ? fx : (fxRate && fxRate > 0 ? fxRate : DEFAULT_FX_RATE);
          const priceInPlanCurrency = currency === "USD" ? price * effectiveFx : price;
          if (!priceInPlanCurrency || priceInPlanCurrency <= 0) return p;
          
          // 장 개장 여부 확인
          const market = getMarketStatus(p.ticker, currency);
          if (!market.isOpen) return p; // 장이 닫혀있으면 실행하지 않음
          
          const shares = p.amount / priceInPlanCurrency;
          const quantity = Number(shares.toFixed(6));
          const feeInput = p.fee ?? 0;
          const feeInTradeCurrency = currency === "USD" ? feeInput / effectiveFx : feeInput;
          const totalAmount = quantity * price + feeInTradeCurrency;
          const useUsdBalanceMode = shouldUseUsdBalanceMode(
            p.accountId,
            selectedAccount.type === "securities" || selectedAccount.type === "crypto",
            currency === "USD"
          );
          const totalAmountKRW = currency === "USD" ? totalAmount * effectiveFx : totalAmount;
          const cashImpact = computeTradeCashImpact("buy", totalAmountKRW, useUsdBalanceMode);
          const trade: StockTrade = {
            id: `DCA-${p.id}-${today}`,
            date: today,
            accountId: p.accountId,
            ticker: p.ticker,
            name: q?.name ?? p.ticker,
            side: "buy",
            quantity,
            price,
            fee: feeInTradeCurrency,
            totalAmount,
            cashImpact,
            fxRateAtTrade: currency === "USD" ? effectiveFx : undefined
          };
          newTrades.push(trade);
          changed = true;
          return { ...p, lastRunDate: today };
        });

        if (changed) {
          onChangeTrades([...newTrades, ...trades]);
          persistDcaPlans(updatedPlans);
          setDcaMessage(`DCA 자동 실행 완료 (${today})`);
        }
      } catch (err) {
        console.error("DCA 자동 실행 실패:", err);
      }
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [dcaPlans, trades, onChangeTrades]);

  const startEditTrade = (t: StockTrade) => {
    const isUSD = isUSDStock(t.ticker);
    const rate = t.fxRateAtTrade ?? fxRate ?? 0;
    const db = tickerDatabase.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(t.ticker));
    setTradeForm({
      id: t.id,
      date: t.date,
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      market: db?.market,
      exchange: db?.exchange,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee),
      priceKRW: isUSD && rate > 0 ? String(Math.round(t.price * rate)) : "",
      feeKRW: isUSD && rate > 0 ? String(Math.round(t.fee * rate)) : ""
    });
  };

  const startCopyTrade = (t: StockTrade) => {
    const isUSD = isUSDStock(t.ticker);
    const rate = t.fxRateAtTrade ?? fxRate ?? 0;
    const db = tickerDatabase.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(t.ticker));
    setTradeForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      market: db?.market,
      exchange: db?.exchange,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee),
      priceKRW: isUSD && rate > 0 ? String(Math.round(t.price * rate)) : "",
      feeKRW: isUSD && rate > 0 ? String(Math.round(t.fee * rate)) : ""
    });
  };

  const resetTradeForm = () => {
    setTradeForm((prev) => ({
      ...createDefaultTradeForm(),
      side: prev.side,
      accountId: prev.accountId
    }));
  };

  // 프리셋 관련 함수들
  const applyPreset = (preset: StockPreset) => {
    setTradeForm((prev) => ({
      ...prev,
      accountId: preset.accountId || prev.accountId,
      ticker: preset.ticker || prev.ticker,
      name: preset.stockName || prev.name,
      quantity: preset.quantity ? String(preset.quantity) : prev.quantity,
      fee: preset.fee ? String(preset.fee) : prev.fee || "0"
    }));

    // 프리셋 사용 기록 업데이트
    if (onChangePresets) {
      const updated = presets.map((p) =>
        p.id === preset.id ? { ...p, lastUsed: new Date().toISOString() } : p
      );
      onChangePresets(updated);
    }
  };

  const saveCurrentAsPreset = () => {
    const presetName = prompt("프리셋 이름을 입력하세요:");
    if (!presetName || !presetName.trim()) return;

    const newPreset: StockPreset = {
      id: `PRESET-${Date.now()}`,
      name: presetName.trim(),
      accountId: tradeForm.accountId,
      ticker: tradeForm.ticker,
      stockName: tradeForm.name || undefined,
      quantity: tradeForm.quantity ? Number(tradeForm.quantity) : undefined,
      fee: tradeForm.fee ? Number(tradeForm.fee) : undefined
    };

    if (onChangePresets) {
      onChangePresets([...presets, newPreset]);
    }
  };

  const deletePreset = (id: string) => {
    if (!confirm("프리셋을 삭제하시겠습니까?")) return;
    if (onChangePresets) {
      onChangePresets(presets.filter((p) => p.id !== id));
    }
  };

  // 필터링된 프리셋 (최근 사용한 것 우선, 최대 9개)
  const filteredPresets = useMemo(() => {
    return presets
      .sort((a, b) => {
        if (a.lastUsed && b.lastUsed) {
          return b.lastUsed.localeCompare(a.lastUsed);
        }
        if (a.lastUsed) return -1;
        if (b.lastUsed) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 9); // 최대 9개만 표시 (Ctrl+1~9)
  }, [presets]);

  // 키보드 단축키 처리
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+1~9: 프리셋 적용
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        if (filteredPresets[index]) {
          e.preventDefault();
          applyPreset(filteredPresets[index]);
        }
      }
      // Ctrl+S: 저장 (submitTradeFromForm과 동일 로직 사용)
      if (e.ctrlKey && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        submitTradeFromForm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredPresets, applyPreset, submitTradeFromForm]);

  const isEditingTrade = Boolean(tradeForm.id);


    return (
    <div>
      {/* 탭 네비게이션 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          className={activeTab === "stocks" ? "primary" : "secondary"}
          onClick={() => setActiveTab("stocks")}
          style={{ padding: "8px 16px", fontSize: 14, borderRadius: "6px 6px 0 0", borderBottom: activeTab === "stocks" ? "2px solid var(--primary)" : "none" }}
        >
          주식
        </button>
        <button
          type="button"
          className={activeTab === "portfolio" ? "primary" : "secondary"}
          onClick={() => setActiveTab("portfolio")}
          style={{ padding: "8px 16px", fontSize: 14, borderRadius: "6px 6px 0 0", borderBottom: activeTab === "portfolio" ? "2px solid var(--primary)" : "none" }}
        >
          포트폴리오 분석
        </button>
        {onChangeLedger && (
          <button
            type="button"
            className={activeTab === "fx" ? "primary" : "secondary"}
            onClick={() => setActiveTab("fx")}
            style={{ padding: "8px 16px", fontSize: 14, borderRadius: "6px 6px 0 0", borderBottom: activeTab === "fx" ? "2px solid var(--primary)" : "none" }}
          >
            환전
          </button>
        )}
      </div>

      {/* 주식 탭 */}
      {activeTab === "stocks" && (
        <>
      <div className="section-header">
        <h2>주식 거래 & 평가</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>

          {fxRate && (

            <span className="pill">

              USD/KRW: {formatNumber(fxRate)} 원

              {fxUpdatedAt && (

                <span className="muted" style={{ marginLeft: 6 }}>

                  업데이트:{' '}

                  {new Date(fxUpdatedAt).toLocaleString("ko-KR", {

                    month: "2-digit",

                    day: "2-digit",

                    hour: "2-digit",

                    minute: "2-digit"

                  })}

                </span>

              )}

            </span>

          )}

          <button
            type="button"
            className="secondary"
            onClick={() => void handleRefreshQuotesHoldings()}
            disabled={isLoadingQuotes}
            title="거래 내역에 있는 티커만 시세 갱신 · prices 및 tickerDatabase 반영"
          >
            {isLoadingQuotes ? "갱신 중..." : "시세 조회 (보유)"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleRefreshQuotesFull()}
            disabled={isLoadingQuotes}
            title="data/ticker.json의 KR+US 전 종목 (개발 서버 필요). prices만 갱신"
          >
            {isLoadingQuotes ? "갱신 중..." : "시세 갱신 (전체)"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              onLog?.("종목 불러오기 시작...", "info");
              await onLoadInitialTickers();
            }}
            disabled={isLoadingTickerDatabase}
          >
            {isLoadingTickerDatabase ? "불러오는 중..." : "종목 불러오기"}
          </button>

          {yahooUpdatedAt && (() => {
            const then = new Date(yahooUpdatedAt).getTime();
            const now = Date.now();
            const diffMin = Math.floor((now - then) / 60000);
            const label = diffMin < 1 ? "방금 전" : diffMin < 60 ? `${diffMin}분 전` : `${Math.floor(diffMin / 60)}시간 전`;
            return (
              <span className="hint" title={new Date(yahooUpdatedAt).toLocaleString("ko-KR")}>
                마지막 갱신: {label}
              </span>
            );
          })()}

        </div>

      </div>



      <StockStatsCard
        totalMarketValue={totals.totalMarketValue}
        totalMarketValueUSD={totals.totalMarketValueUSD}
        fxRate={fxRate}
        dayPnl={totals.dayPnl}
        totalPnl={totals.totalPnl}
        totalCost={totals.totalCost}
        totalReturnRate={totalReturnRate}
        totalDividend={totalDividend}
      />

      {/* 거래/평가 섹션 */}
      {(
        <>
          {/* 프리셋 버튼 영역 */}
          <PresetSection
            presets={filteredPresets}
            onApplyPreset={applyPreset}
            onSaveCurrent={saveCurrentAsPreset}
            onOpenModal={() => setShowPresetModal(true)}
          />

          <div className="two-column">
            <form className="card" onSubmit={handleTradeSubmit} style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ marginTop: 0, marginBottom: 0 }}>
              {tradeForm.side === "sell" ? "주식 매도" : "주식 거래 입력 (매수)"}
            </h3>
            {!isEditingTrade && (
              <button
                type="button"
                onClick={() => {
                  setTradeForm((prev) => ({
                    ...prev,
                    side: prev.side === "buy" ? "sell" : "buy",
                    quantity: "",
                    price: "",
                    priceKRW: "",
                    fee: prev.fee,
                    feeKRW: prev.feeKRW ?? ""
                  }));
                }}
                className={tradeForm.side === "sell" ? "primary" : "secondary"}
                style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
              >
                {tradeForm.side === "sell" ? "매수 모드로 전환" : "매도 모드로 전환"}
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: "0 0 8px 0", fontSize: 12 }}>
            {isUSDStock(tradeForm.ticker ?? "")
              ? "미국 종목: 단가·수수료를 USD와 원화 중 하나 또는 둘 다 입력할 수 있습니다. 둘 다 입력하면 환율 없이 저장됩니다."
              : "한국 종목은 원화(KRW)로 입력합니다."}
          </p>
            {/* 전체 폼 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px 12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>거래일</span>
            <input
              type="date"
              value={tradeForm.date}
              onChange={(e) => setTradeForm({ ...tradeForm, date: e.target.value })}
                style={{ 
                  padding: "6px 8px", 
                  fontSize: 14,
                  borderColor: tradeFormValidation.date ? "var(--danger)" : undefined
                }}
                aria-invalid={!!tradeFormValidation.date}
                aria-describedby={tradeFormValidation.date ? "trade-date-error" : undefined}
            />
            {tradeFormValidation.date && (
              <span id="trade-date-error" style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                {tradeFormValidation.date}
              </span>
            )}
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>증권계좌</span>
            <select
              value={tradeForm.accountId}
              onChange={(e) => setTradeForm({ ...tradeForm, accountId: e.target.value })}
                style={{ 
                  padding: "6px 8px", 
                  fontSize: 14,
                  borderColor: tradeFormValidation.accountId ? "var(--danger)" : undefined
                }}
                aria-invalid={!!tradeFormValidation.accountId}
                aria-describedby={tradeFormValidation.accountId ? "trade-account-error" : undefined}
            >
              <option value="">선택</option>
              {accounts
                .filter((a) => a.type === "securities" || a.type === "crypto")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
            </select>
            {tradeFormValidation.accountId && (
              <span id="trade-account-error" style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                {tradeFormValidation.accountId}
              </span>
            )}
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                티커
              </span>
              {tradeFormValidation.ticker && (
                <span style={{ fontSize: 11, color: "var(--danger)", display: "block" }}>
                  {tradeFormValidation.ticker}
                </span>
              )}
              <div style={{ position: "relative" }}>
                <Autocomplete
                  value={tradeForm.ticker}
                  onChange={(val) =>
                    setTradeForm((prev) => ({
                      ...prev,
                      ticker: val.toUpperCase(),
                      name: "",
                      market: undefined,
                      exchange: undefined
                    }))
                  }
                  options={tickerSuggestions.map((t) => ({
                    value: t.ticker,
                    label: t.name,
                    subLabel: `${t.market === "KR" ? "🇰🇷 한국" : t.market === "CRYPTO" ? "🪙 코인" : "🇺🇸 미국"} ${t.exchange || ""}`,
                    market: t.market,
                    exchange: t.exchange
                  }))}
                  onSelect={(option) => {
                    const selectedTicker = option.value;
                    const selectedName = option.label || "";
                    const market = option.market;
                    const exchange = option.exchange;
                    setTradeForm((prev) => ({
                      ...prev,
                      ticker: selectedTicker,
                      name: selectedName || prev.name || selectedTicker,
                      market,
                      exchange
                    }));
                    const symbol = canonicalTickerForMatch(selectedTicker);
                    if (symbol) {
                      const exchangeMap = exchange ? { [symbol]: exchange } : undefined;
                      fetchYahooQuotes([symbol], { exchangeMap }).then((results) => {
                        if (results.length > 0) {
                          const r = results[0];
                          setTickerInfo({
                            ticker: symbol,
                            name: r.name || selectedName || symbol,
                            price: r.price,
                            currency: r.currency
                          });
                          setTradeForm((prev) => ({
                            ...prev,
                            name: prev.name || r.name || selectedName || symbol
                          }));
                        }
                      }).catch(() => {});
                    }
                  }}
                  placeholder="티커 또는 종목명 입력 (예: 005930, 삼성, AAPL, Apple)"
                />
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>시장</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  { id: "KOSPI", label: "코스피", market: "KR" as const, exchange: "KOSPI" },
                  { id: "KOSDAQ", label: "코스닥", market: "KR" as const, exchange: "KOSDAQ" },
                  { id: "US", label: "미장", market: "US" as const, exchange: undefined },
                  { id: "CRYPTO", label: "코인", market: "CRYPTO" as const, exchange: undefined }
                ].map(({ id, label, market, exchange }) => {
                  const active =
                    (tradeForm.market === market && (market !== "KR" || tradeForm.exchange === exchange));
                  return (
                    <button
                      key={id}
                      type="button"
                      className={active ? "primary" : "secondary"}
                      style={{ padding: "6px 12px", fontSize: 13 }}
                      onClick={() =>
                        setTradeForm((prev) => ({ ...prev, market, exchange }))
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>수량</span>
            <input
              type="number"
              min={0}
              step="any"
              value={tradeForm.quantity}
              onChange={(e) => setTradeForm({ ...tradeForm, quantity: e.target.value })}
                style={{ 
                  padding: "6px 8px", 
                  fontSize: 14,
                  borderColor: tradeFormValidation.quantity ? "var(--danger)" : undefined
                }}
                aria-invalid={!!tradeFormValidation.quantity}
                aria-describedby={tradeFormValidation.quantity ? "trade-quantity-error" : undefined}
            />
            {tradeFormValidation.quantity && (
              <span id="trade-quantity-error" style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                {tradeFormValidation.quantity}
              </span>
            )}
          </label>
            {isUSDStock(tradeForm.ticker ?? "") ? (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>단가 (USD)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={tradeForm.price}
                    onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })}
                    style={{
                      padding: "6px 8px",
                      fontSize: 14,
                      borderColor: tradeFormValidation.price ? "var(--danger)" : undefined
                    }}
                    aria-invalid={!!tradeFormValidation.price}
                    placeholder="달러"
                  />
                  {tradeFormValidation.price && (
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                      {tradeFormValidation.price}
                    </span>
                  )}
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>단가 (원)</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={tradeForm.priceKRW ?? ""}
                    onChange={(e) => setTradeForm({ ...tradeForm, priceKRW: e.target.value })}
                    style={{
                      padding: "6px 8px",
                      fontSize: 14,
                      borderColor: tradeFormValidation.priceKRW ? "var(--danger)" : undefined
                    }}
                    placeholder="원화"
                  />
                  {tradeFormValidation.priceKRW && (
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                      {tradeFormValidation.priceKRW}
                    </span>
                  )}
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>수수료+세금 (USD)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={tradeForm.fee}
                    onChange={(e) => setTradeForm({ ...tradeForm, fee: e.target.value })}
                    style={{ padding: "6px 8px", fontSize: 14 }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>수수료+세금 (원)</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={tradeForm.feeKRW ?? ""}
                    onChange={(e) => setTradeForm({ ...tradeForm, feeKRW: e.target.value })}
                    style={{
                      padding: "6px 8px",
                      fontSize: 14,
                      borderColor: tradeFormValidation.feeKRW ? "var(--danger)" : undefined
                    }}
                    placeholder="원화"
                  />
                  {tradeFormValidation.feeKRW && (
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                      {tradeFormValidation.feeKRW}
                    </span>
                  )}
                </label>
              </>
            ) : (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>단가 (KRW)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={tradeForm.price}
                    onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })}
                    style={{
                      padding: "6px 8px",
                      fontSize: 14,
                      borderColor: tradeFormValidation.price ? "var(--danger)" : undefined
                    }}
                    aria-invalid={!!tradeFormValidation.price}
                  />
                  {tradeFormValidation.price && (
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                      {tradeFormValidation.price}
                    </span>
                  )}
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>수수료+세금 (KRW)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={tradeForm.fee}
                    onChange={(e) => setTradeForm({ ...tradeForm, fee: e.target.value })}
                    style={{ padding: "6px 8px", fontSize: 14 }}
                  />
                </label>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            {isEditingTrade && (
              <button type="button" onClick={resetTradeForm} style={{ padding: "8px 16px", fontSize: 14 }}>
                취소
                </button>
            )}
            <button 
              type="submit" 
              className="primary" 
              style={{ padding: "8px 16px", fontSize: 14 }}
              disabled={!isTradeFormValid}
              title={!isTradeFormValid ? "필수 항목을 입력해주세요" : ""}
            >
              {isEditingTrade 
                ? "거래 저장" 
                : tradeForm.side === "sell" 
                  ? "매도 추가" 
                  : "매수 추가"}
                </button>
              </div>
        </form>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>시세 정보</h3>
          <div style={{ marginBottom: 12, position: "relative" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <Autocomplete
                  value={quoteSearchTicker}
                  onChange={(val) => setQuoteSearchTicker(val.toUpperCase())}
                  options={quoteSearchSuggestions.map((t) => ({
                    value: t.ticker,
                    label: t.name,
                    subLabel: `${t.market === "KR" ? "🇰🇷 한국" : t.market === "CRYPTO" ? "🪙 코인" : "🇺🇸 미국"} ${t.exchange || ""}`
                  }))}
                  onSelect={(option) => {
                    setQuoteSearchTicker(option.value);
                    // 선택 시 바로 검색 실행하려면 아래 주석 해제
                    // void handleSearchQuote();
                  }}
                  placeholder="티커 또는 종목명 입력 (예: 005930, 삼성, AAPL)"
                />
              </div>
              <button
                type="button"
                className="primary"
                onClick={handleSearchQuote}
                disabled={isSearchingQuote || !quoteSearchTicker.trim()}
              >
                {isSearchingQuote ? "검색 중..." : "단일 조회"}
              </button>
            </div>
          </div>
          <div className="quote-panel" style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, minHeight: 120 }}>
                {tickerInfo ? (
                  <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                    <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{tickerInfo.ticker}</div>
                    <div className="muted" style={{ fontSize: 14 }}>{tickerInfo.name}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {tickerInfo.price != null ? (
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{formatPriceWithCurrency(tickerInfo.price, tickerInfo.currency, tradeForm.ticker.toUpperCase())}</div>
                        ) : (
                      <div className="muted">가격 없음</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
              <div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
                티커를 입력하고 단일 조회를 클릭하세요.
              </div>
                )}
          </div>
        </div>
      </div>

      {tickerInfo && (
        <p className="hint" style={{ marginTop: 8 }}>
          {tickerInfo.ticker} / {tickerInfo.name}{" "}
          {tickerInfo.price != null && (
            <>
              - 현재가 {formatPriceWithCurrency(tickerInfo.price, tickerInfo.currency, tradeForm.ticker.toUpperCase())}
            </>
          )}
        </p>
      )}
      {quoteError && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p className="error-text" style={{ margin: 0 }}>
            {quoteError}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setQuoteError(null);
              const m = lastQuoteRefreshModeRef.current;
              if (m === "full") void handleRefreshQuotesFull();
              else void handleRefreshQuotesHoldings();
            }}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            다시 시도
          </button>
        </div>
      )}

      <PositionListSection
        positionsByAccount={positionsByAccount}
        balances={balances}
        accounts={accounts}
        prices={prices}
        tickerDatabase={tickerDatabase}
        onChangeTickerDatabase={onChangeTickerDatabase}
        fxRate={fxRate}
        accountOrder={accountOrder}
        onAccountReorder={handleAccountReorder}
        onPositionClick={handlePositionClick}
        onQuickSell={handleQuickSell}
        onQuickBuy={handleQuickBuy}
      />

      <TradeHistorySection
        trades={trades}
        accounts={accounts}
        prices={prices}
        fxRate={fxRate}
        onChangeTrades={onChangeTrades}
        onStartEditTrade={startEditTrade}
        onResetTradeForm={resetTradeForm}
        onChangeAccounts={onChangeAccounts}
        highlightTradeId={highlightTradeId}
        onClearHighlightTrade={onClearHighlightTrade}
      />
        </>
      )}
        </>
      )}

      {/* 포트폴리오 분석 탭 */}
      {activeTab === "portfolio" && (
        <>
          <Suspense fallback={<ChartSkeleton height={300} />}>
            <LazyPortfolioChartsSection
              positionsWithPrice={positionsWithPrice}
              positionsByAccount={positionsByAccount}
              balances={balances}
              fxRate={fxRate}
            />
          </Suspense>
          {onChangeTargetPortfolios && (
            <Suspense fallback={<ChartSkeleton height={300} />}>
              <LazyTargetPortfolioSection
                positionsWithPrice={positionsWithPrice}
                positionsByAccount={positionsByAccount}
                accounts={accounts}
                prices={prices}
                tickerDatabase={tickerDatabase}
                targetPortfolios={targetPortfolios}
                onChangeTargetPortfolios={onChangeTargetPortfolios}
                fxRate={propFxRate}
              />
            </Suspense>
          )}
        </>
      )}

      {/* 프리셋 관리 모달 */}
      {showPresetModal && (
        <div className="modal-backdrop" onClick={() => setShowPresetModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>프리셋 관리</h3>
              <button type="button" className="secondary" onClick={() => setShowPresetModal(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    saveCurrentAsPreset();
                    setShowPresetModal(false);
                  }}
                >
                  새 프리셋 추가
                </button>
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {presets.length === 0 ? (
                  <p className="hint">저장된 프리셋이 없습니다.</p>
                ) : (
                  <table className="data-table">
                    <colgroup>
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "12%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>계좌</th>
                        <th>티커</th>
                        <th>종목명</th>
                        <th>수량</th>
                        <th>수수료</th>
                        <th>마지막 사용</th>
                        <th>작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {presets.map((preset) => (
                        <tr key={preset.id}>
                          <td>{preset.name}</td>
                          <td>{preset.accountId}</td>
                          <td>{preset.ticker}</td>
                          <td>{preset.stockName || "-"}</td>
                          <td className="number">{preset.quantity ? preset.quantity : "-"}</td>
                          <td className="number">{preset.fee ? Math.round(preset.fee).toLocaleString() : "-"}</td>
                          <td>{preset.lastUsed ? new Date(preset.lastUsed).toLocaleDateString() : "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                applyPreset(preset);
                                setShowPresetModal(false);
                              }}
                              style={{ marginRight: 6, fontSize: 13, padding: "6px 12px" }}
                            >
                              적용
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deletePreset(preset.id)}
                              style={{ fontSize: 13, padding: "6px 12px" }}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 환전 탭 */}
      {activeTab === "fx" && onChangeLedger && (
        <div>
          <h2>환전</h2>
          <p className="hint" style={{ marginBottom: 16 }}>
            같은 계좌 또는 서로 다른 계좌에서 KRW↔USD 환전을 기록합니다. 출발·도착 금액을 원화/달러로 입력하면 계좌 잔고(KRW·USD)에 반영됩니다.
          </p>

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>환전 거래 입력</h3>
            <FxFormSection
              accounts={accounts}
              ledger={ledger}
              onChangeLedger={onChangeLedger}
              fxRate={fxRate}
            />
          </div>

          <h3>환전 내역</h3>
          <FxHistorySection ledger={ledger} />
        </div>
      )}

      {/* 종목 상세 모달 */}
      {selectedPosition && (
        <StockDetailModal
          position={selectedPosition}
          accounts={accounts}
          trades={trades}
          prices={prices}
          ledger={ledger}
          tickerDatabase={tickerDatabase}
          historicalDailyCloses={historicalDailyCloses}
          onClose={() => setSelectedPosition(null)}
          onChangeLedger={onChangeLedger || (() => {})}
          fxRate={propFxRate}
        />
      )}

      {/* 시세 갱신 진행바 (하단 고정, % 표시) */}
      {isLoadingQuotes && (
        <div className="quote-refresh-progress" role="progressbar" aria-valuenow={quoteRefreshProgress.total ? Math.round((quoteRefreshProgress.current / quoteRefreshProgress.total) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label="시세 갱신 중">
          <div
            className="quote-refresh-progress__bar quote-refresh-progress__bar--determinate"
            style={{ width: quoteRefreshProgress.total ? `${(quoteRefreshProgress.current / quoteRefreshProgress.total) * 100}%` : "0%" }}
          />
          <span className="quote-refresh-progress__label">
            시세 갱신 중 {quoteRefreshProgress.total ? Math.round((quoteRefreshProgress.current / quoteRefreshProgress.total) * 100) : 0}%
          </span>
        </div>
      )}
    </div>
  );
};
