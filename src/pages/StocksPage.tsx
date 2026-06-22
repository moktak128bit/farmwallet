/**
 * 주식 (StocksPage) — 조립자(orchestrator).
 * 공유 데이터 memo(positions/totals/실현손익)와 모듈 조립만 담당하고,
 * 영역별 UI·로직은 features/stocks/ 모듈이 소유한다:
 *   - TradeFormSection:   거래 입력 폼 + 시세 정보 카드 — tradeForm 상태를 자식이 소유해
 *                          폼 타이핑이 이 페이지를 재렌더하지 않음. 외부 접점(거래 수정·빠른 매수/매도·
 *                          프리셋 적용·Ctrl+S)은 tradeFormRef의 ref API로 처리.
 *   - useQuoteRefresh:    보유/전체 시세 갱신 로직 + 진행률/에러/마지막 갱신 상태.
 *   - StocksHeaderSection: 상단 헤더(환율 pill + 갱신/CSV 버튼) — React.memo.
 *   - PositionListSection / TradeHistorySection / PortfolioChartsSection / TargetPortfolioSection 등 기존 모듈.
 * fxRate·positions·prices처럼 여러 영역이 공유하는 상태/메모는 이 페이지가 소유한다.
 */
import React, { lazy, Suspense, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { StockDetailModal } from "../components/StockDetailModal";
import { FxFormSection } from "../features/stocks/FxFormSection";
import { FxHistorySection } from "../features/stocks/FxHistorySection";
import { StockStatsCard } from "../features/stocks/StockStatsCard";
import { PresetSection } from "../features/stocks/PresetSection";
import { PresetModal } from "../features/stocks/PresetModal";
import { TradeHistorySection } from "../features/stocks/TradeHistorySection";
import { PositionListSection } from "../features/stocks/PositionListSection";
import { EtfDiscountSection } from "../features/stocks/EtfDiscountSection";
import { ChartSkeleton } from "../components/charts/ChartSkeleton";
import { StockTabNav } from "../features/stocks/StockTabNav";
import { QuoteErrorBanner } from "../features/stocks/QuoteErrorBanner";
import { QuoteRefreshProgress } from "../features/stocks/QuoteRefreshProgress";
import { StocksHeaderSection } from "../features/stocks/StocksHeaderSection";
import { TradeFormSection, type TradeFormSectionHandle } from "../features/stocks/TradeFormSection";
import { useQuoteRefresh, getLastQuoteRefreshAt } from "../features/stocks/useQuoteRefresh";

const LazyPortfolioChartsSection = lazy(() =>
  import("../features/stocks/PortfolioChartsSection").then((m) => ({ default: m.PortfolioChartsSection }))
);
const LazyTargetPortfolioSection = lazy(() =>
  import("../features/stocks/TargetPortfolioSection").then((m) => ({ default: m.TargetPortfolioSection }))
);
import type { Account, StockPrice, StockTrade, TickerInfo, StockPreset, LedgerEntry, TargetPortfolio, AccountBalanceRow } from "../types";
import { computePositions } from "../calculations";
import { buildClosedTradeRecords, summarizeRecords } from "../utils/investmentRecord";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { isUSDStock, canonicalTickerForMatch } from "../utils/finance";
import { newIdWithPrefix } from "../utils/id";
import { getTodayKST } from "../utils/date";
import { isDividendEntryLoose } from "../utils/categoryMatch";
import { toast } from "react-hot-toast";
import { blocksToCsv, type ReportBlock } from "../utils/reportExport";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onChangePrices: (next: StockPrice[]) => void;
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

export const StocksView: React.FC<Props> = ({
  accounts,
  balances,
  trades,
  prices,
  tickerDatabase,
  onChangeTrades,
  onChangePrices,
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
  const [showPresetModal, setShowPresetModal] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"stocks" | "portfolio" | "fx" | "etf">("stocks");
  const [selectedPosition, setSelectedPosition] = useState<PositionWithPrice | null>(null);

  // 거래 입력 폼 상태는 TradeFormSection이 소유 — 외부 접점(거래 수정·빠른 매수/매도·프리셋·Ctrl+S)은 ref API로
  const tradeFormRef = useRef<TradeFormSectionHandle>(null);

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
    /** 유효 시세(>0) 존재 여부 — false면 "시세 없음"으로 표시하고 평가는 매입가 기준 중립 처리 */
    hasQuote: boolean;
  };

  const positionsWithPrice = useMemo<PositionWithPrice[]>(() => {
    return positions.map((p) => {
      const pNorm = canonicalTickerForMatch(p.ticker);
      const originalPriceInfo = latestPriceByCanonicalTicker.get(pNorm);
      const currency = originalPriceInfo?.currency || (isUSDStock(p.ticker) ? "USD" : "KRW");
      const isUSD = currency === "USD";
      // 시세 누락/0이면 평균단가로 중립 평가 — 현재가 0원·수익률 -100% 오표시 방지
      const rawQuote = originalPriceInfo?.price ?? p.marketPrice;
      const hasQuote = typeof rawQuote === "number" && Number.isFinite(rawQuote) && rawQuote > 0;
      const displayMarketPrice = hasQuote ? rawQuote : p.avgPrice;
      const originalMarketPrice = isUSD ? originalPriceInfo?.price : undefined;

      // 종목명: tickerDatabase 정식명 우선 (거래/시세에 잘못 저장된 이름 방지, 예: BITX→BIT)
      const dbEntry = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === pNorm);
      const displayName = dbEntry?.name ?? p.name ?? p.ticker;

      // 평가금액/손익 계산 (USD 종목은 USD 기준, KRW 종목은 KRW 기준)
      const marketValue = hasQuote ? displayMarketPrice * p.quantity : p.totalBuyAmount;
      const pnl = hasQuote ? marketValue - p.totalBuyAmount : 0;
      const pnlRate = hasQuote && p.totalBuyAmount > 0 ? pnl / p.totalBuyAmount : 0;
      // 단가와 현재가 차이 — USD 평단은 달러 소수 유지 (반올림하면 센트 단위 오차)
      const diff = hasQuote ? displayMarketPrice - (isUSD ? p.avgPrice : Math.round(p.avgPrice)) : 0;

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
        hasQuote
      };
    });
  }, [positions, latestPriceByCanonicalTicker, tickerDatabase]);

  const totals = useMemo(() => {
    const rate = fxRate ?? 0;
    const toKRW = (p: PositionWithPrice, val: number) =>
      (p.currency === "USD" || isUSDStock(p.ticker)) && rate ? val * rate : val;
    // 시세 없음 USD 행: 평가금을 현재환율 환산이 아닌 매입원가(KRW)로 잡아 손익 기여를 정확히 0으로
    // (toKRW(달러원가)는 환차분만큼 가짜 손익을 만들어 행의 "—" 표시와 합계가 어긋남)
    const marketValueKRW = (p: PositionWithPrice) =>
      !p.hasQuote && (p.currency === "USD" || isUSDStock(p.ticker)) && p.totalBuyAmountKRW != null
        ? p.totalBuyAmountKRW
        : toKRW(p, p.marketValue);
    const totalMarketValueKRW = positionsWithPrice.reduce(
      (sum, p) => sum + marketValueKRW(p),
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
      return sum + (marketValueKRW(p) - costKRW);
    }, 0);
    const dayPnl = positionsWithPrice.reduce((sum, p) => {
      if (!p.hasQuote) return sum; // 시세 없음 행의 잔존 change가 일일손익을 오염시키지 않게
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

  const totalReturnRate = useMemo(
    () => (totals.totalCost ? totals.totalPnl / totals.totalCost : 0),
    [totals]
  );

  const totalDividend = useMemo(() => {
    // 분류 단일소스(categoryMatch.isDividendEntryLoose) — cat/sub 정확 매칭 + description fallback
    const isDividend = (l: LedgerEntry) => l.kind === "income" && isDividendEntryLoose(l);
    const toKrw = (l: LedgerEntry) =>
      l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount;
    return ledger.filter(isDividend).reduce((s, l) => s + toKrw(l), 0);
  }, [ledger, fxRate]);

  /** FIFO 누적 실현손익 — 리포트 InvestmentRecordCard·인사이트 InvestTab과 동일 로직. */
  const realized = useMemo(() => {
    const records = buildClosedTradeRecords(trades, accounts, fxRate ?? undefined);
    const summary = summarizeRecords(records);
    return {
      pnl: summary.totalPnl,
      returnRate: summary.totalCost > 0 ? summary.totalPnl / summary.totalCost : 0,
      tradeCount: summary.tradeCount,
    };
  }, [trades, accounts, fxRate]);


  /** 환율 갱신. 갱신된 환율을 반환해 호출부가 stale 클로저 없이 즉시 사용 가능 (실패 시 null) */
  const updateFxRate = useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetchYahooQuotes(["USDKRW=X"]);
      const r = res[0];
      if (r?.price) {
        setFxRate(r.price);
        setFxUpdatedAt(r.updatedAt ?? new Date().toISOString());
        return r.price;
      }
    } catch (err) {
      console.warn("환율 조회 실패", err);
    }
    return null;
  }, []);

  // (removed) "기존 달러 거래 cashImpact 원화 재계산" 자동 effect.
  // 현재 환율(fxRate)로 과거 거래를 재계산해 사용자의 역사적 환율 기록(fxRateAtTrade)을
  // 덮어쓰던 코드. 새 거래는 submitTradeFromForm에서 올바른 cashImpact를 직접 저장.

  React.useEffect(() => {
    updateFxRate().catch((err) => {
      console.warn("환율 갱신 실패:", err);
    });
  }, [updateFxRate]);

  /** 전체 매매 기록을 CSV로 내보내기 (날짜 최신순). */
  const exportTradesCsv = useCallback(() => {
    if (trades.length === 0) {
      toast.error("내보낼 거래 내역이 없습니다.");
      return;
    }
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));
    const sorted = [...trades].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const block: ReportBlock = {
      title: "주식 거래내역",
      head: ["날짜", "계좌", "종목코드", "종목명", "구분", "수량", "단가", "수수료", "거래금액", "현금영향"],
      rows: sorted.map((t) => [
        t.date,
        nameById.get(t.accountId) ?? t.accountId,
        t.ticker,
        t.name,
        t.side === "buy" ? "매수" : "매도",
        t.quantity,
        t.price,
        t.fee,
        t.totalAmount,
        t.cashImpact
      ])
    };
    const blob = new Blob(["﻿" + blocksToCsv([block])], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `주식_거래내역_${getTodayKST()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`${trades.length}건 CSV 내보내기 완료`);
  }, [trades, accounts]);

  // 시세 갱신 상태·로직 — features/stocks/useQuoteRefresh 훅 소유
  const {
    isLoadingQuotes,
    quoteRefreshProgress,
    quoteError,
    setQuoteError,
    clearQuoteError,
    yahooUpdatedAt,
    handleRefreshQuotesHoldings,
    handleRefreshQuotesAuto,
    handleRefreshQuotesFull,
    retryLastQuoteRefresh
  } = useQuoteRefresh({
    trades,
    prices,
    tickerDatabase,
    fxRate,
    updateFxRate,
    onChangePrices,
    onChangeTickerDatabase,
    onLog
  });

  // 주식 탭 진입 시 마지막 갱신 "시도"가 10분+ 지났으면 보유 종목 1회 자동 갱신 —
  // 자동 갱신(30분 interval)은 기본 꺼짐 + 탭 체류 중에만 동작해 "탭 열면 옛값" 문제가 있었음.
  // 판정 기준은 시세 updatedAt(체결 시각)이 아님: 장외엔 체결 시각이 멈춰 매 진입마다 발사된다.
  const autoRefreshOnMountRef = useRef(false);
  useEffect(() => {
    if (autoRefreshOnMountRef.current) return;
    if (positions.length === 0) return;
    autoRefreshOnMountRef.current = true;
    const STALE_MS = 10 * 60 * 1000;
    if (Date.now() - getLastQuoteRefreshAt() > STALE_MS) {
      void handleRefreshQuotesAuto();
    }
  }, [positions.length, handleRefreshQuotesAuto]);

  const handleLoadTickers = useCallback(async () => {
    onLog?.("종목 불러오기 시작...", "info");
    await onLoadInitialTickers();
  }, [onLog, onLoadInitialTickers]);

  const handlePositionClick = useCallback((p: PositionWithPrice) => {
    // 보유 종목 클릭 시 종목 상세 모달 열기
    setSelectedPosition(p);
  }, []);

  const handleQuickSell = useCallback((p: PositionWithPrice, e: React.MouseEvent) => {
    e.stopPropagation(); // 상세 모달 열기 방지
    tradeFormRef.current?.startQuickTrade(p, "sell");
  }, []);

  const handleQuickBuy = useCallback((p: PositionWithPrice, e: React.MouseEvent) => {
    e.stopPropagation(); // 상세 모달 열기 방지
    tradeFormRef.current?.startQuickTrade(p, "buy");
  }, []);

  // 거래 내역 "수정"/"취소" — 폼 상태는 TradeFormSection 소유, ref API로 위임
  const startEditTrade = useCallback((t: StockTrade) => {
    tradeFormRef.current?.startEditTrade(t);
  }, []);

  const resetTradeForm = useCallback(() => {
    tradeFormRef.current?.resetForm();
  }, []);

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
  const handleAccountReorder = useCallback((accountId: string, newPosition: number) => {
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
  }, [accountOrder, positionsByAccount]);

  // 프리셋 관련 함수들 — 폼 적재 부분은 TradeFormSection ref로 위임, lastUsed 기록은 부모 소유
  const applyPreset = useCallback((preset: StockPreset) => {
    tradeFormRef.current?.applyPreset(preset);

    // 프리셋 사용 기록 업데이트
    if (onChangePresets) {
      const updated = presets.map((p) =>
        p.id === preset.id ? { ...p, lastUsed: new Date().toISOString() } : p
      );
      onChangePresets(updated);
    }
  }, [onChangePresets, presets]);

  const saveCurrentAsPreset = useCallback(() => {
    const presetName = prompt("프리셋 이름을 입력하세요:");
    if (!presetName || !presetName.trim()) return;

    const tradeForm = tradeFormRef.current?.getFormSnapshot();
    if (!tradeForm) return;

    const newPreset: StockPreset = {
      id: newIdWithPrefix("PRESET"),
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
  }, [onChangePresets, presets]);

  const deletePreset = useCallback((id: string) => {
    if (!confirm("프리셋을 삭제하시겠습니까?")) return;
    if (onChangePresets) {
      onChangePresets(presets.filter((p) => p.id !== id));
    }
  }, [onChangePresets, presets]);

  const openPresetModal = useCallback(() => setShowPresetModal(true), []);
  const closePresetModal = useCallback(() => setShowPresetModal(false), []);

  // 필터링된 프리셋 (최근 사용한 것 우선, 최대 9개)
  // 복사 후 정렬 — presets prop(스토어 배열)을 in-place sort로 직접 변형하지 않음
  const filteredPresets = useMemo(() => {
    return [...presets]
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

  // 단축키:
  // - Ctrl+S(백업)·Ctrl+1~9(탭 이동)는 App 전역(useKeyboardShortcuts) 소유 — 여기서 등록하면
  //   백업+거래제출 / 탭이동+프리셋이 동시 발동하는 이중 발화가 생겨 제거했다 (불변식 #10).
  // - 거래 폼 제출은 폼 스코프 Ctrl+Enter(TradeFormSection)로 처리. 프리셋은 프리셋 칩 클릭으로.

  return (
    <div>
      <StockTabNav activeTab={activeTab} setActiveTab={setActiveTab} showFxTab={Boolean(onChangeLedger)} />

      {/* 주식 탭 */}
      {activeTab === "stocks" && (
        <>
          <StocksHeaderSection
            fxRate={fxRate}
            fxUpdatedAt={fxUpdatedAt}
            yahooUpdatedAt={yahooUpdatedAt}
            isLoadingQuotes={isLoadingQuotes}
            isLoadingTickerDatabase={isLoadingTickerDatabase}
            onRefreshHoldings={handleRefreshQuotesHoldings}
            onRefreshFull={handleRefreshQuotesFull}
            onLoadTickers={handleLoadTickers}
            onExportTradesCsv={exportTradesCsv}
          />

          <StockStatsCard
            totalMarketValue={totals.totalMarketValue}
            totalMarketValueUSD={totals.totalMarketValueUSD}
            fxRate={fxRate}
            dayPnl={totals.dayPnl}
            totalPnl={totals.totalPnl}
            totalCost={totals.totalCost}
            totalReturnRate={totalReturnRate}
            totalDividend={totalDividend}
            realizedPnl={realized.pnl}
            realizedReturnRate={realized.returnRate}
            realizedTradeCount={realized.tradeCount}
          />

          {/* 프리셋 버튼 영역 */}
          <PresetSection
            presets={filteredPresets}
            onApplyPreset={applyPreset}
            onSaveCurrent={saveCurrentAsPreset}
            onOpenModal={openPresetModal}
          />
        </>
      )}

      {/* 거래 입력 폼 + 시세 정보 — 항상 마운트(탭 전환 시 폼 상태 유지), stocks 탭에서만 표시 */}
      <TradeFormSection
        ref={tradeFormRef}
        visible={activeTab === "stocks"}
        accounts={accounts}
        trades={trades}
        prices={prices}
        ledger={ledger}
        tickerDatabase={tickerDatabase}
        positions={positions}
        latestPriceByCanonicalTicker={latestPriceByCanonicalTicker}
        fxRate={fxRate}
        onChangeTrades={onChangeTrades}
        onChangePrices={onChangePrices}
        onChangeTickerDatabase={onChangeTickerDatabase}
        onChangeAccounts={onChangeAccounts}
        onLog={onLog}
        setQuoteError={setQuoteError}
      />

      {activeTab === "stocks" && (
        <>
          <QuoteErrorBanner
            quoteError={quoteError}
            onDismiss={clearQuoteError}
            onRetry={retryLastQuoteRefresh}
          />

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

      {/* ETF 괴리율 탭 — 환전 옆 별도 탭 */}
      {activeTab === "etf" && <EtfDiscountSection />}

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

      {showPresetModal && (
        <PresetModal
          presets={presets}
          onClose={closePresetModal}
          onSaveCurrent={saveCurrentAsPreset}
          onApplyPreset={applyPreset}
          onDeletePreset={deletePreset}
        />
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
          onClose={() => setSelectedPosition(null)}
          onChangeLedger={onChangeLedger || (() => {})}
          fxRate={propFxRate}
        />
      )}

      <QuoteRefreshProgress isLoadingQuotes={isLoadingQuotes} quoteRefreshProgress={quoteRefreshProgress} />
    </div>
  );
};
