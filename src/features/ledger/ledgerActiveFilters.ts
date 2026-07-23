/**
 * 가계부 활성 필터 → 칩 descriptor 단일 소스.
 *
 * 기존엔 LedgerSummarySection(제거 칩)과 LedgerFilterCard(개수 배지·요약 텍스트)가
 * 각자 활성필터 목록을 따로 만들어 커버리지가 어긋났다(검색어·계좌 필터를 한쪽만 표시).
 * 이 빌더가 둘의 단일 소스 — LedgerPage에서 한 번 만들어 양쪽에 내려준다.
 */
import { formatKRW } from "../../utils/formatter";

export interface ActiveFilterChip {
  key: string;
  /** 칩 라벨 (× 표식은 렌더 측에서 부가) */
  label: string;
  /** 이 필터만 해제 */
  clear: () => void;
}

interface LedgerFilterValues {
  searchQuery: string;
  filterMainCategory?: string;
  filterSubCategory?: string;
  filterDetailCategory?: string;
  filterFromAccountId?: string;
  filterToAccountId?: string;
  filterFromAccountName: string | null;
  filterToAccountName: string | null;
  filterAccountId: string | null;
  filterAccountName: string | null;
  filterAmountMin?: number;
  filterAmountMax?: number;
  filterTagsInput: string;
  dateFilter: { startDate?: string; endDate?: string };
}

interface LedgerFilterSetters {
  setSearchQuery: (v: string) => void;
  setFilterMainCategory: (v: string | undefined) => void;
  setFilterSubCategory: (v: string | undefined) => void;
  setFilterDetailCategory: (v: string | undefined) => void;
  setFilterFromAccountId: (v: string | undefined) => void;
  setFilterToAccountId: (v: string | undefined) => void;
  setFilterAccountId: (v: string | null) => void;
  setFilterAmountMin: (v: number | undefined) => void;
  setFilterAmountMax: (v: number | undefined) => void;
  setFilterTagsInput: (v: string) => void;
  setDateFilter: (v: { startDate?: string; endDate?: string }) => void;
}

function amountLabel(min?: number, max?: number): string {
  if (min != null && max != null) return `금액: ${formatKRW(min)} ~ ${formatKRW(max)}`;
  if (min != null) return `금액: ${formatKRW(min)} 이상`;
  return `금액: ${formatKRW(max as number)} 이하`;
}

function dateRangeLabel(d: { startDate?: string; endDate?: string }): string {
  if (d.startDate && d.endDate) return `${d.startDate} ~ ${d.endDate}`;
  if (d.startDate) return `${d.startDate} ~`;
  return `~ ${d.endDate}`;
}

export function buildLedgerActiveChips(v: LedgerFilterValues, s: LedgerFilterSetters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (v.searchQuery.trim()) {
    chips.push({ key: "search", label: `"${v.searchQuery.trim()}"`, clear: () => s.setSearchQuery("") });
  }
  if (v.filterMainCategory) {
    chips.push({
      key: "main",
      label: v.filterMainCategory,
      clear: () => { s.setFilterMainCategory(undefined); s.setFilterSubCategory(undefined); s.setFilterDetailCategory(undefined); },
    });
  }
  if (v.filterSubCategory) {
    chips.push({ key: "sub", label: v.filterSubCategory, clear: () => { s.setFilterSubCategory(undefined); s.setFilterDetailCategory(undefined); } });
  }
  if (v.filterDetailCategory) {
    chips.push({ key: "detail", label: v.filterDetailCategory, clear: () => s.setFilterDetailCategory(undefined) });
  }
  if (v.filterFromAccountId) {
    chips.push({ key: "from", label: `출금: ${v.filterFromAccountName ?? v.filterFromAccountId}`, clear: () => s.setFilterFromAccountId(undefined) });
  }
  if (v.filterToAccountId) {
    chips.push({ key: "to", label: `입금: ${v.filterToAccountName ?? v.filterToAccountId}`, clear: () => s.setFilterToAccountId(undefined) });
  }
  if (v.filterAccountId) {
    chips.push({ key: "account", label: `계좌: ${v.filterAccountName ?? v.filterAccountId}`, clear: () => s.setFilterAccountId(null) });
  }
  if (v.dateFilter.startDate || v.dateFilter.endDate) {
    chips.push({ key: "date", label: dateRangeLabel(v.dateFilter), clear: () => s.setDateFilter({}) });
  }
  if (v.filterAmountMin != null || v.filterAmountMax != null) {
    chips.push({ key: "amount", label: amountLabel(v.filterAmountMin, v.filterAmountMax), clear: () => { s.setFilterAmountMin(undefined); s.setFilterAmountMax(undefined); } });
  }
  // 실제 적용 로직과 동일 기준으로 판정 — "," 나 ", "만 입력하면 trim은 truthy지만
  // split(",").map(trim).filter(Boolean)은 빈 배열이라 아무것도 걸러지지 않는다.
  // trim 기준으로 칩·필터배지·"필터 적용" 라벨만 켜지던 유령 활성 상태를 제거.
  const parsedTags = v.filterTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
  if (parsedTags.length > 0) {
    chips.push({ key: "tag", label: `태그: ${parsedTags.join(", ")}`, clear: () => s.setFilterTagsInput("") });
  }
  return chips;
}
