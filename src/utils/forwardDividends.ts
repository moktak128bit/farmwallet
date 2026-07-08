/**
 * 선행 배당 캘린더 (C1) — 최근 12개월 배당 실적을 같은 달에 반복한다고 가정해 향후 12개월 예상 배당
 * 일정·금액을 만든다. "현금이 언제 얼마 들어오는가"(현금흐름 계획)가 핵심 가치.
 *
 * 보유 반영(opts.currentQtyByTicker 제공 시):
 *  - 매도해 더 이상 보유하지 않는 종목의 과거 배당은 미래에서 제외(현재 보유 0 → 0).
 *  - 보유 수량이 바뀐 종목은 (현재 수량 / 배당 당시 수량)으로 비례 스케일.
 *  - 따라서 annualTotalKRW는 보유 변화를 반영해 trailing12KRW와 달라진다.
 *  옵션 미제공 시 v1 동작(과거 패턴 그대로 투영, annualTotalKRW ≈ trailing12KRW)으로 폴백.
 */
import type { LedgerEntry } from "../types";
import { isDividendEntryLoose } from "./categoryMatch";
import { addDaysToIso, parseIsoLocal } from "./date";
import { toKrwByRate } from "./currency";
import { extractTickerFromText, canonicalTickerForMatch } from "./finance";
import { parseQuantityFromNote } from "./dividend";

interface ForwardDividendMonth {
  /** YYYY-MM (미래) */
  month: string;
  amountKRW: number;
}

interface ForwardDividends {
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
  const start = addDaysToIso(today, -365);
  const qtyByTicker = opts?.currentQtyByTicker;

  // 배당 항목의 종목 추출 — 본문 또는 카테고리에서 티커 후보를 잡아 canonical 정규화
  const tickerOf = (e: LedgerEntry): string => {
    const raw = extractTickerFromText(e.description ?? "") ?? extractTickerFromText(e.category ?? "");
    return raw ? canonicalTickerForMatch(raw) : "";
  };

  const byMonthOfYear = new Map<number, number>(); // 1..12 → KRW (미래 투영액)
  let trailing12 = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date) continue;
    if (e.date < start || e.date > today) continue;
    if (!isDividendEntryLoose(e)) continue;
    const krw = toKrw(e);
    trailing12 += krw; // 실적(과거)은 항상 그대로

    // 미래 투영액 — 보유 정보가 있으면 매도 제외 + 보유비율 스케일
    let forwardKrw = krw;
    if (qtyByTicker) {
      const ticker = tickerOf(e);
      if (ticker) {
        const currentQty = qtyByTicker.get(ticker) ?? 0;
        if (currentQty <= 0) {
          forwardKrw = 0; // 매도해 더 이상 보유 안 함 → 미래 배당 없음
        } else {
          const qtyAt = parseQuantityFromNote(e.note);
          forwardKrw = qtyAt && qtyAt > 0 ? krw * (currentQty / qtyAt) : krw;
        }
      }
      // 티커를 못 잡으면(채권이자 등) 스케일 불가 → 과거액 그대로(폴백)
    }

    const moy = Number(e.date.slice(5, 7));
    if (moy >= 1 && moy <= 12) byMonthOfYear.set(moy, (byMonthOfYear.get(moy) ?? 0) + forwardKrw);
  }

  const base = parseIsoLocal(today) ?? new Date();
  const months: ForwardDividendMonth[] = [];
  let annualTotal = 0;
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1); // 말일 클램프 불필요 (1일 고정)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const amt = byMonthOfYear.get(d.getMonth() + 1) ?? 0;
    months.push({ month: ym, amountKRW: amt });
    annualTotal += amt;
  }

  return { months, annualTotalKRW: annualTotal, trailing12KRW: trailing12 };
}
