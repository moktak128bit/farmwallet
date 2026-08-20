/**
 * 가계부 선택 항목 일괄 편집 모달.
 * 변경할 필드만 체크 → 미리보기(전→후·제외 사유) → [적용]: window.confirm + saveSafetySnapshot → onChangeLedger 1회(단일 undo)
 * → 토스트 [되돌리기](이전 항목 배열 복원, restore-by-id).
 * 계산은 utils/ledgerBulkEdit.applyBulkEdit(순수)에서만 — 여기는 패치 조립과 표시.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import { toast } from "react-hot-toast";
import type { Account, CategoryPresets, LedgerEntry, LedgerKind } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";
import { useAppStore } from "../../store/appStore";
import { saveSafetySnapshot } from "../../services/backupService";
import { formatKRW } from "../../utils/formatter";
import { expenseMainName } from "../../utils/categoryMerge";
import {
  applyBulkEdit,
  isBulkEditPatchEmpty,
  type BulkEditChange,
  type BulkEditField,
  type BulkEditPatch,
} from "../../utils/ledgerBulkEdit";

interface Props {
  ledger: LedgerEntry[];
  selectedIds: ReadonlySet<string>;
  accounts: Account[];
  categoryPresets: CategoryPresets;
  /** 기존 가계부 변경 콜백 — 적용 시 정확히 1회 호출(단일 undo 단계) */
  onChangeLedger: (next: LedgerEntry[]) => void;
  onClose: () => void;
}

const KEEP = "__keep__";
const NONE = "__none__";
const KIND_LABEL: Record<LedgerKind, string> = { income: "수입", expense: "지출", transfer: "이체" };
const FIELD_LABEL: Record<BulkEditField, string> = {
  category: "분류",
  fromAccount: "출금 계좌",
  toAccount: "입금 계좌",
  date: "날짜",
  tags: "태그",
  fixed: "고정지출",
};

const parseTagInput = (s: string): string[] =>
  s.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  marginBottom: 8,
  background: "var(--surface)",
};
const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const rowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 24, fontSize: 12 };
const selectStyle: React.CSSProperties = { fontSize: 12, padding: "4px 6px", maxWidth: 200 };
const numStyle: React.CSSProperties = { fontSize: 12, padding: "4px 6px", width: 64 };

/** 되돌리기 토스트 — 이전 항목(before)들을 id로 복원. 적용 이후 다른 편집이 끼어든 항목은 건너뜀. */
function showBulkUndoToast(changes: BulkEditChange[], onChangeLedger: (next: LedgerEntry[]) => void): void {
  const beforeById = new Map(changes.map((c) => [c.id, c] as const));
  let handled = false;
  const restore = (): number => {
    const cur = useAppStore.getState().data.ledger ?? [];
    let restored = 0;
    const next = cur.map((l) => {
      const c = beforeById.get(l.id);
      if (!c) return l;
      // 적용 직후 그대로인 항목만 되돌림 (참조 또는 내용 동일) — 그 사이 수동 편집된 항목은 보존
      if (l === c.after || JSON.stringify(l) === JSON.stringify(c.after)) { restored++; return c.before; }
      return l;
    });
    if (restored > 0) onChangeLedger(next);
    return restored;
  };
  toast.success(
    (t) => (
      <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>{changes.length}건 일괄 편집 완료</span>
        <button
          type="button"
          className="primary"
          style={{ padding: "6px 14px", fontSize: 13, flexShrink: 0 }}
          onClick={() => {
            if (handled) return;
            handled = true;
            toast.dismiss(t.id);
            const n = restore();
            if (n > 0) toast.success(`${n}건을 편집 전으로 되돌렸습니다.`, { id: "bulk-edit-undo-result" });
            else toast.error("이미 되돌렸거나 데이터가 변경되어 되돌릴 수 없습니다.", { id: "bulk-edit-undo-result" });
          }}
        >
          되돌리기
        </button>
      </span>
    ),
    { duration: 8000 }
  );
}

