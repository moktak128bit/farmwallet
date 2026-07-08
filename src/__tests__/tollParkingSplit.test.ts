import { describe, it, expect } from "vitest";
import {
  classifyTollParking,
  findTollParkingCandidates,
  countUnsplitSource,
  presetHasTollParking,
  applyTollParkingToPresets,
  applyTollParkingSplit,
  TOLL,
  PARKING,
  type TPTarget,
} from "../utils/tollParkingSplit";
import type { CategoryPresets, LedgerEntry } from "../types";

function exp(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "expense",
    category: "지출",
    subCategory: "유류교통비",
    detailCategory: "통행·주차",
    description: "",
    ...o,
  } as LedgerEntry;
}

const presets: CategoryPresets = {
  income: [],
  expense: ["유류교통비"],
  transfer: [],
  expenseDetails: [
    {
      main: "유류교통비",
      subs: ["대중교통", "택시", "유류·충전", "차량 유지보수", "통행·주차", "차량 고정비", "장거리"],
    },
    { main: "식비", subs: ["외식", "장보기"] },
  ],
};

describe("classifyTollParking — description 판정", () => {
  it("주차 → 주차비", () => {
    expect(classifyTollParking("주차비")).toBe(PARKING);
    expect(classifyTollParking("공영주차장")).toBe(PARKING);
    expect(classifyTollParking("공항 주차비")).toBe(PARKING);
    expect(classifyTollParking("[원래소분류:주차비]")).toBe(PARKING);
  });
  it("톨·하이패스·통행 → 톨비", () => {
    expect(classifyTollParking("톨비")).toBe(TOLL);
    expect(classifyTollParking("하이패스 충전")).toBe(TOLL);
    expect(classifyTollParking("통행료")).toBe(TOLL);
    expect(classifyTollParking("[원래소분류:톨비/하이패스]")).toBe(TOLL);
  });
  it("어느 쪽도 아니면 null (보류)", () => {
    expect(classifyTollParking("휘발유")).toBeNull();
    expect(classifyTollParking("")).toBeNull();
    expect(classifyTollParking(undefined)).toBeNull();
  });
});

describe("findTollParkingCandidates", () => {
  it("유류교통비 + 통행·주차 + 분류 가능한 description만 후보(target 포함)", () => {
    const ledger = [
      exp({ id: "1", amount: 5000, description: "톨비" }),
      exp({ id: "2", amount: 3000, description: "건대 주차비" }),
      exp({ id: "3", amount: 60000, description: "휘발유" }), // 분류 불가 → 제외
      exp({ id: "4", amount: 4000, description: "주차비", detailCategory: "주차비" }), // 이미 분리됨 → 제외
      exp({ id: "5", amount: 7000, description: "톨비", subCategory: "식비" }), // 다른 sub → 제외
    ];
    const candidates = findTollParkingCandidates(ledger);
    expect(candidates.map((c) => c.entry.id).sort()).toEqual(["1", "2"]);
    const byId = new Map(candidates.map((c) => [c.entry.id, c.target]));
    expect(byId.get("1")).toBe(TOLL);
    expect(byId.get("2")).toBe(PARKING);
  });

  it("amount 0 또는 음수는 제외", () => {
    const ledger = [
      exp({ id: "1", amount: 0, description: "톨비" }),
      exp({ id: "2", amount: -100, description: "주차비" }),
    ];
    expect(findTollParkingCandidates(ledger)).toEqual([]);
  });
});

describe("countUnsplitSource", () => {
  it("통행·주차로 남아있는 항목 수(분류 가능 여부 무관)", () => {
    const ledger = [
      exp({ id: "1", amount: 5000, description: "톨비" }),
      exp({ id: "2", amount: 60000, description: "휘발유" }),
      exp({ id: "3", amount: 4000, description: "주차비", detailCategory: "주차비" }), // 이미 분리
    ];
    expect(countUnsplitSource(ledger)).toBe(2);
  });
});

