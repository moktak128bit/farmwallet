/** 환율 밴드(G2) — utils/fxBand 순수함수: 분위수·동일값·표본 부족·압축 구간 일수 가중 */
import { describe, expect, it } from "vitest";
import type { FxPoint } from "../utils/portfolioHistory";
import { buildFxBand, describeFxBand, fxBandToneColor } from "../utils/fxBand";
import { addDaysToIso } from "../utils/date";

const TODAY = "2026-08-21";

/** today 기준 n일 전부터 오늘까지 일별 표본(오늘 포함) — rate(i)는 "오늘로부터 i일 전" */
function daily(n: number, rate: (daysAgo: number) => number): FxPoint[] {
  const out: FxPoint[] = [];
  for (let i = n; i >= 0; i--) out.push({ date: addDaysToIso(TODAY, -i), rate: rate(i) });
  return out;
}

describe("buildFxBand — 기본 분위수", () => {
  it("365일 일별 1300~1664(선형)에서 p25/p50/p75·min·max·percentile이 맞다", () => {
    // 오늘 1664, 364일 전 1300 → 365표본 전부 다른 값
    const hist = daily(364, (d) => 1664 - d);
    const r = buildFxBand(hist, 1664, TODAY);
    expect(r.band).not.toBeNull();
    const b = r.band!;
    expect(b.min).toBe(1300);
    expect(b.max).toBe(1664);
    expect(b.sampleDays).toBe(365);
    expect(b.coverage).toBeCloseTo(1, 5);
    // 가중 1씩: p50 = 183번째(누적 ≥ 182.5) → 1300+182 = 1482
    expect(b.p50).toBe(1482);
    expect(b.p25).toBe(1300 + 91); // 누적 ≥ 91.25 → 92번째
    expect(b.p75).toBe(1300 + 273); // 누적 ≥ 273.75 → 274번째
    // 현재(최대값)의 백분위 = (364 + 0.5)/365 ≈ 99.86
    expect(b.percentileOfCurrent).toBeCloseTo(((364 + 0.5) / 365) * 100, 5);
    // MA20: 최근 20일 1645~1664 평균 = 1654.5
    expect(b.ma20).toBeCloseTo(1654.5, 6);
    expect(b.ma60).toBeCloseTo(1634.5, 6);
  });

  it("현재 환율이 이력의 오늘자 값을 대체하고, 중간값이면 백분위 50 근처", () => {
    const hist = daily(364, (d) => 1664 - d); // 오늘 이력값 1664
    const r = buildFxBand(hist, 1482, TODAY); // 현재값으로 대체 → 1482가 두 번
    const b = r.band!;
    expect(b.max).toBe(1663); // 이력 오늘자 1664는 대체되어 사라짐
    // 1482보다 낮은 값 182개, 같은 값 2개 → (182+1)/365
    expect(b.percentileOfCurrent).toBeCloseTo(((182 + 1) / 365) * 100, 5);
    expect(describeFxBand(b)!.tone).toBe("neutral");
  });

  it("현재 환율 미로드(null)면 band는 나오되 percentileOfCurrent=null, 라벨 null", () => {
    const hist = daily(364, (d) => 1400 + (d % 50));
    const r = buildFxBand(hist, null, TODAY);
    expect(r.band).not.toBeNull();
    expect(r.band!.percentileOfCurrent).toBeNull();
    expect(describeFxBand(r.band)).toBeNull();
  });
});

describe("buildFxBand — 동일값", () => {
  it("모든 표본이 같으면 min=max=p25=p50=p75, 백분위 50, MA는 그 값", () => {
    const hist = daily(364, () => 1400);
    const r = buildFxBand(hist, 1400, TODAY);
    const b = r.band!;
    expect(b.min).toBe(1400);
    expect(b.max).toBe(1400);
    expect(b.p25).toBe(1400);
    expect(b.p50).toBe(1400);
    expect(b.p75).toBe(1400);
    expect(b.percentileOfCurrent).toBeCloseTo(50, 9);
    expect(b.ma20).toBe(1400);
    expect(b.ma60).toBe(1400);
    const label = describeFxBand(b)!;
    expect(label.tone).toBe("neutral");
    expect(label.text).toContain("중간");
  });
});

