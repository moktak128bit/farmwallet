/**
 * 계좌 잔액 조정 모달 — 일반 계좌 증감/직접설정, 증권·암호화폐 USD/KRW 설정, 카드 결제 관리.
 * AccountsPage에서 분리 — 조정 입력 상태(adjustValue 등)를 이 컴포넌트가 소유해
 * 입력 타이핑이 부모(AccountsPage)를 재렌더하지 않는다. 모달은 열릴 때마다 새로 마운트되므로
 * 입력 상태는 항상 빈 값으로 시작한다 (기존 열기 시 초기화 동작과 동일).
 * React.memo로 감싸므로 부모가 넘기는 콜백(onClose)은 안정적(useCallback)이어야 한다.
 */
import React, { useEffect, useState } from "react";
import type { Account, AccountType, LedgerEntry, AccountBalanceRow } from "../../../types";
import { formatNumber, formatKRW, formatUSD } from "../../../utils/formatter";
import { ACCOUNT_TYPE_LABEL, parseSignedAmount, sanitizeSignedNumericInput } from "../accountsShared";
import { CardPaymentSection } from "./CardPaymentSection";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../../utils/modalStack";
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
  // 연금 분류 — 즉시 저장하지 않고 '적용/설정' 버튼에서 함께 커밋 (취소 시 폐기)
  const [pendingPension, setPendingPension] = useState(
    () => !!safeAccounts.find((a) => a.id === adjustingAccount.id)?.isPension
  );

  // 접근성: 포커스 트랩 + window 레벨 ESC (입력 포커스 여부와 무관하게 닫힘)
  // 모달 중첩 시 최상위 모달만 ESC로 닫히도록 모달 스택을 사용한다.
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, isTopModal]);

  const handleAdjustBalance = () => {
    if (!onChangeAccounts) return;

    if (adjustingAccount.type === "securities" || adjustingAccount.type === "crypto") {
      const balanceRow = safeBalances.find((b) => b.account.id === adjustingAccount.id);
      const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
      if (!account || !balanceRow) return;

      const inputUsd = Number(editUsdBalance.replace(/[^\d.-]/g, "")) || 0;
      const inputKrw = Number(editKrwBalance.replace(/[^\d.-]/g, "")) || 0;

      // 연금 분류 변경분 (securities 전용 — crypto는 연금 옵션 없음)
      const isSecurities = adjustingAccount.type === "securities";
      const pensionTarget = pendingPension ? true : undefined;
      const pensionChanged = isSecurities && pendingPension !== !!account.isPension;
      const hasAmountChange = isSetDirectly || inputUsd !== 0 || inputKrw !== 0;

      // 금액 변경 없이 연금 분류만 저장 — 금액 입력 강제하지 않음
      if (!hasAmountChange) {
        if (pensionChanged) {
          onChangeAccounts(
            safeAccounts.map((a) => (a.id === adjustingAccount.id ? { ...a, isPension: pensionTarget } : a))
          );
          toast.success(pendingPension ? "연금 계좌로 분류했습니다." : "연금 분류를 해제했습니다.");
          onClose();
          return;
        }
        alert(isSecurities ? "변경할 금액을 입력하거나 연금 분류를 바꿔주세요." : "USD 또는 KRW 중 하나 이상 0이 아닌 값을 입력해주세요.");
        return;
      }

      const dispUsd = (account.usdBalance ?? 0) + (balanceRow.usdTransferNet ?? 0);
      const currentKrw = balanceRow.currentBalance ?? 0;
      const targetUsd = isSetDirectly ? inputUsd : dispUsd + inputUsd;
      const targetKrw = isSetDirectly ? inputKrw : currentKrw + inputKrw;

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
            cashAdjustment: 0,
            // securities면 연금 분류도 함께 반영 (금액+분류 동시 변경 지원)
            ...(isSecurities ? { isPension: pensionTarget } : {})
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
    // 증권/암호화폐 분기와 동일하게 — 적용 후 성공 안내와 함께 모달을 닫는다
    toast.success(isSetDirectly ? "계좌 잔액을 설정했습니다." : "계좌 잔액을 조정했습니다.");
    setAdjustValue("");
    setIsSetDirectly(false);
    onClose();
  };

  const account = safeAccounts.find((a) => a.id === adjustingAccount.id);
  if (!account) return null;

  const currentAdjustment =
    adjustingAccount.type === "card"
      ? (cardDebtMap.get(account.id)?.total ?? 0)
      : (account.initialBalance ?? 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjustment-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "500px" }}
      >
        <div className="modal-header">
          <h3 id="adjustment-modal-title">
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
            aria-label="닫기"
            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0", width: "24px", height: "24px" }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {adjustingAccount.type === "card" && onChangeLedger && (
            <CardPaymentSection
              account={account}
              checkingAccounts={safeAccounts.filter((a) => (a.type === "checking" || a.type === "savings") && !a.archived)}
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
                            // 부호 보존 파서 — parseAmount는 "-"를 제거해 음수 목표(선납 상태)가 양수 부채로 반전되는 버그가 있었다.
                            // parseSignedAmount는 형식 오류 시 null을 반환하므로 가드가 실제로 동작한다.
                            const parsed = parseSignedAmount(raw);
                            if (parsed == null) {
                              toast.error("숫자를 입력하세요");
                              return;
                            }
                            const target = Math.round(parsed);
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
              {adjustingAccount.type === "securities" && onChangeAccounts && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 10px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <input
                    type="checkbox"
                    checked={pendingPension}
                    onChange={(e) => setPendingPension(e.target.checked)}
                  />
                  <span style={{ fontSize: 13 }}>
                    연금 계좌로 분류 (퇴직연금·연금저축 — 자산 추이에서 '연금'으로 구분)
                    <span style={{ color: "var(--text-muted)" }}> · 금액 입력 없이 아래 버튼만 눌러도 저장됩니다</span>
                  </span>
                </label>
              )}
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
                    // ESC 닫기는 window 레벨 핸들러가 담당 (중복 제거)
                    if (e.key === "Enter") handleAdjustBalance();
                  }}
                />
                {editUsdBalance && fxRate && (() => {
                  // 부호 보존 파서 — 음수 증감 입력 시 환산 힌트도 음수로 정확히 표시
                  const usdParsed = parseSignedAmount(editUsdBalance);
                  if (usdParsed == null) return null;
                  return (
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                      원화 환산 약 {formatNumber(usdParsed * fxRate)}원
                    </div>
                  );
                })()}
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
                    // ESC 닫기는 window 레벨 핸들러가 담당 (중복 제거)
                    if (e.key === "Enter") handleAdjustBalance();
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
                    // ESC 닫기는 window 레벨 핸들러가 담당 (중복 제거)
                    if (e.key === "Enter") {
                      handleAdjustBalance();
                      setAdjustValue("");
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
