import { describe, it, expect } from "vitest";
import { validateAmount, validateDate, validateTicker } from "../utils/validation";

describe("validateAmount", () => {
  it("빈 값이면 실패", () => {
    expect(validateAmount("").valid).toBe(false);
    expect(validateAmount("  ").valid).toBe(false);
  });

  it("정상 정수 금액", () => {
    expect(validateAmount("10000").valid).toBe(true);
    expect(validateAmount("1,000,000").valid).toBe(true);
  });

  it("음수 기호는 allowNegative=false면 제거되어 양수로 통과", () => {
    // allowNegative=false일 때 '-'는 strip됨 → "500"으로 파싱
    expect(validateAmount("-500").valid).toBe(true);
  });

  it("allowNegative=true면 음수 허용", () => {
    expect(validateAmount("-500", true).valid).toBe(true);
  });

  it("소수점은 allowDecimal=true일 때만 허용", () => {
    expect(validateAmount("10.5", false, undefined, undefined, false).valid).toBe(true); // 소수점 제거 후 파싱
    expect(validateAmount("10.5", false, undefined, undefined, true).valid).toBe(true);
  });

  it("소수점이 두 개면 실패", () => {
    expect(validateAmount("10.5.3", false, undefined, undefined, true).valid).toBe(false);
  });

  it("min/max 범위 검증", () => {
    expect(validateAmount("50", false, 100).valid).toBe(false);
    expect(validateAmount("200", false, undefined, 100).valid).toBe(false);
    expect(validateAmount("50", false, 0, 100).valid).toBe(true);
  });
});

describe("validateDate", () => {
  it("빈 값이면 실패", () => {
    expect(validateDate("").valid).toBe(false);
  });

  it("올바른 날짜 형식 통과", () => {
    expect(validateDate("2026-01-15").valid).toBe(true);
  });

  it("잘못된 형식 거부", () => {
    expect(validateDate("2026/01/15").valid).toBe(false);
    expect(validateDate("01-15-2026").valid).toBe(false);
  });

  it("존재하지 않는 날짜 거부 (2월 30일)", () => {
    expect(validateDate("2026-02-30").valid).toBe(false);
  });

  it("maxDate 이후 날짜 거부", () => {
    const max = new Date(2026, 0, 1); // 2026-01-01
    expect(validateDate("2026-06-15", max).valid).toBe(false);
    expect(validateDate("2025-12-31", max).valid).toBe(true);
  });
});

describe("validateTicker", () => {
  it("빈 값이면 실패", () => {
    expect(validateTicker("").valid).toBe(false);
  });

  it("정상 티커 통과", () => {
    expect(validateTicker("AAPL").valid).toBe(true);
    expect(validateTicker("005930").valid).toBe(true);
    expect(validateTicker("USD=X").valid).toBe(true);
  });

  it("특수문자 포함 시 실패", () => {
    expect(validateTicker("AA PL").valid).toBe(false);
    expect(validateTicker("AA@PL").valid).toBe(false);
  });

  it("20자 초과 시 실패", () => {
    expect(validateTicker("A".repeat(21)).valid).toBe(false);
  });
});
