/** A0-2 — 일별 환율 적립(utils/dailyFx) + 환율 이력 합본(buildFxHistory) + persistence round-trip */
import { describe, expect, it } from "vitest";
import type { AppData, HistoricalDailyFx } from "../types";
import { fxFetchedAtToKstDate, shouldRecordDailyFx, upsertDailyFx } from "../utils/dailyFx";
import { buildFxHistory } from "../utils/portfolioHistory";
import { buildTableBackupFile, appDataFromTableBackupPayload } from "../utils/tableDataBackup";

describe("upsertDailyFx", () => {
  it("당일 환율을 1건 적립한다", () => {
    const r = upsertDailyFx([], 1380, "2026-06-12")!;
    expect(r).toEqual([{ date: "2026-06-12", rate: 1380 }]);
  });

  it("같은 날 재적립이면 마지막 값으로 교체(중복 없음)", () => {
    const first = upsertDailyFx([], 1380, "2026-06-12")!;
    const second = upsertDailyFx(first, 1385, "2026-06-12")!;
    expect(second).toHaveLength(1);
    expect(second[0].rate).toBe(1385);
  });

  it("값까지 같으면 null(불필요한 상태 갱신 방지)", () => {
    const first = upsertDailyFx([], 1380, "2026-06-12")!;
    expect(upsertDailyFx(first, 1380, "2026-06-12")).toBeNull();
  });

  it("0/음수/잘못된 날짜는 적립하지 않는다", () => {
    expect(upsertDailyFx([], 0, "2026-06-12")).toBeNull();
    expect(upsertDailyFx([], -1, "2026-06-12")).toBeNull();
    expect(upsertDailyFx([], 1380, "bad-date")).toBeNull();
  });

  it("180일 이전은 월당 마지막 1건으로 압축한다", () => {
    const old: HistoricalDailyFx[] = [
      { date: "2025-10-05", rate: 1300 },
      { date: "2025-10-15", rate: 1310 },
      { date: "2025-10-30", rate: 1320 },
    ];
    const r = upsertDailyFx(old, 1380, "2026-06-12")!;
    const oct = r.filter((f) => f.date.startsWith("2025-10"));
    expect(oct).toHaveLength(1);
    expect(oct[0].date).toBe("2025-10-30");
    expect(oct[0].rate).toBe(1320);
    expect(r.some((f) => f.date === "2026-06-12" && f.rate === 1380)).toBe(true);
  });

  it("최근 180일 이내는 일별 그대로 보존", () => {
    const recent: HistoricalDailyFx[] = [
      { date: "2026-05-02", rate: 1360 },
      { date: "2026-05-03", rate: 1362 },
    ];
    const r = upsertDailyFx(recent, 1380, "2026-06-12")!;
    expect(r.filter((f) => f.date.startsWith("2026-05"))).toHaveLength(2);
  });
});

describe("fxFetchedAtToKstDate — 수신 시각 → KST 날짜", () => {
  it("UTC 시각을 KST(+9h) 날짜로 환산한다", () => {
    expect(fxFetchedAtToKstDate("2026-08-20T03:00:00.000Z")).toBe("2026-08-20");
    expect(fxFetchedAtToKstDate("2026-08-19T15:00:00.000Z")).toBe("2026-08-20"); // KST 00:00 — 자정 경계
    expect(fxFetchedAtToKstDate("2026-08-19T14:59:59.999Z")).toBe("2026-08-19"); // KST 23:59:59
  });

  it("오프셋 표기 ISO도 처리한다", () => {
    expect(fxFetchedAtToKstDate("2026-08-20T00:30:00+09:00")).toBe("2026-08-20");
  });

  it("빈값·파싱 불가는 null", () => {
    expect(fxFetchedAtToKstDate(null)).toBeNull();
    expect(fxFetchedAtToKstDate(undefined)).toBeNull();
    expect(fxFetchedAtToKstDate("")).toBeNull();
    expect(fxFetchedAtToKstDate("not-a-date")).toBeNull();
  });
});

