/**
 * 주식 거래 입력 폼 + 시세 정보 카드 (two-column 영역) + 조회 결과 힌트.
 * StocksPage에서 분리 — tradeForm/tickerInfo/시세 검색 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(StocksPage)를 재렌더하지 않는다.
 * React.memo(forwardRef)로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 탭 전환(포트폴리오/환전) 시에도 폼 상태가 유지되도록 부모는 이 컴포넌트를 항상 마운트하고,
 * visible=false면 null을 렌더한다 (상태 보존 + DOM 제거 — 분리 전 동작과 동일).
 *
 * 부모 → 폼 외부 접점은 ref API(TradeFormSectionHandle)로 노출:
 *   - submit():                 Ctrl+S 단축키 저장 (폼 제출과 동일 로직)
 *   - startEditTrade(t):        거래 내역 "수정" — 기존 거래를 폼에 적재
 *   - resetForm():              수정 취소 등 폼 초기화 (side/accountId 유지)
 *   - startQuickTrade(p, side): 보유 종목 빠른 매수/매도 — 폼 적재 + 폼으로 스크롤
 *   - applyPreset(preset):      프리셋 적용 — 폼 필드만 갱신 (lastUsed 기록은 부모 소유)
 *   - getFormSnapshot():        "현재 저장" 프리셋 생성용 폼 스냅샷
 */
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Autocomplete } from "../../components/ui/Autocomplete";
import type {
  Account,
  LedgerEntry,
  PositionRow,
  StockPreset,
  StockPrice,
  StockTrade,
  TickerInfo,
  TradeSide
} from "../../types";
import { fetchYahooQuotes } from "../../yahooFinanceApi";
import { saveTickerToJson } from "../../storage";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { isUSDStock, isKRWStock, isCryptoStock, canonicalTickerForMatch } from "../../utils/finance";
import { shouldUseUsdBalanceMode as shouldUseUsdBalanceModeUtil, computeTradeCashImpact } from "../../utils/tradeCashImpact";
import { toast } from "react-hot-toast";
import { validateDate, validateTicker, validateRequired, validateQuantity, validateAmount, validateAccountTickerCurrency } from "../../utils/validation";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { getTodayKST } from "../../utils/date";
import { displayNameForTicker, createDefaultTradeForm, type TradeFormState } from "../../utils/stockHelpers";

/** 환율 미로드 시 미국 주식 저장에 사용하는 기본 환율 (저장 차단 대신 사용) */
const DEFAULT_FX_RATE = 1400;

/** 부모(StocksPage)에서 ref로 호출하는 폼 외부 접점 */
export interface TradeFormSectionHandle {
  submit: () => void;
  startEditTrade: (t: StockTrade) => void;
  resetForm: () => void;
  startQuickTrade: (p: PositionRow, side: TradeSide) => void;
  applyPreset: (preset: StockPreset) => void;
  getFormSnapshot: () => TradeFormState;
}

interface Props {
  /** stocks 탭에서만 표시 — false면 null 렌더 (폼 상태는 유지) */
  visible: boolean;
  accounts: Account[];
  trades: StockTrade[];
  prices: StockPrice[];
  ledger: LedgerEntry[];
  tickerDatabase: TickerInfo[];
  /** 부모 memo (computePositions) — 매도 시 보유 수량 초과 검증용 */
  positions: PositionRow[];
  /** 부모 memo — canonical 티커별 최신 시세 (updatedAt 기준) */
  latestPriceByCanonicalTicker: Map<string, StockPrice>;
  fxRate: number | null;
  onChangeTrades: (next: StockTrade[] | ((prev: StockTrade[]) => StockTrade[])) => void;
  onChangePrices: (next: StockPrice[]) => void;
  onChangeTickerDatabase: (next: TickerInfo[] | ((prev: TickerInfo[]) => TickerInfo[])) => void;
  onChangeAccounts?: (next: Account[]) => void;
  onLog?: (message: string, type?: "success" | "error" | "info") => void;
  /** 단일 조회 에러 — 부모 QuoteErrorBanner와 공유 (useQuoteRefresh setState — 참조 안정) */
  setQuoteError: (next: string | null) => void;
}

