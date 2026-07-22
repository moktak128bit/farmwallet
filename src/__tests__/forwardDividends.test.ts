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

  it("거래 이력이 없는 티커(맵에 없음)는 매도 판정 불가 → 폴백으로 과거액 유지", () => {
    // 티커 오탐('OK저축은행 배당'의 OK 등)·앱 밖 보유가 이 경로 — 0 처리하면 계속 받는 배당이 조용히 사라진다
    const r = buildForwardDividends(
      [divT("2026-03-10", 50_000, "AAPL", 10)],
      "2026-06-15",
      null,
      { currentQtyByTicker: new Map() }
    );
    expect(find(r.months, "2027-03").amountKRW).toBe(50_000);
  });

  it("비티커 영문 토큰 오탐: 'OK저축은행 배당'은 거래 이력이 없으므로 투영 유지", () => {
    const entry: LedgerEntry = {
      id: "ok1", date: "2026-03-24", kind: "income", category: "수입", subCategory: "이자",
      description: "이자 - OK저축은행 배당", amount: 4_619,
    };
    const r = buildForwardDividends([entry], "2026-06-15", null, {
      currentQtyByTicker: new Map([[canonicalTickerForMatch("005930"), 10]]),
    });
    expect(find(r.months, "2027-03").amountKRW).toBe(4_619); // 'OK'로 오탐돼도 0 소거되지 않음
  });

  it("같은 종목 다계좌 동일 지급일은 합산 후 한 번에 스케일 (계좌 수만큼 부풀지 않음)", () => {
    // A계좌 10주(10,000원) + B계좌 5주(5,000원), 현재 총 15주 → 15,000원 그대로 (2배 아님)
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 15]]);
    const r = buildForwardDividends(
      [divT("2026-03-10", 10_000, "AAPL", 10), divT("2026-03-10", 5_000, "AAPL", 5)],
      "2026-06-15",
      null,
      { currentQtyByTicker: qtyMap }
    );
    expect(find(r.months, "2027-03").amountKRW).toBe(15_000);
    expect(r.trailing12KRW).toBe(15_000);
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

describe("buildForwardDividends — 창 경계 (이중 계상·결측 방지)", () => {
  it("월배당 지급일 당일: 작년 같은 날 지급이 실적·투영에 이중으로 잡히지 않는다", () => {
    // 매월 22일 지급 10,000원, 2025-07-22 ~ 2026-07-22 (13건). today = 지급일 당일.
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 13; i += 1) {
      const y = 2025 + Math.floor((6 + i) / 12);
      const m = ((6 + i) % 12) + 1;
      entries.push(div(`${y}-${String(m).padStart(2, "0")}-22`, 10_000));
    }
    const r = buildForwardDividends(entries, "2026-07-22");
    expect(r.trailing12KRW).toBe(120_000); // 12회분 (13회 아님 — 365일 반개구간)
    expect(find(r.months, "2027-07").amountKRW).toBe(10_000); // 2배 아님 (최신 버킷만)
    expect(r.annualTotalKRW).toBe(120_000);
  });

  it("지급일이 앞으로 당겨진 해(작년 7/28 → 올해 7/5): 해당 월 투영이 2배가 되지 않는다", () => {
    const r = buildForwardDividends(
      [div("2025-07-28", 10_000), div("2026-07-05", 10_000)],
      "2026-07-22"
    );
    expect(find(r.months, "2027-07").amountKRW).toBe(10_000); // 올해(최신) 버킷만 사용
  });

  it("지급일이 뒤로 밀려 올해 아직 미지급이면 작년 버킷으로 폴백 (0으로 빠지지 않음)", () => {
    // 작년 7/5 지급, 올해는 아직 (today 7/22 < 올해 지급일). 365일 창밖이라 실적엔 없지만 투영은 유지.
    const r = buildForwardDividends([div("2025-07-05", 10_000)], "2026-07-22");
    expect(r.trailing12KRW).toBe(0);
    expect(find(r.months, "2027-07").amountKRW).toBe(10_000);
  });

  it("폴백은 스트림(종목) 단위 — 이번 달 다른 종목 지급이 미지급 종목의 작년 버킷을 가리지 않는다", () => {
    // A는 이번 달 10일 이미 지급, B는 25일 지급이라 아직 (작년 7/25 기록만 있음).
    // 월 합계 단위 폴백이면 2027-07 = A만 잡혀 B의 1년치가 통째로 사라진다.
    const qtyMap = new Map([
      [canonicalTickerForMatch("AAA"), 10],
      [canonicalTickerForMatch("BBB"), 10],
    ]);
    const r = buildForwardDividends(
      [divT("2026-07-10", 10_000, "AAA", 10), divT("2025-07-25", 20_000, "BBB", 10)],
      "2026-07-22",
      null,
      { currentQtyByTicker: qtyMap }
    );
    expect(find(r.months, "2027-07").amountKRW).toBe(30_000); // A 10,000 + B 20,000 (10,000 아님)
  });

  it("같은 계좌·같은 날 복수 배당 기록(정규+특별)은 보유를 한 번만 세어 스케일 (1/N 축소 회귀 방지)", () => {
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 100]]);
    const r = buildForwardDividends(
      [
        { ...divT("2026-03-10", 25_000, "AAPL", 100), toAccountId: "A" },
        { ...divT("2026-03-10", 50_000, "AAPL", 100), toAccountId: "A" },
      ],
      "2026-06-15",
      null,
      { currentQtyByTicker: qtyMap }
    );
    // 75,000 × (100/100) = 75,000 — qtyAt 이중 합산(100/200 → 37,500)이 아님
    expect(find(r.months, "2027-03").amountKRW).toBe(75_000);
  });

  it("다계좌 입금일이 1~2일 어긋나도 같은 달이면 하나의 지급 이벤트로 묶어 스케일", () => {
    const qtyMap = new Map([[canonicalTickerForMatch("AAPL"), 150]]);
    const r = buildForwardDividends(
      [
        { ...divT("2026-06-12", 100_000, "AAPL", 100), toAccountId: "A" },
        { ...divT("2026-06-13", 50_000, "AAPL", 50), toAccountId: "B" }, // B증권사는 하루 늦게 입금
      ],
      "2026-07-22",
      null,
      { currentQtyByTicker: qtyMap }
    );
    // 150,000 × (150/150) = 150,000 — 날짜 분리 그룹의 계좌별 이중 스케일(300,000)이 아님
    expect(find(r.months, "2027-06").amountKRW).toBe(150_000);
  });
});
