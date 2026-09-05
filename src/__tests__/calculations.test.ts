import { describe, it, expect } from "vitest";
import { computePositions, computeRealizedPnlByTradeId, isInterestRepayment, computeLoanBalanceAt, hasLoanRepaymentStructure } from "../calculations";
import type { Account, LedgerEntry, Loan, StockTrade } from "../types";

function makeTrade(overrides: Partial<StockTrade> & { id: string; side: "buy" | "sell" }): StockTrade {
  return {
    date: "2026-01-01",
    accountId: "acc1",
    ticker: "AAPL",
    name: "Apple",
    quantity: 1,
    price: 100,
    fee: 0,
    totalAmount: 100,
    cashImpact: 0,
    ...overrides,
  };
}

describe("computeRealizedPnlByTradeId (FIFO)", () => {
  it("매수만 있으면 실현손익 없음", () => {
    const trades = [makeTrade({ id: "b1", side: "buy", quantity: 10, price: 100, totalAmount: 1000 })];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("b1")).toBeUndefined();
  });

  it("매수 후 매도 시 FIFO 실현손익 계산", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 150, totalAmount: 1500 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(500); // (150-100) * 10
  });

  it("부분 매도 시 정확한 손익", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 5, price: 120, totalAmount: 600 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(100); // (120-100) * 5
  });

  it("손실 매도", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 80, totalAmount: 800 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(-200); // (80-100) * 10
  });

  it("오버셀(매수 기록 삭제 등으로 보유량보다 많이 매도)은 부족분을 손익 0으로 중립화 — 허위 수익 방지 (회귀)", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      // 10주만 매수했는데 15주 매도 — 뒤늦게 매수 거래를 지운 것 같은 데이터 정합 문제 시뮬레이션
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 15, price: 200, totalAmount: 3000 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    // 소진된 10주분만 (200-100)*10=1000 이익. 부족한 5주(대금 1000)는 원가=대금으로 잡아 0 기여.
    // 고치기 전엔 costBasis=1000(10주분)만 잡혀 pnl=3000-1000=2000 (5주가 허위로 100% 이익 처리됨).
    expect(result.get("s1")).toBe(1000);
  });
});

function makeRepayment(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    date: "2026-01-15",
    kind: "expense",
    category: "지출",
    description: "주담대 상환",
    amount: 100_000,
    ...overrides,
  } as LedgerEntry;
}

describe("computePositions — price=0 시세는 '시세 없음'으로 취급 (-100% 오표시 방지)", () => {
  const accounts = [{ id: "acc1", name: "증권" }] as Account[];
  const buyTrades = [
    makeTrade({ id: "b1", side: "buy", ticker: "0180V0", quantity: 598, price: 13235, totalAmount: 7914530 })
  ];

  it("price=0 + priceFallback:'cost'면 평균단가로 폴백한다 (손익 0)", () => {
    const positions = computePositions(buyTrades, [{ ticker: "0180V0", price: 0 }], accounts, {
      priceFallback: "cost"
    });
    expect(positions).toHaveLength(1);
    expect(positions[0].marketPrice).toBeCloseTo(7914530 / 598);
    expect(positions[0].pnlRate).toBeCloseTo(0);
  });

  it("폴백 미지정이면 marketPrice=0 — 호출부(주식 탭)가 '시세 없음'으로 표시한다", () => {
    const positions = computePositions(buyTrades, [{ ticker: "0180V0", price: 0 }], accounts);
    expect(positions[0].marketPrice).toBe(0);
  });
});

describe("computePositions — 같은 날 매수·매도 정렬 (id순이 매도 먼저여도 보유수량 안 부풀려짐)", () => {
  const accounts = [{ id: "acc1", name: "증권" }] as Account[];
  it("같은 날 전량 매수+매도면 보유수량 0 (id상 매도가 먼저여도)", () => {
    // 배열 순서·id 모두 매도가 먼저(a-sell < z-buy) → 옛 id정렬은 매도 먼저 처리해 오버셀 무시→매수 lot 잔존(수량 10 오류)
    const trades = [
      makeTrade({ id: "a-sell", side: "sell", date: "2026-03-01", quantity: 10, price: 150, totalAmount: 1500 }),
      makeTrade({ id: "z-buy", side: "buy", date: "2026-03-01", quantity: 10, price: 100, totalAmount: 1000 }),
    ];
    const positions = computePositions(trades, [{ ticker: "AAPL", price: 150 }], accounts);
    // 매수 먼저 처리 → 매도가 전량 소진 → 잔여 0 (포지션 없음 또는 수량 0)
    const total = positions.reduce((s, p) => s + p.quantity, 0);
    expect(total).toBe(0);
  });

  it("같은 날 매수10·매도4면 보유수량 6", () => {
    const trades = [
      makeTrade({ id: "a-sell", side: "sell", date: "2026-03-01", quantity: 4, price: 150, totalAmount: 600 }),
      makeTrade({ id: "z-buy", side: "buy", date: "2026-03-01", quantity: 10, price: 100, totalAmount: 1000 }),
    ];
    const positions = computePositions(trades, [{ ticker: "AAPL", price: 150 }], accounts);
    expect(positions.reduce((s, p) => s + p.quantity, 0)).toBe(6);
  });
});

