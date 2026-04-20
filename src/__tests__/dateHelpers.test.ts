import { describe, it, expect } from "vitest";
import {
  getLastDayOfMonth,
  parseIsoLocal,
  formatIsoLocal,
  addDaysToIso,
  shiftMonth,
  getMonthEndDate,
  buildMonthRange,
} from "../utils/date";

describe("getLastDayOfMonth", () => {
  it("2월: 평년/윤년", () => {
    expect(getLastDayOfMonth(2026, 2)).toBe(28);
    expect(getLastDayOfMonth(2024, 2)).toBe(29);
  });
  it("4월=30, 1월=31", () => {
    expect(getLastDayOfMonth(2026, 4)).toBe(30);
    expect(getLastDayOfMonth(2026, 1)).toBe(31);
  });
});

describe("parseIsoLocal / formatIsoLocal", () => {
  it("round-trip", () => {
    const d = parseIsoLocal("2026-04-20");
    expect(d).not.toBeNull();
    expect(formatIsoLocal(d!)).toBe("2026-04-20");
  });
  it("빈 문자열 → null", () => {
    expect(parseIsoLocal("")).toBeNull();
  });
  it("부분 문자열 → null", () => {
    expect(parseIsoLocal("2026-04")).toBeNull();
  });
});

describe("addDaysToIso", () => {
  it("+1일", () => expect(addDaysToIso("2026-04-20", 1)).toBe("2026-04-21"));
  it("월 경계 넘어", () => expect(addDaysToIso("2026-04-30", 1)).toBe("2026-05-01"));
  it("연 경계 넘어", () => expect(addDaysToIso("2026-12-31", 1)).toBe("2027-01-01"));
  it("음수", () => expect(addDaysToIso("2026-05-01", -1)).toBe("2026-04-30"));
  it("잘못된 입력은 원본", () => expect(addDaysToIso("", 1)).toBe(""));
});

describe("shiftMonth", () => {
  it("+1", () => expect(shiftMonth("2026-04", 1)).toBe("2026-05"));
  it("-1, 연 넘어", () => expect(shiftMonth("2026-01", -1)).toBe("2025-12"));
  it("+12", () => expect(shiftMonth("2026-04", 12)).toBe("2027-04"));
});

describe("getMonthEndDate", () => {
  it("2026-04 → 2026-04-30", () => expect(getMonthEndDate("2026-04")).toBe("2026-04-30"));
  it("2026-02 → 2026-02-28", () => expect(getMonthEndDate("2026-02")).toBe("2026-02-28"));
  it("2024-02 → 2024-02-29 (윤년)", () => expect(getMonthEndDate("2024-02")).toBe("2024-02-29"));
});

describe("buildMonthRange", () => {
  it("동일 월은 1개", () => {
    expect(buildMonthRange("2026-04", "2026-04")).toEqual(["2026-04"]);
  });
  it("같은 해 3개월", () => {
    expect(buildMonthRange("2026-04", "2026-06")).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
  it("연 넘어가는 범위", () => {
    expect(buildMonthRange("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});
