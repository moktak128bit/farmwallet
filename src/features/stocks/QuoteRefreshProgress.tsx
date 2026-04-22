import React from "react";

interface Props {
  isLoadingQuotes: boolean;
  quoteRefreshProgress: { current: number; total: number };
}

export const QuoteRefreshProgress: React.FC<Props> = ({ isLoadingQuotes, quoteRefreshProgress }) => {
  if (!isLoadingQuotes) return null;
  const pct = quoteRefreshProgress.total
    ? Math.round((quoteRefreshProgress.current / quoteRefreshProgress.total) * 100)
    : 0;
  return (
    <div
      className="quote-refresh-progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="시세 갱신 중"
    >
      <div
        className="quote-refresh-progress__bar quote-refresh-progress__bar--determinate"
        style={{ width: `${pct}%` }}
      />
      <span className="quote-refresh-progress__label">
        시세 갱신 중 {pct}%
      </span>
    </div>
  );
};
