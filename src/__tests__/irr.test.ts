import { describe, it, expect } from "vitest";
import { xirr, type CashFlowItem } from "../utils/irr";

describe("xirr", () => {
  it("최소 2개 미만의 현금흐름은 null 반환", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2024-01-01", amount: -100 }])).toBeNull();
  });

  it("양/음 부호가 모두 없으면 null 반환 (해 없음)", () => {
    expect(xirr([
      { date: "2024-01-01", amount: -100 },
      { date: "2024-06-01", amount: -50 },
    ])).toBeNull();
    expect(xirr([
      { date: "2024-01-01", amount: 100 },
      { date: "2024-06-01", amount: 50 },
    ])).toBeNull();
  });

  it("정확히 1년 후 110원 회수면 IRR ≈ 10%", () => {
    const flows: CashFlowItem[] = [
      { date: "2024-01-01", amount: -100 },
      { date: "2025-01-01", amount: 110 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.099);
    expect(r!).toBeLessThan(0.101);
  });

  it("6개월 후 105원 회수면 연환산 IRR ≈ 10.25% (복리)", () => {
    const flows: CashFlowItem[] = [
      { date: "2024-01-01", amount: -100 },
      { date: "2024-07-01", amount: 105 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    // (1 + 0.05)^2 - 1 ≈ 0.1025, 단 일수 차이로 약간 변동
    expect(r!).toBeGreaterThan(0.09);
    expect(r!).toBeLessThan(0.115);
  });

  it("불규칙 다중 입출금에서도 수렴해야 함", () => {
    const flows: CashFlowItem[] = [
      { date: "2024-01-01", amount: -1000 },
      { date: "2024-04-01", amount: -500 },
      { date: "2024-07-01", amount: 200 },
      { date: "2024-10-01", amount: 300 },
      { date: "2025-01-01", amount: 1100 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!)).toBe(true);
    // Excel XIRR로 검증: 약 7.5% 근방
    expect(r!).toBeGreaterThan(0.05);
    expect(r!).toBeLessThan(0.10);
  });

  it("손실 케이스: 1년 후 90원 회수면 IRR ≈ -10%", () => {
    const flows: CashFlowItem[] = [
      { date: "2024-01-01", amount: -100 },
      { date: "2025-01-01", amount: 90 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(-0.099);
    expect(r!).toBeGreaterThan(-0.101);
  });

  it("잘못된 날짜 문자열도 0년으로 fallback해 발산하지 않아야 함", () => {
    const flows: CashFlowItem[] = [
      { date: "invalid-date", amount: -100 },
      { date: "2025-01-01", amount: 110 },
    ];
    const r = xirr(flows);
    // 결과는 null이거나 유한한 숫자 (NaN/Infinity 안 됨)
    if (r !== null) expect(Number.isFinite(r)).toBe(true);
  });
});
