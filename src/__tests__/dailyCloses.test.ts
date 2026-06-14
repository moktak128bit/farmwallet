/** 일별 종가 적립(utils/dailyCloses) — 보유 종목만·종목당 1건/일·월말 압축 보존 정책 */
import { describe, expect, it } from "vitest";
import type { HistoricalDailyClose, StockPrice, StockTrade } from "../types";
import { upsertDailyCloses } from "../utils/dailyCloses";

const buy = (ticker: string, qty = 10): StockTrade => ({
  id: `t-${ticker}`,
  date: "2026-01-02",
  accountId: "a1",
  ticker,
  name: ticker,
  side: "buy",
  quantity: qty,
  price: 10000,
  fee: 0,
  totalAmount: qty * 10000,
  cashImpact: -qty * 10000,
});
// updatedAt 기본값은 적립 기준일(2026-06-12 KST) 장중 — 오늘 갱신된 시세만 적립되는 가드 통과용
const px = (ticker: string, price: number, updatedAt = "2026-06-12T10:00:00+09:00"): StockPrice => ({
  ticker,
  price,
  updatedAt
});

describe("upsertDailyCloses", () => {
  const trades = [buy("458730"), buy("0167b0")]; // 소문자도 canonical 매칭

  it("보유 종목만 당일 1건씩 적립하고, 비보유 종목은 무시한다", () => {
    const r = upsertDailyCloses([], [px("458730", 15550), px("0167B0", 14180), px("005930", 60000)], trades, "2026-06-12");
    expect(r).not.toBeNull();
    expect(r!.map((c) => c.ticker).sort()).toEqual(["0167B0", "458730"]); // 005930 비보유 → 제외
    expect(r!.every((c) => c.date === "2026-06-12")).toBe(true);
  });

  it("같은 날 재갱신이면 마지막 값으로 교체 (중복 누적 없음)", () => {
    const first = upsertDailyCloses([], [px("458730", 15500)], trades, "2026-06-12")!;
    const second = upsertDailyCloses(first, [px("458730", 15550)], trades, "2026-06-12")!;
    expect(second.filter((c) => c.ticker === "458730")).toHaveLength(1);
    expect(second[0].close).toBe(15550);
  });

  it("값까지 같으면 null 반환 (불필요한 상태 갱신 방지)", () => {
    const first = upsertDailyCloses([], [px("458730", 15550)], trades, "2026-06-12")!;
    expect(upsertDailyCloses(first, [px("458730", 15550)], trades, "2026-06-12")).toBeNull();
  });

  it("120일 이전 데이터는 종목·월당 마지막 1건(월말 종가)으로 압축한다", () => {
    // 2025-10월에 일별 3건 → 오늘(2026-06-12) 기준 cutoff 이전이므로 10-30 한 건만 남아야 함
    const old: HistoricalDailyClose[] = [
      { ticker: "458730", date: "2025-10-05", close: 12000 },
      { ticker: "458730", date: "2025-10-15", close: 12100 },
      { ticker: "458730", date: "2025-10-30", close: 12165 },
    ];
    const r = upsertDailyCloses(old, [px("458730", 15550)], trades, "2026-06-12")!;
    const oct = r.filter((c) => c.date.startsWith("2025-10"));
    expect(oct).toHaveLength(1);
    expect(oct[0].date).toBe("2025-10-30");
    expect(oct[0].close).toBe(12165);
    // 오늘 항목은 추가됨
    expect(r.some((c) => c.date === "2026-06-12" && c.close === 15550)).toBe(true);
  });

  it("최근 120일 이내는 일별 그대로 보존한다", () => {
    const recent: HistoricalDailyClose[] = [
      { ticker: "458730", date: "2026-05-02", close: 15000 },
      { ticker: "458730", date: "2026-05-03", close: 15050 },
    ];
    const r = upsertDailyCloses(recent, [px("458730", 15550)], trades, "2026-06-12")!;
    expect(r.filter((c) => c.date.startsWith("2026-05"))).toHaveLength(2);
  });

  it("stale 시세는 오늘이 아닌 체결일 날짜로 적립한다 (주말 갱신 시 금요일 종가 보존)", () => {
    // 이틀 전 updatedAt — 오늘 날짜로 오기록되면 안 되고, 체결일(06-10)로 기록되어야 함
    const r = upsertDailyCloses([], [px("458730", 15550, "2026-06-10T15:30:00+09:00")], trades, "2026-06-12")!;
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe("2026-06-10");
    expect(r[0].close).toBe(15550);
    // updatedAt 자체가 없으면 신선도를 알 수 없으므로 적립하지 않음
    expect(upsertDailyCloses([], [{ ticker: "458730", price: 15550 }], trades, "2026-06-12")).toBeNull();
  });

  it("price=0 시세는 적립하지 않는다 (종가 히스토리 0 오염 방지)", () => {
    expect(upsertDailyCloses([], [px("458730", 0)], trades, "2026-06-12")).toBeNull();
  });
});
