/**
 * 금액 계산식 파서 — 우선순위·괄호·0 나누기·USD 소수·잘못된 식 폴백·÷N.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateAmountExpression,
  isAmountExpression,
  sanitizeAmountExpressionInput,
  splitAmountByPeople,
} from "../utils/amountExpression";

describe("evaluateAmountExpression", () => {
  it("사칙연산 우선순위 (× ÷ 먼저)", () => {
    expect(evaluateAmountExpression("12000+3500*2/3")).toBe(14333); // 12000 + 2333.33 → 반올림
    expect(evaluateAmountExpression("12000+3500")).toBe(15500);
    expect(evaluateAmountExpression("45000/3")).toBe(15000);
    expect(evaluateAmountExpression("10-2*3")).toBe(4);
  });

  it("괄호·공백·콤마·유니코드 연산자(× ÷)", () => {
    expect(evaluateAmountExpression("(12,000 + 3,500) / 2")).toBe(7750);
    expect(evaluateAmountExpression("12000×2")).toBe(24000);
    expect(evaluateAmountExpression("30000÷4")).toBe(7500);
    expect(evaluateAmountExpression("((1000))")).toBe(1000);
  });

  it("KRW는 정수 반올림, USD(allowDecimal)는 소수 2자리", () => {
    expect(evaluateAmountExpression("100/3")).toBe(33);
    expect(evaluateAmountExpression("100/3", { allowDecimal: true })).toBe(33.33);
    expect(evaluateAmountExpression("1.5*2", { allowDecimal: true })).toBe(3);
    expect(evaluateAmountExpression("0.1+0.2", { allowDecimal: true })).toBe(0.3);
  });

  it("0 나누기·0 이하·음수 결과·비유한은 null", () => {
    expect(evaluateAmountExpression("100/0")).toBeNull();
    expect(evaluateAmountExpression("100-100")).toBeNull();
    expect(evaluateAmountExpression("100-200")).toBeNull();
    expect(evaluateAmountExpression("0.2", {})).toBeNull(); // KRW 반올림 0
    expect(evaluateAmountExpression("-(-100)")).toBe(100); // 단항 마이너스 중첩은 허용
  });

  it("잘못된 식은 null (폴백 — 입력은 호출 측이 그대로 둔다)", () => {
    expect(evaluateAmountExpression("1200+")).toBeNull();
    expect(evaluateAmountExpression("+")).toBeNull();
    expect(evaluateAmountExpression("(1200")).toBeNull();
    expect(evaluateAmountExpression("1200)")).toBeNull();
    expect(evaluateAmountExpression("12a00+3")).toBeNull();
    expect(evaluateAmountExpression("1.2.3+1")).toBeNull();
    expect(evaluateAmountExpression("")).toBeNull();
    expect(evaluateAmountExpression("   ")).toBeNull();
    expect(evaluateAmountExpression("1e3+1")).toBeNull(); // 과학표기 금지
    expect(evaluateAmountExpression("2**3")).toBeNull();
  });

  it("단순 숫자도 평가 가능 (콤마 제거)", () => {
    expect(evaluateAmountExpression("12,000")).toBe(12000);
  });
});

describe("isAmountExpression / sanitizeAmountExpressionInput", () => {
  it("연산자·괄호가 있으면 계산식, 숫자·콤마만이면 아님", () => {
    expect(isAmountExpression("12,000")).toBe(false);
    expect(isAmountExpression("12000+3")).toBe(true);
    expect(isAmountExpression("(12000)")).toBe(true);
    expect(isAmountExpression("12000×2")).toBe(true);
    expect(isAmountExpression("")).toBe(false);
    expect(isAmountExpression(null)).toBe(false);
  });

  it("허용 문자만 남기고 전각 숫자는 반각으로", () => {
    expect(sanitizeAmountExpressionInput("12,000원+3,500a")).toBe("12,000+3,500");
    expect(sanitizeAmountExpressionInput("１２+3")).toBe("12+3");
    expect(sanitizeAmountExpressionInput("１２＋3")).toBe("123"); // 전각 '＋'는 허용 외 → 제거
  });
});

describe("splitAmountByPeople (÷N)", () => {
  it("N명 1인분 — KRW 정수, USD 소수 2자리, N<2·금액≤0은 null", () => {
    expect(splitAmountByPeople(45000, 3)).toBe(15000);
    expect(splitAmountByPeople(10000, 3)).toBe(3333);
    expect(splitAmountByPeople(10, 3, { allowDecimal: true })).toBe(3.33);
    expect(splitAmountByPeople(45000, 1)).toBeNull();
    expect(splitAmountByPeople(45000, 2.5)).toBeNull();
    expect(splitAmountByPeople(0, 2)).toBeNull();
  });
});
