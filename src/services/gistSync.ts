/**
 * GitHub Gist 기반 데이터 동기화
 * - Private Gist에 앱 데이터를 JSON으로 저장/불러오기
 * - GitHub Personal Access Token(gist scope) 필요
 */

import { STORAGE_KEYS } from "../constants/config";

const GIST_TOKEN_KEY = "fw-gist-token";
const GIST_ID_KEY = "fw-gist-id";
const GIST_FILE_NAME = "farmwallet-data.json";
const API_BASE = "https://api.github.com";

/** Gist 설정 변경 이벤트 — App 헤더 등에서 구독하여 반응형으로 UI 갱신 */
export const GIST_CONFIG_CHANGE_EVENT = "farmwallet:gist-config-change";

function emitConfigChange() {
  window.dispatchEvent(new CustomEvent(GIST_CONFIG_CHANGE_EVENT));
}

export function getGistToken(): string {
  try { return localStorage.getItem(GIST_TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setGistToken(token: string): void {
  try { localStorage.setItem(GIST_TOKEN_KEY, token); } catch { /* */ }
  emitConfigChange();
}

export function getGistId(): string {
  try { return localStorage.getItem(GIST_ID_KEY) ?? ""; } catch { return ""; }
}

export function setGistId(id: string): void {
  try { localStorage.setItem(GIST_ID_KEY, id); } catch { /* */ }
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

/** Gist에 데이터 저장. Gist ID가 없으면 새로 생성. */
export async function saveToGist(dataJson: string): Promise<{ gistId: string; updatedAt: string }> {
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
    const res = await fetch(`${API_BASE}/gists/${gistId}`, {
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
    const data = await res.json();
    return { gistId: data.id, updatedAt: data.updated_at };
  }

  // Create new gist
  const res = await fetch(`${API_BASE}/gists`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Gist 생성"));
  }
  const data = await res.json();
  setGistId(data.id);
  return { gistId: data.id, updatedAt: data.updated_at };
}

/** Gist에서 데이터 불러오기 */
export async function loadFromGist(): Promise<{ dataJson: string; updatedAt: string }> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  if (!gistId) throw new Error("Gist ID가 설정되지 않았습니다. 먼저 저장을 해주세요.");

  const res = await fetch(`${API_BASE}/gists/${gistId}`, {
    headers: headers(token)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Gist 불러오기"));
  }
  const data = await res.json();
  const file = data.files?.[GIST_FILE_NAME];
  if (!file) {
    throw new Error("Gist에 FarmWallet 데이터가 없습니다.");
  }
  let content: string;
  if (file.raw_url) {
    // raw_url은 잘림 여부와 관계없이 항상 완전한 파일 내용을 반환
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) throw new Error(`Gist 원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else {
    content = file.content;
  }
  return { dataJson: content, updatedAt: data.updated_at };
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

/** 최근 N개의 Gist 버전 목록 반환 (PATCH할 때마다 자동으로 쌓임) */
export async function getGistVersions(maxCount = 5): Promise<GistVersion[]> {
  const token = getGistToken();
  const gistId = getGistId();
  if (!token || !gistId) throw new Error("토큰 또는 Gist ID가 없습니다.");

  const res = await fetch(`${API_BASE}/gists/${gistId}/commits?per_page=${maxCount}`, {
    headers: headers(token)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "버전 목록 조회"));
  }
  const commits = await res.json() as Array<{
    version: string;
    committed_at: string;
    url: string;
  }>;
  return commits.slice(0, maxCount).map((c) => ({
    sha: c.version,
    committedAt: c.committed_at,
    url: c.url,
  }));
}

/** 특정 버전의 Gist 데이터 불러오기 (버전 url 사용) */
export async function loadFromGistVersion(versionUrl: string): Promise<{ dataJson: string; committedAt: string }> {
  const token = getGistToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");

  const res = await fetch(versionUrl, { headers: headers(token) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "버전 불러오기"));
  }
  const data = await res.json();
  const file = data.files?.[GIST_FILE_NAME];
  if (!file) throw new Error("해당 버전에 FarmWallet 데이터가 없습니다.");

  let content: string;
  if (file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) throw new Error(`버전 원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else {
    content = file.content;
  }
  return { dataJson: content, committedAt: data.updated_at ?? versionUrl };
}

/** 토큰 유효성 확인 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/user`, {
      headers: headers(token)
    });
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
