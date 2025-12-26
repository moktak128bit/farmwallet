import React, { useMemo, useState } from "react";
import type { CategoryPresets, ExpenseDetailGroup } from "../types";

interface Props {
  presets: CategoryPresets;
  onChangePresets: (next: CategoryPresets) => void;
}

export const CategoriesView: React.FC<Props> = ({ presets, onChangePresets }) => {
  const [incomeRows, setIncomeRows] = useState<string[]>(() => [...presets.income]);
  const [transferRows, setTransferRows] = useState<string[]>(() => [...presets.transfer]);

  const incomeItems = incomeRows;
  const transferItems = transferRows;

  const initialExpenseGroups: ExpenseDetailGroup[] = useMemo(() => {
    if (presets.expenseDetails && presets.expenseDetails.length > 0) {
      return presets.expenseDetails;
    }
    return presets.expense.map((main) => ({ main, subs: [] }));
  }, [presets.expense, presets.expenseDetails]);

  const [expenseGroups, setExpenseGroups] = useState<ExpenseDetailGroup[]>(initialExpenseGroups);

  const maxRows = useMemo(
    () =>
      Math.max(
        4,
        incomeItems.length,
        transferItems.length,
        ...expenseGroups.map((g) => g.subs.length)
      ),
    [expenseGroups, incomeItems.length, transferItems.length]
  );

  const handleSave = () => {
    const normalize = (items: string[]) =>
      items
        .map((v) => v.trim())
        .filter((v, idx, arr) => v && arr.indexOf(v) === idx);

    const cleanedGroups: ExpenseDetailGroup[] = expenseGroups
      .map((g) => ({
        main: g.main.trim(),
        subs: g.subs.map((s) => s.trim()).filter((s, idx, arr) => s && arr.indexOf(s) === idx)
      }))
      .filter((g) => g.main);

    onChangePresets({
      income: normalize(incomeRows),
      expense: cleanedGroups.map((g) => g.main),
      expenseDetails: cleanedGroups,
      transfer: normalize(transferRows)
    });
  };

  const addColumn = () => {
    setExpenseGroups([...expenseGroups, { main: "대분류", subs: [] }]);
  };

  const addRow = () => {
    const next = expenseGroups.map((g) => ({ ...g, subs: [...g.subs] }));
    // just increase maxRows by 1 via longer subs length
    if (next.length > 0) {
      next[0].subs = [...next[0].subs, ""];
    }
    setExpenseGroups(next);
  };

  const updateMain = (index: number, value: string) => {
    const next = expenseGroups.map((g) => ({ ...g, subs: [...g.subs] }));
    next[index].main = value;
    setExpenseGroups(next);
  };

  const updateSub = (groupIndex: number, rowIndex: number, value: string) => {
    const next = expenseGroups.map((g) => ({ ...g, subs: [...g.subs] }));
    const group = next[groupIndex];
    while (group.subs.length <= rowIndex) {
      group.subs.push("");
    }
    group.subs[rowIndex] = value;
    setExpenseGroups(next);
  };

  const updateIncomeRow = (rowIndex: number, value: string) => {
    setIncomeRows((prev) => {
      const next = [...prev];
      while (next.length <= rowIndex) {
        next.push("");
      }
      next[rowIndex] = value;
      return next;
    });
  };

  const updateTransferRow = (rowIndex: number, value: string) => {
    setTransferRows((prev) => {
      const next = [...prev];
      while (next.length <= rowIndex) {
        next.push("");
      }
      next[rowIndex] = value;
      return next;
    });
  };

  const moveRow = (from: number, to: number) => {
    if (from === to || to < 0) return;
    const maxIndex = maxRows - 1;
    if (to > maxIndex) return;

    const moveArray = (arr: string[]): string[] => {
      const next = [...arr];
      const maxPos = Math.max(from, to);
      while (next.length <= maxPos) {
        next.push("");
      }
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      // 뒤쪽 완전 공백 행은 정리
      while (next.length && !next[next.length - 1]) {
        next.pop();
      }
      return next;
    };

    // 수입/이체 행 위치만 변경, 지출 세부항목 행 순서는 유지
    setIncomeRows((prev) => moveArray(prev));
    setTransferRows((prev) => moveArray(prev));
  };

  const moveGroup = (from: number, to: number) => {
    if (from === to || to < 0 || to >= expenseGroups.length) return;
    const next = [...expenseGroups];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setExpenseGroups(next);
  };

  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<number | null>(null);

  const removeGroup = (index: number) => {
    if (expenseGroups.length <= 1) {
      // 최소 1개는 유지
      const next = expenseGroups.map((g, i) =>
        i === 0 ? { ...g, main: "", subs: [] } : g
      );
      setExpenseGroups(next);
      return;
    }
    const next = expenseGroups.slice();
    next.splice(index, 1);
    setExpenseGroups(next);
  };

  return (
    <div>
      <h2>항목 관리 (카테고리 프리셋)</h2>
      <p className="hint">
        수입/지출/이체 구조를 엑셀 표처럼 관리할 수 있습니다. 위에서 보여주셨던 표처럼, 열은
        지출 대분류(식비, 유류교통비 등), 아래 칸들은 세부 항목(시장/마트, 외식/배달 등)입니다.
      </p>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-header">
          <h3>항목 매트릭스</h3>
          <div>
            <button type="button" onClick={addColumn} style={{ marginRight: 8 }}>
              대분류 추가
            </button>
            <button type="button" onClick={addRow}>
              행 추가
            </button>
          </div>
        </div>
        <p className="hint">
          첫 행은 지출 대분류(저축성지출, 식비, 유류교통비 등)를, 아래 행들은 각 대분류의 세부
          항목을 입력합니다. 표에서 직접 수정하면 가계부 입력 시 드롭다운에 그대로 반영됩니다.
          위/아래의 수입·이체 항목과 함께 전체 가계부 항목 구조를 한눈에 볼 수 있습니다.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table category-matrix">
            <thead>
              <tr>
                <th style={{ minWidth: 60, width: 60 }}>행</th>
                <th className="income-col" style={{ minWidth: 140, width: 140 }}>수입</th>
                <th className="transfer-col" style={{ minWidth: 140, width: 140 }}>이체</th>
                {expenseGroups.map((g, idx) => (
                  <th
                    key={idx}
                    draggable
                    style={{ minWidth: 150, width: 150 }}
                    onDragStart={() => setDragCol(idx)}
                    onDragOver={(e) => {
                      if (dragCol === null) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (dragCol === null) return;
                      e.preventDefault();
                      moveGroup(dragCol, idx);
                      setDragCol(null);
                    }}
                    onDragEnd={() => setDragCol(null)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span className="col-drag-handle" title="잡아서 좌우로 옮길 수 있습니다.">
                        ☰
                      </span>
                      <input
                        type="text"
                        value={g.main}
                        onChange={(e) => updateMain(idx, e.target.value)}
                        style={{ flex: 1, minWidth: 100 }}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => removeGroup(idx)}
                        title="이 대분류 삭제"
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxRows }).map((_, rowIdx) => (
                <tr
                  key={rowIdx}
                  draggable
                  onDragStart={() => setDragRow(rowIdx)}
                  onDragOver={(e) => {
                    if (dragRow === null) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (dragRow === null) return;
                    e.preventDefault();
                    moveRow(dragRow, rowIdx);
                    setDragRow(null);
                  }}
                  onDragEnd={() => setDragRow(null)}
                >
                  <td className="row-handle-cell">
                    <div className="row-handle-inner">
                      <span className="row-index">{rowIdx + 1}</span>
                    </div>
                  </td>
                  <td className="income-cell">
                    <input
                      type="text"
                      value={incomeItems[rowIdx] ?? ""}
                      onChange={(e) => updateIncomeRow(rowIdx, e.target.value)}
                    />
                  </td>
                  <td className="transfer-cell">
                    <input
                      type="text"
                      value={transferItems[rowIdx] ?? ""}
                      onChange={(e) => updateTransferRow(rowIdx, e.target.value)}
                    />
                  </td>
                  {expenseGroups.map((g, colIdx) => (
                    <td key={`${colIdx}-${rowIdx}`}>
                      <input
                        type="text"
                        value={g.subs[rowIdx] ?? ""}
                        onChange={(e) => updateSub(colIdx, rowIdx, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="primary" onClick={handleSave}>
          항목 저장
        </button>
      </div>
    </div>
  );
};

