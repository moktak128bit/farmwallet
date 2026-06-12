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

  it("-0으로 반올림되는 값은 '0' (음수 부호 없는 표기)", () => {
    expect(formatNumber(-0.4)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(0)).toBe("0");
  });

  it("음수는 정상 표기", () => {
    expect(formatNumber(-1234.6)).toBe("-1,235");
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

  it("음수는 '-$' 접두 형태 (부호가 $ 앞)", () => {
    expect(formatUSD(-5.5)).toBe("-$5.500");
    expect(formatUSD(-1234.5678)).toBe("-$1,234.568");
  });
});

describe("formatShortDate", () => {
  it("YYYY-MM-DD → YY.MM.DD 변환", () => {
    expect(formatShortDate("2026-04-07")).toBe("26.04.07");
  });

  it("빈 문자열이면 빈 문자열 반환", () => {
    expect(formatShortDate("")).toBe("");
  });

  it("로컬 파싱 기반 — 타임존과 무관하게 입력 날짜 그대로", () => {
    // UTC 파싱이었다면 음수 타임존에서 하루 밀렸을 케이스
    expect(formatShortDate("2026-01-01")).toBe("26.01.01");
    expect(formatShortDate("2026-12-31")).toBe("26.12.31");
  });

  it("ISO 타임스탬프는 날짜 부분만 사용", () => {
    expect(formatShortDate("2026-04-07T15:30:00")).toBe("26.04.07");
  });
});
