/** 전체 데이터 한 번에 내보내기 (buildFullDataSheets) */
import { describe, expect, it } from "vitest";
import type { AppData } from "../types";
import { buildFullDataSheets } from "../utils/fullDataExport";

const base: AppData = {
  accounts: [{ id: "a1", name: "증권", institution: "키움", type: "securities", initialBalance: 1000000 }],
  ledger: [
    { id: "l1", date: "2026-06-01", kind: "expense", category: "지출", subCategory: "식비", description: "점심", amount: 9000 },
    { id: "l2", date: "2026-06-02", kind: "income", category: "배당", description: "458730 - TIGER 배당", amount: 12000, toAccountId: "a1" },
  ],
  trades: [
    { id: "t1", date: "2026-01-02", accountId: "a1", ticker: "005930", name: "삼성전자", side: "buy", quantity: 10, price: 60000, fee: 0, totalAmount: 600000, cashImpact: -600000 },
  ],
  prices: [{ ticker: "005930", price: 70000, currency: "KRW" }],
  categoryPresets: { income: [], expense: [], transfer: [] },
  recurringExpenses: [{ id: "r1", title: "넷플릭스", amount: 17000, category: "구독비", frequency: "monthly", startDate: "2026-01-01" }],
  budgetGoals: [{ id: "b1", category: "식비", monthlyLimit: 400000 }],
  customSymbols: [],
  loans: [{ id: "ln1", institution: "은행", loanName: "주담대", loanAmount: 100000000, annualInterestRate: 3.5, repaymentMethod: "equal_payment", loanDate: "2025-01-01", maturityDate: "2055-01-01" }],
};

describe("buildFullDataSheets", () => {
  it("주요 엔티티별 시트를 만든다", () => {
    const sheets = buildFullDataSheets(base);
    const names = sheets.map((s) => s.name);
    expect(names).toEqual(["가계부", "주식거래", "보유현황", "배당이자", "계좌", "예산", "대출", "반복지출"]);
  });

  it("가계부 시트: 헤더 + 행, 구분이 한글로", () => {
    const sheet = buildFullDataSheets(base).find((s) => s.name === "가계부")!;
    expect(sheet.rows[0][0]).toBe("날짜");
    expect(sheet.rows[1][1]).toBe("지출");
    expect(sheet.rows[1][6]).toBe(9000); // 금액
  });

  it("주식거래·보유현황이 계좌명·평가를 담는다", () => {
    const sheets = buildFullDataSheets(base);
    const trade = sheets.find((s) => s.name === "주식거래")!;
    expect(trade.rows[1][1]).toBe("증권"); // 계좌명
    expect(trade.rows[1][4]).toBe("매수");
    const pos = sheets.find((s) => s.name === "보유현황")!;
    // 005930 10주 보유, 평가 70000×10=700000, 매입 600000
    expect(pos.rows[1][3]).toBe(10);
    expect(pos.rows[1][6]).toBe(700000);
  });

  it("배당이자 시트는 배당/이자 수입만", () => {
    const sheet = buildFullDataSheets(base).find((s) => s.name === "배당이자")!;
    expect(sheet.rows).toHaveLength(2); // 헤더 + 배당 1건
    expect(sheet.rows[1][1]).toBe("배당");
    expect(sheet.rows[1][3]).toBe(12000);
  });

  it("정확 이자 + description '배당' 조합은 배당 탭과 같은 '이자'로 라벨링 (이자 우선 규칙)", () => {
    const withMixed: AppData = {
      ...base,
      ledger: [
        ...base.ledger,
        { id: "l3", date: "2026-06-03", kind: "income", category: "수입", subCategory: "이자", description: "이자 - OK저축은행 배당", amount: 4619 },
      ],
    };
    const sheet = buildFullDataSheets(withMixed).find((s) => s.name === "배당이자")!;
    const row = sheet.rows.find((r) => r[2] === "이자 - OK저축은행 배당")!;
    expect(row[1]).toBe("이자"); // 예전: description '배당' 우선 검사라 '배당'으로 갈려 화면 부분합과 불일치
  });

  it("비어 있는 선택 엔티티(예산·대출·반복지출)는 없으면 시트 생략", () => {
    const minimal: AppData = { ...base, budgetGoals: [], loans: [], recurringExpenses: [] };
    const names = buildFullDataSheets(minimal).map((s) => s.name);
    expect(names).toEqual(["가계부", "주식거래", "보유현황", "배당이자", "계좌"]);
  });
});
