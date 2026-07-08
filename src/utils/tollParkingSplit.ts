import type { CategoryPresets, LedgerEntry } from "../types";

/**
 * 유류교통비 → "통행·주차" 합본 소분류를 "톨비" / "주차비"로 분리하는 순수 함수 모음.
 *
 * 배경: 카테고리 정리 중 통행료(톨비)와 주차비가 "통행·주차" 한 소분류로 합쳐졌다.
 * description으로 둘이 명확히 구분되므로(톨/하이패스/통행 vs 주차) 자동 재분류 + 프리셋 갱신을
 * 각각 멱등 순수 함수로 제공해 마법사 UI에서 조립한다. (utils/taxiSplit.ts와 동일 패턴)
 */

export const TP_PARENT = "유류교통비";
/** 분리 대상 합본 소분류 */
export const TP_SOURCE = "통행·주차";
export const TOLL = "톨비";
export const PARKING = "주차비";

/** 주차 description (공영주차장·공항 주차비 등). */
const PARKING_RE = /주차/;
/** 통행료·톨비·하이패스 description. */
const TOLL_RE = /톨|하이패스|통행/;

export type TPTarget = typeof TOLL | typeof PARKING;

/**
 * description으로 톨비/주차비 판정. 어느 쪽도 아니면 null(분류 보류 → 그대로 둠).
 * '주차'를 먼저 확인 — 가장 명확한 단서이고 톨 패턴과 겹치지 않는다.
 */
export function classifyTollParking(description: string | undefined): TPTarget | null {
  const d = description || "";
  if (PARKING_RE.test(d)) return PARKING;
  if (TOLL_RE.test(d)) return TOLL;
  return null;
}

interface TPCandidate {
  entry: LedgerEntry;
  target: TPTarget;
}

/**
 * 재분류 후보 — kind=expense, 금액>0, subCategory='유류교통비', detailCategory='통행·주차'이고
 * description이 톨/주차로 분류되는 항목. 분류 불가(예: '휘발유')는 후보에서 빠져 그대로 유지된다.
 */
export function findTollParkingCandidates(ledger: LedgerEntry[]): TPCandidate[] {
  const out: TPCandidate[] = [];
  for (const l of ledger) {
    if (l.kind !== "expense") continue;
    if (!(Number(l.amount) > 0)) continue;
    if (l.subCategory !== TP_PARENT || l.detailCategory !== TP_SOURCE) continue;
    const target = classifyTollParking(l.description);
    if (target) out.push({ entry: l, target });
  }
  return out;
}

/** 아직 '통행·주차'로 남아있는(어느 분류로도 가지 않은) 항목 수 — 보류 안내용. */
export function countUnsplitSource(ledger: LedgerEntry[]): number {
  let n = 0;
  for (const l of ledger) {
    if (
      l.kind === "expense" &&
      l.subCategory === TP_PARENT &&
      l.detailCategory === TP_SOURCE
    ) {
      n += 1;
    }
  }
  return n;
}

/** 프리셋 유류교통비.subs에 톨비·주차비가 모두 있는지. */
export function presetHasTollParking(presets: CategoryPresets): boolean {
  const g = presets.expenseDetails?.find((x) => x.main === TP_PARENT);
  if (!g) return false;
  return g.subs.includes(TOLL) && g.subs.includes(PARKING);
}

/**
 * 유류교통비.subs에 '톨비','주차비'를 추가('통행·주차' 다음 위치). 멱등(이미 있으면 안 넣음).
 *  - removeSource=true면 '통행·주차'를 제거 — 분리 후 남은 항목이 없을 때만 호출할 것.
 *  - 그룹이 없으면 원본 그대로(이 마법사는 그룹 신설은 안 함).
 *  - 변경이 없으면 원본 참조 그대로 반환.
 */
export function applyTollParkingToPresets(
  presets: CategoryPresets,
  removeSource: boolean
): CategoryPresets {
  const details = presets.expenseDetails;
  if (!details) return presets;
  const idx = details.findIndex((g) => g.main === TP_PARENT);
  if (idx < 0) return presets;
  const group = details[idx];
  const subs = [...group.subs];

  const srcIdx = subs.indexOf(TP_SOURCE);
  const insertAt = srcIdx >= 0 ? srcIdx + 1 : subs.length;
  const toInsert = [TOLL, PARKING].filter((s) => !subs.includes(s));
  subs.splice(insertAt, 0, ...toInsert);

  if (removeSource) {
    const s = subs.indexOf(TP_SOURCE);
    if (s >= 0) subs.splice(s, 1);
  }

  // 변경 없음 → 원본 참조 유지 (멱등성)
  if (subs.length === group.subs.length && subs.every((v, i) => v === group.subs[i])) {
    return presets;
  }
  const newDetails = [...details];
  newDetails[idx] = { ...group, subs };
  return { ...presets, expenseDetails: newDetails };
}

/** 선택된 id→target 매핑대로 detailCategory를 일괄 변경(불변). 빈 맵이면 원본 반환. */
export function applyTollParkingSplit(
  ledger: LedgerEntry[],
  idToTarget: Map<string, TPTarget>
): LedgerEntry[] {
  if (idToTarget.size === 0) return ledger;
  return ledger.map((l) => {
    const t = idToTarget.get(l.id);
    return t && l.detailCategory !== t ? { ...l, detailCategory: t } : l;
  });
}
