/**
 * 카테고리 통합 — 순수 모듈 (React 의존 없음).
 *
 * 두 카테고리를 하나로 합칠 때 ① 프리셋(드롭다운 목록)과 ② 가계부 항목을 함께 치환한다.
 * 가계부 필드 매핑 (세대 혼재 대응):
 *  - 수입:  kind=income,  subCategory(없으면 category)가 실제 분류
 *  - 이체:  kind=transfer, subCategory(없으면 category)가 실제 분류
 *  - 지출 대분류: kind=expense, subCategory가 대분류 (구세대 항목은 category에 직접 — 둘 다 치환)
 *  - 지출 세부:   kind=expense, detailCategory가 세부 (대분류 일치 조건 하)
 */
import type { CategoryPresets, ExpenseDetailGroup, LedgerEntry } from "../types";

export type MergeKind = "income" | "transfer" | "expenseMain" | "expenseSub";

export interface MergeSpec {
  kind: MergeKind;
  from: string;
  to: string;
  /** expenseSub 전용: from 세부가 속한 대분류 */
  fromMain?: string;
  /** expenseSub 전용: to 세부가 속한 대분류 (다른 대분류로의 이동 허용) */
  toMain?: string;
}

/** 수입/이체 항목의 실제 분류명 — subCategory 우선, 없으면 category ("수입"/"이체" 같은 kind 라벨은 제외). */
const KIND_LABELS = new Set(["수입", "지출", "이체"]);
export function effectiveSubName(l: LedgerEntry): string {
  const sub = (l.subCategory || "").trim();
  if (sub) return sub;
  const cat = (l.category || "").trim();
  return KIND_LABELS.has(cat) ? "" : cat;
}

const matchesIncomeOrTransfer = (l: LedgerEntry, kind: "income" | "transfer", name: string) =>
  l.kind === kind && effectiveSubName(l) === name;

const matchesExpenseMain = (l: LedgerEntry, main: string) =>
  l.kind === "expense" && (l.subCategory === main || l.category === main);

/** 지출 항목의 실효 대분류 — subCategory 우선, 구세대(재테크 등)는 category.
 * (CategoriesPage 사용 통계 등 분류 집계의 단일 소스로 export) */
export const expenseMainName = (l: LedgerEntry): string => {
  const sub = (l.subCategory || "").trim();
  if (sub) return sub;
  const cat = (l.category || "").trim();
  return cat !== "지출" ? cat : "";
};

/** spec에 해당하는 가계부 항목 수 — 실행 전 미리보기용. */
export function countMergeTargets(ledger: LedgerEntry[], spec: MergeSpec): number {
  let n = 0;
  for (const l of ledger) {
    if (spec.kind === "income" || spec.kind === "transfer") {
      if (matchesIncomeOrTransfer(l, spec.kind, spec.from)) n++;
    } else if (spec.kind === "expenseMain") {
      if (matchesExpenseMain(l, spec.from)) n++;
    } else {
      if (matchesExpenseMain(l, spec.fromMain ?? "") && (l.detailCategory ?? "") === spec.from) n++;
    }
  }
  return n;
}

/** 항목 1건을 spec에 따라 치환한 사본 반환 (해당 없으면 원본 그대로). */
export function buildMergeMapper(spec: MergeSpec): (l: LedgerEntry) => LedgerEntry {
  return (l) => {
    if (spec.kind === "income" || spec.kind === "transfer") {
      if (!matchesIncomeOrTransfer(l, spec.kind, spec.from)) return l;
      return { ...l, subCategory: spec.to };
    }
    if (spec.kind === "expenseMain") {
      if (!matchesExpenseMain(l, spec.from)) return l;
      return {
        ...l,
        category: l.category === spec.from ? spec.to : l.category,
        subCategory: l.subCategory === spec.from ? spec.to : l.subCategory,
      };
    }
    // expenseSub — 대분류가 다르면 대분류 필드도 함께 이동
    const fromMain = spec.fromMain ?? "";
    const toMain = spec.toMain ?? fromMain;
    if (!matchesExpenseMain(l, fromMain) || (l.detailCategory ?? "") !== spec.from) return l;
    return {
      ...l,
      detailCategory: spec.to,
      category: l.category === fromMain ? toMain : l.category,
      subCategory: l.subCategory === fromMain ? toMain : l.subCategory,
    };
  };
}

const replaceInList = (list: string[], from: string, to: string): string[] => {
  const next = list.filter((x) => x !== from);
  if (!next.includes(to)) next.push(to);
  return next;
};

