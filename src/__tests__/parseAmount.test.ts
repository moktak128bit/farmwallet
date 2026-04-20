import { describe, it, expect } from "vitest";
import { parseAmount, formatAmount } from "../utils/parseAmount";

describe("parseAmount", () => {
  it("일반 숫자", () => {
    expect(parseAmount("1000")).toBe(1000);
    expect(parseAmount("1,000,000")).toBe(1000000);
  });

  it("빈 값/null/undefined → 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  it("숫자가 아닌 문자 포함 → 제거", () => {
    expect(parseAmount("1,000원")).toBe(1000);
    expect(parseAmount("abc1000xyz")).toBe(1000);
  });

  it("음수 차단", () => {
    expect(parseAmount("-1000")).toBe(1000); // "-" 제거되므로 1000
    expect(parseAmount("-")).toBe(0);
  });

  it("과학 표기법 차단", () => {
    // "1e3"에서 'e' 제거되어 "13"이 됨 — Number("1e3") = 1000 같은 예기치 않은 결과 방지
    expect(parseAmount("1e3")).toBe(13);
  });

  it("allowDecimal=true: 소수점 허용", () => {
    expect(parseAmount("1.5", { allowDecimal: true })).toBe(1.5);
    expect(parseAmount("1,234.56", { allowDecimal: true })).toBe(1234.56);
  });

  it("allowDecimal=true + 다중 소수점 → 첫 소수점만 유지", () => {
    // "1.2.3" → "1.23" (두 번째 이후 점은 제거하고 자리수 이어붙임)
    expect(parseAmount("1.2.3", { allowDecimal: true })).toBe(1.23);
  });

  it("allowDecimal=false: 소수점도 제거", () => {
    expect(parseAmount("1.5")).toBe(15);
  });

  it("매우 큰 수", () => {
    expect(parseAmount("999999999999")).toBe(999999999999);
  });
});

describe("formatAmount", () => {
  it("천 단위 콤마", () => {
    expect(formatAmount("1000")).toBe("1,000");
    expect(formatAmount("1000000")).toBe("1,000,000");
  });

  it("빈 값 → 빈 문자열", () => {
    expect(formatAmount("")).toBe("");
    expect(formatAmount(null)).toBe("");
    expect(formatAmount(undefined)).toBe("");
  });

  it("allowDecimal: 소수점 2자리까지", () => {
    expect(formatAmount("1234.567", { allowDecimal: true })).toBe("1,234.56");
    expect(formatAmount("1234.5", { allowDecimal: true })).toBe("1,234.5");
  });

  it("allowDecimal + 다중 소수점 → 첫 소수점만 유지", () => {
    expect(formatAmount("1.2.3", { allowDecimal: true })).toBe("1.23");
  });

  it("숫자 없으면 빈 문자열", () => {
    expect(formatAmount("abc")).toBe("");
  });
});
