import React, { useMemo } from "react";
import type { Account, LedgerEntry } from "../../types";
import { isInvestmentKind } from "../../utils/category";
import { FilterChipRow } from "../../components/ui/FilterChipRow";

interface LedgerFilterBarProps {
  ledger: LedgerEntry[];
  /** 현재 수입/지출/이체 탭으로 좁혀진 목록 — 카테고리 옵션은 여기서 추출 (계좌 옵션은 전체 ledger 유지) */
  tabLedger: LedgerEntry[];
  accounts: Account[];
  filterMainCategory: string | undefined;
  filterSubCategory: string | undefined;
  filterDetailCategory: string | undefined;
  filterFromAccountId: string | undefined;
  filterToAccountId: string | undefined;
  setFilterMainCategory: (v: string | undefined) => void;
  setFilterSubCategory: (v: string | undefined) => void;
  setFilterDetailCategory: (v: string | undefined) => void;
  setFilterFromAccountId: (v: string | undefined) => void;
  setFilterToAccountId: (v: string | undefined) => void;
}

/**
 * 대분류가 "재테크"일 때는 category 일치가 아니라 매처(isInvestmentKind)로 판정해야
 * LedgerPage.filteredLedger의 필터링과 옵션이 일치한다. transfer/income 등 흩어진 형태 포함.
 */
const matchesMain = (l: LedgerEntry, main: string): boolean =>
  main === "재테크" ? isInvestmentKind(l) : l.category === main;

/**
 * 가계부 리스트 전용 필터 바 — 폼과 완전히 독립.
 * 5개 row: 대분류 / 중분류 / 소분류 / 출금계좌 / 입금계좌.
 * 카테고리는 cascading: 중분류는 선택된 대분류의 항목만, 소분류는 선택된 중분류의 항목만.
 * 옵션은 실제 ledger 데이터에서 distinct 추출 — 사용 중인 값만 노출.
 */
export const LedgerFilterBar: React.FC<LedgerFilterBarProps> = ({
  ledger,
  tabLedger,
  accounts,
  filterMainCategory,
  filterSubCategory,
  filterDetailCategory,
  filterFromAccountId,
  filterToAccountId,
  setFilterMainCategory,
  setFilterSubCategory,
  setFilterDetailCategory,
  setFilterFromAccountId,
  setFilterToAccountId,
}) => {
  // 카테고리 옵션은 현재 탭(tabLedger) 기준 — 탭에 없는 카테고리는 노출하지 않음.
  // "재테크"는 distinct category만으론 누락(transfer 저축/투자이체·income 투자수익) → 매처와 동일 정의로 합성 옵션 주입.
  const mainOptions = useMemo(() => {
    const set = new Set<string>();
    let hasInvestment = false;
    for (const l of tabLedger) {
      if (l.category) set.add(l.category);
      if (!hasInvestment && isInvestmentKind(l)) hasInvestment = true;
    }
    if (hasInvestment) set.add("재테크");
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [tabLedger]);

  const subOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of tabLedger) {
      if (filterMainCategory && !matchesMain(l, filterMainCategory)) continue;
      if (l.subCategory) set.add(l.subCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [tabLedger, filterMainCategory]);

  const detailOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of tabLedger) {
      if (filterMainCategory && !matchesMain(l, filterMainCategory)) continue;
      if (filterSubCategory && l.subCategory !== filterSubCategory) continue;
      if (l.detailCategory) set.add(l.detailCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [tabLedger, filterMainCategory, filterSubCategory]);

  // 계좌는 ID로 필터링하지만 화면엔 이름. 사용 중(ledger에 등장한) 계좌만 노출.
  const usedAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of ledger) {
      if (l.fromAccountId) set.add(l.fromAccountId);
      if (l.toAccountId) set.add(l.toAccountId);
    }
    return set;
  }, [ledger]);

  const accountOptions = useMemo(() => {
    return accounts
      .filter((a) => usedAccountIds.has(a.id))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko"))
      .map((a) => ({ value: a.id, display: a.name }));
  }, [accounts, usedAccountIds]);

  const onChangeMain = (v: string | undefined) => {
    setFilterMainCategory(v);
    // 상위가 바뀌면 하위 선택 무효 — 자동 클리어
    setFilterSubCategory(undefined);
    setFilterDetailCategory(undefined);
  };
  const onChangeSub = (v: string | undefined) => {
    setFilterSubCategory(v);
    setFilterDetailCategory(undefined);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 10,
      }}
    >
      <FilterChipRow label="대분류" options={mainOptions} selected={filterMainCategory} onSelect={onChangeMain} />
      <FilterChipRow label="중분류" options={subOptions} selected={filterSubCategory} onSelect={onChangeSub} />
      <FilterChipRow label="소분류" options={detailOptions} selected={filterDetailCategory} onSelect={setFilterDetailCategory} />
      <FilterChipRow label="출금계좌" options={accountOptions} selected={filterFromAccountId} onSelect={setFilterFromAccountId} />
      <FilterChipRow label="입금계좌" options={accountOptions} selected={filterToAccountId} onSelect={setFilterToAccountId} />
    </div>
  );
};
