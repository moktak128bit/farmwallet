/**
 * 탭 간 데이터 동기화.
 *
 * 기본: BroadcastChannel — 같은 origin의 다른 탭들에게 이벤트 방송.
 * 폴백: `storage` 이벤트 — 일부 iOS/구형 브라우저용. 둘 다 구독해도 중복은 해시로 가드.
 *
 * 정책:
 * - 로컬 변경 후 저장 성공 시 `notifyDataChanged(hash)` 호출
 * - 다른 탭에서 받으면 현재 localStorage의 값을 읽어와 store에 반영
 * - 같은 탭이 쏜 이벤트는 `originId`로 식별해 스스로 재처리하지 않음
 */

import { STORAGE_KEYS } from "../constants/config";

const CHANNEL_NAME = "farmwallet-sync";
const EVENT_DATA_CHANGED = "data-changed";
const MIN_DIFF_INTERVAL_MS = 150;

/** 이 탭의 고유 ID (origin 식별) */
const TAB_ORIGIN_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

interface DataChangedMessage {
  type: typeof EVENT_DATA_CHANGED;
  originId: string;
  /** 저장 직후의 payload hash (간단 djb2) — 다른 탭은 자신의 값과 비교해 변경 여부 확인 */
  payloadHash: number;
  at: number;
}

let channel: BroadcastChannel | null = null;
let lastSeenHash = 0;
let lastHandledAt = 0;

function initChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    return channel;
  } catch {
    return null;
  }
}

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** 로컬 저장 직후 호출 — 다른 탭에 알림 */
export function notifyDataChanged(payload: string): void {
  if (typeof window === "undefined") return;
  const hash = djb2Hash(payload);
  lastSeenHash = hash;
  const ch = initChannel();
  const msg: DataChangedMessage = {
    type: EVENT_DATA_CHANGED,
    originId: TAB_ORIGIN_ID,
    payloadHash: hash,
    at: Date.now(),
  };
  try { ch?.postMessage(msg); } catch { /* 채널 닫힘 등 무시 */ }
}

export type TabSyncHandler = (payload: string) => void;

/**
 * 다른 탭의 변경을 구독. handler는 현재 localStorage 값을 읽어 store에 반영해야 한다.
 * BroadcastChannel과 storage 이벤트 양쪽을 모두 구독하되, 짧은 시간 내 중복 방송은 dedup.
 */
export function subscribeDataChanges(handler: TabSyncHandler): () => void {
  if (typeof window === "undefined") return () => { /* */ };

  const readCurrent = () => {
    try { return window.localStorage.getItem(STORAGE_KEYS.DATA) ?? ""; } catch { return ""; }
  };

  const deliver = (hashHint: number | null) => {
    const now = Date.now();
    if (now - lastHandledAt < MIN_DIFF_INTERVAL_MS) return;
    const current = readCurrent();
    if (!current) return;
    const currentHash = djb2Hash(current);
    if (currentHash === lastSeenHash) return;
    lastSeenHash = currentHash;
    lastHandledAt = now;
    // hashHint가 주어졌는데 localStorage 값과 다르면 (드물지만) 그냥 localStorage 우선
    if (hashHint != null && hashHint !== currentHash) {
      // write 직후 localStorage 반영 지연일 수 있어 한 틱 뒤 재시도
      setTimeout(() => {
        const retry = readCurrent();
        if (djb2Hash(retry) === hashHint) handler(retry);
      }, 50);
      return;
    }
    handler(current);
  };

  const ch = initChannel();
  const onMessage = (event: MessageEvent<DataChangedMessage | unknown>) => {
    const data = event.data as DataChangedMessage | undefined;
    if (!data || data.type !== EVENT_DATA_CHANGED) return;
    if (data.originId === TAB_ORIGIN_ID) return; // 같은 탭 스스로 방송한 것
    deliver(data.payloadHash);
  };
  ch?.addEventListener("message", onMessage);

  // 폴백: storage 이벤트
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEYS.DATA) return;
    if (!e.newValue) return;
    deliver(null);
  };
  window.addEventListener("storage", onStorage);

  return () => {
    try { ch?.removeEventListener("message", onMessage); } catch { /* */ }
    window.removeEventListener("storage", onStorage);
  };
}

/** 테스트·shutdown 훅 */
export function closeTabSyncChannel(): void {
  try { channel?.close(); } catch { /* */ }
  channel = null;
}
