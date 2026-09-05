import React, { useEffect, useRef } from "react";
import { DateField, MoneyField, QuantityField } from "../../components/ui/fields";

interface Props {
  tickerLabel: string;
  accountName: string;
  sideLabel: string;
  currency: "KRW" | "USD";
  date: string;
  quantity: string;
  price: string;
  fee: string;
  onDateChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onPriceChange: (v: string) => void;
  onFeeChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** 거래 내역 행 바로 아래 붙는 빠른 복사 패널 — 같은 종목·계좌·매매구분으로 날짜·수량·단가·수수료만 조정해 새 거래로 저장. */
export const TradeQuickCopyPanel: React.FC<Props> = ({
  tickerLabel,
  accountName,
  sideLabel,
  currency,
  date,
  quantity,
  price,
  fee,
  onDateChange,
  onQuantityChange,
  onPriceChange,
  onFeeChange,
  onSubmit,
  onClose,
}) => {
  const firstFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      firstFieldRef.current?.querySelector("input")?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className="inline-row-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="inline-row-panel-header">
        <h4 className="inline-row-panel-title">거래 복사</h4>
        <button type="button" className="inline-row-panel-close" onClick={onClose} aria-label="닫기">
          &times;
        </button>
      </div>

      <div className="inline-row-panel-info">
        <span className="inline-row-panel-info-item">
          <span className="inline-row-panel-info-label">종목</span>
          <span className="inline-row-panel-info-value">{tickerLabel}</span>
        </span>
        <span className="inline-row-panel-info-item">
          <span className="inline-row-panel-info-label">계좌</span>
          <span className="inline-row-panel-info-value">{accountName}</span>
        </span>
        <span className="inline-row-panel-info-item">
          <span className="inline-row-panel-info-label">구분</span>
          <span className="inline-row-panel-info-value">{sideLabel}</span>
        </span>
      </div>

      <div className="inline-row-panel-fields">
        <div ref={firstFieldRef} style={{ width: 160 }}>
          <DateField label="거래일" value={date} onChange={onDateChange} />
        </div>
        <div style={{ width: 140 }}>
          <QuantityField label="수량" value={quantity} onChange={onQuantityChange} maxDecimals={8} />
        </div>
        <div style={{ width: 160 }}>
          <MoneyField label="단가" currency={currency} allowDecimal value={price} onChange={onPriceChange} />
        </div>
        <div style={{ width: 160 }}>
          <MoneyField label="수수료" currency={currency} allowDecimal value={fee} onChange={onFeeChange} />
        </div>
      </div>

      <div className="inline-row-panel-actions">
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
