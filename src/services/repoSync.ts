/**
 * GitHub Private Repo 기반 데이터 동기화
 * - Private repo의 특정 파일 (예: data/farmwallet-data.json)을 읽고 씀
 * - GitHub Contents API 사용 (gist이 아닌 실제 repo 파일)
 * - Personal Access Token (fine-grained: Contents Read/Write 권한) 필요
 */

import { STORAGE_KEYS } from "../constants/config";

const REPO_TOKEN_KEY = "fw-repo-token";
const REPO_OWNER_KEY = "fw-repo-owner";
const REPO_NAME_KEY = "fw-repo-name";
const REPO_BRANCH_KEY = "fw-repo-branch";
const REPO_PATH_KEY = "fw-repo-path";

const DEFAULT_OWNER = "moktak128bit";
const DEFAULT_REPO = "farmwallet";
const DEFAULT_BRANCH = "main";
const DEFAULT_PATH = "data/farmwallet-data.json";

const API_BASE = "https://api.github.com";

/** 설정 변경 이벤트 — 헤더 등에서 구독 */
export const REPO_CONFIG_CHANGE_EVENT = "farmwallet:repo-config-change";

function emitConfigChange() {
  window.dispatchEvent(new CustomEvent(REPO_CONFIG_CHANGE_EVENT));
}

/* ────────────────────────────────────────────────
 * 설정 getter/setter
 * ────────────────────────────────────────────────*/