describe("buildFxBand — 표본 부족", () => {
  it("이력 없음·현재값 없음 → band=null·사유·coverage 0", () => {
    const r = buildFxBand([], null, TODAY);
    expect(r.band).toBeNull();
    expect(r.reason).toBeTruthy();
    expect(r.coverage).toBeCloseTo(0, 9);
    expect(r.sampleDays).toBe(0);
  });

  it("현재값만 있으면(이력 0건) 오늘 1표본 → coverage 1/365 → band=null", () => {
    const r = buildFxBand([], 1400, TODAY);
    expect(r.band).toBeNull();
    expect(r.sampleDays).toBe(1);
    expect(r.coverage).toBeCloseTo(1 / 365, 9);
  });

  it("최근 100일만 일별 이력 → coverage≈27% → band=null, coverage·sampleDays 보고", () => {
    const hist = daily(99, (d) => 1400 + d);
    const r = buildFxBand(hist, 1400, TODAY);
    expect(r.band).toBeNull();
    expect(r.coverage).toBeCloseTo(100 / 365, 5);
    expect(r.sampleDays).toBe(100);
    expect(r.reason).toContain("27%");
  });

  it("오래된 표본 하나가 창 전체를 대표하지 못한다(MAX_SPAN 31일 캡)", () => {
    // 400일 전 표본 1건 + 오늘 현재값 → 400일 전 표본은 창 안을 하나도 대표 못함(캡 31일, 창 시작보다 앞)
    const hist: FxPoint[] = [{ date: addDaysToIso(TODAY, -400), rate: 1100 }];
    const r = buildFxBand(hist, 1400, TODAY);
    expect(r.band).toBeNull();
    expect(r.sampleDays).toBe(1); // 오늘 현재값만
  });

  it("windowDays 옵션: 30일 창이면 최근 30일 일별만으로 band가 나온다", () => {
    const hist = daily(29, (d) => 1400 + d);
    const r = buildFxBand(hist, 1400, TODAY, { windowDays: 30 });
    expect(r.band).not.toBeNull();
    expect(r.band!.windowDays).toBe(30);
    expect(r.band!.min).toBe(1400);
    expect(r.band!.max).toBe(1429);
    expect(describeFxBand(r.band)!.text).toContain("최근 30일");
  });

  it("잘못된 기준일 → band=null", () => {
    expect(buildFxBand(daily(364, () => 1400), 1400, "2026-13-45").band).toBeNull();
    expect(buildFxBand(daily(364, () => 1400), 1400, "nope").band).toBeNull();
  });

  it("미래 날짜·손상 표본은 무시한다", () => {
    const hist = [
      ...daily(364, () => 1400),
      { date: addDaysToIso(TODAY, 5), rate: 9999 },
      { date: "2026-01-01", rate: 0 },
      { date: "2026-01-02", rate: NaN },
    ];
    const r = buildFxBand(hist, 1400, TODAY);
    expect(r.band!.max).toBe(1400);
    expect(r.band!.min).toBe(1400);
  });
});

