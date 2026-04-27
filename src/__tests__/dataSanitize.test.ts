import { describe, it, expect } from "vitest";
import { sanitizeLedger, sanitizeTrades } from "../utils/dataSanitize";

describe("sanitizeLedger", () => {
  const goodLedger = {
    id: "l1",
    date: "2026-04-01",
    kind: "expense",
    category: "식비",
    description: "점심",
    amount: 12000,
  };

  it("정상 엔트리는 모두 통과", () => {
    const r = sanitizeLedger([goodLedger]);
    expect(r.clean).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("amount가 NaN이면 폐기", () => {
    const r = sanitizeLedger([{ ...goodLedger, amount: NaN }]);
    expect(r.clean).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it("amount가 문자열이면 폐기 (조용한 NaN 차단)", () => {
    const r = sanitizeLedger([{ ...goodLedger, amount: "12000" }]);
    expect(r.clean).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it("amount가 Infinity면 폐기", () => {
    const r = sanitizeLedger([{ ...goodLedger, amount: Infinity }]);
    expect(r.dropped).toBe(1);
  });

  it("id 누락 → 폐기", () => {
    const r = sanitizeLedger([{ ...goodLedger, id: "" }]);
    expect(r.dropped).toBe(1);
    const r2 = sanitizeLedger([{ ...goodLedger, id: undefined }]);
    expect(r2.dropped).toBe(1);
  });

  it("date 형식 잘못되면 폐기 (yyyy-mm-dd 아님)", () => {
    expect(sanitizeLedger([{ ...goodLedger, date: "2026/04/01" }]).dropped).toBe(1);
    expect(sanitizeLedger([{ ...goodLedger, date: "" }]).dropped).toBe(1);
    expect(sanitizeLedger([{ ...goodLedger, date: 20260401 }]).dropped).toBe(1);
  });

  it("kind가 알려진 값 아니면 폐기", () => {
    expect(sanitizeLedger([{ ...goodLedger, kind: "unknown" }]).dropped).toBe(1);
    expect(sanitizeLedger([{ ...goodLedger, kind: undefined }]).dropped).toBe(1);
  });

  it("description/category가 string이면 빈 문자열도 OK", () => {
    const r = sanitizeLedger([{ ...goodLedger, description: "", category: "" }]);
    expect(r.clean).toHaveLength(1);
  });

  it("description이 string 아니면 폐기 (null/숫자)", () => {
    expect(sanitizeLedger([{ ...goodLedger, description: null }]).dropped).toBe(1);
    expect(sanitizeLedger([{ ...goodLedger, description: 123 }]).dropped).toBe(1);
  });

  it("객체가 아닌 입력 — null, 문자열, 숫자 → 폐기", () => {
    const r = sanitizeLedger([null, "string", 42, undefined]);
    expect(r.clean).toHaveLength(0);
    expect(r.dropped).toBe(4);
  });

  it("정상 + 손상 섞인 입력 — 정상만 통과", () => {
    const r = sanitizeLedger([
      goodLedger,
      { ...goodLedger, id: "l2" },
      { ...goodLedger, amount: NaN, id: "bad" },
      null,
    ]);
    expect(r.clean).toHaveLength(2);
    expect(r.dropped).toBe(2);
  });

  it("droppedSamples는 폐기 시에만 포함", () => {
    const r1 = sanitizeLedger([goodLedger]);
    expect(r1.droppedSamples).toBeUndefined();
    const r2 = sanitizeLedger([{ ...goodLedger, amount: NaN }]);
    expect(r2.droppedSamples).toBeDefined();
    expect(r2.droppedSamples).toHaveLength(1);
  });
});

describe("sanitizeTrades", () => {
  const goodTrade = {
    id: "t1",
    date: "2026-04-01",
    accountId: "acc1",
    ticker: "005930",
    name: "삼성전자",
    side: "buy",
    quantity: 10,
    price: 70000,
    totalAmount: 700000,
    fee: 50,
    cashImpact: -700050,
  };

  it("정상 trade 통과", () => {
    const r = sanitizeTrades([goodTrade]);
    expect(r.clean).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("필수 문자열 누락 (ticker/name/accountId) → 폐기", () => {
    expect(sanitizeTrades([{ ...goodTrade, ticker: "" }]).dropped).toBe(1);
    expect(sanitizeTrades([{ ...goodTrade, name: "" }]).dropped).toBe(1);
    expect(sanitizeTrades([{ ...goodTrade, accountId: "" }]).dropped).toBe(1);
  });

  it("side가 buy/sell이 아니면 폐기", () => {
    expect(sanitizeTrades([{ ...goodTrade, side: "long" }]).dropped).toBe(1);
    expect(sanitizeTrades([{ ...goodTrade, side: undefined }]).dropped).toBe(1);
  });

  it("숫자 필드 NaN/Infinity → 폐기", () => {
    expect(sanitizeTrades([{ ...goodTrade, quantity: NaN }]).dropped).toBe(1);
    expect(sanitizeTrades([{ ...goodTrade, totalAmount: Infinity }]).dropped).toBe(1);
    expect(sanitizeTrades([{ ...goodTrade, fee: "abc" }]).dropped).toBe(1);
  });

  it("fxRateAtTrade는 선택적 — undefined면 통과, NaN이면 폐기", () => {
    expect(sanitizeTrades([{ ...goodTrade, fxRateAtTrade: undefined }]).dropped).toBe(0);
    expect(sanitizeTrades([{ ...goodTrade, fxRateAtTrade: 1400 }]).dropped).toBe(0);
    expect(sanitizeTrades([{ ...goodTrade, fxRateAtTrade: NaN }]).dropped).toBe(1);
  });

  it("정상 + 손상 섞인 입력", () => {
    const r = sanitizeTrades([
      goodTrade,
      { ...goodTrade, id: "t2" },
      { ...goodTrade, quantity: NaN, id: "bad" },
      null,
      "garbage",
    ]);
    expect(r.clean).toHaveLength(2);
    expect(r.dropped).toBe(3);
  });

  it("회귀: FIFO 계산 보호 — totalAmount NaN 트레이드가 폐기되어 후속 buildClosedTradeRecords가 안전", () => {
    const r = sanitizeTrades([
      goodTrade,
      { ...goodTrade, totalAmount: NaN, id: "corrupt" },
    ]);
    expect(r.clean).toHaveLength(1);
    expect(r.clean[0].id).toBe("t1");
  });
});
