import React, { useEffect, useRef, useState } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";

type BaseProps = React.ComponentProps<typeof RechartsResponsiveContainer>;

interface DeferredResponsiveContainerProps extends BaseProps {
  rootMargin?: string;
  keepMounted?: boolean;
  placeholder?: React.ReactNode;
}

function toCssSize(value: number | string | undefined, fallback: string): string {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export const DeferredResponsiveContainer: React.FC<DeferredResponsiveContainerProps> = ({
  rootMargin = "280px 0px",
  keepMounted = true,
  placeholder = null,
  width,
  height,
  minWidth,
  minHeight,
  children,
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = containerRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const nextVisible = entries.some((entry) => entry.isIntersecting);
        if (nextVisible) {
          setIsVisible(true);
          setHasRendered(true);
          return;
        }
        if (!keepMounted) setIsVisible(false);
      },
      {
        root: null,
        rootMargin,
        threshold: 0.01
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [rootMargin, keepMounted]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || !isVisible) return;

    const updateSize = () => {
      const rect = target.getBoundingClientRect();
      const w = Math.max(0, Math.round(rect.width));
      const h = Math.max(0, Math.round(rect.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(target);
    return () => ro.disconnect();
  }, [isVisible]);

  const shouldRender = keepMounted ? hasRendered || isVisible : isVisible;
  const resolvedWidth = toCssSize(width, "100%");
  const resolvedHeight = toCssSize(height, "100%");
  const hasValidSize = size.w > 0 && size.h > 0;

  return (
    <div
      ref={containerRef}
      style={{
        width: resolvedWidth,
        height: resolvedHeight,
        minWidth: toCssSize(minWidth, "0"),
        minHeight: toCssSize(minHeight, "100px")
      }}
    >
      {shouldRender && hasValidSize ? (
        <RechartsResponsiveContainer
          width={size.w}
          height={size.h}
          minWidth={minWidth ?? 0}
          minHeight={minHeight ?? 100}
          {...props}
        >
          {children}
        </RechartsResponsiveContainer>
      ) : shouldRender ? (
        placeholder
      ) : (
        placeholder
      )}
    </div>
  );
};