describe("buildFxBand — 압축 구간(월말 1건) 일수 가중", () => {
  /**
   * 실데이터 형태: 최근 180일 일별 + 그 이전 월말 1건씩.
   * 최근 180일은 전부 1500(고환율), 그 이전 월말 6건은 전부 1300(저환율).
   * 표본 수로만 보면 1500이 180:6으로 압도하지만, 일수 가중이면 1300이 ≈180일을 대표해
   * p50 근처에서 갈리고 현재 1500의 백분위는 ~50% 부근이어야 한다(최근 편향 방지).
   */
  function compressedHistory(): FxPoint[] {
    const pts: FxPoint[] = [];
    for (let i = 179; i >= 0; i--) pts.push({ date: addDaysToIso(TODAY, -i), rate: 1500 });
    // 월말 표본(일별 구간 2026-02-23 이전): 01-31, 2025-12-31, 11-30, 10-31, 09-30, 08-31 (창 시작 2025-08-22)
    for (const d of ["2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"]) {
      pts.push({ date: d, rate: 1300 });
    }
    return pts;
  }

  it("표본 수가 아니라 대표 일수로 분포를 잡는다 — 1300·1500 사이 현재값의 백분위가 50% 근처", () => {
    // 현재 1400(오늘 표본을 대체) → 1300 구간(월말 6건, 176일)과 1500 구간(일별 179일+오늘 1400) 사이
    const r = buildFxBand(compressedHistory(), 1400, TODAY);
    expect(r.band).not.toBeNull();
    const b = r.band!;
    expect(b.sampleDays).toBe(186); // 180 일별 + 6 월말
    // 월말 표본 각 ≤31일 대표: 08-31(30)+09-30(31)+10-31(30)+11-30(31)+12-31(31)+01-31(23, 02-22까지)=176일,
    // 창 시작 08-22~08-30 9일은 빈 날 → coverage = (176+180)/365
    expect(b.coverage).toBeCloseTo(356 / 365, 9);
    // 표본 수 가중이었다면 1300은 6/186=3%에 그쳐 p25·p50 모두 1500이 됐을 것
    expect(b.p25).toBe(1300);
    expect(b.p50).toBe(1500); // 1300 누적 176 < 178 → 다음 값
    expect(b.p75).toBe(1500);
    expect(b.min).toBe(1300);
    expect(b.max).toBe(1500);
    // 1400보다 낮은 일수 176 + 같은 값(오늘 자신) 1/2 → 176.5 / 356 ≈ 49.6% (표본 수 기준이었다면 6/186 ≈ 3%)
    expect(b.percentileOfCurrent!).toBeCloseTo((176.5 / 356) * 100, 6);
    expect(describeFxBand(b)!.tone).toBe("neutral");
  });

  it("현재값이 최근 일별 구간과 같은 값이면 동률 절반 규칙으로 75% 부근(중간 순위)", () => {
    const r = buildFxBand(compressedHistory(), 1500, TODAY);
    const b = r.band!;
    // 낮은 176일 + 같은 180일/2 = 266 / 356
    expect(b.percentileOfCurrent!).toBeCloseTo((266 / 356) * 100, 6);
  });

  it("월말 표본 1건은 최대 31일만 대표한다 — 표본 간격이 31일보다 넓으면 빈 날은 coverage에서 빠진다", () => {
    // 최근 180일 일별 + 300일 전 표본 1건(다음 표본까지 120일 간격) → 그 표본은 31일만 대표
    const pts: FxPoint[] = [];
    for (let i = 179; i >= 0; i--) pts.push({ date: addDaysToIso(TODAY, -i), rate: 1500 });
    pts.push({ date: addDaysToIso(TODAY, -300), rate: 1300 });
    const r = buildFxBand(pts, 1500, TODAY);
    // 180 + 31 = 211 / 365 ≈ 57.8% < 60% → band null
    expect(r.band).toBeNull();
    expect(r.coverage).toBeCloseTo(211 / 365, 5);
    expect(r.sampleDays).toBe(181);
  });

  it("창 시작일 이전의 마지막 표본이 창 안쪽을 대표한다(최대 31일)", () => {
    // 창 시작(2025-08-22) 전 2025-08-20 표본 → 08-22~09-19(29일) 대표, 이후 월말 표본 이어짐
    const pts = [
      { date: "2025-08-20", rate: 1200 },
      ...daily(179, () => 1500),
      ...["2025-09-20", "2025-10-20", "2025-11-20", "2025-12-20", "2026-01-20", "2026-02-20"].map((d) => ({ date: d, rate: 1300 })),
    ];
    const r = buildFxBand(pts, 1500, TODAY);
    expect(r.band).not.toBeNull();
    expect(r.band!.min).toBe(1200); // 창 밖 날짜의 표본이지만 창 안을 대표하므로 포함
  });

  it("압축 구간 값이 낮으면 현재가 '비쌈'(상위·--danger), 높으면 '쌈'(하위·--accent)으로 라벨", () => {
    const lowPast = buildFxBand(
      [...daily(179, () => 1500), ...["2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"].map((d) => ({ date: d, rate: 1300 }))],
      1550,
      TODAY
    );
    const l1 = describeFxBand(lowPast.band)!;
    expect(l1.tone).toBe("expensive");
    expect(l1.text).toMatch(/^최근 1년 상위 \d+% — 비쌈$/);
    expect(fxBandToneColor(l1.tone)).toBe("var(--danger)");

    const highPast = buildFxBand(
      [...daily(179, () => 1500), ...["2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"].map((d) => ({ date: d, rate: 1600 }))],
      1450,
      TODAY
    );
    const l2 = describeFxBand(highPast.band)!;
    expect(l2.tone).toBe("cheap");
    expect(l2.text).toMatch(/^최근 1년 하위 \d+% — 쌈$/);
    expect(fxBandToneColor(l2.tone)).toBe("var(--accent)");
    expect(fxBandToneColor("neutral")).toBe("var(--text-muted)");
  });
});

