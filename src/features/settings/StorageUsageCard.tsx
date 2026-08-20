/**
 * localStorage 사용량 카드 — 읽기 전용. 설정 > 백업/복원 탭.
 * 5MB(브라우저 관례) 대비 키별 사용량 막대와 합계, 백업 개수/개당 평균, 기타 키 합계를 보여준다.
 * 측정은 마운트 시 1회 + "다시 측정" 버튼 (저장마다 재측정하지 않음 — 비용·깜빡임 방지).
 * 80% 이상 경고(--warning), 95% 이상 위험(--danger). 헤더 경고는 App.tsx 수정이 필요해 이 카드에서만 안내(후속 항목).
 */
import React, { useCallback, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../../constants/config";
import {
  measureLocalStorageUsage,
  formatStorageBytes,
  type StorageUsageReport,
  type StorageUsageLevel
} from "../../utils/storageUsage";

const LEVEL_COLOR: Record<StorageUsageLevel, string> = {
  ok: "var(--primary)",
  warning: "var(--warning)",
  danger: "var(--danger)"
};

const LEVEL_BG: Record<StorageUsageLevel, string> = {
  ok: "var(--success-light)",
  warning: "var(--warning-light)",
  danger: "var(--danger-light)"
};

function measure(): StorageUsageReport | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return measureLocalStorageUsage(window.localStorage, STORAGE_KEYS);
  } catch {
    // 일부 브라우저 모드(프라이버시·iframe)에서 접근 거부 — 측정 불가로 표시
    return null;
  }
}

interface BarProps {
  label: string;
  bytes: number;
  /** 막대 길이 — 카드 내 최대 항목 대비 비율(0~1) */
  widthRatio: number;
  color: string;
  subLabel?: string;
}

const UsageBar: React.FC<BarProps> = ({ label, bytes, widthRatio, color, subLabel }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 2 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
        {subLabel && <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 12 }}>{subLabel}</span>}
      </span>
      <span style={{ color: "var(--text-secondary)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {formatStorageBytes(bytes)}
      </span>
    </div>
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(widthRatio * 100)}
      style={{ height: 6, borderRadius: 3, background: "var(--border-light)", overflow: "hidden" }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(widthRatio > 0 ? 1 : 0, widthRatio * 100))}%`,
          height: "100%",
          background: color,
          borderRadius: 3
        }}
      />
    </div>
  </div>
);

export const StorageUsageCard: React.FC = React.memo(function StorageUsageCard() {
  const [report, setReport] = useState<StorageUsageReport | null>(() => measure());
  const [measuredAt, setMeasuredAt] = useState<Date | null>(() => (report ? new Date() : null));

  const handleRemeasure = useCallback(() => {
    setReport(measure());
    setMeasuredAt(new Date());
  }, []);

  const maxItemBytes = useMemo(() => {
    if (!report) return 0;
    return Math.max(report.other.bytes, ...report.items.map((i) => i.bytes), 0);
  }, [report]);

  if (!report) {
    return (
      <div className="card">
        <div className="card-title">저장 공간 사용량</div>
        <p style={{ margin: "0 0 12px 0", color: "var(--text-muted)" }}>
          이 환경에서는 localStorage에 접근할 수 없어 사용량을 측정하지 못했습니다.
        </p>
        <button type="button" onClick={handleRemeasure}>다시 측정</button>
      </div>
    );
  }

  const levelColor = LEVEL_COLOR[report.level];
  const totalWidth = Math.min(1, report.ratio);

  return (
    <div className="card">
      <div className="card-title">저장 공간 사용량</div>

      {report.level !== "ok" && (
        <div
          role="alert"
          style={{
            background: LEVEL_BG[report.level],
            color: levelColor,
            border: `1px solid ${levelColor}`,
            borderRadius: "var(--radius-md)",
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600
          }}
        >
          {report.level === "danger"
            ? `브라우저 저장 공간이 거의 찼습니다 (${report.percent}%). 저장이 실패할 수 있으니 오래된 백업을 정리하거나 JSON 내보내기로 보관한 뒤 정리하세요.`
            : `브라우저 저장 공간 사용량이 ${report.percent}%입니다. 오래된 백업 정리를 권장합니다.`}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: levelColor, fontVariantNumeric: "tabular-nums" }}>
          {report.percent}%
        </span>
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {formatStorageBytes(report.totalBytes)} / {formatStorageBytes(report.limitBytes)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="전체 저장 공간 사용률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(report.ratio * 100))}
        style={{ height: 10, borderRadius: 5, background: "var(--border-light)", overflow: "hidden", marginBottom: 12 }}
      >
        <div style={{ width: `${totalWidth * 100}%`, height: "100%", background: levelColor, borderRadius: 5 }} />
      </div>

      <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--text-muted)" }}>
        브라우저 localStorage(관례상 약 5MB) 기준 근사치입니다. 아래 막대는 항목별 상대 크기입니다.
      </p>

      {report.items.map((item) => (
        <UsageBar
          key={item.key}
          label={item.label}
          bytes={item.bytes}
          widthRatio={maxItemBytes > 0 ? item.bytes / maxItemBytes : 0}
          color="var(--primary)"
          subLabel={
            item.name === "BACKUPS" && report.backup.count != null
              ? `${report.backup.count}개 · 개당 평균 ${formatStorageBytes(report.backup.avgBytes)}`
              : item.name === "BACKUPS"
                ? "개수 확인 불가(손상)"
                : undefined
          }
        />
      ))}
      {report.other.count > 0 && (
        <UsageBar
          label="기타(앱 외 키)"
          bytes={report.other.bytes}
          widthRatio={maxItemBytes > 0 ? report.other.bytes / maxItemBytes : 0}
          color="var(--primary)"
          subLabel={`${report.other.count}개`}
        />
      )}
      {report.items.length === 0 && report.other.count === 0 && (
        <p style={{ margin: "0 0 8px 0", color: "var(--text-muted)", fontSize: 13 }}>저장된 항목이 없습니다.</p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" onClick={handleRemeasure}>다시 측정</button>
        {measuredAt && (
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            측정 {measuredAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
});
