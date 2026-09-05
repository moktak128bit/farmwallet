import React, { useEffect, useRef } from "react";
import { NumericInput } from "../../components/ui/fields";
import { formatShortDate } from "../../utils/formatter";

interface Props {
  kindLabel: string;
  date: string;
  categoryLabel: string;
  description: string;
  fromName?: string;
  toName?: string;
  amount: string;
  /** USD 항목이면 소수점 입력 허용 */
  allowDecimal?: boolean;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  onEditInForm: () => void;
  onClose: () => void;
}

/** 행 바로 아래 붙는 빠른 복사 패널 — 모달 대신 표 안에서 이어지는 행으로 뜬다. */
export const QuickCopyPanel: React.FC<Props> = ({
  kindLabel,
  date,
  categoryLabel,
  description,
  fromName,
  toName,
  amount,
  allowDecimal = false,
  onAmountChange,
  onSubmit,
  onEditInForm,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const infoItem = (label: string, value?: string) =>
    value ? (
      <span className="inline-row-panel-info-item">
        <span className="inline-row-panel-info-label">{label}</span>
        <span className="inline-row-panel-info-value">{value}</span>
      </span>
    ) : null;

  return (
    <div
      className="inline-row-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="inline-row-panel-header">
        <h4 className="inline-row-panel-title">복사 추가</h4>
        <button type="button" className="inline-row-panel-close" onClick={onClose} aria-label="닫기">
          &times;
        </button>
      </div>

      <div className="inline-row-panel-info">
        {infoItem("구분", kindLabel)}
        {infoItem("날짜", formatShortDate(date))}
        {infoItem("분류", categoryLabel)}
        {infoItem("내역", description)}
        {infoItem("출금", fromName)}
        {infoItem("입금", toName)}
      </div>

      <div className="inline-row-panel-fields">
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>금액</span>
          <NumericInput
            ref={inputRef}
            allowDecimal={allowDecimal}
            placeholder={allowDecimal ? "금액 입력 (소수점 허용)" : "금액 입력"}
            value={amount}
            onChange={onAmountChange}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
            style={{
              width: 180,
              padding: "8px 10px",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid var(--border)",
              textAlign: "right",
              boxSizing: "border-box"
            }}
          />
        </label>
      </div>

      <div className="inline-row-panel-actions">
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
  );
};
