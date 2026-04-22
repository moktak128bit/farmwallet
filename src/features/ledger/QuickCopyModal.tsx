import React, { useEffect, useRef } from "react";
import { formatShortDate } from "../../utils/formatter";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface Props {
  kindLabel: string;
  date: string;
  categoryLabel: string;
  description: string;
  fromName?: string;
  toName?: string;
  amount: string;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  onEditInForm: () => void;
  onClose: () => void;
}

export const QuickCopyModal: React.FC<Props> = ({
  kindLabel,
  date,
  categoryLabel,
  description,
  fromName,
  toName,
  amount,
  onAmountChange,
  onSubmit,
  onEditInForm,
  onClose,
}) => {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const infoRow = (label: string, value?: string) =>
    value ? (
      <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.6 }}>
        <span style={{ color: "var(--text-muted)", minWidth: 48, flexShrink: 0 }}>{label}</span>
        <span style={{ fontWeight: 500 }}>{value}</span>
      </div>
    ) : null;

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
        style={{ maxWidth: 440, padding: "24px 28px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>복사 추가</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", padding: 0, width: 24, height: 24, color: "var(--text-muted)" }}
          >
            &times;
          </button>
        </div>

        <div style={{
          padding: "12px 14px",
          background: "var(--bg)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 2
        }}>
          {infoRow("구분", kindLabel)}
          {infoRow("날짜", formatShortDate(date))}
          {infoRow("분류", categoryLabel)}
          {infoRow("내역", description)}
          {infoRow("출금", fromName)}
          {infoRow("입금", toName)}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>금액</label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            placeholder="금액 입력"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9,]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid var(--border)",
              textAlign: "right",
              boxSizing: "border-box"
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="secondary" onClick={onEditInForm} style={{ fontSize: 13 }}>
            폼에서 편집
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            취소
          </button>
          <button type="button" className="primary" onClick={onSubmit}>
            추가
          </button>
        </div>
      </div>
    </div>
  );
};
