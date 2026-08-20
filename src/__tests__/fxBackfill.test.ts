/** 5-8 — 환율 이력 backfill 순수함수(utils/fxBackfill): 결번 탐지 + 기존 값 불변 append 병합 + 압축 정책 */
import { describe, expect, it } from "vitest";
import type { HistoricalDailyFx } from "../types";
import { mergeFxBackfill, missingFxDates } from "../utils/fxBackfill";
import { upsertDailyFx } from "../utils/dailyFx";

describe("missingFxDates", () => {
  it("구간 내 영업일(월~금) 중 없는 날짜만 오름차순으로 돌려준다 — 오늘은 제외", () => {
    // 2026-08-21(금). recentDays 7 → 08-14(금)~08-20(목) 중 주말(15토·16일) 제외
    const existing: HistoricalDailyFx[] = [
      { date: "2026-08-18", rate: 1380 },
      { date: "2026-08-21", rate: 1390 },
    ];
    expect(missingFxDates(existing, "2026-08-21", { recentDays: 7 })).toEqual([
      "2026-08-14",
      "2026-08-17",
      "2026-08-19",
      "2026-08-20",
    ]);
  });

  it("주말만 비어 있으면 빈 배열(Yahoo가 줄 수 없는 날은 결번으로 보지 않음)", () => {
    const existing: HistoricalDailyFx[] = [
      { date: "2026-08-17", rate: 1 },
      { date: "2026-08-18", rate: 1 },
      { date: "2026-08-19", rate: 1 },
      { date: "2026-08-20", rate: 1 },
      { date: "2026-08-21", rate: 1 },
    ];
    // recentDays 5 → 08-16(일)~08-20(목)
    expect(missingFxDates(existing, "2026-08-21", { recentDays: 5 })).toEqual([]);
  });

  it("기본 구간은 180일이며 빈 이력이면 영업일 전부가 결번", () => {
    const r = missingFxDates(undefined, "2026-08-21");
    expect(r[0]).toBe("2026-02-23"); // 08-21 - 180일 = 02-22(일) → 다음 영업일 02-23(월)
    expect(r.at(-1)).toBe("2026-08-20");
    expect(r.length).toBeGreaterThan(120);
    expect(r.every((d) => !["2026-08-15", "2026-08-16"].includes(d))).toBe(true);
  });

  it("손상 항목(rate 0)은 보유로 치지 않는다 / 잘못된 today면 빈 배열", () => {
    expect(missingFxDates([{ date: "2026-08-20", rate: 0 }], "2026-08-21", { recentDays: 1 })).toEqual([
      "2026-08-20",
    ]);
    expect(missingFxDates([], "bad", { recentDays: 7 })).toEqual([]);
  });
});

describe("mergeFxBackfill", () => {
  const today = "2026-08-21";

  it("없는 날짜만 append하고 기존 값은 절대 덮어쓰지 않는다", () => {
    const existing: HistoricalDailyFx[] = [{ date: "2026-08-19", rate: 1380 }];
    const fetched = [
      { date: "2026-08-18", close: 1370.5 },
      { date: "2026-08-19", close: 9999 }, // 이미 있음 → 무시
      { date: "2026-08-20", close: 1385 },
    ];
    const r = mergeFxBackfill(existing, fetched, today);
    expect(r).not.toBeNull();
    expect(r!.added).toBe(2);
    expect(r!.next).toEqual([
      { date: "2026-08-18", rate: 1370.5 },
      { date: "2026-08-19", rate: 1380 },
      { date: "2026-08-20", rate: 1385 },
    ]);
    // 입력 배열 불변
    expect(existing).toEqual([{ date: "2026-08-19", rate: 1380 }]);
  });

  it("오늘·미래 날짜, 0/NaN 종가, 형식 불량은 무시한다", () => {
    const r = mergeFxBackfill([], [
      { date: today, close: 1390 }, // 오늘은 recorder 담당
      { date: "2026-08-22", close: 1391 },
      { date: "2026-08-20", close: 0 },
      { date: "2026-08-19", close: Number.NaN },
      { date: "20260818", close: 1380 },
    ], today);
    expect(r).toBeNull();
  });

  it("추가할 것이 없으면 null (호출부가 기존 참조 유지)", () => {
    const existing: HistoricalDailyFx[] = [{ date: "2026-08-20", rate: 1385 }];
    expect(mergeFxBackfill(existing, [{ date: "2026-08-20", close: 1386 }], today)).toBeNull();
    expect(mergeFxBackfill(existing, [], today)).toBeNull();
  });

  it("upsertDailyFx와 같은 압축 정책 — 180일 이전은 월당 마지막 1건", () => {
    const fetched = [
      { date: "2025-10-05", close: 1300 },
      { date: "2025-10-15", close: 1310 },
      { date: "2025-10-30", close: 1320 },
      { date: "2026-08-20", close: 1385 },
    ];
    const r = mergeFxBackfill([], fetched, today)!;
    const oct = r.next.filter((f) => f.date.startsWith("2025-10"));
    expect(oct).toEqual([{ date: "2025-10-30", rate: 1320 }]);
    // 동일 입력을 upsertDailyFx로 적립해도 같은 압축 결과
    const viaUpsert = upsertDailyFx(
      fetched.filter((f) => f.date !== "2026-08-20").map((f) => ({ date: f.date, rate: f.close })),
      1385,
      "2026-08-20"
    )!;
    expect(viaUpsert.filter((f) => f.date.startsWith("2025-10"))).toEqual(oct);
  });

  it("backfill 후 당일 적립(upsertDailyFx)이 겹쳐도 과거 값은 그대로다", () => {
    const merged = mergeFxBackfill([], [{ date: "2026-08-20", close: 1385 }], today)!;
    const next = upsertDailyFx(merged.next, 1392, today)!;
    expect(next).toEqual([
      { date: "2026-08-20", rate: 1385 },
      { date: "2026-08-21", rate: 1392 },
    ]);
  });
});
