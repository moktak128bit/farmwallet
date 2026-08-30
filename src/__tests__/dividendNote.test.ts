import { describe, it, expect } from "vitest";
import { parseQuantityFromNote, parseExDateFromNote, buildDividendNote } from "../utils/dividend";

describe("parseQuantityFromNote", () => {
  it("기본 형식을 읽는다", () => {
    expect(parseQuantityFromNote("보유주식: 254")).toBe(254);
    expect(parseQuantityFromNote("보유주식:254\n배당락일:2026-03-31")).toBe(254);
  });

  it("회귀: 콤마가 든 수량을 잘라 읽지 않는다", () => {
    // 입력 킷이 "1,000"으로 포맷한 값이 note에 남을 수 있다. \d+ 만 보면 1로 읽혔다.
    expect(parseQuantityFromNote("보유주식: 1,000")).toBe(1000);
    expect(parseQuantityFromNote("보유주식: 12,345")).toBe(12345);
  });

  it("소수 수량(미국주식 소수점 매수)도 읽는다", () => {
    expect(parseQuantityFromNote("보유주식: 10.5")).toBe(10.5);
  });

  it("없거나 형식이 다르면 null", () => {
    expect(parseQuantityFromNote(undefined)).toBeNull();
    expect(parseQuantityFromNote("배당락일:2026-03-31")).toBeNull();
  });
});

describe("배당 note 생성/파싱 왕복", () => {
  it("buildDividendNote가 만든 note를 그대로 되읽는다", () => {
    const note = buildDividendNote(1000, "2026-03-31");
    expect(note).toBeDefined();
    expect(parseQuantityFromNote(note)).toBe(1000);
    expect(parseExDateFromNote(note)).toBe("2026-03-31");
  });
});
