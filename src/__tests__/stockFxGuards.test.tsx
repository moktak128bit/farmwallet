// @vitest-environment jsdom
/**
 * 주식 거래 환율(fxRateAtTrade) 회귀 — 수정 시 환율 보존·이상치 무시·잔액모드 환율 저장·환율 미로드 차단,
 * 매매 내역의 엉터리 '잔액' 표시 제거, 환율 미로드 시 계좌 헤더 USD 액면 합산 방지.
 */
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "react-hot-toast";
import type { Account, PositionRow, StockPrice, StockTrade } from "../types";

vi.mock("../yahooFinanceApi", () => ({ fetchYahooQuotes: vi.fn(() => Promise.resolve([])) }));
vi.mock("../storage", () => ({ saveTickerToJson: vi.fn(() => Promise.resolve()) }));

import { TradeFormSection, type TradeFormSectionHandle } from "../features/stocks/TradeFormSection";
import { TradeHistorySection } from "../features/stocks/TradeHistorySection";
import { PositionListSection } from "../features/stocks/PositionListSection";
import { computePositions } from "../calculations";

const KRW_SEC: Account = { id: "S1", name: "증권", type: "securities", institution: "", initialBalance: 0 };
/** currency=USD → USD 잔액 모드 (cashImpact 0, usdBalance로만 반영) */
const USD_SEC: Account = { id: "U1", name: "달러증권", type: "securities", institution: "", initialBalance: 0, currency: "USD" };
const AAPL_QUOTE: StockPrice = { ticker: "AAPL", name: "Apple", price: 100, currency: "USD" };

const usdBuy = (over: Partial<StockTrade> = {}): StockTrade => ({
  id: "T1", date: "2026-01-05", accountId: "S1", ticker: "AAPL", name: "Apple", side: "buy",
  quantity: 10, price: 100, fee: 0, totalAmount: 1000, cashImpact: -1_300_000, fxRateAtTrade: 1300, ...over,
});

