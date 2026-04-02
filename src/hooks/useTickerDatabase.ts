import { useCallback, useEffect, useState } from "react";
import { loadTickerDatabaseFromBackup, saveTickerDatabaseBackup } from "../storage";
import { buildInitialTickerDatabase } from "../yahooFinanceApi";
import type { AppData, TickerInfo } from "../types";
import { toast } from "react-hot-toast";
import { STORAGE_KEYS } from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { canonicalTickerForMatch } from "../utils/finance";

type UseTickerDatabaseOptions = { onLog?: (message: string, type?: "success" | "error") => void };

export function useTickerDatabase(
  data: AppData,
  setDataWithHistory: (data: AppData | ((prev: AppData) => AppData)) => void,
  options?: UseTickerDatabaseOptions
) {
  const onLog = options?.onLog;
  const [isLoadingTickerDatabase, setIsLoadingTickerDatabase] = useState(false);

  // 초기 티커 목록 로드 (개발 서버 백업 API → localStorage만, 자동 생성하지 않음)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (data.tickerDatabase && data.tickerDatabase.length > 0) return; // 이미 있으면 스킵
    
    let isMounted = true;
    const loadTickerDb = async () => {
      // 1) 개발 서버: GET /api/ticker-backup → data/ticker-backup.json (Vite 미들웨어)
      try {
        const backupTickers = await loadTickerDatabaseFromBackup();
        if (isMounted && backupTickers && backupTickers.length > 0) {
          setDataWithHistory((prev) => ({ ...prev, tickerDatabase: backupTickers }));
          localStorage.setItem(STORAGE_KEYS.TICKER, JSON.stringify(backupTickers));
          return;
        }
      } catch (err) {
        console.warn("티커 백업 파일 로드 실패:", err);
      }

      // 2) localStorage 확인
      const stored = localStorage.getItem(STORAGE_KEYS.TICKER);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (isMounted) setDataWithHistory((prev) => ({ ...prev, tickerDatabase: parsed }));
            return;
          }
        } catch (err) {
          console.error("저장된 티커 목록 파싱 실패:", err);
        }
      }
      // 3) 없으면 빈 배열로 두고 사용자가 수동으로 "종목 불러오기" 버튼을 눌러야 함
    };

    void loadTickerDb();
    return () => {
      isMounted = false;
    };
  }, [data.tickerDatabase, setDataWithHistory]);

  // 수동으로 초기 티커 목록 생성 (ticker.json 기준). 기존 CRYPTO·시장 선택(market/exchange)은 유지
  const handleLoadInitialTickers = useCallback(async () => {
    setIsLoadingTickerDatabase(true);
    const toastId = toast.loading("티커 데이터베이스 생성 중...");
    try {
      const fromFile = await buildInitialTickerDatabase();
      const existing = Array.isArray(data.tickerDatabase) ? data.tickerDatabase : [];
      const existingByKey = new Map(existing.map((t) => [canonicalTickerForMatch(t.ticker), t]));

      const fromFileKeys = new Set(fromFile.map((t) => canonicalTickerForMatch(t.ticker)));
      const merged: TickerInfo[] = fromFile.map((t) => {
        const key = canonicalTickerForMatch(t.ticker);
        const prev = existingByKey.get(key);
        if (prev) return { ...t, market: prev.market, exchange: prev.exchange };
        return { ...t, market: t.market as "KR" | "US" | "CRYPTO", exchange: t.exchange };
      });

      const extra = existing.filter(
        (t) => t.market === "CRYPTO" || !fromFileKeys.has(canonicalTickerForMatch(t.ticker))
      );
      const tickers = [...merged, ...extra].sort((a, b) => a.ticker.localeCompare(b.ticker));

      setDataWithHistory((prev) => ({ ...prev, tickerDatabase: tickers }));
      localStorage.setItem(STORAGE_KEYS.TICKER, JSON.stringify(tickers));
      await saveTickerDatabaseBackup(tickers);
      const msg = `종목 불러오기 완료: ${tickers.length}개 종목 목록 반영됨.`;
      toast.success(msg, { id: toastId, duration: 4000 });
      onLog?.(msg, "success");
    } catch (err) {
      console.error("초기 티커 목록 생성 실패:", err);
      toast.error(ERROR_MESSAGES.TICKER_DB_CREATE_FAILED, { id: toastId });
      onLog?.(ERROR_MESSAGES.TICKER_DB_CREATE_FAILED, "error");
    } finally {
      setIsLoadingTickerDatabase(false);
    }
  }, [setDataWithHistory, data, onLog]);

  return {
    isLoadingTickerDatabase,
    handleLoadInitialTickers
  };
}
