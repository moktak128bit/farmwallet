import { useCallback } from "react";
import type { LedgerKind, Account } from "../types";

export type LedgerTab = "income" | "expense" | "savingsExpense" | "transfer";

export interface LedgerFormData {
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
  tags: string[];
}

export function useLedgerForm(
  ledgerTab: LedgerTab,
  accounts: Account[]
) {
  const getKindForTab = useCallback((tab: LedgerTab): LedgerKind => {
    return tab === "income" ? "income" : tab === "transfer" || tab === "savingsExpense" ? "transfer" : "expense";
  }, []);

  const parseAmountValue = useCallback((value: string): number => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return 0;
    return Number(numeric);
  }, []);

  const formatAmountValue = useCallback((value: string): string => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return "";
    return Math.round(Number(numeric)).toLocaleString();
  }, []);

  return {
    getKindForTab,
    parseAmountValue,
    formatAmountValue
  };
}
