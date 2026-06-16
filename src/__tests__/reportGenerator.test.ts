import { describe, it, expect } from "vitest";
import {
  generateClosingReportData,
  generateComprehensiveMonthlyReport,
  generateDailyReport,
  generateMonthlyIncomeDetail,
  generateStockPerformanceReport
} from "../utils/reportGenerator";
import { generateLedgerMarkdownReport } from "../utils/ledgerMarkdownReport";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";

const account = (o: Partial<Account> & { id: string }): Account => ({
  name: o.id,
  institution: "테스트은행",
  type: "checking",
  initialBalance: 0,
  ...o,
} as Account);

const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-01-15",
  kind: "expense",
  category: "지출",
  description: "",
  amount: 1000,
  ...o,
} as LedgerEntry);

describe("generateComprehensiveMonthlyReport — USD 실현손익은 거래시점 환율(fxRateAtTrade)", () => {
  it("과거 USD 매도를 '현재' 환율이 아닌 거래 당시 환율로 환산 (화면 간 손익 정합)", () => {
    const accounts = [account({ id: "sec1", type: "securities" })];
    const trades: StockTrade[] = [
      { id: "tb", date: "2026-01-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: 0, fxRateAtTrade: 1000 },
      { id: "ts", date: "2026-02-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "sell", quantity: 10, price: 150, fee: 0, totalAmount: 1500, cashImpact: 0, fxRateAtTrade: 1200 },
    ];
    // 거래시점: 1500×1200 − 1000×1000 = 800,000. (옛 현재환율(1500) 방식이면 ($500)×1500 = 750,000)
    const rows = generateComprehensiveMonthlyReport([], trades, accounts, "2026-01", "2026-02", 1500);
    const feb = rows.find((r) => r.month === "2026-02");
    expect(feb?.realizedPnl).toBe(800_000);
  });
});

describe("generateStockPerformanceReport — USD 종목 KRW 정규화 (IRR 현금흐름 통일)", () => {
  it("USD 종목 평가액·매입원가·손익을 KRW로 환산 (cashImpact는 원화이므로 종가도 원화여야 IRR 정합)", () => {
    const accounts = [account({ id: "sec1", type: "securities" })];
    // KRW 현금모드(cashImpact = ±totalAmountKRW): 매수 10주 × $100, 당시 환율 1000 → 매입원가 1,000,000원
    const trades: StockTrade[] = [
      { id: "tb", date: "2026-01-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: -1_000_000, fxRateAtTrade: 1000 },
    ];
    const prices: StockPrice[] = [
      { ticker: "AAPL", price: 150, currency: "USD", updatedAt: "2026-06-16T00:00:00Z" } as StockPrice,
    ];
    const rows = generateStockPerformanceReport(trades, prices, accounts, 1300);
    const aapl = rows.find((r) => r.ticker === "AAPL");
    // 평가액 = 10 × $150 × 1300 = 1,950,000원, 매입원가 = $1000 × 1000 = 1,000,000원
    expect(aapl?.currentValue).toBe(1_950_000);
    expect(aapl?.totalBuyAmount).toBe(1_000_000);
    expect(aapl?.pnl).toBe(950_000);
    // IRR: 같은 통화(원) 유출/유입이라 양수로 산출됨 (환율배수 왜곡 없음)
    expect(aapl?.irr).toBeGreaterThan(0);
  });
});

describe("generateClosingReportData — 정산 스냅샷 부채 부호", () => {
  it("부채가 있는 계좌의 월간 스냅샷에서 debt가 양수로 나온다 (자산 − 순자산)", () => {
    const accounts = [
      account({ id: "a1", initialBalance: 1_000_000, debt: 200_000 }),
    ];
    // 과거 완결 월(2026-01)에 항목을 둬서 월간 스냅샷이 반드시 생성되도록 함
    const ledger = [
      entry({ id: "e1", date: "2026-01-15", fromAccountId: "a1", subCategory: "식비", amount: 1000 }),
    ];

    const result = generateClosingReportData(accounts, ledger, [], []);
    expect(result.monthlySnapshots.length).toBeGreaterThan(0);

    const snap = result.monthlySnapshots[0];
    // 순자산 = 자산 − 부채 ⇒ 부채 = 자산 − 순자산 (양수)
    expect(snap.debt).toBe(200_000);
    expect(snap.debt).toBeGreaterThan(0);
    expect(snap.asset - snap.debt).toBe(snap.netWorth);
  });

  it("주간 스냅샷도 동일하게 양수 부채", () => {
    const accounts = [account({ id: "a1", initialBalance: 500_000, debt: 50_000 })];
    const ledger = [
      entry({ id: "e1", date: "2026-01-05", fromAccountId: "a1", subCategory: "식비", amount: 1000 }),
    ];
    const result = generateClosingReportData(accounts, ledger, [], []);
    expect(result.weeklySnapshots.length).toBeGreaterThan(0);
    for (const snap of result.weeklySnapshots) {
      expect(snap.debt).toBe(50_000);
    }
  });
});

describe("generateComprehensiveMonthlyReport — 지출 분류", () => {
  it("구버전 재테크 저축(category=재테크, sub=저축)은 생활소비가 아니라 저축성지출", () => {
    const ledger = [
      entry({ id: "e1", category: "재테크", subCategory: "저축", amount: 10_000 }),
    ];
    const rows = generateComprehensiveMonthlyReport(ledger, [], [], "2026-01", "2026-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].savingsExpense).toBe(10_000);
    expect(rows[0].livingExpense).toBe(0);
  });

  it("투자손실(category=재테크, sub=투자손실)은 생활소비로 집계", () => {
    const ledger = [
      entry({ id: "e1", category: "재테크", subCategory: "투자손실", amount: 5_000 }),
    ];
    const rows = generateComprehensiveMonthlyReport(ledger, [], [], "2026-01", "2026-01");
    expect(rows[0].livingExpense).toBe(5_000);
    expect(rows[0].savingsExpense).toBe(0);
  });

  it("대출상환은 loanRepayment에만 집계 — livingExpense에 이중 가산되지 않음", () => {
    const ledger = [
      entry({ id: "e1", category: "지출", subCategory: "대출상환", detailCategory: "학자금대출", amount: 300_000 }),
      entry({ id: "e2", category: "지출", subCategory: "식비", amount: 20_000 }),
    ];
    const rows = generateComprehensiveMonthlyReport(ledger, [], [], "2026-01", "2026-01");
    expect(rows[0].loanRepayment).toBe(300_000);
    expect(rows[0].livingExpense).toBe(20_000);
    expect(rows[0].totalExpense).toBe(320_000);
  });
});

describe("generateDailyReport — 신용결제 제외", () => {
  it("레거시 신용결제(category=신용결제)는 일별 지출에서 제외된다", () => {
    const accounts = [account({ id: "a1", initialBalance: 1_000_000 })];
    const ledger = [
      entry({ id: "e1", date: "2026-01-10", category: "신용결제", subCategory: "신용결제", fromAccountId: "a1", amount: 5_000 }),
      entry({ id: "e2", date: "2026-01-10", category: "지출", subCategory: "식비", fromAccountId: "a1", amount: 2_000 }),
    ];
    const rows = generateDailyReport(accounts, ledger, [], [], "2026-01-10", "2026-01-10");
    expect(rows).toHaveLength(1);
    expect(rows[0].expense).toBe(2_000);
  });
});

describe("generateMonthlyIncomeDetail — 배당·이자 정확 매칭", () => {
  it("subCategory가 정확히 배당/이자인 항목만 포함, substring 위양성 제외", () => {
    const accounts: Account[] = [];
    const ledger = [
      entry({ id: "e1", kind: "income", category: "수입", subCategory: "배당", amount: 1_000 }),
      entry({ id: "e2", kind: "income", category: "수입", subCategory: "이자", amount: 2_000 }),
      // 설명에만 "배당" substring이 있는 급여 — 배당·이자 상세에 포함되면 안 됨
      entry({ id: "e3", kind: "income", category: "수입", subCategory: "급여", description: "비배당주식 정리", amount: 3_000 }),
    ];
    const rows = generateMonthlyIncomeDetail(ledger, accounts, "2026-01", "2026-01");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount).sort()).toEqual([1_000, 2_000]);
  });
});

describe("generateLedgerMarkdownReport — 구버전 재테크 분류 + 표 셀 이스케이프", () => {
  it("구버전 재테크 저축은 저축성 지출 그룹으로 분류된다", () => {
    const accounts = [account({ id: "a1" })];
    const ledger = [
      entry({ id: "e1", category: "재테크", subCategory: "저축", fromAccountId: "a1", amount: 10_000 }),
    ];
    const md = generateLedgerMarkdownReport(ledger, accounts);
    // 총계 라인: 지출 0 / 저축성 지출 1
    expect(md).toContain("지출 0 / 저축성 지출 1");
  });

  it("표 셀의 | 문자가 \\| 로 이스케이프된다", () => {
    const accounts = [account({ id: "a1" })];
    const ledger = [
      entry({ id: "e1", subCategory: "식비", description: "김밥|라면", fromAccountId: "a1", amount: 8_000 }),
    ];
    const md = generateLedgerMarkdownReport(ledger, accounts);
    expect(md).toContain("김밥\\|라면");
    expect(md).not.toContain("| 김밥|라면 |");
  });
});
