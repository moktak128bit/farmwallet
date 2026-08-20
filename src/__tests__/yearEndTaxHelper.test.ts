/**
 * 연말정산 미리보기(yearEndTaxHelper) — 카드 25% 문턱 전후·15/30%·총급여 구간 한도·의료비 3%·
 * 카드 유형 판정(card/checking/기타)·USD 환산·총급여 연환산 회귀 테스트.
 */
import { describe, expect, it } from "vitest";
import type { Account, LedgerEntry } from "../types";
import {
  YEAR_END_TAX_RULES_2026,
  buildYearEndTaxHelper,
  isDonationExpense,
  isMedicalExpense,
  isRentExpense
} from "../utils/yearEndTaxHelper";

let seq = 0;
function entry(p: Partial<LedgerEntry>): LedgerEntry {
  seq += 1;
  return {
    id: `L${seq}`,
    date: "2026-03-10",
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    description: "",
    amount: 10000,
    ...p
  };
}
function acct(p: Partial<Account> & { id: string; type: Account["type"] }): Account {
  return { name: p.id, institution: "", initialBalance: 0, ...p } as Account;
}

const ACCOUNTS: Account[] = [
  acct({ id: "card1", type: "card" }),
  acct({ id: "chk1", type: "checking" }),
  acct({ id: "sav1", type: "savings" }),
  acct({ id: "sec1", type: "securities" })
];

const TODAY = "2026-08-21";
const SALARY = 50_000_000; // 7천만 이하 → 한도 300만, 문턱 1,250만, 의료비 문턱 150만

describe("카드 유형 판정", () => {
  it("card 계좌 = 신용, checking = 체크·현금, 그 외/미지정 = other", () => {
    const ledger = [
      entry({ fromAccountId: "card1", amount: 1000 }),
      entry({ fromAccountId: "chk1", amount: 2000 }),
      entry({ fromAccountId: "sav1", amount: 4000 }),
      entry({ fromAccountId: "sec1", amount: 8000 }),
      entry({ amount: 16000 })
    ];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.cardSpend.credit).toBe(1000);
    expect(r.cardSpend.checkOrCash).toBe(2000);
    expect(r.cardSpend.other).toBe(4000 + 8000 + 16000);
    expect(r.cardSpend.total).toBe(3000);
  });

  it("카드 대금 납부(transfer)·수입·다른 해 항목은 집계에서 제외", () => {
    const ledger = [
      entry({ fromAccountId: "card1", amount: 5000 }),
      entry({ kind: "transfer", category: "이체", subCategory: "카드결제이체", fromAccountId: "chk1", toAccountId: "card1", amount: 5000 }),
      entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000 }),
      entry({ fromAccountId: "card1", amount: 9999, date: "2025-12-31" })
    ];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.cardSpend.credit).toBe(5000);
    expect(r.cardSpend.checkOrCash).toBe(0);
  });
});

