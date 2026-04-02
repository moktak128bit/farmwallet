interface Props {
  height?: number;
}

export function ChartSkeleton({ height = 220 }: Props) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        fontSize: 13,
        borderRadius: 8,
        background: "var(--surface)",
      }}
    >
      차트 로딩 중…
    </div>
  );
}
