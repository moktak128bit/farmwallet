import { describe, it, expect } from "vitest";
import {
  computeRealIncome,
  computeOriginalAssets,
  classifyIncomeNature,
  NON_REAL_INCOME,
} from "../utils/realIncome";
import type { Account, LedgerEntry } from "../types";

function inc(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "income",
    category: "기타",
    description: "",
    ...o,
  } as LedgerEntry;
}

describe("computeRealIncome", () => {
  it("순수 근로소득만 있으면 realIncome = pIncome", () => {
    const fInc = [inc({ id: "1", amount: 1_000_000, subCategory: "급여" })];
    const r = computeRealIncome(fInc, 1_000_000);
    expect(r.realIncome).toBe(1_000_000);
    expect(r.settlementTotal).toBe(0);
    expect(r.tempIncomeTotal).toBe(0);
  });

  it("정산은 settlementTotal로 빠지고 realIncome에서 제외", () => {
    const fInc = [
      inc({ id: "1", amount: 1_000_000, subCategory: "급여" }),
      inc({ id: "2", amount: 50_000, subCategory: "정산" }),
    ];
    const r = computeRealIncome(fInc, 1_050_000);
    expect(r.settlementTotal).toBe(50_000);
    expect(r.realIncome).toBe(1_000_000);
  });

  it("정산은 부분일치 — '데이트정산' 도 정산으로 처리", () => {
    const fInc = [
      inc({ id: "1", amount: 30_000, subCategory: "데이트정산" }),
      inc({ id: "2", amount: 20_000, subCategory: "정산하기" }),
    ];
    const r = computeRealIncome(fInc, 50_000);
    expect(r.settlementTotal).toBe(50_000);
    expect(r.realIncome).toBe(0);
  });

  it("일시소득(용돈/지원/대출/처분소득)은 tempIncomeTotal로 빠짐", () => {
    const fInc = [
      inc({ id: "1", amount: 100_000, subCategory: "용돈" }),
      inc({ id: "2", amount: 200_000, subCategory: "지원" }),
      inc({ id: "3", amount: 1_000_000, subCategory: "대출" }),
      inc({ id: "4", amount: 50_000, subCategory: "처분소득" }),
    ];
    const r = computeRealIncome(fInc, 1_350_000);
    expect(r.tempIncomeTotal).toBe(1_350_000);
    expect(r.realIncome).toBe(0);
  });

  it("정산과 일시소득 동시 발생 시 각각 분리 집계", () => {
    const fInc = [
      inc({ id: "1", amount: 2_000_000, subCategory: "급여" }),
      inc({ id: "2", amount: 100_000, subCategory: "정산" }),
      inc({ id: "3", amount: 50_000, subCategory: "용돈" }),
    ];
    const r = computeRealIncome(fInc, 2_150_000);
    expect(r.settlementTotal).toBe(100_000);
    expect(r.tempIncomeTotal).toBe(50_000);
    expect(r.realIncome).toBe(2_000_000);
  });

  it("subCategory 없으면 category 사용", () => {
    const fInc = [inc({ id: "1", amount: 50_000, category: "용돈", subCategory: undefined })];
    const r = computeRealIncome(fInc, 50_000);
    expect(r.tempIncomeTotal).toBe(50_000);
  });

  it("subCategory가 '정산'이면 category는 무시 — subCategory 우선", () => {
    const fInc = [inc({ id: "1", amount: 10_000, category: "급여", subCategory: "정산" })];
    const r = computeRealIncome(fInc, 10_000);
    expect(r.settlementTotal).toBe(10_000);
    expect(r.realIncome).toBe(0);
  });

  it("정확히 NON_REAL_INCOME에 속하지 않는 것은 실질 수입으로 인정 (예: '캐시백')", () => {
    const fInc = [inc({ id: "1", amount: 5_000, subCategory: "캐시백" })];
    const r = computeRealIncome(fInc, 5_000);
    expect(r.realIncome).toBe(5_000);
    expect(r.tempIncomeTotal).toBe(0);
  });

  it("부분일치는 정산·환불만 적용 — '대출이자'는 NON_REAL_INCOME 아님 (정확 일치 아니라서)", () => {
    const fInc = [inc({ id: "1", amount: 100_000, subCategory: "대출이자" })];
    const r = computeRealIncome(fInc, 100_000);
    expect(r.tempIncomeTotal).toBe(0);
    expect(r.realIncome).toBe(100_000);
  });

  it("환불은 부분일치로 일시소득 처리 — 이중 결제 환급은 번 돈이 아님", () => {
    const fInc = [
      inc({ id: "1", amount: 2_653_394, subCategory: "환불" }),
      inc({ id: "2", amount: 259_500, subCategory: "공모주 환불" }),
    ];
    const r = computeRealIncome(fInc, 2_912_894);
    expect(r.tempIncomeTotal).toBe(2_912_894);
    expect(r.realIncome).toBe(0);
  });

  it("데이트통장 입금은 정산성 — 상대 분담금이라 실질 수입에서 제외", () => {
    const fInc = [
      inc({ id: "1", amount: 1_000_000, subCategory: "급여" }),
      inc({ id: "2", amount: 300_000, subCategory: "데이트통장" }),
    ];
    const r = computeRealIncome(fInc, 1_300_000);
    expect(r.settlementTotal).toBe(300_000);
    expect(r.realIncome).toBe(1_000_000);
  });

  it("빈 배열·pIncome 0이면 모두 0", () => {
    const r = computeRealIncome([], 0);
    expect(r).toEqual({ settlementTotal: 0, tempIncomeTotal: 0, realIncome: 0 });
  });

  it("회귀: NON_REAL_INCOME 집합 변경 감지 — 항목 추가/제거 시 의도된 것인지 확인", () => {
    expect([...NON_REAL_INCOME].sort()).toEqual(
      ["대출", "용돈", "원래 보유 자산", "이월", "정산", "지원", "처분소득", "환불"].sort()
    );
  });
});

