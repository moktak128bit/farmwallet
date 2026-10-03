/**
 * 기기 연결 링크 — PC의 토큰·Gist ID를 URL fragment(#fw-connect=<base64url JSON>)로 실어
 * 폰이 QR로 한 번에 받게 한다. fragment는 서버로 전송되지 않는다.
 * ⚠ 토큰을 로그·토스트·console에 절대 출력하지 말 것.
 */

import type { AppData } from "../types";
import { PUBLIC_APP_URL } from "../constants/config";

export interface ConnectPayload {
  gistId: string;
  token: string;
}

const FRAGMENT_KEY = "fw-connect";
const GIST_ID_RE = /^[0-9a-f]{20,}$/i;
const TOKEN_RE = /^\S+$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function buildConnectUrl(payload: ConnectPayload): string {
  const json = JSON.stringify({ v: 1, g: payload.gistId, t: payload.token });
  return `${PUBLIC_APP_URL}#${FRAGMENT_KEY}=${toBase64Url(json)}`;
}

/** 링크 전체·fragment·값만 붙여넣은 문자열을 모두 허용. 실패는 전부 null (throw 금지). */
export function decodeConnectPayload(text: string): ConnectPayload | null {
  try {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return null;
    const marker = `${FRAGMENT_KEY}=`;
    const idx = trimmed.indexOf(marker);
    const rest = idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
    const value = rest.split(/[&\s]/)[0];
    if (!value) return null;
    const parsed = JSON.parse(fromBase64Url(value)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { v, g, t } = parsed as { v?: unknown; g?: unknown; t?: unknown };
    if (v !== 1) return null;
    if (typeof g !== "string" || !GIST_ID_RE.test(g)) return null;
    if (typeof t !== "string" || !TOKEN_RE.test(t)) return null;
    return { gistId: g, token: t };
  } catch {
    return null;
  }
}

export type TakeConnectResult =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "ok"; payload: ConnectPayload };

/** 현재 주소의 fw-connect fragment를 읽고 즉시 주소창에서 제거한다 (토큰이 히스토리·공유에 남지 않게). */
export function takeConnectPayloadFromLocation(): TakeConnectResult {
  if (typeof window === "undefined") return { status: "none" };
  const hash = window.location.hash;
  if (!hash.includes(`${FRAGMENT_KEY}=`)) return { status: "none" };
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  const payload = decodeConnectPayload(hash);
  return payload ? { status: "ok", payload } : { status: "invalid" };
}

/** 사용자가 직접 입력하는 컬렉션 — 기본값(분류·루틴)·자동 적립 시계열·시세 캐시는 새 기기에도 있어 제외 */
const USER_COLLECTION_KEYS = [
  "ledger", "accounts", "trades", "loans", "recurringExpenses", "budgetGoals", "savingsGoals",
  "workoutWeeks", "customExercises", "ledgerTemplates", "stockPresets", "targetPortfolios",
] as const;

/** 로컬에 사용자 데이터가 전혀 없는(새 기기) 상태인지 — 운동·대출·예산·목표만 있어도 빈 기기가 아니다 */
export function isEmptyLocalData(data: Partial<Pick<AppData, (typeof USER_COLLECTION_KEYS)[number]>>): boolean {
  return USER_COLLECTION_KEYS.every((key) => !data[key]?.length);
}

/** 연결 확인 화면용 요약 — Gist ID는 끝 6자리만 노출 */
export function describeConnectTarget(
  currentGistId: string,
  nextGistId: string
): { shortId: string; currentShortId: string | null; replacesOther: boolean } {
  return {
    shortId: nextGistId.slice(-6),
    currentShortId: currentGistId ? currentGistId.slice(-6) : null,
    replacesOther: !!currentGistId && currentGistId !== nextGistId
  };
}
