import React, { useMemo, useState } from "react";
import type { BudgetGoal, RecurringExpense, Recurrence, LedgerEntry } from "../types";

interface Props {
  recurring: RecurringExpense[];
  budgets: BudgetGoal[];
  onChangeRecurring: (next: RecurringExpense[]) => void;
  onChangeBudgets: (next: BudgetGoal[]) => void;
  ledger: LedgerEntry[];
  onChangeLedger: (next: LedgerEntry[]) => void;
}

const freqLabel: Record<Recurrence, string> = {
  monthly: "매월",
  weekly: "매주",
  yearly: "매년"
};

const createRecurring = (): RecurringExpense => ({
  id: `R${Date.now()}`,
  title: "",
  amount: 0,
  category: "",
  frequency: "monthly",
  startDate: new Date().toISOString().slice(0, 10),
  note: ""
});

const createBudget = (): BudgetGoal => ({
  id: `B${Date.now()}`,
  category: "",
  monthlyLimit: 0,
  note: ""
});

export const BudgetRecurringView: React.FC<Props> = ({
  recurring,
  budgets,
  onChangeRecurring,
  onChangeBudgets,
  ledger,
  onChangeLedger
}) => {
  const [recForm, setRecForm] = useState<RecurringExpense>(createRecurring);
  const [budForm, setBudForm] = useState<BudgetGoal>(createBudget);
  const currentMonth = new Date().toISOString().slice(0, 7); // yyyy-mm

  const nextRun = (item: RecurringExpense) => {
    const start = item.startDate || "";
    return start;
  };

  const totalBudget = useMemo(
    () => budgets.reduce((s, b) => s + (b.monthlyLimit || 0), 0),
    [budgets]
  );

  const addRecurring = () => {
    if (!recForm.title || !recForm.amount) return;
    onChangeRecurring([recForm, ...recurring]);
    setRecForm(createRecurring());
  };

  const deleteRecurring = (id: string) => {
    onChangeRecurring(recurring.filter((r) => r.id !== id));
  };

  const addBudget = () => {
    if (!budForm.category || !budForm.monthlyLimit) return;
    onChangeBudgets([budForm, ...budgets]);
    setBudForm(createBudget());
  };

  const deleteBudget = (id: string) => {
    onChangeBudgets(budgets.filter((b) => b.id !== id));
  };

  const generateOccurrencesForMonth = (month: string): LedgerEntry[] => {
    const [y, m] = month.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const entries: LedgerEntry[] = [];

    for (const r of recurring) {
      const start = new Date(r.startDate);
      if (r.endDate && new Date(r.endDate) < monthStart) continue;
      let cursor = new Date(start);
      const pushIfInMonth = (date: Date) => {
        if (date >= monthStart && date <= monthEnd) {
          entries.push({
            id: `L${Date.now()}${Math.random().toString(16).slice(2)}`,
            date: date.toISOString().slice(0, 10),
            kind: "expense",
            category: r.category || "(고정지출)",
            subCategory: r.title,
            description: r.title,
            amount: r.amount,
            fromAccountId: undefined,
            toAccountId: undefined
          });
        }
      };

      if (r.frequency === "monthly") {
        const target = new Date(y, m - 1, start.getDate());
        pushIfInMonth(target);
      } else if (r.frequency === "yearly") {
        if (start.getMonth() + 1 === m) {
          const target = new Date(y, m - 1, start.getDate());
          pushIfInMonth(target);
        }
      } else if (r.frequency === "weekly") {
        cursor = new Date(start);
        while (cursor <= monthEnd) {
          if (cursor >= monthStart) pushIfInMonth(new Date(cursor));
          cursor.setDate(cursor.getDate() + 7);
        }
      }
    }
    return entries;
  };

  const handleApplyCurrentMonth = () => {
    const occurrences = generateOccurrencesForMonth(currentMonth);
    if (occurrences.length === 0) return;
    onChangeLedger([...occurrences, ...ledger]);
  };

  const budgetUsage = useMemo(() => {
    return budgets.map((b) => {
      const spent = ledger
        .filter((l) => l.kind === "expense" && l.category === b.category && l.date.startsWith(currentMonth))
        .reduce((s, l) => s + l.amount, 0);
      const remain = b.monthlyLimit - spent;
      return { ...b, spent, remain };
    });
  }, [budgets, ledger, currentMonth]);

  return (
    <div>
      <div className="section-header">
        <h2>예산 / 반복 지출</h2>
      </div>

      <div className="two-column">
        <div className="card form-grid">
          <h3>고정 지출/구독 추가</h3>
          <label>
            <span>제목</span>
            <input
              value={recForm.title}
              onChange={(e) => setRecForm({ ...recForm, title: e.target.value })}
              placeholder="예: 넷플릭스"
            />
          </label>
          <label>
            <span>금액</span>
            <input
              type="number"
              value={recForm.amount || ""}
              onChange={(e) => setRecForm({ ...recForm, amount: Number(e.target.value) || 0 })}
              placeholder="17000"
            />
          </label>
          <label>
            <span>카테고리</span>
            <input
              value={recForm.category}
              onChange={(e) => setRecForm({ ...recForm, category: e.target.value })}
              placeholder="구독비"
            />
          </label>
          <label>
            <span>주기</span>
            <select
              value={recForm.frequency}
              onChange={(e) => setRecForm({ ...recForm, frequency: e.target.value as Recurrence })}
            >
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
              <option value="yearly">매년</option>
            </select>
          </label>
          <label>
            <span>시작일</span>
            <input
              type="date"
              value={recForm.startDate}
              onChange={(e) => setRecForm({ ...recForm, startDate: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>메모</span>
            <input
              value={recForm.note}
              onChange={(e) => setRecForm({ ...recForm, note: e.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="primary" onClick={addRecurring}>
              추가
            </button>
          </div>
        </div>

        <div className="card form-grid">
          <h3>예산/목표 추가</h3>
          <label>
            <span>카테고리</span>
            <input
              value={budForm.category}
              onChange={(e) => setBudForm({ ...budForm, category: e.target.value })}
              placeholder="식비"
            />
          </label>
          <label>
            <span>월 예산</span>
            <input
              type="number"
              value={budForm.monthlyLimit || ""}
              onChange={(e) => setBudForm({ ...budForm, monthlyLimit: Number(e.target.value) || 0 })}
              placeholder="400000"
            />
          </label>
          <label className="wide">
            <span>메모</span>
            <input value={budForm.note} onChange={(e) => setBudForm({ ...budForm, note: e.target.value })} />
          </label>
          <div className="form-actions">
            <span className="hint">총 예산: {Math.round(totalBudget).toLocaleString()} 원</span>
            <button type="button" className="primary" onClick={addBudget}>
              추가
            </button>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>고정 지출/구독 목록</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>금액</th>
            <th>카테고리</th>
            <th>주기</th>
            <th>다음 예정</th>
            <th>메모</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {recurring.map((r) => (
            <tr key={r.id}>
              <td>{r.title}</td>
              <td className="number">{Math.round(r.amount).toLocaleString()} 원</td>
              <td>{r.category}</td>
              <td>{freqLabel[r.frequency]}</td>
              <td>{nextRun(r)}</td>
              <td>{r.note}</td>
              <td>
                <button type="button" className="danger" onClick={() => deleteRecurring(r.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {recurring.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center" }}>
                등록된 고정 지출이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <button type="button" className="secondary" onClick={handleApplyCurrentMonth}>
          이번 달 가계부에 반영
        </button>
      </div>

      <h3 style={{ marginTop: 16 }}>예산/목표</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>카테고리</th>
            <th>월 예산</th>
            <th>지출</th>
            <th>잔여</th>
            <th>메모</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {budgetUsage.map((b) => (
            <tr key={b.id}>
              <td>{b.category}</td>
              <td className="number">{Math.round(b.monthlyLimit).toLocaleString()} 원</td>
              <td className={`number ${b.remain < 0 ? "negative" : "positive"}`}>
                {Math.round(b.spent).toLocaleString()} 원
              </td>
              <td className={`number ${b.remain < 0 ? "negative" : "positive"}`}>
                {Math.round(b.remain).toLocaleString()} 원
              </td>
              <td>{b.note}</td>
              <td>
                <button type="button" className="danger" onClick={() => deleteBudget(b.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {budgets.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center" }}>
                설정된 예산이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
