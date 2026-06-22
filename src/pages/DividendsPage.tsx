/**
 * 배당/이자 (DividendsPage) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 무거운 파생값(adjustedPrices/positions/latestPriceByCanonicalTicker/incomeRows와 그 집계들)은
 * 여기서 useMemo로 계산해 분리 컴포넌트(features/dividends/*)에 props로 내려준다. 자식은 재계산하지 않는다.
 *
 * 입력 상태 소유권 (타이핑이 이 페이지를 재렌더하지 않도록 자식이 소유):
 *   - DividendFormSection  : 배당 입력 폼 + 빠른 입력 카드 (dividendForm/showUSD)
 *   - InterestFormSection  : 이자 입력 폼 (interestForm)
 *   - IncomeRecordsSection : 월별 내역 표 인라인 편집 상태 (editing*)
 * 두 폼은 항상 마운트하고 visible로 표시를 토글한다 (탭 전환에도 입력값 유지 — 분리 전 동작과 동일).
 * 부모는 탭(tab)과 환율(fxRate)만 소유한다.
 *
 * 자식은 모두 React.memo — 부모가 넘기는 콜백은 setState 그대로 또는 prop(onChangeLedger) 그대로 전달해 참조 고정.
 */
import React, { useMemo, useState, useEffect, useDeferredValue } from "react";
import type { Account, HistoricalDailyClose, LedgerEntry, StockPrice, StockTrade, TickerInfo } from "../types";
import { computePositions } from "../calculations";
import { formatKRW } from "../utils/formatter";
import { isKRWStock, isUSDStock, canonicalTickerForMatch, extractTickerFromText } from "../utils/finance";
import { isDividendEntryLoose, isInterestEntryLoose } from "../utils/categoryMatch";
import { parseExDateFromNote, parseQuantityFromNote } from "../utils/dividend";
import { getKrNames } from "../storage";
import { STORAGE_KEYS } from "../constants/config";
import type { DividendRow, TabType } from "../features/dividends/types";
import { DividendFormSection } from "../features/dividends/DividendFormSection";
import { ComprehensiveTaxCard } from "../features/dividends/ComprehensiveTaxCard";
import { DividendCalendarCard } from "../features/dividends/DividendCalendarCard";
import { InterestFormSection } from "../features/dividends/InterestFormSection";
import { IncomeSummarySection } from "../features/dividends/IncomeSummarySection";
import { IncomeRecordsSection } from "../features/dividends/IncomeRecordsSection";

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

function readLastTab(): TabType {
  if (typeof window === "undefined") return "dividend";
  try {
    const v = window.localStorage.getItem(STORAGE_KEYS.DIVIDENDS_LAST_TAB);
    return v === "interest" ? "interest" : "dividend";
  } catch {
    return "dividend";
  }
}