/** 프리셋을 spec에 따라 정리한 사본 반환 — from 제거, to 보장, 대분류 통합 시 세부·타입 매핑까지 병합. */
export function mergePresets(presets: CategoryPresets, spec: MergeSpec): CategoryPresets {
  if (spec.kind === "income") {
    const ct = presets.categoryTypes;
    // ⚠ from이 그 타입 리스트에 실제로 있을 때만 to로 승계 — 무가드 replaceInList는 from이 없어도 to를
    //   강제 추가해, 무관한 수입 A→B 통합 시 B가 salary/passive/nonReal에 잘못 등록(수입성격 오염)됨.
    const remap = (list?: string[]) =>
      list && list.includes(spec.from) ? replaceInList(list, spec.from, spec.to) : list;
    return {
      ...presets,
      income: replaceInList(presets.income, spec.from, spec.to),
      categoryTypes: ct
        ? { ...ct, salary: remap(ct.salary), passive: remap(ct.passive), nonRealIncome: remap(ct.nonRealIncome) }
        : ct,
    };
  }
  if (spec.kind === "transfer") {
    const transfer = replaceInList(presets.transfer, spec.from, spec.to);
    const ct = presets.categoryTypes;
    return {
      ...presets,
      transfer,
      // 위와 동일 가드 — from이 ct.transfer에 있을 때만 승계
      categoryTypes: ct
        ? { ...ct, transfer: ct.transfer?.includes(spec.from) ? replaceInList(ct.transfer, spec.from, spec.to) : ct.transfer }
        : ct,
    };
  }

  const groups: ExpenseDetailGroup[] =
    presets.expenseDetails && presets.expenseDetails.length > 0
      ? presets.expenseDetails.map((g) => ({ main: g.main, subs: [...g.subs] }))
      : presets.expense.map((main) => ({ main, subs: [] }));

  if (spec.kind === "expenseMain") {
    // from 그룹을 to 그룹에 병합 (세부 항목 합집합), to 그룹이 없으면 from 그룹을 개명
    const renamed = groups.map((g) => (g.main === spec.from ? { ...g, main: spec.to } : g));
    const merged: ExpenseDetailGroup[] = [];
    for (const g of renamed) {
      const existing = merged.find((m) => m.main === g.main);
      if (existing) existing.subs = [...new Set([...existing.subs, ...g.subs])];
      else merged.push(g);
    }
    if (!merged.some((g) => g.main === spec.to)) merged.push({ main: spec.to, subs: [] });
    const ct = presets.categoryTypes;
    // 타입 매핑: from의 fixed/savings 지정을 to로 승계 (to가 이미 지정돼 있으면 중복 제거만)
    const fixed = ct?.fixed?.includes(spec.from) ? replaceInList(ct.fixed, spec.from, spec.to) : ct?.fixed?.filter((x) => x !== spec.from);
    const savings = ct?.savings?.includes(spec.from) ? replaceInList(ct.savings, spec.from, spec.to) : ct?.savings?.filter((x) => x !== spec.from);
    return {
      ...presets,
      expense: merged.map((g) => g.main),
      expenseDetails: merged,
      categoryTypes: ct ? { ...ct, fixed: fixed ?? [], savings: savings ?? [] } : ct,
    };
  }

  // expenseSub
  const fromMain = spec.fromMain ?? "";
  const toMain = spec.toMain ?? fromMain;
  const next = groups.map((g) => {
    let subs = g.subs;
    if (g.main === fromMain) subs = subs.filter((s) => s !== spec.from);
    if (g.main === toMain && !subs.includes(spec.to)) subs = [...subs, spec.to];
    return { ...g, subs };
  });
  if (toMain && !next.some((g) => g.main === toMain)) next.push({ main: toMain, subs: [spec.to] });
  return { ...presets, expense: next.map((g) => g.main), expenseDetails: next };
}

interface MergeCandidate {
  name: string;
  /** 가계부 사용 건수 */
  count: number;
  /** 프리셋(드롭다운 목록)에 존재하는지 — false면 데이터에만 남은 고아 카테고리 */
  inPreset: boolean;
  /** expenseSub 전용: 속한 대분류 */
  main?: string;
}

/** expenseSub 후보 키 — 이름에 공백·기호가 올 수 있어 제어문자로 구분. */
const PAIR_SEP = "";
export const subPairKey = (main: string, sub: string): string => `${main}${PAIR_SEP}${sub}`;
export const splitSubPairKey = (key: string): { main: string; sub: string } => {
  const i = key.indexOf(PAIR_SEP);
  return i < 0 ? { main: "", sub: key } : { main: key.slice(0, i), sub: key.slice(i + 1) };
};

/**
 * 통합 후보 목록 — 프리셋 ∪ 가계부에 실제 쓰인 값.
 * 프리셋에 없는 고아 카테고리("기타 수입" 등)도 통합 대상으로 잡을 수 있어야 한다.
 */
export function buildMergeCandidates(
  kind: MergeKind,
  presets: CategoryPresets,
  ledger: LedgerEntry[]
): MergeCandidate[] {
  if (kind === "income" || kind === "transfer") {
    const counts = new Map<string, number>();
    for (const l of ledger) {
      if (l.kind !== kind) continue;
      const name = effectiveSubName(l);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const presetList = kind === "income" ? presets.income : presets.transfer;
    const names = new Set([...presetList, ...counts.keys()]);
    return [...names]
      .map((name) => ({ name, count: counts.get(name) ?? 0, inPreset: presetList.includes(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  const groups: ExpenseDetailGroup[] =
    presets.expenseDetails && presets.expenseDetails.length > 0
      ? presets.expenseDetails
      : presets.expense.map((main) => ({ main, subs: [] }));

  if (kind === "expenseMain") {
    const counts = new Map<string, number>();
    for (const l of ledger) {
      if (l.kind !== "expense") continue;
      const name = expenseMainName(l);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const presetMains = groups.map((g) => g.main);
    const names = new Set([...presetMains, ...counts.keys()]);
    return [...names]
      .map((name) => ({ name, count: counts.get(name) ?? 0, inPreset: presetMains.includes(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  // expenseSub — "대분류 > 세부" 쌍 단위
  const counts = new Map<string, number>();
  for (const l of ledger) {
    if (l.kind !== "expense") continue;
    const main = expenseMainName(l);
    const sub = (l.detailCategory || "").trim();
    if (!main || !sub) continue;
    const key = subPairKey(main, sub);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const presetPairs = new Set<string>();
  for (const g of groups) for (const s of g.subs) presetPairs.add(subPairKey(g.main, s));
  const keys = new Set([...presetPairs, ...counts.keys()]);
  return [...keys]
    .map((key) => {
      const { main, sub } = splitSubPairKey(key);
      return { name: sub, main, count: counts.get(key) ?? 0, inPreset: presetPairs.has(key) };
    })
    .sort((a, b) => (a.main ?? "").localeCompare(b.main ?? "") || b.count - a.count || a.name.localeCompare(b.name));
}
