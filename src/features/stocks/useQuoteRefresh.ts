/**
 * 시세 갱신 훅 — 보유 종목/전체(ticker.json) 시세 갱신 + 재시도 + 진행률 + 자동 갱신(usePriceAutoRefresh).
 * StocksPage에서 분리 — 갱신 상태(isLoadingQuotes/진행률/에러/마지막 갱신 시각)와
 * Yahoo/CoinGecko 배치 조회·재시도·prices 머지 로직을 페이지 밖으로 이동.
 * 반환하는 핸들러는 모두 useCallback으로 참조 안정 — memo된 자식(StocksHeaderSection 등)에 그대로 전달 가능.
 * setQuoteError는 React setState라 참조 안정 — TradeFormSection(단일 조회 에러 공유)에 그대로 전달.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { StockPrice, StockTrade, TickerInfo } from "../../types";
import { fetchYahooQuotes, fetchTickersFromFile } from "../../yahooFinanceApi";
import { fetchCryptoQuotes } from "../../coinGeckoApi";
import { saveTickerToJson } from "../../storage";
import {
  isKRWStock,
  isCryptoStock,
  canonicalTickerForMatch,
  getCurrentHoldingsTickers
} from "../../utils/finance";
import { displayNameForTicker } from "../../utils/stockHelpers";
import { usePriceAutoRefresh } from "../../hooks/usePriceAutoRefresh";
import { STORAGE_KEYS } from "../../constants/config";

/** 유효 시세 판정 — 0/NaN은 실패로 취급해 재시도·머지에서 제외 */
const isValidPrice = (price: unknown): boolean =>
  typeof price === "number" && Number.isFinite(price) && price > 0;

const hasHangul = (s?: string | null): boolean => !!s && /[가-힣]/.test(s);

/**
 * 마지막 시세 갱신 "시도" 시각 — 탭 진입 stale 판정용.
 * 시세의 updatedAt(체결 시각)은 장외엔 멈춰 있어 신선도 기준으로 쓰면
 * 장 마감 후~다음 개장까지 항상 stale로 오판된다.
 */
export function getLastQuoteRefreshAt(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEYS.LAST_QUOTE_REFRESH_AT) ?? 0);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function markQuoteRefreshAttempt(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_QUOTE_REFRESH_AT, String(Date.now()));
  } catch {
    // localStorage 불가 환경이면 stale 판정만 보수적으로 동작
  }
}

interface UseQuoteRefreshParams {
  trades: StockTrade[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
  fxRate: number | null;
  /** 환율 갱신 — fxRate 상태는 페이지 소유 (positions 등 공유 memo가 의존). 갱신된 환율을 반환 (실패 시 null) */
  updateFxRate: () => Promise<number | null>;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[] | ((prev: TickerInfo[]) => TickerInfo[])) => void;
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
}

