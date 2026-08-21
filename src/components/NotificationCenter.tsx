/**
 * 알림 센터 / 넛지 (3-11) — 헤더 벨 버튼 + 미확인 배지 + 패널.
 *
 * 실제 판정은 utils/nudges.buildNudges(순수)에 있고 여기는 컨텍스트 조립(useAppStore 셀렉터·
 * FxRateContext·useTaxGrossUp) + 표시 + 스누즈(7일, localStorage STORAGE_KEYS.NUDGE_DISMISSED)만 한다.
 *
 * DraftRecoveryBanner·SaveStatusPill·탭 충돌/Gist 충돌 모달은 이 패널이 대신하지 않는다 — 헤더에 그대로
 * 유지되고, 이 패널에는 참고용으로 백업 경과 항목만 추가로 노출한다(기존 헤더 pill은 손대지 않음).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useUIStore } from "../store/uiStore";
import { useFxRateValue } from "../context/FxRateContext";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";
import { useTaxGrossUp } from "../hooks/useTaxGrossUp";
import { buildNudges, type Nudge, type NudgeSeverity } from "../utils/nudges";
import { getTodayKST } from "../utils/date";
import { STORAGE_KEYS } from "../constants/config";
import { measureLocalStorageUsage } from "../utils/storageUsage";
import { readLastMigrationReport } from "../services/migrationReport";

/** 스누즈 기간 — dedupeKey → 다시 뜰 시각(ISO). 만료 전까지 목록에서 숨김 */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type DismissMap = Record<string, string>;

function readDismissed(): DismissMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.NUDGE_DISMISSED);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DismissMap) : {};
  } catch {
    return {};
  }
}

function writeDismissed(map: DismissMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.NUDGE_DISMISSED, JSON.stringify(map));
  } catch {
    // 저장 공간 부족 등 — 스누즈 실패는 치명적이지 않으므로 조용히 무시
  }
}

function measureStorageRatio(): number | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return measureLocalStorageUsage(window.localStorage, STORAGE_KEYS).ratio;
  } catch {
    return null;
  }
}

const SEVERITY_LABEL: Record<NudgeSeverity, string> = { critical: "위험", warn: "주의", info: "정보" };
const SEVERITY_COLOR: Record<NudgeSeverity, string> = {
  critical: "var(--danger)",
  warn: "var(--warning)",
  info: "var(--accent)"
};

interface Props {
  /** hooks/useBackup().latestBackupAt — App.tsx가 이미 계산해 둔 값을 그대로 받아 중복 조회하지 않음 */
  latestBackupAt: string | null;
}

export const NotificationCenter: React.FC<Props> = ({ latestBackupAt }) => {
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const isTopModal = useModalStackEntry(open);
  const setTab = useUIStore((s) => s.setTab);

  const ledger = useAppStore((s) => s.data.ledger);
  const recurringExpenses = useAppStore((s) => s.data.recurringExpenses);
  const budgetGoals = useAppStore((s) => s.data.budgetGoals);
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);
  const accounts = useAppStore((s) => s.data.accounts);
  const loans = useAppStore((s) => s.data.loans);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const [taxGrossUp] = useTaxGrossUp();

  // 저장공간 사용률·마이그레이션 리포트는 마운트 시 1회만(StorageUsageCard와 같은 정책) — 매 렌더 재측정 방지
  const [storageRatio] = useState<number | null>(measureStorageRatio);
  const [lastMigrationReport] = useState(() => {
    const r = readLastMigrationReport();
    return r ? { at: r.at, toVersion: r.toVersion, hasChanges: r.diff.hasChanges } : null;
  });

  const [dismissed, setDismissed] = useState<DismissMap>(readDismissed);

  const allNudges = useMemo(
    () =>
      buildNudges({
        today: getTodayKST(),
        ledger,
        recurringExpenses,
        budgetGoals,
        categoryPresets,
        accounts,
        loans,
        fxRate,
        taxGrossUp,
        historicalDailyFx,
        marketEnvSnapshots,
        latestBackupAt,
        storageRatio,
        lastMigrationReport
      }),
    [
      ledger,
      recurringExpenses,
      budgetGoals,
      categoryPresets,
      accounts,
      loans,
      fxRate,
      taxGrossUp,
      historicalDailyFx,
      marketEnvSnapshots,
      latestBackupAt,
      storageRatio,
      lastMigrationReport
    ]
  );

  const active = useMemo(() => {
    const nowMs = Date.now();
    return allNudges.filter((n) => {
      const until = dismissed[n.dedupeKey];
      if (!until) return true;
      const untilMs = new Date(until).getTime();
      return !Number.isFinite(untilMs) || untilMs <= nowMs;
    });
  }, [allNudges, dismissed]);

  // 스누즈로 목록이 비면 패널도 닫기 (RecurringDueBadge와 같은 패턴)
  useEffect(() => {
    if (active.length === 0) setOpen(false);
  }, [active.length]);

  const handleDismiss = useCallback((dedupeKey: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [dedupeKey]: new Date(Date.now() + SNOOZE_MS).toISOString() };
      writeDismissed(next);
      return next;
    });
  }, []);

  const handleItemClick = useCallback(
    (n: Nudge) => {
      setTab(n.tab);
      setOpen(false);
    },
    [setTab]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    // 모달 중첩 시 최상위 모달만 ESC로 닫힘
    if (!isTopModal()) return;
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="icon-button"
        title={active.length > 0 ? `알림 ${active.length}건` : "알림"}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ position: "relative", width: 32, height: 32, border: "1px solid var(--border)" }}
      >
        <Bell size={16} />
        {active.length > 0 && (
          <span className="notif-badge" aria-label={`읽지 않은 알림 ${active.length}건`}>
            {active.length > 9 ? "9+" : active.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="notif-panel-overlay" role="presentation" onClick={() => setOpen(false)} />
          <div
            ref={trapRef}
            className="notif-panel"
            role="dialog"
            aria-modal="true"
            aria-label="알림"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>알림 {active.length}건</span>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
            {active.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>
                확인할 항목이 없습니다.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {active.map((n) => (
                  <li key={n.id} className="notif-item">
                    <button type="button" className="notif-item-main" onClick={() => handleItemClick(n)}>
                      <span className="notif-item-badge" style={{ background: SEVERITY_COLOR[n.severity] }}>
                        {SEVERITY_LABEL[n.severity]}
                      </span>
                      <span className="notif-item-body">
                        <span className="notif-item-title">{n.title}</span>
                        <span className="notif-item-detail">{n.detail}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="notif-item-dismiss"
                      onClick={() => handleDismiss(n.dedupeKey)}
                      title="7일간 숨기기"
                      aria-label={`${n.title} 7일간 숨기기`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
};
