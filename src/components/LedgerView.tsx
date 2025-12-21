import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete } from "./Autocomplete";
import type { Account, CategoryPresets, ExpenseDetailGroup, LedgerEntry, LedgerKind } from "../types";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  onChangeLedger: (next: LedgerEntry[]) => void;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  income: "수입",
  expense: "지출",
  transfer: "이체"
};

type LedgerTab = "income" | "expense" | "savingsExpense" | "transfer";

function createDefaultForm(): {
  id?: string;
  date: string;
  kind: LedgerKind;
  isFixedExpense: boolean;
  mainCategory: string;
  subCategory: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
} {
  return {
    id: undefined,
    date: new Date().toISOString().slice(0, 10),
    kind: "income",
    isFixedExpense: false,
    mainCategory: "",
    subCategory: "",
    description: "",
    fromAccountId: "",
    toAccountId: "",
    amount: ""
  };
}

export const LedgerView: React.FC<Props> = ({
  accounts,
  ledger,
  categoryPresets,
  onChangeLedger
}) => {
  const [form, setForm] = useState(createDefaultForm);
  const [viewMode, setViewMode] = useState<"all" | "monthly">("all");
  // 기본 탭을 지출로 설정해 입력 흐름을 간소화
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("expense");
  const [quickMode, setQuickMode] = useState(true); // 빠른 입력 모드
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  
  // 고정지출 자동 생성: 이전 달의 고정지출을 현재 달로 복사
  useEffect(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentDay = String(now.getDate()).padStart(2, "0");
    
    // 이전 달 계산
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
    
    // 현재 달의 고정지출 확인
    const currentMonthFixed = ledger.filter(
      (l) => l.isFixedExpense && l.date.startsWith(currentMonth)
    );
    
    // 이전 달의 고정지출 확인
    const prevMonthFixed = ledger.filter(
      (l) => l.isFixedExpense && l.date.startsWith(prevMonth)
    );
    
    // 이전 달의 고정지출이 있고, 현재 달에 해당하는 항목이 없으면 생성
    if (prevMonthFixed.length > 0 && currentMonthFixed.length === 0) {
      const newEntries: LedgerEntry[] = prevMonthFixed.map((prev) => {
        // 날짜를 현재 달의 같은 날짜로 변경
        const prevDate = new Date(prev.date);
        const newDate = new Date(now.getFullYear(), now.getMonth(), prevDate.getDate());
        const newDateStr = newDate.toISOString().slice(0, 10);
        
        // 같은 내용의 항목이 이미 있는지 확인 (같은 날짜, 같은 카테고리, 같은 금액)
        const exists = ledger.some(
          (l) =>
            l.date === newDateStr &&
            l.category === prev.category &&
            l.subCategory === prev.subCategory &&
            l.amount === prev.amount &&
            l.fromAccountId === prev.fromAccountId
        );
        
        if (exists) return null;
        
        return {
          ...prev,
          id: `L${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: newDateStr
        };
      }).filter((e): e is LedgerEntry => e !== null);
      
      if (newEntries.length > 0) {
        onChangeLedger([...newEntries, ...ledger]);
      }
    }
  }, [ledger, onChangeLedger]);
  
  // 최근 사용한 항목 추적
  const recentItems = useMemo(() => {
    const items = new Map<string, { count: number; lastUsed: string }>();
    ledger.forEach((l) => {
      const key = form.kind === "income" 
        ? `${l.kind}:${l.subCategory || l.category}`
        : `${l.kind}:${l.category}:${l.subCategory || ""}`;
      const existing = items.get(key);
      if (existing) {
        items.set(key, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
      } else {
        items.set(key, { count: 1, lastUsed: l.date });
      }
    });
    return Array.from(items.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 5)
      .map(([key]) => key);
  }, [ledger, form.kind]);
  
  // 최근 사용한 계좌 추적
  const recentAccounts = useMemo(() => {
    const accountMap = new Map<string, { count: number; lastUsed: string }>();
    ledger.forEach((l) => {
      if (l.fromAccountId) {
        const existing = accountMap.get(l.fromAccountId);
        if (existing) {
          accountMap.set(l.fromAccountId, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          accountMap.set(l.fromAccountId, { count: 1, lastUsed: l.date });
        }
      }
      if (l.toAccountId) {
        const existing = accountMap.get(l.toAccountId);
        if (existing) {
          accountMap.set(l.toAccountId, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          accountMap.set(l.toAccountId, { count: 1, lastUsed: l.date });
        }
      }
    });
    return Array.from(accountMap.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 3)
      .map(([id]) => id);
  }, [ledger]);

  const expenseSubSuggestions = useMemo(() => {
    const groups: ExpenseDetailGroup[] = categoryPresets.expenseDetails ?? [];
    if (!groups.length) return [] as string[];
    if (form.mainCategory) {
      const g = groups.find((x) => x.main === form.mainCategory);
      if (g) return g.subs;
    }
    return groups.flatMap((g) => g.subs);
  }, [categoryPresets.expenseDetails, form.mainCategory]);

  const parseAmount = (value: string): number => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return 0;
    return Number(numeric);
  };

  const formatAmount = (value: string): string => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return "";
    return Math.round(Number(numeric)).toLocaleString();
  };

  useEffect(() => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    setForm((prev) => ({
      ...prev,
      kind: kindForTab,
      isFixedExpense: false,
      mainCategory: kindForTab === "income" ? "" : prev.mainCategory,
      fromAccountId: kindForTab === "income" ? "" : prev.fromAccountId,
      toAccountId: kindForTab === "expense" ? "" : prev.toAccountId
    }));
  }, [ledgerTab]);

  const submitForm = (keepContext: boolean) => {
    const amount = parseAmount(form.amount);
    if (!form.date || !amount || amount <= 0) return;

    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    const isFixed = false;

    const base: Omit<LedgerEntry, "id"> = {
      date: form.date,
      kind: kindForTab,
      isFixedExpense: isFixed,
      category:
        kindForTab === "income"
          ? "수입"
          : form.mainCategory || (form.subCategory ? "(기타지출)" : "(미분류)"),
      subCategory:
        kindForTab === "income"
          ? form.subCategory || "(미분류)"
          : form.subCategory || form.mainCategory || "(미분류)",
      description: form.description || "",
      amount,
      fromAccountId:
        kindForTab === "expense" || kindForTab === "transfer"
          ? form.fromAccountId || undefined
          : undefined,
      toAccountId:
        kindForTab === "income" || kindForTab === "transfer"
          ? form.toAccountId || undefined
          : undefined
    };

    if (form.id) {
      const updated = ledger.map((l) => (l.id === form.id ? { ...base, id: l.id } : l));
      onChangeLedger(updated);
    } else {
      const id = `L${Date.now()}`;
      const entry: LedgerEntry = { id, ...base };
      onChangeLedger([entry, ...ledger]);
    }

    setForm((prev) => {
      if (keepContext) {
        // 같은 구분/카테고리/계좌를 유지하고 금액만 비우기
        return {
          ...prev,
          id: undefined,
          date: form.date,
          kind: kindForTab,
          isFixedExpense: isFixed,
          mainCategory: form.mainCategory,
          subCategory: form.subCategory,
          description: "",
          fromAccountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          amount: ""
        };
      }
      return {
        ...createDefaultForm(),
        kind: kindForTab,
        isFixedExpense: false
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitForm(false);
  };

  const startEdit = (entry: LedgerEntry) => {
    setForm({
      id: entry.id,
      date: entry.date,
      kind: entry.kind,
      isFixedExpense: entry.isFixedExpense ?? false,
      mainCategory: entry.kind === "income" ? "" : entry.category,
      subCategory: entry.subCategory ?? (entry.kind === "income" ? entry.category : ""),
      description: entry.description,
      fromAccountId: entry.fromAccountId ?? "",
      toAccountId: entry.toAccountId ?? "",
      amount: String(entry.amount)
    });
    const nextTab: LedgerTab =
      entry.kind === "income"
        ? "income"
        : entry.kind === "transfer"
          ? "transfer"
          : "expense";
    setLedgerTab(nextTab);
  };

  const startCopy = (entry: LedgerEntry) => {
    setForm({
      id: undefined,
      date: new Date().toISOString().slice(0, 10),
      kind: entry.kind,
      isFixedExpense: entry.isFixedExpense ?? false,
      mainCategory: entry.kind === "income" ? "" : entry.category,
      subCategory: entry.subCategory ?? (entry.kind === "income" ? entry.category : ""),
      description: entry.description,
      fromAccountId: entry.fromAccountId ?? "",
      toAccountId: entry.toAccountId ?? "",
      amount: String(entry.amount)
    });
    // 저축성 지출 판단: transfer이고 toAccountId가 증권/저축 계좌인 경우
    const isSavingsExpense = entry.kind === "transfer" && entry.toAccountId && 
      accounts.find(a => a.id === entry.toAccountId && (a.type === "securities" || a.type === "savings"));
    
    const nextTab: LedgerTab =
      entry.kind === "income"
        ? "income"
        : isSavingsExpense
          ? "savingsExpense"
          : entry.kind === "transfer"
            ? "transfer"
            : "expense";
    setLedgerTab(nextTab);
  };

  const resetForm = () => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    setForm({
      ...createDefaultForm(),
      kind: kindForTab,
      isFixedExpense: false
    });
  };

  const isEditing = Boolean(form.id);

  // 월별 필터링된 거래 목록
  const ledgerByTab = useMemo(() => {
    return ledger.filter((l) => {
      if (ledgerTab === "income") return l.kind === "income";
      if (ledgerTab === "transfer") {
        // 일반 이체만 (저축성 지출 제외)
        if (l.kind !== "transfer") return false;
        const toAccount = accounts.find(a => a.id === l.toAccountId);
        return !toAccount || (toAccount.type !== "securities" && toAccount.type !== "savings");
      }
      if (ledgerTab === "savingsExpense") {
        // 저축성 지출: transfer이고 toAccountId가 증권/저축 계좌
        if (l.kind !== "transfer") return false;
        const toAccount = accounts.find(a => a.id === l.toAccountId);
        return toAccount && (toAccount.type === "securities" || toAccount.type === "savings");
      }
      return l.kind === "expense" && !(l.isFixedExpense ?? false);
    });
  }, [ledger, ledgerTab, accounts]);

  const filteredLedger = useMemo(() => {
    const base = ledgerByTab;
    if (viewMode === "all") return base;
    return base.filter((l) => l.date.startsWith(selectedMonth));
  }, [ledgerByTab, viewMode, selectedMonth]);

  const tabLabel: Record<LedgerTab, string> = {
    income: "수입",
    expense: "지출",
    savingsExpense: "저축성 지출",
    transfer: "이체"
  };

  const totalByTab = useMemo(
    () => ledgerByTab.reduce((s, l) => s + l.amount, 0),
    [ledgerByTab]
  );
  const monthlyTotalByTab = useMemo(
    () => filteredLedger.reduce((s, l) => s + l.amount, 0),
    [filteredLedger]
  );

  // 사용 가능한 월 목록 (거래가 있는 월들)
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    ledgerByTab.forEach((l) => {
      const month = l.date.slice(0, 7); // YYYY-MM
      months.add(month);
    });
    return Array.from(months).sort().reverse(); // 최신순
  }, [ledgerByTab]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    ledgerByTab.forEach((l) => {
      years.add(l.date.slice(0, 4));
    });
    if (years.size === 0) {
      years.add(selectedMonth.slice(0, 4));
    }
    return Array.from(years).sort().reverse();
  }, [ledgerByTab, selectedMonth]);

  const currentYear = selectedMonth.slice(0, 4);

  const handleReorder = (id: string, newPosition: number) => {
    if (viewMode !== "all") return;
    const currentIndex = ledger.findIndex((l) => l.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(ledger.length - 1, newPosition));
    if (clamped === currentIndex) return;
    const next = [...ledger];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeLedger(next);
  };

  return (
    <div>
      <div className="section-header">
        <h2>가계부 (거래 입력)</h2>
        <div className="pill">
          {viewMode === "all"
            ? `${tabLabel[ledgerTab]} 합계: ${Math.round(totalByTab).toLocaleString()}원`
            : `${selectedMonth} ${tabLabel[ledgerTab]}: ${Math.round(monthlyTotalByTab).toLocaleString()}원`}
        </div>
      </div>

      <div style={{ marginBottom: "12px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={ledgerTab === "expense" ? "primary" : ""}
          onClick={() => setLedgerTab("expense")}
        >
          지출
        </button>
        <button
          type="button"
          className={ledgerTab === "savingsExpense" ? "primary" : ""}
          onClick={() => setLedgerTab("savingsExpense")}
        >
          저축성 지출
        </button>
        <button
          type="button"
          className={ledgerTab === "income" ? "primary" : ""}
          onClick={() => setLedgerTab("income")}
        >
          수입
        </button>
        <button
          type="button"
          className={ledgerTab === "transfer" ? "primary" : ""}
          onClick={() => setLedgerTab("transfer")}
        >
          이체
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          {quickMode ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setQuickMode(false)}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              📋 쉽게 보기
            </button>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => setQuickMode(true)}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              ⚡ 빠른 입력
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={viewMode === "all" ? "primary" : ""}
          onClick={() => setViewMode("all")}
        >
          전체 보기
        </button>
        <button
          type="button"
          className={viewMode === "monthly" ? "primary" : ""}
          onClick={() => setViewMode("monthly")}
        >
          월별 보기
        </button>
        {viewMode === "monthly" && (
          <>
            <select
              value={currentYear}
              onChange={(e) => {
                const year = e.target.value;
                const monthPart = selectedMonth.slice(5, 7);
                setSelectedMonth(`${year}-${monthPart}`);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)"
              }}
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
            <div className="month-tabs">
              {Array.from({ length: 12 }).map((_, idx) => {
                const monthNum = idx + 1;
                const monthPart = String(monthNum).padStart(2, "0");
                const key = `${currentYear}-${monthPart}`;
                const hasData = availableMonths.includes(key);
                const isActive = selectedMonth === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`month-tab ${isActive ? "active" : ""} ${
                      !hasData ? "empty" : ""
                    }`}
                    onClick={() => setSelectedMonth(key)}
                  >
                    {monthNum}월
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {quickMode ? (
        // 빠른 입력 모드
        <form className="card" onSubmit={handleSubmit} style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px 12px", alignItems: "end" }}>
            <label style={{ gridColumn: "span 1" }}>
              <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>날짜</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                style={{ padding: "8px", fontSize: 14 }}
              />
            </label>
            {form.kind === "income" ? (
              <label style={{ gridColumn: "span 1" }}>
                <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>수입 항목</span>
                <Autocomplete
                  value={form.subCategory}
                  onChange={(val) => setForm({ ...form, subCategory: val })}
                  options={categoryPresets.income
                    .filter((c) => c.toLowerCase().includes(form.subCategory.toLowerCase()))
                    .map((c) => ({ value: c }))}
                  placeholder="급여, 배당 등"
                />
              </label>
            ) : (
              <>
                <label style={{ gridColumn: "span 1" }}>
                  <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>대분류</span>
                  <Autocomplete
                    value={form.mainCategory}
                    onChange={(val) => setForm({ ...form, mainCategory: val })}
                    options={categoryPresets.expense
                      .filter((c) => c.toLowerCase().includes(form.mainCategory.toLowerCase()))
                      .map((c) => ({ value: c }))}
                    placeholder="식비, 주거비 등"
                  />
                </label>
                <label style={{ gridColumn: "span 1" }}>
                  <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>세부 항목</span>
                  <Autocomplete
                    value={form.subCategory}
                    onChange={(val) => setForm({ ...form, subCategory: val })}
                    options={expenseSubSuggestions
                      .filter((c) => c.toLowerCase().includes(form.subCategory.toLowerCase()))
                      .map((c) => ({ value: c }))}
                    placeholder="점심, 관리비 등"
                  />
                </label>
              </>
            )}
            <label style={{ gridColumn: "span 1" }}>
              <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>금액</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={form.amount}
                onChange={(e) => {
                  const formatted = formatAmount(e.target.value);
                  setForm({ ...form, amount: formatted });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitForm(true);
                  }
                }}
                style={{ padding: "8px", fontSize: 14, textAlign: "right" }}
              />
            </label>
            {(form.kind === "expense" || form.kind === "transfer") && (
              <label style={{ gridColumn: "span 1" }}>
                <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>출금계좌</span>
                <select
                  value={form.fromAccountId}
                  onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })}
                  style={{ padding: "8px", fontSize: 14 }}
                >
                  <option value="">선택</option>
                  {recentAccounts.map((id) => {
                    const acc = accounts.find((a) => a.id === id);
                    return acc ? (
                      <option key={id} value={id}>
                        {acc.id}
                      </option>
                    ) : null;
                  })}
                  {accounts
                    .filter((a) => !recentAccounts.includes(a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(form.kind === "income" || form.kind === "transfer") && (
              <label style={{ gridColumn: "span 1" }}>
                <span style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
                  {ledgerTab === "savingsExpense" ? "저축계좌 (증권/저축)" : "입금계좌"}
                </span>
                <select
                  value={form.toAccountId}
                  onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}
                  style={{ padding: "8px", fontSize: 14 }}
                >
                  <option value="">선택</option>
                  {ledgerTab === "savingsExpense" ? (
                    // 저축성 지출: 증권/저축 계좌만
                    accounts
                      .filter((a) => a.type === "securities" || a.type === "savings")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id}
                        </option>
                      ))
                  ) : (
                    // 일반 이체/수입: 모든 계좌
                    <>
                      {recentAccounts.map((id) => {
                        const acc = accounts.find((a) => a.id === id);
                        return acc ? (
                          <option key={id} value={id}>
                            {acc.id}
                          </option>
                        ) : null;
                      })}
                      {accounts
                        .filter((a) => !recentAccounts.includes(a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id}
                          </option>
                        ))}
                    </>
                  )}
                </select>
              </label>
            )}
            <div style={{ gridColumn: "span 1", display: "flex", gap: 4 }}>
              <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
                추가
              </button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
            💡 Enter 키로 빠르게 추가하고 계속 입력할 수 있습니다
          </div>
        </form>
      ) : (
        // 상세 입력 모드 (기존)
        <form className="card form-grid ledger-form" onSubmit={handleSubmit}>
        <label>
          <span>날짜</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label>
          <span>입력 구분</span>
          <div className="pill" style={{ justifyContent: "center" }}>
            {tabLabel[ledgerTab]}
          </div>
        </label>
        {form.kind === "income" ? (
          <>
            <label className="wide">
              <span>수입 항목</span>
              <Autocomplete
                value={form.subCategory}
                onChange={(val) => setForm({ ...form, subCategory: val })}
                options={categoryPresets.income
                  .filter((c) => c.toLowerCase().includes(form.subCategory.toLowerCase()))
                  .map((c) => ({ value: c }))}
                placeholder="예: 급여, 배당, 이자"
              />
              <div className="category-chip-row">
                {categoryPresets.income.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`category-chip ${form.subCategory === c ? "active" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        kind: "income",
                        subCategory: c
                      }))
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>
          </>
        ) : (
          <>
            <label className="wide">
              <span>지출 구분(대분류)</span>
              <Autocomplete
                value={form.mainCategory}
                onChange={(val) => setForm({ ...form, mainCategory: val })}
                options={categoryPresets.expense
                  .filter((c) => c.toLowerCase().includes(form.mainCategory.toLowerCase()))
                  .map((c) => ({ value: c }))}
                placeholder="예: 식비, 주거비"
              />
              <div className="category-chip-row">
                {categoryPresets.expense.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`category-chip ${form.mainCategory === c ? "active" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        kind: "expense",
                        mainCategory: c
                      }))
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>
            <label className="wide">
              <span>세부 항목</span>
              <Autocomplete
                value={form.subCategory}
                onChange={(val) => setForm({ ...form, subCategory: val })}
                options={expenseSubSuggestions
                  .filter((c) => c.toLowerCase().includes(form.subCategory.toLowerCase()))
                  .map((c) => ({ value: c }))}
                placeholder="예: 점심 식사, 관리비"
              />
              <div className="category-chip-row">
                {expenseSubSuggestions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`category-chip ${form.subCategory === c ? "active" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        kind: "expense",
                        subCategory: c
                      }))
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>
          </>
        )}
        <label className="wide">
          <span>상세내역</span>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {(form.kind === "expense" || form.kind === "transfer") && (
          <label>
            <span>출금계좌 (현금/카드)</span>
            <select
              value={form.fromAccountId}
              onChange={(e) => setForm({ ...form, fromAccountId: e.target.value })}
            >
              <option value="">선택</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
            <div className="hint">
              카드 결제는 카드 계좌를 선택하고, 결제일에 이체로 상환하세요.
            </div>
          </label>
        )}
        {(form.kind === "income" || form.kind === "transfer") && (
          <label>
            <span>{ledgerTab === "savingsExpense" ? "저축계좌 (증권/저축)" : "입금계좌"}</span>
            <select
              value={form.toAccountId}
              onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}
            >
              <option value="">선택</option>
              {ledgerTab === "savingsExpense" ? (
                // 저축성 지출: 증권/저축 계좌만
                accounts
                  .filter((a) => a.type === "securities" || a.type === "savings")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} - {a.name}
                    </option>
                  ))
              ) : (
                // 일반 이체/수입: 모든 계좌
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))
              )}
            </select>
          </label>
        )}
        <label>
          <span>금액</span>
          <input
            type="text"
            inputMode="numeric"
            value={form.amount}
            onChange={(e) => {
              const formatted = formatAmount(e.target.value);
              setForm({ ...form, amount: formatted });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitForm(true);
              }
            }}
          />
        </label>
        <div className="form-actions">
          {isEditing && (
            <button type="button" onClick={resetForm}>
              취소
            </button>
          )}
          <button type="submit" className="primary">
            {isEditing ? "저장" : "추가"}
          </button>
        </div>
      </form>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>순서</th>
            <th>날짜</th>
            <th>구분</th>
            <th>구분(대분류)</th>
            <th>항목</th>
            <th>상세내역</th>
            <th>출금계좌</th>
            <th>입금계좌</th>
            <th>금액</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {filteredLedger.map((l, index) => (
            <tr
              key={l.id}
              draggable={viewMode === "all"}
              onDragStart={() => {
                if (viewMode !== "all") return;
                setDraggingId(l.id);
              }}
              onDragOver={(e) => {
                if (viewMode !== "all") return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                if (viewMode !== "all") return;
                e.preventDefault();
                if (draggingId && draggingId !== l.id) {
                  handleReorder(draggingId, index);
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              onDoubleClick={() => startEdit(l)}
            >
              <td className="drag-cell">
                {viewMode === "all" ? (
                  <span className="drag-handle" title="잡고 위/아래로 끌어서 순서 변경">☰</span>
                ) : (
                  index + 1
                )}
              </td>
              <td>{l.date}</td>
              <td>{l.kind === "expense" && (l.isFixedExpense ?? false) ? "지출(고정)" : KIND_LABEL[l.kind]}</td>
              <td>{l.category}</td>
              <td>{l.subCategory ?? "-"}</td>
              <td>{l.description}</td>
              <td>{l.fromAccountId ?? "-"}</td>
              <td>{l.toAccountId ?? "-"}</td>
              <td className="number">{Math.round(l.amount).toLocaleString()}</td>
              <td>
                <button type="button" onClick={() => startEdit(l)}>
                  편집
                </button>
                <button type="button" onClick={() => startCopy(l)}>
                  복사
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filteredLedger.length === 0 && (
        <p>
          {viewMode === "all"
            ? "아직 거래가 없습니다. 위 폼에서 첫 거래를 입력해 보세요."
            : `${selectedMonth}에 거래 내역이 없습니다.`}
        </p>
      )}
    </div>
  );
};
