import React, { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { Autocomplete, type AutocompleteOption } from "./Autocomplete";
import type { Account, StockPrice, StockTrade, TradeSide, SymbolInfo, TickerInfo } from "../types";
import type { AccountBalanceRow } from "../calculations";
import { computePositions } from "../calculations";
import { fetchYahooQuotes, searchYahooSymbol } from "../yahooFinanceApi";
import { saveTickerDatabaseBackup, saveTickerToJson } from "../storage";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  trades: StockTrade[];
  prices: StockPrice[];
  customSymbols: SymbolInfo[];
  tickerDatabase: TickerInfo[];
  onChangeTrades: (next: StockTrade[]) => void;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeCustomSymbols: (next: SymbolInfo[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[]) => void;
  onLoadInitialTickers: () => Promise<void>;
  isLoadingTickerDatabase: boolean;
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

function createDefaultTradeForm() {
  return {
    id: undefined as string | undefined,
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    ticker: "",
    name: "",
    side: "buy" as TradeSide,
    quantity: "",
    price: "",
    fee: "0"
  };
}

export const StocksView: React.FC<Props> = ({
  accounts,
  balances,
  trades,
  prices,
  customSymbols,
  tickerDatabase,
  onChangeTrades,
  onChangePrices,
  onChangeCustomSymbols,
  onChangeTickerDatabase,
  onLoadInitialTickers,
  isLoadingTickerDatabase
}) => {
  const [tradeForm, setTradeForm] = useState(createDefaultTradeForm);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [yahooUpdatedAt, setYahooUpdatedAt] = useState<string | null>(null);
  const [draggingTradeId, setDraggingTradeId] = useState<string | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(null);
  const [showUSD, setShowUSD] = useState(false);
  const [activeStocksSection, setActiveStocksSection] = useState<"portfolio" | "dca" | "quotes">("portfolio");
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
  const [tickerSuggestions, setTickerSuggestions] = useState<TickerInfo[]>([]);
  // showTickerSuggestions 상태 제거 (Autocomplete 내부에서 처리)
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: "asc" | "desc" }>({
    key: "ticker",
    direction: "asc"
  });
  const [tradeSort, setTradeSort] = useState<{ key: TradeSortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
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
  const [inlineEdit, setInlineEdit] = useState<{
    id: string;
    date: string;
    accountId: string;
    ticker: string;
    name: string;
    side: TradeSide;
    quantity: string;
    price: string;
    fee: string;
  } | null>(null);
  const [inlineEditField, setInlineEditField] = useState<"date" | "accountId" | "quantity" | "price" | "fee" | "totalAmount" | null>(null);
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

  // 티커 문자열을 표준화 (대문자, 야후 접미사 제거)
  const cleanTicker = (raw: string) => raw.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");

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
    const symbol = cleanTicker(tradeForm.ticker.trim());
    if (!symbol || symbol.length < 2) {
      return;
    }

    // debounce: 500ms 후에 시세 조회
    const timer = setTimeout(async () => {
      // 제안 목록이 비어있을 때만 자동 조회 (사용자가 타이핑 중이 아닐 때)
      if (tickerSuggestions.length > 0) return; 
      
      setIsSearchingTradeFormQuote(true);
      try {
        const results = await fetchYahooQuotes([symbol]);
        if (results.length > 0) {
          const r = results[0];
          const existingName = tickerDatabase.find(t => t.ticker === symbol)?.name || tradeForm.name;
          
          // 시세 정보 업데이트
          setTickerInfo({
            ticker: symbol,
            name: r.name || existingName || symbol,
            price: r.price,
            currency: r.currency
          });
          
          // ticker.json에 저장
          if (r.name) {
            const market = /^[0-9A-Z]{6}$/.test(symbol) && /[0-9]/.test(symbol) ? 'KR' : 'US';
            await saveTickerToJson(symbol, r.name, market);
          }
        }
      } catch (err) {
        // 에러는 무시 (사용자가 입력 중일 수 있으므로)
        console.warn("거래 입력 폼 시세 자동 조회 실패:", err);
      } finally {
        setIsSearchingTradeFormQuote(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [tradeForm.ticker, tickerSuggestions.length, tickerDatabase, tradeForm.name]);

  const adjustedPrices = useMemo(() => {
    if (!fxRate) return prices;
    return prices.map((p) => {
      if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
        return { ...p, price: p.price * fxRate, currency: "KRW" };
      }
      return p;
    });
  }, [prices, fxRate]);

  const positions = useMemo(() => computePositions(trades, adjustedPrices, accounts), [
    trades,
    adjustedPrices,
    accounts
  ]);

  type PositionWithPrice = ReturnType<typeof computePositions>[number] & {
    displayMarketPrice: number;
    originalMarketPrice?: number; // USD 원본 가격 (표시용)
    currency?: string;
    diff: number;
  };

  const positionsWithPrice = useMemo<PositionWithPrice[]>(() => {
    return positions.map((p) => {
      // adjustedPrices에서 가져오면 이미 KRW로 변환된 가격
      const adjustedPriceInfo = adjustedPrices.find((x) => x.ticker === p.ticker);
      // 원본 prices에서 통화 정보와 원본 가격 가져오기 (표시용)
      const originalPriceInfo = prices.find((x) => x.ticker === p.ticker);
      // 표시용/계산용 현재가 (KRW로 맞춘 값)
      const displayMarketPrice = adjustedPriceInfo?.price ?? p.marketPrice;
      const originalMarketPrice = originalPriceInfo?.currency === "USD" ? originalPriceInfo.price : undefined;
      const currency = originalPriceInfo?.currency;

      // 평가금액/손익/수익률을 KRW 기준으로 재계산
      const marketValue = displayMarketPrice * p.quantity;
      const pnl = marketValue - p.totalBuyAmount;
      const pnlRate = p.totalBuyAmount > 0 ? pnl / p.totalBuyAmount : 0;
      // 단가와 현재가 차이 (KRW 기준)
      const diff = displayMarketPrice - Math.round(p.avgPrice);

      return {
        ...p,
        displayMarketPrice,
        originalMarketPrice,
        currency,
        marketValue,
        pnl,
        pnlRate,
        diff
      };
    });
  }, [positions, adjustedPrices, prices]);

  const totals = useMemo(() => {
    const totalMarketValue = positionsWithPrice.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCost = positionsWithPrice.reduce((sum, p) => sum + p.totalBuyAmount, 0);
    const totalPnl = positionsWithPrice.reduce((sum, p) => sum + p.pnl, 0);
    const dayPnl = positionsWithPrice.reduce((sum, p) => {
      const priceInfo = prices.find((x) => x.ticker === p.ticker);
      const change = priceInfo?.change ?? 0;
      return sum + change * p.quantity;
    }, 0);
    return { totalMarketValue, totalCost, totalPnl, dayPnl };
  }, [positionsWithPrice, prices]);

  const dcaCalc = useMemo(() => {
    try {
      const amount = Number(dcaForm.amount);
      const symbol = cleanTicker(dcaForm.ticker.trim());
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
  }, [dcaForm, prices, adjustedPrices, fxRate, trades]);

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

  const sortTrades = (rows: StockTrade[]) => {
    const dir = tradeSort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const key = tradeSort.key;
      const va = (a as any)[key];
      const vb = (b as any)[key];
      if (key === "date") {
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      }
      if (typeof va === "string" || typeof vb === "string") {
        return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
      }
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  };

  const togglePositionSort = (key: PositionSortKey) => {
    setPositionSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const toggleTradeSort = (key: TradeSortKey) => {
    setTradeSort((prev) => ({
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
      console.warn("FX fetch failed", err);
    }
  };

  React.useEffect(() => {
    updateFxRate().catch((err) => {
      console.warn("FX rate update failed:", err);
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

  const formatNumber = (value: number) => Math.round(value).toLocaleString("ko-KR");
  const formatKRW = (value: number) => `${formatNumber(value)} 원`;
  const formatUSD = (value: number) => Math.round(value).toLocaleString("en-US");
  const formatPriceWithCurrency = (value: number, currency?: string) => {
    if (currency === "USD" && showUSD) {
      const base = `${formatUSD(value)} USD`;
      if (fxRate) {
        return `${base} (약 ${formatKRW(Math.round(value * fxRate))})`;
      }
      return base;
    }
    if (currency === "USD" && fxRate && !showUSD) {
      return `${formatKRW(Math.round(value * fxRate))}`;
    }
    if (currency && currency !== "KRW" && showUSD) {
      return `${Math.round(value).toLocaleString("en-US")} ${currency}`;
    }
    return `${formatKRW(value)}`;
  };

  const getMarketStatus = (ticker: string, currency?: string) => {
    const isKorea = /^[0-9]{6}$/.test(ticker) || currency === "KRW";
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

  const getPriceInfoForDca = (ticker: string) => {
    const symbol = cleanTicker(ticker);
    const adjusted = adjustedPrices.find((p) => cleanTicker(p.ticker) === symbol);
    const original = prices.find((p) => cleanTicker(p.ticker) === symbol);
    const priceKRW =
      adjusted?.price ??
      (original?.currency === "USD" && fxRate ? original.price * fxRate : original?.price ?? 0);
    const name =
      original?.name ||
      trades.find((t) => cleanTicker(t.ticker) === symbol)?.name ||
      symbol;
    return {
      priceKRW,
      name,
      currency: original?.currency,
      originalPrice: original?.price ?? 0
    };
  };

  // 보유/거래 내역에 등장하는 티커 목록 (미국 주식 기준, 중복 제거)
  const uniqueTickers = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) {
      const symbol = t.ticker.trim().toUpperCase();
      if (symbol) set.add(symbol);
    }
    return Array.from(set);
  }, [trades]);

  const koreanQuotes = useMemo(() => prices.filter((p) => p.currency === "KRW"), [prices]);
  const usQuotes = useMemo(() => prices.filter((p) => p.currency === "USD"), [prices]);

  const renderQuoteTable = (items: StockPrice[], marketLabel: string) => (
    <table className="data-table">
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
                <td className="number">{formatPriceWithCurrency(item.price ?? 0, item.currency)}</td>
                <td className={`number ${changeClass}`}>
                  {item.change != null ? formatKRW(item.change) : "-"}
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

  const handleRefreshQuotes = async () => {

    if (uniqueTickers.length === 0) {

      setQuoteError("거래 내역에 등록된 티커가 없습니다. 먼저 거래를 추가하세요.");

      return;

    }

    try {

      setIsLoadingQuotes(true);

      setQuoteError(null);

      updateFxRate();

      const updatedSymbols: string[] = [];

      const results = await fetchYahooQuotes(uniqueTickers);

      if (!results.length) {

        setQuoteError("시세를 가져오지 못했습니다. 잠시 후 다시 시도하세요.");

        return;

      }

      const next: StockPrice[] = [...prices];

      for (const r of results) {
        // 환율은 제외
        if (r.ticker === "USDKRW=X") {
          continue;
        }

        // ticker.json에 티커와 종목명 저장
        if (r.name) {
          const market = /^[0-9A-Z]{6}$/.test(r.ticker) && /[0-9]/.test(r.ticker) ? 'KR' : 'US';
          await saveTickerToJson(r.ticker, r.name, market);
        }

        const idx = next.findIndex((p) => p.ticker === r.ticker);

        const existingName = next[idx]?.name ?? trades.find((t) => t.ticker === r.ticker)?.name;

        const item: StockPrice = {

          ticker: r.ticker,

          name: r.name ?? existingName ?? r.ticker,

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

        updatedSymbols.push(r.ticker);
      }

      onChangePrices(next);

      const latestUpdatedAt =
        results
          .map((r) => r.updatedAt)
          .filter((v): v is string => Boolean(v))
          .sort()
          .at(-1) ?? new Date().toISOString();
      setYahooUpdatedAt(latestUpdatedAt);

      setJustUpdatedTickers(updatedSymbols);

      if (typeof window !== "undefined") {

        window.setTimeout(() => setJustUpdatedTickers([]), 500);

      }

    } catch (err) {

      console.error(err);

      setQuoteError("시세 갱신 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.");

    } finally {

      setIsLoadingQuotes(false);

    }

  };

  const applyQuoteResult = (symbol: string, r: StockPrice, fallbackName?: string) => {
    const isKoreaTicker = /^[0-9]{6}$/.test(symbol);
    const existingPriceName = prices.find((p) => p.ticker === symbol)?.name;
    const preferredName =
      r.name ||
      (fallbackName && fallbackName.trim()) ||
      existingPriceName ||
      (isKoreaTicker ? symbol : tickerInfo?.name) ||
      symbol;
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
      updatedAt: r.updatedAt
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
    const symbol = cleanTicker(quoteSearchTicker.trim());
    if (!symbol) {
      setQuoteError("티커를 입력하세요.");
      return;
    }

    setIsSearchingQuote(true);
    setQuoteError(null);
    try {
      const results = await fetchYahooQuotes([symbol]);
      if (results.length > 0) {
        const r = results[0];
        const existingName = tickerDatabase.find(t => t.ticker === symbol)?.name;
        applyQuoteResult(symbol, r, existingName);
        
        // ticker.json에 저장
        if (r.name) {
          const market = /^[0-9A-Z]{6}$/.test(symbol) && /[0-9]/.test(symbol) ? 'KR' : 'US';
          await saveTickerToJson(symbol, r.name, market);
        }
        
        setQuoteSearchTicker("");
      } else {
        setQuoteError("시세를 찾지 못했습니다.");
      }
    } catch (err) {
      console.error("시세 검색 오류:", err);
      setQuoteError("시세 검색 중 오류가 발생했습니다.");
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
    setActiveStocksSection("portfolio");
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
    // 보유 종목 클릭 시 매도 폼 열기
    setActiveStocksSection("portfolio");
    const priceInfo = prices.find((x) => x.ticker === p.ticker);
    const currentPrice = priceInfo?.price ?? p.marketPrice;
    setTradeForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: p.accountId,
      ticker: p.ticker,
      name: p.name,
      side: "sell",
      quantity: String(p.quantity), // 보유 수량으로 자동 채움
      price: String(Math.round(currentPrice)), // 현재가로 자동 채움
      fee: "0"
    });
  };

  const handleRefreshSymbolLibrary = async () => {
    const set = new Set<string>();
    customSymbols.forEach((s) => set.add(cleanTicker(s.ticker)));
    trades.forEach((t) => set.add(cleanTicker(t.ticker)));
    prices.forEach((p) => set.add(cleanTicker(p.ticker)));
    const allSymbols = Array.from(set).filter(Boolean);
    if (allSymbols.length === 0) return;
    try {
      setIsUpdatingLibrary(true);
      const results = await fetchYahooQuotes(allSymbols);
      const updatedPrices: StockPrice[] = [...prices];
      let updatedCustom = [...customSymbols];

      for (const r of results) {
        const idx = updatedPrices.findIndex((p) => p.ticker === r.ticker);
        const item: StockPrice = {
          ticker: r.ticker,
          name: r.name ?? r.ticker,
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

        if (!updatedCustom.some((c) => c.ticker === r.ticker)) {
          updatedCustom = [{ ticker: r.ticker, name: r.name ?? r.ticker }, ...updatedCustom].slice(0, 150);
        } else {
          updatedCustom = updatedCustom.map((c) =>
            c.ticker === r.ticker ? { ...c, name: c.name || r.name || c.ticker } : c
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
    return Array.from(map.entries()).map(([accountId, { accountName, rows }]) => ({
      accountId,
      accountName,
      rows: sortPositions(rows)
    }));
  }, [positionsWithPrice, positionSort]);

  const recentTrades = useMemo(
    () => [...trades].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4),
    [trades]
  );

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tickerClean = cleanTicker(tradeForm.ticker);
    const quantity = Number(tradeForm.quantity);
    const price = Number(tradeForm.price);
    const fee = Number(tradeForm.fee || "0");
    if (!tradeForm.date || !tradeForm.accountId || !tickerClean || !quantity || !price) {
      return;
    }
    const totalAmount = quantity * price + fee;
    // 매도는 보유 종목 클릭으로만 가능, 매수는 기본값
    const side = tradeForm.side || "buy";
    const cashImpact = side === "buy" ? -totalAmount : totalAmount;
    const fallbackName =
      prices.find((p) => p.ticker === tickerClean)?.name ||
      trades.find((t) => t.ticker === tickerClean)?.name ||
      tickerClean;

    if (tradeForm.id) {
      const updated = trades.map((t) =>
        t.id === tradeForm.id
          ? {
              ...t,
              date: tradeForm.date,
              accountId: tradeForm.accountId,
              ticker: tickerClean,
              name: fallbackName,
              side,
              quantity,
              price,
              fee,
              totalAmount,
              cashImpact
            }
          : t
      );
      onChangeTrades(updated);
    } else {
      const id = `T${Date.now()}`;
      const trade: StockTrade = {
        id,
        date: tradeForm.date,
        accountId: tradeForm.accountId,
        ticker: tickerClean,
        name: fallbackName,
        side,
        quantity,
        price,
        fee,
        totalAmount,
        cashImpact
      };
      onChangeTrades([trade, ...trades]);
    }
    setTradeForm((prev) => ({
      ...createDefaultTradeForm(),
      side: "buy", // 매도 후에는 다시 매수 모드로 리셋
      accountId: prev.accountId || tradeForm.accountId
    }));
  };

  const handleDcaFetchPrice = async () => {
    const symbol = cleanTicker(dcaForm.ticker.trim().toUpperCase());
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
      
      const preferredName =
        r.name ||
        trades.find((t) => t.ticker === symbol)?.name ||
        r.ticker;
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
    const symbol = cleanTicker(dcaForm.ticker.trim().toUpperCase());
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
    
    setDcaMessage(`DCA 플랜 등록 완료: ${symbol} 매일 ${formatKRW(Math.round(amount))} (${startDate}부터 시작)`);
    setDcaForm((prev) => ({
      accountId: prev.accountId,
      ticker: "",
      amount: ""
    }));
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
          let priceKRW = price ?? 0;
          if (currency === "USD" && fx) priceKRW = priceKRW * fx;
          if (!priceKRW || priceKRW <= 0) return p;
          
          // 장 개장 여부 확인
          const market = getMarketStatus(p.ticker, currency);
          if (!market.isOpen) return p; // 장이 닫혀있으면 실행하지 않음
          
          const shares = p.amount / priceKRW;
          const quantity = Number(shares.toFixed(6));
          const totalAmount = quantity * priceKRW + (p.fee ?? 0);
          const cashImpact = -totalAmount;
          const trade: StockTrade = {
            id: `DCA-${p.id}-${today}`,
            date: today,
            accountId: p.accountId,
            ticker: p.ticker,
            name: q?.name ?? p.ticker,
            side: "buy",
            quantity,
            price: Math.round(priceKRW),
            fee: p.fee ?? 0,
            totalAmount,
            cashImpact
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
    setTradeForm({
      id: t.id,
      date: t.date,
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee)
    });
  };

  const startCopyTrade = (t: StockTrade) => {
    setTradeForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee)
    });
  };

  const resetTradeForm = () => {
    setTradeForm((prev) => ({
      ...createDefaultTradeForm(),
      side: prev.side,
      accountId: prev.accountId
    }));
  };

  const isEditingTrade = Boolean(tradeForm.id);

  const handleDeleteTrade = (id: string) => {
    const next = trades.filter((t) => t.id !== id);
    onChangeTrades(next);
    if (tradeForm.id === id) {
      resetTradeForm();
    }
    if (inlineEdit?.id === id) {
      setInlineEdit(null);
    }
  };

  const handleReorderTrade = (id: string, newIndex: number) => {
    const currentIndex = trades.findIndex((t) => t.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(trades.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const next = [...trades];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeTrades(next);
  };

  const startInlineEdit = (t: StockTrade, field?: "date" | "accountId" | "quantity" | "price" | "fee" | "totalAmount") => {
    setInlineEdit({
      id: t.id,
      date: t.date,
      accountId: t.accountId,
      ticker: t.ticker,
      name: t.name,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      fee: String(t.fee)
    });
    setInlineEditField(field || null);
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setInlineEditField(null);
  };

  const saveInlineEdit = () => {
    if (!inlineEdit) return;
    const quantity = Number(inlineEdit.quantity);
    const price = Number(inlineEdit.price);
    const fee = Number(inlineEdit.fee || "0");
    if (!inlineEdit.date || !inlineEdit.accountId || !inlineEdit.ticker || !quantity || !price) {
      return;
    }
    const totalAmount = quantity * price + fee;
    const cashImpact = inlineEdit.side === "buy" ? -totalAmount : totalAmount;
    const updated = trades.map((t) =>
      t.id === inlineEdit.id
        ? {
            ...t,
            date: inlineEdit.date,
            accountId: inlineEdit.accountId,
            ticker: inlineEdit.ticker,
            name: inlineEdit.name || inlineEdit.ticker,
            side: inlineEdit.side,
            quantity,
            price,
            fee,
            totalAmount,
            cashImpact
          }
        : t
    );
    onChangeTrades(updated);
    setInlineEdit(null);
    setInlineEditField(null);
  };


    return (
    <div>
      {/* StocksView 렌더링 확인 */}
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

            className={showUSD ? "primary" : "secondary"}

            onClick={() => setShowUSD((v) => !v)}

          >

            {showUSD ? "USD ON" : "USD OFF"}

          </button>

          <button

            type="button"

            className="secondary"

            onClick={handleRefreshQuotes}

            disabled={isLoadingQuotes}

          >

            {isLoadingQuotes ? "갱신 중..." : "시세 갱신 (전체)"}

          </button>
          <button
            type="button"
            className="secondary"
            onClick={onLoadInitialTickers}
            disabled={isLoadingTickerDatabase}
          >
            {isLoadingTickerDatabase ? "불러오는 중..." : "종목 불러오기"}
          </button>

          {yahooUpdatedAt && (

            <span className="hint">마지막 갱신: {new Date(yahooUpdatedAt).toLocaleString()}</span>

          )}

        </div>

      </div>



      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div
            style={{
              background: "#f8fafc",
              color: "#0f172a",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e2e8f0"
            }}
          >
            <div style={{ color: "#475569", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>총 평가액</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{formatKRW(totals.totalMarketValue)}</div>
          </div>
          <div style={{ background: "#0d9488", color: "#ffffff", padding: 12, borderRadius: 12 }}>
            <div style={{ color: "#ffffff", fontSize: 14, fontWeight: 600, marginBottom: 4, opacity: 0.9 }}>일일 손익</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff" }}>
              {formatKRW(totals.dayPnl)} ({totals.totalMarketValue ? ((totals.dayPnl / totals.totalMarketValue) * 100).toFixed(2) : "0.00"}%)
            </div>
          </div>
          <div style={{ background: "#f8fafc", color: "#0f172a", padding: 12, borderRadius: 12, border: "1px solid #e2e8f0" }}>
            <div style={{ color: "#64748b", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>총 손익</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
              {formatKRW(totals.totalPnl)} ({(totalReturnRate * 100).toFixed(2)}%)
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>총매입 {formatKRW(totals.totalCost)}</div>
          </div>
        </div>
      </div>

      <div
        className="stocks-section-tabs"
        style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}
      >
        <button
          type="button"
          className={activeStocksSection === "portfolio" ? "primary" : "secondary"}
          onClick={() => setActiveStocksSection("portfolio")}
        >
          거래/평가
        </button>
        <button
          type="button"
          className={activeStocksSection === "dca" ? "primary" : "secondary"}
          onClick={() => setActiveStocksSection("dca")}
        >
          DCA
        </button>
        <button
          type="button"
          className={activeStocksSection === "quotes" ? "primary" : "secondary"}
          onClick={() => setActiveStocksSection("quotes")}
        >
          주식시세
        </button>
      </div>

      {activeStocksSection === "portfolio" ? (
        <>
          <div className="two-column">
            <form className="card" onSubmit={handleTradeSubmit} style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>
            {tradeForm.side === "sell" ? "주식 매도" : "주식 거래 입력 (매수)"}
          </h3>
          <p className="hint" style={{ margin: "0 0 12px 0", fontSize: 12 }}>기본 통화: 원화(KRW) 기준으로 표시합니다.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px 12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>거래일</span>
            <input
              type="date"
              value={tradeForm.date}
              onChange={(e) => setTradeForm({ ...tradeForm, date: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>증권계좌</span>
            <select
              value={tradeForm.accountId}
              onChange={(e) => setTradeForm({ ...tradeForm, accountId: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            >
              <option value="">선택</option>
              {accounts
                .filter((a) => a.type === "securities")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
            </select>
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                티커
              </span>
              <div style={{ position: "relative" }}>
                <Autocomplete
                  value={tradeForm.ticker}
                  onChange={(val) =>
                    setTradeForm((prev) => ({
                      ...prev,
                      ticker: val.toUpperCase(),
                      name: "" // 티커 변경 시 이름 초기화
                    }))
                  }
                  options={tickerSuggestions.map((t) => ({
                    value: t.ticker,
                    label: t.name,
                    subLabel: `${t.market === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"} ${t.exchange || ""}`
                  }))}
                  onSelect={(option) => {
                    setTradeForm((prev) => ({
                      ...prev,
                      ticker: option.value,
                      name: option.label || ""
                    }));
                  }}
                  placeholder="티커 또는 종목명 입력 (예: 005930, 삼성, AAPL, Apple)"
                />
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>수량</span>
            <input
              type="number"
              min={0}
              value={tradeForm.quantity}
              onChange={(e) => setTradeForm({ ...tradeForm, quantity: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>단가</span>
            <input
              type="number"
              min={0}
              value={tradeForm.price}
              onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>수수료+세금</span>
            <input
              type="number"
              min={0}
              value={tradeForm.fee}
              onChange={(e) => setTradeForm({ ...tradeForm, fee: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            {tradeForm.side === "sell" && !isEditingTrade && (
                <button
                  type="button"
                onClick={() => {
                  setTradeForm({
                    ...createDefaultTradeForm(),
                    accountId: tradeForm.accountId
                  });
                }} 
                className="secondary"
                style={{ padding: "8px 16px", fontSize: 14 }}
              >
                매수로 전환
                </button>
            )}
            {isEditingTrade && (
              <button type="button" onClick={resetTradeForm} style={{ padding: "8px 16px", fontSize: 14 }}>
                취소
                </button>
            )}
            <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
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
                    subLabel: `${t.market === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"} ${t.exchange || ""}`
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
                {isSearchingQuote ? "검색 중..." : "시세 조회"}
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
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{formatPriceWithCurrency(tickerInfo.price, tickerInfo.currency)}</div>
                        ) : (
                      <div className="muted">가격 없음</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
              <div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
                티커를 입력하고 시세 조회 버튼을 클릭하세요.
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
              - 현재가 {formatPriceWithCurrency(tickerInfo.price, tickerInfo.currency)}
            </>
          )}
        </p>
      )}
      {quoteError && (
        <p className="error-text" style={{ marginTop: 4 }}>
          {quoteError}
        </p>
      )}

      <h3>보유 종목 현황 (계좌별)</h3>
      {positionsByAccount.map((group) => {
        const balance = balances.find((b) => b.account.id === group.accountId);
        const cashBalance = balance?.currentBalance ?? 0;
        const stockValue = group.rows.reduce((sum, p) => sum + p.marketValue, 0);
        const totalAsset = cashBalance + stockValue;
        
        return (
        <div key={group.accountId}>
          <h4 style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
            <span>{group.accountName}</span>
            <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
              현금+예수금: <span className={cashBalance >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(cashBalance))}</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
              주식평가액: {formatKRW(Math.round(stockValue))}
            </span>
            <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>
              총자산: <span className={totalAsset >= 0 ? "positive" : "negative"}>{formatKRW(Math.round(totalAsset))}</span>
            </span>
          </h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("ticker")}>
                    티커 <span className="arrow">{sortIndicator(positionSort.key, "ticker", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("name")}>
                    종목명 <span className="arrow">{sortIndicator(positionSort.key, "name", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("quantity")}>
                    보유수량 <span className="arrow">{sortIndicator(positionSort.key, "quantity", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("avgPrice")}>
                    평균단가 <span className="arrow">{sortIndicator(positionSort.key, "avgPrice", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("marketPrice")}>
                    현재가 <span className="arrow">{sortIndicator(positionSort.key, "marketPrice", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("diff")}>
                    수익 <span className="arrow">{sortIndicator(positionSort.key, "diff", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("marketValue")}>
                    평가금액 <span className="arrow">{sortIndicator(positionSort.key, "marketValue", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("totalBuyAmount")}>
                    총매입금액 <span className="arrow">{sortIndicator(positionSort.key, "totalBuyAmount", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("pnl")}>
                    평가손익 <span className="arrow">{sortIndicator(positionSort.key, "pnl", positionSort.direction)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-header" onClick={() => togglePositionSort("pnlRate")}>
                    수익률 <span className="arrow">{sortIndicator(positionSort.key, "pnlRate", positionSort.direction)}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((p) => {
                const diff = p.diff;
                const diffClass = diff >= 0 ? "positive" : "negative";
                return (
                  <tr key={`${group.accountId}-${p.ticker}`}>
                    <td 
                      onClick={() => handlePositionClick(p)}
                      style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                      title="클릭하여 매도하기"
                    >
                      {p.ticker}
                    </td>
                    <td 
                      onClick={() => handlePositionClick(p)}
                      style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                      title="클릭하여 매도하기"
                    >
                      {p.name}
                    </td>
                    <td className="number">{formatNumber(p.quantity)}</td>
                    <td className="number">{formatKRW(Math.round(p.avgPrice))}</td>
                    <td className="number">
                      {formatPriceWithCurrency(
                        p.currency === "USD" && p.originalMarketPrice != null 
                          ? p.originalMarketPrice 
                          : p.displayMarketPrice, 
                        p.currency
                      )}
                    </td>
                    <td className={`number ${diffClass}`}>
                      {diff === 0 ? "-" : formatKRW(diff)}
                    </td>
                    <td className={`number ${p.marketValue >= p.totalBuyAmount ? "positive" : "negative"}`}>
                      {formatKRW(p.marketValue)}
                    </td>
                    <td className="number">{formatKRW(p.totalBuyAmount)}</td>
                    <td className={`number ${p.pnl >= 0 ? "positive" : "negative"}`}>
                      {formatKRW(p.pnl)}
                    </td>
                    <td className={`number ${p.pnl >= 0 ? "positive" : "negative"}`}>
                      {(p.pnlRate * 100).toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })}

      <h3>거래 내역</h3>
      {(() => {
        const totalBuyAmount = trades.filter(t => t.side === "buy").reduce((sum, t) => sum + t.totalAmount, 0);
        const totalSellAmount = trades.filter(t => t.side === "sell").reduce((sum, t) => sum + t.totalAmount, 0);
        const totalFee = trades.reduce((sum, t) => sum + t.fee, 0);
        const totalCashImpact = trades.reduce((sum, t) => sum + t.cashImpact, 0);
        return (
          <div className="card" style={{ marginBottom: 16, padding: 12 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매수:</span>
                <span className="negative">{formatKRW(Math.round(totalBuyAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 매도:</span>
                <span className="positive">{formatKRW(Math.round(totalSellAmount))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>총 수수료:</span>
                <span className="negative">{formatKRW(Math.round(totalFee))}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>순 현금 변동:</span>
                <span className={totalCashImpact >= 0 ? "positive" : "negative"}>
                  {formatKRW(Math.round(totalCashImpact))}
                </span>
              </div>
            </div>
          </div>
        );
      })()}
      <table className="data-table trades-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>순서</th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("date")}>
                날짜 <span className="arrow">{sortIndicator(tradeSort.key, "date", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("accountId")}>
                계좌 <span className="arrow">{sortIndicator(tradeSort.key, "accountId", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("ticker")}>
                티커 <span className="arrow">{sortIndicator(tradeSort.key, "ticker", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("name")}>
                종목명 <span className="arrow">{sortIndicator(tradeSort.key, "name", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("side")}>
                매수/매도 <span className="arrow">{sortIndicator(tradeSort.key, "side", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("quantity")}>
                수량 <span className="arrow">{sortIndicator(tradeSort.key, "quantity", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("price")}>
                단가 <span className="arrow">{sortIndicator(tradeSort.key, "price", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("fee")}>
                수수료+세금 <span className="arrow">{sortIndicator(tradeSort.key, "fee", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("totalAmount")}>
                총금액 <span className="arrow">{sortIndicator(tradeSort.key, "totalAmount", tradeSort.direction)}</span>
              </button>
            </th>
            <th>
              <button type="button" className="sort-header" onClick={() => toggleTradeSort("cashImpact")}>
                현금변동 <span className="arrow">{sortIndicator(tradeSort.key, "cashImpact", tradeSort.direction)}</span>
              </button>
            </th>
            <th style={{ width: 60 }}>작업</th>
          </tr>
        </thead>
        <tbody>
          {sortTrades(trades).map((t, index) => (
            <tr
              key={t.id}
              draggable
              onDragOver={(e) => {
                if (!draggingTradeId) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                if (!draggingTradeId) return;
                e.preventDefault();
                handleReorderTrade(draggingTradeId, index);
                setDraggingTradeId(null);
              }}
              onDragStart={() => setDraggingTradeId(t.id)}
              onDragEnd={() => setDraggingTradeId(null)}
            >
              <td className="drag-cell">
                <span className="drag-handle" title="잡고 위/아래로 끌어서 순서 변경">☰</span>
              </td>
              <td 
                onDoubleClick={() => startInlineEdit(t, "date")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {inlineEdit?.id === t.id && inlineEditField === "date" ? (
                  <input
                    type="date"
                    value={inlineEdit.date}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, date: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus
                    style={{ padding: "2px 4px", fontSize: 13 }}
                  />
                ) : (
                  t.date
                )}
              </td>
              <td 
                onDoubleClick={() => startInlineEdit(t, "accountId")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {inlineEdit?.id === t.id && inlineEditField === "accountId" ? (
                  <select
                    value={inlineEdit.accountId}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, accountId: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus
                    style={{ padding: "2px 4px", fontSize: 13 }}
                  >
                    <option value="">선택</option>
                    {accounts
                      .filter((a) => a.type === "securities")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id} - {a.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  t.accountId
                )}
              </td>
              <td 
                onClick={() => startEditTrade(t)}
                style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                title="클릭하여 편집하기"
              >
                {t.ticker}
              </td>
              <td 
                className="name-cell" 
                onClick={() => startEditTrade(t)}
                style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
                title="클릭하여 편집하기"
              >
                {t.name}
              </td>
              <td>{sideLabel[t.side]}</td>
              <td 
                className="number"
                onDoubleClick={() => startInlineEdit(t, "quantity")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {inlineEdit?.id === t.id ? (
                  <input
                    type="number"
                    value={inlineEdit.quantity}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, quantity: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus={inlineEditField === "quantity"}
                    style={{ width: "80px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                  />
                ) : (
                  formatNumber(t.quantity)
                )}
              </td>
              <td 
                className={`number ${t.price >= 0 ? "positive" : "negative"}`}
                onDoubleClick={() => startInlineEdit(t, "price")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {inlineEdit?.id === t.id ? (
                  <input
                    type="number"
                    value={inlineEdit.price}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, price: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus={inlineEditField === "price"}
                    style={{ width: "100px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                  />
                ) : (
                  formatKRW(t.price)
                )}
              </td>
              <td 
                className={`number ${t.fee >= 0 ? "positive" : "negative"}`}
                onDoubleClick={() => startInlineEdit(t, "fee")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {inlineEdit?.id === t.id ? (
                  <input
                    type="number"
                    value={inlineEdit.fee}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, fee: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus={inlineEditField === "fee"}
                    style={{ width: "100px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                  />
                ) : (
                  formatKRW(t.fee)
                )}
              </td>
              <td 
                className={`number ${t.totalAmount >= 0 ? "positive" : "negative"}`}
                onDoubleClick={() => startInlineEdit(t, "totalAmount")}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정 (수량 자동 조정)"
              >
                {inlineEdit?.id === t.id && inlineEditField === "totalAmount" ? (
                  <input
                    type="number"
                    value={Math.round(Number(inlineEdit.quantity) * Number(inlineEdit.price) + Number(inlineEdit.fee || 0))}
                    onChange={(e) => {
                      const newTotal = Number(e.target.value);
                      const fee = Number(inlineEdit.fee || 0);
                      const price = Number(inlineEdit.price);
                      if (price > 0) {
                        const newQuantity = (newTotal - fee) / price;
                        setInlineEdit({ ...inlineEdit, quantity: String(Math.max(0, Math.round(newQuantity * 100) / 100)) });
                      }
                    }}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit();
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    autoFocus
                    style={{ width: "120px", padding: "2px 4px", fontSize: 13, textAlign: "right" }}
                  />
                ) : (
                  formatKRW(t.totalAmount)
                )}
              </td>
              <td className={`number ${t.cashImpact >= 0 ? "positive" : "negative"}`}>
                {formatKRW(t.cashImpact)}
              </td>
              <td style={{ width: 60, padding: "4px" }}>
                <button 
                  type="button" 
                  className="danger" 
                  onClick={() => handleDeleteTrade(t.id)}
                  style={{ padding: "4px 8px", fontSize: 12 }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
        </>
      ) : activeStocksSection === "dca" ? (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>정액매수 (DCA)</h3>
            {dcaCalc?.market && (
              <span className="pill" style={{ background: dcaCalc.market.isOpen ? "#e0f2fe" : "#f1f5f9", color: dcaCalc.market.isOpen ? "#0284c7" : "#475569" }}>
                {dcaCalc.market.label} · {dcaCalc.market.session}
              </span>
            )}
          </div>
          <p className="hint" style={{ margin: "6px 0 14px 0" }}>
            계좌, 종목, 금액(KRW)을 입력하면 환율과 시세를 반영해 예상 매수 수량을 계산합니다. 시장 개장 시간에만 기록됩니다.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 12px", marginBottom: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>증권계좌</span>
              <select
                value={dcaForm.accountId}
                onChange={(e) => setDcaForm((prev) => ({ ...prev, accountId: e.target.value }))}
                style={{ padding: "6px 8px", fontSize: 14 }}
              >
                <option value="">선택</option>
                {accounts
                  .filter((a) => a.type === "securities")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>티커</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  value={dcaForm.ticker}
                  onChange={(e) => setDcaForm((prev) => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                  placeholder="예: 005930, AAPL"
                  style={{ flex: 1, padding: "6px 8px", fontSize: 14 }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={handleDcaFetchPrice}
                  disabled={isLoadingDca || !dcaForm.ticker.trim()}
                  style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
                >
                  {isLoadingDca ? "조회 중..." : "시세 불러오기"}
                </button>
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>투입 금액 (KRW)</span>
              <input
                type="number"
                min={0}
                value={dcaForm.amount}
                onChange={(e) => setDcaForm((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="원화 금액을 입력하세요"
                style={{ padding: "6px 8px", fontSize: 14 }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              <span className="muted" style={{ fontSize: 13 }}>현재가: </span>
              {dcaCalc?.price && dcaCalc.price > 0 ? (
                <span style={{ fontWeight: 600 }}>
                  {dcaCalc.currency === "USD" && dcaCalc.originalPrice
                    ? `${formatUSD(dcaCalc.originalPrice)} USD`
                    : formatKRW(Math.round(dcaCalc.price))}
                  {dcaCalc.currency === "USD" && fxRate && (
                    <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
                      (약 {formatKRW(Math.round(dcaCalc.price))})
                    </span>
                  )}
                </span>
              ) : (
                <span className="muted">시세를 불러오세요</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              환율: {fxRate ? `USD/KRW ${formatNumber(fxRate)}` : "미확인"}
            </div>
            <div style={{ fontWeight: 600 }}>
              예상 매수 수량: {dcaCalc && dcaCalc.price > 0 ? dcaCalc.shares.toFixed(6) : "-"} 주
            </div>
            <div>
              예상 소요금액: {dcaCalc && dcaCalc.price > 0 ? formatKRW(Math.round(dcaCalc.estimatedCost)) : "-"}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              남는 금액(미사용): {dcaCalc && dcaCalc.price > 0 ? formatKRW(Math.round(dcaCalc.remainder)) : "-"}
            </div>
          </div>

          {dcaMessage && (
            <p className="hint" style={{ marginTop: 10 }}>
              {dcaMessage}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setDcaForm({ accountId: dcaForm.accountId, ticker: "", amount: "" })}
            >
              리셋
            </button>
            <button
              type="button"
              className="primary"
              onClick={handleDcaSubmit}
              disabled={
                !dcaForm.accountId ||
                !dcaForm.ticker.trim() ||
                !dcaForm.amount ||
                Number(dcaForm.amount) <= 0 ||
                (dcaCalc?.currency === "USD" && !fxRate)
              }
            >
              DCA 매수
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: "0 0 8px 0" }}>DCA 진행 중 목록</h4>
            {dcaPlans.length === 0 && <p className="hint">등록된 DCA 플랜이 없습니다.</p>}
            {dcaPlans.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>티커</th>
                      <th>계좌</th>
                      <th>금액(원)</th>
                      <th>수수료</th>
                      <th>시작일</th>
                      <th>마지막 실행</th>
                      <th>상태</th>
                      <th>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dcaPlans.map((p) => (
                      <tr key={p.id}>
                        <td>{p.ticker}</td>
                        <td>{p.accountId}</td>
                        <td className="number">{formatKRW(Math.round(p.amount))}</td>
                        <td className="number">{p.fee ? formatKRW(Math.round(p.fee)) : "-"}</td>
                        <td>{p.startDate}</td>
                        <td>{p.lastRunDate ?? "-"}</td>
                        <td>
                          <span className={`pill ${p.active ? "success" : "muted"}`} style={{ padding: "2px 8px", fontSize: 11 }}>
                            {p.active ? "진행중" : "일시정지"}
                          </span>
                        </td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" className="secondary" onClick={() => toggleDcaPlan(p.id)} style={{ padding: "4px 10px", fontSize: 12 }}>
                            {p.active ? "일시정지" : "재개"}
                          </button>
                          <button type="button" className="danger" onClick={() => deleteDcaPlan(p.id)} style={{ padding: "4px 10px", fontSize: 12 }}>
                            취소
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              className={activeQuoteMarket === "korea" ? "primary" : "secondary"}
              onClick={() => setActiveQuoteMarket("korea")}
            >
              한국주식
            </button>
            <button
              type="button"
              className={activeQuoteMarket === "us" ? "primary" : "secondary"}
              onClick={() => setActiveQuoteMarket("us")}
            >
              미국주식
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            등록된 티커별 시세를 시장 단위로 확인하고 야후 시세 갱신 버튼을 눌러 최신 상태로 유지하세요.
          </p>
          <div style={{ overflowX: "auto" }}>
            {activeQuoteMarket === "korea"
              ? renderQuoteTable(koreanQuotes, "한국주식")
              : renderQuoteTable(usQuotes, "미국주식")}
          </div>
        </div>
      )}
    </div>
  );
};
