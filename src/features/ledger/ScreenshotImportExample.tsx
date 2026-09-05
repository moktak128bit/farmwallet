/**
 * [예시 페이지] 은행 스크린샷 → 가계부 일괄 가져오기 — 프로토타입 (기획 확인용, 실제 저장 없음).
 *
 * 실제 기능 구상: 사용자가 은행 앱 거래내역 스크린샷(여러 장)을 올리면 OCR로 날짜·내용·금액·입출금·
 * (화면 상단의 은행/카드사 표기로) 계좌까지 추출해 이 화면 같은 검토 표를 보여준다. 분류(중분류·
 * 소분류)와 계좌 모두 이미지만으로 신뢰하게 추론하기 어려운 경우가 있으므로, 확신이 낮은 셀은
 * 노란색(--warning-bg)으로 표시해 사용자가 직접 골라야 함을 명확히 한다.
 *  - 분류: utils/categoryRecommendation.recommendCategory 점수(과거 가계부 상호 유사도) 기준
 *  - 계좌: 스크린샷에서 읽힌 은행/카드사 문구를 Account.institution/name과 매칭 — 정확히 하나만
 *    매칭되면 자동 채움, 매칭이 없거나 여러 계좌와 동시에 겹치면 노란색
 *
 * 이 프로토타입은 OCR 대신 가짜(mock) 인식 결과를 사용하고, [적용]은 실제 가계부에 저장하지 않는다
 * (실 데이터 오염 방지) — 검토/분류 UX만 확인하는 단계.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, CategoryPresets, LedgerEntry, LedgerKind } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";
import { formatKRW } from "../../utils/formatter";
import { recommendCategory } from "../../utils/categoryRecommendation";

interface Props {
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  accounts: Account[];
  onClose: () => void;
}

interface MockRow {
  id: string;
  sourceLabel: string;
  /** 스크린샷 상단에서 읽혔다고 가정한 은행/카드사 표기 — 계좌 매칭용 */
  accountHint: string;
  date: string;
  direction: "출금" | "입금";
  description: string;
  amount: number;
}

const CONFIDENCE_THRESHOLD = 0.5;

