import React, { useMemo, useState } from "react";
import type { CategoryPresets, ExpenseDetailGroup, LedgerEntry } from "../types";

interface Props {
  presets: CategoryPresets;
  onChangePresets: (next: CategoryPresets) => void;
  ledger?: LedgerEntry[];
}

export const CategoriesView: React.FC<Props> = ({ presets, onChangePresets, ledger = [] }) => {
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

  // 카테고리 사용 통계 계산
  const categoryUsage = useMemo(() => {
    const usage = new Map<string, number>();
    
    // 수입 카테고리 사용 횟수
    presets.income.forEach((cat) => {
      const count = ledger.filter(
        (l) => l.kind === "income" && (l.subCategory === cat || l.category === cat)
      ).length;
      if (count > 0) usage.set(`income:${cat}`, count);
    });
    
    // 지출 대분류 사용 횟수
    presets.expense.forEach((cat) => {
      const count = ledger.filter((l) => l.kind === "expense" && l.category === cat).length;
      if (count > 0) usage.set(`expense:${cat}`, count);
    });
    
    // 지출 세부 항목 사용 횟수
    presets.expenseDetails?.forEach((group) => {
      group.subs.forEach((sub) => {
        const count = ledger.filter(
          (l) => l.kind === "expense" && l.subCategory === sub
        ).length;
        if (count > 0) usage.set(`expense:${group.main}:${sub}`, count);
      });
    });
    
    return usage;
  }, [presets, ledger]);

  // 사용하지 않는 카테고리 찾기
  const unusedCategories = useMemo(() => {
    const unused: Array<{ type: string; name: string; path: string }> = [];
    
    // 사용하지 않는 수입 카테고리
    presets.income.forEach((cat) => {
      if (!categoryUsage.has(`income:${cat}`)) {
        unused.push({ type: "수입", name: cat, path: cat });
      }
    });
    
    // 사용하지 않는 지출 대분류
    presets.expense.forEach((cat) => {
      if (!categoryUsage.has(`expense:${cat}`)) {
        unused.push({ type: "지출 대분류", name: cat, path: cat });
      }
    });
    
    // 사용하지 않는 지출 세부 항목
    presets.expenseDetails?.forEach((group) => {
      group.subs.forEach((sub) => {
        if (!categoryUsage.has(`expense:${group.main}:${sub}`)) {
          unused.push({ type: "지출 세부", name: sub, path: `${group.main} > ${sub}` });
        }
      });
    });
    
    return unused;
  }, [presets, categoryUsage]);

  // 카테고리 통합 함수
  const mergeCategories = (fromCategory: string, toCategory: string, type: "main" | "sub", groupIndex?: number) => {
    if (type === "main") {
      // 대분류 통합
      const updatedGroups = expenseGroups.map((g) => {
        if (g.main === fromCategory) {
          return { ...g, main: toCategory };
        }
        return g;
      });
      // 중복 제거 및 통합
      const merged: ExpenseDetailGroup[] = [];
      const seen = new Set<string>();
      updatedGroups.forEach((g) => {
        if (!seen.has(g.main)) {
          seen.add(g.main);
          merged.push(g);
        } else {
          const existing = merged.find((m) => m.main === g.main);
          if (existing) {
            existing.subs = [...new Set([...existing.subs, ...g.subs])];
          }
        }
      });
      setExpenseGroups(merged);
    } else if (type === "sub" && groupIndex !== undefined) {
      // 세부 항목 통합
      const updatedGroups = [...expenseGroups];
      const group = updatedGroups[groupIndex];
      const fromIndex = group.subs.indexOf(fromCategory);
      if (fromIndex >= 0) {
        group.subs = group.subs.filter((_, i) => i !== fromIndex);
        if (!group.subs.includes(toCategory)) {
          group.subs.push(toCategory);
        }
        updatedGroups[groupIndex] = group;
        setExpenseGroups(updatedGroups);
      }
    }
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

      {/* 카테고리 정리 섹션 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>카테고리 정리</h3>
        </div>
        
        {/* 사용 통계 */}
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>사용 통계</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {Array.from(categoryUsage.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([key, count]) => {
                const [, type, ...parts] = key.split(":");
                const name = parts.join(" > ");
                return (
                  <div
                    key={key}
                    style={{
                      padding: "8px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: 13
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {count}회 사용
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 사용하지 않는 카테고리 */}
        {unusedCategories.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, marginBottom: 8, color: "var(--warning)" }}>
              사용하지 않는 카테고리 ({unusedCategories.length}개)
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {unusedCategories.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "6px 10px",
                    background: "var(--surface)",
                    border: "1px solid var(--warning)",
                    borderRadius: "6px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  }}
                >
                  <span>{item.path}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`"${item.path}" 카테고리를 삭제하시겠습니까?`)) {
                        if (item.type === "수입") {
                          setIncomeRows((prev) => prev.filter((c) => c !== item.name));
                        } else if (item.type === "지출 대분류") {
                          const groupIndex = expenseGroups.findIndex((g) => g.main === item.name);
                          if (groupIndex >= 0) {
                            removeGroup(groupIndex);
                          }
                        } else if (item.type === "지출 세부") {
                          const [main, sub] = item.path.split(" > ");
                          const groupIndex = expenseGroups.findIndex((g) => g.main === main);
                          if (groupIndex >= 0) {
                            const updated = [...expenseGroups];
                            updated[groupIndex] = {
                              ...updated[groupIndex],
                              subs: updated[groupIndex].subs.filter((s) => s !== sub)
                            };
                            setExpenseGroups(updated);
                          }
                        }
                      }
                    }}
                    style={{
                      background: "var(--danger)",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      fontSize: 11,
                      cursor: "pointer"
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 카테고리 통합 도구 */}
        <div>
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>카테고리 통합</h4>
          <p className="hint" style={{ fontSize: 12, marginBottom: 8 }}>
            두 카테고리를 하나로 통합할 수 있습니다. 통합하면 기존 데이터의 카테고리도 자동으로 변경됩니다.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, marginBottom: 4, display: "block" }}>통합할 카테고리</label>
              <select
                id="merge-from"
                style={{ width: "100%", padding: "6px", fontSize: 13 }}
                defaultValue=""
              >
                <option value="">선택</option>
                {expenseGroups.map((g, idx) => (
                  <optgroup key={idx} label={g.main || "(대분류 없음)"}>
                    <option value={`main:${idx}:${g.main}`}>{g.main} (대분류)</option>
                    {g.subs.map((sub, subIdx) => (
                      <option key={subIdx} value={`sub:${idx}:${sub}`}>
                        {sub} (세부)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, marginBottom: 4, display: "block" }}>통합 대상 카테고리</label>
              <select
                id="merge-to"
                style={{ width: "100%", padding: "6px", fontSize: 13 }}
                defaultValue=""
              >
                <option value="">선택</option>
                {expenseGroups.map((g, idx) => (
                  <optgroup key={idx} label={g.main || "(대분류 없음)"}>
                    <option value={`main:${idx}:${g.main}`}>{g.main} (대분류)</option>
                    {g.subs.map((sub, subIdx) => (
                      <option key={subIdx} value={`sub:${idx}:${sub}`}>
                        {sub} (세부)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const fromSelect = document.getElementById("merge-from") as HTMLSelectElement;
                const toSelect = document.getElementById("merge-to") as HTMLSelectElement;
                const fromValue = fromSelect.value;
                const toValue = toSelect.value;
                
                if (!fromValue || !toValue || fromValue === toValue) {
                  alert("서로 다른 두 카테고리를 선택해주세요.");
                  return;
                }
                
                const [fromType, fromIdx, fromName] = fromValue.split(":");
                const [toType, toIdx, toName] = toValue.split(":");
                
                if (fromType !== toType) {
                  alert("같은 유형의 카테고리만 통합할 수 있습니다.");
                  return;
                }
                
                if (confirm(`"${fromName}"을(를) "${toName}"(으)로 통합하시겠습니까?`)) {
                  if (fromType === "main") {
                    mergeCategories(fromName, toName, "main");
                  } else {
                    mergeCategories(fromName, toName, "sub", parseInt(fromIdx));
                  }
                  fromSelect.value = "";
                  toSelect.value = "";
                }
              }}
              style={{ padding: "6px 12px", fontSize: 13 }}
            >
              통합
            </button>
          </div>
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

