import { useEffect, useState } from "react";

const WIDGET_ID_DIVIDEND_TRACKING = "dividendTracking";

export const DEFAULT_WIDGET_ORDER = [
  "summary",
  "assets",
  "income",
  "savingsFlow",
  "budget",
  "stocks",
  "portfolio",
  "targetPortfolio",
  WIDGET_ID_DIVIDEND_TRACKING,
  "isa"
];

function migrateWidgetId(id: string): string {
  return id === "458730" ? WIDGET_ID_DIVIDEND_TRACKING : id;
}

const STORAGE_WIDGETS = "fw-dashboard-widgets";
const STORAGE_WIDGET_ORDER = "fw-dashboard-widget-order";

export function useWidgetSettings() {
  const [visibleWidgets, setVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_WIDGETS);
        if (saved) {
          const arr = JSON.parse(saved) as string[];
          return new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DEFAULT_WIDGET_ORDER);
        }
      } catch (e) {
        console.warn("[useWidgetSettings] 위젯 설정 로드 실패", e);
      }
    }
    return new Set(DEFAULT_WIDGET_ORDER);
  });

  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_WIDGET_ORDER);
        if (saved) {
          const parsed = JSON.parse(saved) as string[];
          if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDGET_ORDER.length) return parsed.map(migrateWidgetId);
        }
      } catch (e) {
        console.warn("[useWidgetSettings] 위젯 순서 로드 실패", e);
      }
    }
    return [...DEFAULT_WIDGET_ORDER];
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_WIDGETS, JSON.stringify(Array.from(visibleWidgets)));
    }
  }, [visibleWidgets]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_WIDGET_ORDER, JSON.stringify(widgetOrder));
    }
  }, [widgetOrder]);

  const toggleWidget = (id: string) => {
    setVisibleWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveWidgetOrder = (id: string, direction: "up" | "down") => {
    setWidgetOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = [...prev];
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  return { visibleWidgets, widgetOrder, toggleWidget, moveWidgetOrder };
}
