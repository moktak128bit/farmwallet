/** 1-7 — Gist 충돌 해소용 날짜키 시계열 date-union 병합(utils/timeSeriesMerge) */
import { describe, expect, it } from "vitest";
import type { HistoricalDailyClose, HistoricalDailyFx, MarketEnvSnapshot } from "../types";
import {
  mergeBenchmarkCloses,
  mergeDailyFx,
  mergeGistPayloadTimeSeries,
  mergeMarketEnvSnapshots,
  mergeTimeSeriesFields,
} from "../utils/timeSeriesMerge";

describe("mergeDailyFx", () => {
  it("서로 다른 날짜는 합집합, date 오름차순", () => {
    const base: HistoricalDailyFx[] = [{ date: "2026-08-19", rate: 1380 }];
    const other: HistoricalDailyFx[] = [{ date: "2026-08-18", rate: 1375 }, { date: "2026-08-20", rate: 1390 }];
    expect(mergeDailyFx(base, other)).toEqual([
      { date: "2026-08-18", rate: 1375 },
      { date: "2026-08-19", rate: 1380 },
      { date: "2026-08-20", rate: 1390 },
    ]);
  });

  it("같은 날짜는 base가 이긴다 (사용자가 선택한 쪽 우선)", () => {
    const base: HistoricalDailyFx[] = [{ date: "2026-08-19", rate: 1380 }];
    const other: HistoricalDailyFx[] = [{ date: "2026-08-19", rate: 1399 }];
    expect(mergeDailyFx(base, other)).toEqual([{ date: "2026-08-19", rate: 1380 }]);
    // 방향을 바꾸면 반대쪽이 이김 — 결정적
    expect(mergeDailyFx(other, base)).toEqual([{ date: "2026-08-19", rate: 1399 }]);
  });

  it("빈 배열·undefined는 안전", () => {
    expect(mergeDailyFx([], [])).toEqual([]);
    expect(mergeDailyFx(undefined, undefined)).toEqual([]);
    expect(mergeDailyFx(undefined, [{ date: "2026-08-19", rate: 1380 }])).toEqual([{ date: "2026-08-19", rate: 1380 }]);
  });

  it("손상 항목(잘못된 날짜·0 이하·NaN)은 양쪽 모두에서 제거", () => {
    const base = [{ date: "bad", rate: 1380 }, { date: "2026-08-19", rate: 0 }] as HistoricalDailyFx[];
    const other = [{ date: "2026-08-18", rate: Number.NaN }, { date: "2026-08-20", rate: 1390 }] as HistoricalDailyFx[];
    expect(mergeDailyFx(base, other)).toEqual([{ date: "2026-08-20", rate: 1390 }]);
  });

  it("같은 쪽 안의 중복 날짜는 1건으로 — 결과는 날짜당 1건(upsertDailyFx 형태 유지)", () => {
    const base: HistoricalDailyFx[] = [{ date: "2026-08-19", rate: 1380 }, { date: "2026-08-19", rate: 1381 }];
    const r = mergeDailyFx(base, []);
    expect(r).toHaveLength(1);
    expect(r[0].rate).toBe(1381);
  });

  it("압축 정책이 다른 두 기기(월말 1건 vs 일별)의 합집합은 일별 점을 보존한다 (다음 upsert가 재압축)", () => {
    const compressed: HistoricalDailyFx[] = [{ date: "2026-01-31", rate: 1300 }];
    const daily: HistoricalDailyFx[] = [
      { date: "2026-01-29", rate: 1298 },
      { date: "2026-01-30", rate: 1299 },
      { date: "2026-01-31", rate: 1301 },
    ];
    const r = mergeDailyFx(compressed, daily);
    expect(r.map((f) => f.date)).toEqual(["2026-01-29", "2026-01-30", "2026-01-31"]);
    expect(r[2].rate).toBe(1300); // base 우선
  });
});

describe("mergeBenchmarkCloses", () => {
  it("종목|날짜 키 합집합, ticker→date 정렬 (upsertBenchmarkCloses와 동일 형태)", () => {
    const base: HistoricalDailyClose[] = [{ ticker: "^KS11", date: "2026-08-19", close: 2700 }];
    const other: HistoricalDailyClose[] = [
      { ticker: "^GSPC", date: "2026-08-19", close: 5500 },
      { ticker: "^KS11", date: "2026-08-18", close: 2690 },
    ];
    expect(mergeBenchmarkCloses(base, other)).toEqual([
      { ticker: "^GSPC", date: "2026-08-19", close: 5500 },
      { ticker: "^KS11", date: "2026-08-18", close: 2690 },
      { ticker: "^KS11", date: "2026-08-19", close: 2700 },
    ]);
  });

  it("티커 대소문자·공백 차이는 같은 키로 취급, base 우선", () => {
    const base: HistoricalDailyClose[] = [{ ticker: "qqq", date: "2026-08-19", close: 480 }];
    const other: HistoricalDailyClose[] = [{ ticker: " QQQ ", date: "2026-08-19", close: 999 }];
    expect(mergeBenchmarkCloses(base, other)).toEqual([{ ticker: "QQQ", date: "2026-08-19", close: 480 }]);
  });

  it("빈 배열·손상 항목 처리", () => {
    expect(mergeBenchmarkCloses([], undefined)).toEqual([]);
    const bad = [{ ticker: "", date: "2026-08-19", close: 1 }, { ticker: "X", date: "2026-08-19", close: -1 }] as HistoricalDailyClose[];
    expect(mergeBenchmarkCloses(bad, [])).toEqual([]);
  });
});

