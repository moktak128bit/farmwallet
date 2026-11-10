/**
 * 장부 신선도 — "오늘"이 아니라 "기록이 들어온 마지막 날"까지만 비교한다.
 *
 * 사용자는 캡처를 모아 두었다가 한꺼번에 입력한다(사진 올리기 → Claude 입력). 오늘이 9일인데
 * 기록이 5일까지만 있으면, 오늘 기준 동기(1~9일) 비교는 지난달 1~9일(다 기록됨)과 이번 달 1~5일을
 * 비교하게 되어 "지출 -86%", "5일 연속 무지출", "가장 절약한 달" 같은 허위 결론이 나온다.
 * 진행 중인 달의 모든 동기 비교·스트릭은 이 모듈의 dayCap을 쓴다.
 */
import type { LedgerEntry } from "../types";
import { getTodayKST, parseIsoLocal } from "./date";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 오늘(KST) 이하인 가장 최근 기록 날짜. 예약(미래 날짜) 기록은 무시. 기록이 없으면 null. */
export function latestRecordedDate(ledger: readonly LedgerEntry[], today: string = getTodayKST()): string | null {
  let last: string | null = null;
  for (const l of ledger) {
    const d = l.date;
    if (!d || !ISO_DATE.test(d) || d > today) continue;
    if (last == null || d > last) last = d;
  }
  return last;
}

/**
 * 진행 중인 달(month === 오늘의 달)을 비교할 때 쓸 마지막 일자.
 * - 지난 달·미래 달: null (월 전체 비교)
 * - 이번 달: min(오늘 일자, 마지막 기록 일자). 이번 달 기록이 하나도 없으면 0 — 호출부는 "기록 전"으로 표시.
 */
export function recordedDayCap(ledger: readonly LedgerEntry[], month: string, today: string = getTodayKST()): number | null {
  if (month !== today.slice(0, 7)) return null;
  const last = latestRecordedDate(ledger, today);
  if (last == null || last.slice(0, 7) < month) return 0;
  return Math.min(Number(today.slice(8, 10)), Number(last.slice(8, 10)));
}

/** 마지막 기록 후 지난 일수 (오늘 기록이 있으면 0). 기록 없으면 null. */
export function daysSinceLastRecord(ledger: readonly LedgerEntry[], today: string = getTodayKST()): number | null {
  const last = latestRecordedDate(ledger, today);
  if (last == null) return null;
  const a = parseIsoLocal(last);
  const b = parseIsoLocal(today);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** 동기 비교 라벨 — "1~5일" 또는 기록이 오늘보다 늦으면 "1~5일 · 5일까지 기록" */
export function dayCapLabel(dayCap: number, today: string = getTodayKST()): string {
  const todayDay = Number(today.slice(8, 10));
  return dayCap < todayDay ? `1~${dayCap}일 · ${dayCap}일까지 기록` : `1~${dayCap}일`;
}
