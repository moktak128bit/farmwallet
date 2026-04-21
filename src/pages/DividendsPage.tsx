import React, { useMemo, useState, useEffect, useDeferredValue } from "react";
import { Autocomplete } from "../components/ui/Autocomplete";
import type { Account, HistoricalDailyClose, LedgerEntry, StockPrice, StockTrade, TickerInfo } from "../types";
import { computePositions } from "../calculations";
import { formatKRW, formatShortDate } from "../utils/formatter";
import { isKRWStock, isUSDStock, canonicalTickerForMatch, extractTickerFromText } from "../utils/finance";
import { parseExDateFromNote, parseQuantityFromNote, buildDividendNote } from "../utils/dividend";
import { getKrNames } from "../storage";
import { toast } from "react-hot-toast";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  historicalDailyCloses?: HistoricalDailyClose[];
  onChangeLedger: (ledger: LedgerEntry[]) => void;
  fxRate?: number | null;
}

interface DividendRow {
  month: string;
  date: string;
  source: string;
  amount: number;
  ticker?: string;
  name?: string; // 종목명 (별도 필드로 명확히)
  /** 주당배당금 (총 배당금 ÷ 보유주수) */
  dividendPerShare?: number;
  /** 배당율 매입대비 (소수, 예: 0.0325 = 3.25%) */
  yieldRate?: number;
  /** 해당 시점 매입금액(원). 평단가·배당률 계산에 사용 */
  costBasis?: number;
  accountId?: string;
  accountName?: string;
  quantity?: number;
  /** ledger category/description 기준 이자 여부 (배당 테이블에서 제외) */
  isInterest?: boolean;
}

type TabType = "dividend" | "interest";
type ViewMode = "all" | "dividend" | "interest";