beforeAll(() => {
  // prefillTrade/startQuickTrade가 폼으로 스크롤 — jsdom 미구현
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(opts: { trades?: StockTrade[]; fxRate?: number | null }) {
  const ref = React.createRef<TradeFormSectionHandle>();
  const onChangeTrades = vi.fn();
  const trades = opts.trades ?? [];
  render(
    <TradeFormSection
      ref={ref}
      visible
      accounts={[KRW_SEC, USD_SEC]}
      trades={trades}
      prices={[AAPL_QUOTE]}
      ledger={[]}
      tickerDatabase={[]}
      positions={[]}
      latestPriceByCanonicalTicker={new Map([["AAPL", AAPL_QUOTE]])}
      fxRate={opts.fxRate === undefined ? 1400 : opts.fxRate}
      onChangeTrades={onChangeTrades}
      onChangePrices={vi.fn()}
      onChangeTickerDatabase={vi.fn()}
      onChangeAccounts={vi.fn()}
      setQuoteError={vi.fn()}
    />
  );
  /** onChangeTrades(updater)를 trades에 적용한 결과 — 호출 없으면 null */
  const saved = (): StockTrade[] | null => {
    const arg = onChangeTrades.mock.calls[0]?.[0];
    if (!arg) return null;
    return typeof arg === "function" ? arg(trades) : arg;
  };
  return { ref, saved };
}

describe("TradeFormSection — USD 거래 수정 시 매입 당시 환율 보존 (K1)", () => {
  it("USD 단가만 바꾸면 fxRateAtTrade는 그대로(1300) — 원화 칸의 옛 값으로 환율이 역산되지 않는다", () => {
    const old = usdBuy();
    const { ref, saved } = renderForm({ trades: [old] });
    act(() => ref.current!.startEditTrade(old));
    fireEvent.change(screen.getByPlaceholderText("달러"), { target: { value: "110" } });
    act(() => ref.current!.submit());
    const t = saved()!.find((x) => x.id === "T1")!;
    expect(t.fxRateAtTrade).toBe(1300); // 예전: (10×130,000)/(10×110) = 1181.8
    expect(t.totalAmount).toBe(1100);
    expect(t.cashImpact).toBe(-1_430_000); // 예전: -1,300,000
  });

  it("원화 단가를 직접 고치면 입력값으로 환율을 다시 계산한다", () => {
    const old = usdBuy();
    const { ref, saved } = renderForm({ trades: [old] });
    act(() => ref.current!.startEditTrade(old));
    fireEvent.change(screen.getByPlaceholderText("달러"), { target: { value: "110" } });
    fireEvent.change(screen.getAllByPlaceholderText("원화")[0], { target: { value: "154000" } });
    act(() => ref.current!.submit());
    expect(saved()!.find((x) => x.id === "T1")!.fxRateAtTrade).toBe(1400); // 1,540,000 / 1,100
  });
});

describe("TradeFormSection — 환율 저장 규칙 (K5·K10a)", () => {
  it("USD 잔액 모드 계좌도 거래 당시 환율을 저장한다 (cashImpact는 0 유지)", () => {
    const { ref, saved } = renderForm({ fxRate: 1400 });
    act(() => ref.current!.prefillTrade({ accountId: "U1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10 }));
    act(() => ref.current!.submit());
    const [t] = saved()!;
    expect(t.fxRateAtTrade).toBe(1400);
    expect(t.cashImpact).toBe(0);
  });

  it("환율 미로드면 USD 저장 차단 (기본값 1400으로 저장하지 않는다)", () => {
    const err = vi.spyOn(toast, "error");
    const { ref, saved } = renderForm({ fxRate: null });
    act(() => ref.current!.prefillTrade({ accountId: "S1", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10 }));
    act(() => ref.current!.submit());
    expect(saved()).toBeNull();
    expect(err).toHaveBeenCalled();
  });
});

describe("TradeHistorySection (K5·K8)", () => {
  const renderHistory = (trades: StockTrade[], onChangeTrades = vi.fn()) =>
    render(
      <TradeHistorySection
        trades={trades}
        accounts={[KRW_SEC, USD_SEC]}
        prices={[AAPL_QUOTE]}
        fxRate={1400}
        onChangeTrades={onChangeTrades}
        onStartEditTrade={vi.fn()}
      />
    );

  it("빠른 복사 — USD 잔액 모드 거래도 복사본에 당시 환율 저장", () => {
    const onChangeTrades = vi.fn();
    const src = usdBuy({ accountId: "U1", cashImpact: 0 });
    renderHistory([src], onChangeTrades);
    fireEvent.click(screen.getByLabelText("복사"));
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    const [copy] = onChangeTrades.mock.calls[0][0]([src]) as StockTrade[];
    expect(copy.id).not.toBe("T1");
    expect(copy.fxRateAtTrade).toBe(1400);
    expect(copy.cashImpact).toBe(0);
  });

  it("행에 '금액 / 잔액' 대신 금액만 — 잔액 미전달 시 0원·음수 잔액이 찍히던 문제", () => {
    const krw: StockTrade = {
      id: "K1", date: "2026-01-05", accountId: "S1", ticker: "005930", name: "삼성전자", side: "buy",
      quantity: 10, price: 70_000, fee: 0, totalAmount: 700_000, cashImpact: -700_000,
    };
    const { container } = renderHistory([krw]);
    const accountCell = container.querySelector('tr[data-trade-id="K1"]')!.querySelectorAll("td")[2];
    expect(accountCell.textContent).toContain("-700,000");
    expect(accountCell.textContent).not.toContain("/");
  });
});

describe("PositionListSection — 환율 미로드 시 USD는 원화 합계에서 제외 (K10c)", () => {
  it("평가금·계좌 합계에 USD 액면($1,500)을 원화로 더하지 않는다", () => {
    const base = { accountId: "S1", accountName: "증권", pnl: 0, pnlRate: 0, diff: 0, hasQuote: true };
    const rows = [
      { ...base, ticker: "AAPL", name: "Apple", quantity: 10, avgPrice: 100, totalBuyAmount: 1000, marketPrice: 150, marketValue: 1500, currency: "USD", displayMarketPrice: 150 },
      { ...base, ticker: "005930", name: "삼성전자", quantity: 10, avgPrice: 70_000, totalBuyAmount: 700_000, marketPrice: 70_000, marketValue: 700_000, currency: "KRW", displayMarketPrice: 70_000 },
    ] as Array<PositionRow & { displayMarketPrice: number; currency?: string; diff: number; hasQuote: boolean }>;
    const { container } = render(
      <PositionListSection
        positionsByAccount={[{ accountId: "S1", accountName: "증권", rows }]}
        balances={[]}
        accounts={[KRW_SEC]}
        prices={[]}
        tickerDatabase={[]}
        onChangeTickerDatabase={vi.fn()}
        fxRate={null}
        accountOrder={[]}
        onAccountReorder={vi.fn()}
        onPositionClick={vi.fn()}
        onQuickSell={vi.fn()}
        onQuickBuy={vi.fn()}
      />
    );
    const header = container.querySelector("h4")!.textContent ?? "";
    expect(header).toContain("평가금: 700,000 원");
    expect(header).toContain("계좌 합계: 700,000 원");
  });
});

describe("computePositions — 말이 안 되는 매입 환율(K2)", () => {
  it("fxRateAtTrade=1 로트는 '환율 없음'으로 보고 현재 환율 — 원가 383원으로 잡히지 않는다", () => {
    const rows = computePositions(
      [usdBuy({ ticker: "MSFT", quantity: 1, price: 383, totalAmount: 383, fxRateAtTrade: 1 })],
      [{ ticker: "MSFT", price: 400, currency: "USD" }],
      [KRW_SEC],
      { fxRate: 1400 }
    );
    expect(rows[0].totalBuyAmountKRW).toBe(383 * 1400);
  });
});