export function getRepoToken(): string {
  try { return localStorage.getItem(REPO_TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setRepoToken(token: string): void {
  try { localStorage.setItem(REPO_TOKEN_KEY, token); } catch { /* */ }
  emitConfigChange();
}

export function getRepoOwner(): string {
  try { return localStorage.getItem(REPO_OWNER_KEY) || DEFAULT_OWNER; } catch { return DEFAULT_OWNER; }
}

export function setRepoOwner(owner: string): void {
  try { localStorage.setItem(REPO_OWNER_KEY, owner); } catch { /* */ }
  emitConfigChange();
}

export function getRepoName(): string {
  try { return localStorage.getItem(REPO_NAME_KEY) || DEFAULT_REPO; } catch { return DEFAULT_REPO; }
}

export function setRepoName(name: string): void {
  try { localStorage.setItem(REPO_NAME_KEY, name); } catch { /* */ }
  emitConfigChange();
}

export function getRepoBranch(): string {
  try { return localStorage.getItem(REPO_BRANCH_KEY) || DEFAULT_BRANCH; } catch { return DEFAULT_BRANCH; }
}

export function setRepoBranch(branch: string): void {
  try { localStorage.setItem(REPO_BRANCH_KEY, branch); } catch { /* */ }
  emitConfigChange();
}

export function getRepoPath(): string {
  try { return localStorage.getItem(REPO_PATH_KEY) || DEFAULT_PATH; } catch { return DEFAULT_PATH; }
}

export function setRepoPath(path: string): void {
  try { localStorage.setItem(REPO_PATH_KEY, path); } catch { /* */ }
  emitConfigChange();
}

/** 토큰과 owner/repo가 모두 설정되어 있으면 true */
export function isRepoConfigured(): boolean {
  return !!getRepoToken() && !!getRepoOwner() && !!getRepoName();
}

/* ────────────────────────────────────────────────
 * base64 UTF-8 safe 인/디코딩
 * ────────────────────────────────────────────────*/

function b64encodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64decodeUtf8(b64: string): string {
  const clean = b64.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ────────────────────────────────────────────────
 * HTTP 헬퍼
 * ────────────────────────────────────────────────*/

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

function parseApiError(status: number, body: string, action: string): string {
  switch (status) {
    case 401: return `${action} 실패: 토큰이 유효하지 않습니다. 설정에서 토큰을 확인하세요.`;
    case 403: return `${action} 실패: 권한이 없습니다. 토큰에 Contents Read/Write 권한이 있는지 확인하세요.`;
    case 404: return `${action} 실패: 파일 또는 repo를 찾을 수 없습니다. owner/repo/path를 확인하세요.`;
    case 409: return `${action} 실패: 충돌 — 파일이 최근에 수정되었습니다. 다시 시도하세요.`;
    case 422: return `${action} 실패: 요청 데이터가 올바르지 않습니다. (${body.slice(0, 150)})`;
    case 429: return `${action} 실패: API 요청 한도 초과. 잠시 후 다시 시도하세요.`;
    default: return `${action} 실패 (${status}): ${body.slice(0, 200)}`;
  }
}

interface ContentsGetResponse {
  sha: string;
  content: string;
  encoding: string;
  download_url?: string;
  size?: number;
}

interface ContentsPutResponse {
  content: { sha: string };
  commit: {
    sha: string;
    message: string;
    author?: { date?: string };
    committer?: { date?: string };
  };
}

/** 현재 파일의 SHA 가져오기. 파일 없으면 undefined. */
async function getCurrentFileSha(): Promise<string | undefined> {
  const token = getRepoToken();
  const owner = getRepoOwner();
  const repo = getRepoName();
  const branch = getRepoBranch();
  const path = getRepoPath();

  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "파일 SHA 조회"));
  }
  const data = await res.json() as ContentsGetResponse;
  return data.sha;
}

/* ────────────────────────────────────────────────
 * 저장 / 불러오기
 * ────────────────────────────────────────────────*/

/** 한국 시각 기반 "YYYY-MM-DD HH:mm:ss" 문자열 */
function formatKoreaTime(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  return fmt.format(date); // "2026-04-11 00:30:15"
}

/** Repo에 데이터 저장 (기존 파일 있으면 업데이트, 없으면 생성) */
export async function saveToRepo(dataJson: string): Promise<{ sha: string; updatedAt: string }> {
  const token = getRepoToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  const owner = getRepoOwner();
  const repo = getRepoName();
  const branch = getRepoBranch();
  const path = getRepoPath();
  if (!owner || !repo) throw new Error("owner/repo가 설정되지 않았습니다.");

  // 기존 파일 SHA 조회 (없으면 새로 생성)
  const existingSha = await getCurrentFileSha();

  const koreaTimeStr = formatKoreaTime();
  const body: Record<string, unknown> = {
    message: `data: 저장 (${koreaTimeStr} KST)`,
    content: b64encodeUtf8(dataJson),
    branch
  };
  if (existingSha) body.sha = existingSha;

  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Repo 저장"));
  }
  const data = await res.json() as ContentsPutResponse;
  const updatedAt = data.commit?.committer?.date ?? data.commit?.author?.date ?? new Date().toISOString();
  return { sha: data.content.sha, updatedAt };
}

/** Repo에서 데이터 불러오기 */
export async function loadFromRepo(): Promise<{ dataJson: string; updatedAt: string }> {
  const token = getRepoToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  const owner = getRepoOwner();
  const repo = getRepoName();
  const branch = getRepoBranch();
  const path = getRepoPath();
  if (!owner || !repo) throw new Error("owner/repo가 설정되지 않았습니다.");

  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "Repo 불러오기"));
  }
  const data = await res.json() as ContentsGetResponse;

  let content: string;
  if (data.content && data.encoding === "base64") {
    content = b64decodeUtf8(data.content);
  } else if (data.download_url) {
    // 1MB 초과 시 content 필드가 비어있을 수 있음 → raw URL 사용
    const rawRes = await fetch(data.download_url, { headers: { Authorization: `Bearer ${token}` } });
    if (!rawRes.ok) throw new Error(`원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else {
    throw new Error("Repo 파일 내용을 읽을 수 없습니다.");
  }

  // _exportedAt 필드에서 저장 시각 추출 (없으면 현재 시각)
  let updatedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(content) as { _exportedAt?: string };
    if (parsed._exportedAt) updatedAt = parsed._exportedAt;
  } catch { /* ignore */ }

  return { dataJson: content, updatedAt };
}

/* ────────────────────────────────────────────────
 * 버전 기록 (git commits)
 * ────────────────────────────────────────────────*/

export interface RepoVersion {
  sha: string;
  committedAt: string;
  message: string;
}

/** 해당 파일을 건드린 최근 커밋 목록 반환 */
export async function getRepoVersions(maxCount = 10): Promise<RepoVersion[]> {
  const token = getRepoToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  const owner = getRepoOwner();
  const repo = getRepoName();
  const branch = getRepoBranch();
  const path = getRepoPath();

  const url = `${API_BASE}/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${maxCount}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "커밋 목록 조회"));
  }
  const commits = await res.json() as Array<{
    sha: string;
    commit: {
      message: string;
      author?: { date?: string };
      committer?: { date?: string };
    };
  }>;
  return commits.map((c) => ({
    sha: c.sha,
    committedAt: c.commit.committer?.date ?? c.commit.author?.date ?? "",
    message: c.commit.message ?? "",
  }));
}

