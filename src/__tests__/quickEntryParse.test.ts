/**
 * 빠른 입력(QuickEntryModal) 파서 단위 테스트.
 * 금액 토큰 규칙: "원"이 붙은 토큰 우선, 없으면 마지막 숫자 토큰.
 * ("GS25 떡볶이 3000"에서 첫 숫자 25를 금액으로 오인하던 버그 회귀 방지)
 */
import { describe, it, expect } from "vitest";
import { parseQuickInput } from "../components/QuickEntryModal";

describe("parseQuickInput — 금액 토큰", () => {
  it("설명에 숫자가 섞여도 마지막 숫자 토큰을 금액으로 사용", () => {
    const r = parseQuickInput("GS25 떡볶이 3000");
    expect(r.amount).toBe(3000);
    expect(r.description).toBe("GS25 떡볶이");
    expect(r.kind).toBe("expense");
  });

  it("'원'이 붙은 토큰이 있으면 위치와 무관하게 우선", () => {
    const r = parseQuickInput("3000원 GS25 떡볶이");
    expect(r.amount).toBe(3000);
    expect(r.description).toBe("GS25 떡볶이");
  });

  it("기본 형태: 설명 + 금액", () => {
    const r = parseQuickInput("스타벅스 5500");
    expect(r.amount).toBe(5500);
    expect(r.description).toBe("스타벅스");
  });

  it("콤마 금액 파싱", () => {
    const r = parseQuickInput("월세 500,000");
    expect(r.amount).toBe(500000);
    expect(r.description).toBe("월세");
  });

  it("숫자가 없으면 금액 0", () => {
    const r = parseQuickInput("점심");
    expect(r.amount).toBe(0);
    expect(r.description).toBe("점심");
  });
});

describe("parseQuickInput — kind 접두어", () => {
  it("'수입' 접두어", () => {
    const r = parseQuickInput("수입 월급 3000000");
    expect(r.kind).toBe("income");
    expect(r.amount).toBe(3000000);
    expect(r.description).toBe("월급");
  });

  it("'이체' 접두어", () => {
    const r = parseQuickInput("이체 저축 100000");
    expect(r.kind).toBe("transfer");
    expect(r.amount).toBe(100000);
    expect(r.description).toBe("저축");
  });

  it("접두어 없으면 지출", () => {
    expect(parseQuickInput("커피 4500").kind).toBe("expense");
  });
});
