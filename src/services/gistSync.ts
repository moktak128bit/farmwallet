/**
 * GitHub Gist 기반 데이터 동기화
 * - Private Gist에 앱 데이터를 JSON으로 저장/불러오기
 * - GitHub Personal Access Token(gist scope) 필요
 *
 * 토큰 저장 정책:
 * - 기본은 sessionStorage (탭이 닫히면 사라짐 → XSS 시 노출창 축소)
 * - 사용자가 "이 기기에서 기억" 옵션을 켜야만 localStorage 영속화
 * - 기존 사용자(localStorage에만 있는 경우) 호환을 위해 read 시 fallback
 */

import { GIST_PUSH_RETRY, STORAGE_KEYS } from "../constants/config";

const GIST_TOKEN_KEY = "fw-gist-token";
const GIST_TOKEN_PERSIST_KEY = "fw-gist-token-persist";
const GIST_ID_KEY = "fw-gist-id";
const GIST_FILE_NAME = "farmwallet-data.json";
const API_BASE = "https://api.github.com";

/** GitHub API 호출 타임아웃 (ms) */
const FETCH_TIMEOUT_MS = 15000;

/** Gist 설정 변경 이벤트 — App 헤더 등에서 구독하여 반응형으로 UI 갱신 */
export const GIST_CONFIG_CHANGE_EVENT = "farmwallet:gist-config-change";

function emitConfigChange() {
  window.dispatchEvent(new CustomEvent(GIST_CONFIG_CHANGE_EVENT));
}

/**
 * AbortController + setTimeout 으로 fetch 타임아웃 구현.
 * 응답 본문 일부(최대 500자)를 텍스트로 같이 반환해 에러 메시지에 활용.
 *
 * cache: "no-store" 기본 적용 — GitHub API는 `Cache-Control: private, max-age=60`을 주기 때문에,
 * 모바일/데스크탑이 60초 안에 같은 엔드포인트(예: /gists/{id})를 두 번 부르면 브라우저가 stale 응답을 그대로 반환해
 * "불러오기를 눌러도 최신이 안 오는" 증상이 생긴다. 동기화는 빈도 낮고 항상 최신이 필요한 작업이라 캐시 비활성화가 옳다.
 * 호출자가 명시적으로 다른 cache 모드를 주면 그게 우선.
 */
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`요청 시간 초과 (${Math.round(timeoutMs / 1000)}s)`);
    }
    if (err instanceof TypeError) {
      // 네트워크 단절·CORS 등 fetch 자체 실패
      throw new Error("네트워크 연결을 확인해주세요.");
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/** 토큰 영속화 여부 (localStorage에도 저장할지) */
export function getGistTokenPersisted(): boolean {
  try { return localStorage.getItem(GIST_TOKEN_PERSIST_KEY) === "true"; } catch { return false; }
}

export function getGistToken(): string {
  // 우선순위: sessionStorage → localStorage (영속 옵션 사용자만)
  try {
    const ss = sessionStorage.getItem(GIST_TOKEN_KEY);
    if (ss) return ss;
  } catch { /* private mode 등 */ }
  try {
    const ls = localStorage.getItem(GIST_TOKEN_KEY);
    if (ls) {
      // 기존 localStorage 사용자 호환: 읽는 즉시 sessionStorage 미러링해 같은 탭에선 빠르게
      try { sessionStorage.setItem(GIST_TOKEN_KEY, ls); } catch { /* */ }
      return ls;
    }
  } catch { /* */ }
  return "";
}

export interface SetGistTokenOptions {
  /** true면 localStorage에도 저장(영속). 기본 false (sessionStorage만) */
  persist?: boolean;
}

export function setGistToken(token: string, opts: SetGistTokenOptions = {}): void {
  const persist = opts.persist ?? getGistTokenPersisted();
  try {
    if (token) sessionStorage.setItem(GIST_TOKEN_KEY, token);
    else sessionStorage.removeItem(GIST_TOKEN_KEY);
  } catch { /* */ }
  try {
    if (token && persist) localStorage.setItem(GIST_TOKEN_KEY, token);
    else localStorage.removeItem(GIST_TOKEN_KEY);
  } catch { /* */ }
  try { localStorage.setItem(GIST_TOKEN_PERSIST_KEY, persist ? "true" : "false"); } catch { /* */ }
  emitConfigChange();
}

/** 토큰 영속화 여부만 토글 (현재 토큰 값 유지) */
export function setGistTokenPersisted(persist: boolean): void {
  const token = getGistToken();
  setGistToken(token, { persist });
}

export function getGistId(): string {
  try { return localStorage.getItem(GIST_ID_KEY) ?? ""; } catch { return ""; }
}

export function setGistId(id: string): void {
  try {
    if (id) localStorage.setItem(GIST_ID_KEY, id);
    else localStorage.removeItem(GIST_ID_KEY);
  } catch { /* */ }
  emitConfigChange();
}

/** 토큰과 Gist ID가 모두 설정되어 있는지 */
export function isGistConfigured(): boolean {
  return !!getGistToken() && !!getGistId();
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };
}

