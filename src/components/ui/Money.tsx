/**
 * 금액 표기 — 숫자는 크게, 단위 "원"은 한 단계 작고 가볍게(.money-unit) 내려 숫자만 스캔되게 한다.
 *  - compact: 잔액·평가액처럼 시세 따라 흔들리는 '스톡' 숫자용 만·억 단위 (title에 정확한 원 단위 유지)
 *  - 기본: 이번 달 수입·지출처럼 가계부와 원 단위로 대조하는 '흐름' 숫자 — 자릿수 그대로
 * 마스킹(formatter.setAmountMask)은 formatNumber/formatKrwCompact가 처리한다.
 */
import React from "react";
import { formatKRW, formatKrwCompact, formatNumber } from "../../utils/formatter";

interface Props {
  value: number;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const Money: React.FC<Props> = ({ value, compact = false, className, style }) => {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <span className={className ? `money ${className}` : "money"} style={style} title={compact ? formatKRW(Math.round(v)) : undefined}>
      <span className="money-num">{compact ? formatKrwCompact(v) : formatNumber(v)}</span>
      <span className="money-unit">원</span>
    </span>
  );
};