export const DividendsView: React.FC<Props> = ({ accounts, ledger, trades, prices, tickerDatabase, historicalDailyCloses: _historicalDailyCloses = [], onChangeLedger, fxRate: propFxRate = null }) => {
  const deferredLedger = useDeferredValue(ledger);
  const deferredTrades = useDeferredValue(trades);
  const [activeTab, setActiveTab] = useState<TabType>("dividend");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [showUSD, setShowUSD] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(propFxRate);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingTicker, setEditingTicker] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");
  const [editingQuantity, setEditingQuantity] = useState<string>("");
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [editingDate, setEditingDate] = useState<string>("");
  const [editingAccountId, setEditingAccountId] = useState<string>("");
  
  // 배당 입력 폼 (date = 수령일, exDate = 배당락일, 배당율은 락일 기준 주가 사용)
  const [dividendForm, setDividendForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    exDate: "", // 배당락일 (선택, 있으면 배당율 계산에 락일 기준 주가 사용)
    accountId: "",
    ticker: "",
    name: "",
    dividendPerShare: "",
    amount: "",
    quantity: "",
    tax: "",
    fee: ""
  });

  // 이자 입력 폼
  const [interestForm, setInterestForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    amount: "",
    rate: "", // 이율 (%)
    tax: "" // 세금
  });

  // USD를 원화로 변환한 가격 (주식 탭과 동일)
  const adjustedPrices = useMemo(() => {
    if (!fxRate) return prices;
    return prices.map((p) => {
      if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
        return { ...p, price: p.price * fxRate, currency: "KRW" };
      }
      return p;
    });
  }, [prices, fxRate]);

  // 보유 종목 정보 계산 (주식 탭과 동일: adjustedPrices 사용)
  const positions = useMemo(() => {
    return computePositions(trades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
  }, [trades, adjustedPrices, accounts, fxRate]);

  // 티커 자동완성 옵션 (보유 종목만) + "티커 없음" 옵션
  const tickerOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; subLabel?: string }> = [
      { value: "", label: "티커 없음 (이자로 등록)", subLabel: "비우거나 '이자' 입력 시 이자로 저장" },
      { value: "이자", label: "이자 (은행이자)", subLabel: "이자로 저장됩니다" }
    ];
    
    // 보유 종목만 추가
    positions.forEach((pos) => {
      if (pos.quantity > 0) {
        options.push({
          value: pos.ticker,
          label: pos.name,
          subLabel: `보유: ${pos.quantity}주, 평균단가: ${Math.round(pos.avgPrice).toLocaleString()}원`
        });
      }
    });
    
    return options.sort((a, b) => {
      if (a.value === "") return -1;
      if (b.value === "") return 1;
      if (a.value === "이자") return -1;
      if (b.value === "이자") return 1;
      return a.value.localeCompare(b.value);
    });
  }, [positions]);

  // 선택한 티커의 보유 정보 (주식 탭과 동일: 원화 기준)
  const selectedPosition = useMemo(() => {
    if (!dividendForm.ticker) return null;
    return positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(dividendForm.ticker) && p.quantity > 0);
  }, [positions, dividendForm.ticker]);

  // 티커 선택 시 보유 수량을 폼 기본값으로 채움 (수정 가능하므로 사용자가 바꿀 수 있음)
  useEffect(() => {
    if (selectedPosition) {
      setDividendForm((prev) => ({
        ...prev,
        quantity: String(selectedPosition.quantity)
      }));
    } else {
      setDividendForm((prev) => ({ ...prev, quantity: "" }));
    }
  }, [selectedPosition?.ticker, selectedPosition?.quantity, selectedPosition]);

  // canonical 티커별 최신 시세 (updatedAt 기준) — 평가/표시 일관성
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

  // 선택한 티커의 통화 정보 (StocksView와 동일한 방식)
  const selectedTickerCurrency = useMemo(() => {
    if (!dividendForm.ticker) return undefined;
    
    // 1. 원본 prices에서 통화 정보 가져오기 (최신 시세 기준)
    const originalPriceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(dividendForm.ticker));
    if (originalPriceInfo?.currency) {
      return originalPriceInfo.currency;
    }
    
    // 2. prices에 없으면 tickerDatabase에서 market 정보로 판단
    const tickerInfo = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(dividendForm.ticker));
    if (tickerInfo?.market === "US") {
      return "USD";
    }
    if (tickerInfo?.market === "KR") {
      return "KRW";
    }
    
    // 3. tickerDatabase에도 없으면 티커 유틸로 판단 (4자 이하=USD, 6자 이상=KRW)
    const ticker = dividendForm.ticker;
    if (isKRWStock(ticker)) return "KRW";
    if (isUSDStock(ticker)) return "USD";
    
    return undefined;
  }, [latestPriceByCanonicalTicker, tickerDatabase, dividendForm.ticker]);

  // 환율 업데이트 (props에서 전달받은 경우)
  useEffect(() => {
    if (propFxRate !== null) {
      setFxRate(propFxRate);
    }
  }, [propFxRate]);

  const formatUSD = (value: number) => Math.round(value).toLocaleString("en-US");

  // 배당율 계산 (주식 탭과 동일: 항상 원화 기준, 순 배당금 기준. 수량은 폼 값 우선)
  const dividendYield = useMemo(() => {
    if (!selectedPosition) return null;
    const quantity = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition.quantity;
    const dividendPerShare = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
    let amount = dividendPerShare > 0 && quantity > 0 ? dividendPerShare * quantity : 0;
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;

    if (amount <= 0 || selectedPosition.avgPrice <= 0 || quantity <= 0) return null;

    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      amount = amount - tax - fee;
    }

    const totalCost = selectedPosition.avgPrice * quantity;
    return (amount / totalCost) * 100;
  }, [dividendForm.dividendPerShare, dividendForm.tax, dividendForm.fee, dividendForm.quantity, selectedPosition, selectedTickerCurrency, showUSD, fxRate]);

  // 이전 배당 입력 내역 (빠른 재입력용)
  const recentDividends = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" && (l.category === "배당" || (l.category === "수입" && l.subCategory === "배당") || (l.description ?? "").includes("배당"));

    const tickerMap = new Map<string, { ticker: string; name: string; amount: number; accountId: string; date: string }>();
    
    // 최근 배당 내역을 티커별로 추출 (최신 것만)
    for (const l of ledger) {
      if (!isDividend(l)) continue;
      const ticker = (extractTickerFromText(l.description ?? "") ?? extractTickerFromText(l.category ?? ""))?.toUpperCase();
      if (!ticker) continue;
      const ct = canonicalTickerForMatch(ticker);
      const desc = l.description ?? "";
      // description에서 "TICKER - Name 배당" 형식으로 종목명 추출
      const nameMatch = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
      let name = nameMatch ? nameMatch[1].trim() : "";
      if (!name && isKRWStock(ct)) {
        const krName = getKrNames()[ct];
        if (krName) name = krName;
      }
      if (!name) {
        name = latestPriceByCanonicalTicker.get(ct)?.name ||
          trades.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
          tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
          "";
      }
      
      // 같은 티커가 이미 있으면 날짜가 더 최신인 것만 유지
      const existing = tickerMap.get(ct);
      if (!existing || (l.date && existing.date < l.date)) {
        tickerMap.set(ct, {
          ticker,
          name,
          amount: l.amount,
          accountId: l.toAccountId || "",
          date: l.date || ""
        });
      }
    }
    
    return Array.from(tickerMap.values())
      .filter((d) => positions.some((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(d.ticker) && p.quantity > 0)) // 보유 종목만
      .sort((a, b) => b.date.localeCompare(a.date)); // 최신순 정렬
  }, [ledger, latestPriceByCanonicalTicker, trades, positions, tickerDatabase]);

  // 빠른 입력: 이전 배당 내역 적용 (수정 가능)
  const applyRecentDividend = (recent: { ticker: string; name: string; amount: number; accountId: string }) => {
    const matchedPosition = positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(recent.ticker) && p.quantity > 0);
    const quantity = matchedPosition?.quantity ?? 0;
    const dividendPerShare = quantity > 0 ? String(Math.round((recent.amount / quantity) * 100) / 100) : "";
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      exDate: "",
      accountId: recent.accountId || dividendForm.accountId,
      ticker: recent.ticker,
      name: recent.name,
      dividendPerShare,
      amount: "",
      quantity: "",
      tax: "",
      fee: ""
    });
  };

  const handleDividendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (!dividendForm.date || !dividendForm.accountId) {
      return;
    }

    const tickerTrimmed = dividendForm.ticker?.trim() ?? "";
    
    // 티커가 비어 있거나 "이자"로 입력하면 이자(은행이자)로 저장
    if (!tickerTrimmed || tickerTrimmed === "이자") {
      if (!amount || amount <= 0) return;
      const netAmount = amount - tax - fee;
      const description = `이자${tax > 0 ? `, 세금: ${Math.round(tax).toLocaleString()}원` : ""}${fee > 0 ? `, 수수료: ${Math.round(fee).toLocaleString()}원` : ""}`;
      const entry: LedgerEntry = {
        id: `I${Date.now()}`,
        date: dividendForm.date,
        kind: "income",
        category: "이자",
        description: description,
        toAccountId: dividendForm.accountId,
        amount: netAmount
      };
      onChangeLedger([entry, ...ledger]);
      setDividendForm({
        date: new Date().toISOString().slice(0, 10),
        exDate: "",
        accountId: dividendForm.accountId,
        ticker: "",
        name: "",
        dividendPerShare: "",
        amount: "",
        quantity: "",
        tax: "",
        fee: ""
      });
      return;
    }
    const quantityForCalc = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition?.quantity ?? 0;
    const dividendPerShare = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
    if (quantityForCalc <= 0 || dividendPerShare <= 0) {
      return;
    }
    amount = dividendPerShare * quantityForCalc;

    // 주식 탭과 동일: 항상 원화(KRW) 기준으로 저장
    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate; // USD → KRW 변환
      // 세금과 수수료도 USD로 입력받았으면 원화로 변환
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      // 원화로 입력받았으면 그대로 사용하고 세금/수수료 차감
      amount = amount - tax - fee;
    }

    // 순 배당금 (세금, 수수료 제외)
    const netAmount = amount;

    const description = `${dividendForm.ticker}${dividendForm.name ? ` - ${dividendForm.name}` : ""} 배당${tax > 0 ? `, 세금: ${Math.round(tax).toLocaleString()}원` : ""}${fee > 0 ? `, 수수료: ${Math.round(fee).toLocaleString()}원` : ""}`;
    const qtyForNote = dividendForm.quantity !== "" ? parseInt(dividendForm.quantity, 10) : selectedPosition?.quantity;
    const quantityToSave = typeof qtyForNote === "number" && !Number.isNaN(qtyForNote) && qtyForNote >= 0 ? qtyForNote : undefined;
    const note = buildDividendNote(quantityToSave, dividendForm.exDate?.trim());
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: dividendForm.date,
      kind: "income",
      category: "수입",
      subCategory: "배당",
      description: description,
      toAccountId: dividendForm.accountId,
      amount: netAmount,
      note
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      exDate: "",
      accountId: dividendForm.accountId,
      ticker: dividendForm.ticker,
      name: dividendForm.name ?? "",
      dividendPerShare: "",
      amount: "",
      quantity: dividendForm.quantity,
      tax: "",
      fee: ""
    });
  };

  const handleInterestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(interestForm.amount);
    const rate = interestForm.rate ? Number(interestForm.rate) : null;
    const tax = interestForm.tax ? Number(interestForm.tax) : 0;
    
    if (!interestForm.date || !interestForm.accountId || !amount || amount <= 0) {
      return;
    }

    const description = `이자${rate != null ? ` (이율: ${rate}%)` : ""}${tax > 0 ? `, 세금: ${tax.toLocaleString()}원` : ""}`;
    const entry: LedgerEntry = {
      id: `I${Date.now()}`,
      date: interestForm.date,
      kind: "income",
      category: "이자",
      description: description,
      toAccountId: interestForm.accountId,
      amount: amount - tax // 세금 제외한 순 이자
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 폼 초기화
    setInterestForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: interestForm.accountId,
      amount: "",
      rate: "",
      tax: ""
    });
  };

  const incomeRows = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" &&
      ((l.category ?? "").includes("배당") ||
        (l.category ?? "").includes("이자") ||
        (l.subCategory ?? "").includes("배당") ||
        (l.subCategory ?? "").includes("이자") ||
        (l.description ?? "").includes("배당") ||
        (l.description ?? "").includes("이자"));

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const priceKrwByTicker = new Map<string, number>();
    adjustedPrices.forEach((p) => {
      const key = canonicalTickerForMatch(p.ticker);
      if (typeof p.price === "number" && p.price > 0) {
        priceKrwByTicker.set(key, p.price);
      }
    });

    // description에서 종목명 추출 ("TICKER - Name 배당" 또는 "TICKER - Name" 형식)
    const parseNameFromDescription = (desc: string): string => {
      const m = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
      return m ? m[1].trim() : "";
    };

    // 티커로 종목명 조회: 한국 종목은 krNames 한글명 최우선 (description 영문명 무시), 그 다음 description, prices/trades/tickerDatabase
    const getStockName = (ticker: string, description: string): string => {
      const ct = canonicalTickerForMatch(ticker);
      // 한국 종목(6자 이상)은 krNames 한글명 최우선 - description에 영문 저장돼 있어도 덮어씀
      if (isKRWStock(ct)) {
        const krName = getKrNames()[ct];
        if (krName) return krName;
      }
      const fromDesc = parseNameFromDescription(description);
      if (fromDesc) return fromDesc;
      return (
        latestPriceByCanonicalTicker.get(ct)?.name ||
        trades.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
        tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
        ""
      );
    };
    
    // 배당 수령일 기준 보유 수량 (그날 거래 제외 = “배당 받을 때” 보유 주식, 모든 계좌 합산)
    const getQuantityAtDate = (ticker: string, date: string, accountId?: string): number => {
      if (!ticker || !date) return 0;
      const ct = canonicalTickerForMatch(ticker);
      const relevantTrades = deferredTrades.filter(
        (t) =>
          canonicalTickerForMatch(t.ticker) === ct &&
          t.date < date &&
          (!accountId || t.accountId === accountId)
      );
      let quantity = 0;
      for (const trade of relevantTrades) {
        const side = (trade.side ?? "").toString().toLowerCase();
        if (side === "buy") quantity += trade.quantity;
        else if (side === "sell") quantity -= trade.quantity;
      }
      return Math.max(0, quantity);
    };

    // 해당일 거래 전 보유 주식의 매입금액(FIFO). accountId 있으면 해당 계좌만(주식 탭 평단가와 동일), 원화
    const getCostBasisAtDate = (ticker: string, date: string, accountId?: string): number => {
      if (!ticker || !date) return 0;
      const ct = canonicalTickerForMatch(ticker);
      const relevant = deferredTrades
        .filter(
          (t) =>
            canonicalTickerForMatch(t.ticker) === ct &&
            t.date < date &&
            (!accountId || t.accountId === accountId)
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      type Lot = { qty: number; totalAmount: number };
      const lots: Lot[] = [];
      for (const t of relevant) {
        const side = (t.side ?? "").toString().toLowerCase();
        const amtKrW = isUSDStock(ticker) && fxRate ? t.totalAmount * fxRate : t.totalAmount;
        if (side === "buy") {
          lots.push({ qty: t.quantity, totalAmount: amtKrW });
        } else if (side === "sell") {
          let remaining = t.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = lot.qty > 0 ? (lot.totalAmount / lot.qty) * used : 0;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
        // side가 buy/sell이 아니면 무시(매입금액에 반영 안 함)
      }
      return lots.reduce((sum, lot) => sum + lot.totalAmount, 0);
    };

    const rows: DividendRow[] = [];
    for (const l of deferredLedger) {
      if (!isDividend(l)) continue;
      const month = l.date?.slice(0, 7) || "기타";
      const desc = l.description ?? "";
      const ticker = (extractTickerFromText(desc) ?? extractTickerFromText(l.category ?? ""))?.toUpperCase();
      const name = ticker ? getStockName(ticker, desc) : "";
      const source = ticker ? `${ticker}${name ? ` - ${name}` : ""}` : l.description || l.category || "기타";
      const account = l.toAccountId ? accountMap.get(l.toAccountId) : undefined;
      // 배당 날짜 기준 보유 수량 계산
      // 배당 탭에서 입력한 보유주식 수 우선 사용, 없으면 거래 기준 계산
      let quantityAtDate: number | undefined = parseQuantityFromNote(l.note) ?? undefined;
      const accountIdForPosition = l.toAccountId || undefined;
      if (quantityAtDate === undefined) {
        quantityAtDate = ticker && l.date ? getQuantityAtDate(ticker, l.date, accountIdForPosition) : undefined;
      }
      const quantity = quantityAtDate;
      const amount = l.amount;
      const dividendPerShare = quantity != null && quantity > 0 ? amount / quantity : undefined;
      const dateForCost = parseExDateFromNote(l.note) || l.date || "";
      const costBasis = ticker && dateForCost ? getCostBasisAtDate(ticker, dateForCost, accountIdForPosition) : 0;
      const yieldRate =
        amount > 0 && costBasis > 0 ? amount / costBasis : undefined;
      const isInterest = (l.category ?? "") === "이자" || ((desc.includes("이자") || (l.category ?? "").includes("이자")) && !ticker);
      rows.push({
        month,
        date: l.date || "",
        source,
        ticker,
        name,
        amount,
        dividendPerShare,
        yieldRate,
        costBasis: costBasis > 0 ? costBasis : undefined,
        accountId: l.toAccountId,
        accountName: account?.name,
        quantity: quantityAtDate,
        isInterest
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date)); // 최신순
  }, [deferredLedger, deferredTrades, trades, accounts, tickerDatabase, adjustedPrices, fxRate, latestPriceByCanonicalTicker]);

  const monthlyTotal = useMemo(() => {
    const map = new Map<string, number>();
    incomeRows.forEach((r) => {
      map.set(r.month, (map.get(r.month) ?? 0) + r.amount);
    });
    return Array.from(map.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => b.month.localeCompare(a.month)); // 최신 월이 위로
  }, [incomeRows]);

  const byMonthSource = useMemo(() => {
    const map = new Map<string, DividendRow[]>();
    incomeRows.forEach((r) => {
      const list = map.get(r.month) ?? [];
      list.push(r);
      map.set(r.month, list);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])); // 최신 월이 위로
  }, [incomeRows]);

  // 배당과 이자 분리 (ledger category/description 기준 이자면 배당 테이블에 노출 안 함)
  const dividendRows = useMemo(() => {
    return incomeRows.filter(r => !r.isInterest && (r.source.includes("배당") || !!r.ticker));
  }, [incomeRows]);

  const interestRows = useMemo(() => {
    return incomeRows.filter(r => !!r.isInterest);
  }, [incomeRows]);

  // 종목별 합계 계산 (배당만)
  const byTicker = useMemo(() => {
    const map = new Map<string, { ticker: string; name: string; total: number; count: number }>();
    dividendRows.forEach((r) => {
      if (!r.ticker) return;
      const key = canonicalTickerForMatch(r.ticker);
      const existing = map.get(key);
      if (existing) {
        existing.total += r.amount;
        existing.count += 1;
      } else {
        const name = r.name ?? (r.source.includes(" - ") ? r.source.split(" - ")[1] : "");
        map.set(key, {
          ticker: r.ticker,
          name,
          total: r.amount,
          count: 1
        });
      }
    });
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total);
  }, [dividendRows]);

  const totalDividend = useMemo(() => {
    return dividendRows.reduce((s, r) => s + r.amount, 0);
  }, [dividendRows]);

  const totalInterest = useMemo(() => {
    return interestRows.reduce((s, r) => s + r.amount, 0);
  }, [interestRows]);

  const byMonthInterest = useMemo(() => {
    const map = new Map<string, DividendRow[]>();
    interestRows.forEach((r) => {
      const list = map.get(r.month) ?? [];
      list.push(r);
      map.set(r.month, list);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [interestRows]);

  const monthlyDividendTotal = useMemo(() => {
    const map = new Map<string, number>();
    dividendRows.forEach((r) => {
      map.set(r.month, (map.get(r.month) ?? 0) + r.amount);
    });
    return Array.from(map.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [dividendRows]);

  const monthlyInterestTotal = useMemo(() => {
    const map = new Map<string, number>();
    interestRows.forEach((r) => {
      map.set(r.month, (map.get(r.month) ?? 0) + r.amount);
    });
    return Array.from(map.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [interestRows]);

  return (
    <div>
      <div className="section-header">
        <h2>배당/이자 (수입)</h2>
      </div>

      {/* 입력 탭: 배당 입력 / 이자 입력 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={activeTab === "dividend" ? "primary" : ""}
          onClick={() => setActiveTab("dividend")}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          배당 입력
        </button>
        <button
          type="button"
          className={activeTab === "interest" ? "primary" : ""}
          onClick={() => setActiveTab("interest")}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          이자 입력
        </button>
      </div>

      {/* 보기 탭: 전체 / 배당만 / 이자만 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={viewMode === "all" ? "primary" : ""}
          onClick={() => setViewMode("all")}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          전체 보기
        </button>
        <button
          type="button"
          className={viewMode === "dividend" ? "primary" : ""}
          onClick={() => setViewMode("dividend")}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          배당만 보기
        </button>
        <button
          type="button"
          className={viewMode === "interest" ? "primary" : ""}
          onClick={() => setViewMode("interest")}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          이자만 보기
        </button>
      </div>

      {/* 배당 입력 폼 */}
      {activeTab === "dividend" && (
        <>
          {/* 빠른 입력: 이전 배당 내역 */}
          {recentDividends.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16, backgroundColor: "#f8fafc" }}>
              <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>빠른 입력 (이전 배당 내역)</h4>
              <p className="hint" style={{ marginBottom: 12, fontSize: 13 }}>
                이전에 입력한 배당 내역을 클릭하면 자동으로 폼이 채워집니다. 모든 필드를 수정할 수 있습니다.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {recentDividends.map((recent, idx) => {
                  const pos = positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(recent.ticker));
                  // 통화 정보 가져오기 (최신 시세 기준)
                  const originalPriceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(recent.ticker));
                  let currency = originalPriceInfo?.currency;
                  if (!currency) {
                    const tickerInfo = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(recent.ticker));
                    if (tickerInfo?.market === "US") {
                      currency = "USD";
                    } else if (tickerInfo?.market === "KR") {
                      currency = "KRW";
                    } else {
                      if (isKRWStock(recent.ticker)) currency = "KRW";
                      else if (isUSDStock(recent.ticker)) currency = "USD";
                    }
                  }
                  return (
                    <button
                      key={`${recent.ticker}-${idx}`}
                      type="button"
                      onClick={() => applyRecentDividend(recent)}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        border: "1px solid var(--border, #ddd)",
                        borderRadius: 6,
                        backgroundColor: "white",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        minWidth: "140px"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#eef2ff";
                        e.currentTarget.style.borderColor = "#2563eb";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "white";
                        e.currentTarget.style.borderColor = "var(--border, #ddd)";
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#1e40af" }}>
                        {recent.ticker}
                      </div>
                      {recent.name && (
                        <div style={{ fontSize: 12, color: "#666" }}>
                          {recent.name.length > 15 ? recent.name.slice(0, 15) + "..." : recent.name}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 500 }}>
                        {formatKRW(Math.round(recent.amount))}
                      </div>
                      {pos && (
                        <div style={{ fontSize: 11, color: "#888" }}>
                          보유: {pos.quantity}주
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>배당 입력</h3>
              {selectedTickerCurrency && selectedTickerCurrency !== "KRW" && (
                <button
                  type="button"
                  className={showUSD ? "primary" : "secondary"}
                  onClick={() => setShowUSD((v) => !v)}
                  style={{ padding: "6px 12px", fontSize: 13 }}
                >
                  {showUSD ? "USD 표시" : "원화 표시"}
                </button>
              )}
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              받은 배당금을 입력하세요. 주식 배당은 <strong>주당배당금과 보유주식수</strong>를 입력하면 총 배당금이 자동 계산됩니다. <strong>티커를 비우면 이자(은행이자)로 등록됩니다.</strong>
            </p>
            <form onSubmit={handleDividendSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>날짜 (수령일)</span>
                <input
                  type="date"
                  value={dividendForm.date}
                  onChange={(e) => setDividendForm({ ...dividendForm, date: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>배당락일 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(선택, 배당율 계산용)</span></span>
                <input
                  type="date"
                  value={dividendForm.exDate}
                  onChange={(e) => setDividendForm({ ...dividendForm, exDate: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
                <select
                  value={dividendForm.accountId}
                  onChange={(e) => setDividendForm({ ...dividendForm, accountId: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                >
                  <option value="">선택</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.id}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>티커 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(비우거나 '이자' 입력 시 이자)</span></span>
                <Autocomplete
                  value={dividendForm.ticker}
                  onChange={(val) => setDividendForm({ ...dividendForm, ticker: val.toUpperCase(), name: "", dividendPerShare: "", amount: "" })}
                  options={tickerOptions}
                  onSelect={(option) => {
                    const isInterest = option.value === "" || option.value === "이자";
                    setDividendForm({
                      ...dividendForm,
                      ticker: option.value,
                      name: isInterest ? "" : (option.label || ""),
                      dividendPerShare: "",
                      amount: ""
                    });
                  }}
                  placeholder="티커 입력 / 비우기 또는 '이자' = 이자로 저장"
                />
              </label>
              {selectedPosition && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>평균 단가</span>
                    <input
                      type="text"
                      value={formatKRW(Math.round(selectedPosition.avgPrice))}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>보유 수량 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(기본: 해당 종목 보유, 수정 가능)</span></span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={dividendForm.quantity}
                      onChange={(e) => setDividendForm({ ...dividendForm, quantity: e.target.value })}
                      placeholder={String(selectedPosition.quantity)}
                      style={{ padding: "6px 8px", fontSize: 14 }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>총 매입 금액</span>
                    <input
                      type="text"
                      value={formatKRW(Math.round(selectedPosition.avgPrice * selectedPosition.quantity))}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                </>
              )}
              {dividendForm.ticker && dividendForm.ticker !== "이자" ? (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      주당 배당금
                      {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                      {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.0001}
                      value={dividendForm.dividendPerShare}
                      onChange={(e) => setDividendForm({ ...dividendForm, dividendPerShare: e.target.value })}
                      placeholder={selectedTickerCurrency === "USD" && showUSD ? "USD로 입력" : "원화로 입력"}
                      style={{ padding: "6px 8px", fontSize: 14 }}
                      required
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>총 배당금 (자동 계산)</span>
                    <input
                      type="text"
                      value={(() => {
                        const q = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition?.quantity ?? 0;
                        const dps = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
                        const total = q > 0 && dps > 0 ? q * dps : 0;
                        if (total <= 0) return "-";
                        if (selectedTickerCurrency === "USD" && showUSD) {
                          return `${formatUSD(total)} USD${fxRate ? ` (약 ${formatKRW(Math.round(total * fxRate))})` : ""}`;
                        }
                        return formatKRW(Math.round(total));
                      })()}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                    />
                  </label>
                </>
              ) : (
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    이자 금액
                    {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                    {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={dividendForm.amount}
                    onChange={(e) => setDividendForm({ ...dividendForm, amount: e.target.value })}
                    placeholder={selectedTickerCurrency === "USD" && showUSD ? "USD로 입력" : "원화로 입력"}
                    style={{ padding: "6px 8px", fontSize: 14 }}
                    required
                  />
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  세금
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={dividendForm.tax}
                  onChange={(e) => setDividendForm({ ...dividendForm, tax: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  수수료
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={dividendForm.fee}
                  onChange={(e) => setDividendForm({ ...dividendForm, fee: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              {dividendYield != null && (
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>배당율</span>
                  <input
                    type="text"
                    value={`${dividendYield.toFixed(2)}%`}
                    disabled
                    style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5", color: "#2563eb", fontWeight: 600 }}
                  />
                </label>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
                추가
              </button>
            </div>
          </form>
        </div>
        </>
      )}

      {/* 이자 입력 폼 */}
      {activeTab === "interest" && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>이자 입력</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            받은 이자를 입력하세요. 이율과 세금을 함께 기록할 수 있습니다.
          </p>
          <form onSubmit={handleInterestSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
                <input
                  type="date"
                  value={interestForm.date}
                  onChange={(e) => setInterestForm({ ...interestForm, date: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
                <select
                  value={interestForm.accountId}
                  onChange={(e) => setInterestForm({ ...interestForm, accountId: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                >
                  <option value="">선택</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.id}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>이자 금액</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={interestForm.amount}
                  onChange={(e) => setInterestForm({ ...interestForm, amount: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>이율 (%)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={interestForm.rate}
                  onChange={(e) => setInterestForm({ ...interestForm, rate: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>세금</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={interestForm.tax}
                  onChange={(e) => setInterestForm({ ...interestForm, tax: e.target.value })}
                  placeholder="선택사항"
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
                추가
              </button>
            </div>
          </form>
        </div>
      )}


      <div className="cards-row">
        {(viewMode === "all" || viewMode === "dividend") && (
          <div className={viewMode === "dividend" ? "card highlight" : "card"}>
            <div className="card-title">배당 총액</div>
            <div className="card-value positive">
              {formatKRW(Math.round(totalDividend))}
            </div>
          </div>
        )}
        {(viewMode === "all" || viewMode === "interest") && (
          <div className={viewMode === "interest" ? "card highlight" : "card"}>
            <div className="card-title">이자 총액</div>
            <div className="card-value positive">
              {formatKRW(Math.round(totalInterest))}
            </div>
          </div>
        )}
        {viewMode === "all" && (
          <>
            <div className="card">
              <div className="card-title">전체 누적</div>
              <div className="card-value">
                {formatKRW(Math.round(incomeRows.reduce((s, r) => s + r.amount, 0)))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">최근 월 합계</div>
              <div className="card-value">
                {formatKRW(Math.round(monthlyTotal[0]?.total ?? 0))}
              </div>
            </div>
          </>
        )}
        {viewMode === "dividend" && (
          <div className="card">
            <div className="card-title">최근 월 배당</div>
            <div className="card-value">
              {formatKRW(Math.round(monthlyDividendTotal[0]?.total ?? 0))}
            </div>
          </div>
        )}
        {viewMode === "interest" && (
          <div className="card">
            <div className="card-title">최근 월 이자</div>
            <div className="card-value">
              {formatKRW(Math.round(monthlyInterestTotal[0]?.total ?? 0))}
            </div>
          </div>
        )}
      </div>

      {(viewMode === "all" || viewMode === "dividend") && byTicker.length > 0 && (
        <>
          <h3>종목별 누적 배당</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>티커</th>
                <th>종목명</th>
                <th>횟수</th>
                <th>총 배당금</th>
              </tr>
            </thead>
            <tbody>
              {byTicker.map((item) => (
                <tr key={item.ticker}>
                  <td style={{ fontWeight: 600 }}>{item.ticker}</td>
                  <td>{item.name || "-"}</td>
                  <td className="number">{item.count}회</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(item.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(viewMode === "all" || viewMode === "dividend") && (
        <>
          <h3>{viewMode === "dividend" ? "월별 배당 합계" : "월별 합계"}</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>월</th>
                <th>총액</th>
              </tr>
            </thead>
            <tbody>
              {(viewMode === "all" ? monthlyTotal : monthlyDividendTotal).map((row) => (
                <tr key={row.month}>
                  <td style={{ fontWeight: 500 }}>{row.month}</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(row.total))}
                  </td>
                </tr>
              ))}
              {(viewMode === "all" ? monthlyTotal : monthlyDividendTotal).length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    {viewMode === "dividend" ? "배당 내역이 없습니다." : "배당/이자 내역이 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {viewMode === "interest" && (
        <>
          <h3>월별 이자 합계</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>월</th>
                <th>이자 합계</th>
              </tr>
            </thead>
            <tbody>
              {monthlyInterestTotal.map((row) => (
                <tr key={row.month}>
                  <td style={{ fontWeight: 500 }}>{row.month}</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(row.total))}
                  </td>
                </tr>
              ))}
              {monthlyInterestTotal.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    이자 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {(viewMode === "all" || viewMode === "dividend") && (
        <>
      <h3 style={{ marginTop: 16 }}>월별 종목별 배당 내역</h3>
      {byMonthSource.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          배당 내역이 없습니다.
        </p>
      ) : (
        byMonthSource.map(([month, rows]) => {
          const dividendRowsInMonth = rows.filter(r => !r.isInterest && (r.ticker || r.source.includes("배당")));
          const monthDividendTotal = dividendRowsInMonth.reduce((sum, r) => sum + r.amount, 0);
          
          return (
            <div key={month} style={{ marginBottom: 32 }}>
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: "2px solid var(--border)"
              }}>
                <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{month}</h4>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#10b981" }}>
                  배당 합계: {formatKRW(Math.round(monthDividendTotal))}
                </div>
              </div>
              
              {dividendRowsInMonth.length > 0 && (
                <table className="data-table" style={{ marginBottom: 16, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "9%", minWidth: 80 }}>날짜</th>
                      <th style={{ width: "9%", minWidth: 70 }}>티커</th>
                      <th style={{ width: "16%", minWidth: 120 }}>종목명</th>
                      <th style={{ width: "10%" }}>평단가</th>
                      <th style={{ width: "10%" }}>주당배당금</th>
                      <th style={{ width: "8%" }}>보유주수</th>
                      <th style={{ width: "11%" }}>총 배당금</th>
                      <th style={{ width: "16%" }}>배당율(매입대비)</th>
                      <th style={{ width: "10%" }}>계좌</th>
                      <th style={{ width: "5%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRowsInMonth.map((r, idx) => {
                      const tickerName = r.name ?? (r.source.includes(" - ") ? r.source.split(" - ")[1] : "");
                      const displayName = tickerName.length > 30 ? tickerName.slice(0, 30) + "..." : tickerName;
                      // 해당 배당 기록 찾기
                      const ledgerEntry = ledger.find(l => {
                        if (l.kind !== "income") return false;
                        const lMonth = l.date?.slice(0, 7) || "기타";
                        if (lMonth !== month) return false;
                        const lTicker = (extractTickerFromText(l.description ?? "") ?? extractTickerFromText(l.category ?? ""))?.toUpperCase();
                        return lTicker === r.ticker && Math.abs(l.amount - r.amount) < 1;
                      });
                      
                      const isEditing = ledgerEntry && editingEntryId === ledgerEntry.id;
                      
                      // description에서 티커와 종목명 추출
                      const extractTickerAndName = (desc: string) => {
                        const ticker = (extractTickerFromText(desc) ?? "").toUpperCase();
                        const nameMatch = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
                        const name = nameMatch ? nameMatch[1].trim() : "";
                        return { ticker, name };
                      };
                      
                      const { ticker: currentTicker, name: currentName } = ledgerEntry 
                        ? extractTickerAndName(ledgerEntry.description || "")
                        : { ticker: r.ticker || "", name: tickerName || "" };
                      
                      const handleSaveEdit = (e?: React.FocusEvent) => {
                        if (!ledgerEntry) return;
                        
                        // 같은 행의 다른 편집 필드로 포커스가 이동하는 경우는 저장하지 않음
                        if (e?.relatedTarget) {
                          const relatedTarget = e.relatedTarget as HTMLElement;
                          const isSameRowInput = relatedTarget.closest('tr') === e.currentTarget.closest('tr') &&
                                                 ['INPUT', 'TEXTAREA', 'SELECT'].includes(relatedTarget.tagName);
                          if (isSameRowInput) {
                            return; // 같은 행의 다른 입력 필드로 이동하는 경우 저장하지 않음
                          }
                        }
                        
                        // description 재구성: "티커 - 종목명 배당" 형식
                        const restOfDesc = ledgerEntry.description || "";
                        const restMatch = restOfDesc.match(/\s배당.*$/);
                        const restPart = restMatch ? restMatch[0] : " 배당";
                        
                        const newTicker = editingTicker.trim().toUpperCase() || currentTicker;
                        const newName = editingName.trim();
                        const newDescription = newName 
                          ? `${newTicker} - ${newName}${restPart}`
                          : `${newTicker}${restPart}`;
                        
                        // 배당금액 수정
                        const newAmount = editingAmount ? Number(editingAmount) : ledgerEntry.amount;
                        
                        // 보유주식은 note 필드에 저장 (나중에 참조용)
                        const newNote = editingQuantity ? `보유주식: ${editingQuantity}` : ledgerEntry.note;
                        
                        // 날짜, 계좌 수정
                        const newDate = editingDate || ledgerEntry.date || "";
                        const newToAccountId = editingAccountId || ledgerEntry.toAccountId || "";
                        
                        const newLedger = ledger.map(l => 
                          l.id === ledgerEntry.id 
                            ? { 
                                ...l, 
                                date: newDate,
                                description: newDescription,
                                amount: newAmount,
                                note: newNote,
                                toAccountId: newToAccountId
                              }
                            : l
                        );
                        onChangeLedger(newLedger);
                        toast.success("배당 기록이 수정되었습니다.");
                        setEditingEntryId(null);
                        setEditingTicker("");
                        setEditingName("");
                        setEditingQuantity("");
                        setEditingAmount("");
                        setEditingDate("");
                        setEditingAccountId("");
                      };
                      
                      const cancelEdit = () => {
                        setEditingEntryId(null);
                        setEditingTicker("");
                        setEditingName("");
                        setEditingQuantity("");
                        setEditingAmount("");
                        setEditingDate("");
                        setEditingAccountId("");
                      };
                      
                      return (
                        <tr key={`${month}-${r.ticker}-${idx}`}>
                          <td style={{ fontSize: 13, color: "#666", position: "relative" }}>
                            {isEditing ? (
                              <input
                                type="date"
                                value={editingDate}
                                onChange={(e) => setEditingDate(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    (e.currentTarget.closest("tr")?.querySelector("input[type='text']:nth-of-type(1)") as HTMLInputElement)?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                              />
                            ) : (
                              r.date ? formatShortDate(r.date) : "-"
                            )}
                          </td>
                          <td 
                            style={{ 
                              fontWeight: 600, 
                              fontSize: 14,
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingTicker}
                                onChange={(e) => setEditingTicker(e.target.value.toUpperCase())}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const nameInput = e.currentTarget.closest("tr")?.querySelector("input[type='text']:nth-of-type(2)") as HTMLInputElement;
                                    nameInput?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                autoFocus
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="티커"
                              />
                            ) : (
                              <span>{r.ticker || "-"}</span>
                            )}
                          </td>
                          <td 
                            title={tickerName || "-"} 
                            style={{ 
                              overflow: "hidden", 
                              textOverflow: "ellipsis", 
                              whiteSpace: "nowrap",
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const quantityInput = e.currentTarget.closest("tr")?.querySelector("input[type='number']:nth-of-type(1)") as HTMLInputElement;
                                    quantityInput?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="종목명"
                              />
                            ) : (
                              <span>{displayName || "-"}</span>
                            )}
                          </td>
                          <td className="number" title={r.costBasis != null && r.quantity != null && r.quantity > 0 ? `매입금액 ${formatKRW(Math.round(r.costBasis))} ÷ ${r.quantity}주` : ""}>
                            {r.costBasis != null && r.quantity != null && r.quantity > 0
                              ? formatKRW(Math.round(r.costBasis / r.quantity))
                              : "-"}
                          </td>
                          <td className="number" style={{ position: "relative" }}>
                            {isEditing ? (() => {
                              const q = Number(editingQuantity) || 0;
                              const a = Number(editingAmount) || 0;
                              return q > 0 ? formatKRW(Math.round(a / q)) : "-";
                            })() : (
                              r.dividendPerShare != null ? formatKRW(Math.round(r.dividendPerShare)) : "-"
                            )}
                          </td>
                          <td 
                            className="number"
                            style={{ position: "relative" }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                value={editingQuantity}
                                onChange={(e) => setEditingQuantity(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const amountInput = e.currentTarget.closest("tr")?.querySelector("input[type='number']:nth-of-type(2)") as HTMLInputElement;
                                    amountInput?.focus();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)",
                                  textAlign: "right"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="보유주수"
                                min={0}
                                step={1}
                              />
                            ) : (
                              <span>{r.quantity != null ? `${Math.round(r.quantity).toLocaleString()}주` : "-"}</span>
                            )}
                          </td>
                          <td 
                            className="number positive" 
                            style={{ 
                              fontWeight: 600, 
                              fontSize: 15,
                              position: "relative"
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                value={editingAmount}
                                onChange={(e) => setEditingAmount(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.currentTarget.blur();
                                    handleSaveEdit();
                                  } else if (e.key === "Escape") cancelEdit();
                                  else if (e.key === "Tab") { /* 기본 동작 */ }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)",
                                  textAlign: "right"
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="총 배당금"
                                min={0}
                                step={0.01}
                              />
                            ) : (
                              <span>{formatKRW(Math.round(r.amount))}</span>
                            )}
                          </td>
                          <td className="number" style={{ whiteSpace: "nowrap" }}>
                            {isEditing ? (() => {
                              const q = Number(editingQuantity) || 0;
                              const a = Number(editingAmount) || 0;
                              const tickerForPrice = editingTicker.trim().toUpperCase() || currentTicker || r.ticker;
                              const pos = tickerForPrice ? positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(tickerForPrice)) : null;
                              const priceKrw = pos?.marketPrice;
                              if (q <= 0 || a <= 0 || !priceKrw || priceKrw <= 0) return "-";
                              const dps = a / q;
                              const yieldPct = (dps / priceKrw) * 100;
                              return `${yieldPct.toFixed(2)}%`;
                            })() : r.yieldRate != null ? (
                              <span title={`매입금액 ${r.costBasis != null ? formatKRW(Math.round(r.costBasis)) : "?"} ÷ 배당금 ${formatKRW(Math.round(r.amount))} = ${(r.yieldRate * 100).toFixed(2)}%`}>
                                <span style={{ fontWeight: 600 }}>{(r.yieldRate * 100).toFixed(2)}%</span>
                                {r.costBasis != null && (
                                  <div className="hint" style={{ fontSize: 10, marginTop: 2 }}>
                                    매입 {formatKRW(Math.round(r.costBasis))} 기준
                                  </div>
                                )}
                              </span>
                            ) : "-"}
                          </td>
                          <td style={{ fontSize: 13, color: "#666", position: "relative" }}>
                            {isEditing ? (
                              <select
                                value={editingAccountId}
                                onChange={(e) => setEditingAccountId(e.target.value)}
                                onBlur={(e) => handleSaveEdit(e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSaveEdit();
                                  } else if (e.key === "Escape") cancelEdit();
                                }}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 4,
                                  backgroundColor: "var(--surface)"
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">선택</option>
                                {accounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.name || acc.id}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              r.accountName || r.accountId || "-"
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {ledgerEntry && (
                              <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingEntryId(ledgerEntry.id);
                                      setEditingTicker(currentTicker);
                                      setEditingName(currentName);
                                      setEditingQuantity(r.quantity != null ? r.quantity.toString() : "");
                                      setEditingAmount(ledgerEntry.amount.toString());
                                      setEditingDate(ledgerEntry.date || r.date || "");
                                      setEditingAccountId(ledgerEntry.toAccountId || r.accountId || "");
                                    }}
                                    style={{
                                      background: "none",
                                      border: "1px solid var(--border)",
                                      color: "var(--accent)",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      padding: "4px 8px",
                                      borderRadius: 4,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = "var(--accent-light)";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                    title="수정"
                                  >
                                    ✏️
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`이 배당 기록을 삭제하시겠습니까?\n${r.ticker || r.source}: ${formatKRW(Math.round(r.amount))}`)) {
                                      const newLedger = ledger.filter(l => l.id !== ledgerEntry.id);
                                      onChangeLedger(newLedger);
                                    }
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#ef4444",
                                    cursor: "pointer",
                                    fontSize: 18,
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "#fee2e2";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                  }}
                                  title="삭제"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
        </>
      )}

      {(viewMode === "all" || viewMode === "interest") && (
        <>
      <h3 style={{ marginTop: viewMode === "interest" ? 0 : 24 }}>월별 이자 내역</h3>
      {byMonthInterest.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          이자 내역이 없습니다.
        </p>
      ) : (
        byMonthInterest.map(([month, rows]) => {
          const monthInterestTotal = rows.reduce((s, r) => s + r.amount, 0);
          return (
            <div key={month} style={{ marginBottom: 32 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: "2px solid var(--border)"
              }}>
                <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{month}</h4>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#10b981" }}>
                  이자 합계: {formatKRW(Math.round(monthInterestTotal))}
                </div>
              </div>
              <table className="data-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: "12%" }}>날짜</th>
                    <th style={{ width: "38%" }}>출처</th>
                    <th style={{ width: "20%" }}>이자금액</th>
                    <th style={{ width: "18%" }}>계좌</th>
                    <th style={{ width: "12%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const ledgerEntry = ledger.find(l => {
                      if (l.kind !== "income") return false;
                      const isInterestEntry = (l.category ?? "") === "이자" || (l.description ?? "").includes("이자");
                      if (!isInterestEntry) return false;
                      const lMonth = l.date?.slice(0, 7) || "기타";
                      if (lMonth !== month) return false;
                      const lSource = l.description || l.category || "기타";
                      return lSource === r.source && Math.abs(l.amount - r.amount) < 1;
                    });
                    const isEditing = ledgerEntry && editingEntryId === ledgerEntry.id;
                    const handleSaveInterestEdit = (e?: React.FocusEvent) => {
                      if (!ledgerEntry) return;
                      if (e?.relatedTarget) {
                        const relatedTarget = e.relatedTarget as HTMLElement;
                        const isSameRow = relatedTarget.closest("tr") === e.currentTarget.closest("tr") &&
                          ["INPUT", "TEXTAREA", "SELECT"].includes(relatedTarget.tagName);
                        if (isSameRow) return;
                      }
                      const newDate = editingDate || ledgerEntry.date || "";
                      const newDescription = ((editingName ?? ledgerEntry.description ?? "").trim() || (ledgerEntry.description ?? ""));
                      const newAmount = editingAmount ? Number(editingAmount) : ledgerEntry.amount;
                      const newToAccountId = editingAccountId ?? ledgerEntry.toAccountId ?? "";
                      const newLedger = ledger.map(l =>
                        l.id === ledgerEntry.id
                          ? { ...l, date: newDate, description: newDescription, amount: newAmount, toAccountId: newToAccountId }
                          : l
                      );
                      onChangeLedger(newLedger);
                      toast.success("이자 기록이 수정되었습니다.");
                      setEditingEntryId(null);
                      setEditingDate("");
                      setEditingAmount("");
                      setEditingAccountId("");
                      setEditingName("");
                    };
                    const cancelInterestEdit = () => {
                      setEditingEntryId(null);
                      setEditingDate("");
                      setEditingAmount("");
                      setEditingAccountId("");
                      setEditingName("");
                    };
                    return (
                      <tr key={`${month}-interest-${idx}`}>
                        <td style={{ fontSize: 13, color: "#666", position: "relative" }}>
                          {isEditing ? (
                            <input
                              type="date"
                              value={editingDate}
                              onChange={(e) => setEditingDate(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            />
                          ) : (
                            r.date ? formatShortDate(r.date) : "-"
                          )}
                        </td>
                        <td style={{ position: "relative", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              placeholder="출처/설명"
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            />
                          ) : (
                            <span title={r.source}>{r.source.length > 40 ? r.source.slice(0, 40) + "..." : r.source}</span>
                          )}
                        </td>
                        <td className="number positive" style={{ fontWeight: 600, fontSize: 15, position: "relative" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              value={editingAmount}
                              onChange={(e) => setEditingAmount(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)", textAlign: "right" }}
                            />
                          ) : (
                            formatKRW(Math.round(r.amount))
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: "#666", position: "relative" }}>
                          {isEditing ? (
                            <select
                              value={editingAccountId}
                              onChange={(e) => setEditingAccountId(e.target.value)}
                              onBlur={handleSaveInterestEdit}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelInterestEdit(); }}
                              style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid var(--accent)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                            >
                              <option value="">선택</option>
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>
                              ))}
                            </select>
                          ) : (
                            r.accountName || r.accountId || "-"
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {ledgerEntry && (
                            <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                              {!isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingEntryId(ledgerEntry.id);
                                    setEditingDate(ledgerEntry.date || r.date || "");
                                    setEditingName(ledgerEntry.description ?? r.source);
                                    setEditingAmount(ledgerEntry.amount.toString());
                                    setEditingAccountId(ledgerEntry.toAccountId ?? r.accountId ?? "");
                                  }}
                                  style={{ background: "none", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer", fontSize: 12, padding: "4px 8px", borderRadius: 4 }}
                                  title="수정"
                                >
                                  ✏️
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`이 이자 기록을 삭제하시겠습니까?\n${r.source}: ${formatKRW(Math.round(r.amount))}`)) {
                                    onChangeLedger(ledger.filter(l => l.id !== ledgerEntry.id));
                                  }
                                }}
                                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 18, padding: "4px 8px" }}
                                title="삭제"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
        </>
      )}
    </div>
  );
};