/** 특정 커밋 시점의 파일 내용 불러오기 */
export async function loadFromRepoVersion(sha: string): Promise<{ dataJson: string; committedAt: string }> {
  const token = getRepoToken();
  if (!token) throw new Error("GitHub 토큰이 설정되지 않았습니다.");
  const owner = getRepoOwner();
  const repo = getRepoName();
  const path = getRepoPath();

  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(sha)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(res.status, err, "버전 불러오기"));
  }
  const data = await res.json() as ContentsGetResponse;

  let content: string;
  if (data.content && data.encoding === "base64") {
    content = b64decodeUtf8(data.content);
  } else if (data.download_url) {
    const rawRes = await fetch(data.download_url, { headers: { Authorization: `Bearer ${token}` } });
    if (!rawRes.ok) throw new Error(`원본 불러오기 실패 (${rawRes.status})`);
    content = await rawRes.text();
  } else {
    throw new Error("버전 파일 내용을 읽을 수 없습니다.");
  }

  // 커밋 시각은 별도 조회 — 일단 _exportedAt 또는 now로 반환
  let committedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(content) as { _exportedAt?: string };
    if (parsed._exportedAt) committedAt = parsed._exportedAt;
  } catch { /* ignore */ }

  return { dataJson: content, committedAt };
}

/* ────────────────────────────────────────────────
 * 토큰 검증
 * ────────────────────────────────────────────────*/

/** 토큰 유효성 + repo 접근 가능 여부 확인 */
export async function validateRepoToken(token: string, owner?: string, repo?: string): Promise<boolean> {
  try {
    const o = owner || getRepoOwner();
    const r = repo || getRepoName();
    // repo 접근 권한 확인 (fine-grained 토큰은 /user로 먼저 확인이 실패할 수 있음)
    const res = await fetch(`${API_BASE}/repos/${o}/${r}`, {
      headers: headers(token)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────
 * 자동 동기화 설정 (기존 Gist 설정과 동일한 구조)
 * ────────────────────────────────────────────────*/

export function getRepoAutoSync(): boolean {
  try { return localStorage.getItem(STORAGE_KEYS.REPO_AUTO_SYNC) === "true"; } catch { return false; }
}

export function setRepoAutoSync(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEYS.REPO_AUTO_SYNC, enabled ? "true" : "false"); } catch { /* */ }
}

export function getRepoLastPushAt(): string {
  try { return localStorage.getItem(STORAGE_KEYS.REPO_LAST_PUSH_AT) ?? ""; } catch { return ""; }
}

export function setRepoLastPushAt(iso: string): void {
  try { localStorage.setItem(STORAGE_KEYS.REPO_LAST_PUSH_AT, iso); } catch { /* */ }
}

export function getRepoLastPullAt(): string {
  try { return localStorage.getItem(STORAGE_KEYS.REPO_LAST_PULL_AT) ?? ""; } catch { return ""; }
}

export function setRepoLastPullAt(iso: string): void {
  try { localStorage.setItem(STORAGE_KEYS.REPO_LAST_PULL_AT, iso); } catch { /* */ }
}