describe("buildFxBand — 이동평균", () => {
  it("MA20/MA60은 최근 구간 일별 평균(현재값 포함), 60일 중 절반 넘게 비면 null", () => {
    // 최근 20일만 일별 + 그 이전은 월말 1건(60일 창 coverage: 20 + 31 = 51/60 ≥ 60% → 값 있음)
    const pts = [
      ...daily(19, (d) => 1400 + d),
      ...["2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"].map((d) => ({ date: d, rate: 1300 })),
    ];
    const r = buildFxBand(pts, 1400, TODAY);
    expect(r.band).not.toBeNull();
    expect(r.band!.ma20).toBeCloseTo(1409.5, 6);
    expect(r.band!.ma60).not.toBeNull();
    // 60일 창(06-23~08-21): 05-31 표본이 06-23~06-29(7일), 06-30 표본이 06-30~07-30(31일, 캡) 대표,
    // 07-31·08-01은 빈 날, 08-02~08-21 일별 20일 → 가중 평균 (7+31+20=58일)
    const expected60 = (1300 * 38 + 1409.5 * 20) / 58;
    expect(r.band!.ma60).toBeCloseTo(expected60, 6);
  });

  it("최근 20일 중 표본이 너무 적으면 ma20=null", () => {
    // 1년 전부터 60일 전까지 일별 + 오늘 현재값 → 1년 coverage = 304(일별 1일씩) + 31(마지막 표본 캡) + 1(오늘) = 336/365 ≥ 60%
    const pts: FxPoint[] = [];
    for (let i = 364; i >= 60; i--) pts.push({ date: addDaysToIso(TODAY, -i), rate: 1400 });
    const r = buildFxBand(pts, 1400, TODAY);
    expect(r.band).not.toBeNull();
    expect(r.band!.coverage).toBeCloseTo(336 / 365, 9);
    // 최근 20일 창: 60일 전 표본은 캡 31일(TODAY-60~TODAY-30)로 창 밖 → 오늘 1일만 = 1/20 < 60%
    expect(r.band!.ma20).toBeNull();
    // 60일 창(TODAY-59~TODAY): 60일 전 표본이 TODAY-59~TODAY-30 30일 대표 + 오늘 = 31/60 < 60%
    expect(r.band!.ma60).toBeNull();
  });
});
