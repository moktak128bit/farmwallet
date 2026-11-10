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

/** 서버 함수 호출 — google.script.run을 Promise로. 실패 메시지는 서버 Error.message 그대로. */
export function runServer<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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
}

/**
 * 시작할 때 쓸 시트 장부 — index.html이 앱 코드를 읽기 전에 미리 보낸 loadData가 있으면 그 결과를 쓰고
 * (서버 왕복이 수 MB 코드 로딩과 겹친다), 없거나 실패했으면 지금 요청한다. 미리 받은 결과는 한 번만 쓴다 —
 * 이후 다시 부르면 항상 새로 요청(오래된 결과를 두 번 채택하지 않게).
 */
export function loadSheetForBoot(): Promise<GasLoadResult> {
  const pre = typeof window !== "undefined" ? window.__fwSheetPrefetch : undefined;
  if (!pre) return runServer<GasLoadResult>("loadData");
  window.__fwSheetPrefetch = undefined;
  return pre.then(
    (value) => value as GasLoadResult,
    () => runServer<GasLoadResult>("loadData")
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
