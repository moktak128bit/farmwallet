import type { CategoryPresets, LedgerEntry } from "../types";

/**
 * 유류교통비 → 택시 분리 마법사용 순수 함수 모음.
 *
 * 배경: 카테고리 정리 작업 중 "택시"가 "대중교통" 소분류로 흡수되어버려서
 * 별도 추적이 안 됨. 이 모듈은 (1) 검출 (2) 프리셋 추가 (3) ledger 재분류를
 * 각각 순수 함수로 제공해 모달 UI에서 조립 사용. 모두 멱등(이미 적용된 상태에서
 * 다시 호출해도 안전).
 */

export const TAXI_PARENT = "유류교통비";
export const TAXI_DETAIL = "택시";
/** 택시 결제 description 매칭 — 카카오T, 우버, 타다 같은 변형 포함. 대소문자 무시. */
export const TAXI_RE = /택시|카카오T|카카오\s*택시|우버|타다|UBER|kakao\s*t/i;

/**
 * 재분류 대상 후보 — subCategory='유류교통비' AND description이 택시 패턴 매칭
 * AND 아직 detailCategory!=택시. 이미 처리된 항목은 자연 제외.
 */
export function findTaxiCandidates(ledger: LedgerEntry[]): LedgerEntry[] {
  return ledger.filter(
    (l) =>
      l.kind === "expense" &&
      Number(l.amount) > 0 &&
      l.subCategory === TAXI_PARENT &&
      TAXI_RE.test(l.description || "") &&
      l.detailCategory !== TAXI_DETAIL
  );
}

/** 프리셋의 유류교통비.subs에 '택시'가 이미 있는지. */
export function presetHasTaxi(presets: CategoryPresets): boolean {
  const group = presets.expenseDetails?.find((g) => g.main === TAXI_PARENT);
  return group?.subs.includes(TAXI_DETAIL) ?? false;
}

/**
 * categoryPresets의 유류교통비.subs에 '택시'를 '대중교통' 다음 위치로 추가한 새 객체 반환.
 *  - 이미 있으면 원본 그대로 반환 (멱등성).
 *  - '대중교통'을 못 찾으면 맨 뒤에 추가.
 *  - 유류교통비 그룹 자체가 없으면 원본 그대로 반환 (이 마법사는 그룹 자체 신설은 안 함).
 */
export function addTaxiToPresets(presets: CategoryPresets): CategoryPresets {
  if (presetHasTaxi(presets)) return presets;
  const details = presets.expenseDetails;
  if (!details) return presets;
  const groupIdx = details.findIndex((g) => g.main === TAXI_PARENT);
  if (groupIdx < 0) return presets;
  const group = details[groupIdx];
  const transitIdx = group.subs.indexOf("대중교통");
  const newSubs = [...group.subs];
  if (transitIdx >= 0) newSubs.splice(transitIdx + 1, 0, TAXI_DETAIL);
  else newSubs.push(TAXI_DETAIL);
  const newDetails = [...details];
  newDetails[groupIdx] = { ...group, subs: newSubs };
  return { ...presets, expenseDetails: newDetails };
}

/**
 * 선택된 ledger id들의 detailCategory를 '택시'로 일괄 변경 (불변 업데이트).
 *  - 이미 택시인 항목은 변경 X (참조 동등 유지).
 *  - 빈 ids → 원본 반환.
 */
export function applyTaxiSplit(ledger: LedgerEntry[], ids: Set<string>): LedgerEntry[] {
  if (ids.size === 0) return ledger;
  return ledger.map((l) =>
    ids.has(l.id) && l.detailCategory !== TAXI_DETAIL
      ? { ...l, detailCategory: TAXI_DETAIL }
      : l
  );
}
