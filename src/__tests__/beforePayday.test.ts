import { describe, it, expect } from "vitest";
import { isBeforePayday } from "../features/dashboard/summaryMath";

describe("isBeforePayday — 급여 전 판정 (대시보드·전월 대비·인사이트 공용)", () => {
  it("이번 달 0원이고 과거 수입이 있으면 급여 전", () => {
    expect(isBeforePayday(0, 3_000_000, true)).toBe(true);
  });
  it("1원 인증송금 같은 푼돈(전월의 5% 미만)도 급여 전", () => {
    expect(isBeforePayday(3, 3_000_000, true)).toBe(true);
    expect(isBeforePayday(149_999, 3_000_000, true)).toBe(true);
  });
  it("전월의 5% 이상이면 급여가 들어온 것", () => {
    expect(isBeforePayday(150_000, 3_000_000, true)).toBe(false);
    expect(isBeforePayday(3_000_000, 3_000_000, true)).toBe(false);
  });
  it("전월 급여가 0이면(첫 달 등) 0원일 때만 급여 전", () => {
    expect(isBeforePayday(0, 0, true)).toBe(true);
    expect(isBeforePayday(3, 0, true)).toBe(false);
  });
  it("수입 이력이 아예 없으면 급여 전이 아니다(신규 사용자)", () => {
    expect(isBeforePayday(0, 0, false)).toBe(false);
  });
});
