/**
 * 목표 ETA(projectGoal) 테스트 — 단조 증가 ETA·감소·정체(분모 0)·달성·데이터 부족·
 * 기한 필요 월액·창 길이 클램프·연도 경계·한 줄 포맷.
 */
import { describe, expect, it } from "vitest";
import { formatGoalProjectionLine, projectGoal } from "../utils/goalProjection";

function series(start: string, values: number[]): { month: string; value: number }[] {
  const [y, m] = start.split("-").map(Number);
  return values.map((value, i) => {
    const idx = (m - 1) + i;
    const yy = y + Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    return { month: `${yy}-${String(mm).padStart(2, "0")}`, value };
  });
}

describe("projectGoal — 단조 증가", () => {
  it("최근 6개월 평균 델타로 ETA를 올림 계산한다", () => {
    // 2026-01 ~ 2026-08, 매달 +100만 → 현재 800만, 목표 1,250만 → 남은 450만 / 100만 = 4.5 → 5개월 → 2027-01
    const s = series("2026-01", [100, 200, 300, 400, 500, 600, 700, 800].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 12_500_000 });
    expect(p.status).toBe("projected");
    expect(p.windowMonths).toBe(6);
    expect(p.monthlyDelta).toBe(1_000_000);
    expect(p.remaining).toBe(4_500_000);
    expect(p.monthsToTarget).toBe(5);
    expect(p.etaMonth).toBe("2027-01");
    expect(p.requiredMonthlyForDate).toBeNull();
  });

  it("trailing12는 12개월 창을 쓰고, 데이터가 짧으면 가용 길이로 클램프한다", () => {
    // 14개 점: 처음 8개월은 정체, 마지막 6개월 급증 → 6개월 창과 12개월 창 결과가 달라야 함
    const vals = [0, 0, 0, 0, 0, 0, 0, 0, 100, 200, 300, 400, 500, 600].map((v) => v * 10_000);
    const s = series("2025-07", vals);
    const p6 = projectGoal({ series: s, target: 12_000_000, method: "trailing6" });
    const p12 = projectGoal({ series: s, target: 12_000_000, method: "trailing12" });
    expect(p6.monthlyDelta).toBe(1_000_000);
    expect(p12.windowMonths).toBe(12);
    expect(p12.monthlyDelta).toBe(500_000); // (600만 − 0) / 12
    expect(p6.monthsToTarget).toBe(6);
    expect(p12.monthsToTarget).toBe(12);

    // 점 4개뿐 → 창 3으로 클램프
    const short = projectGoal({ series: series("2026-01", [0, 100, 200, 300].map((v) => v * 10_000)), target: 10_000_000, method: "trailing12" });
    expect(short.windowMonths).toBe(3);
    expect(short.monthlyDelta).toBe(1_000_000);
  });

  it("연도 경계를 넘는 ETA 월을 올바르게 계산한다", () => {
    const s = series("2026-06", [0, 100, 200, 300, 400, 500, 600].map((v) => v * 10_000)); // 마지막 2026-12
    const p = projectGoal({ series: s, target: 20_000_000 });
    expect(p.monthsToTarget).toBe(14);
    expect(p.etaMonth).toBe("2028-02");
  });
});

describe("projectGoal — 도달 불가/경계", () => {
  it("감소 추세면 ETA 없음(declining), 델타는 음수로 보고", () => {
    const s = series("2026-01", [900, 800, 700, 600, 500, 400, 300].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 10_000_000 });
    expect(p.status).toBe("declining");
    expect(p.monthlyDelta).toBe(-1_000_000);
    expect(p.monthsToTarget).toBeNull();
    expect(p.etaMonth).toBeNull();
  });

  it("정체(델타 0, 분모 0)면 stalled — 0으로 나누지 않는다", () => {
    const s = series("2026-01", [500, 500, 500, 500].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 10_000_000 });
    expect(p.status).toBe("stalled");
    expect(p.monthlyDelta).toBe(0);
    expect(p.monthsToTarget).toBeNull();
    expect(p.etaMonth).toBeNull();
  });

  it("이미 달성이면 achieved — monthsToTarget 0, etaMonth = 현재 월, 필요 월액 null", () => {
    const s = series("2026-01", [100, 200, 300].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 2_500_000, targetDate: "2027-12-31" });
    expect(p.status).toBe("achieved");
    expect(p.monthsToTarget).toBe(0);
    expect(p.etaMonth).toBe("2026-03");
    expect(p.remaining).toBe(0);
    expect(p.requiredMonthlyForDate).toBeNull();
  });

  it("데이터 3개월 미만이면 insufficient (단, 현재값·남은 금액은 제공)", () => {
    const p = projectGoal({ series: series("2026-01", [100, 200].map((v) => v * 10_000)), target: 10_000_000 });
    expect(p.status).toBe("insufficient");
    expect(p.monthlyDelta).toBeNull();
    expect(p.etaMonth).toBeNull();
    expect(p.current).toBe(2_000_000);
    expect(p.remaining).toBe(8_000_000);
  });

  it("목표 0/음수/비유한·빈 시계열이면 invalid", () => {
    expect(projectGoal({ series: series("2026-01", [1, 2, 3]), target: 0 }).status).toBe("invalid");
    expect(projectGoal({ series: series("2026-01", [1, 2, 3]), target: -5 }).status).toBe("invalid");
    expect(projectGoal({ series: series("2026-01", [1, 2, 3]), target: Number.NaN }).status).toBe("invalid");
    expect(projectGoal({ series: [], target: 100 }).status).toBe("invalid");
  });

  it("월 키가 깨진 점·NaN 값은 무시한다", () => {
    const s = [
      { month: "2026-01", value: 1_000_000 },
      { month: "bad", value: 999 },
      { month: "2026-02", value: Number.NaN },
      { month: "2026-02", value: 2_000_000 },
      { month: "2026-03", value: 3_000_000 },
    ];
    const p = projectGoal({ series: s, target: 6_000_000 });
    expect(p.status).toBe("projected");
    expect(p.monthlyDelta).toBe(1_000_000);
    expect(p.etaMonth).toBe("2026-06");
  });
});

