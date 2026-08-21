/**
 * 카드 명세 CSV/붙여넣기 임포트 카드 (SettingsPage 백업 탭 등록).
 * 1차 범위: 카드 계좌(AccountType "card") 명세만 — kind는 항상 "expense"로 고정한다.
 * 은행 명세(입금액/출금액/거래후잔액 있고 가맹점 열 없음)는 '출금→지출' 일괄 매핑이
 * 카드결제이체·저축/투자이체 transfer 체계와 충돌해 집계를 부풀리므로 감지해 차단한다.
 *
 * 흐름: 붙여넣기/파일 → 구분자·헤더 자동 인식 → 컬럼 매핑(자동 감지 + 수정, 마지막 매핑은
 * localStorage에 헤더명 기준으로 저장돼 다음 붙여넣기에도 재사용) → 미리보기(포함 체크·중복
 * 기본 제외·분류 인라인 수정) → [적용]: window.confirm + saveSafetySnapshot → onChangeData 1회
 * (단일 undo) → 토스트로 이번 임포트 전부 되돌리기(restore-by-ids) → runIntegrityCheck 요약.
 * 기본은 dry-run — [적용]을 누르기 전까지 아무 것도 저장되지 않는다.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { AlertTriangle, Upload } from "lucide-react";
import type { AppData, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { getKoreaTime } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { useAppStore } from "../../store/appStore";
import { saveSafetySnapshot } from "../../services/backupService";
import { runIntegrityCheck } from "../../utils/dataIntegrity";
import { useFxRateValue } from "../../context/FxRateContext";
import {
  BANK_STATEMENT_BLOCK_MESSAGE,
  detectColumnMapping,
  parseDelimited,
  type ColumnMapping,
} from "../../utils/statementImport/parseDelimited";
import {
  buildImportPreview,
  finalizeImportRows,
  type ImportPreviewRow,
  type ImportRowStatus,
} from "../../utils/statementImport/buildImportPreview";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

type Role = "date" | "amount" | "merchant" | "installment" | "status" | "currency";
const ROLE_TO_COL: Record<Role, keyof ColumnMapping> = {
  date: "dateCol",
  amount: "amountCol",
  merchant: "merchantCol",
  installment: "installmentCol",
  status: "statusCol",
  currency: "currencyCol",
};
const ROLE_LABEL: Record<Role, string> = {
  date: "날짜(이용일)",
  amount: "금액",
  merchant: "가맹점/내용",
  installment: "할부(선택)",
  status: "취소/환불 구분(선택)",
  currency: "통화(선택)",
};
const REQUIRED_ROLES: Role[] = ["date", "amount", "merchant"];
const OPTIONAL_ROLES: Role[] = ["installment", "status", "currency"];

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  new: "신규",
  "duplicate-exact": "중복(완전일치)",
  "duplicate-probable": "중복 추정",
  invalid: "제외",
};
const STATUS_COLOR: Record<ImportRowStatus, string> = {
  new: "var(--success)",
  "duplicate-exact": "var(--text-muted)",
  "duplicate-probable": "var(--warning)",
  invalid: "var(--danger)",
};

type SavedHeaderMapping = Partial<Record<Role, string>>;

function loadSavedMapping(): SavedHeaderMapping {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STATEMENT_IMPORT_MAPPING);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SavedHeaderMapping) : {};
  } catch {
    return {};
  }
}

function persistMapping(headers: string[], mapping: Partial<ColumnMapping>): void {
  try {
    const out: SavedHeaderMapping = {};
    (Object.keys(ROLE_TO_COL) as Role[]).forEach((role) => {
      const col = mapping[ROLE_TO_COL[role]];
      if (typeof col === "number" && headers[col] != null) out[role] = headers[col];
    });
    localStorage.setItem(STORAGE_KEYS.STATEMENT_IMPORT_MAPPING, JSON.stringify(out));
  } catch {
    /* 저장 실패해도 이번 세션 매핑은 유지됨 */
  }
}

/** "import:YYYY-MM-DD-HHmm" (KST) — 일괄 되돌리기 토스트와 적용 항목 태그가 공유하는 배치 식별자 */
function buildImportTag(): string {
  const k = getKoreaTime();
  const y = k.getFullYear();
  const mo = String(k.getMonth() + 1).padStart(2, "0");
  const d = String(k.getDate()).padStart(2, "0");
  const hh = String(k.getHours()).padStart(2, "0");
  const mm = String(k.getMinutes()).padStart(2, "0");
  return `import:${y}-${mo}-${d}-${hh}${mm}`;
}

