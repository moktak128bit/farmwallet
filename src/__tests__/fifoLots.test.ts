/** FIFO lot 소비 프리미티브 — 부분-lot 분할·oversell·다중 lot 경계 */
import { describe, expect, it } from "vitest";
import { consumeFifoLots, type FifoLot } from "../utils/fifoLots";

describe("consumeFifoLots", () => {
  it("단일 lot 전량 소비", () => {
    const q: FifoLot[] = [{ qty: 10, value: 1000 }];
    const r = consumeFifoLots(q, 10);
    expect(r.consumedValue).toBe(1000);
    expect(r.consumedQty).toBe(10);
    expect(q.length).toBe(0); // 소진 → 제거
  });

  it("부분 소비 — 단가 비례 차감, lot 잔존", () => {
    const q: FifoLot[] = [{ qty: 10, value: 1000 }]; // 단가 100
    const r = consumeFifoLots(q, 3);
    expect(r.consumedValue).toBe(300);
    expect(r.consumedQty).toBe(3);
    expect(q).toEqual([{ qty: 7, value: 700 }]);
  });

  it("여러 매수 lot에 걸친 매도 — 서로 다른 단가가 정확히 합산", () => {
    // lot1: 5주@100(500), lot2: 5주@200(1000). 7주 매도 → 5×100 + 2×200 = 900
    const q: FifoLot[] = [
      { qty: 5, value: 500 },
      { qty: 5, value: 1000 },
    ];
    const r = consumeFifoLots(q, 7);
    expect(r.consumedValue).toBe(900);
    expect(r.consumedQty).toBe(7);
    expect(q).toEqual([{ qty: 3, value: 600 }]); // lot2 잔량 3주@200
  });

  it("oversell — 보유보다 많이 매도하면 가능한 만큼만 소비", () => {
    const q: FifoLot[] = [{ qty: 4, value: 400 }];
    const r = consumeFifoLots(q, 10);
    expect(r.consumedQty).toBe(4); // 4주만 소비
    expect(r.consumedValue).toBe(400);
    expect(q.length).toBe(0);
    // 호출부는 부족분(6주)을 비용 0으로 처리해야 함 (consumedQty로 감지)
  });

  it("빈 queue 매도 — 아무것도 소비 안 함", () => {
    const q: FifoLot[] = [];
    const r = consumeFifoLots(q, 5);
    expect(r).toEqual({ consumedValue: 0, consumedQty: 0 });
  });

  it("onConsume 콜백으로 가중 매수일 집계 (investmentRecord 패턴)", () => {
    type DatedLot = FifoLot & { dateMs: number };
    const q: DatedLot[] = [
      { qty: 4, value: 400, dateMs: 100 },
      { qty: 4, value: 800, dateMs: 200 },
    ];
    let weightedDateMs = 0;
    let weightSum = 0;
    const r = consumeFifoLots(q, 6, (lot, used) => {
      weightedDateMs += lot.dateMs * used;
      weightSum += used;
    });
    expect(r.consumedQty).toBe(6);
    expect(r.consumedValue).toBe(4 * 100 + 2 * 200); // 800
    // 가중 매수일 = (4×100 + 2×200) / 6
    expect(weightedDateMs / weightSum).toBeCloseTo((4 * 100 + 2 * 200) / 6, 6);
  });

  it("연속 매도 — queue가 누적 상태로 유지됨", () => {
    const q: FifoLot[] = [{ qty: 10, value: 1000 }];
    consumeFifoLots(q, 4); // 6주@100 남음
    const r2 = consumeFifoLots(q, 4);
    expect(r2.consumedValue).toBe(400);
    expect(q).toEqual([{ qty: 2, value: 200 }]);
  });
});
