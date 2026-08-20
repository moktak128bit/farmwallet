/**
 * 마지막 스키마 마이그레이션 카드 — 읽기 전용. 설정 > 백업/복원 탭(StorageUsageCard 뒤).
 * loadData가 v{from}→v{to} 마이그레이션을 적용하며 남긴 리포트(LAST_MIGRATION_REPORT)를 보여준다:
 * from→to·시각·컬렉션별 변경 건수·kind별 금액 합계 전/후·'직전 원본 백업' 존재 여부(백업 목록 라벨로 찾기).
 *
 * ⚠ 원클릭 롤백 버튼은 의도적으로 없다. 직전 원본을 그대로 복원하면 스키마 마커가 이미 현행이라
 * 재마이그레이션이 일어나지 않아 구형태가 영구 잔존한다(기획서 1-3). 복원은 마커 되감기와 함께 설계돼야 한다.
 */
import React, { useMemo } from "react";
import type { BackupEntry } from "../../storage";
import {
  DIFF_COLLECTIONS,
  migrationSnapshotLabel,
  readLastMigrationReport,
  type DiffCollectionName
} from "../../services/migrationReport";

const COLLECTION_LABELS: Record<DiffCollectionName, string> = {
  accounts: "계좌",
  ledger: "가계부",
  trades: "주식 거래",
  loans: "대출",
  recurringExpenses: "반복 지출",
  budgetGoals: "예산 목표",
  customSymbols: "사용자 종목",
  ledgerTemplates: "가계부 템플릿",
  stockPresets: "주식 프리셋",
  targetPortfolios: "목표 포트폴리오",
  workoutWeeks: "운동 주차",
  workoutRoutines: "운동 루틴",
  customExercises: "사용자 운동 종목",
  isaPortfolio: "ISA 포트폴리오"
};

const KIND_LABELS: Record<string, string> = {
  income: "수입",
  expense: "지출",
  transfer: "이체"
};

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  });
}

function formatNum(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

interface Props {
  /** 백업 목록(부모 공유 상태) — 직전 원본 스냅샷 존재 여부를 라벨로 찾는다 */
  backups: BackupEntry[];
}

export const MigrationReportCard: React.FC<Props> = React.memo(function MigrationReportCard({ backups }) {
  // 리포트는 loadData(부팅)에서만 바뀌므로 마운트(백업 탭 진입) 시 1회 읽으면 충분하다.
  const report = useMemo(() => readLastMigrationReport(), []);

  const snapshotLabel = report ? migrationSnapshotLabel(report.fromVersion, report.toVersion) : null;
  const snapshot = useMemo(
    () => (snapshotLabel ? backups.find((b) => b.label === snapshotLabel) ?? null : null),
    [backups, snapshotLabel]
  );

  if (!report) {
    return (
      <div className="card">
        <div className="card-title">마지막 마이그레이션</div>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
          이 브라우저에서 기록된 스키마 마이그레이션이 없습니다. (앱 업데이트로 저장 데이터 형식이 바뀔 때 자동 기록)
        </p>
      </div>
    );
  }

  const { diff } = report;
  const changedCollections = DIFF_COLLECTIONS.filter((name) => {
    const c = diff.collections[name];
    return c.added > 0 || c.removed > 0 || c.changed > 0;
  });
  const kinds = Object.keys(diff.ledgerAmountByKind).sort();
  const totalChanged = diff.ledgerAmountTotal.before !== diff.ledgerAmountTotal.after;
  const tradesChanged = diff.tradesTotalAmount.before !== diff.tradesTotalAmount.after;

  return (
    <div className="card">
      <div className="card-title">마지막 마이그레이션</div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          v{report.fromVersion} → v{report.toVersion}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatAt(report.at)}</span>
      </div>

      <div
        style={{
          fontSize: 13,
          marginBottom: 12,
          padding: "6px 10px",
          borderRadius: "var(--radius-md)",
          background: snapshot ? "var(--success-light)" : "var(--warning-light)",
          color: snapshot ? "var(--success)" : "var(--warning)"
        }}
      >
        {snapshot
          ? `직전 원본 백업 있음 (${formatAt(snapshot.createdAt)} · 브라우저 저장소)`
          : "직전 원본 백업을 백업 목록에서 찾지 못했습니다 (저장 실패 또는 정리됨)"}
      </div>

      {changedCollections.length === 0 ? (
        <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "var(--text-muted)" }}>
          항목 추가·삭제·변경 없음 (분류 프리셋 등 메타만 갱신)
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "4px 6px" }}>컬렉션</th>
                <th style={{ padding: "4px 6px" }}>전</th>
                <th style={{ padding: "4px 6px" }}>후</th>
                <th style={{ padding: "4px 6px" }}>추가</th>
                <th style={{ padding: "4px 6px" }}>삭제</th>
                <th style={{ padding: "4px 6px" }}>변경</th>
              </tr>
            </thead>
            <tbody>
              {changedCollections.map((name) => {
                const c = diff.collections[name];
                return (
                  <tr key={name} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <td style={{ textAlign: "left", padding: "4px 6px" }}>{COLLECTION_LABELS[name]}</td>
                    <td style={{ padding: "4px 6px" }}>{c.before}</td>
                    <td style={{ padding: "4px 6px" }}>{c.after}</td>
                    <td style={{ padding: "4px 6px", color: c.added > 0 ? "var(--danger)" : undefined }}>{c.added}</td>
                    <td style={{ padding: "4px 6px", color: c.removed > 0 ? "var(--accent)" : undefined }}>{c.removed}</td>
                    <td style={{ padding: "4px 6px", color: c.changed > 0 ? "var(--warning)" : undefined }}>{c.changed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
        {kinds.map((kind) => {
          const v = diff.ledgerAmountByKind[kind];
          const changed = v.before !== v.after;
          return (
            <div key={kind} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>가계부 {KIND_LABELS[kind] ?? kind} 합계</span>
              <span style={{ color: changed ? "var(--warning)" : undefined }}>
                {formatNum(v.before)} → {formatNum(v.after)}
              </span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>가계부 총합</span>
          <span style={{ color: totalChanged ? "var(--warning)" : undefined }}>
            {formatNum(diff.ledgerAmountTotal.before)} → {formatNum(diff.ledgerAmountTotal.after)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>거래 금액 합계</span>
          <span style={{ color: tradesChanged ? "var(--warning)" : undefined }}>
            {formatNum(diff.tradesTotalAmount.before)} → {formatNum(diff.tradesTotalAmount.after)}
          </span>
        </div>
      </div>

      <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "var(--text-faint)" }}>
        금액은 통화 환산 없는 원 값 합계(전/후 비교용)입니다. 직전 원본은 백업 기록 표에서 라벨로 찾을 수 있으나,
        그대로 복원하면 구형식이 재마이그레이션 없이 남으므로 문제 확인 용도로만 쓰세요.
      </p>
    </div>
  );
});
