import React, { useMemo, useState, useEffect } from "react";
import { Autocomplete } from "./Autocomplete";
import type { Account, LedgerEntry, StockPrice, StockTrade, TickerInfo } from "../types";
import { computePositions } from "../calculations";
import { formatNumber, formatKRW, formatShortDate } from "../utils/format";
import { isKRWStock, isUSDStock, canonicalTickerForMatch, extractTickerFromText } from "../utils/tickerUtils";
import krNames from "../data/krNames.json";
import { toast } from "react-hot-toast";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
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
  yieldRate?: number;
  accountId?: string;
  accountName?: string;
  quantity?: number;
}

type TabType = "dividend" | "interest";

export const DividendsView: React.FC<Props> = ({ accounts, ledger, trades, prices, tickerDatabase, onChangeLedger, fxRate: propFxRate = null }) => {
  const [activeTab, setActiveTab] = useState<TabType>("dividend");
  const [showUSD, setShowUSD] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(propFxRate);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingTicker, setEditingTicker] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");
  const [editingQuantity, setEditingQuantity] = useState<string>("");
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [editingDate, setEditingDate] = useState<string>("");
  const [editingAccountId, setEditingAccountId] = useState<string>("");
  
  // 배당 입력 폼
  const [dividendForm, setDividendForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    ticker: "",
    name: "",
    amount: "",
    tax: "", // 세금
    fee: "" // 수수료
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

  // 선택한 티커의 통화 정보 (StocksView와 동일한 방식)
  const selectedTickerCurrency = useMemo(() => {
    if (!dividendForm.ticker) return undefined;
    
    // 1. 원본 prices에서 통화 정보 가져오기 (StocksView와 동일)
    const originalPriceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(dividendForm.ticker));
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
  }, [prices, tickerDatabase, dividendForm.ticker]);

  // 환율 업데이트 (props에서 전달받은 경우)
  useEffect(() => {
    if (propFxRate !== null) {
      setFxRate(propFxRate);
    }
  }, [propFxRate]);

  const formatUSD = (value: number) => Math.round(value).toLocaleString("en-US");
  const formatCurrency = (value: number, currency?: string, originalValue?: number) => {
    // value는 이미 원화로 변환된 값 (adjustedPrices 사용)
    // originalValue는 원본 USD 가격 (표시용)
    if (currency === "USD" && showUSD && originalValue != null) {
      const base = `${formatUSD(originalValue)} USD`;
      if (fxRate) {
        return `${base} (약 ${formatKRW(Math.round(originalValue * fxRate))})`;
      }
      return base;
    }
    if (currency === "USD" && fxRate && !showUSD) {
      // 원화로 표시 (이미 원화로 변환된 값 사용)
      return `${formatKRW(Math.round(value))}`;
    }
    if (currency && currency !== "KRW" && showUSD && originalValue != null) {
      return `${Math.round(originalValue).toLocaleString("en-US")} ${currency}`;
    }
    return `${formatKRW(Math.round(value))}`;
  };

  // 배당율 계산 (주식 탭과 동일: 항상 원화 기준, 순 배당금 기준)
  const dividendYield = useMemo(() => {
    if (!dividendForm.amount || !selectedPosition) return null;
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (amount <= 0 || selectedPosition.avgPrice <= 0 || selectedPosition.quantity <= 0) return null;
    
    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
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
      // 원화로 입력받았으면 세금/수수료 차감
      amount = amount - tax - fee;
    }
    
    // totalCost는 이미 원화 기준 (positions는 adjustedPrices 사용)
    const totalCost = selectedPosition.avgPrice * selectedPosition.quantity;
    return (amount / totalCost) * 100;
  }, [dividendForm.amount, dividendForm.tax, dividendForm.fee, selectedPosition, selectedTickerCurrency, showUSD, fxRate]);

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
        const krName = (krNames as Record<string, string>)[ct];
        if (krName) name = krName;
      }
      if (!name) {
        name = prices.find((p) => canonicalTickerForMatch(p.ticker) === ct)?.name ||
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
  }, [ledger, prices, trades, positions, tickerDatabase]);

  // 빠른 입력: 이전 배당 내역 적용 (수정 가능)
  const applyRecentDividend = (recent: { ticker: string; name: string; amount: number; accountId: string }) => {
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: recent.accountId || dividendForm.accountId,
      ticker: recent.ticker,
      name: recent.name,
      amount: recent.amount.toString(),
      tax: "", // 세금은 매번 새로 입력
      fee: "" // 수수료는 매번 새로 입력
    });
  };

  const handleDividendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;
    
    if (!dividendForm.date || !dividendForm.accountId || !amount || amount <= 0) {
      return;
    }

    const tickerTrimmed = dividendForm.ticker?.trim() ?? "";
    
    // 티커가 비어 있거나 "이자"로 입력하면 이자(은행이자)로 저장
    if (!tickerTrimmed || tickerTrimmed === "이자") {
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
        accountId: dividendForm.accountId,
        ticker: "",
        name: "",
        amount: "",
        tax: "",
        fee: ""
      });
      return;
    }

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
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: dividendForm.date,
      kind: "income",
      category: "수입",
      subCategory: "배당",
      description: description,
      toAccountId: dividendForm.accountId,
      amount: netAmount // 순 배당금 (세금, 수수료 제외) - 항상 원화 기준으로 저장
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    // 같은 종목·계좌 유지 (다음 배당 입력 시 편의)
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      accountId: dividendForm.accountId,
      ticker: dividendForm.ticker,
      name: dividendForm.name ?? "",
      amount: "",
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

    const buyAmountByTicker = trades
      .filter((t) => t.side === "buy")
      .reduce((map, t) => {
        const key = canonicalTickerForMatch(t.ticker);
        map.set(key, (map.get(key) ?? 0) + t.totalAmount);
        return map;
      }, new Map<string, number>());

    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // description에서 종목명 추출 ("TICKER - Name 배당" 또는 "TICKER - Name" 형식)
    const parseNameFromDescription = (desc: string): string => {
      const m = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
      return m ? m[1].trim() : "";
    };

    // 티커로 종목명 조회: 한국 종목은 krNames 한글명 최우선 (description 영문명 무시), 그 다음 description, prices/trades/tickerDatabase
    const krNamesMap = krNames as Record<string, string>;
    const getStockName = (ticker: string, description: string): string => {
      const ct = canonicalTickerForMatch(ticker);
      // 한국 종목(6자 이상)은 krNames 한글명 최우선 - description에 영문 저장돼 있어도 덮어씀
      if (isKRWStock(ct)) {
        const krName = krNamesMap[ct];
        if (krName) return krName;
      }
      const fromDesc = parseNameFromDescription(description);
      if (fromDesc) return fromDesc;
      return (
        prices.find((p) => canonicalTickerForMatch(p.ticker) === ct)?.name ||
        trades.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
        tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
        ""
      );
    };
    
    // 배당 날짜 기준으로 보유 수량 계산 함수
    const getQuantityAtDate = (ticker: string, date: string): number => {
      if (!ticker || !date) return 0;
      const ct = canonicalTickerForMatch(ticker);
      
      const relevantTrades = trades.filter(t => 
        canonicalTickerForMatch(t.ticker) === ct && t.date <= date
      );
      
      let quantity = 0;
      for (const trade of relevantTrades) {
        if (trade.side === "buy") {
          quantity += trade.quantity;
        } else if (trade.side === "sell") {
          quantity -= trade.quantity;
        }
      }
      
      return Math.max(0, quantity); // 음수 방지
    };

    const rows: DividendRow[] = [];
    for (const l of ledger) {
      if (!isDividend(l)) continue;
      const month = l.date?.slice(0, 7) || "기타";
      const desc = l.description ?? "";
      const ticker = (extractTickerFromText(desc) ?? extractTickerFromText(l.category ?? ""))?.toUpperCase();
      const name = ticker ? getStockName(ticker, desc) : "";
      const source = ticker ? `${ticker}${name ? ` - ${name}` : ""}` : l.description || l.category || "기타";
      const basis = ticker ? buyAmountByTicker.get(canonicalTickerForMatch(ticker)) ?? 0 : 0;
      const yieldRate = basis > 0 ? l.amount / basis : undefined;
      const account = l.toAccountId ? accountMap.get(l.toAccountId) : undefined;
      // 배당 날짜 기준 보유 수량 계산
      // note 필드에 저장된 보유주식이 있으면 우선 사용, 없으면 계산된 값 사용
      let quantityAtDate: number | undefined;
      if (l.note && l.note.includes("보유주식:")) {
        const noteMatch = l.note.match(/보유주식:\s*(\d+)/);
        if (noteMatch) {
          quantityAtDate = parseInt(noteMatch[1], 10);
        }
      }
      if (quantityAtDate === undefined) {
        quantityAtDate = ticker && l.date ? getQuantityAtDate(ticker, l.date) : undefined;
      }
      rows.push({
        month,
        date: l.date || "",
        source,
        ticker,
        name,
        amount: l.amount,
        yieldRate,
        accountId: l.toAccountId,
        accountName: account?.name,
        quantity: quantityAtDate
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date)); // 최신순
  }, [ledger, trades, prices, accounts, tickerDatabase]);

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

  // 종목별 합계 계산
  const byTicker = useMemo(() => {
    const map = new Map<string, { ticker: string; name: string; total: number; count: number }>();
    incomeRows.forEach((r) => {
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
  }, [incomeRows]);

  // 배당과 이자 분리
  const dividendRows = useMemo(() => {
    return incomeRows.filter(r => r.source.includes("배당") || (r.ticker && !r.source.includes("이자")));
  }, [incomeRows]);
  
  const interestRows = useMemo(() => {
    return incomeRows.filter(r => r.source.includes("이자") || (!r.ticker && r.source.includes("이자")));
  }, [incomeRows]);

  const totalDividend = useMemo(() => {
    return dividendRows.reduce((s, r) => s + r.amount, 0);
  }, [dividendRows]);

  const totalInterest = useMemo(() => {
    return interestRows.reduce((s, r) => s + r.amount, 0);
  }, [interestRows]);

  return (
    <div>
      <div className="section-header">
        <h2>배당/이자 (수입)</h2>
      </div>

      {/* 탭 버튼 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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
                  // 통화 정보 가져오기 (StocksView와 동일한 방식)
                  const originalPriceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(recent.ticker));
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
                  {showUSD ? "USD ON" : "USD OFF"}
                </button>
              )}
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              받은 배당금을 입력하세요. 보유 종목의 평균 단가와 수량이 자동으로 표시됩니다. <strong>티커를 비우면 이자(은행이자)로 등록됩니다.</strong>
            </p>
            <form onSubmit={handleDividendSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>날짜</span>
                <input
                  type="date"
                  value={dividendForm.date}
                  onChange={(e) => setDividendForm({ ...dividendForm, date: e.target.value })}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
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
                  onChange={(val) => setDividendForm({ ...dividendForm, ticker: val.toUpperCase(), name: "" })}
                  options={tickerOptions}
                  onSelect={(option) => {
                    const isInterest = option.value === "" || option.value === "이자";
                    setDividendForm({
                      ...dividendForm,
                      ticker: option.value,
                      name: isInterest ? "" : (option.label || "")
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
                    <span style={{ fontSize: 13, fontWeight: 500 }}>보유 수량</span>
                    <input
                      type="text"
                      value={`${selectedPosition.quantity}주`}
                      disabled
                      style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
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
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  배당 금액
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                  {selectedTickerCurrency === "USD" && showUSD && fxRate && dividendForm.amount && (
                    <span style={{ fontSize: 11, color: "#666", marginLeft: 4 }}>
                      ≈ {formatKRW(Math.round(Number(dividendForm.amount) * fxRate))}
                    </span>
                  )}
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
        <div className="card highlight">
          <div className="card-title">전체 누적</div>
          <div className="card-value">
            {formatKRW(Math.round(incomeRows.reduce((s, r) => s + r.amount, 0)))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">배당 총액</div>
          <div className="card-value positive">
            {formatKRW(Math.round(totalDividend))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">이자 총액</div>
          <div className="card-value positive">
            {formatKRW(Math.round(totalInterest))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">최근 월 합계</div>
          <div className="card-value">
            {formatKRW(Math.round(monthlyTotal[0]?.total ?? 0))}
          </div>
        </div>
      </div>

      {byTicker.length > 0 && (
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

      <h3>월별 합계</h3>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>월</th>
            <th>총액</th>
          </tr>
        </thead>
        <tbody>
          {monthlyTotal.map((row) => (
            <tr key={row.month}>
              <td style={{ fontWeight: 500 }}>{row.month}</td>
              <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                {formatKRW(Math.round(row.total))}
              </td>
            </tr>
          ))}
          {monthlyTotal.length === 0 && (
            <tr>
              <td colSpan={2} style={{ textAlign: "center" }}>
                배당/이자 내역이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 16 }}>월별 종목별 배당 내역</h3>
      {byMonthSource.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: 20 }}>
          배당/이자 내역이 없습니다.
        </p>
      ) : (
        byMonthSource.map(([month, rows]) => {
          const monthTotal = rows.reduce((sum, r) => sum + r.amount, 0);
          const dividendRows = rows.filter(r => r.ticker || r.source.includes("배당"));
          const interestRows = rows.filter(r => !r.ticker && r.source.includes("이자"));
          
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
                  합계: {formatKRW(Math.round(monthTotal))}
                </div>
              </div>
              
              {dividendRows.length > 0 && (
                <table className="data-table" style={{ marginBottom: 16, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "10%", minWidth: 80 }}>날짜</th>
                      <th style={{ width: "10%", minWidth: 70 }}>티커</th>
                      <th style={{ width: "25%", minWidth: 140 }}>종목명</th>
                      <th style={{ width: "10%" }}>보유주식</th>
                      <th style={{ width: "15%" }}>배당금액</th>
                      <th style={{ width: "10%" }}>배당율</th>
                      <th style={{ width: "12%" }}>계좌</th>
                      <th style={{ width: "8%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRows.map((r, idx) => {
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
                                placeholder="보유주식"
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
                                placeholder="배당금액"
                                min={0}
                                step={0.01}
                              />
                            ) : (
                              <span>{formatKRW(Math.round(r.amount))}</span>
                            )}
                          </td>
                          <td className="number">
                            {r.yieldRate != null ? `${(r.yieldRate * 100).toFixed(2)}%` : "-"}
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
              
              {interestRows.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "10%" }}>날짜</th>
                      <th style={{ width: "35%" }}>출처</th>
                      <th style={{ width: "25%" }}>이자금액</th>
                      <th style={{ width: "20%" }}>계좌</th>
                      <th style={{ width: "10%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {interestRows.map((r, idx) => {
                      const ledgerEntry = ledger.find(l => {
                        if (l.kind !== "income") return false;
                        const lMonth = l.date?.slice(0, 7) || "기타";
                        if (lMonth !== month) return false;
                        return (l.description || l.category || "") === r.source && Math.abs(l.amount - r.amount) < 1;
                      });
                      
                      return (
                        <tr key={`${month}-interest-${idx}`}>
                          <td style={{ fontSize: 13, color: "#666" }}>
                            {r.date ? formatShortDate(r.date) : "-"}
                          </td>
                          <td style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "300px"
                          }} title={r.source}>
                            {r.source.length > 40 ? r.source.slice(0, 40) + "..." : r.source}
                          </td>
                          <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                            {formatKRW(Math.round(r.amount))}
                          </td>
                          <td style={{ fontSize: 13, color: "#666" }}>
                            {r.accountName || r.accountId || "-"}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {ledgerEntry && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`이 이자 기록을 삭제하시겠습니까?\n${r.source}: ${formatKRW(Math.round(r.amount))}`)) {
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
    </div>
  );
};

