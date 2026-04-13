import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Account, AppData, LedgerEntry, LedgerKind } from "../types";
import { recommendCategory } from "../utils/categoryRecommendation";

interface Props {
  open: boolean;
  onClose: () => void;
  data: AppData;
  onAdd: (entry: LedgerEntry) => void;
}

const parseQuickInput = (text: string): { description: string; amount: number; kind: LedgerKind } => {
  const trimmed = text.trim();
  let kind: LedgerKind = "expense";
  let body = trimmed;
  if (/^수입\s+/.test(trimmed)) { kind = "income"; body = trimmed.replace(/^수입\s+/, ""); }
  else if (/^이체\s+/.test(trimmed)) { kind = "transfer"; body = trimmed.replace(/^이체\s+/, ""); }
  else if (/^지출\s+/.test(trimmed)) { kind = "expense"; body = trimmed.replace(/^지출\s+/, ""); }

  const amountMatch = body.match(/(-?\d{1,3}(?:,\d{3})*|\d+)(?:\s*원)?/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : 0;
  const description = amountMatch
    ? body.replace(amountMatch[0], "").trim()
    : body.trim();
  return { description, amount, kind };
};

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
    const today = new Date().toISOString().slice(0, 10);
    const entry: LedgerEntry = {
      id: `qe-${Date.now()}`,
      date: today,
      kind: parsed.kind,
      category: recommendation?.category ?? "",
      subCategory: recommendation?.subCategory,
      description: parsed.description,
      amount: parsed.amount,
      fromAccountId: parsed.kind === "income" ? undefined : defaultAccount?.id,
      toAccountId: parsed.kind === "income" ? defaultAccount?.id : undefined
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
            <div>카테고리: {recommendation?.category ?? "(미분류)"}{recommendation?.subCategory ? ` › ${recommendation.subCategory}` : ""}</div>
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
