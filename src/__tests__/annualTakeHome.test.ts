import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { computeAnnualTakeHome, computeTakeHomeTrend } from "../utils/annualTakeHome";

let seq = 0;
const inc = (date: string, sub: string, amount: number, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ id: `L${++seq}`, date, kind: "income", category: "수입", subCategory: sub, description: sub, amount, toAccountId: "농협", ...extra }) as LedgerEntry;
const salaryKeys = new Set(["급여", "상여", "수당"]);

describe("내 실질 월급 — 최근 12개 완료월 근로소득 ÷ 12", () => {
  // 2025-11 ~ 2026-10 급여 300만, 12월 상여 400만, 1월 수당 80만 + 진행 중인 11월 급여(제외 대상)
  const ledger: LedgerEntry[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(2025, 10 + i, 1);
    const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    ledger.push(inc(`${ym}-25`, "급여", 3_000_000));
  }
  ledger.push(inc("2025-12-24", "상여", 4_000_000));
  ledger.push(inc("2026-01-10", "수당", 800_000));
  ledger.push(inc("2026-11-05", "급여", 9_999_999)); // 진행 중인 달 — 제외
  ledger.push(inc("2026-03-01", "배당", 50_000)); // 근로소득 아님 — 제외
  ledger.push(inc("2026-04-01", "퇴직연금", 4_000_000)); // 회사 적립 — 합계 제외, 따로
  ledger.push(inc("2024-11-25", "급여", 2_000_000)); // 기록이 2년 전부터 있음 → 직전 12개월 비교 가능

  const r = computeAnnualTakeHome({ ledger, salaryKeys, fxRate: 1400, curMonth: "2026-11" })!;

  it("창은 진행 중인 달을 뺀 직전 12개월", () => {
    expect(r.from).toBe("2025-11");
    expect(r.to).toBe("2026-10");
    expect(r.byMonth).toHaveLength(12);
  });
  it("합계·월평균은 급여+상여+수당, 배당·진행 중 달·퇴직연금은 빠진다", () => {
    expect(r.total).toBe(36_000_000 + 4_000_000 + 800_000);
    expect(r.monthlyAvg).toBe(Math.round(40_800_000 / 12));
    expect(r.divisorMonths).toBe(12);
    expect(r.retirement).toBe(4_000_000);
  });
  it("정기 월급 = 가장 많은 달에 나온 항목(급여)의 중앙값, 나머지는 상여·수당", () => {
    expect(r.regularKey).toBe("급여");
    expect(r.regularMedian).toBe(3_000_000);
    expect(r.extraTotal).toBe(4_800_000);
    expect(r.extraItems.map((x) => x.key)).toEqual(["상여", "수당"]);
  });
  it("직전 12개월 합계(기록이 그 기간을 덮을 때)", () => {
    expect(r.prevTotal).toBe(2_000_000);
  });

  it("기록이 1년이 안 되면 기록 시작 이후 개월 수로 나눈다(기록 전 달을 0원 월급으로 치지 않음)", () => {
    const short = [inc("2026-07-25", "급여", 3_000_000), inc("2026-08-25", "급여", 3_000_000), inc("2026-09-25", "급여", 3_000_000), inc("2026-10-25", "급여", 3_000_000)];
    const s = computeAnnualTakeHome({ ledger: short, salaryKeys, fxRate: null, curMonth: "2026-11" })!;
    expect(s.divisorMonths).toBe(4);
    expect(s.monthlyAvg).toBe(3_000_000);
    expect(s.prevTotal).toBeNull();
  });

  it("근로소득이 없으면 null", () => {
    expect(computeAnnualTakeHome({ ledger: [inc("2026-10-01", "배당", 1000)], salaryKeys, fxRate: null, curMonth: "2026-11" })).toBeNull();
  });

  it("추이: 마지막 점이 지금 값과 같다", () => {
    const t = computeTakeHomeTrend({ ledger, salaryKeys, fxRate: 1400, curMonth: "2026-11" });
    expect(t[t.length - 1]).toMatchObject({ month: "2026-10", monthlyAvg: r.monthlyAvg, partial: false });
  });
});