describe("projectGoal — 기한(targetDate)", () => {
  it("기한까지 맞추려면 필요한 월액 = 남은 금액 / 남은 개월", () => {
    const s = series("2026-01", [100, 200, 300, 400, 500, 600, 700, 800].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 20_000_000, targetDate: "2027-08-15" });
    expect(p.monthsToDeadline).toBe(12);
    expect(p.requiredMonthlyForDate).toBe(1_000_000); // 1,200만 / 12
    // "YYYY-MM"만 줘도 동일
    expect(projectGoal({ series: s, target: 20_000_000, targetDate: "2027-08" }).requiredMonthlyForDate).toBe(1_000_000);
  });

  it("기한이 지났거나 현재 월이면 필요 월액 null (분모 0 방지)", () => {
    const s = series("2026-01", [100, 200, 300].map((v) => v * 10_000));
    const same = projectGoal({ series: s, target: 10_000_000, targetDate: "2026-03-31" });
    expect(same.monthsToDeadline).toBe(0);
    expect(same.requiredMonthlyForDate).toBeNull();
    const past = projectGoal({ series: s, target: 10_000_000, targetDate: "2025-12-31" });
    expect(past.monthsToDeadline).toBe(-3);
    expect(past.requiredMonthlyForDate).toBeNull();
  });

  it("데이터 부족이어도 기한 필요 월액은 계산된다", () => {
    const p = projectGoal({ series: series("2026-01", [100].map((v) => v * 10_000)), target: 1_300_000, targetDate: "2026-07" });
    expect(p.status).toBe("insufficient");
    expect(p.requiredMonthlyForDate).toBe(50_000); // 30만 / 6개월
  });

  it("잘못된 기한 문자열은 무시한다", () => {
    const p = projectGoal({ series: series("2026-01", [1, 2, 3]), target: 10, targetDate: "언젠가" });
    expect(p.monthsToDeadline).toBeNull();
    expect(p.requiredMonthlyForDate).toBeNull();
  });
});

describe("formatGoalProjectionLine", () => {
  const fmt = (n: number) => `${Math.round(n / 10_000)}만`;
  it("projected: ETA·개월·페이스·기한 월액", () => {
    const s = series("2026-01", [100, 200, 300, 400, 500, 600, 700, 800].map((v) => v * 10_000));
    const p = projectGoal({ series: s, target: 20_000_000, targetDate: "2027-08" });
    expect(formatGoalProjectionLine(p, fmt)).toBe("ETA 2027-08 · 12개월 후 (최근 6개월 페이스 월 +100만) · 기한 맞추려면 월 +100만");
  });
  it("declining/stalled/insufficient/achieved 문구", () => {
    const dec = projectGoal({ series: series("2026-01", [300, 200, 100].map((v) => v * 10_000)), target: 10_000_000 });
    expect(formatGoalProjectionLine(dec, fmt)).toBe("ETA 없음 — 감소 추세 (최근 2개월 페이스 월 −100만)");
    const st = projectGoal({ series: series("2026-01", [1, 1, 1]), target: 10 });
    expect(formatGoalProjectionLine(st, fmt)).toContain("정체");
    const ins = projectGoal({ series: series("2026-01", [1]), target: 10 });
    expect(formatGoalProjectionLine(ins, fmt)).toContain("데이터 3개월 미만");
    const ach = projectGoal({ series: series("2026-01", [10, 10, 10]), target: 10 });
    expect(formatGoalProjectionLine(ach, fmt)).toBe("목표 달성 ✓");
  });
  it("기한 경과면 '기한 경과'를 덧붙인다", () => {
    const p = projectGoal({ series: series("2026-01", [1, 2, 3]), target: 10, targetDate: "2025-01" });
    expect(formatGoalProjectionLine(p, fmt)).toContain("기한 경과");
  });
});
