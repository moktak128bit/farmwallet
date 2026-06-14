import React, { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import type { CategoryPresets, ExpenseDetailGroup, LedgerEntry } from "../types";
import {
  buildMergeCandidates, buildMergeMapper, countMergeTargets, mergePresets,
  subPairKey, splitSubPairKey, effectiveSubName, expenseMainName,
  type MergeKind, type MergeSpec,
} from "../utils/categoryMerge";

interface Props {
  presets: CategoryPresets;
  onChangePresets: (next: CategoryPresets) => void;
  ledger?: LedgerEntry[];
  /** 카테고리 통합 시 가계부 항목 일괄 치환 (undo 히스토리에 포함되도록 부모에서 setDataWithHistory로 연결) */
  onBulkUpdateLedger?: (mapper: (l: LedgerEntry) => LedgerEntry) => void;
}

export const CategoriesView: React.FC<Props> = ({ presets, onChangePresets, ledger = [], onBulkUpdateLedger }) => {
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

  // 카테고리 타입 상태 관리.
  // 사용자가 비운 값은 비운 대로 존중 — 기본값 주입은 getDefaultCategoryPresets에서만.
  // transfer는 데이터 성격상 최소 1개는 있어야 하므로 presets.transfer로 대체.
  const [categoryTypes, setCategoryTypes] = useState<{
    fixed: string[];
    savings: string[];
    transfer: string[];
    salary: string[];
    passive: string[];
    nonRealIncome: string[];
  }>(() => ({
    fixed: presets.categoryTypes?.fixed ?? [],
    savings: presets.categoryTypes?.savings ?? [],
    transfer: presets.categoryTypes?.transfer ?? presets.transfer,
    salary: presets.categoryTypes?.salary ?? [],
    passive: presets.categoryTypes?.passive ?? [],
    nonRealIncome: presets.categoryTypes?.nonRealIncome ?? []
  }));

  // presets prop이 외부에서 바뀌면(Ctrl+Z 복원, 다른 경로 저장 등) 로컬 표 상태 전체를 재구성.
  // 내용 직렬화 비교로 실제 변경 시에만 동기화 — 참조만 바뀐 재렌더로
  // 사용자가 편집 중인 표가 덮어써지는 것을 방지.
  const lastSyncedPresetsRef = useRef<string>(JSON.stringify(presets));
  useEffect(() => {
    const serialized = JSON.stringify(presets);
    if (serialized === lastSyncedPresetsRef.current) return;
    lastSyncedPresetsRef.current = serialized;
    setIncomeRows([...presets.income]);
    setTransferRows([...presets.transfer]);
    setExpenseGroups(
      presets.expenseDetails && presets.expenseDetails.length > 0
        ? presets.expenseDetails.map((g) => ({ main: g.main, subs: [...g.subs] }))
        : presets.expense.map((main) => ({ main, subs: [] }))
    );
    setCategoryTypes({
      fixed: presets.categoryTypes?.fixed ?? [],
      savings: presets.categoryTypes?.savings ?? [],
      transfer: presets.categoryTypes?.transfer ?? presets.transfer,
      salary: presets.categoryTypes?.salary ?? [],
      passive: presets.categoryTypes?.passive ?? [],
      nonRealIncome: presets.categoryTypes?.nonRealIncome ?? []
    });
  }, [presets]);

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

  // 수입 성격 지정 대상 — 현재 입력된 수입 카테고리(중복·빈값 제거)
  const incomeNatureCats = useMemo(
    () => Array.from(new Set(incomeRows.map((r) => r.trim()).filter(Boolean))),
    [incomeRows]
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
      transfer: normalize(transferRows),
      categoryTypes: {
        fixed: categoryTypes.fixed,
        savings: categoryTypes.savings,
        transfer: categoryTypes.transfer,
        // 입력 행에 더 이상 없는 카테고리는 정리 (이름 변경·삭제 시 잔재 방지)
        salary: categoryTypes.salary.filter((c) => incomeRows.includes(c)),
        passive: categoryTypes.passive.filter((c) => incomeRows.includes(c)),
        nonRealIncome: categoryTypes.nonRealIncome.filter((c) => incomeRows.includes(c))
      }
    });
    toast.success("카테고리 설정이 저장되었습니다.");
  };

  const addColumn = () => {
    setExpenseGroups([...expenseGroups, { main: "대분류", subs: [] }]);
  };

  const addRow = () => {
    // 모든 열에 빈 칸을 붙여야 maxRows가 항상 +1 됨 — 지출 한 열만 늘리면
    // 다른 열(예: 수입)이 더 길 때 행 수가 그대로라 버튼이 안 먹는 것처럼 보임
    setIncomeRows((prev) => [...prev, ""]);
    setTransferRows((prev) => [...prev, ""]);
    setExpenseGroups((prev) => prev.map((g) => ({ ...g, subs: [...g.subs, ""] })));
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
      while (next.length && !next[next.length - 1]) {
        next.pop();
      }
      return next;
    };

    // 수입·이체·지출 세부항목 행 전체 이동
    setIncomeRows((prev) => moveArray(prev));
    setTransferRows((prev) => moveArray(prev));
    setExpenseGroups((prev) =>
      prev.map((g) => {
        const subs = [...g.subs];
        const maxPos = Math.max(from, to);
        while (subs.length <= maxPos) subs.push("");
        const [item] = subs.splice(from, 1);
        subs.splice(to, 0, item);
        const trimmed = subs.filter((s, i) => s || subs.some((x, j) => j > i && x));
        return { ...g, subs: trimmed.length ? trimmed : [] };
      })
    );
  };

  const moveGroup = (from: number, to: number) => {
    if (from === to || to < 0 || to >= expenseGroups.length) return;
    const next = [...expenseGroups];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setExpenseGroups(next);
  };

  const moveSubInGroup = (groupIndex: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || toIdx < 0 || groupIndex < 0 || groupIndex >= expenseGroups.length) return;
    const group = expenseGroups[groupIndex];
    const subs = [...group.subs];
    if (fromIdx >= subs.length) return;
    const [item] = subs.splice(fromIdx, 1);
    const insertAt = toIdx > fromIdx ? Math.min(toIdx - 1, subs.length) : Math.min(toIdx, subs.length);
    subs.splice(insertAt, 0, item);
    const trimmed = subs.filter((s, i) => s || subs.some((x, j) => j > i && x));
    const next = expenseGroups.map((g, i) =>
      i === groupIndex ? { ...g, subs: trimmed.length ? trimmed : [] } : g
    );
    setExpenseGroups(next);
  };

  const moveItemInArray = (arr: string[], fromIdx: number, toIdx: number): string[] => {
    if (fromIdx === toIdx || toIdx < 0) return arr;
    const next = [...arr];
    const maxPos = Math.max(fromIdx, toIdx);
    while (next.length <= maxPos) next.push("");
    const [item] = next.splice(fromIdx, 1);
    const insertAt = toIdx > fromIdx ? Math.min(toIdx - 1, next.length) : Math.min(toIdx, next.length);
    next.splice(insertAt, 0, item);
    return next.filter((s, i) => s || next.some((x, j) => j > i && x));
  };

  const moveIncomeRow = (fromIdx: number, toIdx: number) => {
    setIncomeRows((prev) => moveItemInArray(prev, fromIdx, toIdx));
  };

  const moveTransferRow = (fromIdx: number, toIdx: number) => {
    setTransferRows((prev) => moveItemInArray(prev, fromIdx, toIdx));
  };

  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [dragSub, setDragSub] = useState<{ groupIdx: number; rowIdx: number } | null>(null);
  const [dragIncome, setDragIncome] = useState<number | null>(null);
  const [dragTransfer, setDragTransfer] = useState<number | null>(null);

  /** confirm 없이 대분류 열 제거 — 호출부에서 이미 확인한 경로(미사용 카테고리 삭제)용 */
  const removeGroupAt = (index: number) => {
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

  const removeGroup = (index: number) => {
    if (!confirm("정말 지우시겠습니까?")) return;
    removeGroupAt(index);
  };

  const removeIncomeRow = (rowIdx: number) => {
    if (!confirm("정말 지우시겠습니까?")) return;
    setIncomeRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  const removeTransferRow = (rowIdx: number) => {
    if (!confirm("정말 지우시겠습니까?")) return;
    setTransferRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  const removeSubInGroup = (groupIdx: number, rowIdx: number) => {
    if (!confirm("정말 지우시겠습니까?")) return;
    const group = expenseGroups[groupIdx];
    if (!group || rowIdx >= group.subs.length) return;
    const next = expenseGroups.map((g, i) =>
      i === groupIdx
        ? { ...g, subs: g.subs.filter((_, idx) => idx !== rowIdx) }
        : g
    );
    setExpenseGroups(next);
  };

  // 카테고리 사용 통계 계산 — categoryMerge 헬퍼 재사용 (현행 스키마:
  // category="지출"/subCategory=대분류/detailCategory=세부 + 레거시: category=대분류 모두 집계)
  const categoryUsage = useMemo(() => {
    const usage = new Map<string, number>();

    // 수입 카테고리 사용 횟수 — effectiveSubName: subCategory 우선, 구세대는 category
    presets.income.forEach((cat) => {
      const count = ledger.filter(
        (l) => l.kind === "income" && effectiveSubName(l) === cat
      ).length;
      if (count > 0) usage.set(`income:${cat}`, count);
    });

    // 지출 대분류 사용 횟수 — expenseMainName: subCategory=대분류(현행), category=대분류(레거시)
    presets.expense.forEach((cat) => {
      const count = ledger.filter(
        (l) => l.kind === "expense" && expenseMainName(l) === cat
      ).length;
      if (count > 0) usage.set(`expense:${cat}`, count);
    });

    // 지출 세부 항목 사용 횟수 — 대분류 일치 + detailCategory=세부 (categoryMerge expenseSub와 동일 기준)
    presets.expenseDetails?.forEach((group) => {
      group.subs.forEach((sub) => {
        const count = ledger.filter(
          (l) =>
            l.kind === "expense" &&
            expenseMainName(l) === group.main &&
            (l.detailCategory ?? "").trim() === sub
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

  /* ===== 카테고리 통합 (utils/categoryMerge 단일 소스) =====
     로컬 편집 중인 표 상태를 스냅샷으로 프리셋을 만들고, 통합 결과를
     ① 로컬 상태 ② onChangePresets(즉시 저장) ③ onBulkUpdateLedger(가계부 치환)에 모두 반영 */
  const [mergeKind, setMergeKind] = useState<MergeKind>("income");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");

  const presetsSnapshot = useMemo((): CategoryPresets => {
    const normalize = (items: string[]) => items.map((v) => v.trim()).filter((v, i, arr) => v && arr.indexOf(v) === i);
    const cleanedGroups = expenseGroups
      .map((g) => ({ main: g.main.trim(), subs: g.subs.map((s) => s.trim()).filter((s, i, arr) => s && arr.indexOf(s) === i) }))
      .filter((g) => g.main);
    return {
      income: normalize(incomeRows),
      expense: cleanedGroups.map((g) => g.main),
      expenseDetails: cleanedGroups,
      transfer: normalize(transferRows),
      categoryTypes,
    };
  }, [incomeRows, transferRows, expenseGroups, categoryTypes]);

  const mergeCandidates = useMemo(
    () => buildMergeCandidates(mergeKind, presetsSnapshot, ledger),
    [mergeKind, presetsSnapshot, ledger]
  );

  const handleMerge = () => {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) {
      toast.error("서로 다른 두 카테고리를 선택해주세요.");
      return;
    }
    const spec: MergeSpec = mergeKind === "expenseSub"
      ? (() => {
          const f = splitSubPairKey(mergeFrom); const t = splitSubPairKey(mergeTo);
          return { kind: mergeKind, from: f.sub, to: t.sub, fromMain: f.main, toMain: t.main };
        })()
      : { kind: mergeKind, from: mergeFrom, to: mergeTo };
    const fromLabel = spec.fromMain ? `${spec.fromMain} > ${spec.from}` : spec.from;
    const toLabel = spec.toMain ? `${spec.toMain} > ${spec.to}` : spec.to;
    const n = countMergeTargets(ledger, spec);
    if (!confirm(`"${fromLabel}"을(를) "${toLabel}"(으)로 통합합니다.\n가계부 항목 ${n}건의 분류가 변경되고, 목록에서 "${fromLabel}"이(가) 제거됩니다.`)) return;

    const nextPresets = mergePresets(presetsSnapshot, spec);
    // 로컬 표 상태 동기화
    setIncomeRows([...nextPresets.income]);
    setTransferRows([...nextPresets.transfer]);
    setExpenseGroups(nextPresets.expenseDetails ?? nextPresets.expense.map((main) => ({ main, subs: [] })));
    if (nextPresets.categoryTypes) setCategoryTypes({
      fixed: nextPresets.categoryTypes.fixed ?? [],
      savings: nextPresets.categoryTypes.savings ?? [],
      transfer: nextPresets.categoryTypes.transfer ?? nextPresets.transfer,
      salary: nextPresets.categoryTypes.salary ?? [],
      passive: nextPresets.categoryTypes.passive ?? [],
      nonRealIncome: nextPresets.categoryTypes.nonRealIncome ?? [],
    });
    // 즉시 저장 + 가계부 일괄 치환
    onChangePresets(nextPresets);
    if (n > 0 && onBulkUpdateLedger) onBulkUpdateLedger(buildMergeMapper(spec));
    setMergeFrom(""); setMergeTo("");
    toast.success(`"${fromLabel}" → "${toLabel}" 통합 완료 (가계부 ${n}건 변경). 실수라면 Ctrl+Z로 되돌릴 수 있습니다.`);
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
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="primary" onClick={addColumn} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
              + 대분류 추가
            </button>
            <button type="button" className="secondary" onClick={addRow} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
              + 행 추가
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="col-drag-handle" title="잡아서 좌우로 옮길 수 있습니다.">
                          ☰
                        </span>
                        <input
                          type="text"
                          value={g.main}
                          onChange={(e) => updateMain(idx, e.target.value)}
                          style={{ flex: 1, minWidth: 100 }}
                          aria-label={`지출 대분류 ${idx + 1}${g.main ? ` (${g.main})` : ""}`}
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
                      {g.main && (
                          <select
                            value={
                              categoryTypes.savings.includes(g.main) ? "savings" :
                              categoryTypes.fixed.includes(g.main) ? "fixed" :
                              "variable"
                            }
                            onChange={(e) => {
                              const newType = e.target.value;
                              const newCategoryTypes = { ...categoryTypes };
                              
                              // 기존 타입에서 제거
                              newCategoryTypes.savings = newCategoryTypes.savings.filter(c => c !== g.main);
                              newCategoryTypes.fixed = newCategoryTypes.fixed.filter(c => c !== g.main);
                              
                              // 새 타입에 추가
                              if (newType === "savings") {
                                newCategoryTypes.savings.push(g.main);
                              } else if (newType === "fixed") {
                                newCategoryTypes.fixed.push(g.main);
                              }
                              
                              setCategoryTypes(newCategoryTypes);
                            }}
                            style={{ 
                              fontSize: 11, 
                              padding: "2px 4px",
                              border: "1px solid var(--border)",
                              borderRadius: 4,
                              backgroundColor: "var(--surface)"
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="variable">변동지출</option>
                            <option value="fixed">고정지출</option>
                            <option value="savings">저축성지출</option>
                          </select>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxRows }).map((_, rowIdx) => (
                <tr key={rowIdx}>
                  <td
                    className="row-handle-cell"
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
                    title="드래그: 수입·이체·지출 행 전체 순서 변경"
                    style={{ cursor: "grab" }}
                  >
                    <div className="row-handle-inner">
                      <span className="row-index">{rowIdx + 1}</span>
                      <span style={{ marginLeft: 4, opacity: 0.6 }}>☰</span>
                    </div>
                  </td>
                  <td
                    className="income-cell"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDragIncome(rowIdx);
                    }}
                    onDragOver={(e) => {
                      if (dragIncome === null) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (dragIncome === null) return;
                      e.preventDefault();
                      moveIncomeRow(dragIncome, rowIdx);
                      setDragIncome(null);
                    }}
                    onDragEnd={() => setDragIncome(null)}
                    title="드래그: 수입 항목 순서 변경"
                    style={{ cursor: "grab" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ flexShrink: 0, opacity: 0.6, cursor: "grab" }}>☰</span>
                      <input
                        type="text"
                        value={incomeItems[rowIdx] ?? ""}
                        onChange={(e) => updateIncomeRow(rowIdx, e.target.value)}
                        style={{ flex: 1, minWidth: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`수입 항목 ${rowIdx + 1}`}
                      />
                      {(incomeItems[rowIdx] ?? "").trim() && (
                        <button
                          type="button"
                          className="icon-button icon-button-small"
                          onClick={(e) => { e.stopPropagation(); removeIncomeRow(rowIdx); }}
                          title="이 수입 항목 삭제"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                  <td
                    className="transfer-cell"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDragTransfer(rowIdx);
                    }}
                    onDragOver={(e) => {
                      if (dragTransfer === null) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (dragTransfer === null) return;
                      e.preventDefault();
                      moveTransferRow(dragTransfer, rowIdx);
                      setDragTransfer(null);
                    }}
                    onDragEnd={() => setDragTransfer(null)}
                    title="드래그: 이체 항목 순서 변경"
                    style={{ cursor: "grab" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ flexShrink: 0, opacity: 0.6, cursor: "grab" }}>☰</span>
                      <input
                        type="text"
                        value={transferItems[rowIdx] ?? ""}
                        onChange={(e) => updateTransferRow(rowIdx, e.target.value)}
                        style={{ flex: 1, minWidth: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`이체 항목 ${rowIdx + 1}`}
                      />
                      {(transferItems[rowIdx] ?? "").trim() && (
                        <button
                          type="button"
                          className="icon-button icon-button-small"
                          onClick={(e) => { e.stopPropagation(); removeTransferRow(rowIdx); }}
                          title="이 이체 항목 삭제"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                  {expenseGroups.map((g, colIdx) => (
                    <td
                      key={`${colIdx}-${rowIdx}`}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragSub({ groupIdx: colIdx, rowIdx });
                      }}
                      onDragOver={(e) => {
                        if (dragSub === null || dragSub.groupIdx !== colIdx) return;
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (dragSub === null || dragSub.groupIdx !== colIdx) return;
                        e.preventDefault();
                        moveSubInGroup(colIdx, dragSub.rowIdx, rowIdx);
                        setDragSub(null);
                      }}
                      onDragEnd={() => setDragSub(null)}
                      title="드래그: 이 열(대분류) 내 세부항목 순서만 변경"
                      style={{ cursor: "grab" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ flexShrink: 0, opacity: 0.6, cursor: "grab" }}>☰</span>
                        <input
                          type="text"
                          value={g.subs[rowIdx] ?? ""}
                          onChange={(e) => updateSub(colIdx, rowIdx, e.target.value)}
                          style={{ flex: 1, minWidth: 0 }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${g.main || `대분류 ${colIdx + 1}`} 세부 항목 ${rowIdx + 1}`}
                        />
                        {(g.subs[rowIdx] ?? "").trim() && (
                          <button
                            type="button"
                            className="icon-button icon-button-small"
                            onClick={(e) => { e.stopPropagation(); removeSubInGroup(colIdx, rowIdx); }}
                            title="이 세부 항목 삭제"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 수입 성격 지정 — 인사이트·대시보드의 "수입=근로소득" 분류를 사용자가 직접 덮어쓰기 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>수입 성격 지정</h3>
        </div>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.7 }}>
          인사이트·대시보드의 <strong>수입 추세·저축률</strong>은 근로소득(월급·수당·상여)만 집계합니다.
          카테고리 성격을 직접 지정하면 자동 추측을 덮어씁니다 (<strong>자동</strong>은 빈도 기반 추정).
          <br />
          · <strong>근로소득</strong> 수입 추세·저축률 분모에 포함 ·
          {" "}<strong>패시브</strong> 실질수입엔 포함, 근로소득 추세엔 제외(배당·이자) ·
          {" "}<strong>비실질</strong> 정산·용돈·지원처럼 실질수입에서 제외
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {incomeNatureCats.map((cat) => {
            const value = categoryTypes.salary.includes(cat) ? "salary"
              : categoryTypes.passive.includes(cat) ? "passive"
              : categoryTypes.nonRealIncome.includes(cat) ? "nonRealIncome"
              : "auto";
            return (
              <div key={cat} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cat}>{cat}</span>
                <select
                  aria-label={`${cat} 수입 성격`}
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCategoryTypes((prev) => {
                      const salary = prev.salary.filter((c) => c !== cat);
                      const passive = prev.passive.filter((c) => c !== cat);
                      const nonRealIncome = prev.nonRealIncome.filter((c) => c !== cat);
                      if (v === "salary") salary.push(cat);
                      else if (v === "passive") passive.push(cat);
                      else if (v === "nonRealIncome") nonRealIncome.push(cat);
                      return { ...prev, salary, passive, nonRealIncome };
                    });
                  }}
                  style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4, backgroundColor: "var(--surface)" }}
                >
                  <option value="auto">자동</option>
                  <option value="salary">근로소득</option>
                  <option value="passive">패시브</option>
                  <option value="nonRealIncome">비실질</option>
                </select>
              </div>
            );
          })}
          {incomeNatureCats.length === 0 && <div className="hint">수입 카테고리를 먼저 추가하세요.</div>}
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
                const [, , ...parts] = key.split(":");
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
                            // 이미 위에서 confirm 했으므로 재확인 없는 경로 사용 (confirm 중복 방지)
                            removeGroupAt(groupIndex);
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
            두 카테고리를 하나로 합칩니다. 가계부의 기존 항목도 함께 변경되고 즉시 저장됩니다 (Ctrl+Z로 되돌리기 가능).
            목록에 없이 데이터에만 남은 카테고리(예: 띄어쓰기가 다른 중복)도 후보에 표시됩니다.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, marginBottom: 4, display: "block" }}>유형</label>
              <select
                value={mergeKind}
                onChange={(e) => { setMergeKind(e.target.value as MergeKind); setMergeFrom(""); setMergeTo(""); }}
                style={{ padding: "6px", fontSize: 13 }}
              >
                <option value="income">수입</option>
                <option value="transfer">이체</option>
                <option value="expenseMain">지출 대분류</option>
                <option value="expenseSub">지출 세부</option>
              </select>
            </div>
            {([["통합할 카테고리 (없어짐)", mergeFrom, setMergeFrom], ["통합 대상 (남음)", mergeTo, setMergeTo]] as const).map(([label, value, setter]) => (
              <div key={label}>
                <label style={{ fontSize: 11, marginBottom: 4, display: "block" }}>{label}</label>
                <select value={value} onChange={(e) => setter(e.target.value)} style={{ width: "100%", padding: "6px", fontSize: 13 }}>
                  <option value="">선택</option>
                  {mergeCandidates.map((c) => {
                    const v = mergeKind === "expenseSub" ? subPairKey(c.main ?? "", c.name) : c.name;
                    const text = `${mergeKind === "expenseSub" ? `${c.main} > ` : ""}${c.name} (${c.count}건${c.inPreset ? "" : " · 목록에 없음"})`;
                    return <option key={v} value={v}>{text}</option>;
                  })}
                </select>
              </div>
            ))}
            <button type="button" className="primary" onClick={handleMerge} style={{ padding: "6px 12px", fontSize: 13 }}>
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

