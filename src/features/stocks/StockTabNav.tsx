import React from "react";

export type StockPageTab = "stocks" | "portfolio" | "fx";

interface Props {
  activeTab: StockPageTab;
  setActiveTab: (tab: StockPageTab) => void;
  showFxTab: boolean;
}

export const StockTabNav: React.FC<Props> = ({ activeTab, setActiveTab, showFxTab }) => {
  const btn = (tab: StockPageTab) => ({
    padding: "8px 16px",
    fontSize: 14,
    borderRadius: "6px 6px 0 0",
    borderBottom: activeTab === tab ? "2px solid var(--primary)" : "none",
  });

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
      <button
        type="button"
        className={activeTab === "stocks" ? "primary" : "secondary"}
        onClick={() => setActiveTab("stocks")}
        style={btn("stocks")}
      >
        주식
      </button>
      <button
        type="button"
        className={activeTab === "portfolio" ? "primary" : "secondary"}
        onClick={() => setActiveTab("portfolio")}
        style={btn("portfolio")}
      >
        포트폴리오 분석
      </button>
      {showFxTab && (
        <button
          type="button"
          className={activeTab === "fx" ? "primary" : "secondary"}
          onClick={() => setActiveTab("fx")}
          style={btn("fx")}
        >
          환전
        </button>
      )}
    </div>
  );
};
