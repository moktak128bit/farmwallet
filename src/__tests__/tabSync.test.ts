import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STORAGE_KEYS } from "../constants/config";

/**
 * tabSync — BroadcastChannel 모킹 기반 행동 테스트.
 *
 * 모듈 상태(channel·lastSeenHash·lastHandledAt·TAB_ORIGIN_ID)가 모듈 스코프라
 * 테스트마다 vi.resetModules() + 동적 import 로 새 인스턴스를 얻는다.
 * BroadcastChannel은 같은 이름의 채널끼리 메시지를 전달하는 간단한 레지스트리 모킹으로 대체하고,
 * "다른 탭"은 originId가 다른 메시지를 직접 흘려 넣어 시뮬레이션한다.
 */

type Listener = (ev: { data: unknown }) => void;

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  static reset() { MockBroadcastChannel.instances = []; }
  readonly name: string;
  readonly posted: unknown[] = [];
  readonly listeners = new Set<Listener>();
  closed = false;
  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
  postMessage(msg: unknown) {
    if (this.closed) throw new Error("channel closed");
    this.posted.push(msg);
  }
  addEventListener(type: string, fn: Listener) { if (type === "message") this.listeners.add(fn); }
  removeEventListener(type: string, fn: Listener) { if (type === "message") this.listeners.delete(fn); }
  close() { this.closed = true; }
  /** 테스트 헬퍼 — 다른 탭이 보낸 것처럼 이 채널의 리스너에 전달 */
  emit(msg: unknown) { for (const fn of [...this.listeners]) fn({ data: msg }); }
}

interface SentMessage { type: string; originId: string; payloadHash: number; at: number }

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  return hash;
}

async function loadTabSync() {
  vi.resetModules();
  return await import("../services/tabSync");
}

function channel(): MockBroadcastChannel {
  expect(MockBroadcastChannel.instances.length).toBeGreaterThan(0);
  return MockBroadcastChannel.instances[0];
}

/** 다른 탭 방송 메시지 */
function foreign(payloadHash: number, originId = "other-tab"): SentMessage {
  return { type: "data-changed", originId, payloadHash, at: Date.now() };
}

function setStored(payload: string) {
  window.localStorage.setItem(STORAGE_KEYS.DATA, payload);
}

