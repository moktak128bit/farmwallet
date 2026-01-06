import React, { useState, useRef, useEffect } from "react";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = "top"
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && tooltipRef.current) {
      // 툴팁이 화면 밖으로 나가지 않도록 조정
      const rect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        tooltipRef.current.style.left = "auto";
        tooltipRef.current.style.right = "0";
      }
      if (rect.bottom > viewportHeight) {
        tooltipRef.current.style.top = "auto";
        tooltipRef.current.style.bottom = "100%";
      }
    }
  }, [isVisible]);

  const positionStyles: Record<string, React.CSSProperties> = {
    top: {
      bottom: "100%",
      left: "50%",
      transform: "translateX(-50%)",
      marginBottom: "8px"
    },
    bottom: {
      top: "100%",
      left: "50%",
      transform: "translateX(-50%)",
      marginTop: "8px"
    },
    left: {
      right: "100%",
      top: "50%",
      transform: "translateY(-50%)",
      marginRight: "8px"
    },
    right: {
      left: "100%",
      top: "50%",
      transform: "translateY(-50%)",
      marginLeft: "8px"
    }
  };

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 1000,
            padding: "6px 12px",
            backgroundColor: "var(--text)",
            color: "var(--bg)",
            fontSize: 12,
            borderRadius: "6px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            ...positionStyles[position]
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};