const normalizeForMatch = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** hint(스크린샷에서 읽힌 은행/계좌 표기)와 정확히 하나의 계좌만 겹치면 그 계좌, 아니면(0개·2개 이상) null */
function matchAccountByHint(hint: string, accounts: Account[]): Account | null {
  const h = normalizeForMatch(hint);
  if (!h) return null;
  const candidates = accounts.filter((a) => {
    const inst = normalizeForMatch(a.institution || "");
    const name = normalizeForMatch(a.name || "");
    return (!!inst && (h.includes(inst) || inst.includes(h))) || (!!name && (h.includes(name) || name.includes(h)));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

interface RowState {
  included: boolean;
  subCategory: string;
  detailCategory: string;
  confidentCategory: boolean;
  accountId: string;
  confidentAccount: boolean;
}

export const ScreenshotImportExample: React.FC<Props> = ({ ledger, categoryPresets, accounts, onClose }) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  // 데모용 힌트 — 실제로는 각 스크린샷 상단에서 OCR로 읽힐 은행/카드사 문구.
  // 스크린샷 1은 실제 등록된 계좌 중 하나와 일부러 맞춰(자동 인식 데모), 스크린샷 2는 등록되지
  // 않은 은행명으로 일부러 어긋나게(수동 선택 필요 데모) 구성한다.
  const mockRows: MockRow[] = useMemo(() => {
    const knownInstitution = activeAccounts.find((a) => a.institution)?.institution ?? "";
    const hint1 = knownInstitution ? `${knownInstitution} 입출금내역` : "은행 입출금내역";
    const hint2 = "미등록저축은행 거래내역";
    return [
      { id: "m1", sourceLabel: "스크린샷 1", accountHint: hint1, date: "2026-08-30", direction: "출금", description: "스타벅스 강남역점", amount: 5600 },
      { id: "m2", sourceLabel: "스크린샷 1", accountHint: hint1, date: "2026-08-30", direction: "출금", description: "GS25 서초점", amount: 12400 },
      { id: "m3", sourceLabel: "스크린샷 1", accountHint: hint1, date: "2026-08-31", direction: "출금", description: "쿠팡", amount: 34900 },
      { id: "m4", sourceLabel: "스크린샷 1", accountHint: hint1, date: "2026-08-31", direction: "입금", description: "급여", amount: 3200000 },
      { id: "m5", sourceLabel: "스크린샷 2", accountHint: hint2, date: "2026-09-01", direction: "출금", description: "이디야커피", amount: 4500 },
      { id: "m6", sourceLabel: "스크린샷 2", accountHint: hint2, date: "2026-09-01", direction: "출금", description: "OO필라테스 회원권", amount: 150000 },
      { id: "m7", sourceLabel: "스크린샷 2", accountHint: hint2, date: "2026-09-01", direction: "출금", description: "번개장터", amount: 25000 },
    ];
  }, [activeAccounts]);

  const analyzed = useMemo(
    () =>
      mockRows.map((row) => {
        const kind: LedgerKind = row.direction === "입금" ? "income" : "expense";
        const recs = recommendCategory(row.description, row.amount, kind, ledger);
        const top = recs[0];
        const confidentCategory = !!top && top.score >= CONFIDENCE_THRESHOLD;
        const matchedAccount = matchAccountByHint(row.accountHint, activeAccounts);
        return { row, kind, top, confidentCategory, matchedAccount };
      }),
    [mockRows, ledger, activeAccounts]
  );

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  // mockRows는 activeAccounts가 바뀔 때만 재계산되므로, 그 시점에 맞춰 상태도 다시 초기화한다.
  useEffect(() => {
    const init: Record<string, RowState> = {};
    for (const { row, top, confidentCategory, matchedAccount } of analyzed) {
      init[row.id] = {
        included: true,
        subCategory: confidentCategory ? top?.subCategory ?? "" : "",
        detailCategory: confidentCategory ? top?.detailCategory ?? "" : "",
        confidentCategory,
        accountId: matchedAccount?.id ?? "",
        confidentAccount: !!matchedAccount,
      };
    }
    setRowState(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockRows]);

  useEffect(() => {
    if (!isTopModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTopModal, onClose]);

  const expenseMains = categoryPresets.expense ?? [];
  const incomeMains = categoryPresets.income ?? [];
  const detailsFor = (main: string) =>
    categoryPresets.expenseDetails?.find((g) => g.main === main)?.subs ?? [];

  const setSub = (id: string, value: string) =>
    setRowState((prev) => ({
      ...prev,
      [id]: { ...prev[id], subCategory: value, detailCategory: "", confidentCategory: value !== "" },
    }));
  const setDetail = (id: string, value: string) =>
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], detailCategory: value } }));
  const setAccount = (id: string, value: string) =>
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], accountId: value, confidentAccount: value !== "" } }));
  const toggleIncluded = (id: string) =>
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], included: !prev[id].included } }));

  const includedRows = analyzed.filter(({ row }) => rowState[row.id]?.included);
  const includedCount = includedRows.length;
  const categoryReviewCount = includedRows.filter(({ row }) => !rowState[row.id]?.subCategory).length;
  const accountReviewCount = includedRows.filter(({ row }) => !rowState[row.id]?.accountId).length;
  const needsReviewCount = analyzed.filter(({ row }) => {
    const st = rowState[row.id];
    return st?.included && (!st.subCategory || !st.accountId);
  }).length;

  const handleApplyPreview = () => {
    if (needsReviewCount > 0) {
      const parts: string[] = [];
      if (categoryReviewCount > 0) parts.push(`분류 ${categoryReviewCount}건`);
      if (accountReviewCount > 0) parts.push(`계좌 ${accountReviewCount}건`);
      toast.error(`${parts.join(", ")}이 비어 있습니다. 노란색 항목을 먼저 선택하세요.`);
      return;
    }
    if (includedCount === 0) {
      toast.error("포함할 항목이 없습니다.");
      return;
    }
    toast.success(
      `(예시) 이 ${includedCount}건이 가계부에 추가됩니다. 실제 저장 기능은 다음 단계에서 연결합니다.`,
      { duration: 5000 }
    );
  };

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
        aria-labelledby="screenshot-import-title"
        style={{ maxWidth: 980, width: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 id="screenshot-import-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              📷 은행 스크린샷 가져오기 <span style={{ fontSize: 12, fontWeight: 500, color: "var(--warning)" }}>(예시 페이지)</span>
            </h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, maxWidth: 700 }}>
              은행 앱 거래내역 스크린샷을 올리면 날짜·내용·금액과, 화면 상단의 은행/카드사 표기로 계좌까지
              자동 인식해 아래처럼 검토 표를 만듭니다. 분류(중분류·소분류)와 계좌 모두 이미지만으로
              확신하기 어려운 경우가 있어,{" "}
              <strong style={{ color: "var(--warning)" }}>노란색으로 표시된 항목은 직접 선택</strong>해야 합니다.
              지금은 실제 OCR 대신 가짜 인식 결과로 화면 흐름만 확인합니다 — [적용]을 눌러도 실제로 저장되지 않습니다.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-light)" }}>
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "not-allowed",
              padding: "8px 14px", border: "1px dashed var(--border)", borderRadius: 6, color: "var(--text-muted)",
            }}
            title="예시 페이지 — 실제 이미지 업로드는 다음 단계에서 연결합니다"
          >
            🖼️ 스크린샷 여러 장 선택 (예시 — 아래는 이미 인식됐다고 가정한 결과)
            <input type="file" accept="image/*" multiple disabled style={{ display: "none" }} />
          </label>
        </div>

        <div style={{ overflow: "auto", padding: "10px 24px 20px" }}>
          <div style={{ fontSize: 13, marginBottom: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>전체 {analyzed.length}건 중 포함 <strong>{includedCount}건</strong></span>
            {needsReviewCount > 0 ? (
              <span style={{ color: "var(--warning)" }}>
                ⚠ 확인 필요 {needsReviewCount}건
                {(categoryReviewCount > 0 || accountReviewCount > 0) && (
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}(분류 {categoryReviewCount}·계좌 {accountReviewCount})
                  </span>
                )}
              </span>
            ) : (
              <span style={{ color: "var(--success)" }}>✓ 모든 포함 항목의 분류·계좌가 채워졌습니다</span>
            )}
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  <th style={{ padding: "6px 8px" }}></th>
                  <th style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>출처</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}>날짜</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>내용</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" }}>금액</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>계좌</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>분류</th>
                </tr>
              </thead>
              <tbody>
                {analyzed.map(({ row, kind, confidentCategory }) => {
                  const st = rowState[row.id];
                  if (!st) return null;
                  const isUnconfirmedCategory = !st.subCategory;
                  const isUnconfirmedAccount = !st.accountId;
                  const mains = kind === "expense" ? expenseMains : incomeMains;
                  const details = kind === "expense" ? detailsFor(st.subCategory) : [];
                  return (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--border-light)", opacity: st.included ? 1 : 0.5 }}>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <input type="checkbox" checked={st.included} onChange={() => toggleIncluded(row.id)} />
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
                        {row.sourceLabel}
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }} title="스크린샷에서 인식된 은행/카드사 표기(가정)">
                          &quot;{row.accountHint}&quot;
                        </div>
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--text-muted)" }}>{row.date}</td>
                      <td style={{ padding: "6px 8px" }}>{row.description}</td>
                      <td
                        style={{
                          padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap",
                          color: row.direction === "입금" ? "var(--chart-income)" : "var(--chart-expense)",
                        }}
                      >
                        {row.direction === "입금" ? "+" : "-"}{formatKRW(row.amount)}
                      </td>
                      <td style={{ padding: "6px 8px", minWidth: 130, background: isUnconfirmedAccount ? "var(--warning-bg)" : "transparent", borderRadius: 4 }}>
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                          <select
                            value={st.accountId}
                            disabled={!st.included}
                            onChange={(e) => setAccount(row.id, e.target.value)}
                            style={{ fontSize: 11, padding: "2px 4px", maxWidth: 110 }}
                          >
                            <option value="">선택 필요</option>
                            {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                          {isUnconfirmedAccount ? (
                            <span style={{ fontSize: 10, color: "var(--warning)", whiteSpace: "nowrap" }} title="계좌 표기를 등록된 계좌와 확실히 매칭하지 못했습니다">
                              ⚠ 확인 필요
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "var(--success)", whiteSpace: "nowrap" }} title="은행/카드사 표기가 등록된 계좌와 일치해 자동으로 채웠습니다">
                              자동 인식
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", minWidth: 210, background: isUnconfirmedCategory ? "var(--warning-bg)" : "transparent", borderRadius: 4 }}>
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                          <select
                            value={st.subCategory}
                            disabled={!st.included}
                            onChange={(e) => setSub(row.id, e.target.value)}
                            style={{ fontSize: 11, padding: "2px 4px", maxWidth: 110 }}
                          >
                            <option value="">선택 필요</option>
                            {mains.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          {kind === "expense" && st.subCategory && details.length > 0 && (
                            <select
                              value={st.detailCategory}
                              disabled={!st.included}
                              onChange={(e) => setDetail(row.id, e.target.value)}
                              style={{ fontSize: 11, padding: "2px 4px", maxWidth: 90 }}
                            >
                              <option value="">(소분류 없음)</option>
                              {details.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          )}
                          {isUnconfirmedCategory ? (
                            <span style={{ fontSize: 10, color: "var(--warning)", whiteSpace: "nowrap" }} title="자동 분류를 확신하지 못했습니다">
                              ⚠ 확인 필요
                            </span>
                          ) : !confidentCategory ? (
                            <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }} title="자동 추천이 낮은 확신도라 직접 채웠습니다">
                              직접 선택됨
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "var(--success)", whiteSpace: "nowrap" }} title="과거 기록과 유사해 자동으로 채웠습니다">
                              자동 인식
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary" onClick={onClose}>닫기</button>
            <button type="button" className="primary" onClick={handleApplyPreview}>
              {includedCount > 0 ? `${includedCount}건 적용 (예시)` : "적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
