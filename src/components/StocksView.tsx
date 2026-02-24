import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Label
} from "recharts";
import { Autocomplete, type AutocompleteOption } from "./Autocomplete";
import { StockDetailModal } from "./StockDetailModal";
import { FxFormSection } from "./stocks/FxFormSection";
import { FxHistorySection } from "./stocks/FxHistorySection";
import { PortfolioChartsSection } from "./stocks/PortfolioChartsSection";
import { StockStatsCard } from "./stocks/StockStatsCard";
import { PresetSection } from "./stocks/PresetSection";
import { TradeHistorySection } from "./stocks/TradeHistorySection";
import { PositionListSection } from "./stocks/PositionListSection";
import { TargetPortfolioSection } from "./stocks/TargetPortfolioSection";
import type { Account, StockPrice, StockTrade, TradeSide, SymbolInfo, TickerInfo, StockPreset, LedgerEntry, TargetPortfolio } from "../types";
import type { AccountBalanceRow } from "../calculations";
import { computePositions } from "../calculations";
import { fetchYahooQuotes, searchYahooSymbol } from "../yahooFinanceApi";
import { saveTickerDatabaseBackup, saveTickerToJson } from "../storage";
import { formatNumber, formatKRW, formatUSD, formatShortDate } from "../utils/format";
import { isUSDStock, isKRWStock, canonicalTickerForMatch } from "../utils/tickerUtils";
import { toast } from "react-hot-toast";
import { validateDate, validateTicker, validateRequired, validateQuantity, validateAmount, validateAccountTickerCurrency } from "../utils/validation";
import { ERROR_MESSAGES } from "../constants/errorMessages";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  trades: StockTrade[];
  prices: StockPrice[];
  customSymbols: SymbolInfo[];
  tickerDatabase: TickerInfo[];
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeCustomSymbols: (next: SymbolInfo[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[]) => void;
  onLoadInitialTickers: () => Promise<void>;
  isLoadingTickerDatabase: boolean;
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
  isLoadingTickerDatabase,
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
        const results = await fetchYahooQuotes([symbol]);
        if (results.length > 0) {
          const r = results[0];
          // 종목명 우선순위: API에서 가져온 이름 > tickerDatabase > 기존 tradeForm.name > 티커
          const stockName = r.name || 
            tickerDatabase.find(t => canonicalTickerForMatch(t.ticker) === symbol)?.name || 
            tradeForm.name || 
            symbol;
          
          // 시세 정보 업데이트
          setTickerInfo({
            ticker: symbol,
            name: stockName,
            price: r.price,
            currency: r.currency
          });
          
          // tradeForm의 name도 업데이트 (종목명 필드에 표시되도록)
          setTradeForm((prev) => ({
            ...prev,
            name: prev.name || stockName
          }));
          
          // ticker.json에 저장
          if (r.name) {
            const market = isKRWStock(symbol) ? 'KR' : 'US';
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

  const positions = useMemo(() => computePositions(trades, prices, accounts), [
    trades,
    prices,
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
      const pNorm = canonicalTickerForMatch(p.ticker);
      const originalPriceInfo = prices.find((x) => canonicalTickerForMatch(x.ticker) === pNorm);
      const currency = originalPriceInfo?.currency || (isUSDStock(p.ticker) ? "USD" : "KRW");
      const isUSD = currency === "USD";
      const displayMarketPrice = isUSD
        ? (originalPriceInfo?.price ?? p.marketPrice)
        : (originalPriceInfo?.price ?? p.marketPrice);
      const originalMarketPrice = isUSD ? originalPriceInfo?.price : undefined;

      // 평가금액/손익 계산 (USD 종목은 USD 기준, KRW 종목은 KRW 기준)
      const marketValue = displayMarketPrice * p.quantity;
      const pnl = marketValue - p.totalBuyAmount;
      const pnlRate = p.totalBuyAmount > 0 ? pnl / p.totalBuyAmount : 0;
      // 단가와 현재가 차이
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
  }, [positions, prices]);

  const totals = useMemo(() => {
    const totalMarketValue = positionsWithPrice.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCost = positionsWithPrice.reduce((sum, p) => sum + p.totalBuyAmount, 0);
    const totalPnl = positionsWithPrice.reduce((sum, p) => sum + p.pnl, 0);
    const dayPnl = positionsWithPrice.reduce((sum, p) => {
      const priceInfo = prices.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(p.ticker));
      const change = priceInfo?.change ?? 0;
      return sum + change * p.quantity;
    }, 0);
    return { totalMarketValue, totalCost, totalPnl, dayPnl };
  }, [positionsWithPrice, prices]);

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
  }, [dcaForm, prices, fxRate, trades]);

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
      console.warn("FX fetch failed", err);
    }
  };

  // 기존 달러 종목 거래의 cashImpact를 원화로 재계산 (한 번만 실행)
  const hasRecalculatedRef = React.useRef(false);
  React.useEffect(() => {
    if (!fxRate || trades.length === 0 || hasRecalculatedRef.current) return;
    
    const needsUpdate = trades.some(t => {
      const isUSD = isUSDStock(t.ticker);
      const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(t.ticker));
      const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
      if (currency !== "USD") return false;
      
      // totalAmount가 달러로 저장되어 있고, cashImpact가 원화로 변환되지 않은 경우
      // (cashImpact의 절댓값이 totalAmount와 비슷하면 원화 변환이 안 된 것으로 간주)
      const expectedKRW = Math.abs(t.totalAmount * fxRate);
      if (expectedKRW <= 0) return false;
      const currentImpact = Math.abs(t.cashImpact);
      // 10% 이상 차이나면 재계산 필요
      return Math.abs(currentImpact - expectedKRW) / expectedKRW > 0.1;
    });
    
    if (needsUpdate) {
      const updated = trades.map(t => {
        const isUSD = isUSDStock(t.ticker);
        const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(t.ticker));
        const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
        
        if (currency === "USD" && fxRate) {
          // totalAmount는 달러로 저장되어 있으므로 원화로 변환
          const totalAmountKRW = t.totalAmount * fxRate;
          const cashImpact = t.side === "buy" ? -totalAmountKRW : totalAmountKRW;
          
          // cashImpact가 이미 올바르게 계산되어 있으면 변경하지 않음
          const currentImpact = Math.abs(t.cashImpact);
          const expectedImpact = Math.abs(totalAmountKRW);
          if (expectedImpact <= 0) return t;
          if (Math.abs(currentImpact - expectedImpact) / expectedImpact > 0.1) {
            return { ...t, cashImpact };
          }
        }
        return t;
      });
      
      // 변경사항이 있으면 업데이트
      const hasChanges = updated.some((t, i) => t.cashImpact !== trades[i].cashImpact);
      if (hasChanges) {
        onChangeTrades(updated);
        hasRecalculatedRef.current = true;
        toast.success("달러 종목 거래의 계좌 잔액이 재계산되었습니다.");
      }
    }
  }, [fxRate, trades, prices, onChangeTrades]);

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

  const getPriceInfoForDca = (ticker: string) => {
    const symbol = canonicalTickerForMatch(ticker);
    const adjusted = prices.find((p) => canonicalTickerForMatch(p.ticker) === symbol);
    const original = prices.find((p) => canonicalTickerForMatch(p.ticker) === symbol);
    const priceKRW =
      adjusted?.price ??
      (original?.currency === "USD" && fxRate ? original.price * fxRate : original?.price ?? 0);
    const name =
      original?.name ||
      trades.find((t) => canonicalTickerForMatch(t.ticker) === symbol)?.name ||
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
          const market = isKRWStock(r.ticker) ? 'KR' : 'US';
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
    const isKoreaTicker = isKRWStock(symbol);
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
    const symbol = canonicalTickerForMatch(quoteSearchTicker.trim());
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
          const market = isKRWStock(symbol) ? 'KR' : 'US';
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
    // 매도 폼에 자동으로 정보 채우기
    const priceInfo = prices.find((pr) => pr.ticker === p.ticker);
    const currentPrice = priceInfo?.price ?? p.marketPrice;
    
    setTradeForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: p.accountId,
      ticker: p.ticker,
      name: p.name,
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
    // 매수 폼에 자동으로 정보 채우기
    const priceInfo = prices.find((pr) => pr.ticker === p.ticker);
    const currentPrice = priceInfo?.price ?? p.marketPrice;
    
    setTradeForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      accountId: p.accountId,
      ticker: p.ticker,
      name: p.name,
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
    const set = new Set<string>();
    customSymbols.forEach((s) => set.add(canonicalTickerForMatch(s.ticker)));
    trades.forEach((t) => set.add(canonicalTickerForMatch(t.ticker)));
    prices.forEach((p) => set.add(canonicalTickerForMatch(p.ticker)));
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
    
    // 수량 검증
    const quantityValidation = validateQuantity(tradeForm.quantity, false); // 정수만
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

    // 가격 검증 (소수점 허용 - USD 주식 가격 등)
    const priceValidation = validateAmount(tradeForm.price, false, 0.001, undefined, true); // 최소 0.001, 소수점 허용
    if (!priceValidation.valid) {
      errors.price = priceValidation.error || "";
    }
    
    // 수수료 검증 (선택적이지만 입력되면 유효해야 함)
    const feeTrimmed = tradeForm.fee?.trim() || "";
    if (feeTrimmed && feeTrimmed !== "0") {
      const feeValidation = validateAmount(feeTrimmed, false, 0);
      if (!feeValidation.valid) {
        errors.fee = feeValidation.error || "";
      }
    }
    
    return errors;
  }, [tradeForm, positions]);
  
  const isTradeFormValid = Object.keys(tradeFormValidation).length === 0;

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 검증 실패 시 제출 방지
    if (!isTradeFormValid) {
      const firstError = Object.values(tradeFormValidation)[0];
      if (firstError) {
        toast.error(firstError);
      }
      return;
    }
    
    const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
    const quantity = Number(tradeForm.quantity);
    let price = Number(tradeForm.price);
    const fee = Number(tradeForm.fee || "0");
    
    let accountId = tradeForm.accountId;
    if (!accountId) {
      const securitiesAccounts = accounts.filter(a => a.type === "securities");
      const recentAccount = trades.length > 0 
        ? trades[trades.length - 1].accountId 
        : securitiesAccounts[0]?.id || "";
      accountId = recentAccount;
    }
    
    let date = tradeForm.date;
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
    }
    
    if (!date || !accountId || !tickerClean || !quantity || !price) {
      if (!price) {
        toast.error(ERROR_MESSAGES.QUOTE_UNAVAILABLE);
      }
      return;
    }
    // 매도는 보유 종목 클릭으로만 가능, 매수는 기본값
    const side = tradeForm.side || "buy";
    
    // 선택된 계좌 확인
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      toast.error(ERROR_MESSAGES.ACCOUNT_REQUIRED);
      return;
    }
    const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean);
    const currencyValidation = validateAccountTickerCurrency(selectedAccount, tickerClean, priceInfo);
    if (!currencyValidation.valid) {
      toast.error(currencyValidation.error ?? "계좌와 종목 통화가 일치하지 않습니다.");
      return;
    }
    const isSecuritiesAccount = selectedAccount.type === "securities";
    const isUSD = isUSDStock(tickerClean);
    const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
    const isUSDCurrency = currency === "USD";
    const exchangeRate = isUSDCurrency && fxRate ? fxRate : 1;
    
    // 매수: totalAmount = quantity * price + fee (지불한 총액)
    // 매도: totalAmount = quantity * price - fee (받은 총액, 수수료 차감)
    const totalAmount = side === "buy" 
      ? quantity * price + fee 
      : quantity * price - fee;
    
    // cashImpact는 원화 기준으로 계산 (달러 종목은 환율 적용)
    // 증권계좌의 달러 종목은 USD 잔액에서 차감되므로 cashImpact는 0으로 설정
    const totalAmountKRW = totalAmount * exchangeRate;
    // 매수: cashImpact = -totalAmount (계좌에서 나감)
    // 매도: cashImpact = +totalAmount (계좌에 들어옴)
    // 증권계좌의 달러 종목은 USD 잔액에서 처리되므로 cashImpact는 0
    const cashImpact = (isSecuritiesAccount && isUSDCurrency) 
      ? 0 
      : (side === "buy" ? -totalAmountKRW : totalAmountKRW);
    
    // 종목명 우선순위: tradeForm.name > prices > trades > tickerDatabase > 티커
    const fallbackName =
      tradeForm.name ||
      prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean)?.name ||
      trades.find((t) => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
      tickerDatabase.find(t => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
      tickerClean;

    if (tradeForm.id) {
      // 거래 수정: 기존 거래의 USD 영향 제거 후 새 USD 영향 적용
      const oldTrade = trades.find((t) => t.id === tradeForm.id);
      let usdImpact = 0;
      
      if (isSecuritiesAccount && oldTrade) {
        // 기존 거래가 달러 종목이었는지 확인
        const oldPriceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(oldTrade.ticker));
        const oldIsUSD = oldPriceInfo?.currency === "USD" || isUSDStock(oldTrade.ticker);
        
        if (oldIsUSD) {
          // 기존 거래의 USD 영향 되돌리기
          const oldUsdImpact = oldTrade.side === "buy" ? oldTrade.totalAmount : -oldTrade.totalAmount;
          usdImpact -= oldUsdImpact;
        }
        
        // 새 거래가 달러 종목인 경우 USD 영향 적용
        if (isUSDCurrency) {
          const newUsdImpact = side === "buy" ? -totalAmount : totalAmount;
          usdImpact += newUsdImpact;
        }
      } else if (isSecuritiesAccount && isUSDCurrency) {
        // 새로 달러 종목으로 변경
        usdImpact = side === "buy" ? -totalAmount : totalAmount;
      }
      
      // USD 잔액 업데이트 준비
      let updatedAccounts = accounts;
      if (isSecuritiesAccount && onChangeAccounts && usdImpact !== 0) {
        updatedAccounts = accounts.map((a) => {
          if (a.id === accountId) {
            const currentUsdBalance = a.usdBalance ?? 0;
            const newUsdBalance = currentUsdBalance + usdImpact;
            return { ...a, usdBalance: newUsdBalance };
          }
          return a;
        });
      }
      
      // 거래 저장 먼저 (함수형 업데이트로 최신 상태 보장)
      onChangeTrades((prevTrades) =>
        prevTrades.map((t) =>
          t.id === tradeForm.id
            ? {
                ...t,
                date: date,
                accountId: accountId,
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
        )
      );
      
      // USD 잔액 업데이트 (거래 저장 후 약간의 지연)
      if (isSecuritiesAccount && onChangeAccounts && usdImpact !== 0) {
        setTimeout(() => {
          onChangeAccounts(updatedAccounts);
        }, 0);
      }
    } else {
      // 새 거래 추가
      const id = `T${Date.now()}`;
      const trade: StockTrade = {
        id,
        date: date,
        accountId: accountId,
        ticker: tickerClean,
        name: fallbackName,
        side,
        quantity,
        price,
        fee,
        totalAmount,
        cashImpact
      };
      
      // 증권계좌에서 달러 종목 거래 시 USD 잔액 업데이트 준비
      let updatedAccounts = accounts;
      if (isSecuritiesAccount && isUSDCurrency && onChangeAccounts) {
        const usdImpact = side === "buy" ? -totalAmount : totalAmount; // 매수: USD 차감, 매도: USD 증가
        updatedAccounts = accounts.map((a) => {
          if (a.id === accountId) {
            const currentUsdBalance = a.usdBalance ?? 0;
            const newUsdBalance = currentUsdBalance + usdImpact;
            return { ...a, usdBalance: newUsdBalance };
          }
          return a;
        });
      }
      
      // 거래 저장 먼저 (함수형 업데이트로 최신 상태 보장)
      onChangeTrades((prevTrades) => [trade, ...prevTrades]);
      
      // 증권계좌에서 달러 종목 거래 시 USD 잔액 업데이트 (거래 저장 후 약간의 지연)
      if (isSecuritiesAccount && isUSDCurrency && onChangeAccounts) {
        // React 상태 업데이트가 완료된 후 계좌 업데이트
        setTimeout(() => {
          onChangeAccounts(updatedAccounts);
        }, 0);
      }
    }
    setTradeForm((prev) => ({
      ...createDefaultTradeForm(),
      side: "buy", // 매도 후에는 다시 매수 모드로 리셋
      accountId: prev.accountId || accountId || ""
    }));
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

      // 환율 계산
      let priceKRW = quote.price;
      if (currency === "USD" && fx) {
        priceKRW = quote.price * fx;
      }

      // 매수 수량 계산
      const shares = plan.amount / priceKRW;
      const quantity = Number(shares.toFixed(6));
      const totalAmount = quantity * priceKRW;
      const fee = plan.fee ?? 0;
      const finalAmount = totalAmount + fee;

      // 매수 기록 생성
      const trade: StockTrade = {
        id: `DCA-${plan.id}-${today}-${Math.random().toString(36).substr(2, 9)}`,
        date: today,
        accountId: plan.accountId,
        ticker: plan.ticker,
        name: quote.name ?? plan.ticker,
        side: "buy",
        quantity,
        price: Math.round(priceKRW),
        fee,
        totalAmount: finalAmount,
        cashImpact: -finalAmount
      };

      // 거래 기록 추가
      onChangeTrades([trade, ...trades]);

      // 평가액 계산 (현재 가격 기준)
      const marketValue = quantity * priceKRW;
      const profit = marketValue - finalAmount;
      const profitRate = (profit / finalAmount) * 100;
      
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

          // 환율 계산
          let priceKRW = q.price;
          if (currency === "USD" && fx) {
            priceKRW = q.price * fx;
          }

          // 매수 수량 계산
          const shares = plan.amount / priceKRW;
          const quantity = Number(shares.toFixed(6));
          const totalAmount = quantity * priceKRW;
          const fee = plan.fee ?? 0;
          const finalAmount = totalAmount + fee;

          // 매수 기록 생성
          const trade: StockTrade = {
            id: `DCA-${plan.id}-${today}-${Math.random().toString(36).substr(2, 9)}`,
            date: today,
            accountId: plan.accountId,
            ticker: plan.ticker,
            name: q.name ?? plan.ticker,
            side: "buy",
            quantity,
            price: Math.round(priceKRW),
            fee,
            totalAmount: finalAmount,
            cashImpact: -finalAmount
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
      // Ctrl+S: 저장 (handleTradeSubmit 로직 직접 구현)
      if (e.ctrlKey && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
        const quantity = Number(tradeForm.quantity);
        const price = Number(tradeForm.price);
        const fee = Number(tradeForm.fee || "0");
        if (tradeForm.date && tradeForm.accountId && tickerClean && quantity && price) {
          const side = tradeForm.side || "buy";
          
          // 선택된 계좌 확인
          const selectedAccount = accounts.find((a) => a.id === tradeForm.accountId);
          if (!selectedAccount) {
            toast.error(ERROR_MESSAGES.ACCOUNT_REQUIRED);
            return;
          }
          const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean);
          const currencyValidation = validateAccountTickerCurrency(selectedAccount, tickerClean, priceInfo);
          if (!currencyValidation.valid) {
            toast.error(currencyValidation.error ?? "계좌와 종목 통화가 일치하지 않습니다.");
            return;
          }
          const isSecuritiesAccount = selectedAccount.type === "securities";
          const isUSD = isUSDStock(tickerClean);
          const currency = priceInfo?.currency || (isUSD ? "USD" : "KRW");
          const isUSDCurrency = currency === "USD";
          const exchangeRate = isUSDCurrency && fxRate ? fxRate : 1;
          
          // 매수: totalAmount = quantity * price + fee (지불한 총액)
          // 매도: totalAmount = quantity * price - fee (받은 총액, 수수료 차감)
          const totalAmount = side === "buy" 
            ? quantity * price + fee 
            : quantity * price - fee;
          
          // cashImpact는 원화 기준으로 계산 (달러 종목은 환율 적용)
          // 증권계좌의 달러 종목은 USD 잔액에서 차감되므로 cashImpact는 0으로 설정
          const totalAmountKRW = totalAmount * exchangeRate;
          // 매수: cashImpact = -totalAmount (계좌에서 나감)
          // 매도: cashImpact = +totalAmount (계좌에 들어옴)
          // 증권계좌의 달러 종목은 USD 잔액에서 처리되므로 cashImpact는 0
          const cashImpact = (isSecuritiesAccount && isUSDCurrency) 
            ? 0 
            : (side === "buy" ? -totalAmountKRW : totalAmountKRW);
          // 종목명 우선순위: tradeForm.name > prices > trades > tickerDatabase > 티커
          const fallbackName =
            tradeForm.name ||
            prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean)?.name ||
            trades.find((t) => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
            tickerDatabase.find(t => canonicalTickerForMatch(t.ticker) === tickerClean)?.name ||
            tickerClean;

          // 증권계좌에서 달러 종목 거래 시 USD 잔액 업데이트 준비
          let updatedAccounts = accounts;
          if (isSecuritiesAccount && isUSDCurrency && onChangeAccounts) {
            const usdImpact = side === "buy" ? -totalAmount : totalAmount; // 매수: USD 차감, 매도: USD 증가
            updatedAccounts = accounts.map((a) => {
              if (a.id === tradeForm.accountId) {
                const currentUsdBalance = a.usdBalance ?? 0;
                return { ...a, usdBalance: currentUsdBalance + usdImpact };
              }
              return a;
            });
          }

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
            
            // USD 잔액 업데이트 (거래 저장 후 약간의 지연)
            if (isSecuritiesAccount && isUSDCurrency && onChangeAccounts) {
              setTimeout(() => {
                onChangeAccounts(updatedAccounts);
              }, 0);
            }
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
            
            // USD 잔액 업데이트 (거래 저장 후 약간의 지연)
            if (isSecuritiesAccount && isUSDCurrency && onChangeAccounts) {
              setTimeout(() => {
                onChangeAccounts(updatedAccounts);
              }, 0);
            }
          }
          setTradeForm((prev) => ({
            ...createDefaultTradeForm(),
            side: "buy",
            accountId: prev.accountId || tradeForm.accountId
          }));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredPresets, tradeForm, trades, prices, onChangeTrades]);

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
        dayPnl={totals.dayPnl}
        totalPnl={totals.totalPnl}
        totalCost={totals.totalCost}
        totalReturnRate={totalReturnRate}
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
                    fee: prev.fee
                  }));
                }}
                className={tradeForm.side === "sell" ? "primary" : "secondary"}
                style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
              >
                {tradeForm.side === "sell" ? "매수 모드로 전환" : "매도 모드로 전환"}
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: "0 0 12px 0", fontSize: 12 }}>
            한국 종목은 원화(KRW), 해외 종목은 달러(USD)로 입력 및 표시됩니다.
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
                .filter((a) => a.type === "securities")
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
                      name: "" // 티커 변경 시 이름 초기화
                    }))
                  }
                  options={tickerSuggestions.map((t) => ({
                    value: t.ticker,
                    label: t.name,
                    subLabel: `${t.market === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"} ${t.exchange || ""}`
                  }))}
                  onSelect={(option) => {
                    const selectedTicker = option.value;
                    const selectedName = option.label || "";
                    setTradeForm((prev) => ({
                      ...prev,
                      ticker: selectedTicker,
                      name: selectedName || prev.name || selectedTicker
                    }));
                    // 티커 선택 시 시세도 조회
                    const symbol = canonicalTickerForMatch(selectedTicker);
                    if (symbol) {
                      fetchYahooQuotes([symbol]).then((results) => {
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
                      }).catch(() => {
                        // 에러 무시
                      });
                    }
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
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                단가 {(() => {
                  const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
                  const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean);
                  const currency = priceInfo?.currency || (isKRWStock(tradeForm.ticker) ? "KRW" : "USD");
                  return currency === "USD" ? "(USD)" : "(KRW)";
                })()}
              </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={tradeForm.price}
              onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })}
                style={{ 
                  padding: "6px 8px", 
                  fontSize: 14,
                  borderColor: tradeFormValidation.price ? "var(--danger)" : undefined
                }}
                aria-invalid={!!tradeFormValidation.price}
                aria-describedby={tradeFormValidation.price ? "trade-price-error" : undefined}
            />
            {tradeFormValidation.price && (
              <span id="trade-price-error" style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 2 }}>
                {tradeFormValidation.price}
              </span>
            )}
          </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                수수료+세금 {(() => {
                  const tickerClean = canonicalTickerForMatch(tradeForm.ticker);
                  const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerClean);
                  const currency = priceInfo?.currency || (isKRWStock(tradeForm.ticker) ? "KRW" : "USD");
                  return currency === "USD" ? "(USD)" : "(KRW)";
                })()}
              </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={tradeForm.fee}
              onChange={(e) => setTradeForm({ ...tradeForm, fee: e.target.value })}
                style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
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
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{formatPriceWithCurrency(tickerInfo.price, tickerInfo.currency, tradeForm.ticker.toUpperCase())}</div>
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
              handleRefreshQuotes();
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
          <PortfolioChartsSection
            positionsWithPrice={positionsWithPrice}
            positionsByAccount={positionsByAccount}
            balances={balances}
          />
          {onChangeTargetPortfolios && (
            <TargetPortfolioSection
              positionsWithPrice={positionsWithPrice}
              positionsByAccount={positionsByAccount}
              accounts={accounts}
              prices={prices}
              tickerDatabase={tickerDatabase}
              targetPortfolios={targetPortfolios}
              onChangeTargetPortfolios={onChangeTargetPortfolios}
              fxRate={propFxRate}
            />
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
                              style={{ marginRight: 4, fontSize: 11, padding: "4px 8px" }}
                            >
                              적용
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deletePreset(preset.id)}
                              style={{ fontSize: 11, padding: "4px 8px" }}
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
            KRW 계좌와 USD 계좌 간의 환전 거래를 기록합니다.
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
          onClose={() => setSelectedPosition(null)}
          onChangeLedger={onChangeLedger || (() => {})}
        />
      )}
    </div>
  );
};

