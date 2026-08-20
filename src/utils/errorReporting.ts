/**
 * 오류 리포팅 단일 진입점.
 * 전역 window error/unhandledrejection · ErrorBoundary componentDidCatch · 기타 catch 블록에서
 * reportError(scope, err)를 호출하면 영속 활동 로그(uiStore.addAppLog, 'error')에 남고 console.error로도 출력된다.
 * → 설정 탭 "앱 로그 내보내기"(JSON)에 그대로 포함돼 이슈 보고 시 첨부 가능.
 *
 * 안전장치: 동일 (scope+message)가 DEDUP_WINDOW_MS 안에 반복되면 무시 — 렌더 에러 루프·리스너 중복 발화로
 * 로그가 500건 한도를 순식간에 덮어쓰는 일을 막는다.
 */
import { APP_VERSION } from "../constants/config";
import { useUIStore } from "../store/uiStore";

/** 메시지·스택 각각 이 길이까지만 보관 (localStorage 영속 로그 용량 보호) */
const MAX_FIELD_LEN = 300;
const DEDUP_WINDOW_MS = 5000;

interface ErrorRecord {
  scope: string;
  message: string;
  /** 스택 앞 MAX_FIELD_LEN자 (없으면 빈 문자열) */
  stack: string;
  version: string;
  /** ISO 8601 시각 */
  at: string;
  extra?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

function errorToStack(err: unknown): string {
  if (err instanceof Error && typeof err.stack === "string") {
    // 첫 줄은 보통 "Name: message" 중복 → 프레임 부분만
    const lines = err.stack.split("\n");
    const frames = lines[0]?.includes(err.message) ? lines.slice(1) : lines;
    return frames.map((l) => l.trim()).join("\n");
  }
  return "";
}

function extraToString(extra: unknown): string | undefined {
  if (extra === undefined || extra === null) return undefined;
  if (typeof extra === "string") return extra;
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

/**
 * 순수 함수 — 오류를 영속 로그에 넣을 레코드로 정규화.
 * @param now 테스트 주입용 (기본: 현재 시각)
 */
export function formatErrorRecord(
  scope: string,
  err: unknown,
  extra?: unknown,
  now: Date = new Date(),
  version: string = APP_VERSION
): ErrorRecord {
  const extraStr = extraToString(extra);
  return {
    scope: scope || "unknown",
    message: truncate(errorToMessage(err), MAX_FIELD_LEN),
    stack: truncate(errorToStack(err), MAX_FIELD_LEN),
    version,
    at: now.toISOString(),
    ...(extraStr !== undefined ? { extra: truncate(extraStr, MAX_FIELD_LEN) } : {})
  };
}

/** 활동 로그 한 줄 메시지 (사람이 읽는 용도 + JSON 내보내기에 그대로 실림) */
export function formatErrorLogLine(rec: ErrorRecord): string {
  const parts = [`[오류:${rec.scope}] ${rec.message}`, `v${rec.version}`, rec.at];
  if (rec.extra) parts.push(`extra: ${rec.extra}`);
  if (rec.stack) parts.push(`stack: ${rec.stack}`);
  return parts.join(" | ");
}

/** 최근 리포트 시각 — key = `${scope}\n${message}` */
const recentReports = new Map<string, number>();

/** 동일 (scope+message)가 window 안에 다시 오면 true(=건너뜀). 순수 아님(내부 상태) — 테스트는 nowMs 주입. */
export function shouldSkipDuplicate(scope: string, message: string, nowMs: number = Date.now()): boolean {
  const key = `${scope}\n${message}`;
  const last = recentReports.get(key);
  if (last !== undefined && nowMs - last < DEDUP_WINDOW_MS) return true;
  recentReports.set(key, nowMs);
  // 맵이 무한히 자라지 않도록 오래된 키 정리
  if (recentReports.size > 200) {
    for (const [k, t] of recentReports) {
      if (nowMs - t >= DEDUP_WINDOW_MS) recentReports.delete(k);
    }
  }
  return false;
}

/**
 * 오류 리포트 — 영속 활동 로그('error') + console.error.
 * 어떤 상황에서도 throw하지 않는다(오류 처리 경로에서 2차 오류 방지).
 */
export function reportError(scope: string, err: unknown, extra?: unknown): void {
  try {
    const rec = formatErrorRecord(scope, err, extra);
    if (shouldSkipDuplicate(rec.scope, rec.message)) return;
    console.error(`[${rec.scope}]`, err, extra ?? "");
    useUIStore.getState().addAppLog(formatErrorLogLine(rec), "error");
  } catch {
    /* 리포팅 실패는 삼킨다 */
  }
}

const GLOBAL_FLAG = "__fwGlobalErrorListenersInstalled";

/**
 * window 'error' / 'unhandledrejection' 리스너 설치 (main.tsx에서 1회).
 * window 플래그로 중복 설치를 막는다 (HMR·모듈 재평가 대비).
 */
export function installGlobalErrorListeners(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[GLOBAL_FLAG]) return;
  w[GLOBAL_FLAG] = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // 리소스 로드 실패 등은 error 객체 없이 message만 옴
    const err = event.error ?? event.message ?? "Unknown window error";
    const loc = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    reportError("window.error", err, loc);
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportError("unhandledrejection", event.reason ?? "Unhandled promise rejection");
  });
}
