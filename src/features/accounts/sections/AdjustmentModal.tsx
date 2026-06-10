/**
 * 계좌 잔액 조정 모달 — 일반 계좌 증감/직접설정, 증권·암호화폐 USD/KRW 설정, 카드 결제 관리.
 * AccountsPage에서 분리 — 조정 입력 상태(adjustValue 등)를 이 컴포넌트가 소유해
 * 입력 타이핑이 부모(AccountsPage)를 재렌더하지 않는다. 모달은 열릴 때마다 새로 마운트되므로
 * 입력 상태는 항상 빈 값으로 시작한다 (기존 열기 시 초기화 동작과 동일).
 * React.memo로 감싸므로 부모가 넘기는 콜백(onClose)은 안정적(useCallback)이어야 한다.
 */
import React, { useState } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow } from "../../../types";
import { formatNumber, formatKRW, formatUSD } from "../../../utils/formatter";
import { parseAmount } from "../../../utils/parseAmount";
import { ACCOUNT_TYPE_LABEL, parseSignedAmount, sanitizeSignedNumericInput } from "../accountsShared";
import { CardPaymentSection } from "./CardPaymentSection";
import { toast } from "react-hot-toast";

interface Props {
  adjustingAccount: { id: string; type: AccountType };
  safeAccounts: Account[];
  safeBalances: AccountBalanceRow[];
  cardDebtMap: Map<string, { total: number }>;
  ledger: LedgerEntry[];
  onChangeLedger?: (next: LedgerEntry[]) => void;
  onChangeAccounts?: (next: Account[]) => void;
  fxRate: number | null;
  onClose: () => void;
}

export const AdjustmentModal = React.memo(function AdjustmentModal({
  adjustingAccount,
  safeAccounts,
  safeBalances,
  cardDebtMap,
  ledger,
  onChangeLedger,
  onChangeAccounts,
  fxRate,
  onClose,
}: Props) {
  const [targetDebtInput, setTargetDebtInput] = useState("");
  // 조정 입력 상태 — 모달 마운트 시 항상 빈 값 (이전엔 부모가 열 때마다 초기화하던 동작과 동일)
  const [adjustValue, setAdjustValue] = useState("");
  const [isSetDirectly, setIsSetDirectly] = useState(false);
  const [editUsdBalance, setEditUsdBalance] = useState("");
  const [editKrwBalance, setEditKrwBalance] = useState("");

  const handleAdjustBalance = () => {
    if (!onChangeAccounts) return;

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
      setEditUsdBalance("");
      setEditKrwBalance("");
      setIsSetDirectly(false);
      onClose();
      return;
    }

    const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
    const currentBalance = balanceRow?.currentBalance ?? 0;

    let value = 0;
    if (adjustValue.trim() !== "") {
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
    setIsSetDirectly(false);
  };

  const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
  if (!account) return null;

  const currentAdjustment =
    adjustingAccount.type === "card"
      ? (cardDebtMap.get(account.id)?.total ?? 0)
      : (account.initialBalance ?? 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
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
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {adjustingAccount.type === "card" && onChangeLedger && (
            <CardPaymentSection
              account={account}
              checkingAccounts={safeAccounts.filter((a) => a.type === "checking" || a.type === "savings")}
              currentDebt={cardDebtMap.get(account.id)?.total ?? 0}
              onAddPayment={(entry) => {
                onChangeLedger([...ledger, entry]);
                onClose();
              }}
              formatKRW={formatKRW}
            />
          )}

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
              // cardDebtMap.total: 양수=부채 (account.debt 포함), 음수=선납
              const debtDisplay = currentDebt > 0 ? currentDebt : 0;
              return (
                <>
                  <div style={{ marginBottom: "12px", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>현재 카드 부채</div>
                    <div style={{ fontSize: "24px", fontWeight: "700", color: debtDisplay > 0 ? "var(--danger)" : "var(--primary)" }}>
                      {formatAmount(debtDisplay)}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px" }}>
                      카드 사용/결제 내역이 자동 반영됩니다. 결제하면 부채가 탕감됩니다.
                    </div>
                  </div>
                  {onChangeAccounts && (
                    <div style={{ marginBottom: "20px", padding: "12px", background: "var(--surface)", borderRadius: "8px", border: "1px dashed var(--border)" }}>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                        현재 부채 직접 설정 — 입력값에 맞추기 위해 초기 부채(account.debt)가 자동 재계산됩니다.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="text"
                          value={targetDebtInput}
                          onChange={(e) => setTargetDebtInput(sanitizeSignedNumericInput(e.target.value))}
                          placeholder={`현재: ${formatAmount(debtDisplay)}`}
                          style={{ flex: 1, padding: "8px 12px", fontSize: 14 }}
                        />
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            const raw = targetDebtInput.trim();
                            if (!raw) return;
                            const target = Math.round(parseAmount(raw));
                            if (!Number.isFinite(target)) {
                              toast.error("숫자를 입력하세요");
                              return;
                            }
                            const oldAccountDebt = account.debt ?? 0;
                            // currentDebt = oldAccountDebt + (ledger usage - payment) → ledgerDelta = currentDebt - oldAccountDebt
                            // 목표 부채로 맞추려면: newAccountDebt = target - ledgerDelta = target - currentDebt + oldAccountDebt
                            const newAccountDebt = target - currentDebt + oldAccountDebt;
                            const updated = safeAccounts.map((a) =>
                              a.id === account.id ? { ...a, debt: newAccountDebt } : a
                            );
                            onChangeAccounts(updated);
                            toast.success(`현재 부채 ${formatAmount(target)} 설정 — 초기 부채: ${formatAmount(oldAccountDebt)} → ${formatAmount(newAccountDebt)}`);
                            setTargetDebtInput("");
                          }}
                          style={{ padding: "8px 16px", fontSize: 14 }}
                        >
                          적용
                        </button>
                      </div>
                    </div>
                  )}
                </>
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
                      onClose();
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
                      onClose();
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
              <div style={{ marginBottom: "20px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
                  현재 보유금액 조정값
                </div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: currentAdjustment >= 0 ? "var(--primary)" : "var(--danger)" }}>
                  {currentAdjustment >= 0 ? "+" : ""}{formatNumber(currentAdjustment)}
                </div>
              </div>

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
                      onClose();
                    }
                  }}
                />
              </label>
            </>
          )}
          <div className="form-actions" style={{ marginTop: "16px" }}>
            <button type="button" onClick={onClose}>
              취소
            </button>
            {adjustingAccount.type !== "card" && (
              <button
                type="button"
                className="primary"
                onClick={handleAdjustBalance}
              >
                {isSetDirectly ? "설정" : "적용"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
