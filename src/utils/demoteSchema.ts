/**
 * 가계부 스키마 demote (한 칸 끌어내림).
 *
 * 새 구조 (잘못 저장됨, 16건 정도):
 *   cat="식비/유류교통비/..." sub="시장/마트/..." det=∅
 *
 * 옛 구조 (사용자분 표준, 700건):
 *   cat="지출/수입/이체"     sub="식비/유류교통비/..." det="시장/마트/..."
 *
 * → 새 구조 항목을 옛 구조로 끌어내림 (cat을 한 칸 위로 보내고, kind 기준으로 cat 보정).
 */

import type { AppData, LedgerEntry, LedgerKind } from "../types";

const KIND_TO_TOP_CATEGORY: Record<LedgerKind, string> = {
  expense: "지출",
  income: "수입",
  transfer: "이체",
};

/** 이미 표준 구조인 cat 값 (변경 불필요) */
const STANDARD_TOP_CATS = new Set<string>(["지출", "수입", "이체"]);

/** description 마커 — 만약 demote 시 detailCategory가 이미 있으면 보존용 */
const ORIG_DET_MARKER_RE = /\s*\[원래소소분류:[^\]]+\]/g;

function appendOrigDetMarker(desc: string | undefined, original: string): string {
  const base = (desc ?? "").replace(ORIG_DET_MARKER_RE, "").trim();
  const marker = `[원래소소분류:${original}]`;
  return base ? `${base} ${marker}` : marker;
}

function needsDemote(e: LedgerEntry): boolean {
  if (!KIND_TO_TOP_CATEGORY[e.kind]) return false;
  return !STANDARD_TOP_CATS.has(e.category);
}

export interface DemotePreview {
  totalLedger: number;
  /** 변경될 항목 수 */
  affected: number;
  /** 변경 안 됨 (이미 표준) */
  alreadyStandard: number;
  /** kind별 영향 분포 */
  byKind: { expense: number; income: number; transfer: number };
  /** 변환될 옛 cat 값별 건수 */
  byOldCategory: Record<string, number>;
  /** 샘플 변환 5개 (검증용) */
  samples: { before: { cat: string; sub?: string; det?: string }; after: { cat: string; sub?: string; det?: string } }[];
}

export function previewDemoteSchema(data: AppData): DemotePreview {
  const ledger = data.ledger ?? [];
  let affected = 0;
  let alreadyStandard = 0;
  const byKind = { expense: 0, income: 0, transfer: 0 };
  const byOld: Record<string, number> = {};
  const samples: DemotePreview["samples"] = [];

  for (const e of ledger) {
    if (!KIND_TO_TOP_CATEGORY[e.kind]) continue;
    if (STANDARD_TOP_CATS.has(e.category)) {
      alreadyStandard++;
      continue;
    }
    affected++;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const oldCat = e.category || "(빈값)";
    byOld[oldCat] = (byOld[oldCat] ?? 0) + 1;

    if (samples.length < 5) {
      const expected = KIND_TO_TOP_CATEGORY[e.kind];
      samples.push({
        before: { cat: e.category, sub: e.subCategory, det: e.detailCategory },
        after: { cat: expected, sub: e.category, det: e.subCategory },
      });
    }
  }

  return {
    totalLedger: ledger.length,
    affected,
    alreadyStandard,
    byKind,
    byOldCategory: byOld,
    samples,
  };
}

export function applyDemoteSchema(data: AppData): AppData {
  const newLedger: LedgerEntry[] = (data.ledger ?? []).map((e) => {
    if (!needsDemote(e)) return e;
    const expected = KIND_TO_TOP_CATEGORY[e.kind];
    const oldCat = e.category;
    const oldSub = e.subCategory;
    const oldDet = e.detailCategory;

    // 만약 이미 detailCategory가 있던 항목 (드물지만) 정보 보존
    let newDescription = e.description;
    if (oldDet && oldDet.trim()) {
      newDescription = appendOrigDetMarker(e.description, oldDet);
    }

    return {
      ...e,
      category: expected,
      subCategory: oldCat || undefined,
      ...(oldSub ? { detailCategory: oldSub } : {}),
      description: newDescription,
    };
  });

  return { ...data, ledger: newLedger };
}
