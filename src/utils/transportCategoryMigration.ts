/**
 * 유류교통비 소분류 14개 → 6개 통합 (임시).
 *
 * 사용자 데이터 구조가 두 가지 섞여 있음 — 둘 다 처리:
 *
 *   A) 옛 구조 (대부분):
 *      cat="지출", sub="유류교통비", det="<옛14중하나>"
 *      → det만 새 6개로 매핑
 *
 *   B) 새 구조 (소수):
 *      cat="유류교통비", sub="<옛14중하나>"
 *      → sub을 새 6개로 매핑
 *
 * 통합 시 **원래 소분류 이름을 description에 보존** ([원래소분류:하이패스] 형식)
 * — 검색·확인 가능하도록.
 */

import type { AppData, CategoryPresets, ExpenseDetailGroup, LedgerEntry } from "../types";

export const TRANSPORT_MAIN = "유류교통비";

/** 옛 14개 → 새 6개 매핑 */
export const TRANSPORT_SUB_MAPPING: Record<string, string> = {
  "버스/지하철": "대중교통",
  "택시": "대중교통",
  "기타교통": "대중교통",
  "유류비/충전비": "유류·충전",
  "자동차용품": "차량 유지보수",
  "수리비": "차량 유지보수",
  "유지보수비": "차량 유지보수",
  "톨비/하이패스": "통행·주차",
  "주차비": "통행·주차",
  "범칙금": "통행·주차",
  "자동차보험": "차량 고정비",
  "자동차할부": "차량 고정비",
  "자동차세": "차량 고정비",
  "기차": "장거리",
  "항공": "장거리",
};

export const NEW_TRANSPORT_SUBS: string[] = [
  "대중교통",
  "유류·충전",
  "차량 유지보수",
  "통행·주차",
  "차량 고정비",
  "장거리",
];

/** description 내 원래 분류 보존 마커 — 중복 방지용 정규식 */
const ORIGINAL_MARKER_PATTERN = /\s*\[원래소분류:[^\]]+\]/g;

function applyDescriptionMarker(desc: string | undefined, original: string): string {
  // 이미 같은 마커가 있을 수도 있어 한 번 정리 후 재부착 (idempotent)
  const base = (desc ?? "").replace(ORIGINAL_MARKER_PATTERN, "").trim();
  const marker = `[원래소분류:${original}]`;
  return base ? `${base} ${marker}` : marker;
}

interface TransportLocator {
  /** 옛 sub명이 어느 필드에 들어 있는지 */
  field: "sub" | "det";
  oldValue: string;
}

/** 이 entry가 변환 대상인지, 옛 sub명이 어디에 있는지 식별 */
function locateTransportSub(e: LedgerEntry): TransportLocator | null {
  if (e.kind !== "expense") return null;

  // B) 새 구조: cat=유류교통비, sub=<옛 14중>
  if (e.category === TRANSPORT_MAIN && e.subCategory) {
    if (TRANSPORT_SUB_MAPPING[e.subCategory]) {
      return { field: "sub", oldValue: e.subCategory };
    }
    return null;
  }

  // A) 옛 구조: sub=유류교통비, det=<옛 14중>
  if (e.subCategory === TRANSPORT_MAIN && e.detailCategory) {
    if (TRANSPORT_SUB_MAPPING[e.detailCategory]) {
      return { field: "det", oldValue: e.detailCategory };
    }
    return null;
  }

  return null;
}

export interface TransportMigrationPreview {
  /** 실제 값이 변경될 항목 수 */
  ledgerAffected: number;
  /** 옛 분류명별 건수 */
  countByOldName: Record<string, number>;
  /** 통합 후 새 분류명별 건수 */
  countByNewName: Record<string, number>;
  /** categoryPresets 갱신 필요 여부 */
  presetsNeedUpdate: boolean;
  /** 매핑에 없는 sub/det 값 (정보용 — 변경 안 됨) */
  unmappedNotices: string[];
  /** 구조별 분포 — 사용자에게 어디서 발견됐는지 알림 */
  byStructure: { oldStructure: number; newStructure: number };
}

export function previewTransportMigration(data: AppData): TransportMigrationPreview {
  const countByOld: Record<string, number> = {};
  const countByNew: Record<string, number> = {};
  const unmapped = new Set<string>();
  let affected = 0;
  let oldStructure = 0;
  let newStructure = 0;

  for (const e of data.ledger ?? []) {
    if (e.kind !== "expense") continue;
    const isTransport = e.category === TRANSPORT_MAIN || e.subCategory === TRANSPORT_MAIN;
    if (!isTransport) continue;

    const loc = locateTransportSub(e);
    if (!loc) {
      const value =
        e.category === TRANSPORT_MAIN ? (e.subCategory || "(빈값)") : (e.detailCategory || "(빈값)");
      unmapped.add(value);
      continue;
    }

    if (loc.field === "sub") newStructure++;
    else oldStructure++;

    countByOld[loc.oldValue] = (countByOld[loc.oldValue] ?? 0) + 1;
    const newName = TRANSPORT_SUB_MAPPING[loc.oldValue];
    countByNew[newName] = (countByNew[newName] ?? 0) + 1;
    if (newName !== loc.oldValue) {
      affected++;
    }
  }

  const groups = data.categoryPresets?.expenseDetails ?? [];
  const transport = groups.find((g) => g.main === TRANSPORT_MAIN);
  const presetsNeedUpdate =
    !transport ||
    transport.subs.length !== NEW_TRANSPORT_SUBS.length ||
    !NEW_TRANSPORT_SUBS.every((s, i) => transport.subs[i] === s);

  return {
    ledgerAffected: affected,
    countByOldName: countByOld,
    countByNewName: countByNew,
    presetsNeedUpdate,
    unmappedNotices: [...unmapped].sort(),
    byStructure: { oldStructure, newStructure },
  };
}

export function applyTransportMigration(data: AppData): AppData {
  const newLedger: LedgerEntry[] = (data.ledger ?? []).map((e) => {
    const loc = locateTransportSub(e);
    if (!loc) return e;
    const newName = TRANSPORT_SUB_MAPPING[loc.oldValue];
    if (!newName || newName === loc.oldValue) return e;

    const updated: LedgerEntry = {
      ...e,
      description: applyDescriptionMarker(e.description, loc.oldValue),
    };
    if (loc.field === "sub") {
      updated.subCategory = newName;
    } else {
      updated.detailCategory = newName;
    }
    return updated;
  });

  // 새 구조용 입력 폼의 picker가 6개로 보이도록 categoryPresets도 갱신
  const oldGroups = data.categoryPresets?.expenseDetails ?? [];
  let foundTransport = false;
  const newGroups: ExpenseDetailGroup[] = oldGroups.map((g) => {
    if (g.main !== TRANSPORT_MAIN) return g;
    foundTransport = true;
    return { main: TRANSPORT_MAIN, subs: [...NEW_TRANSPORT_SUBS] };
  });
  if (!foundTransport) {
    newGroups.push({ main: TRANSPORT_MAIN, subs: [...NEW_TRANSPORT_SUBS] });
  }

  const newPresets: CategoryPresets = {
    ...(data.categoryPresets ?? { income: [], expense: [], transfer: [] }),
    expenseDetails: newGroups,
  };

  return {
    ...data,
    ledger: newLedger,
    categoryPresets: newPresets,
  };
}
