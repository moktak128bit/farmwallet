/**
 * 계좌 초기 금액 역산 패널 — 실제 잔액 입력 → 초기잔액 역산 적용, 시작금액 정리(보정금액 병합),
 * 시작금액 → 이체 기록 변환, 2025-06-01 이력 통합.
 * AccountsPage에서 분리 — 역산 입력·시드 변환 상태를 이 컴포넌트가 소유해
 * 입력 타이핑이 부모(AccountsPage)를 재렌더하지 않는다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(부모 useMemo/setState/useCallback)이어야 한다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, AccountBalanceRow, LedgerEntry } from "../../../types";

interface Props {
  /** 카드 제외 잔액 행 (부모 memo — "계좌별 잔액 구성" 표와 순서 공유) */
  orderedRowsForInitialReverse: AccountBalanceRow[];
  safeAccounts: Account[];
  safeBalances: AccountBalanceRow[];
  ledger: LedgerEntry[];
  onChangeAccounts: (next: Account[]) => void;
  onChangeLedger?: (next: LedgerEntry[]) => void;
  formatKRW: (n: number) => string;
}

export const InitialReversePanel: React.FC<Props> = React.memo(function InitialReversePanel({
  orderedRowsForInitialReverse,
  safeAccounts,
  safeBalances,
  ledger,
  onChangeAccounts,
  onChangeLedger,
  formatKRW,
}) {
  /** Opening-balance reverse calc: user-entered actual current balances by account */
  const [actualCurrentInput, setActualCurrentInput] = useState<Record<string, string>>({});
  /** 사용자가 직접 편집한 계좌 id 집합 — 자동 동기화에서 제외 */
  const [actualCurrentEdited, setActualCurrentEdited] = useState<Set<string>>(() => new Set());
  // 시작금액 → 이체 기록 변환 패널
  const [showSeedPanel, setShowSeedPanel] = useState(false);
  const [seedSourceId, setSeedSourceId] = useState<string>("");
  const [seedDate, setSeedDate] = useState("2025-06-01");

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

  const fillActualCurrentFromComputed = () => {
    const next: Record<string, string> = {};
    orderedRowsForInitialReverse.forEach((row) => {
      next[row.account.id] = String(Math.round(row.currentBalance ?? 0));
    });
    setActualCurrentInput(next);
    // 수동 편집 표식 초기화 → 이후 currentBalance 변경 시 자동 동기화 재개
    setActualCurrentEdited(new Set());
  };

  if (orderedRowsForInitialReverse.length === 0) return null;

  return (
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
        {onChangeLedger && (
          <button
            type="button"
            className="secondary"
            onClick={consolidate20250601Transfers}
            title="백업 복구 + 2026-06-01 자동생성 이동 + 계좌쌍별 net 합산 → 2025-06-01 이체 기록을 깔끔하게 통합 (현재 잔액 보존)"
            style={{ fontSize: 12, padding: "6px 12px", borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 }}
          >
            🔗 2025-06-01 이력 통합
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
                      const value = e.target.value;
                      setActualCurrentInput((prev) => ({
                        ...prev,
                        [row.account.id]: value
                      }));
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
  );
});
