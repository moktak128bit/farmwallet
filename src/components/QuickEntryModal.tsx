import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import type { Account, AppData, LedgerEntry, LedgerKind } from "../types";
import { recommendCategory } from "../utils/categoryRecommendation";
import { parseAmount } from "../utils/parseAmount";
import { getTodayKST } from "../utils/date";
import { newIdWithPrefix } from "../utils/id";

interface Props {
  open: boolean;
  onClose: () => void;
  data: AppData;
  onAdd: (entry: LedgerEntry) => void;
}

// 테스트에서 직접 검증할 수 있도록 export (UI와 분리된 순수 함수)
export const parseQuickInput = (text: string): { description: string; amount: number; kind: LedgerKind } => {
  const trimmed = text.trim();
  let kind: LedgerKind = "expense";
  let body = trimmed;
  if (/^수입\s+/.test(trimmed)) { kind = "income"; body = trimmed.replace(/^수입\s+/, ""); }
  else if (/^이체\s+/.test(trimmed)) { kind = "transfer"; body = trimmed.replace(/^이체\s+/, ""); }
  else if (/^지출\s+/.test(trimmed)) { kind = "expense"; body = trimmed.replace(/^지출\s+/, ""); }

  // 금액 파싱: "원"이 붙은 토큰 우선, 없으면 마지막 숫자 토큰.
  // 첫 숫자를 잡으면 "GS25 떡볶이 3000"에서 25를 금액으로 오인하던 문제 방지.
  // 콤마 그룹 패턴(\d{1,3}(?:,\d{3})+)을 앞에 두되 콤마 없는 수는 \d+로 전체 매칭
  // (기존 `\d{1,3}(?:,\d{3})*` 우선 패턴은 "3000"에서 "300"만 매칭하던 결함).
  // 공용 parseAmount 사용 (양수만 허용, NaN/과학표기 방어)
  const matches = Array.from(body.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(\s*원)?/g));
  const amountMatch = matches.find((m) => m[2]) ?? matches[matches.length - 1];
  const amount = amountMatch ? parseAmount(amountMatch[1]) : 0;
  const description = amountMatch
    ? (body.slice(0, amountMatch.index ?? 0) + body.slice((amountMatch.index ?? 0) + amountMatch[0].length)).trim()
    : body.trim();
  return { description, amount, kind };
};

/** 추천이 없을 때 폼 저장 경로와 동일한 대분류 (category="" 저장 방지) */
const fallbackCategoryOf = (kind: LedgerKind): string =>
  kind === "income" ? "수입" : kind === "transfer" ? "이체" : "지출";

export const QuickEntryModal: React.FC<Props> = ({ open, onClose, data, onAdd }) => {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const parsed = useMemo(() => parseQuickInput(text), [text]);

  const recommendation = useMemo(() => {
    if (!parsed.description || parsed.amount <= 0) return null;
    const recs = recommendCategory(parsed.description, parsed.amount, parsed.kind, data.ledger);
    return recs[0] ?? null;
  }, [parsed, data.ledger]);

  const defaultAccount: Account | undefined = useMemo(() => {
    return data.accounts.find((a) => a.id === recommendation?.fromAccountId)
      ?? data.accounts.find((a) => a.type === "checking")
      ?? data.accounts[0];
  }, [data.accounts, recommendation]);

  const submit = () => {
    if (!parsed.description || parsed.amount <= 0) return;

    // 계좌 결정 — 이체는 출금·입금 둘 다 필요. 빠른 입력으로 입금 계좌를 정할 수 없으면 거부.
    let fromAccountId: string | undefined;
    let toAccountId: string | undefined;
    if (parsed.kind === "income") {
      toAccountId = defaultAccount?.id;
    } else if (parsed.kind === "transfer") {
      fromAccountId = recommendation?.fromAccountId ?? defaultAccount?.id;
      toAccountId = recommendation?.toAccountId;
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        toast.error("이체는 입금 계좌를 정할 수 없어 빠른 입력으로 추가할 수 없습니다. 가계부 폼에서 입력해주세요.");
        return;
      }
    } else {
      fromAccountId = defaultAccount?.id;
    }

    const entry: LedgerEntry = {
      id: newIdWithPrefix("L"),
      date: getTodayKST(),
      kind: parsed.kind,
      // 추천이 없으면 폼 저장 경로와 동일한 스키마로 저장 (category="" 방지)
      category: recommendation?.category || fallbackCategoryOf(parsed.kind),
      subCategory: recommendation?.subCategory || "(미분류)",
      description: parsed.description,
      amount: parsed.amount,
      fromAccountId,
      toAccountId
    };
    onAdd(entry);
    onClose();
  };

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "20vh", zIndex: 9999
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", color: "var(--text)",
          padding: 16, borderRadius: 12, width: "min(560px, 92vw)",
          boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)"
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          빠른 입력 — 예: "스타벅스 5500", "수입 월급 3000000"
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="설명과 금액을 한 줄로 입력 후 Enter"
          style={{
            width: "100%", padding: "10px 12px", fontSize: 16,
            border: "1px solid var(--border)", borderRadius: 8,
            background: "var(--bg)", color: "var(--text)"
          }}
        />
        {parsed.description && parsed.amount > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
            <div><strong>{parsed.kind === "income" ? "수입" : parsed.kind === "transfer" ? "이체" : "지출"}</strong>: {parsed.description}</div>
            <div>금액: {parsed.amount.toLocaleString()}원</div>
            <div>카테고리: {recommendation?.category || fallbackCategoryOf(parsed.kind)} › {recommendation?.subCategory || "(미분류)"}</div>
            <div>계좌: {defaultAccount?.name ?? "(없음)"}</div>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" className="primary" onClick={submit} disabled={!parsed.description || parsed.amount <= 0}>
            입력 (Enter)
          </button>
        </div>
      </div>
    </div>
  );
};