describe("25% 문턱 전후·공제율·한도", () => {
  it("문턱 미달이면 공제 0, 문턱까지 남은 금액과 안내", () => {
    const ledger = [entry({ fromAccountId: "card1", amount: 10_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.cardSpend.threshold25).toBe(12_500_000);
    expect(r.cardSpend.toThreshold).toBe(2_500_000);
    expect(r.cardSpend.overThreshold).toBe(0);
    expect(r.cardSpend.estimatedDeduction).toBe(0);
    expect(r.cardSpend.remainingCap).toBe(3_000_000);
    expect(r.cardSpend.advice).toContain("문턱까지");
  });

  it("문턱은 신용카드부터 차감 — 신용 초과분 15%, 체크 초과분 30%", () => {
    // 신용 1,000만(문턱 1,250만 중 1,000만 소진) + 체크 500만(남은 문턱 250만 차감 → 250만 초과)
    const ledger = [
      entry({ fromAccountId: "card1", amount: 10_000_000 }),
      entry({ fromAccountId: "chk1", amount: 5_000_000 })
    ];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.cardSpend.creditOver).toBe(0);
    expect(r.cardSpend.checkOver).toBe(2_500_000);
    expect(r.cardSpend.estimatedDeduction).toBe(750_000);
    expect(r.cardSpend.toThreshold).toBe(0);
    expect(r.cardSpend.advice).toContain("체크카드");
  });

  it("신용카드만으로 문턱 초과 시 초과분 × 15%", () => {
    const ledger = [entry({ fromAccountId: "card1", amount: 20_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.cardSpend.creditOver).toBe(7_500_000);
    expect(r.cardSpend.estimatedDeduction).toBe(1_125_000);
    expect(r.cardSpend.capReached).toBe(false);
  });

  it("총급여 7천만 이하 한도 300만 — 초과 시 한도에서 멈추고 한도 소진 안내", () => {
    const ledger = [entry({ fromAccountId: "chk1", amount: 30_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    // (3,000만 − 1,250만) × 30% = 525만 > 300만
    expect(r.cardSpend.estimatedDeduction).toBe(3_000_000);
    expect(r.cardSpend.remainingCap).toBe(0);
    expect(r.cardSpend.capReached).toBe(true);
    expect(r.cardSpend.advice).toContain("한도");
  });

  it("총급여 7천만 초과는 한도 250만", () => {
    const ledger = [entry({ fromAccountId: "chk1", amount: 60_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: 90_000_000, today: TODAY });
    expect(r.cardSpend.deductionCap).toBe(2_500_000);
    expect(r.cardSpend.estimatedDeduction).toBe(2_500_000);
  });

  it("총급여 미확정이면 문턱·한도 0, 안내 문구", () => {
    const ledger = [entry({ fromAccountId: "card1", amount: 1_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { today: TODAY });
    expect(r.grossSalarySource).toBe("none");
    expect(r.cardSpend.threshold25).toBe(0);
    expect(r.cardSpend.estimatedDeduction).toBe(0);
    expect(r.cardSpend.advice).toContain("총급여");
    expect(r.cardSpend.credit).toBe(1_000_000);
  });

  it("규칙 상수는 연도 태그가 붙어 결과에 노출", () => {
    const r = buildYearEndTaxHelper([], ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.rules.year).toBe(YEAR_END_TAX_RULES_2026.year);
  });
});

describe("의료비 3% 문턱·기부·월세", () => {
  it("의료비 총급여 3% 초과분만 공제대상, 15% 세액공제", () => {
    const ledger = [
      entry({ fromAccountId: "card1", subCategory: "의료건강비", detailCategory: "병원", amount: 2_000_000 }),
      entry({ fromAccountId: "card1", subCategory: "의료건강비", detailCategory: "보험료", amount: 500_000 }), // 제외
      entry({ fromAccountId: "card1", subCategory: "의료건강비", detailCategory: "영양제", amount: 300_000 }) // 제외
    ];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.medical.total).toBe(2_000_000);
    expect(r.medical.threshold3).toBe(1_500_000);
    expect(r.medical.deductible).toBe(500_000);
    expect(r.medical.estimatedCredit).toBe(75_000);
  });

  it("의료비가 3% 미만이면 공제대상 0", () => {
    const ledger = [entry({ fromAccountId: "chk1", subCategory: "의료건강비", detailCategory: "약국", amount: 1_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.medical.deductible).toBe(0);
    expect(r.medical.estimatedCredit).toBe(0);
  });

  it("기부금 15% (1천만 초과분 30%)", () => {
    const ledger = [entry({ fromAccountId: "chk1", subCategory: "경조사비", detailCategory: "기부금", amount: 12_000_000 })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(r.donation.total).toBe(12_000_000);
    expect(r.donation.estimatedCredit).toBe(10_000_000 * 0.15 + 2_000_000 * 0.3);
  });

  it("월세: 연 1천만 한도·5,500만 이하 17%·8천만 초과 불가", () => {
    const ledger = [entry({ fromAccountId: "chk1", subCategory: "주거비", detailCategory: "월세", amount: 12_000_000 })];
    const low = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, today: TODAY });
    expect(low.rent.total).toBe(12_000_000);
    expect(low.rent.eligibleAmount).toBe(10_000_000);
    expect(low.rent.estimatedCredit).toBeCloseTo(1_700_000, 5);
    const mid = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: 70_000_000, today: TODAY });
    expect(mid.rent.estimatedCredit).toBeCloseTo(1_500_000, 5);
    const high = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: 90_000_000, today: TODAY });
    expect(high.rent.eligible).toBe(false);
    expect(high.rent.estimatedCredit).toBe(0);
  });

  it("카테고리 판정 헬퍼 — 레거시(category=대분류)도 인식", () => {
    expect(isMedicalExpense(entry({ category: "의료비", subCategory: undefined }))).toBe(true);
    expect(isMedicalExpense(entry({ subCategory: "의료건강비", detailCategory: "헬스장" }))).toBe(false);
    expect(isMedicalExpense(entry({ subCategory: "기타", detailCategory: "치과" }))).toBe(true);
    expect(isDonationExpense(entry({ category: "기부", subCategory: undefined }))).toBe(true);
    expect(isRentExpense(entry({ subCategory: "주거비", detailCategory: "관리비" }))).toBe(false);
    expect(isRentExpense(entry({ subCategory: "주거비", detailCategory: "월세" }))).toBe(true);
  });
});

describe("USD 환산·총급여 연환산", () => {
  it("USD 지출은 환율로 환산해 합산, 환율 없으면 액면", () => {
    const ledger = [entry({ fromAccountId: "card1", amount: 100, currency: "USD" })];
    const withFx = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, fxRate: 1400, today: TODAY });
    expect(withFx.cardSpend.credit).toBe(140_000);
    const noFx = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: SALARY, fxRate: null, today: TODAY });
    expect(noFx.cardSpend.credit).toBe(100);
  });

  it("총급여 미입력 시 급여 YTD를 발생 개월 수로 연환산(진행 중인 해)", () => {
    const ledger: LedgerEntry[] = [];
    for (let m = 1; m <= 7; m++) {
      ledger.push(entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000, date: `2026-${String(m).padStart(2, "0")}-25` }));
    }
    // 오늘 이후(미래) 급여는 제외
    ledger.push(entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000, date: "2026-09-25" }));
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { today: TODAY });
    expect(r.grossSalarySource).toBe("estimated");
    expect(r.salaryYtd).toBe(21_000_000);
    expect(r.salaryMonths).toBe(7);
    expect(r.grossSalary).toBe(36_000_000);
    expect(r.cardSpend.threshold25).toBe(9_000_000);
  });

  it("지난 해는 연환산 없이 누계 그대로", () => {
    const ledger = [
      entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000, date: "2025-11-25" }),
      entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000, date: "2025-12-25" })
    ];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2025, { today: TODAY });
    expect(r.yearInProgress).toBe(false);
    expect(r.grossSalary).toBe(6_000_000);
  });

  it("사용자 입력 총급여가 연환산보다 우선", () => {
    const ledger = [entry({ kind: "income", category: "수입", subCategory: "급여", toAccountId: "chk1", amount: 3_000_000, date: "2026-01-25" })];
    const r = buildYearEndTaxHelper(ledger, ACCOUNTS, 2026, { grossSalary: 40_000_000, today: TODAY });
    expect(r.grossSalarySource).toBe("input");
    expect(r.grossSalary).toBe(40_000_000);
  });
});
