/**
 * 선행 배당 캘린더 (C1) — 최근 12개월 배당 실적을 같은 달에 반복한다고 가정해 향후 12개월 예상 배당
 * 일정·금액을 만든다. "현금이 언제 얼마 들어오는가"(현금흐름 계획)가 핵심 가치.
 *
 * 창 규칙 (경계 이중 계상 방지):
 *  - 실적(trailing12KRW): (today−365, today] 반개구간 365일. 양끝 포함(366일)이면 월배당 종목의
 *    지급일 당일에 작년 같은 날 지급까지 잡혀 13회분이 된다.
 *  - 투영: 작년 같은 달 1일부터 오늘까지 수집하고, 미래 달마다 **스트림(종목 또는 동일 설명) 단위**로
 *    "올해 같은 달 버킷이 있으면 그것, 없으면 작년 버킷" 폴백. 월 합계 단위 폴백은 이번 달에 다른
 *    종목 지급이 하나라도 있으면 아직 미지급인 종목의 1년치를 통째로 누락시킨다.
 *    같은 스트림이 작년·올해 모두 지급했으면 최신 것만 — 지급일이 해마다 어긋나도 2배가 되지 않는다.
 *
 * 보유 반영(opts.currentQtyByTicker 제공 시):
 *  - 맵은 "전 거래의 순수량"이어야 한다 (전량 매도 = 0으로 존재). 맵에 있는데 ≤0 → 매도로 보고
 *    미래 제외, 맵에 아예 없는 티커 → 거래 이력이 없는 토큰(티커 오탐 'OK'·'ETF' 등 또는 앱 밖
 *    보유)이므로 매도 판정 불가 → 과거액 그대로 폴백. (0 처리하면 계속 받는 배당이 조용히 사라짐)
 *  - 스케일 그룹은 티커|월 — 다계좌 동일 지급 이벤트는 증권사별 입금일이 1~2일 어긋나는 게 흔해서
 *    정확한 날짜 일치로 묶으면 그룹이 갈라져 계좌 수만큼 부풀려진다.
 *  - 분모(배당 당시 보유)는 계좌별 버킷의 max 합 — note 보유주식은 계좌별 수량이므로 (a) 같은 계좌의
 *    복수 기록(정규+특별·주배당 여러 회)은 보유를 한 번만, (b) 다계좌는 합산한다.
 *  - 그룹에 note 없는 기록이 섞이면 스케일 포기(과거액 유지) — 분모 범위가 어긋난 과대 방지.
 *  옵션 미제공 시 v1 동작(과거 패턴 그대로 투영, annualTotalKRW ≈ trailing12KRW)으로 폴백.
 */
import type { LedgerEntry } from "../types";
import { isDividendEntryLoose } from "./categoryMatch";
import { addDaysToIso, parseIsoLocal } from "./date";
import { toKrwByRate } from "./currency";
import { extractTickerFromText, canonicalTickerForMatch } from "./finance";
import { parseQuantityFromNote } from "./dividend";

export interface ForwardDividendMonth {
  /** YYYY-MM (미래) */
  month: string;
  amountKRW: number;
}

export interface ForwardDividends {
  /** 향후 12개월 */
  months: ForwardDividendMonth[];
  /** 향후 12개월 예상 배당 합계 */
  annualTotalKRW: number;
  /** 최근 12개월 실제 수령 배당 합계 */
  trailing12KRW: number;
}

