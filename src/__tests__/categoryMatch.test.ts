/**
 * 배당·이자 분류 단일소스(categoryMatch) 회귀 테스트.
 * - 정확 매칭(isDividendEntry/isInterestEntry): "비배당" 등 위양성 차단
 * - 느슨한 매칭(isDividendEntryLoose/isInterestEntryLoose): 앱 생성 배당 본문(description) fallback 허용
 * 여러 화면이 복붙하던 술어를 이 단일소스로 통일했으므로 동작을 고정한다.
 */
import { describe, it, expect } from "vitest";
import {
  isDividendEntry,
  isInterestEntry,
  isDividendEntryLoose,
  isInterestEntryLoose,
  isInterestOverDividend,
} from "../utils/categoryMatch";

describe("isDividendEntry / isInterestEntry — 정확 매칭", () => {
  it("category/subCategory가 정확히 '배당'/'이자' 또는 '-배당'/'-이자' 접미사", () => {
    expect(isDividendEntry({ category: "배당" })).toBe(true);
    expect(isDividendEntry({ subCategory: "배당" })).toBe(true);
    expect(isDividendEntry({ category: "수입-배당" })).toBe(true);
    expect(isInterestEntry({ subCategory: "이자" })).toBe(true);
    expect(isInterestEntry({ category: "수입-이자" })).toBe(true);
  });

  it("위양성 차단: '비배당주식'·'배당락' 등 substring은 매칭 안 됨", () => {
    expect(isDividendEntry({ category: "비배당주식" })).toBe(false);
    expect(isDividendEntry({ subCategory: "배당락일" })).toBe(false);
    expect(isInterestEntry({ category: "이자비용환급" })).toBe(false);
  });

  it("정확 매칭은 description을 보지 않음", () => {
    // isDividendEntry는 category/subCategory만 본다 — description의 "배당"은 무시
    expect(isDividendEntry({ category: "수입", subCategory: "급여" })).toBe(false);
    // loose는 description fallback으로 true가 되어 둘의 차이를 드러냄
    expect(isDividendEntryLoose({ category: "수입", subCategory: "급여", description: "AAPL - Apple 배당" })).toBe(true);
  });
});

describe("isDividendEntryLoose / isInterestEntryLoose — description fallback", () => {
  it("정확 매칭이거나 description에 '배당'/'이자' 포함이면 true", () => {
    expect(isDividendEntryLoose({ category: "배당" })).toBe(true);
    expect(isDividendEntryLoose({ category: "수입", description: "458730 - TIGER 미국배당다우존스 배당" })).toBe(true);
    expect(isInterestEntryLoose({ description: "OK저축은행 이자" })).toBe(true);
  });

  it("정확 매칭도 아니고 description에도 없으면 false", () => {
    expect(isDividendEntryLoose({ category: "수입", subCategory: "급여", description: "월급" })).toBe(false);
    expect(isInterestEntryLoose({ category: "지출", description: "식비" })).toBe(false);
  });
});

describe("isInterestOverDividend — 배당·이자 동시 매칭 시 이자 우선 (화면·내보내기 공용)", () => {
  it("정확 이자는 description에 '배당'이 있어도 이자", () => {
    expect(isInterestOverDividend({ category: "수입", subCategory: "이자", description: "이자 - OK저축은행 배당" })).toBe(true);
  });

  it("loose 이자는 loose 배당이 아닐 때만 이자", () => {
    // description에 '이자'만 → 이자
    expect(isInterestOverDividend({ category: "수입", description: "CMA 이자" })).toBe(true);
    // description에 '배당'도 포함 + 정확 이자 아님 → 배당 우선
    expect(isInterestOverDividend({ category: "수입", description: "배당형 상품 이자" })).toBe(false);
  });

  it("배당 항목은 이자가 아니다", () => {
    expect(isInterestOverDividend({ category: "수입", subCategory: "배당", description: "458730 - TIGER 배당" })).toBe(false);
  });
});