export const BulkEditModal: React.FC<Props> = ({ ledger, selectedIds, accounts, categoryPresets, onChangeLedger, onClose }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && isTopModal()) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, isTopModal]);

  const accountName = (id?: string) => (id ? (accounts.find((a) => a.id === id)?.name ?? id) : "(없음)");
  const selectableAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  // 선택된 원본 항목의 kind 분포 — 분류 변경은 kind 하나에만 적용
  const selectedEntries = useMemo(() => ledger.filter((l) => selectedIds.has(l.id)), [ledger, selectedIds]);
  const kindsPresent = useMemo(() => {
    const s = new Set<LedgerKind>();
    for (const l of selectedEntries) s.add(l.kind);
    return (["expense", "income", "transfer"] as LedgerKind[]).filter((k) => s.has(k));
  }, [selectedEntries]);

  // ── 필드 사용 체크 + 값 ──
  const [useCategory, setUseCategory] = useState(false);
  const [catKind, setCatKind] = useState<LedgerKind>(kindsPresent[0] ?? "expense");
  const [catSub, setCatSub] = useState<string>(KEEP);
  const [catDetail, setCatDetail] = useState<string>(KEEP);
  const [useFrom, setUseFrom] = useState(false);
  const [fromId, setFromId] = useState<string>(NONE);
  const [useTo, setUseTo] = useState(false);
  const [toId, setToId] = useState<string>(NONE);
  const [useDate, setUseDate] = useState(false);
  const [shiftDays, setShiftDays] = useState<string>("0");
  const [shiftMonths, setShiftMonths] = useState<string>("0");
  const [useTags, setUseTags] = useState(false);
  const [addTagsText, setAddTagsText] = useState("");
  const [removeTagsText, setRemoveTagsText] = useState("");
  const [useFixed, setUseFixed] = useState(false);
  const [fixedValue, setFixedValue] = useState<boolean>(true);

  const subOptions = useMemo(() => {
    const list = catKind === "expense" ? categoryPresets.expense : catKind === "income" ? categoryPresets.income : categoryPresets.transfer;
    return Array.isArray(list) ? list : [];
  }, [catKind, categoryPresets]);
  // 소분류 후보: 대분류를 지정했으면 그 그룹, '유지'면 선택 지출 항목들이 한 대분류를 공유할 때만 그 그룹
  const detailOptions = useMemo(() => {
    if (catKind !== "expense") return [];
    let main = catSub === KEEP ? undefined : catSub;
    if (!main) {
      const mains = new Set(selectedEntries.filter((l) => l.kind === "expense").map(expenseMainName));
      if (mains.size === 1) main = Array.from(mains)[0];
    }
    if (!main) return [];
    return categoryPresets.expenseDetails?.find((g) => g.main === main)?.subs ?? [];
  }, [catKind, catSub, categoryPresets, selectedEntries]);

  const patch = useMemo<BulkEditPatch>(() => {
    const p: BulkEditPatch = {};
    if (useCategory) {
      const sub = catSub === KEEP ? undefined : catSub;
      let detail: string | null | undefined;
      if (catKind === "expense") {
        if (catDetail === NONE) detail = null;
        else if (catDetail === KEEP) detail = undefined;
        else detail = catDetail;
      }
      p.category = { kind: catKind, sub, detail };
    }
    if (useFrom) p.fromAccountId = fromId === NONE ? null : fromId;
    if (useTo) p.toAccountId = toId === NONE ? null : toId;
    if (useDate) {
      const d = parseInt(shiftDays, 10);
      const m = parseInt(shiftMonths, 10);
      p.dateShift = { days: Number.isFinite(d) ? d : 0, months: Number.isFinite(m) ? m : 0 };
    }
    if (useTags) {
      p.addTags = parseTagInput(addTagsText);
      p.removeTags = parseTagInput(removeTagsText);
    }
    if (useFixed) p.isFixedExpense = fixedValue;
    return p;
  }, [useCategory, catKind, catSub, catDetail, useFrom, fromId, useTo, toId, useDate, shiftDays, shiftMonths, useTags, addTagsText, removeTagsText, useFixed, fixedValue]);

  const patchEmpty = isBulkEditPatchEmpty(patch);
  const result = useMemo(
    () => (patchEmpty ? null : applyBulkEdit(ledger, patch, { selectedIds, accounts, categoryPresets })),
    [patchEmpty, ledger, patch, selectedIds, accounts, categoryPresets]
  );

  const describeChange = (c: BulkEditChange): string[] => {
    const out: string[] = [];
    const b = c.before;
    const a = c.after;
    for (const f of c.fields) {
      if (f === "category") {
        const fmt = (l: LedgerEntry) => [l.category, l.subCategory, l.detailCategory].filter(Boolean).join(" > ");
        out.push(`분류: ${fmt(b)} → ${fmt(a)}${c.promoted ? " (레거시→현행 승격)" : ""}`);
      } else if (f === "fromAccount") out.push(`출금: ${accountName(b.fromAccountId)} → ${accountName(a.fromAccountId)}`);
      else if (f === "toAccount") out.push(`입금: ${accountName(b.toAccountId)} → ${accountName(a.toAccountId)}`);
      else if (f === "date") out.push(`날짜: ${b.date} → ${a.date}`);
      else if (f === "tags") out.push(`태그: ${(b.tags ?? []).join(",") || "(없음)"} → ${(a.tags ?? []).join(",") || "(없음)"}`);
      else if (f === "fixed") out.push(`고정지출: ${b.isFixedExpense ? "예" : "아니오"} → ${a.isFixedExpense ? "예" : "아니오"}`);
    }
    return out;
  };

  const changeCount = result?.changes.length ?? 0;
  const canApply = !!result && changeCount > 0;

  const apply = () => {
    if (!result || result.changes.length === 0) {
      toast.error("적용할 변경이 없습니다.");
      return;
    }
    const n = result.changes.length;
    const warn = result.warnings.length > 0 ? `\n\n주의:\n- ${result.warnings.join("\n- ")}` : "";
    const skip = result.skipped.length > 0 ? `\n(제외 ${result.skipped.length}건은 변경되지 않습니다)` : "";
    if (!window.confirm(`선택 항목 ${n}건을 일괄 편집할까요?${skip}${warn}\n\n적용 직전 안전 스냅샷이 저장됩니다.`)) return;
    void saveSafetySnapshot(useAppStore.getState().data, `일괄 편집 ${n}건 직전 자동 스냅샷`);
    onChangeLedger(result.next);
    showBulkUndoToast(result.changes, onChangeLedger);
    onClose();
  };

  const fieldChip = (fields: BulkEditField[]) => fields.map((f) => FIELD_LABEL[f]).join("·");

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 2000 }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={trapRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-title"
        style={{ maxWidth: 860, width: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 id="bulk-edit-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>선택 {selectedEntries.length}건 일괄 편집</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              변경할 필드만 체크하세요. 종류(수입/지출/이체)·금액·통화는 바꾸지 않습니다. 정산·환전·카드결제·재테크 항목은 규칙에 따라 자동 제외됩니다.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", padding: 0, width: 28, height: 28, color: "var(--text-muted)" }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 24px", overflowY: "auto", flex: 1 }}>
          {/* 분류 */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              <input type="checkbox" checked={useCategory} onChange={(e) => setUseCategory(e.target.checked)} />
              분류 변경
            </label>
            {useCategory && (
              <div style={rowStyle}>
                {kindsPresent.length > 1 && (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    대상 종류:
                    {kindsPresent.map((k) => (
                      <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                        <input type="radio" name="bulk-cat-kind" checked={catKind === k} onChange={() => { setCatKind(k); setCatSub(KEEP); setCatDetail(KEEP); }} />
                        {KIND_LABEL[k]}
                      </label>
                    ))}
                  </span>
                )}
                {kindsPresent.length <= 1 && <span style={{ color: "var(--text-muted)" }}>{KIND_LABEL[catKind]} 항목</span>}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {catKind === "expense" ? "대분류" : "중분류"}
                  <select
                    value={catSub}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCatSub(v);
                      // 대분류를 바꾸면 소분류 '유지'는 불일치(식비>카페 → 유류교통비>카페)라 기본 '비움'
                      setCatDetail(v === KEEP ? KEEP : NONE);
                    }}
                    style={selectStyle}
                  >
                    <option value={KEEP}>(유지)</option>
                    {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {catKind === "expense" && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    소분류
                    <select value={catDetail} onChange={(e) => setCatDetail(e.target.value)} style={selectStyle}>
                      {catSub === KEEP && <option value={KEEP}>(유지)</option>}
                      <option value={NONE}>(비움)</option>
                      {detailOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                <span style={{ color: "var(--text-muted)" }}>레거시 형태 항목은 현행 3단 형태로 승격됩니다.</span>
              </div>
            )}
          </div>

          {/* 계좌 */}
          <div style={sectionStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
              <div>
                <label style={labelStyle}>
                  <input type="checkbox" checked={useFrom} onChange={(e) => setUseFrom(e.target.checked)} />
                  출금 계좌 (지출·이체)
                </label>
                {useFrom && (
                  <div style={rowStyle}>
                    <select value={fromId} onChange={(e) => setFromId(e.target.value)} style={selectStyle}>
                      <option value={NONE}>(비움)</option>
                      {selectableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label style={labelStyle}>
                  <input type="checkbox" checked={useTo} onChange={(e) => setUseTo(e.target.checked)} />
                  입금 계좌 (수입·이체)
                </label>
                {useTo && (
                  <div style={rowStyle}>
                    <select value={toId} onChange={(e) => setToId(e.target.value)} style={selectStyle}>
                      <option value={NONE}>(비움)</option>
                      {selectableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 날짜 */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              <input type="checkbox" checked={useDate} onChange={(e) => setUseDate(e.target.checked)} />
              날짜 이동
            </label>
            {useDate && (
              <div style={rowStyle}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="number" step={1} value={shiftMonths} onChange={(e) => setShiftMonths(e.target.value)} style={numStyle} aria-label="이동 개월 수" />개월
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="number" step={1} value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} style={numStyle} aria-label="이동 일 수" />일
                </label>
                <span style={{ color: "var(--text-muted)" }}>음수 = 과거로. 개월 이동은 말일 클램프(1/31 → 2/28).</span>
              </div>
            )}
          </div>

          {/* 태그 */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              <input type="checkbox" checked={useTags} onChange={(e) => setUseTags(e.target.checked)} />
              태그
            </label>
            {useTags && (
              <div style={rowStyle}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  추가
                  <input type="text" value={addTagsText} onChange={(e) => setAddTagsText(e.target.value)} placeholder="쉼표/공백 구분" style={{ fontSize: 12, padding: "4px 6px", width: 180 }} />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  제거
                  <input type="text" value={removeTagsText} onChange={(e) => setRemoveTagsText(e.target.value)} placeholder="쉼표/공백 구분" style={{ fontSize: 12, padding: "4px 6px", width: 180 }} />
                </label>
              </div>
            )}
          </div>

          {/* 고정지출 */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              <input type="checkbox" checked={useFixed} onChange={(e) => setUseFixed(e.target.checked)} />
              고정지출 플래그 (지출만)
            </label>
            {useFixed && (
              <div style={rowStyle}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                  <input type="radio" name="bulk-fixed" checked={fixedValue} onChange={() => setFixedValue(true)} /> 고정지출로
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                  <input type="radio" name="bulk-fixed" checked={!fixedValue} onChange={() => setFixedValue(false)} /> 변동지출로
                </label>
              </div>
            )}
          </div>

          {/* 미리보기 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              미리보기
              {result && (
                <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                  변경 {changeCount}건 · 제외 {result.skipped.length}건
                </span>
              )}
            </div>
            {!result && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>변경할 필드를 체크하고 값을 지정하면 전→후 미리보기가 표시됩니다.</div>
            )}
            {result && result.warnings.length > 0 && (
              <div style={{ padding: "8px 12px", background: "var(--warning-light)", border: "1px solid var(--warning)", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{w}</div>
                ))}
              </div>
            )}
            {result && (
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--surface)" }}>
                      <th style={{ textAlign: "left", padding: "6px 10px", whiteSpace: "nowrap" }}>날짜</th>
                      <th style={{ textAlign: "left", padding: "6px 10px" }}>설명</th>
                      <th style={{ textAlign: "right", padding: "6px 10px", whiteSpace: "nowrap" }}>금액</th>
                      <th style={{ textAlign: "left", padding: "6px 10px" }}>변경 (전 → 후)</th>
                      <th style={{ textAlign: "left", padding: "6px 10px" }}>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.changes.map((c) => (
                      <tr key={c.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{c.before.date}</td>
                        <td style={{ padding: "6px 10px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.before.description || "(설명 없음)"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {c.before.currency === "USD" ? `$${c.before.amount}` : formatKRW(c.before.amount)}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          {describeChange(c).map((line, i) => <div key={i}>{line}</div>)}
                        </td>
                        <td style={{ padding: "6px 10px", color: "var(--text-muted)" }}>
                          <span style={{ color: "var(--success)" }}>✓ {fieldChip(c.fields)}</span>
                          {c.partialSkips.length > 0 && (
                            <div>{Array.from(new Set(c.partialSkips.map((p) => `${FIELD_LABEL[p.field]} 제외: ${p.reason}`))).join(" / ")}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {result.skipped.map((s) => {
                      const e = ledger.find((l) => l.id === s.id);
                      return (
                        <tr key={`skip-${s.id}`} style={{ borderTop: "1px solid var(--border-light)", opacity: 0.7 }}>
                          <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{e?.date ?? "-"}</td>
                          <td style={{ padding: "6px 10px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e ? (e.description || "(설명 없음)") : s.id}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>{e ? (e.currency === "USD" ? `$${e.amount}` : formatKRW(e.amount)) : "-"}</td>
                          <td style={{ padding: "6px 10px", color: "var(--text-muted)" }}>—</td>
                          <td style={{ padding: "6px 10px", color: "var(--danger)" }}>제외: {s.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            적용 직전 안전 스냅샷 저장 · 적용 후 토스트 [되돌리기] 또는 Ctrl+Z 1회로 복원
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary" onClick={onClose} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <X size={14} /> 닫기
            </button>
            <button
              type="button"
              className="primary"
              onClick={apply}
              disabled={!canApply}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, opacity: canApply ? 1 : 0.5, cursor: canApply ? "pointer" : "not-allowed" }}
            >
              <Check size={14} /> {changeCount > 0 ? `${changeCount}건 적용` : "적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