describe("classifyIncomeNature", () => {
  const salaryKeys = new Set(["급여", "상여", "수당"]);
  const investIncKeys = new Set(["배당", "이자", "투자수익"]);
  const opts = { salaryKeys, investIncKeys };

  it("근로: salaryKeys에 속한 중분류", () => {
    expect(classifyIncomeNature("급여", opts)).toBe("근로");
    expect(classifyIncomeNature("상여", opts)).toBe("근로");
  });

  it("패시브: investIncKeys에 속한 중분류", () => {
    expect(classifyIncomeNature("배당", opts)).toBe("패시브");
    expect(classifyIncomeNature("이자", opts)).toBe("패시브");
  });

  it("부채: 대출 — 갚아야 할 돈은 수입이 아님", () => {
    expect(classifyIncomeNature("대출", opts)).toBe("부채");
  });

  it("환급: 정산 부분일치·환불·데이트통장 — 돌려받은 돈", () => {
    expect(classifyIncomeNature("정산", opts)).toBe("환급");
    expect(classifyIncomeNature("데이트정산", opts)).toBe("환급");
    expect(classifyIncomeNature("환불", opts)).toBe("환급");
    expect(classifyIncomeNature("데이트통장", opts)).toBe("환급");
  });

  it("일시: 지원·용돈·처분소득 — 반복 보장 없는 이전성 소득", () => {
    expect(classifyIncomeNature("지원", opts)).toBe("일시");
    expect(classifyIncomeNature("용돈", opts)).toBe("일시");
    expect(classifyIncomeNature("처분소득", opts)).toBe("일시");
  });

  it("기타: 캐시백·지역화폐 등 — 실질 수입에는 포함되는 부수입", () => {
    expect(classifyIncomeNature("캐시백", opts)).toBe("기타");
    expect(classifyIncomeNature("지역화폐", opts)).toBe("기타");
  });
});

function acc(o: Partial<Account> & { id: string; name: string }): Account {
  return {
    type: "checking",
    institution: "",
    initialBalance: 0,
    ...o,
  };
}

describe("computeOriginalAssets", () => {
  it("initialBalance > 0 인 계좌만 포함", () => {
    const accounts = [
      acc({ id: "a", name: "주거래", initialBalance: 1_000_000 }),
      acc({ id: "b", name: "비상금", initialBalance: 500_000 }),
      acc({ id: "c", name: "신규", initialBalance: 0 }),
      acc({ id: "d", name: "마이너스", initialBalance: -100 }),
    ];
    const r = computeOriginalAssets(accounts);
    expect(r.originalAssets).toBe(1_500_000);
    expect(r.originalAssetsByAcct).toHaveLength(2);
  });

  it("금액 큰 순 정렬", () => {
    const accounts = [
      acc({ id: "a", name: "작은계좌", initialBalance: 100 }),
      acc({ id: "b", name: "큰계좌", initialBalance: 1000 }),
      acc({ id: "c", name: "중간", initialBalance: 500 }),
    ];
    const r = computeOriginalAssets(accounts);
    expect(r.originalAssetsByAcct.map((x) => x.name)).toEqual(["큰계좌", "중간", "작은계좌"]);
  });

  it("initialBalance 누락(undefined) 시 0으로 취급", () => {
    const accounts = [acc({ id: "a", name: "x", initialBalance: undefined })];
    const r = computeOriginalAssets(accounts);
    expect(r.originalAssets).toBe(0);
    expect(r.originalAssetsByAcct).toHaveLength(0);
  });

  it("빈 계좌 배열", () => {
    const r = computeOriginalAssets([]);
    expect(r).toEqual({ originalAssets: 0, originalAssetsByAcct: [] });
  });
});
