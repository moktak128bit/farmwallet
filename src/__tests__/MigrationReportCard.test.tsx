// @vitest-environment jsdom
/**
 * 설정 > 백업 '마지막 마이그레이션' 카드 — 읽기 전용 렌더 계약.
 * 리포트 없음 / 있음(직전 원본 백업 라벨 매칭 여부) / 롤백 버튼 부재.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MigrationReportCard } from "../features/settings/MigrationReportCard";
import {
  buildMigrationReport,
  diffAppData,
  migrationSnapshotLabel,
  writeLastMigrationReport
} from "../services/migrationReport";
import type { BackupEntry } from "../storage";
import type { AppData } from "../types";

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides
  };
}

describe("MigrationReportCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("리포트가 없으면 안내 문구만", () => {
    render(<MigrationReportCard backups={[]} />);
    expect(screen.getByText("마지막 마이그레이션")).toBeInTheDocument();
    expect(screen.getByText(/기록된 스키마 마이그레이션이 없습니다/)).toBeInTheDocument();
  });

  it("리포트가 있으면 from→to·변경 컬렉션 표·kind 합계, 라벨이 일치하는 백업이 있으면 '직전 원본 백업 있음'", () => {
    const before = makeAppData({
      ledger: [{ id: "a", date: "2026-01-01", kind: "income", category: "데이트비", description: "x", amount: 1000 }]
    });
    const after = { ...before, ledger: [{ ...before.ledger[0], category: "데이트통장" }] };
    writeLastMigrationReport(buildMigrationReport(9, 12, diffAppData(before, after), "2026-08-21T00:00:00.000Z"));

    const backups: BackupEntry[] = [
      { id: "B1", createdAt: "2026-08-21T00:00:01.000Z", source: "browser", label: migrationSnapshotLabel(9, 12) },
      { id: "B2", createdAt: "2026-08-20T00:00:00.000Z", source: "browser" }
    ];
    render(<MigrationReportCard backups={backups} />);
    expect(screen.getByText("v9 → v12")).toBeInTheDocument();
    expect(screen.getByText(/직전 원본 백업 있음/)).toBeInTheDocument();
    expect(screen.getByText("가계부")).toBeInTheDocument();
    expect(screen.getByText(/가계부 수입 합계/)).toBeInTheDocument();
    expect(screen.getAllByText("1,000 → 1,000").length).toBeGreaterThan(0);
    // 원클릭 롤백 금지 — 버튼이 하나도 없다
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("라벨이 일치하는 백업이 없으면 경고 문구", () => {
    writeLastMigrationReport(buildMigrationReport(11, 12, diffAppData(makeAppData(), makeAppData()), "2026-08-21T00:00:00.000Z"));
    render(<MigrationReportCard backups={[{ id: "B2", createdAt: "2026-08-20T00:00:00.000Z", source: "browser", label: "다른 라벨" }]} />);
    expect(screen.getByText(/찾지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/항목 추가·삭제·변경 없음/)).toBeInTheDocument();
  });
});
