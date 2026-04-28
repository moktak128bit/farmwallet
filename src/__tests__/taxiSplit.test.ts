import { describe, it, expect } from "vitest";
import {
  findTaxiCandidates,
  presetHasTaxi,
  addTaxiToPresets,
  applyTaxiSplit,
  TAXI_RE,
} from "../utils/taxiSplit";
import type { CategoryPresets, LedgerEntry } from "../types";

function exp(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "expense",
    category: "지출",
    subCategory: "유류교통비",
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
      subs: ["대중교통", "유류·충전", "차량 유지보수", "통행·주차", "차량 고정비", "장거리"],
    },
    { main: "식비", subs: ["외식", "장보기"] },
  ],
};

describe("TAXI_RE — 매칭 규칙", () => {
  it("'택시' 부분 일치", () => {
    expect(TAXI_RE.test("택시")).toBe(true);
    expect(TAXI_RE.test("[원래소분류:택시]")).toBe(true);
    expect(TAXI_RE.test("강남 택시")).toBe(true);
  });
  it("앱 이름 (카카오T, 우버, 타다)", () => {
    expect(TAXI_RE.test("카카오T")).toBe(true);
    expect(TAXI_RE.test("Kakao T")).toBe(true);
    expect(TAXI_RE.test("UBER")).toBe(true);
    expect(TAXI_RE.test("타다")).toBe(true);
  });
  it("관계 없는 단어는 false", () => {
    expect(TAXI_RE.test("주차비")).toBe(false);
    expect(TAXI_RE.test("휘발유")).toBe(false);
    expect(TAXI_RE.test("버스")).toBe(false);
  });
});

describe("findTaxiCandidates", () => {
  it("유류교통비 + 택시 description + detailCategory != 택시 → 후보", () => {
    const ledger = [
      exp({ id: "1", amount: 10000, description: "택시", detailCategory: "대중교통" }),
      exp({ id: "2", amount: 20000, description: "[원래소분류:택시]", detailCategory: "유류교통비" }),
      exp({ id: "3", amount: 5000, description: "버스비 충전", detailCategory: "대중교통" }),  // 택시 아님
      exp({ id: "4", amount: 30000, description: "택시", detailCategory: "택시" }),  // 이미 처리됨
      exp({ id: "5", amount: 50000, description: "택시", subCategory: "식비" }),  // 다른 sub
    ];
    const candidates = findTaxiCandidates(ledger);
    expect(candidates.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("멱등: 두 번 호출해도 같은 결과", () => {
    const ledger = [
      exp({ id: "1", amount: 10000, description: "택시", detailCategory: "대중교통" }),
    ];
    expect(findTaxiCandidates(ledger).length).toBe(findTaxiCandidates(ledger).length);
  });

  it("후보 없으면 빈 배열", () => {
    const ledger = [exp({ id: "1", amount: 10000, description: "휘발유", detailCategory: "유류·충전" })];
    expect(findTaxiCandidates(ledger)).toEqual([]);
  });

  it("amount 0 또는 음수는 제외", () => {
    const ledger = [
      exp({ id: "1", amount: 0, description: "택시" }),
      exp({ id: "2", amount: -100, description: "택시" }),
    ];
    expect(findTaxiCandidates(ledger)).toEqual([]);
  });
});

describe("presetHasTaxi", () => {
  it("subs에 택시 없으면 false", () => {
    expect(presetHasTaxi(presets)).toBe(false);
  });

  it("subs에 택시 있으면 true", () => {
    const withTaxi: CategoryPresets = {
      ...presets,
      expenseDetails: [
        { main: "유류교통비", subs: ["대중교통", "택시"] },
      ],
    };
    expect(presetHasTaxi(withTaxi)).toBe(true);
  });

  it("유류교통비 그룹 없으면 false", () => {
    const noGroup: CategoryPresets = { income: [], expense: [], transfer: [] };
    expect(presetHasTaxi(noGroup)).toBe(false);
  });
});

describe("addTaxiToPresets", () => {
  it("'대중교통' 다음에 '택시' 삽입", () => {
    const result = addTaxiToPresets(presets);
    const group = result.expenseDetails!.find((g) => g.main === "유류교통비")!;
    expect(group.subs).toEqual([
      "대중교통",
      "택시",  // ← 추가됨
      "유류·충전",
      "차량 유지보수",
      "통행·주차",
      "차량 고정비",
      "장거리",
    ]);
  });

  it("멱등: 이미 있으면 원본 그대로 (참조 동등)", () => {
    const withTaxi: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["대중교통", "택시"] }],
    };
    const result = addTaxiToPresets(withTaxi);
    expect(result).toBe(withTaxi);  // 참조 동등
  });

  it("'대중교통' 없으면 맨 뒤에 추가", () => {
    const noTransit: CategoryPresets = {
      ...presets,
      expenseDetails: [{ main: "유류교통비", subs: ["유류·충전"] }],
    };
    const result = addTaxiToPresets(noTransit);
    const group = result.expenseDetails!.find((g) => g.main === "유류교통비")!;
    expect(group.subs).toEqual(["유류·충전", "택시"]);
  });

  it("유류교통비 그룹 자체가 없으면 원본 그대로 (마법사 책임 아님)", () => {
    const noGroup: CategoryPresets = { income: [], expense: [], transfer: [], expenseDetails: [] };
    expect(addTaxiToPresets(noGroup)).toBe(noGroup);
  });

  it("expenseDetails undefined면 원본 그대로", () => {
    const noDetails: CategoryPresets = { income: [], expense: [], transfer: [] };
    expect(addTaxiToPresets(noDetails)).toBe(noDetails);
  });

  it("다른 그룹은 영향 없음", () => {
    const result = addTaxiToPresets(presets);
    const food = result.expenseDetails!.find((g) => g.main === "식비")!;
    expect(food.subs).toEqual(["외식", "장보기"]);
  });
});

describe("applyTaxiSplit", () => {
  const ledger = [
    exp({ id: "1", amount: 10000, description: "택시", detailCategory: "대중교통" }),
    exp({ id: "2", amount: 20000, description: "택시", detailCategory: "유류교통비" }),
    exp({ id: "3", amount: 5000, description: "버스", detailCategory: "대중교통" }),
  ];

  it("선택된 id의 detailCategory를 택시로 변경", () => {
    const result = applyTaxiSplit(ledger, new Set(["1", "2"]));
    expect(result.find((l) => l.id === "1")?.detailCategory).toBe("택시");
    expect(result.find((l) => l.id === "2")?.detailCategory).toBe("택시");
    expect(result.find((l) => l.id === "3")?.detailCategory).toBe("대중교통");  // 변경 안 됨
  });

  it("이미 택시인 항목은 새 객체 안 만듦 (참조 동등)", () => {
    const taxiLedger = [exp({ id: "1", amount: 10000, description: "택시", detailCategory: "택시" })];
    const result = applyTaxiSplit(taxiLedger, new Set(["1"]));
    expect(result[0]).toBe(taxiLedger[0]);
  });

  it("빈 ids → 원본 그대로 반환", () => {
    const result = applyTaxiSplit(ledger, new Set());
    expect(result).toBe(ledger);
  });

  it("선택된 id가 ledger에 없으면 무변경", () => {
    const result = applyTaxiSplit(ledger, new Set(["nonexistent"]));
    expect(result.every((l, i) => l === ledger[i])).toBe(true);
  });
});
