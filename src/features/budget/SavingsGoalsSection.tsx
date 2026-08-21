/**
 * 🎯 저축 목표(3-7) — 예산 탭 카드. 이름 있는 목표를 여러 개 만들고,
 * 연결 계좌 잔액 합 또는 재테크(저축/투자) 이체 누적으로 진행률·ETA(utils/goalProjection)를 보여준다.
 *
 * App.tsx props 시그니처를 늘리지 않는다 — 데이터는 useAppStore 셀렉터로 직접 구독,
 * 저장은 useAppStore.setData 직접 호출(대시보드 InvestmentSummaryCard·investmentGoals와 동일 선례:
 * 이 설정은 App의 setDataWithHistory 콜백 체인에 얹혀 있지 않아 undo/redo 스택에는 들어가지 않는다).
 * 삭제는 confirm + showDeleteUndoToast(restore-by-id) 패턴을 따른다.
 */
import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, SavingsGoal } from "../../types";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { computeAccountBalances } from "../../calculations";
import { computeSavingsGoalProgress } from "../../utils/savingsGoalProgress";
import { formatGoalProjectionLine } from "../../utils/goalProjection";
import { formatKRW } from "../../utils/formatter";
import { newIdWithPrefix } from "../../utils/id";
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";

type LinkMode = "accounts" | "category";

interface DraftState {
  id: string | null; // null = 신규 추가
  name: string;
  targetAmount: string;
  targetDate: string;
  linkMode: LinkMode;
  linkedAccountIds: string[];
  linkedCategory: string;
}

const emptyDraft = (): DraftState => ({
  id: null,
  name: "",
  targetAmount: "",
  targetDate: "",
  linkMode: "accounts",
  linkedAccountIds: [],
  linkedCategory: "",
});

function accountChipLabel(account: Account): string {
  return account.name || account.id;
}

