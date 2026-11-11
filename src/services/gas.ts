import { STORAGE_KEYS } from "../constants/config";

/**
 * Google Apps Script 웹앱 연결 — GAS(HtmlService) iframe 안에서 열렸을 때만 동작한다.
 *
 * 운영 방식(2026-11-08~): 원본 = Drive "FarmWallet 데이터" 시트, 서버 = gas/Code.js.
 * 기존 Gist 동기화 경로(services/gistSync.ts)가 isGas()로 갈라져 같은 UI·충돌 감지를 그대로 쓰고
 * 통신만 google.script.run으로 바뀐다. 일반 브라우저(dev 서버·PWA)에서는 전부 기존 동작.
 */

interface GasRunner {
  withSuccessHandler(fn: (value: unknown) => void): GasRunner;
  withFailureHandler(fn: (error: unknown) => void): GasRunner;
  [fn: string]: unknown;
}

declare global {
  interface Window {
    google?: { script?: { run?: GasRunner } };
    /** index.html이 앱 코드보다 먼저 시작한 loadData 요청 (loadSheetForBoot가 한 번만 소비) */
    __fwSheetPrefetch?: Promise<unknown>;
  }
}

/** GAS 웹앱 안에서 실행 중인가 (google.script.run 존재) */
export function isGas(): boolean {
  return typeof window !== "undefined" && !!window.google?.script?.run;
}

/**
 * 서버 함수별 응답 대기 한도(ms). google.script.run은 성공·실패 콜백이 영영 안 오는 경우가 있다
 * (휴대폰 잠금·네트워크 전환·로그인 세션 만료·서버 6분 실행 한도 초과). 한도가 없으면 그 호출을 기다리는
 * '저장 중'·'불러오는 중'이 영원히 남고, 재진입 가드(저장·원격 확인·시세 갱신·사진 업로드)가 풀리지 않아
 * 이후 저장이 전부 막힌다. 한도가 지나면 실패로 처리하고, 늦게 온 응답은 버린다.
 */
const SERVER_TIMEOUT_MS: Record<string, number> = {
  loadData: 90_000,
  loadVersion: 90_000,
  saveData: 120_000,
  uploadPhoto: 180_000,
  proxyFetch: 20_000,
};
const DEFAULT_SERVER_TIMEOUT_MS = 45_000;

export function serverTimeoutMs(fn: string): number {
  return SERVER_TIMEOUT_MS[fn] ?? DEFAULT_SERVER_TIMEOUT_MS;
}

/** 응답 대기 한도 초과 — 서버가 실제로는 처리했을 수도 있다(저장은 다음 확인에서 내용 비교로 판정) */
export class ServerTimeoutError extends Error {
  constructor(fn: string, ms: number) {
    super(`서버 응답 없음 (${fn}, ${Math.round(ms / 1000)}초) — 네트워크 연결을 확인하고 다시 시도하세요`);
    this.name = "ServerTimeoutError";
  }
}