describe("mergeMarketEnvSnapshots", () => {
  const snap = (date: string, fxRate: number, recordedAt: string): MarketEnvSnapshot => ({
    date, fxRate, prices: [{ ticker: "AAPL", price: 200, currency: "USD" }], recordedAt,
  });

  it("날짜 합집합·정렬, 같은 날짜는 recordedAt과 무관하게 base가 이긴다 (박제 불변·소급 박제가 더 늦을 수 있음)", () => {
    const base = [snap("2026-08-15", 1380, "2026-08-15T09:00:00Z")];
    const other = [snap("2026-08-01", 1370, "2026-08-01T09:00:00Z"), snap("2026-08-15", 1399, "2026-08-20T09:00:00Z")];
    const r = mergeMarketEnvSnapshots(base, other);
    expect(r.map((s) => s.date)).toEqual(["2026-08-01", "2026-08-15"]);
    expect(r[1].fxRate).toBe(1380);
  });

  it("빈 배열·fxRate 0 이하 항목 제거", () => {
    expect(mergeMarketEnvSnapshots(undefined, [])).toEqual([]);
    expect(mergeMarketEnvSnapshots([snap("2026-08-15", 0, "x")], [])).toEqual([]);
  });
});

describe("mergeTimeSeriesFields / mergeGistPayloadTimeSeries", () => {
  it("filledFromOther는 other가 실제로 채운 키 수 (base 중복·손상 정리는 포함 안 함)", () => {
    const r = mergeTimeSeriesFields(
      { historicalDailyFx: [{ date: "2026-08-19", rate: 1380 }, { date: "2026-08-19", rate: 1381 }] },
      { historicalDailyFx: [{ date: "2026-08-19", rate: 1390 }, { date: "2026-08-20", rate: 1391 }], benchmarkDailyCloses: [{ ticker: "QQQ", date: "2026-08-19", close: 480 }] }
    );
    expect(r.filledFromOther).toBe(2);
    expect(r.fields.historicalDailyFx).toEqual([{ date: "2026-08-19", rate: 1381 }, { date: "2026-08-20", rate: 1391 }]);
    expect(r.fields.benchmarkDailyCloses).toHaveLength(1);
    expect(r.fields.marketEnvSnapshots).toEqual([]);
  });

  it("payload: 시계열만 union, id 키 컬렉션(ledger 등)은 base 그대로", () => {
    const base = JSON.stringify({
      ledger: [{ id: "L-base" }],
      trades: [{ id: "T-base" }],
      historicalDailyFx: [{ date: "2026-08-19", rate: 1380 }],
    });
    const other = JSON.stringify({
      ledger: [{ id: "L-other" }],
      trades: [],
      historicalDailyFx: [{ date: "2026-08-20", rate: 1390 }],
      marketEnvSnapshots: [{ date: "2026-08-15", fxRate: 1370, prices: [], recordedAt: "2026-08-15T00:00:00Z" }],
    });
    const r = mergeGistPayloadTimeSeries(base, other);
    expect(r.filledFromOther).toBe(2);
    const parsed = JSON.parse(r.json);
    expect(parsed.ledger).toEqual([{ id: "L-base" }]);
    expect(parsed.trades).toEqual([{ id: "T-base" }]);
    expect(parsed.historicalDailyFx).toEqual([{ date: "2026-08-19", rate: 1380 }, { date: "2026-08-20", rate: 1390 }]);
    expect(parsed.marketEnvSnapshots).toHaveLength(1);
    expect(parsed.benchmarkDailyCloses).toEqual([]);
  });

  it("payload: other가 채운 게 없으면 baseJson 문자열을 그대로 반환(재직렬화 없음)", () => {
    const base = '{"x":1,"historicalDailyFx":[{"date":"2026-08-19","rate":1380}]}';
    const r = mergeGistPayloadTimeSeries(base, '{"historicalDailyFx":[{"date":"2026-08-19","rate":1399}]}');
    expect(r.json).toBe(base);
    expect(r.filledFromOther).toBe(0);
    expect(mergeGistPayloadTimeSeries('{"x":1}', '{"y":2}').json).toBe('{"x":1}');
  });

  it("payload: JSON 파싱 실패·배열 루트면 baseJson 원본 유지", () => {
    expect(mergeGistPayloadTimeSeries('{"x":1}', "not json").json).toBe('{"x":1}');
    expect(mergeGistPayloadTimeSeries("not json", '{"x":1}').json).toBe("not json");
    expect(mergeGistPayloadTimeSeries("[1,2]", '{"historicalDailyFx":[{"date":"2026-08-19","rate":1}]}').json).toBe("[1,2]");
  });

  it("payload: 멱등 — 같은 입력을 두 번 합쳐도 결과 동일", () => {
    const base = JSON.stringify({ historicalDailyFx: [{ date: "2026-08-19", rate: 1380 }] });
    const other = JSON.stringify({ historicalDailyFx: [{ date: "2026-08-20", rate: 1390 }] });
    const once = mergeGistPayloadTimeSeries(base, other).json;
    const twice = mergeGistPayloadTimeSeries(once, other);
    expect(twice.json).toBe(once);
    expect(twice.filledFromOther).toBe(0);
  });
});