/** 적용 직후 토스트 [이번 임포트 전부 되돌리기] — 방금 부여한 id들을 현재 가계부에서 제거(restore-by-ids). */
function showImportUndoToast(count: number, ids: string[], onChangeData: (next: AppData) => void): void {
  let handled = false;
  const idSet = new Set(ids);
  toast.success(
    (t) => (
      <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>명세 임포트 {count}건 완료</span>
        <button
          type="button"
          className="primary"
          style={{ padding: "6px 14px", fontSize: 13, flexShrink: 0 }}
          onClick={() => {
            if (handled) return;
            handled = true;
            toast.dismiss(t.id);
            const state = useAppStore.getState();
            const curLedger = state.data.ledger ?? [];
            const nextLedger = curLedger.filter((l) => !idSet.has(l.id));
            const removed = curLedger.length - nextLedger.length;
            if (removed > 0) {
              onChangeData({ ...state.data, ledger: nextLedger });
              toast.success(`이번 임포트 ${removed}건을 되돌렸습니다.`, { id: "statement-import-undo-result" });
            } else {
              toast.error("이미 되돌렸거나 데이터가 변경되어 되돌릴 수 없습니다.", { id: "statement-import-undo-result" });
            }
          }}
        >
          이번 임포트 전부 되돌리기
        </button>
      </span>
    ),
    { duration: 9000 }
  );
}