/** GitHub API 에러를 사용자 친화적 메시지로 변환 */
function parseApiError(status: number, body: string, action: string): string {
  switch (status) {
    case 401: return `${action} 실패: 토큰이 유효하지 않습니다. 설정에서 토큰을 확인하세요.`;
    case 403: return `${action} 실패: 권한이 없습니다. 토큰에 gist 권한이 있는지 확인하세요.`;
    case 404: return `${action} 실패: Gist를 찾을 수 없습니다. 삭제되었을 수 있습니다.`;
    case 422: return `${action} 실패: 데이터 형식 오류입니다.`;
    case 429: return `${action} 실패: API 요청 한도 초과. 잠시 후 다시 시도하세요.`;
    default: return `${action} 실패 (${status}): ${body.slice(0, 200)}`;
  }
}

/**
 * 에러 메시지 본문으로 일시적 오류 (재시도 가치 있음) 판별.
 * - 네트워크 단절·CORS·DNS: TypeError → "네트워크 연결을 확인해주세요." 매핑
 * - 타임아웃: AbortError → "요청 시간 초과 (15s)" 매핑
 * - 5xx 서버 오류
 * 4xx 인증·데이터 오류는 retry 무가치 (영구 오류).
 */
function isTransientGistError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("네트워크 연결")) return true;
  if (msg.includes("시간 초과")) return true;
  // parseApiError 5xx default 케이스 — "(5xx)" 형태로 status 포함됨
  return /\((5\d\d)\)/.test(msg);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Gist push retry 래퍼. 일시적 오류에만 재시도, 영구 오류 (401/403/404/422)는 즉시 throw.
 * 모바일 LTE 핸드오버·약한 Wi-Fi에서 한 번 죽어도 회복하기 위함.
 * 마지막 시도 실패 시 마지막 에러를 그대로 throw.
 */