describe("tabSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T09:00:00+09:00"));
    MockBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("notifyDataChanged", () => {
    it("채널을 지연 생성(한 번만)하고 originId·payloadHash(djb2)·at 을 담아 방송한다", async () => {
      const { notifyDataChanged } = await loadTabSync();
      expect(MockBroadcastChannel.instances).toHaveLength(0);
      notifyDataChanged('{"a":1}');
      notifyDataChanged('{"a":2}');
      expect(MockBroadcastChannel.instances).toHaveLength(1);
      const ch = channel();
      expect(ch.name).toBe("farmwallet-sync");
      const [m1, m2] = ch.posted as SentMessage[];
      expect(m1.type).toBe("data-changed");
      expect(m1.payloadHash).toBe(djb2('{"a":1}'));
      expect(m2.payloadHash).toBe(djb2('{"a":2}'));
      expect(typeof m1.originId).toBe("string");
      expect(m1.originId).toBe(m2.originId);
      expect(m1.at).toBe(Date.now());
    });

    it("BroadcastChannel이 없거나 postMessage가 던져도 예외 없이 무시", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const mod = await loadTabSync();
      expect(() => mod.notifyDataChanged("x")).not.toThrow();

      vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
      const mod2 = await loadTabSync();
      mod2.notifyDataChanged("warm-up");
      channel().close();
      expect(() => mod2.notifyDataChanged("after-close")).not.toThrow();
    });
  });

  describe("subscribeDataChanges — 수신", () => {
    it("다른 탭 방송 → localStorage 현재 값을 읽어 handler에 전달", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const payload = '{"ledger":[1]}';
      setStored(payload);
      channel().emit(foreign(djb2(payload)));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it("자기 탭이 방송한 메시지(originId 동일)는 무시", async () => {
      const { subscribeDataChanges, notifyDataChanged } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      notifyDataChanged('{"own":1}');
      const own = channel().posted[0] as SentMessage;
      setStored('{"own":2}');
      channel().emit({ ...own, payloadHash: djb2('{"own":2}') });
      expect(handler).not.toHaveBeenCalled();
    });

    it("type이 다르거나 data가 없는 메시지는 무시", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      setStored('{"x":1}');
      channel().emit(undefined);
      channel().emit({ type: "other", originId: "o", payloadHash: 1, at: 0 });
      channel().emit("string");
      expect(handler).not.toHaveBeenCalled();
    });

    it("localStorage가 비어 있으면 handler 호출 없음", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      channel().emit(foreign(123));
      expect(handler).not.toHaveBeenCalled();
    });

    it("이미 본 해시(자기 탭이 마지막으로 저장한 payload)는 재처리하지 않음", async () => {
      const { subscribeDataChanges, notifyDataChanged } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const payload = '{"mine":1}';
      setStored(payload);
      notifyDataChanged(payload); // lastSeenHash = hash(payload)
      channel().emit(foreign(djb2(payload))); // 다른 탭이 같은 내용을 방송 (에코)
      expect(handler).not.toHaveBeenCalled();
    });

    it("같은 변경이 두 번 방송되면(BroadcastChannel + storage 폴백) 한 번만 처리", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const payload = '{"v":1}';
      setStored(payload);
      channel().emit(foreign(djb2(payload)));
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: payload }));
      vi.advanceTimersByTime(1000);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("hashHint가 localStorage 값과 다르면(쓰기 지연) 50ms 뒤 재시도해 일치하면 적용", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const stale = '{"v":0}';
      const fresh = '{"v":1}';
      setStored(stale);
      channel().emit(foreign(djb2(fresh)));
      expect(handler).not.toHaveBeenCalled();
      setStored(fresh); // 50ms 안에 쓰기 반영
      vi.advanceTimersByTime(50);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(fresh);
    });

    it("재시도 후에도 불일치면 적용하지 않고 lastSeenHash를 소비하지 않아 이후 storage 폴백이 처리 가능", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const stale = '{"v":0}';
      const fresh = '{"v":1}';
      setStored(stale);
      channel().emit(foreign(djb2(fresh)));
      vi.advanceTimersByTime(50); // 여전히 stale → 미적용
      expect(handler).not.toHaveBeenCalled();
      // 뒤늦게 실제 값이 반영되고 storage 이벤트 폴백이 도착
      setStored(fresh);
      vi.advanceTimersByTime(200); // dedup 윈도우(150ms) 통과
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: fresh }));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(fresh);
    });

    it("150ms 이내 연속 방송은 즉시 처리하지 않고 트레일링 재시도로 마지막 변경을 반영", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      const p1 = '{"v":1}';
      const p2 = '{"v":2}';
      setStored(p1);
      channel().emit(foreign(djb2(p1)));
      expect(handler).toHaveBeenCalledTimes(1);
      // 50ms 뒤 두 번째 변경 — dedup 윈도우 안
      vi.advanceTimersByTime(50);
      setStored(p2);
      channel().emit(foreign(djb2(p2)));
      expect(handler).toHaveBeenCalledTimes(1); // 즉시 처리 안 됨
      // 윈도우 종료 후 트레일링 재시도로 처리
      vi.advanceTimersByTime(150);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(p2);
    });

    it("dedup 윈도우 안에서 여러 번 방송돼도 트레일링 타이머는 하나만 예약", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      setStored('{"v":1}');
      channel().emit(foreign(djb2('{"v":1}')));
      vi.advanceTimersByTime(10);
      for (let i = 2; i <= 5; i++) {
        setStored(`{"v":${i}}`);
        channel().emit(foreign(djb2(`{"v":${i}}`)));
        vi.advanceTimersByTime(10);
      }
      vi.advanceTimersByTime(500);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith('{"v":5}');
    });

    it("storage 폴백: DATA 키가 아니거나 newValue가 없으면 무시", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      subscribeDataChanges(handler);
      setStored('{"v":1}');
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "x" }));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: null }));
      expect(handler).not.toHaveBeenCalled();
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: '{"v":1}' }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("BroadcastChannel이 없는 환경에서도 storage 폴백만으로 동작", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      const unsub = subscribeDataChanges(handler);
      setStored('{"fb":1}');
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: '{"fb":1}' }));
      expect(handler).toHaveBeenCalledWith('{"fb":1}');
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("subscribeDataChanges — 해제", () => {
    it("unsubscribe 후에는 채널 메시지·storage 이벤트 모두 무시하고 트레일링 타이머도 취소", async () => {
      const { subscribeDataChanges } = await loadTabSync();
      const handler = vi.fn();
      const unsub = subscribeDataChanges(handler);
      setStored('{"v":1}');
      channel().emit(foreign(djb2('{"v":1}')));
      expect(handler).toHaveBeenCalledTimes(1);
      // dedup 윈도우 안 두 번째 방송 → 트레일링 타이머 예약
      vi.advanceTimersByTime(20);
      setStored('{"v":2}');
      channel().emit(foreign(djb2('{"v":2}')));
      unsub();
      expect(channel().listeners.size).toBe(0);
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.DATA, newValue: '{"v":2}' }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("구독자 둘이 같은 채널을 공유 — 한 방송에 둘 다 호출되진 않는다(모듈 전역 해시 dedup)", async () => {
      // 현 설계: lastSeenHash가 모듈 전역이라 첫 구독자가 처리하면 두 번째는 '이미 본 해시'로 건너뛴다.
      // 앱은 구독자를 1개(useAppData)만 두므로 계약으로 기록해 둔다.
      const { subscribeDataChanges } = await loadTabSync();
      const h1 = vi.fn();
      const h2 = vi.fn();
      subscribeDataChanges(h1);
      subscribeDataChanges(h2);
      setStored('{"v":1}');
      channel().emit(foreign(djb2('{"v":1}')));
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });
  });
});