export const DividendsView: React.FC<Props> = ({ accounts, ledger, trades, prices, tickerDatabase, historicalDailyCloses: _historicalDailyCloses = [], onChangeLedger, fxRate: propFxRate = null }) => {
  const deferredLedger = useDeferredValue(ledger);
  const deferredTrades = useDeferredValue(trades);
  // 입력·보기 분리 → 단일 탭: 선택한 탭의 폼과 표·차트만 보임.
  // 이전 두 줄 탭(activeTab + viewMode) 구조는 화면 절반이 다른 자료라 혼란을 줘서 통합.
  const [tab, setTabState] = useState<TabType>(() => readLastTab());
  const setTab = (next: TabType) => {
    setTabState(next);
    try { window.localStorage.setItem(STORAGE_KEYS.DIVIDENDS_LAST_TAB, next); } catch { /* */ }
  };
  const [fxRate, setFxRate] = useState<number | null>(propFxRate);

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

  // 환율 업데이트 (props에서 전달받은 경우)
  useEffect(() => {
    if (propFxRate !== null) {
      setFxRate(propFxRate);
    }
  }, [propFxRate]);

  const incomeRows = useMemo(() => {
    // 분류 단일소스(categoryMatch) — cat/sub 정확 매칭 + description fallback (배당·이자 loose).
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" && (isDividendEntryLoose(l) || isInterestEntryLoose(l));

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

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
        // 거래 당시 환율(fxRateAtTrade) 우선 — 다른 곳(StockDetailModal·computePositions)과 일관
        const appliedFx =
          t.fxRateAtTrade && t.fxRateAtTrade > 0
            ? t.fxRateAtTrade
            : fxRate && fxRate > 0
              ? fxRate
              : null;
        const amtKrW = isUSDStock(ticker) && appliedFx ? t.totalAmount * appliedFx : t.totalAmount;
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
      // USD 배당/이자는 원화로 환산해야 합계·수익률(KRW 원가 대비)이 일관 (불변식 #5). 환율 미로드 시 raw 폴백.
      const amount = l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount;
      const dividendPerShare = quantity != null && quantity > 0 ? amount / quantity : undefined;
      const dateForCost = parseExDateFromNote(l.note) || l.date || "";
      const costBasis = ticker && dateForCost ? getCostBasisAtDate(ticker, dateForCost, accountIdForPosition) : 0;
      const yieldRate =
        amount > 0 && costBasis > 0 ? amount / costBasis : undefined;
      const isInterest = (l.category ?? "") === "이자" || ((desc.includes("이자") || (l.category ?? "").includes("이자")) && !ticker);
      rows.push({
        id: l.id,
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
  }, [deferredLedger, deferredTrades, trades, accounts, tickerDatabase, fxRate, latestPriceByCanonicalTicker]);

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

      {/* 항상 보이는 요약 한 줄 — 어느 탭이든 전체 그림을 한눈에 */}
      <div
        className="hint"
        style={{
          fontSize: 13,
          marginBottom: 12,
          padding: "8px 12px",
          background: "var(--surface)",
          borderRadius: 6,
          display: "flex",
          gap: 16,
          flexWrap: "wrap"
        }}
      >
        <span>누적 배당 <strong style={{ color: "var(--danger)" }}>{formatKRW(Math.round(totalDividend))}</strong></span>
        <span>·</span>
        <span>이자 <strong style={{ color: "var(--danger)" }}>{formatKRW(Math.round(totalInterest))}</strong></span>
        <span>·</span>
        <span>합계 <strong>{formatKRW(Math.round(totalDividend + totalInterest))}</strong></span>
      </div>

      {/* 종합과세 추적 (B1) — 올해 금융소득 vs 2,000만 임계 */}
      <ComprehensiveTaxCard ledger={ledger} fxRate={fxRate} />

      {/* 배당 캘린더 & 목표 (C1·C2) — 향후 12개월 예상 배당 + 목표 진행률 */}
      <DividendCalendarCard ledger={ledger} fxRate={fxRate} />

      {/* 단일 탭 — 선택한 쪽의 입력 폼·표·차트만 노출 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={tab === "dividend" ? "primary" : ""}
          onClick={() => setTab("dividend")}
          style={{ padding: "8px 20px", fontSize: 14, fontWeight: 600 }}
        >
          배당
        </button>
        <button
          type="button"
          className={tab === "interest" ? "primary" : ""}
          onClick={() => setTab("interest")}
          style={{ padding: "8px 20px", fontSize: 14, fontWeight: 600 }}
        >
          이자
        </button>
      </div>

      {/* 배당 입력 폼 + 빠른 입력 — 분리 컴포넌트 (React.memo). 폼 상태는 자식 소유, 항상 마운트(탭 전환에도 입력 유지) */}
      <DividendFormSection
        visible={tab === "dividend"}
        accounts={accounts}
        ledger={ledger}
        trades={trades}
        tickerDatabase={tickerDatabase}
        positions={positions}
        latestPriceByCanonicalTicker={latestPriceByCanonicalTicker}
        fxRate={fxRate}
        onChangeLedger={onChangeLedger}
      />

      {/* 이자 입력 폼 — 분리 컴포넌트 (React.memo). 폼 상태는 자식 소유, 항상 마운트(탭 전환에도 입력 유지) */}
      <InterestFormSection
        visible={tab === "interest"}
        accounts={accounts}
        ledger={ledger}
        onChangeLedger={onChangeLedger}
      />

      {/* 요약 카드 + 종목별/월별 합계 표 — 분리 컴포넌트 (React.memo, 표시 전용) */}
      <IncomeSummarySection
        tab={tab}
        totalDividend={totalDividend}
        totalInterest={totalInterest}
        byTicker={byTicker}
        monthlyDividendTotal={monthlyDividendTotal}
        monthlyInterestTotal={monthlyInterestTotal}
      />

      {/* 월별 배당/이자 내역 표 — 분리 컴포넌트 (React.memo). 인라인 편집 상태는 자식 소유 */}
      <IncomeRecordsSection
        tab={tab}
        accounts={accounts}
        ledger={ledger}
        positions={positions}
        byMonthSource={byMonthSource}
        byMonthInterest={byMonthInterest}
        onChangeLedger={onChangeLedger}
      />
    </div>
  );
};
