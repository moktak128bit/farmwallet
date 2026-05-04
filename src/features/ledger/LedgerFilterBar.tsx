import React, { useMemo } from "react";
import type { Account, LedgerEntry } from "../../types";

interface LedgerFilterBarProps {
  ledger: LedgerEntry[];
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

interface ChipRowProps {
  label: string;
  options: { value: string; display: string }[];
  selected: string | undefined;
  onSelect: (v: string | undefined) => void;
}

const chipBaseStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  transition: "all 0.15s",
  whiteSpace: "nowrap",
};

const chipActiveStyle: React.CSSProperties = {
  ...chipBaseStyle,
  fontWeight: 600,
  background: "var(--primary-light)",
  color: "var(--primary)",
  border: "1px solid var(--primary)",
};

/**
 * "전체"는 명시적 buttons[0]. 활성 칩 클릭 시 토글로 해제 (= "전체" 활성).
 * 옵션 0개면 row 자체 hidden (cascading 상위가 잠궜을 때).
 */
const ChipRow: React.FC<ChipRowProps> = ({ label, options, selected, onSelect }) => {
  if (options.length === 0) return null;
  const isAll = !selected;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 56, paddingTop: 7 }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => onSelect(undefined)}
          style={isAll ? chipActiveStyle : chipBaseStyle}
        >
          전체
        </button>
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(active ? undefined : opt.value)}
              style={active ? chipActiveStyle : chipBaseStyle}
            >
              {opt.display}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 가계부 리스트 전용 필터 바 — 폼과 완전히 독립.
 * 5개 row: 대분류 / 중분류 / 소분류 / 출금계좌 / 입금계좌.
 * 카테고리는 cascading: 중분류는 선택된 대분류의 항목만, 소분류는 선택된 중분류의 항목만.
 * 옵션은 실제 ledger 데이터에서 distinct 추출 — 사용 중인 값만 노출.
 */
export const LedgerFilterBar: React.FC<LedgerFilterBarProps> = ({
  ledger,
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
  const mainOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of ledger) if (l.category) set.add(l.category);
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [ledger]);

  const subOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of ledger) {
      if (filterMainCategory && l.category !== filterMainCategory) continue;
      if (l.subCategory) set.add(l.subCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [ledger, filterMainCategory]);

  const detailOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of ledger) {
      if (filterMainCategory && l.category !== filterMainCategory) continue;
      if (filterSubCategory && l.subCategory !== filterSubCategory) continue;
      if (l.detailCategory) set.add(l.detailCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, display: v }));
  }, [ledger, filterMainCategory, filterSubCategory]);

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
      <ChipRow label="대분류" options={mainOptions} selected={filterMainCategory} onSelect={onChangeMain} />
      <ChipRow label="중분류" options={subOptions} selected={filterSubCategory} onSelect={onChangeSub} />
      <ChipRow label="소분류" options={detailOptions} selected={filterDetailCategory} onSelect={setFilterDetailCategory} />
      <ChipRow label="출금계좌" options={accountOptions} selected={filterFromAccountId} onSelect={setFilterFromAccountId} />
      <ChipRow label="입금계좌" options={accountOptions} selected={filterToAccountId} onSelect={setFilterToAccountId} />
    </div>
  );
};
