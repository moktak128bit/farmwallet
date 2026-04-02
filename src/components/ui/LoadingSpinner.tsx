import React from "react";

interface LoadingSpinnerProps {
  size?: "small" | "medium" | "large";
  text?: string;
  inline?: boolean;
}

const sizeMap = {
  small: 16,
  medium: 24,
  large: 32
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "medium",
  text,
  inline = false
}) => {
  const spinnerSize = sizeMap[size];
  
  const spinner = (
    <div
      style={{
        display: inline ? "inline-block" : "block",
        width: spinnerSize,
        height: spinnerSize,
        border: `2px solid var(--border)`,
        borderTop: `2px solid var(--primary)`,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }}
      role="status"
      aria-label="로딩 중"
    />
  );

  if (text) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: inline ? 0 : 16
        }}
      >
        {spinner}
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>{text}</span>
      </div>
    );
  }

  return spinner;
};

// CSS 애니메이션은 styles.css에 추가해야 함







