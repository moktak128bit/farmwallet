import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow, PositionRow, StockTrade } from "../types";
import { formatNumber, formatShortDate, formatKRW, formatUSD } from "../utils/formatter";
import { isUSDStock } from "../utils/finance";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { EmptyState } from "../components/ui/EmptyState";
import { Wallet, Download, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "react-hot-toast";
import { computeRealizedPnlByTradeId, positionMarketValueKRW } from "../calculations";
import { shouldUseUsdBalanceMode } from "../utils/tradeCashImpact";
import { parseAmount } from "../utils/parseAmount";
import { useAppStore } from "../store/appStore";
import { buildUnifiedCsv } from "../utils/unifiedCsvExport";

interface Props {
  accounts: Account[];
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  fxRate?: number | null;
  onChangeAccounts: (next: Account[]) => void;
  onChangeLedger?: (next: LedgerEntry[]) => void;
  onRenameAccountId: (oldId: string, newId: string) => void;
}

function CardPaymentSection({
  account,
  checkingAccounts,
  currentDebt,
  onAddPayment,
  formatKRW
}: {
  account: Account;
  checkingAccounts: Account[];
  currentDebt: number;
  onAddPayment: (entry: LedgerEntry) => void;
  formatKRW: (n: number) => string;
}) {
  const [fromAccountId, setFromAccountId] = useState(() => checkingAccounts[0]?.id ?? "");
  const [payAmount, setPayAmount] = useState("");
  const debtAmount = currentDebt < 0 ? Math.abs(currentDebt) : 0;

  const handlePay = () => {
    if (!fromAccountId) return;
    const amount = payAmount.trim() ? Math.round(parseAmount(payAmount)) : debtAmount;
    if (amount <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry: LedgerEntry = {
      id: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      date: today,
      kind: "transfer",
      category: "이체",
      subCategory: "카드결제이체",
      description: `${account.name} 결제`,
      fromAccountId,
      toAccountId: account.id,
      amount
    };
    onAddPayment(entry);
    toast.success(`카드 결제 추가됨: ${formatKRW(amount)}`);
    setPayAmount("");
  };

  return (
    <div style={{ marginBottom: 20, padding: 16, background: "var(--surface-alt)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>결제하기</div>
      {debtAmount > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          현재 부채: <span style={{ fontWeight: 600, color: "var(--danger)" }}>{formatKRW(debtAmount)}</span>
        </div>
      )}
      {checkingAccounts.length > 0 ? (
        <>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>결제 출금계좌</label>
          <select
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 10, borderRadius: 6 }}
          >
            {checkingAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.institution || "-"})</option>
            ))}
          </select>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>결제 금액</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder={debtAmount > 0 ? `전액 ${formatKRW(debtAmount)}` : "0"}
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9,]/g, ""))}
            style={{ width: "100%", padding: 8, marginBottom: 10, borderRadius: 6 }}
          />
          <button
            type="button"
            className="primary"
            onClick={handlePay}
            disabled={debtAmount <= 0 && !payAmount.trim()}
            style={{ width: "100%" }}
          >
            {debtAmount > 0 && !payAmount.trim() ? "전액 결제 추가" : "카드 결제 추가"}
          </button>
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>입출금/저축 계좌를 추가한 뒤 결제를 등록할 수 있습니다.</p>
      )}
    </div>
  );
}

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "입출금",
  savings: "저축",
  card: "신용카드",
  securities: "증권",
  crypto: "암호화폐",
  other: "기타"
};

function normalizeDebtValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function sanitizeSignedNumericInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9+\-.,]/g, "");
  if (!cleaned) return "";
  const first = cleaned[0];
  const sign = first === "+" || first === "-" ? first : "";
  const body = (sign ? cleaned.slice(1) : cleaned).replace(/[+\-]/g, "");
  return `${sign}${body}`;
}

function parseSignedAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, "");
  if (!normalized) return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export const AccountsView: React.FC<Props> = ({
  accounts,
  balances,
  positions,
  ledger,
  trades = [],
  fxRate = null,
  onChangeAccounts,
  onChangeLedger,
  onRenameAccountId
}) => {
  const storeData = useAppStore((s) => s.data);
  const safeAccounts = accounts ?? [];
  const safeBalances = balances ?? [];
  const safePositions = positions ?? [];

  const handleExportAllCsv = useCallback(() => {
    const unified = buildUnifiedCsv(storeData.ledger, storeData.trades, storeData.accounts, storeData.categoryPresets);
    const bom = "\uFEFF";
    const blob = new Blob([bom + unified], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `farmwallet-all-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("전체 데이터 CSV 다운로드 완료");
  }, [storeData]);
  const [showForm, setShowForm] = useState(false);
  const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(false);
  const [editingNumber, setEditingNumber] = useState<{
    id: string;
    field: "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance";
  } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [adjustingAccount, setAdjustingAccount] = useState<{
    id: string;
    type: AccountType;
  } | null>(null);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustValueUSD, setAdjustValueUSD] = useState("");
  const [isAdjustingUSD, setIsAdjustingUSD] = useState(false);
  const [isSetDirectly, setIsSetDirectly] = useState(false);
  const [editUsdBalance, setEditUsdBalance] = useState("");
  const [editKrwBalance, setEditKrwBalance] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const accountNameClickTimerRef = useRef<number | null>(null);
  const [localFxRate, setLocalFxRate] = useState<number | null>(null);
  const effectiveFxRate = fxRate ?? localFxRate;
  /** Opening-balance reverse calc: user-entered actual current balances by account */
  const [actualCurrentInput, setActualCurrentInput] = useState<Record<string, string>>({});
  /** 사용자가 직접 편집한 계좌 id 집합 — 자동 동기화에서 제외 */
  const [actualCurrentEdited, setActualCurrentEdited] = useState<Set<string>>(() => new Set());
  // 시작금액 → 이체 기록 변환 패널
  const [showSeedPanel, setShowSeedPanel] = useState(false);
  const [seedSourceId, setSeedSourceId] = useState<string>("");
  const [seedDate, setSeedDate] = useState("2026-06-01");
  const realizedPnlByTradeId = useMemo(
    () => computeRealizedPnlByTradeId(trades ?? []),
    [trades]
  );

  // FX rate (parent에서 미전달 시 로컬 fetch)
  useEffect(() => {
    if (fxRate != null) return;
    const fetchRate = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        if (res[0]?.price) setLocalFxRate(res[0].price);
      } catch (err) {
        console.warn("환율 조회 실패", err);
      }
    };
    fetchRate();
    const interval = setInterval(fetchRate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fxRate]);

  const handleAddAccount = (account: Account) => {
    onChangeAccounts([...safeAccounts, account]);
    setShowForm(false);
  };

  const handleDeleteAccount = (id: string) => {
    onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
  };

  const handleAdjustBalance = () => {
    if (!adjustingAccount) return;
    
    if (adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") {
      const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
      const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
      if (!account || !balanceRow) return;
      
      const inputUsd = Number(editUsdBalance.replace(/[^\d.-]/g, "")) || 0;
      const inputKrw = Number(editKrwBalance.replace(/[^\d.-]/g, "")) || 0;
      
      let targetUsd: number;
      let targetKrw: number;
      const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
      const currentKrw = balanceRow.currentBalance ?? 0;
      
      if (isSetDirectly) {
        targetUsd = inputUsd;
        targetKrw = inputKrw;
      } else {
        // 원화/달러
        if (inputUsd === 0 && inputKrw === 0) {
          alert("USD 또는 KRW 중 하나 이상 0이 아닌 값을 입력해주세요.");
          return;
        }
        targetUsd = dispUsd + inputUsd;
        targetKrw = currentKrw + inputKrw;
      }
      
      const usdTransferNet = balanceRow.usdTransferNet ?? 0;
      const newUsdBalance = targetUsd - usdTransferNet;
      const currentCashAdj = account.cashAdjustment ?? 0;
      const baseWithoutAdj = balanceRow.currentBalance - currentCashAdj;
      const newCashAdjustment = targetKrw - baseWithoutAdj;
      
      onChangeAccounts(
        safeAccounts.map((a) => {
          if (a.id !== adjustingAccount.id) return a;
          return { ...a, usdBalance: newUsdBalance, cashAdjustment: newCashAdjustment };
        })
      );
      setAdjustingAccount(null);
      setEditUsdBalance("");
      setEditKrwBalance("");
      setIsSetDirectly(false);
      return;
    }
    
    const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
    const currentBalance = balanceRow?.currentBalance ?? 0;

    let value = 0;
    if (isAdjustingUSD && adjustValueUSD) {
      const usdValue = parseAmount(adjustValueUSD, { allowDecimal: true });
      if (usdValue === 0) {
        alert("0이 아닌 값을 입력해주세요.");
        return;
      }
      if (!fxRate) {
        alert("환율 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      value = usdValue * fxRate;
    } else if (adjustValue.trim() !== "") {
      const parsed = parseSignedAmount(adjustValue);
      if (parsed == null) {
        alert("금액 형식이 올바르지 않습니다. 예: +100000, -50000");
        return;
      }
      value = parsed;
      if (value === 0 && !isSetDirectly) {
        alert("0이 아닌 값을 입력해주세요.");
        return;
      }
    } else {
      alert("금액을 입력해주세요.");
      return;
    }

    const updated = safeAccounts.map((a) => {
      if (a.id !== adjustingAccount.id) return a;

      if (adjustingAccount.type === "card") {
        return a;
      } else {
        if (isSetDirectly) {
          const delta = value - currentBalance;
          return { ...a, initialBalance: (a.initialBalance ?? 0) + delta };
        }
        return { ...a, initialBalance: (a.initialBalance ?? 0) + value };
      }
    });

    onChangeAccounts(updated);
    setAdjustValue("");
    setAdjustValueUSD("");
    setIsAdjustingUSD(false);
    setIsSetDirectly(false);
  };

  const startEditNumber = (
    accountId: string,
    field: "initialBalance" | "debt" | "savings" | "cashAdjustment" | "initialCashBalance",
    currentValue: number
  ) => {
    setEditingNumber({ id: accountId, field });
    setEditValue(String(currentValue));
  };

  const saveNumber = () => {
    if (!editingNumber) return;
    const value = parseAmount(editValue);
    const updated = accounts.map((a) => {
      if (a.id === editingNumber.id) {
        if (editingNumber.field === "cashAdjustment") {
          return { ...a, cashAdjustment: value };
        }
        if (editingNumber.field === "initialCashBalance") {
          return { ...a, initialCashBalance: value };
        }
        if (editingNumber.field === "debt") {
          return { ...a, debt: value };
        }
        if (editingNumber.field === "savings") {
          return { ...a, savings: value };
        }
        return { ...a, [editingNumber.field]: value };
      }
      return a;
    });
    onChangeAccounts(updated);
    setEditingNumber(null);
    setEditValue("");
  };

  const cancelEditNumber = () => {
    setEditingNumber(null);
    setEditValue("");
  };

  const handleReorderAccount = (id: string, newIndex: number) => {
    const currentIndex = accounts.findIndex((a) => a.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(accounts.length - 1, newIndex));
    if (clamped === currentIndex) return;
    const next = [...accounts];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeAccounts(next);
  };

  const startEditCell = (id: string, field: "id" | "name" | "institution" | "type" | "currency" | "usdBalance" | "krwBalance", current: string | number) => {
    setEditingCell({ id, field });
    setEditingCellValue(String(current));
  };

  const saveCell = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const raw = editingCellValue.trim();
    if (field === "id") {
      if (!raw) {
        alert("계좌 ID를 입력해 주세요.");
        return;
      }
      const nextId = raw.toUpperCase().replace(/\s/g, "_");
      if (nextId === id) {
        setEditingCell(null);
        setEditingCellValue("");
        return;
      }
      const exists = safeAccounts.some((a) => a.id === nextId && a.id !== id);
      if (exists) {
        alert("이미 사용 중인 계좌 ID입니다. 다른 ID를 입력해주세요.");
        return;
      }
      onRenameAccountId(id, nextId);
    } else if (field === "currency") {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? { ...a, currency: (raw === "KRW" || raw === "USD") ? (raw as "KRW" | "USD") : undefined }
          : a
      );
      onChangeAccounts(updated);
    } else {
      const updated = safeAccounts.map((a) =>
        a.id === id
          ? {
              ...a,
              [field]: field === "type" 
                ? (editingCellValue as AccountType)
                : field === "usdBalance" || field === "krwBalance"
                ? Number(raw.replace(/[^\d.-]/g, "")) || 0
                : editingCellValue
            }
          : a
      );
      onChangeAccounts(updated);
    }
    setEditingCell(null);
    setEditingCellValue("");
  };

  const cancelCell = () => {
    setEditingCell(null);
    setEditingCellValue("");
  };

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    safePositions.forEach((p) => {
      // Include only positive holdings with positive market value.
      if (p.quantity > 0 && p.marketValue > 0) {
        map.set(p.accountId, (map.get(p.accountId) ?? 0) + positionMarketValueKRW(p, effectiveFxRate));
      }
    });
    return map;
  }, [safePositions, effectiveFxRate]);

  /** 계좌의 '시작 잔액' (baseBalance). calculations.ts 와 완전 일치. */
  const getBaseBalance = (account: Account): number => {
    if (account.type === "securities" || account.type === "crypto") {
      return account.initialCashBalance ?? account.initialBalance ?? 0;
    }
    return account.initialBalance ?? 0;
  };

  /** 역산 초기잔액: rev = desired - computed + baseBalance */
  const reversedInitialBalance = (accountId: string): number | null => {
    const inputStr = actualCurrentInput[accountId];
    if (inputStr == null || inputStr.trim() === "") return null;
    const desired = Number(String(inputStr).replace(/[^\d.-]/g, "")) || 0;
    const row = safeBalances.find((b) => b.account.id === accountId);
    const account = safeAccounts.find((a) => a.id === accountId);
    if (!row || !account) return null;
    const baseBalance = getBaseBalance(account);
    const computedCurrent = row.currentBalance ?? 0;
    return desired - computedCurrent + baseBalance;
  };

  /** 모든 계좌의 cashAdjustment를 initialBalance/initialCashBalance에 병합해 시작금액을 단일화한다.
   *  currentBalance 공식에서 baseBalance와 cashAdjustment가 모두 더해지므로 병합해도 현재 잔액은 불변. */
  const flattenAllCashAdjustments = () => {
    const affected = safeAccounts.filter((a) => (a.cashAdjustment ?? 0) !== 0);
    if (affected.length === 0) {
      toast("정리할 계좌가 없습니다. 모든 계좌의 보정금액이 이미 0원입니다.", { icon: "ℹ️" });
      return;
    }
    const ok = window.confirm(
      `${affected.length}개 계좌의 보정금액을 시작금액에 병합합니다.\n현재 잔액은 변하지 않습니다.\n계속하시겠습니까?`
    );
    if (!ok) return;
    const updated = safeAccounts.map((a) => {
      const adj = a.cashAdjustment ?? 0;
      if (adj === 0) return a;
      if (a.type === "securities" || a.type === "crypto") {
        return {
          ...a,
          initialCashBalance: (a.initialCashBalance ?? a.initialBalance ?? 0) + adj,
          cashAdjustment: 0
        };
      }
      return { ...a, initialBalance: (a.initialBalance ?? 0) + adj, cashAdjustment: 0 };
    });
    onChangeAccounts(updated);
    toast.success(`${affected.length}개 계좌의 시작금액을 정리했습니다.`);
  };

  /** 농협 감지 checking 계좌 id (없으면 첫 checking 계좌, 그것도 없으면 빈 문자열) */
  const defaultSeedSourceId = useMemo(() => {
    const checkings = safeAccounts.filter((a) => a.type === "checking");
    const nh = checkings.find(
      (a) =>
        (a.institution && a.institution.includes("농협")) ||
        (a.name && a.name.includes("농협"))
    );
    return nh?.id ?? checkings[0]?.id ?? "";
  }, [safeAccounts]);

  /** 시작금액 → 이체 기록 변환: 모든 non-source 계좌의 effectiveStart(baseBalance + cashAdjustment)를
   *  source와의 이체로 옮긴다. cashAdjustment도 함께 자동 병합. currentBalance 보존됨. */
  const applySeedTransferConversion = () => {
    if (!onChangeLedger) {
      toast.error("가계부 기록 수정 권한이 없습니다.");
      return;
    }
    const source = safeAccounts.find((a) => a.id === seedSourceId);
    if (!source) {
      toast.error("출금 계좌를 선택해주세요.");
      return;
    }

    // 실효 시작 잔액 = baseBalance + cashAdjustment (보정금액도 자동 흡수)
    const effectiveStart = (a: Account): number => {
      const base =
        a.type === "securities" || a.type === "crypto"
          ? (a.initialCashBalance ?? a.initialBalance ?? 0)
          : (a.initialBalance ?? 0);
      return base + (a.cashAdjustment ?? 0);
    };

    // target: non-source · non-card · effectiveStart != 0
    type Target = { account: Account; base: number };
    const targets: Target[] = [];
    let totalNonSourceBase = 0;
    for (const a of safeAccounts) {
      if (a.id === source.id) continue;
      if (a.type === "card") continue;
      const base = effectiveStart(a);
      if (Math.round(base) === 0) continue;
      targets.push({ account: a, base });
      totalNonSourceBase += base;
    }

    if (targets.length === 0) {
      toast("변환할 시작금액이 있는 계좌가 없습니다.", { icon: "ℹ️" });
      return;
    }

    const ok = window.confirm(
      `${targets.length}개 계좌의 시작금액(보정금액 포함)을 '${source.name}' 과의 이체 기록(${seedDate})으로 변환합니다.\n\n` +
        `- 각 계좌의 시작금액·보정금액이 0으로 초기화됩니다.\n` +
        `- '${source.name}' 의 시작금액은 전체 합계를 흡수합니다.\n` +
        `- 모든 계좌의 현재 잔액은 변하지 않습니다.\n\n계속하시겠습니까?`
    );
    if (!ok) return;

    // ledger entries 생성
    const newEntries: LedgerEntry[] = targets.map((t) => {
      const base = Math.round(t.base);
      const [fromId, toId, amount] =
        base > 0
          ? [source.id, t.account.id, base]
          : [t.account.id, source.id, -base];
      return {
        id: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        date: seedDate,
        kind: "transfer",
        category: "이체",
        subCategory: "계좌이체",
        description: "시작금액 이체 (자동 생성)",
        fromAccountId: fromId,
        toAccountId: toId,
        amount,
        currency: "KRW"
      };
    });

    // 계좌 업데이트: 모든 계좌의 cashAdjustment=0 병합, target은 base=0, source는 전체 합계 흡수
    const updatedAccounts = safeAccounts.map((a) => {
      if (a.id === source.id) {
        const sourceNewBase = effectiveStart(a) + totalNonSourceBase;
        if (a.type === "securities" || a.type === "crypto") {
          return { ...a, initialCashBalance: sourceNewBase, cashAdjustment: 0 };
        }
        return { ...a, initialBalance: sourceNewBase, cashAdjustment: 0 };
      }
      const isTarget = targets.some((t) => t.account.id === a.id);
      if (!isTarget) {
        // 비-target 이지만 cashAdjustment 잔여값은 정리해 병합
        if ((a.cashAdjustment ?? 0) === 0) return a;
        const merged = effectiveStart(a);
        if (a.type === "securities" || a.type === "crypto") {
          return { ...a, initialCashBalance: merged, cashAdjustment: 0 };
        }
        return { ...a, initialBalance: merged, cashAdjustment: 0 };
      }
      if (a.type === "securities" || a.type === "crypto") {
        return { ...a, initialCashBalance: 0, cashAdjustment: 0 };
      }
      return { ...a, initialBalance: 0, cashAdjustment: 0 };
    });

    onChangeAccounts(updatedAccounts);
    onChangeLedger([...ledger, ...newEntries]);
    toast.success(`${targets.length}건 이체 기록 생성 완료 (${seedDate})`);
    setShowSeedPanel(false);
  };

  const applyReversedInitial = () => {
    const updates: Account[] = safeAccounts.map((acc) => {
      const rev = reversedInitialBalance(acc.id);
      if (rev == null || acc.type === "card") return acc;
      if (acc.type === "securities" || acc.type === "crypto") {
        return { ...acc, initialCashBalance: rev, initialBalance: acc.initialBalance ?? 0 };
      }
      return { ...acc, initialBalance: rev };
    });
    onChangeAccounts(updates);
  };

  const cardDebtMap = useMemo(() => {
    const map = new Map<string, { total: number }>();
    const totalUsage = new Map<string, number>();
    const totalPayment = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    const cardIds = new Set(safeBalances.filter((r) => r.account.type === "card").map((r) => r.account.id));

    for (const l of ledger) {
      // 신용카드 사용 → 부채 증가 (출금계좌가 카드인 지출, 단 신용결제 제외)
      if (l.kind === "expense" && l.fromAccountId && l.category !== "신용결제") {
        add(totalUsage, l.fromAccountId, l.amount);
      }
      // 신용결제 또는 카드로 들어온 이체 → 부채 탕감
      if (l.toAccountId && cardIds.has(l.toAccountId)) {
        const isPayment =
          l.kind === "transfer" ||
          (l.kind === "expense" && l.category === "신용결제");
        if (isPayment) {
          const amt = l.amount;
          add(totalPayment, l.toAccountId, amt);
        }
      }
    }

    safeBalances.forEach((row) => {
      if (row.account.type === "card") {
        const cardId = row.account.id;
        const usage = totalUsage.get(cardId) ?? 0;
        const payment = totalPayment.get(cardId) ?? 0;
        map.set(cardId, {
          total: payment - usage
        });
      }
    });

    return map;
  }, [safeBalances, ledger]);

  // 계좌 종류별로 묶어서 표시
  const accountsByType = useMemo(() => {
    const grouped = new Map<AccountType, typeof safeBalances>();
    const typeOrder: AccountType[] = ["checking", "savings", "card", "securities", "crypto", "other"];

    typeOrder.forEach((type) => {
      grouped.set(type, []);
    });

    safeBalances.forEach((row) => {
      const type = row.account.type;
      const list = grouped.get(type) ?? [];
      list.push(row);
      grouped.set(type, list);
    });

    return grouped;
  }, [safeBalances]);


  // 카드 제외 목록: 위 "계좌별 잔액 구성" 표와 아래 "계좌 초기 금액 역산" 표가 공유하는 단일 소스
  // (원본 safeBalances 순서 유지 → 두 표가 항상 같은 순서로 나열됨)
  const orderedRowsForInitialReverse = useMemo(
    () => safeBalances.filter((row) => row.account.type !== "card"),
    [safeBalances]
  );

  // 계좌 초기 금액 역산 테이블: 편집 안 한 계좌는 항상 현재 잔액에 동기화
  // (거래가 추가돼 currentBalance가 바뀌면 입력칸도 최신 값 반영)
  // seedSourceId 자동 동기화: 비어 있으면 농협 감지 기본값으로 채움
  useEffect(() => {
    if (!seedSourceId && defaultSeedSourceId) {
      setSeedSourceId(defaultSeedSourceId);
    }
  }, [defaultSeedSourceId, seedSourceId]);

  useEffect(() => {
    if (orderedRowsForInitialReverse.length === 0) return;
    setActualCurrentInput((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of orderedRowsForInitialReverse) {
        if (actualCurrentEdited.has(row.account.id)) continue;
        const synced = String(Math.round(row.currentBalance ?? 0));
        if (prev[row.account.id] !== synced) {
          next[row.account.id] = synced;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [orderedRowsForInitialReverse, actualCurrentEdited]);

  const fillActualCurrentFromComputed = () => {
    const next: Record<string, string> = {};
    orderedRowsForInitialReverse.forEach((row) => {
      next[row.account.id] = String(Math.round(row.currentBalance ?? 0));
    });
    setActualCurrentInput(next);
    // 수동 편집 표식 초기화 → 이후 currentBalance 변경 시 자동 동기화 재개
    setActualCurrentEdited(new Set());
  };

  const totalSummary = useMemo(() => {
    // 증권 계좌만
    const securitiesAccounts = safeBalances.filter((row) => row.account.type === "securities" || row.account.type === "crypto");
    
    // USD 잔액 합계 (usdBalance + usdTransferNet)
    const totalUsdBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
    }, 0);
    // KRW 잔액 합계 (ledger 기반 currentBalance)
    const totalKrwBalance = securitiesAccounts.reduce((sum, row) => {
      return sum + row.currentBalance;
    }, 0);
    
    // 주식 평가금액 합계
    const totalStock = securitiesAccounts.reduce((sum, row) => {
      return sum + (stockMap.get(row.account.id) ?? 0);
    }, 0);
    
    // 증권계좌 현금자산 = (USD*환율) + KRW
    const securitiesCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
    
    // 입출금·저축 계좌 잔액 합계
    const checkingSavingsBalance = safeBalances
      .filter((row) => row.account.type === "checking" || row.account.type === "savings")
      .reduce((sum, row) => sum + row.currentBalance, 0);
    
    // 총 현금자산 = 증권 현금 + 입출금·저축 잔액
    const totalCash = securitiesCash + checkingSavingsBalance;
    
    // 총 자산 = 주식 + 총 현금
    const totalAsset = totalStock + totalCash;
    
    // USD 환산용
    const totalStockUSD = fxRate ? totalStock / fxRate : null;
    const totalCashUSD = fxRate ? totalCash / fxRate : null;
    const totalAssetUSD = fxRate ? totalAsset / fxRate : null;
    
    return {
      totalUsdBalance,
      totalKrwBalance,
      totalStock,
      totalCash,
      totalAsset,
      totalStockUSD,
      totalCashUSD,
      totalAssetUSD
    };
  }, [safeBalances, stockMap, fxRate]);

  // Summary by account type
  const typeSummary = useMemo(() => {
    const checking = safeBalances
      .filter((r) => r.account.type === "checking")
      .reduce((s, r) => s + r.currentBalance, 0);
    const savings = safeBalances
      .filter((r) => r.account.type === "savings")
      .reduce((s, r) => s + r.currentBalance, 0);
    const cardNet = Array.from(cardDebtMap.values()).reduce((s, v) => s + v.total, 0);
    const cardDebt = Array.from(cardDebtMap.values()).reduce((s, v) => s + (v.total < 0 ? Math.abs(v.total) : 0), 0);
    const cardCredit = Array.from(cardDebtMap.values()).reduce((s, v) => s + (v.total > 0 ? v.total : 0), 0);
    const securities = safeBalances
      .filter((r) => r.account.type === "securities" || r.account.type === "crypto")
      .reduce((s, row) => {
        const stock = stockMap.get(row.account.id) ?? 0;
        const krw = row.currentBalance;
        const usd = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
        const usdKrw = fxRate ? usd * fxRate : 0;
        return s + stock + krw + usdKrw;
      }, 0);
    // 순자산 계산에는 카드 net(초과결제=+, 미결제=-) 그대로 반영
    const total = checking + savings + securities + cardNet;
    return { checking, savings, cardNet, cardDebt, cardCredit, securities, total };
  }, [safeBalances, stockMap, cardDebtMap, fxRate]);

  const renderAccountRow = (row: typeof safeBalances[0], index: number, accountType: AccountType) => (
    <tr
      key={row.account.id}
      draggable
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        const currentIndex = safeBalances.findIndex((b) => b.account.id === draggingId);
        handleReorderAccount(draggingId, currentIndex);
        setDraggingId(null);
      }}
      onDragStart={() => setDraggingId(row.account.id)}
      onDragEnd={() => setDraggingId(null)}
    >
      <td className="drag-cell">
        <span className="drag-handle" title="드래그하여 순서 변경">::</span>
      </td>
      <td
        onDoubleClick={() => startEditCell(row.account.id, "id", row.account.id)}
        style={{ cursor: "pointer" }}
        title="더블클릭하여 계좌 ID 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "id" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.id
        )}
      </td>
      <td
        onClick={(e) => {
          if (editingCell?.id === row.account.id && editingCell?.field === "name") return;
          e.stopPropagation();
          if (accountNameClickTimerRef.current != null) {
            window.clearTimeout(accountNameClickTimerRef.current);
            accountNameClickTimerRef.current = null;
          }
          accountNameClickTimerRef.current = window.setTimeout(() => {
            accountNameClickTimerRef.current = null;
            setSelectedAccount(row.account);
          }, 250);
        }}
        onDoubleClick={() => {
          if (accountNameClickTimerRef.current != null) {
            window.clearTimeout(accountNameClickTimerRef.current);
            accountNameClickTimerRef.current = null;
          }
          setSelectedAccount(null);
          startEditCell(row.account.id, "name", row.account.name ?? "");
        }}
        style={{ cursor: "pointer" }}
        title="클릭: 거래 내역 보기, 더블클릭: 계좌명 수정"
      >
        {editingCell && editingCell.id === row.account.id && editingCell.field === "name" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.name
        )}
      </td>
      <td
        onDoubleClick={() =>
          startEditCell(row.account.id, "institution", row.account.institution ?? "")
        }
        style={{ cursor: "pointer" }}
        title="더블클릭하여 기관 수정"
      >
        {editingCell &&
        editingCell.id === row.account.id &&
        editingCell.field === "institution" ? (
          <input
            type="text"
            value={editingCellValue}
            autoFocus
            onChange={(e) => setEditingCellValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCell();
              if (e.key === "Escape") cancelCell();
            }}
            onBlur={saveCell}
          />
        ) : (
          row.account.institution
        )}
      </td>
      {(accountType === "securities" || accountType === "crypto") ? (
        (() => {
          const stockAsset = stockMap.get(row.account.id) ?? 0;
          const usdBalance = (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
          const krwBalance = row.currentBalance;

          const cashAsset = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
          const totalAsset = stockAsset + cashAsset;

          const stockAssetUSD = fxRate ? stockAsset / fxRate : null;
          const cashAssetUSD = fxRate ? cashAsset / fxRate : null;
          const totalAssetUSD = fxRate ? totalAsset / fxRate : null;

          return (
            <>
              {/* USD 잔액 (더블클릭 수정) */}
              <td
                onDoubleClick={() => startEditCell(row.account.id, "usdBalance", row.account.usdBalance ?? 0)}
                style={{ cursor: "pointer", padding: "8px", textAlign: "right" }}
                title="더블클릭하여 USD 잔액 수정"
                className="number"
              >
                {editingCell && editingCell.id === row.account.id && editingCell.field === "usdBalance" ? (
                  <input
                    type="text"
                    value={editingCellValue}
                    autoFocus
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^\d.-]/g, "");
                      setEditingCellValue(val);
                    }}
                    onBlur={saveCell}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCell();
                      if (e.key === "Escape") {
                        setEditingCell(null);
                        setEditingCellValue("");
                      }
                    }}
                    style={{ padding: "4px", fontSize: "13px", width: "100%", textAlign: "right" }}
                  />
                ) : (
                  <span style={{ fontWeight: 500, color: usdBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                    {formatUSD(usdBalance)}
                  </span>
                )}
              </td>
              {/* KRW 잔액 (ledger에서 자동 반영) */}
              <td
                style={{ padding: "8px", textAlign: "right" }}
                title="KRW 잔액 (원장에서 자동 반영)"
                className="number"
              >
                <span style={{ fontWeight: 500, color: krwBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {formatKRW(krwBalance)}
                </span>
              </td>
              {/* 주식자산 */}
              <td className={`number ${stockAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(stockAsset)}</div>
                {stockAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(stockAssetUSD)}
                  </div>
                )}
              </td>
              {/* 현금자산 (주식 제외) */}
              <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(cashAsset)}</div>
                {cashAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(cashAssetUSD)}
                  </div>
                )}
              </td>
              {/* 총 자산 */}
              <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                <div>{formatKRW(totalAsset)}</div>
                {totalAssetUSD != null && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {formatUSD(totalAssetUSD)}
                  </div>
                )}
              </td>
            </>
          );
        })()
      ) : (
        <>
          <td
            onDoubleClick={() => startEditCell(row.account.id, "type", row.account.type)}
            style={{ cursor: "pointer" }}
            title="더블클릭하여 계좌 유형 수정"
          >
            {editingCell && editingCell.id === row.account.id && editingCell.field === "type" ? (
              <select
                value={editingCellValue}
                autoFocus
                onChange={(e) => setEditingCellValue(e.target.value)}
                onBlur={saveCell}
              >
                <option value="checking">입출금</option>
                <option value="savings">저축</option>
                <option value="card">신용카드</option>
                <option value="securities">증권</option>
                <option value="crypto">암호화폐</option>
                <option value="other">기타</option>
              </select>
            ) : (
              ACCOUNT_TYPE_LABEL[row.account.type]
            )}
          </td>
        </>
      )}
      {(() => {
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const currency = isUSD ? "USD" : "KRW";
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        // Securities/crypto account is handled above.
        if (accountType === "securities" || accountType === "crypto") {
          return null;
        }
        
        // 증권/카드 계좌는 별도 렌더링 (위에서 securities, 아래에서 card 처리)
        if (accountType === "card") {
          return null;
        }
        
        // For checking/savings/other, display current balance.
        const cashAsset = row.currentBalance;
        
        return (
          <td className={`number ${cashAsset >= 0 ? "positive" : "negative"}`}>
            {formatAmount(cashAsset)}
          </td>
        );
      })()}
      {(() => {
        const accountName = (row.account.name + row.account.id).toLowerCase();
        const isUSD = row.account.currency === "USD" || 
                     accountName.includes("usd") || 
                     accountName.includes("dollar") || 
                     accountName.includes("달러");
        const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
        
        if (accountType === "card") {
          const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0 };
          const debtDisplay = debtInfo.total < 0 ? Math.abs(debtInfo.total) : 0;
          const creditDisplay = debtInfo.total > 0 ? debtInfo.total : 0;
          return (
            <>
              <td className="number" style={{ whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <div className={debtDisplay > 0 ? "negative" : "muted"}>
                    부채 {formatKRW(Math.round(debtDisplay))}
                  </div>
                  <div className={creditDisplay > 0 ? "positive" : "muted"}>
                    크레딧 {formatKRW(Math.round(creditDisplay))}
                  </div>
                </div>
              </td>
            </>
          );
        }
        return null;
      })()}
      <td style={{ whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setAdjustingAccount({ id: row.account.id, type: accountType });
              setAdjustValue("");
              setIsSetDirectly(false);
              // 증권/암호화폐 계좌 수정 시 USD/KRW 잔액 초기화
              if (accountType === "securities" || accountType === "crypto") {
                setEditUsdBalance("");
                setEditKrwBalance("");
              }
            }}
            style={{ fontSize: "14px", padding: "8px 16px" }}
          >
            수정
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const accountId = row.account.id;
              const ledgerRefs = ledger.filter((l) => l.fromAccountId === accountId || l.toAccountId === accountId).length;
              const tradeRefs = trades.filter((t) => t.accountId === accountId).length;
              const refParts: string[] = [];
              if (ledgerRefs > 0) refParts.push(`가계부 ${ledgerRefs}건`);
              if (tradeRefs > 0) refParts.push(`주식 거래 ${tradeRefs}건`);
              const refNote = refParts.length > 0
                ? `\n\n이 계좌를 참조하는 ${refParts.join(", ")}이 있습니다. 삭제하면 해당 항목은 '누락된 참조'로 표시되며 잔액/집계에 포함되지 않습니다.`
                : "\n\n관련 거래 내역은 유지됩니다.";
              if (window.confirm(`"${row.account.name}" 계좌를 삭제할까요?${refNote}`)) {
                handleDeleteAccount(accountId);
              }
            }}
            style={{ fontSize: "14px", padding: "8px 16px" }}
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="primary" onClick={handleExportAllCsv} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Download size={16} /> 전체 데이터 CSV 내보내기
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>가계부 + 주식거래 통합 CSV 1개 파일</span>
      </div>

      <div className="section-header">
        <h2>계좌</h2>
        <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "폼 닫기" : "계좌 추가"}
        </button>
      </div>

      {/* 요약: 현금·입출금·주식자산·부채 합계 (종류별 증권/카드 구분 표시) */}
      {safeBalances.length > 0 && (
        <div style={{
          marginBottom: "24px",
          padding: "16px 20px",
          background: "var(--surface)",
          borderRadius: "8px",
          border: "2px solid var(--primary)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "16px 24px",
            alignItems: "center"
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>현금</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.checking)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>저축</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.savings)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>부채</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: typeSummary.cardDebt > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                {formatKRW(typeSummary.cardDebt)}
              </span>
              {typeSummary.cardCredit > 0 && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  크레딧: <span style={{ fontWeight: 700, color: "var(--primary)" }}>{formatKRW(typeSummary.cardCredit)}</span>
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>주식</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                {formatKRW(typeSummary.securities)}
              </span>
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingLeft: "24px",
              borderLeft: "2px solid var(--border)",
              gridColumn: "span 1"
            }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>순자산</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: typeSummary.total >= 0 ? "var(--primary)" : "var(--danger)" }}>
                {formatKRW(typeSummary.total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {showForm && <AccountForm onAdd={handleAddAccount} existingIds={safeAccounts.map((a) => a.id)} />}

      {(["checking", "savings", "card", "securities", "crypto", "other"] as AccountType[]).map((type) => {
        const accountsOfType = accountsByType.get(type) ?? [];
        if (accountsOfType.length === 0) return null;
        
        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              {ACCOUNT_TYPE_LABEL[type]}
            </h3>
            <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>순서</th>
            <th>계좌 ID</th>
            <th>계좌명</th>
            <th>기관</th>
            {(type === "securities" || type === "crypto") ? (
              <>
                <th>USD</th>
                <th>KRW</th>
                <th>주식</th>
                <th>현금</th>
                <th>합계</th>
              </>
            ) : (
              <>
                <th style={{ width: "60px" }}>유형</th>
              </>
            )}
            {type === "card" ? (
              <>
                <th>부채 / 크레딧</th>
              </>
            ) : (
              <th>현재 잔액</th>
            )}
            <th>작업</th>
          </tr>
        </thead>
              <tbody>
                {accountsOfType.map((row) => renderAccountRow(row, 0, type))}
                {/* 합계 행 */}
                {(() => {
                  if (type === "securities" || type === "crypto") {
                    const totalStock = accountsOfType.reduce((sum, row) => {
                      return sum + (stockMap.get(row.account.id) ?? 0);
                    }, 0);

                    // USD 잔액 합계, KRW 잔액 합계
                    const totalUsdBalance = accountsOfType.reduce((sum, row) => {
                      return sum + (row.account.usdBalance ?? 0);
                    }, 0);
                    // KRW 잔액 합계 (ledger 기반 currentBalance)
                    const totalKrwBalance = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);

                    // 현금자산 합계 = (USD*환율) + KRW
                    const totalCash = fxRate ? (totalUsdBalance * fxRate) + totalKrwBalance : totalKrwBalance;
                    const totalAsset = totalStock + totalCash;
                    const totalStockUSD = fxRate ? totalStock / fxRate : null;
                    const totalCashUSD = fxRate ? totalCash / fxRate : null;
                    const totalAssetUSD = fxRate ? totalAsset / fxRate : null;

                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={4} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${totalUsdBalance >= 0 ? "positive" : "negative"}`}>
                          {formatUSD(totalUsdBalance)}
                        </td>
                        <td className={`number ${totalKrwBalance >= 0 ? "positive" : "negative"}`}>
                          {formatKRW(totalKrwBalance)}
                        </td>
                        <td className={`number ${totalStock >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalStock)}</div>
                          {totalStockUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalStockUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalCash >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalCash)}</div>
                          {totalCashUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalCashUSD)}
                            </div>
                          )}
                        </td>
                        <td className={`number ${totalAsset >= 0 ? "positive" : "negative"}`}>
                          <div>{formatKRW(totalAsset)}</div>
                          {totalAssetUSD != null && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                              {formatUSD(totalAssetUSD)}
                            </div>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else if (type === "card") {
                    const net = accountsOfType.reduce((sum, row) => {
                      const debtInfo = cardDebtMap.get(row.account.id) ?? { total: 0 };
                      return sum + debtInfo.total;
                    }, 0);
                    const debtDisplay = net < 0 ? Math.abs(net) : 0;
                    const creditDisplay = net > 0 ? net : 0;
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className="number" style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                            <div className={debtDisplay > 0 ? "negative" : "muted"}>
                              부채 {formatKRW(Math.round(debtDisplay))}
                            </div>
                            <div className={creditDisplay > 0 ? "positive" : "muted"}>
                              크레딧 {formatKRW(Math.round(creditDisplay))}
                            </div>
                          </div>
                        </td>
                        <td></td>
                      </tr>
                    );
                  } else {
                    // 입출금·저축 합계 (해당 유형의 currentBalance 합계)
                    const sumCurrentBalanceByType = accountsOfType.reduce((sum, row) => {
                      return sum + row.currentBalance;
                    }, 0);
                    return (
                      <tr key="total" style={{ backgroundColor: "var(--bg)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={5} style={{ textAlign: "right", padding: "12px" }}>합계</td>
                        <td className={`number ${sumCurrentBalanceByType >= 0 ? "positive" : "negative"}`}>
                          {formatKRW(Math.round(sumCurrentBalanceByType))}
                        </td>
                        <td></td>
                      </tr>
                    );
                  }
                })()}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* 계좌별 잔액 구성 상세 */}
      {safeBalances.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setShowBalanceBreakdown((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "16px 20px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text)",
              textAlign: "left"
            }}
          >
            {showBalanceBreakdown ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            계좌별 잔액 구성
          </button>
          {showBalanceBreakdown && (
            <div style={{ padding: "0 20px 20px" }}>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
                각 계좌의 현재 잔액이 어떻게 구성되었는지 항목별로 보여줍니다.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>계좌</th>
                      <th style={{ textAlign: "right" }}>시작금액</th>
                      <th style={{ textAlign: "right" }}>보정금액</th>
                      <th style={{ textAlign: "right" }}>수입</th>
                      <th style={{ textAlign: "right" }}>지출</th>
                      <th style={{ textAlign: "right" }}>이체 순액</th>
                      <th style={{ textAlign: "right" }}>매매 영향</th>
                      <th style={{
                        textAlign: "right",
                        borderLeft: "2px solid var(--border)",
                        paddingLeft: 12,
                        fontWeight: 700
                      }}>현재 잔액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedRowsForInitialReverse.map((row) => {
                        const account = row.account;
                        const baseBalance =
                          account.type === "securities" || account.type === "crypto"
                            ? (account.initialCashBalance ?? account.initialBalance ?? 0)
                            : (account.initialBalance ?? 0);
                        const cashAdj = account.cashAdjustment ?? 0;
                        const { incomeSum, expenseSum, transferNet, tradeCashImpact, currentBalance } = row;

                        const numCell = (value: number, opts?: { highlight?: boolean; muted?: boolean }) => {
                          const isZero = value === 0;
                          const color = opts?.highlight
                            ? (value >= 0 ? "var(--primary)" : "var(--danger)")
                            : isZero
                              ? "var(--text-muted)"
                              : value > 0
                                ? "var(--chart-income)"
                                : "var(--chart-expense)";
                          return (
                            <td style={{
                              textAlign: "right",
                              fontWeight: opts?.highlight ? 700 : (isZero ? 400 : 500),
                              color,
                              ...(opts?.highlight ? { borderLeft: "2px solid var(--border)", paddingLeft: 12 } : {})
                            }}>
                              {isZero && !opts?.highlight ? "-" : formatKRW(Math.round(value))}
                            </td>
                          );
                        };

                        const baseField: "initialBalance" | "initialCashBalance" =
                          account.type === "securities" || account.type === "crypto"
                            ? "initialCashBalance"
                            : "initialBalance";
                        const isEditingBase =
                          editingNumber?.id === account.id && editingNumber.field === baseField;
                        return (
                          <tr key={account.id}>
                            <td style={{
                              position: "sticky",
                              left: 0,
                              background: "var(--surface)",
                              zIndex: 1,
                              fontWeight: 500
                            }}>
                              <div>{account.name}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                                {account.institution || account.id}
                              </div>
                            </td>
                            {isEditingBase ? (
                              <td style={{ textAlign: "right" }}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={editValue}
                                  autoFocus
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={saveNumber}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveNumber();
                                    else if (e.key === "Escape") cancelEditNumber();
                                  }}
                                  style={{
                                    width: 100,
                                    padding: "4px 6px",
                                    borderRadius: 4,
                                    textAlign: "right",
                                    fontSize: 13
                                  }}
                                />
                              </td>
                            ) : (
                              <td
                                onClick={() => startEditNumber(account.id, baseField, baseBalance)}
                                title="클릭하여 시작금액 수정"
                                style={{
                                  textAlign: "right",
                                  fontWeight: baseBalance === 0 ? 400 : 500,
                                  color:
                                    baseBalance === 0
                                      ? "var(--text-muted)"
                                      : baseBalance > 0
                                        ? "var(--chart-income)"
                                        : "var(--chart-expense)",
                                  cursor: "pointer",
                                  textDecoration: "underline dotted",
                                  textUnderlineOffset: 3
                                }}
                              >
                                {baseBalance === 0 ? "-" : formatKRW(Math.round(baseBalance))}
                              </td>
                            )}
                            {numCell(cashAdj)}
                            {numCell(incomeSum)}
                            {numCell(expenseSum)}
                            {numCell(transferNet)}
                            {numCell(tradeCashImpact)}
                            {numCell(currentBalance, { highlight: true })}
                          </tr>
                        );
                      })}
                    {/* 합계 행 */}
                    {(() => {
                      const rows = orderedRowsForInitialReverse;
                      const totals = rows.reduce(
                        (acc, row) => {
                          const account = row.account;
                          const base =
                            account.type === "securities" || account.type === "crypto"
                              ? (account.initialCashBalance ?? account.initialBalance ?? 0)
                              : (account.initialBalance ?? 0);
                          return {
                            base: acc.base + base,
                            cashAdj: acc.cashAdj + (account.cashAdjustment ?? 0),
                            income: acc.income + row.incomeSum,
                            expense: acc.expense + row.expenseSum,
                            transfer: acc.transfer + row.transferNet,
                            trade: acc.trade + row.tradeCashImpact,
                            balance: acc.balance + row.currentBalance
                          };
                        },
                        { base: 0, cashAdj: 0, income: 0, expense: 0, transfer: 0, trade: 0, balance: 0 }
                      );

                      const totalCell = (value: number, opts?: { highlight?: boolean }) => (
                        <td style={{
                          textAlign: "right",
                          fontWeight: 700,
                          color: opts?.highlight
                            ? (value >= 0 ? "var(--primary)" : "var(--danger)")
                            : value === 0
                              ? "var(--text-muted)"
                              : "var(--text)",
                          ...(opts?.highlight ? { borderLeft: "2px solid var(--border)", paddingLeft: 12 } : {})
                        }}>
                          {value === 0 && !opts?.highlight ? "-" : formatKRW(Math.round(value))}
                        </td>
                      );

                      return (
                        <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg)" }}>
                          <td style={{
                            position: "sticky",
                            left: 0,
                            background: "var(--bg)",
                            zIndex: 1,
                            fontWeight: 700,
                            textAlign: "right",
                            paddingRight: 12
                          }}>합계</td>
                          {totalCell(totals.base)}
                          {totalCell(totals.cashAdj)}
                          {totalCell(totals.income)}
                          {totalCell(totals.expense)}
                          {totalCell(totals.transfer)}
                          {totalCell(totals.trade)}
                          {totalCell(totals.balance, { highlight: true })}
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                ※ 카드 계좌는 부채 추적용으로 이 표에서 제외됩니다. 이체 순액 합계가 0이 아닌 경우, 카드 계좌로의 순 이체(카드 결제 등)가 포함돼 있기 때문입니다.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 계좌 초기 금액 역산: 현재 보유금액이 맞지 않을 때 역산하여 초기 금액 적용 */}
      {orderedRowsForInitialReverse.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>계좌 초기 금액 역산</h3>
            <button
              type="button"
              className="secondary"
              onClick={flattenAllCashAdjustments}
              title="모든 계좌의 보정금액을 시작금액에 병합해 깔끔한 상태로 만듭니다 (현재 잔액 불변)"
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              모든 계좌 시작금액 정리
            </button>
            {onChangeLedger && (
              <button
                type="button"
                className="secondary"
                onClick={() => setShowSeedPanel((v) => !v)}
                title="모든 계좌의 시작금액을 출금 계좌와의 이체 기록으로 변환합니다 (현재 잔액 불변)"
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                시작금액 → 이체 기록 변환
              </button>
            )}
          </div>
          {showSeedPanel && onChangeLedger && (
            <div style={{
              marginBottom: 16,
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-end"
            }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--text-muted)" }}>
                출금 계좌
                <select
                  value={seedSourceId}
                  onChange={(e) => setSeedSourceId(e.target.value)}
                  style={{ padding: 6, borderRadius: 4, marginTop: 4, minWidth: 200 }}
                >
                  <option value="">-- 선택 --</option>
                  {safeAccounts
                    .filter((a) => a.type === "checking")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.institution || "-"})
                      </option>
                    ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--text-muted)" }}>
                기준 날짜
                <input
                  type="date"
                  value={seedDate}
                  onChange={(e) => setSeedDate(e.target.value)}
                  style={{ padding: 6, borderRadius: 4, marginTop: 4 }}
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={applySeedTransferConversion}
                style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600 }}
              >
                실행
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowSeedPanel(false)}
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                취소
              </button>
            </div>
          )}
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
            각 계좌의 <strong>현재 보유금액(역산)</strong>이 맞지 않을 때, 이체·거래 내역으로부터 역산한 계좌 초기 금액을 일괄 조정합니다.
          </p>
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>계좌명</th>
                <th style={{ textAlign: "right" }}>현재 보유금액(역산)</th>
                <th style={{ textAlign: "right" }}>계좌 초기 금액 역산</th>
              </tr>
            </thead>
            <tbody>
              {orderedRowsForInitialReverse.map((row) => {
                  const rev = reversedInitialBalance(row.account.id);
                  const currentBase = getBaseBalance(row.account);
                  const unchanged = rev != null && Math.round(rev) === Math.round(currentBase);
                  return (
                    <tr key={row.account.id}>
                      <td>
                        {row.account.name} ({row.account.institution || "-"})
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={actualCurrentInput[row.account.id] ?? ""}
                          onChange={(e) => {
                            setActualCurrentInput((prev) => ({
                              ...prev,
                              [row.account.id]: e.target.value
                            }));
                            // 사용자 편집 마킹 → 자동 동기화에서 제외
                            setActualCurrentEdited((prev) => {
                              if (prev.has(row.account.id)) return prev;
                              const next = new Set(prev);
                              next.add(row.account.id);
                              return next;
                            });
                          }}
                          placeholder="비어있음"
                          style={{
                            width: 120,
                            padding: "6px 8px",
                            borderRadius: 4,
                            textAlign: "right"
                          }}
                        />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: unchanged ? "var(--text-muted)" : undefined }}>
                        {rev == null ? "-" : formatKRW(Math.round(rev))}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              onClick={fillActualCurrentFromComputed}
              style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600 }}
            >
              실제값으로 채우기
            </button>
            <button
              type="button"
              className="primary"
              onClick={applyReversedInitial}
              style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600 }}
            >
              계좌 초기 금액 역산을 계좌에 적용
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 && (
        <EmptyState
          icon={<Wallet size={48} />}
          title="아직 계좌가 없습니다"
          message="첫 계좌를 추가해 보세요."
          action={{ label: "계좌 추가", onClick: () => setShowForm(true) }}
        />
      )}

      {/* 수정 모달: 잔액/부채 조정 */}
      {adjustingAccount && (() => {
        const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
        if (!account) return null;

        // 카드: 부채 합계, 그 외: 초기잔액
        const currentAdjustment =
          adjustingAccount.type === "card"
            ? (cardDebtMap.get(account.id)?.total ?? 0)
            : (account.initialBalance ?? 0);

        return (
          <div className="modal-backdrop" onClick={() => setAdjustingAccount(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "500px" }}>
              <div className="modal-header">
                <h3>
                  {(() => {
                    const label = `${account.name} (${ACCOUNT_TYPE_LABEL[adjustingAccount.type]})`;
                    if (adjustingAccount.type === "card") {
                      return `${label} - 결제 관리`;
                    } else if (adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") {
                      return `${label} - 보유금액 설정`;
                    } else {
                      return `${label} - 보유금액 조정`;
                    }
                  })()}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustingAccount(null);
                    setAdjustValue("");
                    setAdjustValueUSD("");
                    setIsAdjustingUSD(false);
                    setIsSetDirectly(false);
                    setEditUsdBalance("");
                    setEditKrwBalance("");
                  }}
                  style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                {/* 카드: 누적 부채 + 결제하기 */}
                {adjustingAccount.type === "card" && onChangeLedger && (
                  <CardPaymentSection
                    account={account}
                    checkingAccounts={safeAccounts.filter((a) => a.type === "checking" || a.type === "savings")}
                    currentDebt={cardDebtMap.get(account.id)?.total ?? 0}
                    onAddPayment={(entry) => {
                      onChangeLedger([...ledger, entry]);
                      setAdjustingAccount(null);
                    }}
                    formatKRW={formatKRW}
                  />
                )}

                {/* 카드: 부채 잔액 표시 */}
                {(() => {
                  const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
                  const currentBalance = balanceRow?.currentBalance ?? 0;
                  const accountName = (account.name + account.id).toLowerCase();
                  const isUSD = account.currency === "USD" || 
                               accountName.includes("usd") || 
                               accountName.includes("dollar") || 
                               accountName.includes("달러");
                  const formatAmount = (value: number) => isUSD ? formatUSD(value) : formatKRW(value);
                  
                  if ((adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") && balanceRow) {
                    const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
                    return (
                      <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 보유금액</div>
                        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                          <div>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>USD: </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: dispUsd >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {formatUSD(dispUsd)}
                            </span>
                          </div>
                          <div>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>KRW: </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                              {formatKRW(currentBalance)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (adjustingAccount.type === "card") {
                    const currentDebt = cardDebtMap.get(account.id)?.total ?? 0;
                    const debtDisplay = currentDebt < 0 ? Math.abs(currentDebt) : 0;
                    return (
                      <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 카드 부채</div>
                        <div style={{ fontSize: "24px", fontWeight: "700", color: debtDisplay > 0 ? "var(--danger)" : "var(--primary)" }}>
                          {formatAmount(debtDisplay)}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                          카드 사용/결제 내역이 자동 반영됩니다. 결제하면 부채가 탕감됩니다.
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 계좌 잔액</div>
                      <div style={{ fontSize: "24px", fontWeight: "700", color: currentBalance >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {formatAmount(currentBalance)}
                      </div>
                    </div>
                  );
                })()}
                
                {/* 증권/암호화폐 계좌: USD/KRW 잔액·자산 표시 */}
                {(adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") ? (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        직접 목표 잔액 설정 (체크 시 입력값이 현재 잔액이 됨)
                      </span>
                    </label>
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "USD 잔액" : "USD 증감 (음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editUsdBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditUsdBalance(val);
                        }}
                        placeholder={isSetDirectly ? "USD 잔액 (예: 1000.50)" : "USD 증감 (예: 100 또는 -50)"}
                        autoFocus
                        style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setEditUsdBalance("");
                            setEditKrwBalance("");
                          }
                        }}
                      />
                      {editUsdBalance && fxRate && (
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                          원화 환산 약 {formatNumber(parseAmount(editUsdBalance, { allowDecimal: true }) * fxRate)}원
                        </div>
                      )}
                    </label>
                    
                    <label style={{ marginBottom: "16px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        {isSetDirectly ? "원화 잔액 (KRW)" : "원화 증감 (KRW, 음수 입력 시 차감)"}
                      </span>
                      <input
                        type="text"
                        value={editKrwBalance}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.-]/g, "");
                          setEditKrwBalance(val);
                        }}
                        placeholder={isSetDirectly ? "KRW 잔액 (예: 1000000)" : "KRW 증감 (예: 100000 또는 -50000)"}
                        style={{ width: "100%", padding: "10px", fontSize: "16px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setEditUsdBalance("");
                            setEditKrwBalance("");
                          }
                        }}
                      />
                    </label>
                    
                    {fxRate && (
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", padding: "8px", background: "var(--bg)", borderRadius: "4px" }}>
                        FX rate: {formatNumber(fxRate)} KRW/USD
                      </div>
                    )}
                  </>
                ) : adjustingAccount.type === "card" ? null : (
                  <>
                    {/* 부채/잔액 조정 입력 */}
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                        현재 보유금액 조정값
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                        {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)}
                      </div>
                    </div>

                    {/* 부채/잔액 조정 안내 */}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={isSetDirectly}
                        onChange={(e) => setIsSetDirectly(e.target.checked)}
                      />
                      <span style={{ fontSize: 13 }}>
                        직접 목표 잔액 설정 (입력값이 현재 잔액이 됨)
                      </span>
                    </label>
                    <label>
                      <span>
                        {isSetDirectly
                          ? "목표 잔액"
                          : "잔액 증감 (음수 입력 시 차감)"}
                      </span>
                      
                      <input
                        type="text"
                        value={adjustValue}
                        onChange={(e) => {
                          const val = sanitizeSignedNumericInput(e.target.value);
                          setAdjustValue(val);
                        }}
                        placeholder={
                          isSetDirectly
                            ? "금액 (예: 100000)"
                            : "금액 입력 (예: +100000 또는 -50000)"
                        }
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdjustBalance();
                            setAdjustValue("");
                          } else if (e.key === "Escape") {
                            setAdjustingAccount(null);
                            setAdjustValue("");
                          }
                        }}
                      />
                    </label>
                  </>
                )}
                <div className="form-actions" style={{ marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustingAccount(null);
                      setAdjustValue("");
                      setAdjustValueUSD("");
                      setIsAdjustingUSD(false);
                      setEditUsdBalance("");
                      setEditKrwBalance("");
                    }}
                  >
                    취소
                  </button>
                  {adjustingAccount.type !== "card" && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        handleAdjustBalance();
                      }}
                    >
                      {isSetDirectly ? "설정" : "적용"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedAccount && (() => {
        const ledgerRows = ledger
          .filter((l) => l.fromAccountId === selectedAccount.id || l.toAccountId === selectedAccount.id)
          .map((l) => ({
            type: "ledger" as const,
            id: l.id,
            date: l.date,
            kind: l.kind,
            category: [l.category, l.subCategory].filter(Boolean).join(" / ") || "-",
            description: l.description || "-",
            amount: l.fromAccountId === selectedAccount.id ? -l.amount : l.amount,
            isUsd: l.currency === "USD"
          }));
        const tradeRows = trades
          .filter((t) => t.accountId === selectedAccount.id)
          .map((t) => {
            const usdTicker = isUSDStock(t.ticker);
            const useUsdBalanceMode = shouldUseUsdBalanceMode(
              t.accountId,
              selectedAccount.type === "securities" || selectedAccount.type === "crypto",
              usdTicker,
              safeAccounts,
              ledger
            );
            const signedUsdAmount = t.side === "buy" ? -t.totalAmount : t.totalAmount;
            const amount = useUsdBalanceMode
              ? signedUsdAmount
              : (Number(t.cashImpact) || 0);
            const realizedPnl = t.side === "sell" ? (realizedPnlByTradeId.get(t.id) ?? amount) : undefined;
            const sellLabel = realizedPnl != null && realizedPnl >= 0 ? "투자수익" : "투자손실";
            const sellKind = t.side === "sell" ? (realizedPnl != null && realizedPnl >= 0 ? "stock_sell_profit" : "stock_sell_loss") : "stock_buy";
            return {
              type: "trade" as const,
              id: `trade-${t.id}`,
              date: t.date,
              kind: t.side === "buy" ? "stock_buy" : sellKind,
              category: t.ticker ? `${t.ticker}${t.name ? ` - ${t.name}` : ""}` : "-",
              description: t.side === "buy" ? "주식 매수" : sellLabel,
              amount,
              displayAmount: realizedPnl,
              isUsd: useUsdBalanceMode
            };
          });
        type Row = typeof ledgerRows[0] | typeof tradeRows[0];
        const accountTransactions: Row[] = [...ledgerRows, ...tradeRows].sort((a, b) =>
          b.date.localeCompare(a.date) || (a.id < b.id ? 1 : -1)
        );

        const balanceRow = safeBalances.find((b) => b.account.id === selectedAccount.id);
        const krwBalance = balanceRow?.currentBalance ?? 0;
        const usdBalance = (selectedAccount.type === "securities" || selectedAccount.type === "crypto") ? (selectedAccount.usdBalance ?? 0) : 0;
        const isSecuritiesAccount = selectedAccount.type === "securities" || selectedAccount.type === "crypto";
        /**
         * 증권/코인 계좌 거래내역 모달의 "잔액"은 예수금(현금)만 보여준다.
         * - KRW 예수금: balances.currentBalance
         * - USD 잔액(account.usdBalance) 및 주식평가액은 잔액 표시에서 제외
         */
        const currentBalance = krwBalance;

        const amounts: number[] = accountTransactions.map((r) => Number(r.amount) || 0);
        // 현재 잔액에서 역순으로 누적 차감 → 각 거래 "직후" 잔액 계산 (newest-first 순서 기준)
        const runningBalances: number[] = [];
        let acc = currentBalance;
        for (let i = 0; i < amounts.length; i++) {
          runningBalances.push(acc);
          const amt = amounts[i];
          if (accountTransactions[i].isUsd) {
            if (!isSecuritiesAccount && effectiveFxRate != null) {
              acc -= amt * effectiveFxRate;
            }
          } else {
            acc -= amt;
          }
        }
        // 마지막 acc = 모든 거래 적용 전 잔액 = 시작 잔액 (initialBalance + cashAdjustment + savings)
        const startingBalance = acc;

        const kindLabel = (r: Row): string => {
          const amt = Number(r.amount) || 0;
          const dir = amt >= 0 ? "in" : "out";
          if (r.kind === "income") return "수입";
          if (r.kind === "transfer") return dir === "in" ? "이체(입금)" : "이체(출금)";
          if (r.kind === "expense") return dir === "in" ? "지출(환급)" : "지출";
          if (r.kind === "stock_buy") return "주식 매수";
          if (r.kind === "stock_sell_profit") return "투자수익";
          if (r.kind === "stock_sell_loss") return "투자손실";
          if (r.kind === "stock_sell") return "주식 매도";
          return String(r.kind ?? "");
        };
        const realizedPnlByRowId = new Map<string, number>();
        accountTransactions.forEach((r) => {
          if (r.type === "trade" && "displayAmount" in r && r.displayAmount != null) {
            realizedPnlByRowId.set(r.id, Number(r.displayAmount) || 0);
          }
        });

        const formatAmount = (r: Row, val: number) => {
          if (r.isUsd && effectiveFxRate) return formatKRW(Math.round(val * effectiveFxRate));
          if (r.isUsd) return formatUSD(val);
          return formatKRW(Math.round(val));
        };

        // 상단 요약: 입금/출금 건수·금액 (증권계좌 USD 거래는 KRW 예수금 잔액에 영향 안 주므로 제외)
        let inflowCount = 0;
        let outflowCount = 0;
        let inflowTotal = 0;
        let outflowTotal = 0;
        accountTransactions.forEach((r, idx) => {
          if (r.isUsd && isSecuritiesAccount) return;
          const amt = amounts[idx];
          const krw = r.isUsd && effectiveFxRate ? amt * effectiveFxRate : amt;
          if (krw > 0) { inflowCount++; inflowTotal += krw; }
          else if (krw < 0) { outflowCount++; outflowTotal += -krw; }
        });
        const netFlow = inflowTotal - outflowTotal;

        return (
          <div className="modal-backdrop" onClick={() => setSelectedAccount(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "950px", maxHeight: "80vh" }}>
              <div className="modal-header">
                <h3>{selectedAccount.name} ({selectedAccount.id}) - 거래 내역</h3>
                <button
                  type="button"
                  onClick={() => setSelectedAccount(null)}
                  style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
                >
                  ×
                </button>
              </div>
              {accountTransactions.length > 0 && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 8,
                  padding: "12px 20px",
                  background: "var(--bg)",
                  borderBottom: "1px solid var(--border)"
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>시작 잔액</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>{formatKRW(Math.round(startingBalance))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>현재 잔액</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{formatKRW(Math.round(currentBalance))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>총 입금 ({inflowCount}건)</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--chart-income)" }}>+{formatKRW(Math.round(inflowTotal))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>총 출금 ({outflowCount}건)</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--chart-expense)" }}>−{formatKRW(Math.round(outflowTotal))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>순 흐름</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: netFlow >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                      {netFlow >= 0 ? "+" : "−"}{formatKRW(Math.round(Math.abs(netFlow)))}
                    </div>
                  </div>
                </div>
              )}
              <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(80vh - 200px)" }}>
                {accountTransactions.length === 0 ? (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                    이 계좌에 거래 내역이 없습니다.
                  </p>
                ) : (
                  <table className="data-table" style={{ fontSize: "13px" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", width: 90 }}>날짜</th>
                        <th style={{ textAlign: "left" }}>내용</th>
                        <th style={{ textAlign: "right", color: "var(--chart-income)", width: 120 }}>입금</th>
                        <th style={{ textAlign: "right", color: "var(--chart-expense)", width: 120 }}>출금</th>
                        <th style={{ textAlign: "right", width: 110 }}>잔액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 거래 내역 — 최신 → 과거 순 */}
                      {accountTransactions.map((r, idx) => {
                        const cashFlow = amounts[idx];
                        const realizedPnl = realizedPnlByRowId.get(r.id);
                        const balanceAfter = runningBalances[idx];
                        const isInflow = cashFlow > 0;
                        const isOutflow = cashFlow < 0;
                        const kind = kindLabel(r);
                        const cat = r.category && r.category !== kind && !kind.includes(r.category) ? r.category : null;
                        const typeLabel = cat ? `${kind} · ${cat}` : kind;
                        const description = r.description && r.description.trim() !== "" && r.description !== "-" ? r.description : null;

                        return (
                          <tr key={r.id}>
                            <td style={{ whiteSpace: "nowrap" }}>{formatShortDate(r.date)}</td>
                            <td>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{typeLabel}</div>
                              {description && (
                                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{description}</div>
                              )}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--chart-income)", fontWeight: 600 }}>
                              {isInflow ? `+${formatAmount(r, cashFlow)}` : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                              {isSecuritiesAccount && r.isUsd && isInflow && (
                                <div style={{ fontSize: 10, marginTop: 2, color: "var(--text-muted)", fontWeight: 400 }}>
                                  (USD — 예수금 미반영)
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--chart-expense)", fontWeight: 600 }}>
                              {isOutflow ? `−${formatAmount(r, -cashFlow)}` : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                              {isSecuritiesAccount && r.isUsd && isOutflow && (
                                <div style={{ fontSize: 10, marginTop: 2, color: "var(--text-muted)", fontWeight: 400 }}>
                                  (USD — 예수금 미반영)
                                </div>
                              )}
                              {realizedPnl != null && (
                                <div style={{ fontSize: 10, marginTop: 2, fontWeight: 500, color: realizedPnl >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                                  실현 {realizedPnl >= 0 ? "+" : "−"}{formatKRW(Math.round(Math.abs(realizedPnl)))}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                              {formatKRW(Math.round(balanceAfter))}
                            </td>
                          </tr>
                        );
                      })}
                      {/* 시작 잔액 행 (맨 아래 — 모든 거래 적용 전 기준점) */}
                      <tr style={{ background: "var(--bg)", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={4} style={{ color: "var(--text-muted)", padding: "10px 12px", fontStyle: "italic" }}>
                          시작 잔액 (모든 거래 적용 전)
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                          {formatKRW(Math.round(startingBalance))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

interface AccountFormProps {
  onAdd: (account: Account) => void;
  existingIds: string[];
}

const AccountForm: React.FC<AccountFormProps> = ({ onAdd, existingIds }) => {
  const [form, setForm] = useState({
    id: "",
    name: "",
    institution: "",
    type: "checking" as AccountType,
    initialBalance: "",
    debt: "",
    savings: "",
    cashAdjustment: "",
    initialCashBalance: "",
    note: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim()) {
      alert("계좌 ID와 계좌명을 입력해 주세요.");
      return;
    }
    if (existingIds.includes(form.id)) {
      alert("이미 존재하는 계좌 ID입니다.");
      return;
    }
    const amount = parseAmount(form.initialBalance);
    const rawDebt = parseAmount(form.debt);
    const debt = rawDebt;
    const savings = parseAmount(form.savings);
    const cashAdjustment = parseAmount(form.cashAdjustment);
    const initialCashBalance = parseAmount(form.initialCashBalance);
    const account: Account = {
      id: form.id.trim(),
      name: form.name.trim(),
      institution: form.institution.trim() || "",
      type: form.type,
      initialBalance: amount,
      debt,
      savings,
      cashAdjustment: (form.type === "securities" || form.type === "crypto") ? cashAdjustment : undefined,
      initialCashBalance: (form.type === "securities" || form.type === "crypto") && initialCashBalance > 0 ? initialCashBalance : undefined,
      note: form.note.trim() || undefined
    };
    onAdd(account);
    setForm({
      id: "",
      name: "",
      institution: "",
      type: "checking",
      initialBalance: "",
      debt: "",
      savings: "",
      cashAdjustment: "",
      initialCashBalance: "",
      note: ""
    });
  };

  return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h3>계좌 추가</h3>
      <label>
        <span>계좌 ID *</span>
        <input
          type="text"
          required
          placeholder="예: CHK_KB"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase().replace(/\s/g, "_") })}
        />
      </label>
      <label>
        <span>계좌명 *</span>
        <input
          type="text"
          required
          placeholder="예: 월급통장"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span>기관 / 증권사</span>
        <input
          type="text"
          placeholder="예: 농협은행"
          value={form.institution}
          onChange={(e) => setForm({ ...form, institution: e.target.value })}
        />
      </label>
      <label>
        <span>계좌 유형</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
          <option value="checking">입출금</option>
          <option value="savings">저축</option>
          <option value="card">신용카드</option>
          <option value="securities">증권</option>
          <option value="crypto">암호화폐</option>
          <option value="other">기타</option>
        </select>
      </label>
      <label>
        <span>초기 잔액</span>
        <input
          type="number"
          min={0}
          placeholder="0"
          value={form.initialBalance}
          onChange={(e) => setForm({ ...form, initialBalance: e.target.value })}
        />
      </label>
      <label>
        <span>부채</span>
        <input
          type="number"
          placeholder="-100000"
          value={form.debt}
          onChange={(e) => setForm({ ...form, debt: e.target.value })}
        />
      </label>
      <label>
        <span>저축</span>
        <input
          type="number"
          min={0}
          placeholder="0"
          value={form.savings}
          onChange={(e) => setForm({ ...form, savings: e.target.value })}
        />
      </label>
      {(form.type === "securities" || form.type === "crypto") && (
        <>
          <label>
            <span>초기 현금 잔액</span>
            <input
              type="number"
              placeholder="0"
              value={form.initialCashBalance}
              onChange={(e) => setForm({ ...form, initialCashBalance: e.target.value })}
            />
          </label>
          <label>
            <span>현금 조정 (선택)</span>
            <input
              type="number"
              placeholder="0"
              value={form.cashAdjustment}
              onChange={(e) => setForm({ ...form, cashAdjustment: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="wide">
        <span>메모</span>
        <input
          type="text"
          placeholder="메모 입력"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary">
          계좌 추가
        </button>
      </div>
    </form>
  );
};