export async function saveToGistWithRetry(
  dataJson: string,
  options?: { onAttempt?: (attempt: number, err: Error) => void }
): Promise<{ gistId: string; updatedAt: string; committedAt: string }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= GIST_PUSH_RETRY.MAX_ATTEMPTS; attempt++) {
    try {
      return await saveToGist(dataJson);
    } catch (err) {
      lastErr = err;
      if (!isTransientGistError(err) || attempt >= GIST_PUSH_RETRY.MAX_ATTEMPTS) break;
      const delay = GIST_PUSH_RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1);
      options?.onAttempt?.(attempt, err instanceof Error ? err : new Error(String(err)));
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Gist에 데이터 저장. Gist ID가 없으면 새로 생성. */
export async function saveToGist(dataJson: string): Promise<{ gistId: string; updatedAt: string; committedAt: string }> {
  const token = getGistToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");

  const gistId = getGistId();
  const body = {
    description: "FarmWallet 데이터 백업",
    public: false,
    files: {
      [GIST_FILE_NAME]: { content: dataJson }
    }
  };

  if (gistId) {
    // Update existing gist
    const res = await fetchWithTimeout(`${API_BASE}/gists/${gistId}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify(body)
    });
    if (res.status === 404) {
      // Gist deleted, create new
      setGistId("");
      return saveToGist(dataJson);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(parseApiError(res.status, err, "Gist 저장"));
    }
    const data = await parseGistResponse(res);
    return { gistId: data.id ?? gistId, updatedAt: data.updated_at ?? new Date().toISOString(), committedAt: committedAtFromResponse(data) };
  }

  // Create new gist
  const res = await fetchWithTimeout(`${API_BASE}/gists`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Gist 생성"));
  }
  const data = await parseGistResponse(res);
  if (!data.id) throw new Error("Gist 생성 응답에 ID가 없습니다.");
  setGistId(data.id);
  return { gistId: data.id, updatedAt: data.updated_at ?? new Date().toISOString(), committedAt: committedAtFromResponse(data) };
}

/** GitHub Gist API 응답의 최소 형태 */
interface GistApiResponse {
  id?: string;
  updated_at?: string;
  /** 커밋 이력 — history[0]이 가장 최근 커밋. committed_at은 getGistVersions의 committedAt와 동일 소스라
   *  push 후 known 갱신에 써야 가짜 충돌(updated_at vs committed_at 시각 차이)이 안 생긴다. */
  history?: Array<{ committed_at?: string } | undefined>;
  files?: Record<string, { content?: string; raw_url?: string } | undefined>;
}

/** PATCH/POST 응답 history[0]의 committed_at — getGistVersions와 동일 소스. 없으면 updated_at 폴백. */
function committedAtFromResponse(data: GistApiResponse): string {
  return data.history?.[0]?.committed_at ?? data.updated_at ?? new Date().toISOString();
}

async function parseGistResponse(res: Response): Promise<GistApiResponse> {
  try {
    const json = await res.json() as unknown;
    if (!json || typeof json !== "object") return {};
    return json as GistApiResponse;
  } catch {
    return {};
  }
}

/** Gist에서 데이터 불러오기 */
export async function loadFromGist(): Promise<{ dataJson: string; updatedAt: string }> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  if (!gistId) throw new Error("Gist ID가 설정되지 않았습니다. 먼저 저장을 해주세요.");

  const res = await fetchWithTimeout(`${API_BASE}/gists/${gistId}`, {
    headers: headers(token)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Gist 불러오기"));
  }
  const data = await parseGistResponse(res);
  const file = data.files?.[GIST_FILE_NAME];
  if (!file) {
    throw new Error("Gist에 FarmWallet 데이터가 없습니다.");
  }
  let content: string;
  if (file.raw_url) {
    // raw_url은 잘림 여부와 관계없이 항상 완전한 파일 내용을 반환
    const rawRes = await fetchWithTimeout(file.raw_url);
    if (!rawRes.ok) throw new Error(`Gist 원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else if (typeof file.content === "string") {
    content = file.content;
  } else {
    throw new Error("Gist 파일 내용을 읽을 수 없습니다.");
  }
  return { dataJson: content, updatedAt: data.updated_at ?? new Date().toISOString() };
}

export interface GistVersion {
  sha: string;
  committedAt: string;
  /** 이 버전 데이터를 가져오는 API URL */
  url: string;
}

/**
 * push 직전 원격 commit 시각이 마지막으로 알고 있던 시점보다 새로우면 true.
 * 순수 함수 — 단위 테스트 용이.
 */
export function detectConflict(
  latestRemoteCommittedAt: string | null | undefined,
  knownRemoteAt: string | null | undefined
): boolean {
  if (!latestRemoteCommittedAt || !knownRemoteAt) return false;
  const latestMs = new Date(latestRemoteCommittedAt).getTime();
  const knownMs = new Date(knownRemoteAt).getTime();
  if (!Number.isFinite(latestMs) || !Number.isFinite(knownMs)) return false;
  return latestMs > knownMs;
}

interface GistCommitApiItem {
  version?: unknown;
  committed_at?: unknown;
  url?: unknown;
}

/** 최근 N개의 Gist 버전 목록 반환 (PATCH할 때마다 자동으로 쌓임) */
export async function getGistVersions(maxCount = 5): Promise<GistVersion[]> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token || !gistId) throw new Error("토큰 또는 Gist ID가 없습니다.");

  const res = await fetchWithTimeout(`${API_BASE}/gists/${gistId}/commits?per_page=${maxCount}`, {
    headers: headers(token)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "버전 목록 조회"));
  }
  const raw = await res.json() as unknown;
  if (!Array.isArray(raw)) return [];
  const commits = raw as GistCommitApiItem[];
  return commits
    .filter((c): c is { version: string; committed_at: string; url: string } =>
      typeof c?.version === "string" && typeof c?.committed_at === "string" && typeof c?.url === "string"
    )
    .slice(0, maxCount)
    .map((c) => ({ sha: c.version, committedAt: c.committed_at, url: c.url }));
}

