import { describe, it, expect } from "vitest";
import { parseDeepLink, hasDeepLinkParams, stripDeepLinkParams } from "../utils/deepLink";

describe("parseDeepLink", () => {
  it("빈 쿼리 → 빈 객체", () => {
    expect(parseDeepLink("")).toEqual({});
    expect(parseDeepLink("?")).toEqual({});
    expect(parseDeepLink("?foo=bar")).toEqual({});
  });

  it("?tab= 화이트리스트 탭만 허용", () => {
    expect(parseDeepLink("?tab=ledger")).toEqual({ tab: "ledger" });
    expect(parseDeepLink("tab=stocks")).toEqual({ tab: "stocks" });
    expect(parseDeepLink("?tab=__proto__")).toEqual({});
    expect(parseDeepLink("?tab=nonexistent")).toEqual({});
    expect(parseDeepLink("?tab=")).toEqual({});
  });

  it("?quick=1/true → quick", () => {
    expect(parseDeepLink("?quick=1")).toEqual({ quick: true });
    expect(parseDeepLink("?quick=true")).toEqual({ quick: true });
    expect(parseDeepLink("?quick=0")).toEqual({});
    expect(parseDeepLink("?quick=1&tab=ledger")).toEqual({ quick: true, tab: "ledger" });
  });

  it("share_target(text/title/url) → sharedText 병합 + quick", () => {
    const r = parseDeepLink("?title=%EC%A0%90%EC%8B%AC&text=12000%EC%9B%90&url=https%3A%2F%2Fexample.com%2Fa");
    expect(r.quick).toBe(true);
    expect(r.sharedText).toBe("점심 12000원 https://example.com/a");
  });

  it("중복/공백 정리, 길이 상한", () => {
    const r = parseDeepLink("?title=%20%20a%20%20b%20&text=a%20b");
    expect(r.sharedText).toBe("a b"); // 공백 정규화 후 동일 → 1회
    const long = "x".repeat(1000);
    expect(parseDeepLink(`?text=${long}`).sharedText?.length).toBe(300);
  });

  it("share 파라미터가 비어 있으면 quick도 설정하지 않는다", () => {
    expect(parseDeepLink("?text=%20%20")).toEqual({});
  });
});

describe("hasDeepLinkParams / stripDeepLinkParams", () => {
  it("딥링크 파라미터 존재 판정", () => {
    expect(hasDeepLinkParams("")).toBe(false);
    expect(hasDeepLinkParams("?x=1")).toBe(false);
    expect(hasDeepLinkParams("?tab=ledger")).toBe(true);
    expect(hasDeepLinkParams("?text=hi")).toBe(true);
    expect(hasDeepLinkParams("?quick=0")).toBe(true); // 값이 무효여도 제거 대상
  });

  it("딥링크 파라미터만 제거하고 다른 쿼리·해시·경로는 보존", () => {
    expect(stripDeepLinkParams("http://localhost/farmwallet/?tab=ledger&quick=1")).toBe("/farmwallet/");
    expect(stripDeepLinkParams("http://localhost/farmwallet/?keep=1&tab=ledger#h")).toBe("/farmwallet/?keep=1#h");
    expect(stripDeepLinkParams("http://localhost/farmwallet/?text=a&title=b&url=c")).toBe("/farmwallet/");
  });
});
