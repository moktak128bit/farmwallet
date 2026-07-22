import { describe, it, expect } from "vitest";
import {
  computeInvestmentReconciliation,
  generateAccountPerformanceBreakdown,
  generateCategoryReport,
  generateClosingReportData,
  generateComprehensiveMonthlyReport,
  generateDailyReport,
  generateMonthlyIncomeDetail,
  generateMonthlyReport,
  generateYearlyReport,
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

describe("computeInvestmentReconciliation — 분류 외 차이(residual) 원인 분해", () => {
  const reconcile = (
    accounts: Account[],
    ledger: LedgerEntry[],
    trades: StockTrade[],
    prices: StockPrice[],
    fxRate?: number
  ) => {
    const perf = generateAccountPerformanceBreakdown(accounts, ledger, trades, prices, fxRate);
    return computeInvestmentReconciliation(accounts, ledger, trades, prices, perf, fxRate);
  };
  /** 항등식: 다섯 갈래의 합은 언제나 residual과 일치해야 한다 (표가 어긋나면 안 됨) */
  const expectBreakdownSumsToResidual = (rec: ReturnType<typeof reconcile>) => {
    const b = rec.residualBreakdown;
    const sum =
      b.accountExpense + b.nonDividendIncome + b.dividendFxGap + b.fxTranslation + b.unexplained;
    expect(sum).toBeCloseTo(rec.residual, 6);
    expect(rec.pnlSum + rec.residual).toBeCloseTo(rec.totalReturn, 6);
  };

  it("깨끗한 KRW 매매만 있으면 residual = 0 (다섯 갈래 모두 0)", () => {
    const accounts = [account({ id: "sec1", type: "securities", initialBalance: 1_000_000 })];
    const trades: StockTrade[] = [
      { id: "t1", date: "2026-01-10", accountId: "sec1", ticker: "005930", name: "삼성전자", side: "buy", quantity: 10, price: 70_000, fee: 0, totalAmount: 700_000, cashImpact: -700_000 },
    ];
    const prices: StockPrice[] = [
      { ticker: "005930", price: 80_000, currency: "KRW", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
    ];
    const rec = reconcile(accounts, [], trades, prices);
    expectBreakdownSumsToResidual(rec);
    expect(Math.round(rec.residual)).toBe(0);
    expect(Math.round(rec.unrealizedPnl)).toBe(100_000);
    expect(Math.round(rec.totalReturn)).toBe(100_000);
  });

  it("투자계좌에서 직접 나간 지출은 accountExpense로 잡힌다 (이체가 아니라 출금에 안 잡힘)", () => {
    const accounts = [account({ id: "sec1", type: "securities", initialBalance: 1_000_000 })];
    const ledger = [
      entry({ id: "e1", kind: "expense", subCategory: "세금", fromAccountId: "sec1", amount: 300_000 }),
    ];
    const rec = reconcile(accounts, ledger, [], []);
    expectBreakdownSumsToResidual(rec);
    expect(rec.residualBreakdown.accountExpense).toBe(-300_000);
    expect(Math.round(rec.residualBreakdown.unexplained)).toBe(0);
    // 지출 30만이 그대로 '총성과 −30만'으로 둔갑하는 상황 — 손익은 0인데 총성과는 마이너스
    expect(Math.round(rec.pnlSum)).toBe(0);
    expect(Math.round(rec.totalReturn)).toBe(-300_000);
  });

  it("배당 외 수입(이자)은 nonDividendIncome으로 분리된다", () => {
    const accounts = [account({ id: "sec1", type: "securities" })];
    const ledger = [
      entry({ id: "e1", kind: "income", category: "수입", subCategory: "이자", toAccountId: "sec1", amount: 50_000 }),
      entry({ id: "e2", kind: "income", category: "수입", subCategory: "배당", toAccountId: "sec1", amount: 20_000 }),
    ];
    const rec = reconcile(accounts, ledger, [], []);
    expectBreakdownSumsToResidual(rec);
    expect(rec.residualBreakdown.nonDividendIncome).toBe(50_000);
    expect(rec.dividendIncome).toBe(20_000);
    expect(rec.residualBreakdown.dividendFxGap).toBe(0);
  });

  it("USD 배당의 원화 환산 간극이 dividendFxGap으로 드러난다", () => {
    // 계좌 잔액은 표기금액($100)을 그대로 더하는데 배당 집계는 환율 환산(13만원)한다.
    // 이 간극을 '나머지'에 묻지 않고 별도 항목으로 세운다 — 원인 지목이 가능해야 하므로.
    const accounts = [account({ id: "sec1", type: "securities" })];
    const ledger = [
      entry({ id: "e1", kind: "income", category: "수입", subCategory: "배당", currency: "USD", toAccountId: "sec1", amount: 100 }),
    ];
    const rec = reconcile(accounts, ledger, [], [], 1300);
    expectBreakdownSumsToResidual(rec);
    expect(rec.dividendIncome).toBe(130_000);
    expect(rec.residualBreakdown.dividendFxGap).toBe(100 - 130_000);
    expect(rec.residualBreakdown.nonDividendIncome).toBe(0);
  });

  it("환율 미로드 시 USD 이체를 원화처럼 세지 않는다 (순투입원금 부풀림 방지)", () => {
    // toKrwByRate는 fxRate가 없으면 달러 액면을 그대로 반환한다. 평가액 쪽 usdCash는 fxRate가
    // 없으면 0이므로, 이체만 세면 순투입원금이 부풀어 없던 손실이 잡힌다.
    const accounts = [
      account({ id: "bank", type: "checking" }),
      account({ id: "sec1", type: "securities", currency: "USD" }),
    ];
    const ledger = [
      entry({ id: "e1", kind: "transfer", currency: "USD", fromAccountId: "bank", toAccountId: "sec1", amount: 1000 }),
    ];
    const rec = reconcile(accounts, ledger, [], [], undefined);
    expectBreakdownSumsToResidual(rec);
    expect(rec.deposits).toBe(0);
    expect(rec.netContributed).toBe(0);
    expect(rec.totalReturn).toBe(0);
  });

  it("여러 원인이 겹쳐도 분해 합계는 residual과 일치한다 (교차항 검증)", () => {
    // 단일 원인 테스트만으로는 버킷 간 이중계상·누락을 못 잡는다.
    // 계좌 지출 + 이자 수입 + USD 환차 + KRW 매매를 한꺼번에 섞는다.
    const accounts = [account({ id: "sec1", type: "securities", initialBalance: 5_000_000 })];
    const ledger = [
      entry({ id: "e1", kind: "expense", subCategory: "세금", fromAccountId: "sec1", amount: 200_000 }),
      entry({ id: "e2", kind: "income", category: "수입", subCategory: "이자", toAccountId: "sec1", amount: 30_000 }),
      entry({ id: "e3", kind: "income", category: "수입", subCategory: "배당", toAccountId: "sec1", amount: 40_000 }),
    ];
    const trades: StockTrade[] = [
      { id: "t1", date: "2026-01-10", accountId: "sec1", ticker: "005930", name: "삼성전자", side: "buy", quantity: 10, price: 70_000, fee: 0, totalAmount: 700_000, cashImpact: -700_000 },
      { id: "t2", date: "2026-01-20", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: -1_000_000, fxRateAtTrade: 1000 },
      { id: "t3", date: "2026-02-20", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "sell", quantity: 5, price: 120, fee: 0, totalAmount: 600, cashImpact: 720_000, fxRateAtTrade: 1200 },
    ];
    const prices: StockPrice[] = [
      { ticker: "005930", price: 80_000, currency: "KRW", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
      { ticker: "AAPL", price: 130, currency: "USD", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
    ];
    const rec = reconcile(accounts, ledger, trades, prices, 1300);
    expectBreakdownSumsToResidual(rec);
    // 각 원인이 자기 버킷에만 잡히는지 — 서로 새어나가면 아래가 깨진다
    expect(rec.residualBreakdown.accountExpense).toBe(-200_000);
    expect(rec.residualBreakdown.nonDividendIncome).toBe(30_000);
    expect(rec.residualBreakdown.dividendFxGap).toBe(0);
    // KRW 매매는 환차 버킷에 들어가지 않는다
    expect(Math.round(rec.residualBreakdown.unexplained)).toBe(0);
  });

  it("USD 종목 원금의 환차는 fxTranslation으로 잡힌다 (실현·미실현 어디에도 안 들어감)", () => {
    const accounts = [account({ id: "sec1", type: "securities", initialBalance: 2_000_000 })];
    // $1,000어치 매수, 당시 환율 1,000 → 현금 100만원 차감. 현재 환율 1,300, 주가는 그대로 $1,000.
    const trades: StockTrade[] = [
      { id: "t1", date: "2026-01-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: -1_000_000, fxRateAtTrade: 1000 },
    ];
    const prices: StockPrice[] = [
      { ticker: "AAPL", price: 100, currency: "USD", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
    ];
    const rec = reconcile(accounts, [], trades, prices, 1300);
    expectBreakdownSumsToResidual(rec);
    // 달러 기준 손익 0 → 미실현 0. 그런데 평가액은 130만, 나간 현금은 100만 → 환차 30만.
    expect(Math.round(rec.unrealizedPnl)).toBe(0);
    expect(Math.round(rec.residualBreakdown.fxTranslation)).toBe(300_000);
    expect(Math.round(rec.residualBreakdown.unexplained)).toBe(0);
  });

  it("USD 잔액모드 거래(cashImpact=0)도 매수원금이 정산에 잡힌다 — 회귀: 매수액이 수익으로 둔갑하던 버그", () => {
    // account.usdBalance는 매수분이 이미 차감된 '현재' 러닝 값(-1000).
    // 초기자본 계산이 이걸 그대로 '초기 USD 현금'으로 읽으면 currentValue와 상쇄돼
    // 매수대금 $1,000×1,300 = 130만원이 통째로 총성과로 잡혔다(주가 무변동인데 +130만).
    const accounts = [account({ id: "sec1", type: "securities", currency: "USD", usdBalance: -1000 })];
    const ledger = [
      entry({ id: "e1", kind: "transfer", currency: "USD", toAccountId: "sec1", amount: 1000, category: "이체" }),
    ];
    const trades: StockTrade[] = [
      { id: "t1", date: "2026-01-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: 0, fxRateAtTrade: 1300 },
    ];
    const prices: StockPrice[] = [
      { ticker: "AAPL", price: 100, currency: "USD", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
    ];
    const rec = reconcile(accounts, ledger, trades, prices, 1300);
    expectBreakdownSumsToResidual(rec);
    // $1,000 입금 → $1,000 매수, 주가 그대로 → 순투입 130만, 평가 130만, 총성과 0
    expect(Math.round(rec.initialCapital)).toBe(0);
    expect(Math.round(rec.netContributed)).toBe(1_300_000);
    expect(Math.round(rec.currentValue)).toBe(1_300_000);
    expect(Math.round(rec.totalReturn)).toBe(0);
    expect(Math.round(rec.unrealizedPnl)).toBe(0);
    expect(Math.round(rec.residual)).toBe(0);
    expect(Math.round(rec.residualBreakdown.fxTranslation)).toBe(0);
  });

  it("USD 잔액모드 + 주가 상승분만 손익으로 잡힌다 (환율 동일)", () => {
    // 매수 후 주가 $1,000 → $1,200. 순수 평가이익 $200×1,300 = 260,000원만 총성과여야 한다.
    const accounts = [account({ id: "sec1", type: "securities", currency: "USD", usdBalance: -1000 })];
    const ledger = [
      entry({ id: "e1", kind: "transfer", currency: "USD", toAccountId: "sec1", amount: 1000, category: "이체" }),
    ];
    const trades: StockTrade[] = [
      { id: "t1", date: "2026-01-10", accountId: "sec1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: 0, fxRateAtTrade: 1300 },
    ];
    const prices: StockPrice[] = [
      { ticker: "AAPL", price: 120, currency: "USD", updatedAt: "2026-07-01T00:00:00Z" } as StockPrice,
    ];
    const rec = reconcile(accounts, ledger, trades, prices, 1300);
    expectBreakdownSumsToResidual(rec);
    expect(Math.round(rec.unrealizedPnl)).toBe(260_000);
    expect(Math.round(rec.totalReturn)).toBe(260_000);
    expect(Math.round(rec.residual)).toBe(0);
  });
});

describe("P2 단일 소스 수렴 — 보고서 정합 회귀 (2026-07-22)", () => {
  it("월간·연간 리포트 수입이 이월/원래보유를 제외한다 (시작 월 수입 부풀림 방지)", () => {
    const ledger = [
      entry({ id: "c1", kind: "income", category: "수입", subCategory: "이월", amount: 5_000_000, date: "2026-01-02" }),
      entry({ id: "s1", kind: "income", category: "수입", subCategory: "급여", amount: 3_000_000, date: "2026-01-25" }),
    ];
    const monthly = generateMonthlyReport(ledger);
    expect(monthly.find((r) => r.month === "2026-01")?.income).toBe(3_000_000);
    const yearly = generateYearlyReport(ledger);
    expect(yearly.find((r) => r.month === "2026")?.income).toBe(3_000_000);
  });

  it("카테고리 리포트 — 신용결제·저축성지출 제외 + 대분류:소분류 키 (래퍼 '지출' 해소)", () => {
    const ledger = [
      entry({ id: "e1", category: "지출", subCategory: "식비", detailCategory: "시장", amount: 30_000 }),
      entry({ id: "e2", category: "지출", subCategory: "식비", detailCategory: "외식", amount: 20_000 }),
      entry({ id: "e3", category: "신용결제", amount: 500_000 }),          // 이중계상 — 제외
      entry({ id: "e4", category: "저축성지출", amount: 200_000 }),        // 자산 축적 — 제외
      entry({ id: "e5", category: "식비", subCategory: undefined, amount: 10_000 }), // 레거시 평면
    ];
    const rows = generateCategoryReport(ledger);
    // 예전: 키가 "지출:식비"라 대분류 열이 전부 "지출", 신용결제·저축성지출이 행으로 노출돼
    // 카테고리 합이 월간 지출 합계보다 컸다.
    expect(rows.find((r) => r.category === "식비" && r.subCategory === "시장")?.total).toBe(30_000);
    expect(rows.find((r) => r.category === "식비" && !r.subCategory)?.total).toBe(10_000);
    expect(rows.some((r) => r.category === "지출")).toBe(false);
    expect(rows.some((r) => r.category === "신용결제" || r.category === "저축성지출")).toBe(false);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const monthlyExpense = generateMonthlyReport(ledger).find((r) => r.month === "2026-01")?.expense ?? 0;
    expect(total).toBe(monthlyExpense); // 카테고리 합 = 월간 지출 합 (정합)
  });
});
