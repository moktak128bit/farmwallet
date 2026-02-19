import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  message,
  action
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--text-muted)"
      }}
    >
      {icon && (
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>
          {icon}
        </div>
      )}
      <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 600, color: "var(--text-secondary)" }}>
        {title}
      </h3>
      {message && (
        <p style={{ margin: "0 0 16px 0", fontSize: 14, maxWidth: 400 }}>
          {message}
        </p>
      )}
      {action && (
        <button
          type="button"
          className="primary"
          onClick={action.onClick}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};







