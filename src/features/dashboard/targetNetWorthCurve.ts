/**
 * 목표 자산 곡선(AppData.targetNetWorthCurve: {"YYYY-MM-DD": 원}) → 월별 순자산 추이 차트용 목표값(만원) 변환.
 * 순수 함수 — NetWorthTrendChart가 점선 오버레이(read-only)로 사용한다.
 *
 * 규칙(테스트로 고정):
 * - 월 포인트의 기준일은 그 달 말일(타임라인 행 = 월말 잔액).
 * - 첫 목표일 이전 달: null(그리지 않음).
 * - 목표일 사이: 일 단위 선형 보간.
 * - 마지막 목표일 이후: 마지막 목표값 유지.
 * - 잘못된 날짜 키·비유한 값은 무시. 유효 항목이 없으면 전부 null.
 */
import { getMonthEndDate, parseIsoLocal } from "../../utils/date";

const DAY_MS = 86_400_000;

/** 로컬 자정 기준 일 인덱스 (KST 고정 — DST 없음) */
function dayIndex(date: string): number | null {
  const parsed = parseIsoLocal(date);
  if (!parsed) return null;
  return Math.round(parsed.getTime() / DAY_MS);
}

/** 유효한 목표 곡선 점들을 날짜 오름차순으로 정렬 (원 단위 그대로) */
function normalizeCurve(curve: Record<string, number> | undefined | null): Array<{ t: number; value: number }> {
  if (!curve || typeof curve !== "object") return [];
  const byDay = new Map<number, number>();
  for (const [key, raw] of Object.entries(curve)) {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) continue;
    const t = dayIndex(key);
    if (t == null) continue;
    byDay.set(t, value); // 같은 날짜 중복 키는 마지막 값
  }
  return Array.from(byDay.entries())
    .map(([t, value]) => ({ t, value }))
    .sort((a, b) => a.t - b.t);
}

/**
 * months("YYYY-MM" 오름차순)에 대응하는 목표 순자산(만원, 반올림) 배열.
 * 차트 데이터 길이와 1:1 — 값이 없는 달은 null.
 */
export function buildTargetNetWorthSeries(
  curve: Record<string, number> | undefined | null,
  months: string[]
): Array<number | null> {
  const pts = normalizeCurve(curve);
  if (pts.length === 0) return months.map(() => null);
  const first = pts[0];
  const last = pts[pts.length - 1];

  return months.map((month) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const t = dayIndex(getMonthEndDate(month));
    if (t == null) return null;
    if (t < first.t) return null;
    if (t >= last.t) return Math.round(last.value / 10000);
    // first.t <= t < last.t — 구간 탐색 후 선형 보간
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t <= t) i++;
    const a = pts[i];
    const b = pts[i + 1];
    const span = b.t - a.t;
    const ratio = span > 0 ? (t - a.t) / span : 0;
    return Math.round((a.value + (b.value - a.value) * ratio) / 10000);
  });
}
