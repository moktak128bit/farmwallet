import { describe, it, expect } from "vitest";
import { formatNumber, formatKRW, formatUSD, formatShortDate } from "../utils/formatter";

describe("formatNumber", () => {
  it("정수를 천 단위 쉼표로 포맷", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("소수점은 반올림", () => {
    expect(formatNumber(1234.6)).toBe("1,235");
  });

  it("null/undefined/NaN은 '0' 반환", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber(NaN)).toBe("0");
  });
});

describe("formatKRW", () => {
  it("원화 형식", () => {
    expect(formatKRW(50000)).toBe("50,000 원");
  });

  it("NaN이면 '0 원'", () => {
    expect(formatKRW(NaN)).toBe("0 원");
  });
});

describe("formatUSD", () => {
  it("달러 형식 (소수점 3자리)", () => {
    expect(formatUSD(123.4567)).toBe("$123.457");
  });

  it("NaN이면 '$0.000'", () => {
    expect(formatUSD(NaN)).toBe("$0.000");
  });
});

describe("formatShortDate", () => {
  it("YYYY-MM-DD → YY.MM.DD 변환", () => {
    expect(formatShortDate("2026-04-07")).toBe("26.04.07");
  });

  it("빈 문자열이면 빈 문자열 반환", () => {
    expect(formatShortDate("")).toBe("");
  });
});
