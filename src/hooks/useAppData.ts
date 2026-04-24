import { useEffect, useState, useCallback, useRef } from "react";
import { loadData, preloadKrNames, applyKoreanStockNames, saveData, normalizeImportedData } from "../storage";
import { useAppStore } from "../store/appStore";
import { loadCacheFromDB, mergeCacheIntoAppData } from "../services/cacheStore";
import {
  resolveMissingKoreanNames,
  setKoreanNameOverlay,
} from "../services/krNameResolver";
import { canonicalTickerForMatch, isKRWStock } from "../utils/finance";
import { subscribeDataChanges } from "../services/tabSync";
import { useUIStore } from "../store/uiStore";

export function useAppData() {
  const data = useAppStore((s) => s.data);
  const setData = useAppStore((s) => s.setData);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // 한글명 적용이 안전한 시점인지 판별하는 두 플래그.
  // 둘 다 true 된 뒤에야 applyKoreanStockNames를 실행해서 캐시 하이드레이션으로 들어온
  // 영문명을 덮어쓸 수 있음 (레이스 방지).
  const [krNamesReady, setKrNamesReady] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);

  // 초기 데이터 로드 (한 번만) → Zustand store에 반영
  // setTimeout(0): 로딩 화면이 먼저 페인트된 뒤 무거운 JSON 파싱·마이그레이션 실행
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const loaded = loadData();
        useAppStore.setState({ data: loaded });
        setLoadFailed(false);
      } catch (e) {
        console.error("[FarmWallet] 초기 데이터 로드 실패", e);
        setLoadFailed(true);
      }
      setIsLoading(false);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // "처음 방문"일 때만(localStorage 앱 키가 아예 없고 ledger도 비어있음) 최신 백업에서 복원.
  // 사용자가 의도적으로 데이터를 지운 경우(localStorage에 빈 AppData를 저장)는 복원하지 않음.
  const dataRecoveryDone = useRef(false);
  useEffect(() => {
    if (isLoading || dataRecoveryDone.current) return;
    dataRecoveryDone.current = true;
    const currentData = useAppStore.getState().data;
    if (currentData?.ledger && currentData.ledger.length > 0) return;
    if (typeof window !== "undefined") {
      const STORAGE_KEY = "farmwallet-data-v1";
      // 사용자가 한 번이라도 저장한 흔적이 있으면 자동 복원 안 함 (의도적 wipe 존중)
      if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
    }
    // 자동 복원은 "최초 방문" 한정이라 사용자 UI를 방해하지 않지만,
    // 콘솔 로그는 남겨 디버깅·감사 가능하도록.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/restore-latest-backup", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`백업 API 응답 오류 (${r.status})`);
        return r.json();
      })
      .then((backup: unknown) => {
        if (!backup || typeof backup !== "object") return;
        const asRecord = backup as Record<string, unknown>;
        const ledger = asRecord.ledger;
        if (!Array.isArray(ledger) || ledger.length === 0) return;
        try {
          // 백업 JSON은 외부 소스 — normalizeImportedData로 구조 검증·정규화 후 저장
          const normalized = normalizeImportedData(backup);
          saveData(normalized);
          const reloaded = loadData();
          useAppStore.setState({ data: reloaded });
          setLoadFailed(false);
          console.info("[FarmWallet] 백업 자동 복원 성공");
        } catch (e) {
          console.error("[FarmWallet] 백업 복원 파싱/검증 실패", e);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          console.warn("[FarmWallet] 백업 복원 시간 초과 (10s)");
        } else {
          // dev 서버 미기동 등 정상 케이스 포함이라 warn 수준만
          console.warn("[FarmWallet] 백업 복원 건너뜀:", err instanceof Error ? err.message : err);
        }
      })
      .finally(() => clearTimeout(timeoutId));
  }, [isLoading]);

  // 초기 로드 후 IndexedDB에서 캐시 하이드레이션.
  // localStorage 캐시가 비어 있어도 IndexedDB에 저장된 prices/tickerDatabase/
  // historicalDailyCloses를 병합해 API 재수집 없이 즉시 사용 가능.
  const cacheHydrationStarted = useRef(false);
  useEffect(() => {
    if (isLoading || loadFailed || cacheHydrationStarted.current) return;
    cacheHydrationStarted.current = true;
    (async () => {
      try {
        const cache = await loadCacheFromDB();
        const current = useAppStore.getState().data;
        if (!current) return;
        if (
          cache.prices.length > 0 ||
          cache.tickerDatabase.length > 0 ||
          cache.historicalDailyCloses.length > 0
        ) {
          useAppStore.setState({ data: mergeCacheIntoAppData(current, cache) });
        }
      } finally {
        // 성공/실패와 무관하게 "하이드레이션 단계 종료"를 알림 (IDB 미지원·빈 캐시도 여기 도달)
        setCacheHydrated(true);
      }
    })().catch((err: unknown) => {
      // async catch가 console에만 남으면 사용자가 모르므로 appLog에도 기록.
      // ErrorBoundary는 effect throw를 못 잡으므로 명시적 surface가 유일 수단.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[FarmWallet] cache hydration failed", err);
      try { useUIStore.getState().addAppLog(`캐시 로드 실패: ${msg}`, "error"); } catch { /* */ }
      setCacheHydrated(true);
    });
  }, [isLoading, loadFailed]);

  // krNames.json 로드 — 완료 시 플래그만 세팅. 실제 적용은 아래 effect.
  const krNamesLoadStarted = useRef(false);
  useEffect(() => {
    if (isLoading || loadFailed || krNamesLoadStarted.current) return;
    krNamesLoadStarted.current = true;
    preloadKrNames()
      .then(() => setKrNamesReady(true))
      .catch(() => setKrNamesReady(true)); // 실패해도 진행은 허용 (한글명 없이 동작)
  }, [isLoading, loadFailed]);

  // 한글 종목명 적용 — krNames와 캐시 하이드레이션 모두 완료된 뒤에만.
  // data.prices/tickerDatabase/trades가 변경될 때마다 재적용 (새 시세 fetch 후에도 교체되도록).
  // applyKoreanStockNames는 idempotent이고 changed=false면 아무것도 하지 않아 안전.
  useEffect(() => {
    if (!krNamesReady || !cacheHydrated) return;
    const current = useAppStore.getState().data;
    if (!current) return;
    // tickerDatabase에 Gist sync로 전파된 한글명을 런타임 오버레이에 주입 (이전 기기에서 발견한 것)
    if (Array.isArray(current.tickerDatabase)) {
      for (const t of current.tickerDatabase) {
        if (t?.ticker && t?.name && /[가-힣]/.test(t.name)) {
          setKoreanNameOverlay(t.ticker, t.name);
        }
      }
    }
    const { data: updated, changed } = applyKoreanStockNames(current);
    if (changed) {
      useAppStore.setState({ data: updated });
      try { saveData(updated); } catch { /* quota 등 무시 */ }
    }
  }, [krNamesReady, cacheHydrated, data.prices, data.tickerDatabase, data.trades]);

  // 한글명이 누락된 한국 종목은 Naver 금융에서 자동 조회 (DEV 전용).
  // 조회된 이름은 tickerDatabase에 저장되어 Gist sync로 다른 기기에도 전파.
  // applyKoreanStockNames가 최소 한 번 실행된 뒤(= 기존 한글명 반영 후) 실행해야
  // 불필요한 네트워크 호출을 줄일 수 있음.
  const naverLookupDone = useRef(false);
  useEffect(() => {
    if (!krNamesReady || !cacheHydrated || naverLookupDone.current) return;
    const current = useAppStore.getState().data;
    if (!current) return;
    // 앱에서 실제 사용 중인 한국 티커만 대상
    const tickersUsed = new Set<string>();
    for (const t of current.trades ?? []) {
      if (t?.ticker && isKRWStock(t.ticker)) {
        tickersUsed.add(canonicalTickerForMatch(t.ticker));
      }
    }
    if (tickersUsed.size === 0) {
      naverLookupDone.current = true;
      return;
    }
    // 이미 한글명 있는 티커는 제외
    const haveKorean = new Set<string>();
    const db = Array.isArray(current.tickerDatabase) ? current.tickerDatabase : [];
    for (const t of db) {
      if (t?.ticker && t?.name && /[가-힣]/.test(t.name)) {
        haveKorean.add(canonicalTickerForMatch(t.ticker));
      }
    }
    // trades에 한글명 있는 것도 포함
    for (const t of current.trades ?? []) {
      if (t?.ticker && t?.name && /[가-힣]/.test(t.name)) {
        haveKorean.add(canonicalTickerForMatch(t.ticker));
      }
    }
    naverLookupDone.current = true;
    // 비동기 조회 진행 중에 Gist pull 등으로 store data가 통째로 교체되면
    // 우리가 가지고 시작한 tickerDatabase가 stale이 됨. 시작 시점의 식별자를 기억해뒀다가
    // 응답 적용 시 같은 인스턴스인지 확인해 stale write를 방지한다.
    const dbAtStart = useAppStore.getState().data?.tickerDatabase;
    (async () => {
      const discovered = await resolveMissingKoreanNames(tickersUsed, haveKorean);
      const keys = Object.keys(discovered);
      if (keys.length === 0) return;
      // tickerDatabase upsert
      const latest = useAppStore.getState().data;
      if (!latest) return;
      // store가 그 사이에 갈아끼워졌으면 (Gist pull, 사용자 import 등) stale write 폐기.
      // overlay에는 그래도 주입해 다음 사이클에서 활용 가능.
      if (latest.tickerDatabase !== dbAtStart) {
        for (const [ticker, name] of Object.entries(discovered)) {
          setKoreanNameOverlay(ticker, name);
        }
        console.info(`[FarmWallet] Naver 결과 도착 시점에 tickerDatabase가 변경되어 store write 폐기 (overlay만 주입)`);
        return;
      }
      const existingDb = Array.isArray(latest.tickerDatabase) ? latest.tickerDatabase : [];
      const byTicker = new Map(existingDb.map((t) => [canonicalTickerForMatch(t.ticker), t]));
      for (const [ticker, name] of Object.entries(discovered)) {
        const prev = byTicker.get(ticker);
        if (prev) {
          byTicker.set(ticker, { ...prev, name });
        } else {
          byTicker.set(ticker, { ticker, name, market: "KR" });
        }
      }
      const nextDb = [...byTicker.values()];
      // overlay에도 주입해 applyKoreanStockNames가 곧바로 활용
      for (const [ticker, name] of Object.entries(discovered)) {
        setKoreanNameOverlay(ticker, name);
      }
      // tickerDatabase 업데이트 → 다음 effect 사이클에서 applyKoreanStockNames 재실행
      useAppStore.setState({
        data: { ...latest, tickerDatabase: nextDb },
      });
      console.info(`[FarmWallet] Naver에서 ${keys.length}개 한국 종목 한글명 자동 조회`);
    })().catch(() => { /* 실패 시 무시 */ });
  }, [krNamesReady, cacheHydrated, data.trades]);

  // 다른 탭에서 데이터 변경 시 현재 탭 store에 반영. 같은 탭 자신의 변경은 originId로 필터링됨.
  useEffect(() => {
    if (isLoading || loadFailed) return;
    const unsubscribe = subscribeDataChanges((payload) => {
      try {
        const parsedUnknown = JSON.parse(payload) as unknown;
        if (!parsedUnknown || typeof parsedUnknown !== "object") return;
        // loadData()를 통과시켜 schema migration·normalization 동일 경로 사용
        const reloaded = loadData();
        useAppStore.setState({ data: reloaded });
      } catch (err) {
        console.warn("[FarmWallet] tab-sync apply failed", err);
      }
    });
    return unsubscribe;
  }, [isLoading, loadFailed]);

  /** 로드 실패 후 백업 복원했을 때 저장 허용용 */
  const clearLoadFailed = useCallback(() => {
    setLoadFailed(false);
  }, []);

  return {
    data,
    setData,
    isLoading,
    loadFailed,
    clearLoadFailed
  };
}