export function useQuoteRefresh({
  trades,
  prices,
  tickerDatabase,
  fxRate,
  updateFxRate,
  onChangePrices,
  onChangeTickerDatabase,
  onLog
}: UseQuoteRefreshParams) {
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  /** 에러 시 「다시 시도」에 사용 */
  const lastQuoteRefreshModeRef = useRef<"holdings" | "full" | null>(null);
  const [quoteRefreshProgress, setQuoteRefreshProgress] = useState({ current: 0, total: 1 });
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [yahooUpdatedAt, setYahooUpdatedAt] = useState<string | null>(null);
  // 최신 prices prop 추적 — 갱신 도중(시작 시점 클로저) 다른 경로로 바뀐 시세를 머지 시 유실하지 않도록
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  // 동시 실행 가드 — 수동 갱신과 자동 갱신(usePriceAutoRefresh)이 겹치면 lost update 발생
  const isRefreshingRef = useRef(false);

  // 시세 갱신용: "현재 보유 중" 티커만 (청산 종목은 굳이 갱신 안 함 → 429 회피 + 속도 ↑)
  const holdingsOnlyTickers = useMemo(() => getCurrentHoldingsTickers(trades), [trades]);

  /** tickerDatabase의 market=CRYPTO 우선, 없으면 티커 문자열 휴리스틱 */
  const isHoldingsCrypto = useMemo(() => {
    const dbByKey = new Map(tickerDatabase.map((x) => [canonicalTickerForMatch(x.ticker), x]));
    return (t: string) => {
      const db = dbByKey.get(canonicalTickerForMatch(t));
      if (db?.market === "CRYPTO") return true;
      return isCryptoStock(t);
    };
  }, [tickerDatabase]);

  // 보유 종목 갱신용 (holdings 모드·자동 갱신에서 사용)
  const holdingsStockTickers = useMemo(() =>
    holdingsOnlyTickers.filter((t) => !isHoldingsCrypto(t)).map((t) => t.toUpperCase()),
    [holdingsOnlyTickers, isHoldingsCrypto]
  );
  const holdingsCryptoTickers = useMemo(() =>
    holdingsOnlyTickers.filter((t) => isHoldingsCrypto(t)).map((t) => t.toLowerCase()),
    [holdingsOnlyTickers, isHoldingsCrypto]
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
        // 0/NaN 시세는 저장하지 않음 — prices에 0이 남으면 현재가 0원·수익률 -100%로 전파됨
        if (!isValidPrice(r.price)) continue;
        const rKey = canonicalTickerForMatch(r.ticker);
        const existingName =
          next.find((p) => canonicalTickerForMatch(p.ticker) === rKey)?.name ??
          trades.find((t) => canonicalTickerForMatch(t.ticker) === rKey)?.name;
        let displayName = displayNameForTicker(r.ticker, r.name ?? existingName ?? undefined);
        // 한국 종목: 기존 한글명을 영문 API명으로 덮어쓰지 않음 (krNames 미수록 신규 ETF 보호)
        if (isKRWStock(r.ticker) && !hasHangul(displayName) && hasHangul(existingName)) {
          displayName = existingName!;
        }
        const nameToSave = displayName || r.name || r.ticker;
        if (
          persistToTickerJson &&
          nameToSave &&
          !isCryptoStock(r.ticker) &&
          // 한국 종목인데 한글명이 없으면 ticker.json에 기록하지 않음 — 영문명 고착 루프 방지
          (!isKRWStock(r.ticker) || hasHangul(nameToSave))
        ) {
          const market = isKRWStock(r.ticker) ? "KR" : "US";
          void saveTickerToJson(r.ticker, nameToSave, market);
        }
        const idx = next.findIndex((p) => canonicalTickerForMatch(p.ticker) === rKey);
        const item: StockPrice = {
          ticker: r.ticker,
          name: displayName || existingName || r.ticker,
          price: r.price,
          currency: r.currency,
          change: r.change,
          changePercent: r.changePercent,
          // updatedAt 없는 결과(chart 폴백 일부)가 기존 updatedAt을 undefined로 덮지 않게 보존
          updatedAt: r.updatedAt ?? next[idx]?.updatedAt,
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

      // 동시 실행 가드 — 진행 중이면 건너뜀 (자동 갱신과 수동 갱신 충돌 방지)
      if (isRefreshingRef.current) {
        onLog?.(`${logLabel}: 이미 시세 갱신이 진행 중입니다 — 건너뜁니다.`, "info");
        return;
      }
      isRefreshingRef.current = true;
      markQuoteRefreshAttempt();

      onLog?.(`${logLabel} 시작...`, "info");
      try {
        setIsLoadingQuotes(true);
        setQuoteError(null);
        // 환율 갱신을 시작해 두고, 암호화폐 환산 시점에 결과를 사용 (stale 클로저 fxRate 의존 제거)
        const fxPromise: Promise<number | null> = updateFxRate().catch(() => null);
        setQuoteRefreshProgress({ current: 0, total: Math.max(1, totalSymbols) });
        onLog?.(`[시작] ${logLabel} — ${totalSymbols}개 티커`, "info");

        const allResults: StockPrice[] = [];
        const failedTickers: string[] = [];

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
            },
            // Naver 배치 성공분 즉시 반영 — 느린 종목별 폴백/재시도를 기다리지 않고 화면 먼저 갱신.
            // ticker.json 기록은 최종 머지 1회로 일원화 (이중 POST 방지)
            onPartialResults: (partial) => {
              const merged = mergeQuoteResultsIntoPrices(pricesRef.current, partial, {
                persistToTickerJson: false
              });
              onChangePrices(merged);
            }
          });
          const successStock = new Set(
            stockResults
              .filter((r) => r.ticker !== "USDKRW=X" && isValidPrice(r.price))
              .map((r) => r.ticker)
          );
          let failedStock = uniqueStockTickers.filter((t) => !successStock.has(t));
          const maxRetries = 2; // 영구 실패 종목이 갱신 전체를 붙잡지 않도록 재시도는 1회만
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
              retryResults.filter((r) => isValidPrice(r.price)).map((r) => r.ticker)
            );
            failedStock = failedStock.filter((t) => !retrySuccess.has(t));
            stockResults = [...stockResults, ...retryResults];
          }
          setQuoteRefreshProgress((p) => ({ ...p, current: uniqueStockTickers.length }));
          allResults.push(...stockResults.filter((r) => r.ticker !== "USDKRW=X"));
          failedTickers.push(...failedStock);
        }

        if (uniqueCryptoTickers.length > 0) {
          // 방금 갱신된 환율 우선 — 없으면 기존 fxRate (stale 클로저 제거)
          const refreshedFx = await fxPromise;
          const cryptoResults = await fetchCryptoQuotes(uniqueCryptoTickers, refreshedFx ?? fxRate ?? undefined);
          const cryptoAsStockPrice: StockPrice[] = cryptoResults.map((c) => ({
            ticker: c.ticker,
            // name은 풀네임(CoinGecko ID) — short symbol은 ticker 표시 단에서 cryptoDisplaySymbol로 변환.
            // priceInfo.name이 short symbol("ETH")이면 calculations.ts의 name 우선순위 때문에 거래의 name이 덮여
            // "종목명 컬럼"에 "ETH"가 떠버림 → 사용자 의도(name="ethereum")와 어긋남.
            name: c.ticker,
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

        // 시작 시점 클로저(prices)가 아닌 최신 prices(ref) 기반 머지 — 갱신 도중 발생한 다른 변경 보존
        const next = mergeQuoteResultsIntoPrices(pricesRef.current, allResults, { persistToTickerJson });
        onChangePrices(next);

        if (updateTickerDatabase) {
          onChangeTickerDatabase((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const byKey = new Map(list.map((t) => [canonicalTickerForMatch(t.ticker), t]));
            for (const r of allResults) {
              if (r.ticker === "USDKRW=X") continue;
              const key = canonicalTickerForMatch(r.ticker);
              const existing = byKey.get(key);
              let name = displayNameForTicker(r.ticker, r.name ?? undefined) || r.name || r.ticker;
              // 한국 종목: tickerDatabase의 기존 한글명을 영문 API명으로 덮어쓰지 않음
              if (isKRWStock(r.ticker) && !hasHangul(name) && hasHangul(existing?.name)) {
                name = existing!.name;
              }
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

        const successCount = allResults.filter((r) => isValidPrice(r.price)).length;
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
        isRefreshingRef.current = false;
        setIsLoadingQuotes(false);
      }
    },
    [
      mergeQuoteResultsIntoPrices,
      onChangePrices,
      onChangeTickerDatabase,
      onLog,
      tickerDatabase,
      fxRate,
      updateFxRate
    ]
  );

  const handleRefreshQuotesHoldings = useCallback(async () => {
    lastQuoteRefreshModeRef.current = "holdings";
    await runQuoteRefresh({
      mode: "holdings",
      stockTickers: holdingsStockTickers,
      cryptoTickers: holdingsCryptoTickers,
      updateTickerDatabase: true,
      persistToTickerJson: true,
      logLabel: "보유 종목"
    });
  }, [runQuoteRefresh, holdingsStockTickers, holdingsCryptoTickers]);

  /**
   * 자동 갱신 경로 (interval·탭 진입 stale) — 수동 갱신과 달리 tickerDatabase·ticker.json은
   * 건드리지 않아 사용자 액션 없는 갱신이 undo 히스토리·dev 파일을 오염시키지 않는다.
   */
  const handleRefreshQuotesAuto = useCallback(async () => {
    if (holdingsStockTickers.length === 0 && holdingsCryptoTickers.length === 0) return;
    await runQuoteRefresh({
      mode: "holdings",
      stockTickers: holdingsStockTickers,
      cryptoTickers: holdingsCryptoTickers,
      updateTickerDatabase: false,
      persistToTickerJson: false,
      logLabel: "자동 갱신"
    });
  }, [runQuoteRefresh, holdingsStockTickers, holdingsCryptoTickers]);

  usePriceAutoRefresh({ onRefresh: handleRefreshQuotesAuto });

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

  /** QuoteErrorBanner 「다시 시도」 — 마지막 갱신 모드로 재실행 */
  const retryLastQuoteRefresh = useCallback(() => {
    const m = lastQuoteRefreshModeRef.current;
    if (m === "full") void handleRefreshQuotesFull();
    else void handleRefreshQuotesHoldings();
  }, [handleRefreshQuotesFull, handleRefreshQuotesHoldings]);

  /** QuoteErrorBanner 「닫기」 — 참조 안정 콜백 */
  const clearQuoteError = useCallback(() => setQuoteError(null), []);

  return {
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
  };
}
