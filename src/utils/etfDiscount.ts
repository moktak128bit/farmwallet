/**
 * ETF 괴리율(시장가 vs NAV) 분석 — 순수 파싱·계산 모듈 (네트워크 의존 없음).
 *
 * 괴리율 = (시장가 − NAV) / NAV × 100.
 *  - 음수(시장가 < NAV) = 저평가(할인) → 잠재 매수 기회
 *  - 양수(시장가 > NAV) = 고평가(프리미엄)
 *
 * 데이터 출처: 네이버 ETF 목록 API(finance.naver.com/api/sise/etfItemList.nhn).
 * 주의: 여기서 받는 nav는 네이버 제공 NAV(전일/지연 기준)로, 장중 실시간 iNAV가 아니다.
 * 장중에는 기초자산 변동분이 NAV에 즉시 반영되지 않아 괴리율이 실제보다 과대/과소일 수 있다.
 */

export interface EtfDiscountRow {
  /** 종목코드 (6자리) */
  code: string;
  /** 종목명 */
  name: string;
  /** 현재가 (nowVal) */
  price: number;
  /** NAV (네이버 제공) */
  nav: number;
  /** 괴리율 % = (price − nav) / nav × 100 */
  gapPct: number;
  /** 등락률 % */
  changeRate: number;
  /** 거래량 (유동성 참고용) */
  volume: number;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 네이버 etfItemList 응답(JSON 파싱 결과)을 괴리율 행 배열로 변환.
 * nav·price가 유효하지 않은 항목은 제외하고, 괴리율 오름차순(저평가 먼저)으로 정렬한다.
 */
export function parseEtfItemList(json: unknown): EtfDiscountRow[] {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const result = root && typeof root.result === "object" ? (root.result as Record<string, unknown>) : null;
  const list = result && Array.isArray(result.etfItemList) ? (result.etfItemList as unknown[]) : null;
  if (!list) return [];

  const rows: EtfDiscountRow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const code = String(it.itemcode ?? "").trim();
    const name = String(it.itemname ?? "").trim();
    const price = num(it.nowVal);
    const nav = num(it.nav);
    if (!code || !name) continue;
    if (!(price > 0) || !(nav > 0)) continue; // NaN·0·음수 제외
    const changeRate = num(it.changeRate);
    const volume = num(it.quant);
    rows.push({
      code,
      name,
      price,
      nav,
      gapPct: ((price - nav) / nav) * 100,
      changeRate: Number.isFinite(changeRate) ? changeRate : 0,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  // 괴리율 오름차순 — 가장 저평가(음수)인 종목이 위로
  rows.sort((a, b) => a.gapPct - b.gapPct);
  return rows;
}

/**
 * 저평가 ETF 선별 — 괴리율이 임계값 이하(기본 0%, 즉 할인)이고 거래량이 최소 기준 이상인 종목만.
 * @param rows parseEtfItemList 결과 (이미 괴리율 오름차순 정렬됨)
 * @param opts.maxGapPct 괴리율 상한(이하만 포함). 기본 0 = 할인 종목만.
 * @param opts.minVolume 최소 거래량(유동성 필터). 기본 0 = 제한 없음.
 */
export function filterDiscountedEtfs(
  rows: EtfDiscountRow[],
  opts?: { maxGapPct?: number; minVolume?: number }
): EtfDiscountRow[] {
  const maxGap = opts?.maxGapPct ?? 0;
  const minVol = opts?.minVolume ?? 0;
  return rows.filter((r) => r.gapPct <= maxGap && r.volume >= minVol);
}
