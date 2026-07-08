/**
 * 통화 환산 단일 소스 — 분산돼 있던 `currency === "USD" && fxRate ? amount * fxRate : amount`
 * 패턴을 한 곳으로 모은다(대시보드·보고서·가계부·주식·배당 합산이 같은 정의를 공유).
 *
 * USD 금액을 환율로 원화 환산한다.
 *  - KRW(또는 통화 미지정): 액면 그대로.
 *  - USD: 환율이 있으면 환산, 없으면 액면 그대로(대시보드 공통 정책).
 *    환율은 FxRateContext가 캐시(LAST_FX_RATE)에서 동기 초기화하므로 미로드는 드문 엣지이며,
 *    이때 0으로 떨어뜨리면 USD 보유분이 통째로 사라져 오히려 혼란을 준다 — 액면 유지가 더 안전.
 */
export function toKrwByRate(
  amount: number,
  currency: string | undefined,
  fxRate: number | null | undefined
): number {
  return currency === "USD" && fxRate ? amount * fxRate : amount;
}