/** promise에 한도를 씌운다 — 한도가 지나면 ServerTimeoutError로 거절, 늦게 끝난 결과는 무시 */
function withServerTimeout<T>(promise: Promise<T>, fn: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ServerTimeoutError(fn, ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** 서버 함수 호출 — google.script.run을 Promise로. 실패 메시지는 서버 Error.message 그대로. 응답 한도는 serverTimeoutMs. */
export function runServer<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const call = new Promise<T>((resolve, reject) => {
    const run = typeof window !== "undefined" ? window.google?.script?.run : undefined;
    if (!run) {
      reject(new Error("GAS 서버에 연결할 수 없습니다."));
      return;
    }
    const runner = run
      .withSuccessHandler((value) => resolve(value as T))
      .withFailureHandler((error) => {
        const message =
          error instanceof Error
            ? error.message
            : String((error as { message?: unknown } | null)?.message ?? error);
        reject(new Error(message));
      });
    const target = runner[fn];
    if (typeof target !== "function") {
      reject(new Error(`서버 함수가 없습니다: ${fn}`));
      return;
    }
    (target as (...a: unknown[]) => void).apply(runner, args);
  });
  return withServerTimeout(call, fn, serverTimeoutMs(fn));
}

/**
 * 시작할 때 쓸 시트 장부 — index.html이 앱 코드를 읽기 전에 미리 보낸 loadData가 있으면 그 결과를 쓰고
 * (서버 왕복이 수 MB 코드 로딩과 겹친다), 없거나 실패했으면 지금 요청한다. 미리 받은 결과는 한 번만 쓴다 —
 * 이후 다시 부르면 항상 새로 요청(오래된 결과를 두 번 채택하지 않게).
 * 미리 보낸 요청에도 같은 한도를 씌운다 — 응답이 끝내 안 오면 다시 요청하지 않고 실패로 넘긴다
 * (같은 원인이면 또 기다리기만 한다. 부팅은 기기 사본으로 열고 백그라운드에서 다시 확인한다).
 */
export function loadSheetForBoot(): Promise<GasLoadResult> {
  const pre = typeof window !== "undefined" ? window.__fwSheetPrefetch : undefined;
  if (!pre) return runServer<GasLoadResult>("loadData");
  window.__fwSheetPrefetch = undefined;
  return withServerTimeout(pre, "loadData", serverTimeoutMs("loadData")).then(
    (value) => value as GasLoadResult,
    (err) => (err instanceof ServerTimeoutError ? Promise.reject(err) : runServer<GasLoadResult>("loadData"))
  );
}

/** 사용자에게 보이는 문구의 "Gist"를 GAS에서는 "시트"로 — 동기화 UI·로그·토스트 공용 */
export function remoteText(text: string): string {
  return isGas() ? text.replace(/Gist/g, "시트") : text;
}

/** 서버 meta.device 표기용 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "";
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "휴대폰" : "PC";
}

/** 서버 사진 상태 값 — 처리 완료 외에는 모두 "처리 전"으로 본다 (설정 사진 카드·대시보드 확인할 일 공용) */
export const PHOTO_PROCESSED = "처리 완료";

/** 서버 listPhotos() 행 */
export interface GasPhoto {
  id: string;
  name: string;
  uploadedAt: string;
  status: string;
}

/** 서버 loadData() 응답 */
export interface GasLoadResult {
  dataJson: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

/**
 * 시트 원본 정보 — 설정 저장 위치 카드가 "시트 최종 저장(rev N)"과 "이 기기에서 불러온 시각"을 따로 보여 준다
 * (예전엔 둘 다 시트 updatedAt이라 같은 값이 찍혔다). 불러오기·저장 성공 때마다 갱신.
 */
interface GasSheetInfo {
  revision: number | null;
  /** 시트 meta.updatedAt — 어느 기기든 마지막으로 시트에 저장한 시각 */
  updatedAt: string | null;
  /** 이 기기가 시트 장부를 마지막으로 받아 온 시각 */
  loadedAt: string | null;
  /** 이 기기가 마지막으로 시트와 맞춘(받기·저장) 장부의 내용 해시(timeSeriesMerge.canonicalUserPayload 기준).
   *  부팅 채택이 "편집이 있었나 / 시트가 바뀌었나"를 재직렬화·시계열 적립에 흔들리지 않고 판정하는 기준. */
  contentHash: string | null;
}

export function getGasSheetInfo(): GasSheetInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAS_SHEET_INFO);
    const v = raw ? (JSON.parse(raw) as Partial<GasSheetInfo>) : {};
    return {
      revision: typeof v.revision === "number" ? v.revision : null,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
      loadedAt: typeof v.loadedAt === "string" ? v.loadedAt : null,
      contentHash: typeof v.contentHash === "string" ? v.contentHash : null,
    };
  } catch {
    return { revision: null, updatedAt: null, loadedAt: null, contentHash: null };
  }
}

/** kind=load: 시트를 받아 옴(불러온 시각 갱신) · kind=save: 이 기기가 시트에 저장함 */
export function recordGasSheetInfo(
  kind: "load" | "save",
  meta: { revision?: number; updatedAt?: string },
  contentHash?: string | null
): void {
  const prev = getGasSheetInfo();
  const next: GasSheetInfo = {
    revision: typeof meta.revision === "number" && meta.revision > 0 ? meta.revision : prev.revision,
    updatedAt: meta.updatedAt || prev.updatedAt,
    loadedAt: kind === "load" ? new Date().toISOString() : prev.loadedAt,
    contentHash: contentHash !== undefined ? contentHash : prev.contentHash,
  };
  try { localStorage.setItem(STORAGE_KEYS.GAS_SHEET_INFO, JSON.stringify(next)); } catch { /* 저장소 가득 등 — 표시용이라 무시 */ }
}
