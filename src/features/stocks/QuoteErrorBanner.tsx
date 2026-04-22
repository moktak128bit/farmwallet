import React from "react";

interface Props {
  quoteError: string | null;
  onDismiss: () => void;
  onRetry: () => void;
}

export const QuoteErrorBanner: React.FC<Props> = ({ quoteError, onDismiss, onRetry }) => {
  if (!quoteError) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <p className="error-text" style={{ margin: 0 }}>
        {quoteError}
      </p>
      <button
        type="button"
        className="primary"
        onClick={() => {
          onDismiss();
          onRetry();
        }}
        style={{ padding: "6px 12px", fontSize: 13 }}
      >
        다시 시도
      </button>
    </div>
  );
};