export const TradeFormSection = React.memo(React.forwardRef<TradeFormSectionHandle, Props>(
  function TradeFormSection({
    visible,
    accounts,
    trades,
    prices,
    ledger,
    tickerDatabase,
    positions,
    latestPriceByCanonicalTicker,
    fxRate,
    onChangeTrades,
    onChangePrices,
    onChangeTickerDatabase,
    onChangeAccounts,
    onLog,
    setQuoteError
  }, ref) {
    const [tradeForm, setTradeForm] = useState(createDefaultTradeForm);
    const [tickerSuggestions, setTickerSuggestions] = useState<TickerInfo[]>([]);
    // 최신 accounts prop 추적 — setTimeout 시점에 스냅샷이 아닌 최신 배열에 델타만 적용
    // (스냅샷 전체 교체는 그 사이 발생한 다른 계좌 변경을 유실시킴)
    const accountsRef = useRef(accounts);
    accountsRef.current = accounts;
    // showTickerSuggestions 상태 제거 (Autocomplete 내부에서 처리)
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
              // 한국 종목은 한글명일 때만 ticker.json에 기록 — 영문명이 들어가면 krNames 생성에서
              // 영구 탈락(한글 필터)해 종목명이 영문으로 고착된다
              if (market !== "CRYPTO" && (market !== "KR" || /[가-힣]/.test(r.name))) {
                await saveTickerToJson(symbol, r.name, market);
              }
            }
          }
        } catch (err) {
          console.warn("거래 입력 폼 시세 자동 조회 실패:", err);
        }
      }, 500);

      return () => clearTimeout(timer);
    }, [tradeForm.ticker, tradeForm.exchange, tradeForm.market, tradeForm.name, tickerSuggestions.length, tickerDatabase]);

    const formatPriceWithCurrency = (value: number, currency?: string, ticker?: string) => {
      // 티커 형식으로 통화 판단
      const isUSD = currency === "USD" || (ticker ? isUSDStock(ticker) : false);

      if (isUSD) {
        return formatUSD(value);
      }
      // 한국 종목은 원화로 표시
      return formatKRW(value);
    };

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
      // 거래 수정 중이면 편집 대상 거래 자신을 제외한 보유 수량으로 검증 —
      // 전량 매도 거래(보유 0)도 수정할 수 있어야 한다 (자기 매도분이 검증에 반영되는 버그 수정)
      if (tradeForm.side === "sell" && tradeForm.accountId && tickerClean && !errors.quantity) {
        const q = Number(tradeForm.quantity);
        if (!Number.isNaN(q) && q > 0) {
          const pos = positions.find(
            (p) => p.accountId === tradeForm.accountId && canonicalTickerForMatch(p.ticker) === tickerClean
          );
          let available = pos?.quantity ?? 0;
          if (tradeForm.id) {
            const original = trades.find((t) => t.id === tradeForm.id);
            if (
              original &&
              original.accountId === tradeForm.accountId &&
              canonicalTickerForMatch(original.ticker) === tickerClean
            ) {
              // 편집 대상이 매도였다면 그 수량만큼 다시 매도 가능, 매수였다면 제외
              available += original.side === "sell" ? original.quantity : -original.quantity;
            }
          }
          if (available <= 1e-8) {
            errors.quantity = "해당 계좌에 이 종목 보유 내역이 없습니다.";
          } else if (q > available + 1e-8) {
            errors.quantity = `보유 수량(${Number(available.toFixed(8))}주)을 초과할 수 없습니다.`;
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
    }, [tradeForm, positions, trades]);

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
      // 계좌는 폼 검증(validateRequired)에서 필수 — 도달 불가 fallback 제거
      const accountId = tradeForm.accountId;
      const date = tradeForm.date || getTodayKST();
      const hasAnyPrice = price > 0 || (isUSDTicker && priceKRWEarly > 0);
      if (!date || !accountId || !tickerClean || !quantity || !hasAnyPrice) {
        if (!hasAnyPrice) toast.error(ERROR_MESSAGES.QUOTE_UNAVAILABLE);
        return;
      }
      // 음수 입력 명시 거부 (HTML number input은 음수를 허용함)
      if (quantity < 0 || price < 0 || fee < 0 || priceKRWEarly < 0) {
        toast.error("수량·단가·수수료는 음수일 수 없습니다.");
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
      /** usdBalance 델타를 최신 accounts(ref) 기준으로 적용 — 스냅샷 교체로 인한 병행 변경 유실 방지 */
      const applyUsdDeltas = (deltas: Map<string, number>) => {
        if (!onChangeAccounts || deltas.size === 0) return;
        setTimeout(() => {
          const base = accountsRef.current;
          onChangeAccounts(
            base.map((a) => {
              const delta = deltas.get(a.id);
              if (!delta) return a;
              return { ...a, usdBalance: (a.usdBalance ?? 0) + delta };
            })
          );
        }, 0);
      };

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
        applyUsdDeltas(usdDeltaByAccount);
      } else {
        if (useUsdBalanceMode && isUSDCurrency) {
          addUsdDelta(usdDeltaByAccount, accountId, side === "buy" ? -totalAmount : totalAmount);
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
        applyUsdDeltas(usdDeltaByAccount);
      }
      onLog?.("저장 완료: 거래가 저장되었습니다.", "success");
      setTradeForm((prev) => ({ ...createDefaultTradeForm(), side: "buy", accountId: prev.accountId || accountId || "" }));
    }, [
      tradeForm,
      trades,
      accounts,
      fxRate,
      tickerDatabase,
      isTradeFormValid,
      tradeFormValidation,
      shouldUseUsdBalanceMode,
      latestPriceByCanonicalTicker,
      onChangeTrades,
      onChangeAccounts,
      onChangeTickerDatabase,
      onLog
    ]);

    const handleTradeSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      submitTradeFromForm();
    };

    const startEditTrade = useCallback((t: StockTrade) => {
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
        quantity: String(Number(t.quantity.toFixed(10))),
        price: String(t.price),
        fee: String(t.fee),
        priceKRW: isUSD && rate > 0 ? String(Math.round(t.price * rate)) : "",
        feeKRW: isUSD && rate > 0 ? String(Math.round(t.fee * rate)) : ""
      });
    }, [fxRate, tickerDatabase]);

    const resetTradeForm = useCallback(() => {
      setTradeForm((prev) => ({
        ...createDefaultTradeForm(),
        side: prev.side,
        accountId: prev.accountId
      }));
    }, []);

    /** 보유 종목 빠른 매수/매도 — 폼 적재 + 시세 정보 설정 + 폼으로 스크롤 */
    const startQuickTrade = useCallback((p: PositionRow, side: TradeSide) => {
      // canonical 매칭 — 소문자/접미사 표기 차이로 시세를 못 찾는 일 방지
      const priceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(p.ticker));
      const currentPrice = priceInfo?.price ?? p.marketPrice;
      const db = tickerDatabase.find((x) => canonicalTickerForMatch(x.ticker) === canonicalTickerForMatch(p.ticker));
      setTradeForm({
        ...createDefaultTradeForm(),
        id: undefined,
        date: getTodayKST(),
        accountId: p.accountId,
        ticker: p.ticker,
        name: p.name,
        market: db?.market,
        exchange: db?.exchange,
        side,
        // 매도 시 부동소수점 잡음 제거: 여러 매수 합산·환율 곱셈에서 생긴 0.6982870000000005 같은 노이즈를
        // toFixed(10)로 깎고 Number→String round-trip 시키면 본래 표기로 복원됨 (사토시 1e-8 보다 2자리 여유).
        quantity: side === "sell" ? String(Number(p.quantity.toFixed(10))) : "",
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
    }, [latestPriceByCanonicalTicker, tickerDatabase]);

    /** 프리셋 적용 — 폼 필드만 갱신 (lastUsed 기록은 부모의 applyPreset이 담당) */
    const applyPreset = useCallback((preset: StockPreset) => {
      setTradeForm((prev) => ({
        ...prev,
        accountId: preset.accountId || prev.accountId,
        ticker: preset.ticker || prev.ticker,
        name: preset.stockName || prev.name,
        quantity: preset.quantity ? String(preset.quantity) : prev.quantity,
        fee: preset.fee ? String(preset.fee) : prev.fee || "0"
      }));
    }, []);

    useImperativeHandle(ref, () => ({
      submit: submitTradeFromForm,
      startEditTrade,
      resetForm: resetTradeForm,
      startQuickTrade,
      applyPreset,
      getFormSnapshot: () => tradeForm
    }), [submitTradeFromForm, startEditTrade, resetTradeForm, startQuickTrade, applyPreset, tradeForm]);

    const applyQuoteResult = (symbol: string, r: StockPrice, fallbackName?: string) => {
      // 0/NaN 시세는 prices에 저장하지 않음 — 기존 유효 가격을 0으로 덮으면 현재가 0원·-100%로 전파
      if (!(typeof r.price === "number" && Number.isFinite(r.price) && r.price > 0)) return;
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

          // ticker.json에 저장 (한국 종목은 한글명일 때만 — 영문명 고착 방지)
          const nameToSave = displayNameForTicker(symbol, r.name ?? existingName ?? undefined);
          if (nameToSave && (!isKRWStock(symbol) || /[가-힣]/.test(nameToSave))) {
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

    const isEditingTrade = Boolean(tradeForm.id);

    if (!visible) return null;

    return (
      <>
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
                    {a.name || a.id}
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
          <div className="quote-panel" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, minHeight: 120 }}>
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
      </>
    );
  }
));
