import React, { useEffect, useRef } from "react";
import { AlertTriangle, Info } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmStyle?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "확인",
  confirmStyle = "primary",
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const isDanger = confirmStyle === "danger";

  useEffect(() => {
    if (!isOpen) return;
    // 위험 작업은 취소 버튼에 포커스 → 실수로 Enter 눌러도 안전
    // 일반 작업은 확인 버튼에 포커스
    const id = setTimeout(() => {
      if (isDanger) {
        cancelBtnRef.current?.focus();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(id);
  }, [isOpen, isDanger]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 2000 }}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{ maxWidth: 420, padding: "28px 32px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <span style={{
            flexShrink: 0,
            marginTop: 2,
            color: isDanger ? "var(--danger)" : "var(--accent)",
          }}>
            {isDanger ? <AlertTriangle size={22} /> : <Info size={22} />}
          </span>
          <div>
            <h3
              id="confirm-title"
              style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}
            >
              {title}
            </h3>
            <p
              id="confirm-message"
              style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}
            >
              {message}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24 }}>
          <button ref={cancelBtnRef} type="button" className="secondary" onClick={onCancel}>
            취소
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={isDanger ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