/** 특정 버전의 Gist 데이터 불러오기 (버전 url 사용) */
export async function loadFromGistVersion(versionUrl: string): Promise<{ dataJson: string; committedAt: string }> {
  const token = getGistToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");

  const res = await fetchWithTimeout(versionUrl, { headers: headers(token) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "버전 불러오기"));
  }
  const data = await parseGistResponse(res);
  const file = data.files?.[GIST_FILE_NAME];
  if (!file) throw new Error("해당 버전에 FarmWallet 데이터가 없습니다.");

  let content: string;
  if (file.raw_url) {
    const rawRes = await fetchWithTimeout(file.raw_url);
    if (!rawRes.ok) throw new Error(`버전 원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else if (typeof file.content === "string") {
    content = file.content;
  } else {
    throw new Error("해당 버전 파일 내용을 읽을 수 없습니다.");
  }
  return { dataJson: content, committedAt: data.updated_at ?? versionUrl };
}

/** 토큰 유효성 확인 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/user`, { headers: headers(token) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 자동 동기화 ON/OFF */
export function getGistAutoSync(): boolean {
  try { return localStorage.getItem(STORAGE_KEYS.GIST_AUTO_SYNC) === "true"; } catch { return false; }
}

export function setGistAutoSync(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEYS.GIST_AUTO_SYNC, enabled ? "true" : "false"); } catch { /* */ }
}

/** 마지막 자동 저장 시각 */
export function getGistLastPushAt(): string {
  try { return localStorage.getItem(STORAGE_KEYS.GIST_LAST_PUSH_AT) ?? ""; } catch { return ""; }
}

export function setGistLastPushAt(iso: string): void {
  try { localStorage.setItem(STORAGE_KEYS.GIST_LAST_PUSH_AT, iso); } catch { /* */ }
}

/** 마지막 자동 불러오기 시각 */
export function getGistLastPullAt(): string {
  try { return localStorage.getItem(STORAGE_KEYS.GIST_LAST_PULL_AT) ?? ""; } catch { return ""; }
}

export function setGistLastPullAt(iso: string): void {
  try { localStorage.setItem(STORAGE_KEYS.GIST_LAST_PULL_AT, iso); } catch { /* */ }
}

// =========================================
//  마지막 push payload 해시 — 부팅 자동 pull 시 "로컬 미push 변경" 감지용
// =========================================

const GIST_LAST_PUSH_HASH_KEY = "fw-gist-last-push-hash";

/** push payload의 간단 해시(djb2). 암호학적 용도가 아니라 변경 감지용. */
export function hashGistPayload(payload: string): string {
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return String(hash);
}

/** 마지막으로 push(또는 pull로 동기화)된 payload 해시 */
export function getGistLastPushedHash(): string {
  try { return localStorage.getItem(GIST_LAST_PUSH_HASH_KEY) ?? ""; } catch { return ""; }
}

export function setGistLastPushedHash(hash: string): void {
  try { localStorage.setItem(GIST_LAST_PUSH_HASH_KEY, hash); } catch { /* */ }
}