describe("shouldRecordDailyFx — 환율 stale 박제 방지 (0-1)", () => {
  const today = "2026-08-20";

  it("①캐시값(어제 이전 fetchedAt)은 오늘 날짜로 적립하지 않는다", () => {
    expect(
      shouldRecordDailyFx({ rate: 1380, fetchedAt: "2026-08-17T09:00:00.000Z", today, recordedFor: null })
    ).toBe(false);
    // 구형 캐시(fetchedAt 없음 → epoch 0)
    expect(
      shouldRecordDailyFx({ rate: 1380, fetchedAt: "1970-01-01T00:00:00.000Z", today, recordedFor: null })
    ).toBe(false);
    expect(shouldRecordDailyFx({ rate: 1380, fetchedAt: null, today, recordedFor: null })).toBe(false);
  });

  it("②같은 날 신선값(fetchedAt=오늘 KST) 도착 시 적립한다", () => {
    expect(
      shouldRecordDailyFx({ rate: 1380, fetchedAt: "2026-08-20T01:23:45.000Z", today, recordedFor: null })
    ).toBe(true);
  });

  it("같은 날 이미 신선값으로 적립했으면 재적립하지 않는다(하루 1회)", () => {
    expect(
      shouldRecordDailyFx({ rate: 1385, fetchedAt: "2026-08-20T05:00:00.000Z", today, recordedFor: today })
    ).toBe(false);
  });

  it("③KST 자정 경계 — UTC 전날 15:00 이후 수신은 오늘, 그 전은 어제", () => {
    expect(
      shouldRecordDailyFx({ rate: 1380, fetchedAt: "2026-08-19T15:00:00.000Z", today, recordedFor: null })
    ).toBe(true);
    expect(
      shouldRecordDailyFx({ rate: 1380, fetchedAt: "2026-08-19T14:59:59.000Z", today, recordedFor: null })
    ).toBe(false);
  });

  it("날짜가 넘어가면(recordedFor=어제) 새 날짜의 신선값은 다시 적립한다", () => {
    expect(
      shouldRecordDailyFx({
        rate: 1380,
        fetchedAt: "2026-08-20T16:00:00.000Z", // KST 08-21 01:00
        today: "2026-08-21",
        recordedFor: "2026-08-20",
      })
    ).toBe(true);
  });

  it("환율 미로드/0/음수는 적립하지 않는다", () => {
    expect(shouldRecordDailyFx({ rate: null, fetchedAt: "2026-08-20T01:00:00.000Z", today, recordedFor: null })).toBe(false);
    expect(shouldRecordDailyFx({ rate: 0, fetchedAt: "2026-08-20T01:00:00.000Z", today, recordedFor: null })).toBe(false);
    expect(shouldRecordDailyFx({ rate: -1, fetchedAt: "2026-08-20T01:00:00.000Z", today, recordedFor: null })).toBe(false);
  });
});

describe("buildFxHistory — 일별 + 반월 합본", () => {
  it("두 소스를 날짜순으로 합치고, 같은 날짜는 일별을 우선한다", () => {
    const daily: HistoricalDailyFx[] = [
      { date: "2026-06-01", rate: 1385 }, // 같은 날 — 일별 우선
      { date: "2026-06-12", rate: 1390 },
    ];
    const env = [
      { date: "2026-06-01", fxRate: 1380, prices: [], recordedAt: "2026-06-01T00:00:00Z" },
      { date: "2026-06-15", fxRate: 1395, prices: [], recordedAt: "2026-06-15T00:00:00Z" },
    ];
    const fx = buildFxHistory(daily, env);
    expect(fx.map((f) => f.date)).toEqual(["2026-06-01", "2026-06-12", "2026-06-15"]);
    expect(fx.find((f) => f.date === "2026-06-01")!.rate).toBe(1385); // 일별 우선
    expect(fx.find((f) => f.date === "2026-06-15")!.rate).toBe(1395); // 반월만 있는 날
  });

  it("소스가 비어도 안전", () => {
    expect(buildFxHistory(undefined, undefined)).toEqual([]);
  });
});

describe("persistence round-trip — historicalDailyFx가 테이블 백업에서 유실되지 않는다", () => {
  it("buildTableBackupFile → appDataFromTableBackupPayload 왕복 보존", () => {
    const fixture: AppData = {
      accounts: [],
      ledger: [],
      trades: [],
      prices: [],
      categoryPresets: { income: [], expense: [], transfer: [] },
      recurringExpenses: [],
      budgetGoals: [],
      customSymbols: [],
      historicalDailyFx: [
        { date: "2026-06-01", rate: 1380 },
        { date: "2026-06-12", rate: 1390 },
      ],
    };
    const file = buildTableBackupFile(fixture);
    expect(file.tables.historical_daily_fx).toHaveLength(2);
    const restored = appDataFromTableBackupPayload(file);
    expect(restored.historicalDailyFx).toEqual(fixture.historicalDailyFx);
  });
});
