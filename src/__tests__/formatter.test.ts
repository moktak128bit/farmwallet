import { describe, it, expect, afterEach } from "vitest";
import { formatNumber, formatKRW, formatKrwCompact, formatUSD, formatShortDate, formatDecimal, setAmountMask, isAmountMasked } from "../utils/formatter";

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

describe("프라이버시 블러 — setAmountMask", () => {
  afterEach(() => {
    // 다른 테스트 파일에 누수되지 않도록 항상 off로 복귀
    setAmountMask(false);
  });

  it("기본값은 off", () => {
    expect(isAmountMasked()).toBe(false);
  });

  it("on이면 formatNumber가 숫자 부분을 가린다", () => {
    setAmountMask(true);
    expect(formatNumber(1234567)).toBe("••••");
    expect(formatNumber(0)).toBe("••••");
  });

  it("on이면 formatKRW가 부호·단위는 유지하고 숫자만 가린다", () => {
    setAmountMask(true);
    expect(formatKRW(50000)).toBe("•••• 원");
  });

  it("on이면 formatUSD가 통화기호·부호는 유지하고 숫자만 가린다", () => {
    setAmountMask(true);
    expect(formatUSD(123.4567)).toBe("$••••");
    expect(formatUSD(-5.5)).toBe("-$••••");
  });

  it("on이면 formatDecimal도 마스킹된다", () => {
    setAmountMask(true);
    expect(formatDecimal(1.2345, 4)).toBe("••••");
  });

  it("off로 되돌리면 정상 표기로 복귀", () => {
    setAmountMask(true);
    setAmountMask(false);
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatKRW(50000)).toBe("50,000 원");
    expect(formatUSD(123.4567)).toBe("$123.457");
  });
});

describe("formatDecimal", () => {
  it("소수점 자리수를 제한해 표기", () => {
    expect(formatDecimal(1.23456, 4)).toBe("1.2346");
    expect(formatDecimal(3, 2)).toBe("3");
  });

  it("null/undefined/NaN은 '0' 반환", () => {
    expect(formatDecimal(null)).toBe("0");
    expect(formatDecimal(undefined)).toBe("0");
    expect(formatDecimal(NaN)).toBe("0");
  });
});

describe("formatKrwCompact — 히어로 숫자용 만·억 단위 (원 단위 없이 숫자만)", () => {
  afterEach(() => setAmountMask(false));

  it("1만 미만은 원 단위 그대로", () => {
    expect(formatKrwCompact(3)).toBe("3");
    expect(formatKrwCompact(9999)).toBe("9,999");
    expect(formatKrwCompact(0)).toBe("0");
  });

  it("1만~100만 미만은 소수 1자리 만 (.0은 생략)", () => {
    expect(formatKrwCompact(15400)).toBe("1.5만");
    expect(formatKrwCompact(900000)).toBe("90만");
    expect(formatKrwCompact(10000)).toBe("1만");
  });

  it("100만~1억 미만은 정수 만 (천 단위 쉼표)", () => {
    expect(formatKrwCompact(1197213)).toBe("120만");
    expect(formatKrwCompact(39634949)).toBe("3,963만");
    expect(formatKrwCompact(65022180)).toBe("6,502만");
  });

  it("1억 이상은 억 + 만 (만이 0이면 억만)", () => {
    expect(formatKrwCompact(150000000)).toBe("1억 5,000만");
    expect(formatKrwCompact(100000000)).toBe("1억");
    expect(formatKrwCompact(123456789)).toBe("1억 2,346만");
  });

  it("음수는 앞에 - 하나, 반올림으로 자리가 올라가도 표기가 맞다", () => {
    expect(formatKrwCompact(-2706808)).toBe("-271만");
    expect(formatKrwCompact(999999)).toBe("100만");
    expect(formatKrwCompact(99999999)).toBe("1억");
  });

  it("마스킹 중이면 점으로 가린다", () => {
    setAmountMask(true);
    expect(formatKrwCompact(39634949)).toBe("••••");
  });

  it("NaN/비수치는 0", () => {
    expect(formatKrwCompact(NaN)).toBe("0");
  });
});
