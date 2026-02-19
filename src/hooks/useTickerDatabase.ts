import { useCallback, useEffect, useState } from "react";
import { loadTickerDatabaseFromBackup, saveTickerDatabaseBackup, saveData } from "../storage";
import { buildInitialTickerDatabase } from "../yahooFinanceApi";
import type { AppData, TickerInfo } from "../types";
import { toast } from "react-hot-toast";
import { STORAGE_KEYS } from "../constants/config";

export function useTickerDatabase(
  data: AppData,
  setDataWithHistory: (data: AppData | ((prev: AppData) => AppData)) => void
) {
  const [isLoadingTickerDatabase, setIsLoadingTickerDatabase] = useState(false);

  // 초기 티커 목록 로드 (localStorage와 백업에서만 로드, 자동 생성하지 않음)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (data.tickerDatabase && data.tickerDatabase.length > 0) return; // 이미 있으면 스킵
    
    let isMounted = true;
    const loadTickerDb = async () => {
      // 1) backups/ticker-latest.json 시도
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

  // 수동으로 초기 티커 목록 생성하는 함수
  const handleLoadInitialTickers = useCallback(async () => {
    setIsLoadingTickerDatabase(true);
    const toastId = toast.loading("티커 데이터베이스 생성 중...");
    try {
      const tickers = await buildInitialTickerDatabase();
      const updatedData = { ...data, tickerDatabase: tickers };
      setDataWithHistory(updatedData);
      saveData(updatedData); // 명시적으로 저장
      localStorage.setItem(STORAGE_KEYS.TICKER, JSON.stringify(tickers)); // 별도 백업 (호환성 유지)
      await saveTickerDatabaseBackup(tickers); // 서버 백업 파일 저장
      toast.success(`티커 데이터베이스 생성 완료 (${tickers.length}개)`, { id: toastId });
    } catch (err) {
      console.error("초기 티커 목록 생성 실패:", err);
      toast.error("티커 데이터베이스 생성 실패", { id: toastId });
    } finally {
      setIsLoadingTickerDatabase(false);
    }
  }, [setDataWithHistory, data]);

  return {
    isLoadingTickerDatabase,
    handleLoadInitialTickers
  };
}
