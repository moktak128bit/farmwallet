/**
 * 일일손익 계산 헬퍼 — 시세 출처마다 등락 필드가 다르다.
 * 야후는 change(전일 대비 가격 차)를 주지만 업비트(암호화폐) 시세엔 changePercent만 있어,
 * `change ?? 0`이면 솔라나 −2.30%(−19만)가 일일손익에서 통째로 빠졌다.
 */
import type { StockPrice } from "../../types";

/** 주당 전일 대비 변동 — change가 없으면 changePercent로 역산 (전일가 = 현재가 ÷ (1 + 등락률)) */
export function dayChangePerShare(p: Pick<StockPrice, "price" | "change" | "changePercent"> | undefined): number {
  if (!p) return 0;
  if (typeof p.change === "number" && Number.isFinite(p.change)) return p.change;
  const pct = p.changePercent;
  const price = p.price;
  if (typeof pct !== "number" || !Number.isFinite(pct) || !(price > 0) || pct <= -100) return 0;
  const prev = price / (1 + pct / 100);
  return price - prev;
}

/** 일일 수익률(%) — 분모는 전일 평가액(오늘 평가액 − 일일손익). 오늘 평가액으로 나누면 등락률이 작게 나온다. */
export function dayPnlPercent(marketValue: number, dayPnl: number): number | null {
  const prev = marketValue - dayPnl;
  return prev > 0 ? (dayPnl / prev) * 100 : null;
}
