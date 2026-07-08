/** 종목 조회 — Yahoo chart(events=div) 파싱 + 요약 통계 (parseChartWithDividends / buildLookupSummary) */
import { describe, expect, it } from "vitest";
import {
  buildLookupSummary,
  parseChartWithDividends,
  type StockLookupData
} from "../utils/stockLookup";

const t0 = 1767312000; // 2026-01-02 00:00 UTC 근처 (portfolioPerformance.test.ts와 동일 기준)

describe("parseChartWithDividends", () => {
  it("종가·배당 이벤트·메타를 함께 파싱한다 (amount<=0/date 없는 배당은 건너뜀)", () => {
    const data = {
      chart: {
        result: [
          {
            meta: {
              symbol: "SCHD",
              currency: "USD",
              shortName: "Schwab US Dividend",
              regularMarketPrice: 27.5
            },
            timestamp: [t0, t0 + 86400, t0 + 2 * 86400],
            events: {
              dividends: {
                [`${t0 + 2 * 86400}`]: { amount: 0.7, date: t0 + 2 * 86400 },
                [`${t0}`]: { amount: 0.5, date: t0 },
                [`${t0 + 86400}`]: { amount: 0, date: t0 + 86400 }, // 0원 배당 → 제외
                bad: { amount: 1.2 } // date 없음 → 제외
              }
            },
            indicators: { quote: [{ close: [100, null, 110] }] }
          }
        ]
      }
    };
    const out = parseChartWithDividends(data);
    expect(out.closes).toHaveLength(2);
    expect(out.closes[0]).toEqual({ date: "2026-01-02", close: 100 });
    expect(out.dividends).toEqual([
      { date: "2026-01-02", amount: 0.5 },
      { date: "2026-01-04", amount: 0.7 }
    ]);
    expect(out.meta).toEqual({
      symbol: "SCHD",
      currency: "USD",
      name: "Schwab US Dividend",
      price: 27.5
    });
  });

  it("배당락일은 KST로 환산한다 (UTC 15시 = KST 다음날 0시)", () => {
    const ts = t0 + 15 * 3600;
    const data = {
      chart: {
        result: [{ events: { dividends: { [`${ts}`]: { amount: 1, date: ts } } } }]
      }
    };
    expect(parseChartWithDividends(data).dividends).toEqual([{ date: "2026-01-03", amount: 1 }]);
  });

  it("빈 응답이면 빈 결과", () => {
    const out = parseChartWithDividends({});
    expect(out.closes).toEqual([]);
    expect(out.dividends).toEqual([]);
    expect(out.meta.price).toBeUndefined();
    expect(out.meta.currency).toBeUndefined();
  });

  it("regularMarketPrice가 0 이하이면 price 미설정", () => {
    const data = {
      chart: { result: [{ meta: { symbol: "X", regularMarketPrice: 0 } }] }
    };
    expect(parseChartWithDividends(data).meta.price).toBeUndefined();
  });

  it("regularMarketTime을 meta.marketTime으로 노출 (유령 종목 판정용)", () => {
    const data = {
      chart: { result: [{ meta: { symbol: "X", regularMarketTime: t0 } }] }
    };
    expect(parseChartWithDividends(data).meta.marketTime).toBe(t0);
    expect(parseChartWithDividends({}).meta.marketTime).toBeUndefined();
  });
});

describe("buildLookupSummary", () => {
  const base: StockLookupData = {
    closes: [
      { date: "2025-06-01", close: 50 },
      { date: "2025-08-01", close: 80 },
      { date: "2026-07-02", close: 100 }
    ],
    dividends: [
      { date: "2024-12-01", amount: 9 },
      { date: "2025-07-03", amount: 1 }, // 정확히 365일 경계 → TTM 제외
      { date: "2025-09-01", amount: 2 },
      { date: "2026-03-01", amount: 3 }
    ],
    meta: {}
  };

  it("기간 수익률·52주 최고/최저·TTM 배당·수익률을 계산한다", () => {
    const s = buildLookupSummary(base, "2026-07-03");
    expect(s.lastClose).toBe(100);
    expect(s.rangeChangePct).toBeCloseTo(100, 5); // (100-50)/50
    // 52주 구간(2025-07-03~)에는 2025-06-01(50)이 빠진다
    expect(s.high52w).toBe(100);
    expect(s.low52w).toBe(80);
    expect(s.ttmDividend).toBeCloseTo(5, 8); // 2 + 3 (경계일 1은 제외)
    expect(s.ttmDividendCount).toBe(2);
    expect(s.ttmYieldPct).toBeCloseTo(5, 5); // 5 / 100 × 100
  });

  it("실시간 시세(currentPrice)가 있으면 수익률·배당수익률에 우선 사용", () => {
    const s = buildLookupSummary(base, "2026-07-03", 120);
    expect(s.rangeChangePct).toBeCloseTo(140, 5); // (120-50)/50
    expect(s.ttmYieldPct).toBeCloseTo((5 / 120) * 100, 5);
  });

  it("연도별 주당 배당 합계는 최근 연도 먼저 — 시작·진행 중 연도는 partial 표시", () => {
    const s = buildLookupSummary(base, "2026-07-03");
    // 조회 구간 시작 = min(첫 종가, 첫 배당) = 2024-12-01 → 2024는 연초 못 덮음(부분합), 2025는 전체 포함
    expect(s.dividendsByYear).toEqual([
      { year: "2026", total: 3, count: 1, partial: true }, // 기준 연도(진행 중)
      { year: "2025", total: 3, count: 2, partial: false },
      { year: "2024", total: 9, count: 1, partial: true } // 12월부터만 포함
    ]);
  });

  it("조회 구간이 1년을 덮으면 ttmCoversFullYear=true, 짧으면 false", () => {
    expect(buildLookupSummary(base, "2026-07-03").ttmCoversFullYear).toBe(true); // 2025-06-01부터
    const short: StockLookupData = {
      ...base,
      closes: [
        { date: "2026-02-01", close: 90 },
        { date: "2026-07-02", close: 100 }
      ]
    };
    expect(buildLookupSummary(short, "2026-07-03").ttmCoversFullYear).toBe(false);
  });

  it("데이터가 없으면 null/0으로 안전하게 반환", () => {
    const s = buildLookupSummary({ closes: [], dividends: [], meta: {} }, "2026-07-03");
    expect(s.lastClose).toBeNull();
    expect(s.rangeChangePct).toBeNull();
    expect(s.high52w).toBeNull();
    expect(s.low52w).toBeNull();
    expect(s.ttmDividend).toBe(0);
    expect(s.ttmYieldPct).toBeNull();
    expect(s.dividendsByYear).toEqual([]);
  });
});
