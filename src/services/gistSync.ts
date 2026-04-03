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

export function getGistToken(): string {
  try { return localStorage.getItem(GIST_TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setGistToken(token: string): void {
  try { localStorage.setItem(GIST_TOKEN_KEY, token); } catch { /* */ }
}

export function getGistId(): string {
  try { return localStorage.getItem(GIST_ID_KEY) ?? ""; } catch { return ""; }
}

export function setGistId(id: string): void {
  try { localStorage.setItem(GIST_ID_KEY, id); } catch { /* */ }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };
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
      throw new Error(`Gist 저장 실패 (${res.status}): ${err}`);
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
    throw new Error(`Gist 생성 실패 (${res.status}): ${err}`);
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
    throw new Error(`Gist 불러오기 실패 (${res.status}): ${err}`);
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