export function buildForwardDividends(
  ledger: LedgerEntry[],
  today: string,
  fxRate?: number | null,
  opts?: { currentQtyByTicker?: Map<string, number> }
): ForwardDividends {
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);
  const trailingStart = addDaysToIso(today, -365); // 실적 창 (미포함 경계)
  const projStart = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`; // 투영 수집 창 시작
  const qtyByTicker = opts?.currentQtyByTicker;

  // 배당 항목의 종목 추출 — 본문 또는 카테고리에서 티커 후보를 잡아 canonical 정규화
  const tickerOf = (e: LedgerEntry): string => {
    const raw = extractTickerFromText(e.description ?? "") ?? extractTickerFromText(e.category ?? "");
    return raw ? canonicalTickerForMatch(raw) : "";
  };

  // 스케일 그룹(티커|월) 수집. 스트림 = 미래 폴백 단위 (티커, 없으면 설명 텍스트)
  type Rec = { krw: number; qtyAt: number | null; acct: string };
  const groups = new Map<string, { ticker: string; stream: string; ym: string; recs: Rec[] }>();
  let trailing12 = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date) continue;
    if (e.date < projStart || e.date > today) continue;
    if (!isDividendEntryLoose(e)) continue;
    const krw = toKrw(e);
    if (e.date > trailingStart) trailing12 += krw; // 실적(과거)은 스케일 없이 그대로

    const ym = e.date.slice(0, 7);
    const ticker = tickerOf(e);
    const stream = ticker || `d:${(e.description ?? e.category ?? "").trim()}`;
    const key = ticker ? `${ticker}|${ym}` : `#${e.id}`;
    const g = groups.get(key) ?? { ticker, stream, ym, recs: [] };
    g.recs.push({ krw, qtyAt: parseQuantityFromNote(e.note), acct: e.toAccountId ?? "" });
    groups.set(key, g);
  }

  // 그룹별 미래 투영액 → 스트림별 YYYY-MM 버킷
  const streams = new Map<string, Map<string, number>>();
  for (const g of groups.values()) {
    const groupKrw = g.recs.reduce((s, r) => s + r.krw, 0);
    let forward = groupKrw;
    if (qtyByTicker && g.ticker && qtyByTicker.has(g.ticker)) {
      const currentQty = qtyByTicker.get(g.ticker) ?? 0;
      if (currentQty <= 0) {
        forward = 0; // 매도해 더 이상 보유 안 함 → 미래 배당 없음
      } else if (g.recs.every((r) => r.qtyAt != null && r.qtyAt > 0)) {
        // 계좌별 보유 버킷 (계좌 미상 기록은 각자 별도 버킷 — 합산 쪽이 과대보다 안전)
        const byAcct = new Map<string, number>();
        g.recs.forEach((r, i) => {
          const k = r.acct || `#${i}`;
          byAcct.set(k, Math.max(byAcct.get(k) ?? 0, r.qtyAt ?? 0));
        });
        const qtyAtSum = [...byAcct.values()].reduce((s, v) => s + v, 0);
        if (qtyAtSum > 0) forward = groupKrw * (currentQty / qtyAtSum);
      }
      // note 혼재/부재 → 스케일 포기, 과거액 유지
    }
    // 맵에 없는 티커(거래 이력 없음 = 오탐 가능) 또는 티커 없음 → 폴백(과거액 유지)
    let ymMap = streams.get(g.stream);
    if (!ymMap) {
      ymMap = new Map();
      streams.set(g.stream, ymMap);
    }
    ymMap.set(g.ym, (ymMap.get(g.ym) ?? 0) + forward);
  }

  const base = parseIsoLocal(today) ?? new Date();
  const months: ForwardDividendMonth[] = [];
  let annualTotal = 0;
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1); // 말일 클램프 불필요 (1일 고정)
    const fy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    let amt = 0;
    for (const ymMap of streams.values()) {
      // 스트림 단위 최신 우선: 올해 같은 달 지급이 이미 있으면 그것(1년 전), 없으면 작년 것(2년 전)
      const v = ymMap.get(`${fy - 1}-${mm}`) ?? ymMap.get(`${fy - 2}-${mm}`);
      if (v != null) amt += v;
    }
    months.push({ month: `${fy}-${mm}`, amountKRW: amt });
    annualTotal += amt;
  }

  return { months, annualTotalKRW: annualTotal, trailing12KRW: trailing12 };
}
