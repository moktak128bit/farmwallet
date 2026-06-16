import { describe, it, expect } from "vitest";
import {
  buildMergeCandidates, buildMergeMapper, countMergeTargets, mergePresets,
  subPairKey, splitSubPairKey,
} from "../utils/categoryMerge";
import type { CategoryPresets, LedgerEntry } from "../types";

const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-04-01",
  kind: "income",
  category: "수입",
  description: "",
  amount: 1000,
  ...o,
} as LedgerEntry);

const presets: CategoryPresets = {
  income: ["급여", "기타수입"],
  expense: ["식비", "유류교통비", "재테크"],
  expenseDetails: [
    { main: "식비", subs: ["카페", "간식"] },
    { main: "유류교통비", subs: ["택시"] },
    { main: "재테크", subs: ["투자손실"] },
  ],
  transfer: ["저축이체", "계좌이체"],
  categoryTypes: { fixed: ["유류교통비"], savings: ["재테크"], transfer: ["저축이체"] },
};

describe("buildMergeMapper / countMergeTargets", () => {
  it("수입: subCategory가 from인 income 항목만 치환 ('기타 수입' → '기타수입')", () => {
    const ledger = [
      entry({ id: "1", subCategory: "기타 수입" }),
      entry({ id: "2", subCategory: "기타수입" }),
      entry({ id: "3", kind: "expense", category: "지출", subCategory: "기타 수입" }), // 지출은 건드리면 안 됨
    ];
    const spec = { kind: "income" as const, from: "기타 수입", to: "기타수입" };
    expect(countMergeTargets(ledger, spec)).toBe(1);
    const next = ledger.map(buildMergeMapper(spec));
    expect(next[0].subCategory).toBe("기타수입");
    expect(next[1].subCategory).toBe("기타수입");
    expect(next[2].subCategory).toBe("기타 수입");
  });

  it("수입: subCategory 없이 category에 분류가 있는 구세대 항목도 치환", () => {
    const ledger = [entry({ id: "1", category: "용돈", subCategory: undefined })];
    const next = ledger.map(buildMergeMapper({ kind: "income", from: "용돈", to: "지원" }));
    expect(next[0].subCategory).toBe("지원");
  });

  it("이체: transfer 항목의 subCategory 치환", () => {
    const ledger = [entry({ id: "1", kind: "transfer", category: "이체", subCategory: "계좌이체" })];
    const next = ledger.map(buildMergeMapper({ kind: "transfer", from: "계좌이체", to: "저축이체" }));
    expect(next[0].subCategory).toBe("저축이체");
  });

  it("지출 대분류: 신세대(subCategory)·구세대(category) 모두 치환, detailCategory 유지", () => {
    const ledger = [
      entry({ id: "1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "간식" }),
      entry({ id: "2", kind: "expense", category: "식비", subCategory: undefined }), // 구세대
    ];
    const spec = { kind: "expenseMain" as const, from: "식비", to: "유류교통비" };
    expect(countMergeTargets(ledger, spec)).toBe(2);
    const next = ledger.map(buildMergeMapper(spec));
    expect(next[0].subCategory).toBe("유류교통비");
    expect(next[0].detailCategory).toBe("간식");
    expect(next[1].category).toBe("유류교통비");
  });

  it("지출 세부: 다른 대분류로 이동 시 대분류 필드도 함께 변경", () => {
    const ledger = [
      entry({ id: "1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "간식" }),
      entry({ id: "2", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "카페" }),
    ];
    const spec = { kind: "expenseSub" as const, from: "간식", to: "택시", fromMain: "식비", toMain: "유류교통비" };
    expect(countMergeTargets(ledger, spec)).toBe(1);
    const next = ledger.map(buildMergeMapper(spec));
    expect(next[0].subCategory).toBe("유류교통비");
    expect(next[0].detailCategory).toBe("택시");
    expect(next[1].detailCategory).toBe("카페"); // 같은 대분류의 다른 세부는 그대로
  });
});

describe("mergePresets", () => {
  it("수입: from 제거 + to 보장", () => {
    const next = mergePresets(presets, { kind: "income", from: "기타수입", to: "급여" });
    expect(next.income).toEqual(["급여"]);
  });

  it("수입: to가 목록에 없으면(고아) 추가됨", () => {
    const next = mergePresets(presets, { kind: "income", from: "기타수입", to: "부수입" });
    expect(next.income).toContain("부수입");
    expect(next.income).not.toContain("기타수입");
  });

  it("수입: from이 salary/passive에 없으면 to를 그 타입에 강제 추가하지 않는다 (수입성격 오염 방지)", () => {
    // '급여'(salary)는 그대로 두고, salary에 없는 '기타수입'→'부수입' 통합 시 '부수입'이 salary로 잘못 등록되면 안 됨
    const p: CategoryPresets = {
      ...presets,
      categoryTypes: { ...presets.categoryTypes, salary: ["급여"], passive: ["배당"], nonRealIncome: ["정산"] },
    };
    const next = mergePresets(p, { kind: "income", from: "기타수입", to: "부수입" });
    expect(next.categoryTypes?.salary).toEqual(["급여"]); // '부수입' 추가 안 됨
    expect(next.categoryTypes?.passive).toEqual(["배당"]);
    expect(next.categoryTypes?.nonRealIncome).toEqual(["정산"]);
  });

  it("수입: from이 salary에 있으면 to로 정상 승계", () => {
    const p: CategoryPresets = {
      ...presets,
      categoryTypes: { ...presets.categoryTypes, salary: ["급여", "기타수입"] },
    };
    const next = mergePresets(p, { kind: "income", from: "기타수입", to: "급여" });
    // 기타수입 제거, 급여 유지 (중복 없음)
    expect(next.categoryTypes?.salary).toEqual(["급여"]);
  });

  it("이체: categoryTypes.transfer 매핑도 정리", () => {
    const next = mergePresets(presets, { kind: "transfer", from: "저축이체", to: "계좌이체" });
    expect(next.transfer).toEqual(["계좌이체"]);
    expect(next.categoryTypes?.transfer).toEqual(["계좌이체"]);
  });

  it("지출 대분류: 그룹 병합(세부 합집합) + 타입 매핑 승계", () => {
    const next = mergePresets(presets, { kind: "expenseMain", from: "유류교통비", to: "식비" });
    const food = next.expenseDetails?.find((g) => g.main === "식비");
    expect(food?.subs.sort()).toEqual(["간식", "카페", "택시"].sort());
    expect(next.expense).not.toContain("유류교통비");
    // 유류교통비의 fixed 지정이 식비로 승계
    expect(next.categoryTypes?.fixed).toContain("식비");
    expect(next.categoryTypes?.fixed).not.toContain("유류교통비");
  });

  it("지출 세부: from 그룹에서 제거, to 그룹에 추가", () => {
    const next = mergePresets(presets, { kind: "expenseSub", from: "간식", to: "택시", fromMain: "식비", toMain: "유류교통비" });
    expect(next.expenseDetails?.find((g) => g.main === "식비")?.subs).toEqual(["카페"]);
    expect(next.expenseDetails?.find((g) => g.main === "유류교통비")?.subs).toEqual(["택시"]);
  });
});

describe("buildMergeCandidates", () => {
  it("프리셋에 없이 데이터에만 있는 고아 카테고리도 후보에 포함 (inPreset=false)", () => {
    const ledger = [
      entry({ id: "1", subCategory: "기타 수입" }),
      entry({ id: "2", subCategory: "기타 수입" }),
      entry({ id: "3", subCategory: "급여" }),
    ];
    const c = buildMergeCandidates("income", presets, ledger);
    const orphan = c.find((x) => x.name === "기타 수입");
    expect(orphan).toBeDefined();
    expect(orphan?.inPreset).toBe(false);
    expect(orphan?.count).toBe(2);
    expect(c.find((x) => x.name === "급여")?.inPreset).toBe(true);
    expect(c.find((x) => x.name === "기타수입")?.count).toBe(0);
  });

  it("지출 세부 후보는 대분류>세부 쌍 단위, 공백 포함 이름도 안전", () => {
    const ledger = [
      entry({ id: "1", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "차량 유지보수" }),
    ];
    const c = buildMergeCandidates("expenseSub", presets, ledger);
    const item = c.find((x) => x.name === "차량 유지보수");
    expect(item?.main).toBe("유류교통비");
    expect(item?.inPreset).toBe(false);
    const key = subPairKey("유류교통비", "차량 유지보수");
    expect(splitSubPairKey(key)).toEqual({ main: "유류교통비", sub: "차량 유지보수" });
  });
});