describe("presetHasTollParking", () => {
  it("톨비·주차비 둘 다 있어야 true", () => {
    expect(presetHasTollParking(presets)).toBe(false);
    const both: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["톨비", "주차비"] }],
    };
    expect(presetHasTollParking(both)).toBe(true);
    const onlyOne: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["톨비"] }],
    };
    expect(presetHasTollParking(onlyOne)).toBe(false);
  });
  it("유류교통비 그룹 없으면 false", () => {
    expect(presetHasTollParking({ income: [], expense: [], transfer: [] })).toBe(false);
  });
});

describe("applyTollParkingToPresets", () => {
  it("removeSource=false: '통행·주차' 다음에 톨비·주차비 삽입(소스 유지)", () => {
    const result = applyTollParkingToPresets(presets, false);
    const group = result.expenseDetails!.find((g) => g.main === "유류교통비")!;
    expect(group.subs).toEqual([
      "대중교통", "택시", "유류·충전", "차량 유지보수",
      "통행·주차", "톨비", "주차비", // ← 소스 다음에 추가, 소스 유지
      "차량 고정비", "장거리",
    ]);
  });

  it("removeSource=true: 톨비·주차비로 치환하고 '통행·주차' 제거", () => {
    const result = applyTollParkingToPresets(presets, true);
    const group = result.expenseDetails!.find((g) => g.main === "유류교통비")!;
    expect(group.subs).toEqual([
      "대중교통", "택시", "유류·충전", "차량 유지보수",
      "톨비", "주차비", // ← 소스 자리를 대체
      "차량 고정비", "장거리",
    ]);
    expect(group.subs).not.toContain("통행·주차");
  });

  it("멱등: 이미 톨비·주차비 있고 소스 없으면 원본 그대로(참조 동등)", () => {
    const done: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["대중교통", "톨비", "주차비"] }],
    };
    expect(applyTollParkingToPresets(done, true)).toBe(done);
  });

  it("한쪽만 있으면 나머지만 추가(중복 안 만듦)", () => {
    const onlyToll: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["통행·주차", "톨비"] }],
    };
    const result = applyTollParkingToPresets(onlyToll, false);
    const group = result.expenseDetails!.find((g) => g.main === "유류교통비")!;
    expect(group.subs).toEqual(["통행·주차", "주차비", "톨비"]);
  });

  it("유류교통비 그룹 없으면 원본 그대로", () => {
    const noGroup: CategoryPresets = { income: [], expense: [], transfer: [], expenseDetails: [] };
    expect(applyTollParkingToPresets(noGroup, true)).toBe(noGroup);
  });

  it("다른 그룹은 영향 없음", () => {
    const result = applyTollParkingToPresets(presets, true);
    const food = result.expenseDetails!.find((g) => g.main === "식비")!;
    expect(food.subs).toEqual(["외식", "장보기"]);
  });
});

describe("applyTollParkingSplit", () => {
  const ledger = [
    exp({ id: "1", amount: 5000, description: "톨비" }),
    exp({ id: "2", amount: 3000, description: "주차비" }),
    exp({ id: "3", amount: 60000, description: "휘발유" }),
  ];

  it("id→target 매핑대로 detailCategory 변경", () => {
    const map = new Map<string, TPTarget>([["1", TOLL], ["2", PARKING]]);
    const result = applyTollParkingSplit(ledger, map);
    expect(result.find((l) => l.id === "1")?.detailCategory).toBe("톨비");
    expect(result.find((l) => l.id === "2")?.detailCategory).toBe("주차비");
    expect(result.find((l) => l.id === "3")?.detailCategory).toBe("통행·주차"); // 미선택 → 유지
  });

  it("빈 맵 → 원본 그대로(참조 동등)", () => {
    expect(applyTollParkingSplit(ledger, new Map())).toBe(ledger);
  });

  it("이미 목표 분류면 새 객체 안 만듦(참조 동등)", () => {
    const already = [exp({ id: "1", amount: 5000, description: "주차비", detailCategory: "주차비" })];
    const result = applyTollParkingSplit(already, new Map([["1", PARKING]]));
    expect(result[0]).toBe(already[0]);
  });
});
