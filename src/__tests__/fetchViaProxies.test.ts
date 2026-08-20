/**
 * 5-8 — 공개 CORS 프록시 체인 단일 진입점(yahooFinanceApi.fetchViaProxies):
 * 1차 실패→2차 성공, 전부 실패(+429 플래그), accept 거부, 성공 프록시 선순위 기억·실패 카운트.
 * 모듈 상태(프록시 성적)가 테스트 간 새지 않도록 매 테스트 모듈을 새로 import한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Api = typeof import("../yahooFinanceApi");

const originalFetch = globalThis.fetch;

const textRes = (status: number, body: string): Response =>
  ({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) }) as Response;

async function loadApi(): Promise<Api> {
  vi.resetModules();
  return import("../yahooFinanceApi");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchViaProxies", () => {
  it("1차 프록시 실패(500) → 2차 성공이면 2차 본문을 돌려주고 성적을 기록한다", async () => {
    const api = await loadApi();
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.allorigins.win/")) return Promise.resolve(textRes(500, "boom"));
      if (url.startsWith("https://corsproxy.io/")) return Promise.resolve(textRes(200, '{"ok":1}'));
      return Promise.resolve(textRes(200, "should-not-reach"));
    }) as typeof fetch;

    const r = await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(r).toEqual({ body: '{"ok":1}', saw429: false });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("allorigins");
    expect(calls[1]).toContain("corsproxy.io");
    expect(calls[0]).toContain(encodeURIComponent("https://example.com/x"));

    const snap = api.getProxyStatusSnapshot();
    const byId = Object.fromEntries(snap.proxies.map((p) => [p.id, p]));
    expect(byId.allorigins).toMatchObject({ ok: 0, fail: 1, streak: 1 });
    expect(byId.corsproxy).toMatchObject({ ok: 1, fail: 0, streak: 0 });
    expect(byId.codetabs).toMatchObject({ ok: 0, fail: 0, streak: 0 });
    expect(snap.lastSuccessAt).not.toBeNull();
    // 성공한 프록시가 다음 시도의 맨 앞으로 온다
    expect(snap.proxies.map((p) => p.id)).toEqual(["corsproxy", "codetabs", "allorigins"]);
  });

  it("성공 프록시 선순위 기억 — 다음 호출은 직전 성공 프록시부터 시도한다", async () => {
    const api = await loadApi();
    let phase = 1;
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (phase === 1) {
        if (url.includes("allorigins")) return Promise.reject(new Error("network"));
        if (url.includes("corsproxy.io")) return Promise.reject(new Error("network"));
        return Promise.resolve(textRes(200, "from-codetabs"));
      }
      return Promise.resolve(textRes(200, "any"));
    }) as typeof fetch;

    const first = await api.fetchViaProxies("https://example.com/a", { devProxyUrl: null });
    expect(first.body).toBe("from-codetabs");
    expect(calls).toHaveLength(3);

    phase = 2;
    calls.length = 0;
    await api.fetchViaProxies("https://example.com/b", { devProxyUrl: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("codetabs");
  });

  it("전부 실패하면 body '' — 하나라도 429였으면 saw429=true (호출부가 RateLimitError로 승격)", async () => {
    const api = await loadApi();
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("allorigins")) return Promise.resolve(textRes(429, ""));
      if (url.includes("corsproxy.io")) return Promise.reject(new Error("network"));
      return Promise.resolve(textRes(502, "bad gateway"));
    }) as typeof fetch;

    const r = await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(r).toEqual({ body: "", saw429: true });
    const snap = api.getProxyStatusSnapshot();
    expect(snap.lastSuccessAt).toBeNull();
    for (const p of snap.proxies) expect(p).toMatchObject({ ok: 0, fail: 1, streak: 1 });
  });

  it("전부 실패·429 없음이면 saw429=false", async () => {
    const api = await loadApi();
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as typeof fetch;
    const r = await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(r).toEqual({ body: "", saw429: false });
  });

  it("accept가 거부한 본문(예: 'Not Found')은 실패로 보고 다음 프록시를 시도한다 — 기본 accept", async () => {
    const api = await loadApi();
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("allorigins")) return Promise.resolve(textRes(200, "Not Found"));
      return Promise.resolve(textRes(200, "real-body"));
    }) as typeof fetch;
    const r = await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(r.body).toBe("real-body");
  });

  it("커스텀 accept — 404라도 Yahoo chart JSON이면 확정(남은 프록시 미시도)", async () => {
    const api = await loadApi();
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(textRes(404, '{"chart":{"result":null,"error":{"code":"Not Found"}}}'));
    }) as typeof fetch;
    const r = await api.fetchViaProxies("https://example.com/x", {
      devProxyUrl: null,
      accept: (res, body) => (res.ok || res.status === 404) && body.includes('"chart"')
    });
    expect(r.body).toContain('"chart"');
    expect(calls).toHaveLength(1);
  });

  it("dev 환경(vitest=DEV)에서는 devProxyUrl이 체인 맨 앞 — 기본값은 /api/external/raw", async () => {
    const api = await loadApi();
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(textRes(200, "dev-body"));
    }) as typeof fetch;
    const r = await api.fetchViaProxies("https://example.com/x");
    expect(r.body).toBe("dev-body");
    expect(calls).toEqual([`/api/external/raw?url=${encodeURIComponent("https://example.com/x")}`]);

    calls.length = 0;
    await api.fetchViaProxies("https://example.com/y", { devProxyUrl: "/api/stooq?s=aapl.us" });
    expect(calls).toEqual(["/api/stooq?s=aapl.us"]);

    const dev = api.getProxyStatusSnapshot().proxies.find((p) => p.id === "dev");
    expect(dev).toMatchObject({ ok: 2, fail: 0 });
  });

  it("프록시 상태 구독자는 성적이 바뀔 때 호출되고 스냅샷 참조가 교체된다", async () => {
    const api = await loadApi();
    const before = api.getProxyStatusSnapshot();
    const listener = vi.fn();
    const unsubscribe = api.subscribeProxyStatus(listener);
    globalThis.fetch = vi.fn(() => Promise.resolve(textRes(200, "x"))) as typeof fetch;
    await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(listener).toHaveBeenCalledTimes(1);
    const after = api.getProxyStatusSnapshot();
    expect(after).not.toBe(before);
    expect(api.getProxyStatusSnapshot()).toBe(after); // 변경 없으면 같은 참조
    unsubscribe();
    await api.fetchViaProxies("https://example.com/x", { devProxyUrl: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
