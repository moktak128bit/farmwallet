/**
 * 한국 종목 한글명 자동 해결 유틸.
 *
 * krNames.json(빌드 시 생성)과 Yahoo Finance API에 없는 특수 종목(ETN/워런트 등)을
 * Naver 금융에서 자동 조회. 결과는 메모리 오버레이에 캐시하여 다음 호출부터 즉시 반환.
 *
 * 제약:
 * - Naver HTML 스크래핑은 Vite dev 서버 프록시(/api/naver-name)를 통해서만 동작 (CORS).
 * - 프로덕션에선 네트워크 요청 생략 (항상 null 반환). 대신 tickerDatabase에 저장되면
 *   Gist sync로 다른 기기에도 전파됨.
 */

import { canonicalTickerForMatch, isKRWStock } from "../utils/finance";

const overlayMap: Record<string, string> = {};
const pendingFetch = new Map<string, Promise<string | null>>();
const failedTickers = new Set<string>();

function isDev(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
}

/** 런타임에 발견한 한글명을 오버레이에 추가 (krNames.json 위에 덮어씀) */
export function setKoreanNameOverlay(ticker: string, name: string): void {
  const key = canonicalTickerForMatch(ticker);
  if (!key || !name) return;
  overlayMap[key] = name;
}

/** 현재 오버레이 맵 스냅샷 (tickerDatabase 기반 초기 주입용) */
export function getKoreanNameOverlay(): Record<string, string> {
  return { ...overlayMap };
}

/**
 * Naver 금융에서 한국 종목 한글명 가져오기.
 * - DEV가 아니면 즉시 null (proxy 없음).
 * - 동일 ticker 동시 호출 시 하나의 Promise 공유.
 * - 실패 시 재시도하지 않도록 failedTickers에 기록.
 */
async function fetchKoreanNameFromNaver(ticker: string): Promise<string | null> {
  if (!isDev()) return null;
  const key = canonicalTickerForMatch(ticker);
  if (!key || !isKRWStock(key)) return null;
  if (overlayMap[key]) return overlayMap[key];
  if (failedTickers.has(key)) return null;
  const existing = pendingFetch.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/naver-name?ticker=${encodeURIComponent(key)}`);
      if (!res.ok) {
        failedTickers.add(key);
        return null;
      }
      const j = (await res.json()) as { name?: string | null };
      if (j.name && typeof j.name === "string") {
        overlayMap[key] = j.name;
        return j.name;
      }
      failedTickers.add(key);
      return null;
    } catch {
      failedTickers.add(key);
      return null;
    } finally {
      pendingFetch.delete(key);
    }
  })();
  pendingFetch.set(key, promise);
  return promise;
}

/**
 * AppData에서 한글명이 누락된 한국 종목을 찾아 Naver에서 일괄 조회.
 * 조회된 이름은 overlayMap에 저장되고 호출자는 반환값의 {ticker, name} 맵으로
 * tickerDatabase/trades/prices를 업데이트할 수 있다.
 *
 * @param tickersUsed 앱에서 실제 쓰이는 티커 Set (trades에서 추출)
 * @param existingKoreanNames 이미 한글명을 아는 티커 Set
 * @returns 새로 발견된 {ticker → name} 맵
 */
export async function resolveMissingKoreanNames(
  tickersUsed: Set<string>,
  existingKoreanNames: Set<string>
): Promise<Record<string, string>> {
  if (!isDev()) return {};
  const discovered: Record<string, string> = {};
  // 한국 코드 형식이면서 아직 한글명을 모르는 티커만
  const targets = [...tickersUsed].filter(
    (t) => isKRWStock(t) && !existingKoreanNames.has(canonicalTickerForMatch(t))
  );
  // 동시 호출 제한 (Naver에 과부하 주지 않도록 순차)
  for (const ticker of targets) {
    const name = await fetchKoreanNameFromNaver(ticker);
    if (name) discovered[canonicalTickerForMatch(ticker)] = name;
  }
  return discovered;
}
