// @vitest-environment jsdom
/**
 * 대시보드 첫 화면(질문 3열) — glanceMath 계산과 DashboardGlance 표시 규칙.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LedgerEntry, Loan } from "../types";
import type { BalanceSheet } from "../calculations";
import { computeInvestmentTotals, computeMonthPace, nearestLoanMaturity } from "../features/dashboard/glanceMath";
import type { Account } from "../types";
import { DashboardGlance } from "../features/dashboard/DashboardGlance";
import { OPEN_RECURRING_DUE_EVENT } from "../components/RecurringDueBadge";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 120, height: 40 }}>{children}</div> };
});

const exp = (date: string, amount: number): LedgerEntry =>
  ({ id: `L-${date}-${amount}`, date, kind: "expense", category: "지출", subCategory: "식비", amount } as LedgerEntry);

describe("computeMonthPace", () => {
  // 지난 3개월: 1~5일 각 10만, 월 전체 각 100만 → 평소 이맘때 10만, 월 평균 100만
  const prev = ["2026-08", "2026-09", "2026-10"].flatMap((m) => [exp(`${m}-03`, 100_000), exp(`${m}-20`, 900_000)]);

  it("경과일은 오늘이 아니라 마지막 기록일 — 기록 공백을 0원으로 세지 않는다", () => {
    const ledger = [...prev, exp("2026-11-05", 50_000)];
    const p = computeMonthPace(ledger, "2026-11", "2026-11-10", undefined, null);
    expect(p.elapsed).toBe(5);
    expect(p.currentExpense).toBe(50_000);
    expect(p.avgPrevPartial).toBeCloseTo(100_000);
    expect(p.avgPrev3).toBeCloseTo(1_000_000);
    expect(p.share).toBeCloseTo(0.1);
    expect(p.projectedExpense).toBeCloseTo(500_000);
  });

  it("이번 달 기록 전이면 elapsed 0, 예상 없음", () => {
    const p = computeMonthPace(prev, "2026-11", "2026-11-10", undefined, null);
    expect(p.elapsed).toBe(0);
    expect(p.projectedExpense).toBeNull();
  });
});

describe("computeInvestmentTotals — 순입금 원금", () => {
  const sec = { id: "PEN", name: "퇴직연금", type: "securities", institution: "", initialBalance: 0 } as Account;
  const balances = [{ account: sec, currentBalance: 4_300_000 }] as never;
  const inc = (sub: string, amount: number): LedgerEntry =>
    ({ id: `I-${sub}`, date: "2026-06-16", kind: "income", category: "수입", subCategory: sub, amount, toAccountId: "PEN" } as LedgerEntry);

  it("투자 계좌로 들어온 퇴직연금 이전은 원금 — 이익으로 보이지 않는다, 배당은 이익", () => {
    const t = computeInvestmentTotals({
      accounts: [sec], ledger: [inc("퇴직연금", 4_252_080), inc("배당", 47_920)], trades: [], balances, positions: [], fxRate: 1400,
    });
    expect(t.principal).toBe(4_252_080);
    expect(t.cumulativePnl).toBe(47_920);
  });

  it("환전 이체 다리는 원금에서 뺀다 (계좌 안 통화 이동)", () => {
    const fx = (id: string, amount: number, currency: "KRW" | "USD", from?: string, to?: string): LedgerEntry =>
      ({ id, date: "2026-05-18", kind: "transfer", category: "이체", subCategory: "환전이체", amount, currency, fromAccountId: from, toAccountId: to } as LedgerEntry);
    const t = computeInvestmentTotals({
      accounts: [sec], ledger: [fx("x1", 1_400_000, "KRW", "PEN", undefined), fx("x2", 1000, "USD", undefined, "PEN")],
      trades: [], balances, positions: [], fxRate: 1450,
    });
    expect(t.principal).toBe(0);
  });
});

describe("nearestLoanMaturity", () => {
  const loan = (id: string, maturityDate: string): Loan =>
    ({ id, institution: "은행", loanName: id, loanAmount: 1, annualInterestRate: 1, repaymentMethod: "bullet", loanDate: "2025-01-01", maturityDate } as Loan);
  it("잔액이 남은 대출 중 만기가 가장 가까운 것", () => {
    const loans = [loan("A", "2038-08-29"), loan("B", "2028-12-31"), loan("C", "2027-01-01")];
    const balances = new Map([["A", 100], ["B", 50], ["C", 0]]);
    expect(nearestLoanMaturity(loans, balances)).toEqual({ name: "B", maturityDate: "2028-12-31", balance: 50 });
  });
});

const bs = {
  cash: 0, savings: 0, securities: 0, pension: 0, cardCredit: 0,
  totalAssets: 61_780_000, overdraft: 2_650_000, cardDebt: 689_000, loanDebt: 37_400_000,
  totalLiabilities: 40_740_000, netWorth: 21_040_000,
} as unknown as BalanceSheet;

const baseProps = {
  today: "2026-11-10",
  lastRecordDate: "2026-11-05",
  monthExpense: 76_691,
  monthIncome: 0,
  monthInvesting: 750_000,
  beforePayday: true,
  pace: { currentExpense: 76_691, elapsed: 5, totalDays: 30, avgPrev3: 2_000_000, avgPrevPartial: 300_000, share: 0.15, projectedExpense: 511_273 },
  bs,
  netWorthSeries: [{ month: "2026-09", value: 10_000_000 }, { month: "2026-10", value: 20_000_000 }],
  netWorthBasis: "market" as const,
  nextLoan: { name: "초기창업패키지", maturityDate: "2028-12-31", balance: 5_000_000 },
  invest: { totalInvestmentAssets: 45_850_000, principal: 54_880_000, cumulativePnl: -9_030_000 },
  allUnpriced: false,
  quotesLoading: false,
  unpricedCount: 0,
  unrealizedPnl: -12_040_000,
  excludedUnreliable: 0,
  dividend: null,
  recurringMissing: 3,
};

describe("DashboardGlance", () => {
  it("세 기둥 질문 제목과 핵심 숫자, 기록 기준", () => {
    render(<DashboardGlance {...baseProps} />);
    expect(screen.getByText("이번 달 얼마 썼나")).toBeTruthy();
    expect(screen.getByText("내 자산은")).toBeTruthy();
    expect(screen.getByText("투자·배당은")).toBeTruthy();
    expect(screen.getByText(/5일까지 기록/)).toBeTruthy();
    expect(screen.getByText(/급여 전/)).toBeTruthy();
    expect(screen.getByText(/가까운 만기 2028\.12 · 초기창업패키지/)).toBeTruthy();
  });

  it("확인할 일 — 기록 공백 3일 이상·카드·미등록 반복지출 칩, 반복지출 칩은 배지 이벤트를 쏜다", () => {
    const onOpen = vi.fn();
    window.addEventListener(OPEN_RECURRING_DUE_EVENT, onOpen);
    render(<DashboardGlance {...baseProps} />);
    expect(screen.getByText("기록 공백 5일")).toBeTruthy();
    expect(screen.getByText(/카드 갚을 돈/)).toBeTruthy();
    fireEvent.click(screen.getByText("미등록 반복지출 3건"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_RECURRING_DUE_EVENT, onOpen);
  });

  it("투자 기둥에 평가손익(주식 탭과 같은 값)을 총 손익과 구분해 보여준다", () => {
    render(<DashboardGlance {...baseProps} />);
    expect(screen.getByText(/평가손익/).textContent).toContain("1,204만원");
  });

  it("순자산 증감의 마지막 점은 지금 시가 순자산 — 원가 기준 지난 점과 비교해 평가손실을 증가로 더하지 않는다", () => {
    render(<DashboardGlance {...baseProps} netWorthBasis="cost" netWorthSeries={[{ month: "2025-06", value: -10_000_000 }, { month: "2026-11", value: 35_000_000 }]} />);
    // 21,040,000 − (−10,000,000) = +3,104만
    expect(screen.getByText(/1개월/).textContent).toContain("+3,104만원");
  });

  it("할 일이 없으면 확인할 일 줄을 그리지 않는다", () => {
    render(<DashboardGlance {...baseProps} lastRecordDate="2026-11-10" recurringMissing={0} bs={{ ...bs, cardDebt: 0 } as BalanceSheet} />);
    expect(screen.queryByText("확인할 일")).toBeNull();
  });

  it("시세 미로드면 총 손익을 숫자로 단정하지 않는다 + 환율 불명 제외 건수 표시", () => {
    render(<DashboardGlance {...baseProps} allUnpriced quotesLoading unrealizedPnl={null} excludedUnreliable={7} />);
    expect(screen.getByText(/총 손익 — 시세 불러오는 중/)).toBeTruthy();
    expect(screen.getByText(/환율 불명 7건 제외/)).toBeTruthy();
  });

  it("시세 갱신이 끝났는데도 시세가 없으면 '불러오는 중'으로 남기지 않는다", () => {
    render(<DashboardGlance {...baseProps} allUnpriced quotesLoading={false} unrealizedPnl={null} excludedUnreliable={0} />);
    expect(screen.queryByText(/시세 불러오는 중/)).toBeNull();
    expect(screen.getByText(/시세를 받지 못함/)).toBeTruthy();
  });
});
