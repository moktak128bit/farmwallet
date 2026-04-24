import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow, PositionRow, StockTrade } from "../types";
import { formatKRW, formatUSD } from "../utils/formatter";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { EmptyState } from "../components/ui/EmptyState";
import { Wallet, Download } from "lucide-react";
import { toast } from "react-hot-toast";
import { computeRealizedPnlByTradeId, positionMarketValueKRW } from "../calculations";
import { parseAmount } from "../utils/parseAmount";
import { useAppStore } from "../store/appStore";
import { buildUnifiedCsv } from "../utils/unifiedCsvExport";
import { ACCOUNT_TYPE_LABEL, parseSignedAmount } from "../features/accounts/accountsShared";
import { AccountForm } from "../features/accounts/sections/AccountForm";
import { TypeSummarySection } from "../features/accounts/sections/TypeSummarySection";
import { TransactionHistoryModal } from "../features/accounts/sections/TransactionHistoryModal";
import { AdjustmentModal } from "../features/accounts/sections/AdjustmentModal";
import { BalanceBreakdownSection } from "../features/accounts/sections/BalanceBreakdownSection";
import { InitialReversePanel } from "../features/accounts/sections/InitialReversePanel";

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
  const safeAccounts = useMemo(() => accounts ?? [], [accounts]);
  const safeBalances = useMemo(() => balances ?? [], [balances]);
  const safePositions = useMemo(() => positions ?? [], [positions]);

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
  const [seedDate, setSeedDate] = useState("2025-06-01");
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
    // 삭제 전 해당 계좌를 참조하는 ledger·trade 개수 확인.
    // 0개면 그대로 삭제, 그 이상이면 사용자에게 명시적 확인 받음
    // (참조 레코드는 그대로 유지 — 과거 거래 기록을 자동 삭제하지 않는 게 안전).
    const ledgerRefs = ledger.filter((l) => l.fromAccountId === id || l.toAccountId === id).length;
    const tradeRefs = trades.filter((t) => t.accountId === id).length;
    if (ledgerRefs > 0 || tradeRefs > 0) {
      const parts: string[] = [];
      if (ledgerRefs > 0) parts.push(`가계부 ${ledgerRefs}건`);
      if (tradeRefs > 0) parts.push(`주식거래 ${tradeRefs}건`);
      const refs = parts.join(", ");
      const ok = window.confirm(
        `이 계좌를 참조하는 ${refs}이(가) 있습니다.\n` +
        `계좌만 삭제하면 해당 거래 기록은 "삭제된 계좌"로 남습니다.\n계속하시겠습니까?`
      );
      if (!ok) return;
    }
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
      // 옵션 B: initialCashBalance 만 조정, cashAdjustment 는 0 으로 평탄화
      // newInitial = currentInitial + currentCashAdj + (targetKrw - currentKrw)
      //   = currentBalance 공식 `base + activity + cashAdj = current` 에서
      //     activity 보존, cashAdj 0 흡수, target 달성
      const currentInitialCash = account.initialCashBalance ?? account.initialBalance ?? 0;
      const currentCashAdj = account.cashAdjustment ?? 0;
      // 부동소수점 오차 방지 — KRW 시작금액은 정수 유지
      const newInitialCashBalance = Math.round(currentInitialCash + currentCashAdj + (targetKrw - currentKrw));

      onChangeAccounts(
        safeAccounts.map((a) => {
          if (a.id !== adjustingAccount.id) return a;
          return {
            ...a,
            usdBalance: newUsdBalance,
            initialCashBalance: newInitialCashBalance,
            cashAdjustment: 0
          };
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
        // 옵션 B: initialBalance 만 사용. 남아있을 수 있는 cashAdjustment 는 함께 병합
        const pendingAdj = a.cashAdjustment ?? 0;
        const baseShift = isSetDirectly ? (value - currentBalance) : value;
        // 부동소수점 오차 방지 — KRW 시작금액은 정수 유지
        return {
          ...a,
          initialBalance: Math.round((a.initialBalance ?? 0) + pendingAdj + baseShift),
          cashAdjustment: 0
        };
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
    // 소수점 쓰레기(부동소수점 오차) 가 있으면 정수로 반올림해 편집 입력에 넣는다.
    // (parseAmount 기본값이 정수만 허용하므로, "123.45" 가 들어가면 소수점이 지워지며 12345로 저장되는 버그 방지)
    const safe = Number.isFinite(currentValue) ? Math.round(currentValue) : 0;
    setEditValue(String(safe));
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
          initialCashBalance: Math.round((a.initialCashBalance ?? a.initialBalance ?? 0) + adj),
          cashAdjustment: 0
        };
      }
      return { ...a, initialBalance: Math.round((a.initialBalance ?? 0) + adj), cashAdjustment: 0 };
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

  /** 2025-06-01 이력 통합:
   *  1) 최신 백업에서 2025-06-01 누락 기록 복구 (이전 cleanup 으로 삭제된 11건 원복)
   *  2) 2026-06-01 자동생성 기록을 2025-06-01 로 이동
   *  3) 2025-06-01 모든 transfer를 (from,to) 쌍별로 net 합산 → 한 건으로 집약
   *  4) 잔액 보존 (총량 불변)
   */
  const consolidate20250601Transfers = async () => {
    if (!onChangeLedger) {
      toast.error("가계부 기록 수정 권한이 없습니다.");
      return;
    }
    const TARGET_DATE = "2025-06-01";
    const OLD_AUTO_DATE = "2026-06-01";
    const AUTO_DESC = "시작금액 이체 (자동 생성)";

    // 1) 백업에서 2025-06-01 누락 기록 확인
    let backupEntries: LedgerEntry[] = [];
    try {
      const res = await fetch("/api/restore-latest-backup");
      if (res.ok) {
        const backup = (await res.json()) as { ledger?: LedgerEntry[] } | null;
        if (backup && Array.isArray(backup.ledger)) {
          backupEntries = backup.ledger.filter((l) => l.date === TARGET_DATE);
        }
      }
    } catch {
      // 백업 없어도 계속 진행 (1단계 스킵)
    }

    // 복구할 항목: 백업엔 있는데 현재엔 없는 id
    const existingIds = new Set(ledger.map((l) => l.id));
    const restoreEntries = backupEntries.filter((l) => !existingIds.has(l.id));

    // 2) 2026-06-01 자동생성 기록을 2025-06-01 로 이동
    const oldAutoCount = ledger.filter(
      (l) => l.date === OLD_AUTO_DATE && l.description === AUTO_DESC
    ).length;

    // 복구 + 날짜 이동 적용한 가상 ledger
    const workingLedger = [
      ...ledger.map((l) =>
        l.date === OLD_AUTO_DATE && l.description === AUTO_DESC
          ? { ...l, date: TARGET_DATE }
          : l
      ),
      ...restoreEntries
    ];

    // 3) 2025-06-01 transfer 만 추출해 (from, to) 쌍별 net 합산
    const targetDateEntries = workingLedger.filter(
      (l) => l.date === TARGET_DATE && l.kind === "transfer"
    );
    if (targetDateEntries.length === 0) {
      toast(`${TARGET_DATE} 통합할 transfer 가 없습니다.`, { icon: "ℹ️" });
      return;
    }

    // (from, to) → net 금액
    const pairNet = new Map<string, number>();
    for (const e of targetDateEntries) {
      const from = e.fromAccountId ?? "";
      const to = e.toAccountId ?? "";
      if (!from || !to || from === to) continue;
      const key = `${from}|${to}`;
      pairNet.set(key, (pairNet.get(key) ?? 0) + (Number(e.amount) || 0));
    }

    // 양방향 존재 시 net out (두 쌍 중 하나만 남김)
    const consolidated: LedgerEntry[] = [];
    const processed = new Set<string>();
    for (const [key, amt] of pairNet.entries()) {
      if (processed.has(key)) continue;
      const [from, to] = key.split("|");
      const reverseKey = `${to}|${from}`;
      const reverseAmt = pairNet.get(reverseKey) ?? 0;
      processed.add(key);
      processed.add(reverseKey);
      const net = amt - reverseAmt;
      if (Math.round(net) === 0) continue;
      const [fromId, toId, amount] = net > 0 ? [from, to, net] : [to, from, -net];
      consolidated.push({
        id: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        date: TARGET_DATE,
        kind: "transfer",
        category: "이체",
        subCategory: "계좌이체",
        description: "시작금액 통합",
        fromAccountId: fromId,
        toAccountId: toId,
        amount: Math.round(amount),
        currency: "KRW"
      });
    }

    // 건수 및 총 이체량 (미리보기용)
    const beforeCount = workingLedger.filter(
      (l) => l.date === TARGET_DATE && l.kind === "transfer"
    ).length;

    const ok = window.confirm(
      `2025-06-01 이력 통합:\n\n` +
        `· 백업에서 복구: ${restoreEntries.length}건\n` +
        `· 2026-06-01 → 2025-06-01 이동: ${oldAutoCount}건\n` +
        `· 기존 ${beforeCount}건 transfer 를 (계좌쌍 net 합산) 통합 → ${consolidated.length}건\n` +
        `· 현재 잔액 변동 없음 (총 이체량 보존)\n\n` +
        `계속하시겠습니까?`
    );
    if (!ok) return;

    // 4) 최종 ledger: 2025-06-01 모든 transfer 제거 + 집약된 consolidated 추가
    // 2026-06-01 자동생성 제거 + 복구 항목 합침은 workingLedger에서 이미 수행
    const nextLedger = [
      ...workingLedger.filter(
        (l) => !(l.date === TARGET_DATE && l.kind === "transfer")
      ),
      ...consolidated
    ];

    onChangeLedger(nextLedger);
    toast.success(
      `통합 완료 — 2025-06-01: ${beforeCount}건 → ${consolidated.length}건`
    );
  };

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
        const sourceNewBase = Math.round(effectiveStart(a) + totalNonSourceBase);
        if (a.type === "securities" || a.type === "crypto") {
          return { ...a, initialCashBalance: sourceNewBase, cashAdjustment: 0 };
        }
        return { ...a, initialBalance: sourceNewBase, cashAdjustment: 0 };
      }
      const isTarget = targets.some((t) => t.account.id === a.id);
      if (!isTarget) {
        // 비-target 이지만 cashAdjustment 잔여값은 정리해 병합
        if ((a.cashAdjustment ?? 0) === 0) return a;
        const merged = Math.round(effectiveStart(a));
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

      {safeBalances.length > 0 && <TypeSummarySection summary={typeSummary} formatKRW={formatKRW} />}

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

      <BalanceBreakdownSection
        safeBalances={safeBalances}
        orderedRowsForInitialReverse={orderedRowsForInitialReverse}
        showBalanceBreakdown={showBalanceBreakdown}
        setShowBalanceBreakdown={setShowBalanceBreakdown}
        editingNumber={editingNumber}
        editValue={editValue}
        setEditValue={setEditValue}
        startEditNumber={startEditNumber}
        saveNumber={saveNumber}
        cancelEditNumber={cancelEditNumber}
        formatKRW={formatKRW}
      />

      <InitialReversePanel
        orderedRowsForInitialReverse={orderedRowsForInitialReverse}
        safeAccounts={safeAccounts}
        onChangeLedger={onChangeLedger}
        showSeedPanel={showSeedPanel}
        setShowSeedPanel={setShowSeedPanel}
        seedSourceId={seedSourceId}
        setSeedSourceId={setSeedSourceId}
        seedDate={seedDate}
        setSeedDate={setSeedDate}
        actualCurrentInput={actualCurrentInput}
        setActualCurrentInput={setActualCurrentInput}
        setActualCurrentEdited={setActualCurrentEdited}
        flattenAllCashAdjustments={flattenAllCashAdjustments}
        consolidate20250601Transfers={consolidate20250601Transfers}
        applySeedTransferConversion={applySeedTransferConversion}
        fillActualCurrentFromComputed={fillActualCurrentFromComputed}
        applyReversedInitial={applyReversedInitial}
        reversedInitialBalance={reversedInitialBalance}
        getBaseBalance={getBaseBalance}
        formatKRW={formatKRW}
      />

      {accounts.length === 0 && (
        <EmptyState
          icon={<Wallet size={48} />}
          title="아직 계좌가 없습니다"
          message="첫 계좌를 추가해 보세요."
          action={{ label: "계좌 추가", onClick: () => setShowForm(true) }}
        />
      )}

      {adjustingAccount && (
        <AdjustmentModal
          adjustingAccount={adjustingAccount}
          safeAccounts={safeAccounts}
          safeBalances={safeBalances}
          cardDebtMap={cardDebtMap}
          ledger={ledger}
          onChangeLedger={onChangeLedger}
          fxRate={fxRate}
          adjustValue={adjustValue}
          setAdjustValue={setAdjustValue}
          isSetDirectly={isSetDirectly}
          setIsSetDirectly={setIsSetDirectly}
          editUsdBalance={editUsdBalance}
          setEditUsdBalance={setEditUsdBalance}
          editKrwBalance={editKrwBalance}
          setEditKrwBalance={setEditKrwBalance}
          onAdjustBalance={handleAdjustBalance}
          onClose={() => {
            setAdjustingAccount(null);
            setAdjustValue("");
            setAdjustValueUSD("");
            setIsAdjustingUSD(false);
            setIsSetDirectly(false);
            setEditUsdBalance("");
            setEditKrwBalance("");
          }}
        />
      )}

      {selectedAccount && (
        <TransactionHistoryModal
          account={selectedAccount}
          ledger={ledger}
          trades={trades}
          safeAccounts={safeAccounts}
          safeBalances={safeBalances}
          realizedPnlByTradeId={realizedPnlByTradeId}
          effectiveFxRate={effectiveFxRate}
          onClose={() => setSelectedAccount(null)}
        />
      )}
    </div>
  );
};

