import { useEffect, useMemo, useState } from "react";
import type { AppData } from "../types";
import { STORAGE_KEYS } from "../constants/config";
import { toast } from "react-hot-toast";

export interface SearchQuery {
  keyword: string;
  minAmount?: number;
  maxAmount?: number;
  includeLedger: boolean;
  includeTrades: boolean;
}

export interface SavedFilter {
  id: string;
  name: string;
  query: SearchQuery;
}

export function useSearch(data: AppData) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<SearchQuery>({
    keyword: "",
    includeLedger: true,
    includeTrades: true
  });
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // Saved filters 로드
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.SAVED_FILTERS);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedFilter[];
        setSavedFilters(parsed);
      }
    } catch (e) {
      console.warn("[useSearch] 검색 인덱스 로드 실패", e);
    }
  }, []);

  const isSearchActive = useMemo(() => {
    const hasKeyword = searchQuery.keyword.trim().length > 0;
    const hasAmountRange =
      searchQuery.minAmount != null || searchQuery.maxAmount != null;
    const hasTypeFilter =
      !searchQuery.includeLedger || !searchQuery.includeTrades;
    return isSearchOpen || hasKeyword || hasAmountRange || hasTypeFilter;
  }, [isSearchOpen, searchQuery]);

  const unifiedRecords = useMemo(() => {
    if (!isSearchActive) return [];

    const ledgerRecords = data.ledger.map((l) => ({
      type: "ledger" as const,
      id: l.id,
      date: l.date,
      title: l.description || l.category || l.kind,
      amount: l.amount,
      meta: `${l.kind} ${l.category ?? ""} ${l.subCategory ?? ""} ${l.description ?? ""}`.toLowerCase(),
      accounts: [l.fromAccountId, l.toAccountId].filter(Boolean).join(" / "),
      ticker: "",
      accountId: l.toAccountId || l.fromAccountId || ""
    }));
    const tradeRecords = data.trades.map((t) => ({
      type: "trade" as const,
      id: t.id,
      date: t.date,
      title: `${t.ticker} ${t.name ?? ""} ${t.side === "buy" ? "매수" : "매도"}`,
      amount: t.totalAmount,
      meta: `${t.ticker} ${t.name ?? ""} ${t.side}`.toLowerCase(),
      accounts: t.accountId,
      ticker: t.ticker,
      accountId: t.accountId
    }));
    return [...ledgerRecords, ...tradeRecords].sort((a, b) => b.date.localeCompare(a.date));
  }, [data.ledger, data.trades, isSearchActive]);

  const filteredSearchResults = useMemo(() => {
    if (!isSearchActive) return [];

    const { keyword, minAmount, maxAmount, includeLedger, includeTrades } = searchQuery;
    const key = keyword.trim().toLowerCase();
    const broadSearch =
      key.length === 0 && minAmount == null && maxAmount == null;
    const resultLimit = broadSearch ? 500 : Number.POSITIVE_INFINITY;
    const results: typeof unifiedRecords = [];

    for (const r of unifiedRecords) {
      if (r.type === "ledger" && !includeLedger) continue;
      if (r.type === "trade" && !includeTrades) continue;
      if (key) {
        const hay = `${r.title} ${r.meta} ${r.accounts}`.toLowerCase();
        if (!hay.includes(key)) continue;
      }
      if (minAmount != null && r.amount < minAmount) continue;
      if (maxAmount != null && r.amount > maxAmount) continue;
      results.push(r);
      if (results.length >= resultLimit) break;
    }

    return results;
  }, [searchQuery, unifiedRecords, isSearchActive]);

  const saveCurrentFilter = (name: string) => {
    if (!name.trim()) return;
    const entry: SavedFilter = { id: `F${Date.now()}`, name: name.trim(), query: searchQuery };
    const next = [entry, ...savedFilters].slice(0, 10);
    setSavedFilters(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.SAVED_FILTERS, JSON.stringify(next));
      toast.success("필터 저장됨");
    }
  };

  const applySavedFilter = (id: string) => {
    const found = savedFilters.find((f) => f.id === id);
    if (!found) return;
    setSearchQuery(found.query);
    setIsSearchOpen(true);
    toast.success(`'${found.name}' 필터 적용`);
  };

  const deleteSavedFilter = (id: string) => {
    const next = savedFilters.filter((f) => f.id !== id);
    setSavedFilters(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.SAVED_FILTERS, JSON.stringify(next));
      toast.success("필터 삭제됨");
    }
  };

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    savedFilters,
    filteredSearchResults,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter
  };
}
