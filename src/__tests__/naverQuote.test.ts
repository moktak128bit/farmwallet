/**
 * 한국 종목 시세 — Naver polling 1차 소스 회귀 (yahooFinanceApi.fetchYahooQuotes).
 * Yahoo v7 quote가 무인증 401로 죽은 뒤 교체된 경로: 신형 영숫자 코드(0180V0)·콤마 숫자·
 * 한글 종목명·무부호 등락폭의 부호 보정·0원 시세 제외를 검증한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooQuotes } from "../yahooFinanceApi";

const originalFetch = globalThis.fetch;

const naverPayload = (datas: unknown[]) =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ datas }))
  }) as Response;

const notFound = { ok: false, status: 404, text: () => Promise.resolve("") } as Response;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchYahooQuotes — 한국 종목 Naver polling", () => {
  it("신형 영숫자 코드(0180V0)를 콤마 숫자·한글명·부호 보정과 함께 파싱한다", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/naver-quote")) {
        expect(url).toContain("codes=0180V0");
        return Promise.resolve(
          naverPayload([
            {
              itemCode: "0180V0",
              stockName: "ACE 미국우주테크액티브",
              closePrice: "13,145",
              compareToPreviousClosePrice: "80", // 무부호 응답 대비
              fluctuationsRatio: "-0.61", // 부호는 비율 필드에서
              localTradedAt: "2026-06-12T15:12:07+09:00"
            }
          ])
        );
      }
      return Promise.resolve(notFound);
    }) as typeof fetch;

    const results = await fetchYahooQuotes(["0180V0"]);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.price).toBe(13145);
    expect(r.name).toBe("ACE 미국우주테크액티브");
    expect(r.currency).toBe("KRW");
    expect(r.changePercent).toBeCloseTo(-0.61);
    expect(r.change).toBe(-80); // 음수 비율 → 무부호 등락폭에 부호 보정
    expect(r.updatedAt).toBe(new Date("2026-06-12T15:12:07+09:00").toISOString());
  });

  it("closePrice가 0이면 결과에서 제외한다 (현재가 0원 오염 방지)", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/naver-quote")) {
        return Promise.resolve(
          naverPayload([{ itemCode: "0023A0", stockName: "SOL 미국양자컴퓨팅TOP10", closePrice: "0" }])
        );
      }
      // chart 폴백(.KS/.KQ × 프록시들)도 전부 실패 → 결과 없음
      return Promise.resolve(notFound);
    }) as typeof fetch;

    const results = await fetchYahooQuotes(["0023A0"]);
    expect(results).toHaveLength(0);
  }, 15000);

  it("캐시(2분 TTL)된 한국 종목은 재요청 없이 캐시로 응답한다", async () => {
    const naverSpy = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("naver")) {
        return Promise.resolve(
          naverPayload([
            {
              itemCode: "0050X0",
              stockName: "캐시테스트종목",
              closePrice: "10,000",
              compareToPreviousClosePrice: "100",
              fluctuationsRatio: "1.0",
              localTradedAt: "2026-06-12T15:00:00+09:00"
            }
          ])
        );
      }
      return Promise.resolve(notFound);
    });
    globalThis.fetch = naverSpy as typeof fetch;
    const naverCalls = () =>
      naverSpy.mock.calls.filter((c) => String(c[0]).includes("naver")).length;

    const first = await fetchYahooQuotes(["0050X0"]);
    expect(first).toHaveLength(1);
    expect(first[0].price).toBe(10000);
    const afterFirst = naverCalls();
    expect(afterFirst).toBeGreaterThan(0);

    // 두 번째 호출: 캐시 적중 → Naver(또는 프록시) 추가 요청이 한 건도 없어야 한다
    const second = await fetchYahooQuotes(["0050X0"]);
    expect(second).toHaveLength(1);
    expect(second[0].price).toBe(10000);
    expect(naverCalls()).toBe(afterFirst);
  });
});