export const StatementImportCard: React.FC<Props> = React.memo(function StatementImportCard({ data, onChangeData }) {
  const [text, setText] = useState("");
  const [cardAccountId, setCardAccountId] = useState("");
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [includedOverride, setIncludedOverride] = useState<Record<number, boolean>>({});
  const [categoryOverride, setCategoryOverride] = useState<Record<number, { subCategory: string; detailCategory?: string }>>({});

  const fxRate = useFxRateValue();
  const cardAccounts = useMemo(
    () => data.accounts.filter((a) => a.type === "card" && !a.archived),
    [data.accounts]
  );

  const parsedTable = useMemo(() => parseDelimited(text), [text]);
  const detected = useMemo(() => detectColumnMapping(parsedTable.headers), [parsedTable.headers]);

  // 새 붙여넣기/파일마다 매핑 자동 재감지 + 저장된 헤더명 매핑 재적용 + 행별 수동 오버라이드 초기화
  useEffect(() => {
    if (parsedTable.headers.length === 0) {
      setMapping({});
      setIncludedOverride({});
      setCategoryOverride({});
      return;
    }
    const auto = detectColumnMapping(parsedTable.headers);
    const saved = loadSavedMapping();
    const resolved: Partial<ColumnMapping> = { ...auto };
    (Object.keys(ROLE_TO_COL) as Role[]).forEach((role) => {
      const headerName = saved[role];
      if (headerName) {
        const idx = parsedTable.headers.indexOf(headerName);
        if (idx >= 0) resolved[ROLE_TO_COL[role]] = idx;
      }
    });
    setMapping(resolved);
    setIncludedOverride({});
    setCategoryOverride({});
  }, [parsedTable]);

  const setRoleCol = useCallback(
    (role: Role, value: string) => {
      const colKey = ROLE_TO_COL[role];
      setMapping((prev) => {
        const next = { ...prev };
        if (value === "") delete next[colKey];
        else next[colKey] = Number(value);
        persistMapping(parsedTable.headers, next);
        return next;
      });
    },
    [parsedTable.headers]
  );

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => toast.error("파일을 읽는 중 오류가 발생했습니다.");
    reader.readAsText(file, "utf-8");
  }, []);

  const mappingComplete =
    mapping.dateCol != null && mapping.amountCol != null && mapping.merchantCol != null;

  const previewRows: ImportPreviewRow[] = useMemo(() => {
    if (!mappingComplete || !cardAccountId || detected.isBankStatement) return [];
    return buildImportPreview(parsedTable.rows, mapping as ColumnMapping, {
      cardAccountId,
      ledger: data.ledger,
      fxRate,
    });
  }, [mappingComplete, cardAccountId, detected.isBankStatement, parsedTable.rows, mapping, data.ledger, fxRate]);

  const displayRows = useMemo(
    () =>
      previewRows.map((r) => ({
        ...r,
        included: includedOverride[r.rowIndex] ?? r.included,
        categoryOverride: categoryOverride[r.rowIndex],
      })),
    [previewRows, includedOverride, categoryOverride]
  );

  const includedCount = displayRows.filter((r) => r.included && r.draft).length;
  const includedSumKrw = displayRows
    .filter((r) => r.included && r.draft && r.draft.currency !== "USD")
    .reduce((s, r) => s + (r.draft?.amount ?? 0), 0);
  const includedUsdCount = displayRows.filter((r) => r.included && r.draft?.currency === "USD").length;

  const apply = useCallback(() => {
    if (includedCount === 0) {
      toast.error("포함할 항목이 없습니다. 체크박스를 확인하세요.");
      return;
    }
    if (!cardAccountId) {
      toast.error("카드 계좌를 선택하세요.");
      return;
    }
    const dupIncluded = displayRows.filter((r) => r.included && r.status !== "new").length;
    const warn = dupIncluded > 0 ? `\n(중복으로 표시된 ${dupIncluded}건이 포함돼 있습니다)` : "";
    if (
      !window.confirm(
        `카드 명세 ${includedCount}건을 가계부 지출로 추가할까요?${warn}\n\n적용 직전 안전 스냅샷이 저장됩니다.`
      )
    ) {
      return;
    }

    const rowsForFinalize: ImportPreviewRow[] = displayRows.map((r) => {
      if (!r.included || !r.draft) return { ...r, included: false };
      const ov = categoryOverride[r.rowIndex];
      if (!ov) return { ...r, included: true };
      const draft = { ...r.draft, subCategory: ov.subCategory };
      if (ov.detailCategory) draft.detailCategory = ov.detailCategory;
      else delete draft.detailCategory;
      return { ...r, included: true, draft };
    });

    const importTag = buildImportTag();
    const newEntries: LedgerEntry[] = finalizeImportRows(rowsForFinalize, importTag);
    if (newEntries.length === 0) {
      toast.error("포함할 항목이 없습니다.");
      return;
    }

    void saveSafetySnapshot(data, `명세 임포트 ${newEntries.length}건 직전 자동 스냅샷`);
    const next: AppData = { ...data, ledger: [...data.ledger, ...newEntries] };
    onChangeData(next);

    showImportUndoToast(newEntries.length, newEntries.map((e) => e.id), onChangeData);

    const issues = runIntegrityCheck(next.accounts, next.ledger, next.trades, next.categoryPresets);
    if (issues.length > 0) {
      toast(`무결성 검사: ${issues.length}건 확인이 필요합니다 (설정 > 데이터 무결성 탭 참고).`, { icon: "⚠️" });
    } else {
      toast.success("무결성 검사: 새로 발견된 이슈가 없습니다.");
    }

    setText("");
    setMapping({});
    setIncludedOverride({});
    setCategoryOverride({});
  }, [includedCount, cardAccountId, displayRows, categoryOverride, data, onChangeData]);

  const expenseMains = data.categoryPresets.expense ?? [];
  const detailsFor = useCallback(
    (main: string) => data.categoryPresets.expenseDetails?.find((g) => g.main === main)?.subs ?? [],
    [data.categoryPresets.expenseDetails]
  );

  return (
    <div className="card">
      <div className="card-title">카드 명세 가져오기</div>
      <p className="hint" style={{ marginBottom: 10 }}>
        카드 계좌 명세(CSV/TSV 또는 붙여넣기)를 가계부 지출로 가져옵니다. 1차 범위는{" "}
        <strong>카드 계좌 명세만</strong> 지원합니다 — 은행 명세의 &apos;출금→지출&apos; 일괄 매핑은
        카드결제이체·저축/투자이체 이체 체계와 충돌해 자동으로 차단됩니다.{" "}
        <strong>[적용]을 누르기 전까지는 아무것도 저장되지 않습니다.</strong>
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          카드 계좌 (필수)
          <select value={cardAccountId} onChange={(e) => setCardAccountId(e.target.value)} style={{ fontSize: 13, padding: "5px 6px" }}>
            <option value="">(선택)</option>
            {cardAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer",
            padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)",
          }}
        >
          <Upload size={14} />
          파일 선택 (.csv/.txt)
          <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {cardAccounts.length === 0 && (
        <p className="hint" style={{ color: "var(--warning)" }}>카드 계좌가 없습니다. 계좌 탭에서 카드 계좌를 먼저 등록하세요.</p>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"명세를 여기 붙여넣으세요 (헤더 포함, 예: 이용일자,가맹점명,이용금액)"}
        rows={6}
        style={{
          width: "100%", fontFamily: "monospace", fontSize: 12, padding: 8,
          border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)",
        }}
      />

      {text.trim().length > 0 && parsedTable.headers.length === 0 && (
        <p className="error-text">표 형식을 인식할 수 없습니다. 헤더 행이 포함된 CSV/TSV/붙여넣기인지 확인하세요.</p>
      )}

      {parsedTable.headers.length > 0 && detected.isBankStatement && (
        <div
          style={{
            display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", marginTop: 10,
            background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: 6, fontSize: 12,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{BANK_STATEMENT_BLOCK_MESSAGE}</span>
        </div>
      )}

      {parsedTable.headers.length > 0 && !detected.isBankStatement && (
        <>
          <div style={{ marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: 700 }}>컬럼 매핑</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            {[...REQUIRED_ROLES, ...OPTIONAL_ROLES].map((role) => {
              const colKey = ROLE_TO_COL[role];
              const value = mapping[colKey];
              return (
                <label key={role} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                  {ROLE_LABEL[role]}
                  <select
                    value={value ?? ""}
                    onChange={(e) => setRoleCol(role, e.target.value)}
                    style={{ fontSize: 12, padding: "4px 6px", maxWidth: 180 }}
                  >
                    <option value="">{OPTIONAL_ROLES.includes(role) ? "(없음)" : "(선택)"}</option>
                    {parsedTable.headers.map((h, i) => (
                      <option key={i} value={i}>{h || `(열 ${i + 1})`}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          {!mappingComplete && (
            <p className="hint">날짜·금액·가맹점/내용 열을 모두 지정하면 미리보기가 표시됩니다.</p>
          )}

          {mappingComplete && !cardAccountId && (
            <p className="error-text">카드 계좌를 선택하면 미리보기가 표시됩니다.</p>
          )}

          {mappingComplete && cardAccountId && displayRows.length === 0 && (
            <p className="hint">가져올 데이터 행이 없습니다.</p>
          )}

          {mappingComplete && cardAccountId && displayRows.length > 0 && (
            <>
              <div style={{ fontSize: 13, marginTop: 10, marginBottom: 6 }}>
                전체 {displayRows.length}건 중 포함 <strong>{includedCount}건</strong> · 합계{" "}
                <strong>{formatKRW(includedSumKrw)}</strong>
                {includedUsdCount > 0 && <span style={{ color: "var(--text-muted)" }}> (USD {includedUsdCount}건 별도)</span>}
              </div>
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--surface)" }}>
                      <th style={{ padding: "6px 8px" }}></th>
                      <th style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>날짜</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>가맹점/내용</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" }}>금액</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>분류</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => {
                      const main = r.categoryOverride?.subCategory ?? r.draft?.subCategory ?? "";
                      const detail = r.categoryOverride?.detailCategory ?? r.draft?.detailCategory ?? "";
                      return (
                        <tr key={r.rowIndex} style={{ borderTop: "1px solid var(--border-light)", opacity: r.draft ? 1 : 0.6 }}>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              disabled={!r.draft}
                              checked={r.included}
                              onChange={(e) =>
                                setIncludedOverride((prev) => ({ ...prev, [r.rowIndex]: e.target.checked }))
                              }
                            />
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{r.preview.date}</td>
                          <td style={{ padding: "6px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(r.draft?.description ?? r.preview.description) || "(내용 없음)"}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                            {r.draft?.currency === "USD" ? `$${r.preview.amount}` : formatKRW(r.preview.amount)}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {r.draft ? (
                              <span style={{ display: "inline-flex", gap: 4 }}>
                                <select
                                  value={main}
                                  disabled={!r.included}
                                  onChange={(e) =>
                                    setCategoryOverride((prev) => ({
                                      ...prev,
                                      [r.rowIndex]: { subCategory: e.target.value, detailCategory: undefined },
                                    }))
                                  }
                                  style={{ fontSize: 11, padding: "2px 4px", maxWidth: 100 }}
                                >
                                  <option value={main}>{main || "(미분류)"}</option>
                                  {expenseMains.filter((m) => m !== main).map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                                {detailsFor(main).length > 0 && (
                                  <select
                                    value={detail}
                                    disabled={!r.included}
                                    onChange={(e) =>
                                      setCategoryOverride((prev) => ({
                                        ...prev,
                                        [r.rowIndex]: { subCategory: main, detailCategory: e.target.value || undefined },
                                      }))
                                    }
                                    style={{ fontSize: 11, padding: "2px 4px", maxWidth: 90 }}
                                  >
                                    <option value="">(소분류 없음)</option>
                                    {detailsFor(main).map((s) => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                            <span style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                            {r.reason && <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{r.reason}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="primary" onClick={apply} disabled={includedCount === 0}>
                  {includedCount > 0 ? `${includedCount}건 적용` : "적용"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
});