describe("isInterestRepayment — 카테고리 구조 세대별 이자 판정", () => {
  it("현재 구조: detailCategory에 '이자' 포함이면 이자 상환", () => {
    const entry = makeRepayment({ id: "1", category: "지출", subCategory: "대출상환", detailCategory: "이자상환" });
    expect(isInterestRepayment(entry)).toBe(true);
  });

  it("현재 구조: detailCategory가 '원금상환'이면 원금 상환", () => {
    const entry = makeRepayment({ id: "2", category: "지출", subCategory: "대출상환", detailCategory: "원금상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });

  it("2세대 구조: (category='대출상환', subCategory='이자상환')도 이자 상환으로 판정", () => {
    const entry = makeRepayment({ id: "3", category: "대출상환", subCategory: "이자상환" });
    expect(isInterestRepayment(entry)).toBe(true);
  });

  it("2세대 구조: (category='대출상환', subCategory='원금상환')은 원금 상환", () => {
    const entry = makeRepayment({ id: "4", category: "대출상환", subCategory: "원금상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });

  it("현재 구조의 subCategory='대출상환' 자체는 이자로 오판하지 않는다", () => {
    const entry = makeRepayment({ id: "5", category: "지출", subCategory: "대출상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });
});

describe("computeLoanBalanceAt — 2세대 이자 상환은 잔금에서 차감하지 않음", () => {
  const loans: Loan[] = [{
    id: "l1",
    institution: "은행",
    loanName: "주담대",
    loanAmount: 1_000_000,
    annualInterestRate: 3,
    repaymentMethod: "bullet",
    loanDate: "2026-01-01",
    maturityDate: "2030-01-01",
  }];

  it("2세대 이자상환 엔트리는 원금 잔금을 줄이지 않는다", () => {
    const ledger: LedgerEntry[] = [
      makeRepayment({ id: "1", category: "대출상환", subCategory: "이자상환", amount: 50_000 }),
      makeRepayment({ id: "2", category: "대출상환", subCategory: "원금상환", amount: 200_000 }),
    ];
    // 이자 50,000은 무시, 원금 200,000만 차감
    expect(computeLoanBalanceAt(loans, ledger)).toBe(800_000);
  });

  it("loanId가 있으면 대출명이 바뀌어 description에 옛 이름이 없어도 매칭 (#13)", () => {
    const ledger: LedgerEntry[] = [
      makeRepayment({ id: "1", category: "지출", subCategory: "대출상환", detailCategory: "원금", description: "원금 상환", amount: 300_000, loanId: "l1" }),
    ];
    expect(computeLoanBalanceAt(loans, ledger)).toBe(700_000);
  });

  it("loanId가 substring 오집계를 막는다 ('주담대2 상환'이 '주담대'에 이중 차감되지 않음)", () => {
    const twoLoans: Loan[] = [
      loans[0],
      { ...loans[0], id: "l2", loanName: "주담대2", loanAmount: 500_000 },
    ];
    const ledger: LedgerEntry[] = [
      makeRepayment({ id: "1", category: "지출", subCategory: "대출상환", detailCategory: "원금", description: "주담대2 상환", amount: 100_000, loanId: "l2" }),
    ];
    // loanId로 l2만 차감 → l1=1,000,000 + l2=400,000 = 1,400,000 (없으면 substring 이중 → 1,300,000)
    expect(computeLoanBalanceAt(twoLoans, ledger)).toBe(1_400_000);
  });

  it("loanId 없는 레거시 상환도 접두 관계 대출명에서 이중 차감되지 않는다 (단일 승자 매칭)", () => {
    const twoLoans: Loan[] = [
      loans[0],
      { ...loans[0], id: "l2", loanName: "주담대2", loanAmount: 500_000 },
    ];
    const ledger: LedgerEntry[] = [
      // loanId 없음 — description만으로 매칭. "주담대2 상환"은 "주담대"와 "주담대2" 둘 다에
      // .includes()가 참이지만, 가장 긴 이름("주담대2")만 승자여야 한다.
      makeRepayment({ id: "1", category: "지출", subCategory: "대출상환", detailCategory: "원금", description: "주담대2 상환", amount: 100_000 }),
    ];
    // l2만 차감 → l1=1,000,000 + l2=400,000 = 1,400,000 (양쪽 다 차감되면 1,300,000)
    expect(computeLoanBalanceAt(twoLoans, ledger)).toBe(1_400_000);
  });
});

describe("hasLoanRepaymentStructure — 대출 상환 세대 관용", () => {
  const e = (o: Partial<LedgerEntry>): LedgerEntry =>
    ({ id: "x", date: "2026-07-01", kind: "expense", category: "지출", description: "", amount: 1000, ...o } as LedgerEntry);

  it("3세대 전부 인식한다", () => {
    expect(hasLoanRepaymentStructure(e({ category: "대출", subCategory: "빚" }))).toBe(true);
    expect(hasLoanRepaymentStructure(e({ category: "대출상환" }))).toBe(true);
    expect(hasLoanRepaymentStructure(e({ category: "지출", subCategory: "대출상환" }))).toBe(true);
  });

  it("강등된 형태도 인식한다 — 회귀: 상환 이력이 통째로 사라지던 케이스", () => {
    // applyDemoteSchema가 category를 한 칸 내리면 세 분기 어디에도 안 걸렸다.
    expect(hasLoanRepaymentStructure(e({ category: "지출", subCategory: "대출", detailCategory: "빚" }))).toBe(true);
    expect(hasLoanRepaymentStructure(e({ category: "지출", subCategory: "대출상환", detailCategory: "이자상환" }))).toBe(true);
  });

  it("무관한 지출은 걸리지 않는다", () => {
    expect(hasLoanRepaymentStructure(e({ category: "지출", subCategory: "식비" }))).toBe(false);
    expect(hasLoanRepaymentStructure(e({ category: "지출", subCategory: "대출" }))).toBe(false); // det="빚" 없음
  });
});