export const SavingsGoalsSection: React.FC = React.memo(function SavingsGoalsSection() {
  const savingsGoals = useAppStore((s) => s.data.savingsGoals ?? []);
  const accounts = useAppStore((s) => s.data.accounts);
  const ledger = useAppStore((s) => s.data.ledger);
  const trades = useAppStore((s) => s.data.trades);
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const setData = useAppStore((s) => s.setData);
  const fxRate = useFxRateValue();

  const onChangeGoals = (next: SavingsGoal[]) => setData((prev) => ({ ...prev, savingsGoals: next }));

  // 계좌 잔액은 여기서 1회 계산 — 목표가 여러 개여도 재계산하지 않고 진행률 계산에 공유한다.
  const balances = useMemo(() => computeAccountBalances(accounts, ledger, trades), [accounts, ledger, trades]);

  // 증권/암호화폐 계좌는 평가액 미포함 착시 방지를 위해 연결 대상에서 제외(savingsGoalProgress와 동일 규칙).
  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => a.type !== "securities" && a.type !== "crypto" && !a.archived),
    [accounts]
  );

  const linkCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    (categoryPresets.transfer ?? []).forEach((c) => set.add(c));
    (categoryPresets.categoryTypes?.savings ?? []).forEach((c) => set.add(c));
    return Array.from(set);
  }, [categoryPresets]);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const isEditing = draft.id !== null;
  const isDirty = draft.name !== "" || draft.targetAmount !== "";

  const startEdit = (goal: SavingsGoal) => {
    setDraft({
      id: goal.id,
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      targetDate: goal.targetDate ?? "",
      linkMode: goal.linkedCategory ? "category" : "accounts",
      linkedAccountIds: goal.linkedAccountIds ?? [],
      linkedCategory: goal.linkedCategory ?? "",
    });
  };

  const cancelEdit = () => setDraft(emptyDraft());

  const saveDraft = () => {
    const name = draft.name.trim();
    const targetAmount = Number(draft.targetAmount);
    if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0) {
      toast.error("이름과 목표 금액(0보다 큰 값)을 입력하세요.");
      return;
    }
    const existing = draft.id ? savingsGoals.find((g) => g.id === draft.id) : undefined;
    const goal: SavingsGoal = {
      id: draft.id ?? newIdWithPrefix("SG"),
      name,
      targetAmount,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (draft.targetDate) goal.targetDate = draft.targetDate;
    if (draft.linkMode === "accounts" && draft.linkedAccountIds.length > 0) {
      goal.linkedAccountIds = draft.linkedAccountIds;
    } else if (draft.linkMode === "category" && draft.linkedCategory) {
      goal.linkedCategory = draft.linkedCategory;
    }
    if (draft.id) {
      onChangeGoals(savingsGoals.map((g) => (g.id === draft.id ? goal : g)));
      toast.success(`"${name}" 저축 목표를 수정했습니다.`);
    } else {
      onChangeGoals([...savingsGoals, goal]);
      toast.success(`"${name}" 저축 목표를 추가했습니다.`);
    }
    setDraft(emptyDraft());
  };

  const deleteGoal = (goal: SavingsGoal) => {
    if (!window.confirm(`"${goal.name}" 저축 목표를 삭제하시겠습니까?`)) return;
    const index = savingsGoals.findIndex((g) => g.id === goal.id);
    onChangeGoals(savingsGoals.filter((g) => g.id !== goal.id));
    if (draft.id === goal.id) setDraft(emptyDraft());
    showDeleteUndoToast(
      `"${goal.name}" 저축 목표가 삭제되었습니다.`,
      buildRestoreById(() => useAppStore.getState().data.savingsGoals, onChangeGoals, goal, index)
    );
  };

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>🎯 저축 목표</div>
      <p className="hint" style={{ marginBottom: 12 }}>
        이름 있는 목표를 만들어 연결 계좌 잔액 합 또는 재테크(저축·투자) 이체 누적으로 진행률과 ETA를 추적합니다.
      </p>

      {savingsGoals.length === 0 && (
        <p className="hint" style={{ marginBottom: 12 }}>등록된 저축 목표가 없습니다.</p>
      )}

      {savingsGoals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
          {savingsGoals.map((goal) => {
            const progress = computeSavingsGoalProgress(goal, {
              ledger,
              accounts,
              balances,
              fxRate,
              categoryPresets,
            });
            const pctClamped = Math.min(100, Math.max(0, progress.pct));
            const projLine = formatGoalProjectionLine(progress.projection, formatKRW);
            const linkHint =
              goal.linkedAccountIds && goal.linkedAccountIds.length > 0
                ? `연결 계좌 ${goal.linkedAccountIds.length}개`
                : goal.linkedCategory
                  ? `"${goal.linkedCategory}" 이체 누적`
                  : "연결 없음 — 수정에서 계좌/분류를 연결하세요";
            return (
              <div key={goal.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{goal.name}</span>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => startEdit(goal)}
                      style={{ fontSize: 12, background: "transparent", border: "none", color: "var(--primary)", cursor: "pointer" }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteGoal(goal)}
                      style={{ fontSize: 12, background: "transparent", border: "none", color: "var(--danger)", cursor: "pointer" }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0" }}>
                  {formatKRW(progress.currentKRW)} / {formatKRW(goal.targetAmount)} ({pctClamped.toFixed(1)}%) · {linkHint}
                </div>
                <div style={{ width: "100%", height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pctClamped}%`,
                      height: "100%",
                      background: "var(--chart-primary)",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{projLine}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="form-grid" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <h4 style={{ margin: "0 0 4px", gridColumn: "1 / -1" }}>{isEditing ? "저축 목표 수정" : "저축 목표 추가"}</h4>
        <label>
          <span>이름</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="비상금 1000만" />
        </label>
        <label>
          <span>목표 금액 (원)</span>
          <input
            type="number"
            value={draft.targetAmount}
            onChange={(e) => setDraft({ ...draft, targetAmount: e.target.value })}
            placeholder="10000000"
          />
        </label>
        <label>
          <span>목표 기한 (선택)</span>
          <input type="date" value={draft.targetDate} onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })} />
        </label>
        <label>
          <span>진행률 산정 방식</span>
          <select value={draft.linkMode} onChange={(e) => setDraft({ ...draft, linkMode: e.target.value as LinkMode })}>
            <option value="accounts">연결 계좌 잔액 합</option>
            <option value="category">재테크 이체 누적(대/중분류)</option>
          </select>
        </label>
        {draft.linkMode === "accounts" ? (
          <label className="wide">
            <span>연결 계좌 (증권/암호화폐 계좌는 평가액 미포함이라 선택 대상에서 제외됨)</span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
              }}
            >
              {eligibleAccounts.length === 0 && <span className="hint">연결 가능한 입출금/저축 계좌가 없습니다.</span>}
              {eligibleAccounts.map((a) => {
                const checked = draft.linkedAccountIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      borderRadius: 14,
                      fontSize: 13,
                      cursor: "pointer",
                      border: "1px solid var(--border)",
                      background: checked ? "var(--primary-light)" : "var(--surface)",
                      color: checked ? "var(--primary)" : "var(--text)",
                      fontWeight: checked ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const set = new Set(draft.linkedAccountIds);
                        if (e.target.checked) set.add(a.id);
                        else set.delete(a.id);
                        setDraft({ ...draft, linkedAccountIds: [...set] });
                      }}
                      style={{ margin: 0 }}
                    />
                    {accountChipLabel(a)}
                  </label>
                );
              })}
            </div>
          </label>
        ) : (
          <label>
            <span>연결 분류 (저축이체/투자이체 등)</span>
            <select value={draft.linkedCategory} onChange={(e) => setDraft({ ...draft, linkedCategory: e.target.value })}>
              <option value="">선택하세요</option>
              {linkCategoryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <div className="form-actions">
          <button type="button" className="primary" onClick={saveDraft}>
            {isEditing ? "저장" : "추가"}
          </button>
          {(isEditing || isDirty) && (
            <button type="button" onClick={cancelEdit}>
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
