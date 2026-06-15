import { describe, it, expect } from "vitest";
import { parseEtfItemList, filterDiscountedEtfs } from "../utils/etfDiscount";

const sample = {
  result: {
    etfItemList: [
      { itemcode: "069500", itemname: "KODEX 200", nowVal: 35000, nav: 35500, changeRate: -0.5, quant: 500000 }, // -1.41% 저평가
      { itemcode: "102110", itemname: "TIGER 200", nowVal: 36000, nav: 35800, changeRate: 0.3, quant: 200000 },  // +0.56% 프리미엄
      { itemcode: "000001", itemname: "BROKEN", nowVal: 0, nav: 100, changeRate: 0, quant: 0 },                  // price 0 → 제외
      { itemcode: "000002", itemname: "NONAV", nowVal: 100, nav: 0, changeRate: 0, quant: 0 },                   // nav 0 → 제외
      { itemcode: "000003", itemname: "DISCOUNT2", nowVal: 9700, nav: 10000, changeRate: -1, quant: 5000 },      // -3% 저평가, 저거래량
    ],
  },
};

describe("parseEtfItemList", () => {
  it("유효 항목만 남기고 괴리율을 계산해 오름차순(저평가 먼저) 정렬", () => {
    const rows = parseEtfItemList(sample);
    expect(rows.map((r) => r.code)).toEqual(["000003", "069500", "102110"]);
    expect(rows[0].gapPct).toBeCloseTo(-3, 5);
    expect(rows[1].gapPct).toBeCloseTo(((35000 - 35500) / 35500) * 100, 5);
    expect(rows[2].gapPct).toBeGreaterThan(0); // 프리미엄
  });

  it("price·nav가 0/무효인 항목은 제외", () => {
    const rows = parseEtfItemList(sample);
    expect(rows.find((r) => r.code === "000001")).toBeUndefined();
    expect(rows.find((r) => r.code === "000002")).toBeUndefined();
  });

  it("쉼표 섞인 문자열 숫자도 파싱", () => {
    const rows = parseEtfItemList({ result: { etfItemList: [{ itemcode: "1", itemname: "A", nowVal: "9,900", nav: "10,000", quant: "1,000" }] } });
    expect(rows[0].gapPct).toBeCloseTo(-1, 5);
    expect(rows[0].volume).toBe(1000);
  });

  it("형식 이상 입력 → 빈 배열 (방어적)", () => {
    expect(parseEtfItemList(null)).toEqual([]);
    expect(parseEtfItemList({})).toEqual([]);
    expect(parseEtfItemList({ result: {} })).toEqual([]);
    expect(parseEtfItemList({ result: { etfItemList: "nope" } })).toEqual([]);
  });
});

describe("filterDiscountedEtfs", () => {
  const rows = parseEtfItemList(sample);

  it("기본: 괴리율 ≤ 0 (할인)만", () => {
    expect(filterDiscountedEtfs(rows).map((r) => r.code)).toEqual(["000003", "069500"]);
  });

  it("minVolume 거래량 필터", () => {
    expect(filterDiscountedEtfs(rows, { minVolume: 100_000 }).map((r) => r.code)).toEqual(["069500"]);
  });

  it("maxGapPct로 더 깊은 할인만", () => {
    expect(filterDiscountedEtfs(rows, { maxGapPct: -2 }).map((r) => r.code)).toEqual(["000003"]);
  });
});
