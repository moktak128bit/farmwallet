/**
 * 딥링크(매니페스트 shortcuts / share_target) 파싱·적용.
 *
 * 지원 쿼리:
 *   ?tab=<TabId>      — TAB_ORDER 화이트리스트에 있는 탭만 (그 외 무시)
 *   ?quick=1          — 빠른 입력(QuickEntry) 모달 열기
 *   ?text= / ?title= / ?url=  — share_target(GET). 합쳐서 빠른 입력 프리필로만 전달(자동 저장 금지).
 *
 * 적용 후에는 history.replaceState로 쿼리를 지워 새로고침 시 재적용·히스토리 오염을 막는다.
 */
import { useEffect } from "react";
import type { TabId } from "../components/ui/Tabs";
import { TAB_ORDER } from "../constants/tabs";
import { useUIStore } from "../store/uiStore";

interface DeepLink {
  tab?: TabId;
  quick?: boolean;
  sharedText?: string;
}

/** 공유 텍스트 프리필 상한(빠른 입력 한 줄 파서용 — 긴 본문은 잘라낸다) */
const SHARED_TEXT_MAX = 300;
const SHARE_PARAMS = ["title", "text", "url"] as const;
const DEEP_LINK_PARAMS = ["tab", "quick", ...SHARE_PARAMS] as const;

function isTabId(v: string): v is TabId {
  return (TAB_ORDER as string[]).includes(v);
}

export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: DeepLink = {};

  const tab = params.get("tab")?.trim();
  if (tab && isTabId(tab)) out.tab = tab;

  const quick = params.get("quick")?.trim().toLowerCase();
  if (quick === "1" || quick === "true" || quick === "yes") out.quick = true;

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of SHARE_PARAMS) {
    const raw = params.get(key);
    if (raw == null) continue;
    const v = raw.replace(/\s+/g, " ").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    parts.push(v);
  }
  if (parts.length > 0) {
    out.sharedText = parts.join(" ").slice(0, SHARED_TEXT_MAX);
    // 공유 수신은 항상 빠른 입력으로 — 사용자가 확인 후 직접 추가
    out.quick = true;
  }
  return out;
}

/** 쿼리에 딥링크 파라미터가 하나라도 있는지 (replaceState 필요 여부) */
export function hasDeepLinkParams(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return DEEP_LINK_PARAMS.some((k) => params.has(k));
}

/** 딥링크 파라미터만 제거한 URL (다른 쿼리·해시는 보존) */
export function stripDeepLinkParams(url: string): string {
  const u = new URL(url, "http://localhost/");
  for (const k of DEEP_LINK_PARAMS) u.searchParams.delete(k);
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * App 마운트 시 1회: 딥링크 적용 후 쿼리 제거.
 * - 탭: uiStore.setTab (LAST_TAB 저장 경로와 동일)
 * - 빠른 입력: quickEntryPrefill(공유 텍스트) → showQuickEntry
 * 반드시 useHistoryNav보다 먼저 호출해 base 탭·URL이 딥링크 적용 후 값으로 잡히게 한다.
 */
export function useDeepLink(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = window.location.search;
    if (!hasDeepLinkParams(search)) return;
    const link = parseDeepLink(search);
    const store = useUIStore.getState();
    if (link.tab) store.setTab(link.tab);
    if (link.quick) {
      store.setQuickEntryPrefill(link.sharedText ?? null);
      store.setShowQuickEntry(true);
    }
    try {
      const next = stripDeepLinkParams(window.location.href);
      window.history.replaceState(window.history.state, "", next);
    } catch {
      // file:// 등 replaceState 불가 환경 — 쿼리 유지해도 동작엔 영향 없음
    }
  }, []);
}
