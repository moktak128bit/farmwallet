/** C1 — 선행 배당 캘린더 (buildForwardDividends) */
import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { buildForwardDividends } from "../utils/forwardDividends";
import { canonicalTickerForMatch } from "../utils/finance";

const div = (date: string, amount: number, currency?: "USD"): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date,
  kind: "income",
  category: "배당",
  description: "배당",
  amount,
  ...(currency ? { currency } : {}),
});

/** 티커·보유수량 메타를 가진 배당 항목 (보유 반영 테스트용) */
const divT = (date: string, amount: number, ticker: string, qty?: number): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date,
  kind: "income",
  category: "배당",
  description: `${ticker} - 종목 배당`,
  amount,
  ...(qty != null ? { note: `보유주식: ${qty}` } : {}),
});

const find = (months: { month: string; amountKRW: number }[], ym: string) =>
  months.find((m) => m.month === ym)!;

describe("buildForwardDividends", () => {
  it("최근 12개월 배당을 같은 달에 향후로 투영한다", () => {
    // today 2026-06-15, trailing window [2025-06-15, 2026-06-15]
    const r = buildForwardDividends(
      [
        div("2025-08-10", 80_000), // 8월
        div("2026-02-10", 100_000), // 2월
        div("2026-05-10", 50_000), // 5월
        div("2024-05-10", 999_999), // 윈도우 밖 → 제외
      ],
      "2026-06-15"
    );
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe("2026-07"); // 다음 달부터
    expect(find(r.months, "2026-08").amountKRW).toBe(80_000);
    expect(find(r.months, "2027-02").amountKRW).toBe(100_000);
    expect(find(r.months, "2027-05").amountKRW).toBe(50_000);
    expect(find(r.months, "2026-09").amountKRW).toBe(0);
    expect(r.annualTotalKRW).toBe(230_000);
    expect(r.trailing12KRW).toBe(230_000);
  });

  it("USD 배당은 환율로 환산", () => {
    const r = buildForwardDividends([div("2026-03-10", 100, "USD")], "2026-06-15", 1_300);
    expect(r.trailing12KRW).toBe(130_000);
    expect(find(r.months, "2027-03").amountKRW).toBe(130_000);
  });

  it("배당이 아닌 수입은 무시", () => {
    const r = buildForwardDividends(
      [{ id: "x", date: "2026-03-10", kind: "income", category: "급여", description: "월급", amount: 3_000_000 }],
      "2026-06-15"
    );
    expect(r.trailing12KRW).toBe(0);
    expect(r.annualTotalKRW).toBe(0);
  });

  it("배당 기록이 없으면 모두 0", () => {
    const r = buildForwardDividends([], "2026-06-15");
    expect(r.months).toHaveLength(12);
    expect(r.annualTotalKRW).toBe(0);
  });
});

describe("buildForwardDividends — 보유 반영(currentQtyByTicker)", () => {
  it("매도해 보유 0인 종목은 미래 투영에서 제외(실적엔 남음)", () => {
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 0]]);
    const r = buildForwardDividends(
      [divT("2026-02-10", 100_000, "AAPL", 10)],
      "2026-06-15",
      null,
      { currentQtyByTicker: qtyMap }
    );
    expect(r.trailing12KRW).toBe(100_000); // 실적은 그대로
    expect(find(r.months, "2027-02").amountKRW).toBe(0); // 미래는 0 (매도)
    expect(r.annualTotalKRW).toBe(0);
  });

  it("보유 수량이 늘면 (현재/배당당시) 비례 스케일", () => {
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 20]]); // 배당당시 10 → 현재 20
    const r = buildForwardDividends(
      [divT("2026-03-10", 50_000, "AAPL", 10)],
      "2026-06-15",
      null,
      { currentQtyByTicker: qtyMap }
    );
    expect(r.trailing12KRW).toBe(50_000);
    expect(find(r.months, "2027-03").amountKRW).toBe(100_000); // 2배
    expect(r.annualTotalKRW).toBe(100_000);
  });

  it("보유 정보가 없는(맵에 없는) 종목은 0으로 간주 → 미래 제외", () => {
    const r = buildForwardDividends(
      [divT("2026-03-10", 50_000, "AAPL", 10)],
      "2026-06-15",
      null,
      { currentQtyByTicker: new Map() }
    );
    expect(find(r.months, "2027-03").amountKRW).toBe(0);
  });

  it("티커를 못 잡는 배당(채권이자 등)은 폴백으로 과거액 유지", () => {
    const r = buildForwardDividends(
      [div("2026-03-10", 30_000)], // description "배당" → 티커 없음
      "2026-06-15",
      null,
      { currentQtyByTicker: new Map([["AAPL", 10]]) }
    );
    expect(find(r.months, "2027-03").amountKRW).toBe(30_000);
  });

  it("note에 수량이 없으면 스케일 불가 → 보유>0이면 과거액 유지", () => {
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 20]]);
    const r = buildForwardDividends(
      [divT("2026-03-10", 50_000, "AAPL")], // 수량 note 없음
      "2026-06-15",
      null,
      { currentQtyByTicker: qtyMap }
    );
    expect(find(r.months, "2027-03").amountKRW).toBe(50_000);
  });
});
