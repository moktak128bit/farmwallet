/**
 * FIFO lot 소비 단일 프리미티브 — 매도 시 보유 lot을 선입선출로 차감하고 소비된 비용/가치를 계산한다.
 *
 * 기존엔 이 while-루프가 usCapitalGainsTax(양도세)·investmentRecord(투자성적표)·StockDetailModal(평단)에
 * 각각 손으로 복제돼 있었다. 머니매스라 한 곳의 버그가 손익·세금·배당율을 동시에 오염시킬 수 있어 단일화한다.
 *
 * 규약:
 *  - lot.value = 그 lot 전체의 비용/가치. 단가 = value / qty. 일부 소비 시 비례 차감.
 *  - queue를 **제자리(in-place)** 로 변경: 부분 소비된 lot은 qty/value가 줄고, 소진된 lot은 shift로 제거.
 *  - oversell(보유보다 많이 매도, 데이터 손상/공매도)이면 **가능한 만큼만** 소비하고 멈춘다
 *    (consumedQty < qty). 호출부가 부족분을 비용 0으로 볼지 판단.
 */

export interface FifoLot {
  qty: number;
  /** 이 lot 전체의 비용/가치 (단가 = value / qty) */
  value: number;
}

interface FifoConsumeResult {
  /** 소비된 수량의 가치 합 (= Σ 단가 × 사용량) */
  consumedValue: number;
  /** 실제 소비된 수량 — oversell이면 queue 잔량 총합으로 제한됨 */
  consumedQty: number;
}

/**
 * queue에서 `qty`만큼 FIFO 소비. 각 lot 소비 시 onConsume(lot, used) 콜백으로 추가 집계 가능
 * (예: 가중 매수일). 콜백은 lot.qty/value가 차감되기 **전**에 호출된다.
 */
export function consumeFifoLots<L extends FifoLot>(
  queue: L[],
  qty: number,
  onConsume?: (lot: L, used: number) => void
): FifoConsumeResult {
  let remaining = qty;
  let consumedValue = 0;
  let consumedQty = 0;
  while (remaining > 0 && queue.length > 0) {
    const lot = queue[0];
    const use = Math.min(remaining, lot.qty);
    const unit = lot.qty > 0 ? lot.value / lot.qty : 0;
    consumedValue += unit * use;
    consumedQty += use;
    onConsume?.(lot, use);
    lot.qty -= use;
    lot.value = unit * lot.qty;
    remaining -= use;
    if (lot.qty <= 0) queue.shift();
  }
  return { consumedValue, consumedQty };
}
