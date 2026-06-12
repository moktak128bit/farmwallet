import React, { useMemo, useState } from "react";
import type { AppData, LedgerEntry } from "../types";
import {
  runIntegrityCheck,
  type IntegrityIssue,
  type DuplicateTrade,
  type MissingReference
} from "../utils/dataIntegrity";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../constants/errorMessages";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  onNavigateToRecord?: (payload: { type: "ledger" | "trade"; id: string }) => void;
  onNavigateToTab?: (tab: "accounts" | "ledger" | "stocks") => void;
}

type NavigateTab = "accounts" | "ledger" | "stocks";

interface FixGuide {
  key: string;
  tab: NavigateTab;
  tabLabel: string;
  location: string;
  date?: string;
  id?: string;
  detail?: string;
  recordType?: "ledger" | "trade";
}

const ISSUE_TYPE_LABEL: Record<IntegrityIssue["type"], string> = {
  duplicate: "중복 거래",
  balance_mismatch: "잔액 불일치",
  missing_reference: "누락된 참조",
  date_order: "날짜 순서",
  amount_consistency: "금액 일관성",
  category_mismatch: "카테고리 불일치",
  transfer_pair_mismatch: "이체 쌍 불일치",
  transfer_invalid_reference: "이체 참조 누락",
  usd_securities_mismatch: "USD 증권 잔액 불일치"
};

const SEVERITY_LABEL: Record<IntegrityIssue["severity"], string> = {
  error: "오류",
  warning: "경고",
  info: "정보"
};

const SEVERITY_COLOR: Record<IntegrityIssue["severity"], string> = {
  error: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--accent)"
};

function dedupeGuides(guides: FixGuide[]): FixGuide[] {
  const seen = new Set<string>();
  return guides.filter((guide) => {
    if (seen.has(guide.key)) return false;
    seen.add(guide.key);
    return true;
  });
}

export const DataIntegrityView: React.FC<Props> = ({
  data,
  onChangeData,
  onNavigateToRecord,
  onNavigateToTab
}) => {
  const [issues, setIssues] = useState<IntegrityIssue[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const ledgerById = useMemo(() => new Map(data.ledger.map((entry) => [entry.id, entry])), [data.ledger]);
  const tradeById = useMemo(() => new Map(data.trades.map((trade) => [trade.id, trade])), [data.trades]);
  const accountById = useMemo(() => new Map(data.accounts.map((account) => [account.id, account])), [data.accounts]);

  const runCheck = () => {
    setIsChecking(true);
    try {
      const foundIssues = runIntegrityCheck(data.accounts, data.ledger, data.trades, data.categoryPresets);
      setIssues(foundIssues);
      toast.success(`검사 완료: ${foundIssues.length}개 문제 발견`);
    } catch (error) {
      console.error("무결성 검사 오류:", error);
      toast.error(ERROR_MESSAGES.INTEGRITY_CHECK_FAILED);
    } finally {
      setIsChecking(false);
    }
  };

  /**
   * 자동 수정 직후 재검사 — onChangeData에 넘긴 "새 데이터"로 직접 검사한다.
   * (props.data는 부모 리렌더 전까지 stale이라 runCheck()를 그대로 부르면 수정 전 데이터를 재검사함)
   */
  const recheckWith = (next: AppData) => {
    try {
      const foundIssues = runIntegrityCheck(next.accounts, next.ledger, next.trades, next.categoryPresets);
      setIssues(foundIssues);
    } catch (error) {
      console.error("무결성 재검사 오류:", error);
      toast.error(ERROR_MESSAGES.INTEGRITY_CHECK_FAILED);
    }
  };

  const issuesByType = useMemo(() => {
    const grouped = new Map<IntegrityIssue["type"], IntegrityIssue[]>();
    issues.forEach((issue) => {
      const existing = grouped.get(issue.type) ?? [];
      grouped.set(issue.type, [...existing, issue]);
    });
    return grouped;
  }, [issues]);

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;

  const buildLedgerGuide = (ledgerId: string, detail?: string): FixGuide => {
    const entry = ledgerById.get(ledgerId);
    const categoryPath = [entry?.category, entry?.subCategory].filter(Boolean).join(" > ");
    return {
      key: `ledger:${ledgerId}:${detail ?? ""}`,
      tab: "ledger",
      tabLabel: "가계부 탭",
      location: "거래 목록",
      date: entry?.date,
      id: ledgerId,
      detail: detail ?? (entry ? `${entry.kind} · ${categoryPath || "분류 없음"}` : "해당 ID를 거래 목록에서 검색"),
      recordType: "ledger"
    };
  };

  const buildTradeGuide = (tradeId: string, detail?: string): FixGuide => {
    const trade = tradeById.get(tradeId);
    return {
      key: `trade:${tradeId}:${detail ?? ""}`,
      tab: "stocks",
      tabLabel: "주식 탭",
      location: "거래내역 섹션",
      date: trade?.date,
      id: tradeId,
      detail:
        detail ??
        (trade
          ? `${trade.side === "buy" ? "매수" : "매도"} · ${trade.ticker}${trade.name ? ` (${trade.name})` : ""}`
          : "해당 ID를 거래내역에서 검색"),
      recordType: "trade"
    };
  };

  const buildAccountGuide = (accountId: string, detail?: string): FixGuide => {
    const account = accountById.get(accountId);
    return {
      key: `account:${accountId}:${detail ?? ""}`,
      tab: "accounts",
      tabLabel: "계좌 탭",
      location: "계좌 목록",
      id: accountId,
      detail: detail ?? (account ? `${account.name} (${account.id})` : `계좌 ID: ${accountId}`)
    };
  };

  const buildIssueGuides = (issue: IntegrityIssue): FixGuide[] => {
    switch (issue.type) {
      case "duplicate": {
        const duplicate = issue.data as DuplicateTrade;
        const guides = duplicate.entries
          .map((entry, index) => {
            const id = (entry as { id?: string }).id;
            if (!id) return null;
            const suffix = `중복 그룹 ${index + 1}/${duplicate.entries.length}`;
            return duplicate.type === "ledger"
              ? buildLedgerGuide(id, suffix)
              : buildTradeGuide(id, suffix);
          })
          .filter((guide): guide is FixGuide => guide !== null);
        return dedupeGuides(guides);
      }
      case "date_order": {
        const data = issue.data as { entryId?: string; tradeId?: string; date?: string };
        if (data.entryId) {
          const guide = buildLedgerGuide(data.entryId, "미래 날짜 항목");
          if (!guide.date && data.date) guide.date = data.date;
          return [guide];
        }
        if (data.tradeId) {
          const guide = buildTradeGuide(data.tradeId, "미래 날짜 거래");
          if (!guide.date && data.date) guide.date = data.date;
          return [guide];
        }
        return [];
      }
      case "amount_consistency": {
        const data = issue.data as { tradeId?: string };
        return data.tradeId ? [buildTradeGuide(data.tradeId, "총금액 계산값 확인 필요")] : [];
      }
      case "category_mismatch": {
        const data = issue.data as { entryId?: string };
        return data.entryId ? [buildLedgerGuide(data.entryId, "카테고리/중분류 수정 필요")] : [];
      }
      case "transfer_invalid_reference": {
        const data = issue.data as { entryId?: string };
        return data.entryId ? [buildLedgerGuide(data.entryId, "이체 계좌(from/to) 누락 확인")] : [];
      }
      case "balance_mismatch": {
        const data = issue.data as {
          accountId?: string;
          calculatedBalance?: number;
          expectedBalance?: number;
        };
        if (!data.accountId) return [];
        return [
          buildAccountGuide(
            data.accountId,
            `계산 잔액 ${Math.round(data.calculatedBalance ?? 0).toLocaleString()}원 / 기대 잔액 ${Math.round(data.expectedBalance ?? 0).toLocaleString()}원`
          )
        ];
      }
      case "missing_reference": {
        const data = issue.data as MissingReference;
        if (data.type === "account") {
          const guides: FixGuide[] = [
            buildAccountGuide(data.id, "누락된 계좌를 복구하거나 참조 항목을 수정")
          ];
          data.usedIn.slice(0, 10).forEach((usage) => {
            if (usage.type === "ledger") {
              guides.push(buildLedgerGuide(usage.id, `누락 참조 필드: ${usage.field}`));
            } else {
              guides.push(buildTradeGuide(usage.id, `누락 참조 필드: ${usage.field}`));
            }
          });
          return dedupeGuides(guides);
        }
        return [
          {
            key: `ticker:${data.id}`,
            tab: "stocks",
            tabLabel: "주식 탭",
            location: "거래내역/티커 데이터",
            id: data.id,
            detail: `누락된 티커 참조: ${data.id}`
          }
        ];
      }
      case "usd_securities_mismatch": {
        const data = issue.data as { accountId?: string; tradeUsdNet?: number; reportedUsd?: number };
        if (!data.accountId) return [];
        return [
          buildAccountGuide(
            data.accountId,
            `USD 거래합 ${Number(data.tradeUsdNet ?? 0).toFixed(2)} / 계좌 입력 ${Number(data.reportedUsd ?? 0).toFixed(2)}`
          ),
          {
            key: `usd-stocks:${data.accountId}`,
            tab: "stocks",
            tabLabel: "주식 탭",
            location: "거래내역 섹션 (해당 계좌)",
            detail: "USD 거래 합계와 계좌의 USD 잔액을 맞춰 주세요."
          }
        ];
      }
      case "transfer_pair_mismatch": {
        return [
          {
            key: "transfer-pair",
            tab: "ledger",
            tabLabel: "가계부 탭",
            location: "이체 항목 목록",
            detail: "from/to 계좌 쌍과 금액(통화 포함)을 점검하세요."
          }
        ];
      }
      default:
        return [];
    }
  };

  const handleNavigateGuide = (guide: FixGuide) => {
    if (guide.recordType && guide.id && onNavigateToRecord) {
      onNavigateToRecord({ type: guide.recordType, id: guide.id });
      return;
    }
    if (onNavigateToTab) {
      onNavigateToTab(guide.tab);
      return;
    }
    toast.error("이동 기능이 연결되지 않았습니다.");
  };

  /**
   * 중복 자동 제거 — "동일 id" 중복만 대상 (데이터 손상 케이스).
   * 내용만 같고 id가 다른 항목은 같은 날 같은 금액 2번 결제 등 정상 거래일 수 있어 경고만 한다.
   * 동일 id 그룹은 id 필터로 지우면 전부 사라지므로, 첫 occurrence만 남기는 방식으로 제거.
   */
  const handleFixDuplicates = () => {
    const duplicateIssues = issues.filter((issue) => issue.type === "duplicate") as Array<IntegrityIssue & { data: DuplicateTrade }>;
    const sameIdDups = duplicateIssues.map((issue) => issue.data).filter((dup) => dup.sameId);
    if (sameIdDups.length === 0) {
      toast.error("자동 제거 가능한 동일 ID 중복이 없습니다. (내용 동일·ID 상이 항목은 직접 확인 후 삭제하세요)");
      return;
    }

    const dupLedgerIds = new Set(
      sameIdDups.filter((d) => d.type === "ledger").flatMap((d) => d.entries.map((e) => (e as LedgerEntry).id))
    );
    const dupTradeIds = new Set(
      sameIdDups.filter((d) => d.type === "trade").flatMap((d) => d.entries.map((e) => (e as { id: string }).id))
    );
    const totalToRemove =
      data.ledger.filter((e) => dupLedgerIds.has(e.id)).length - dupLedgerIds.size +
      data.trades.filter((t) => dupTradeIds.has(t.id)).length - dupTradeIds.size;

    if (!window.confirm(`동일 ID 중복 ${totalToRemove}건을 제거합니다 (각 ID의 첫 항목만 유지). 계속할까요?`)) {
      return;
    }

    const seenLedger = new Set<string>();
    const fixedLedger = data.ledger.filter((entry) => {
      if (!dupLedgerIds.has(entry.id)) return true;
      if (seenLedger.has(entry.id)) return false;
      seenLedger.add(entry.id);
      return true;
    });
    const seenTrades = new Set<string>();
    const fixedTrades = data.trades.filter((trade) => {
      if (!dupTradeIds.has(trade.id)) return true;
      if (seenTrades.has(trade.id)) return false;
      seenTrades.add(trade.id);
      return true;
    });

    const next: AppData = { ...data, ledger: fixedLedger, trades: fixedTrades };
    onChangeData(next);

    const removed = (data.ledger.length - fixedLedger.length) + (data.trades.length - fixedTrades.length);
    toast.success(`${removed}개 중복 항목 제거됨`);
    recheckWith(next);
  };

  const handleFixMissingReferences = () => {
    const missingRefIssues = issues.filter((issue) => issue.type === "missing_reference");
    if (missingRefIssues.length === 0) {
      toast.error(ERROR_MESSAGES.NO_MISSING_REFERENCE);
      return;
    }
    if (!window.confirm("누락된 계좌 참조를 자동 수정합니다.\n가계부 항목의 깨진 계좌 연결은 해제되고, 존재하지 않는 계좌를 참조하는 주식 거래는 삭제됩니다. 계속할까요?")) {
      return;
    }

    const ledgerPatch = new Map<string, Partial<LedgerEntry>>();
    const tradeRemoveIds = new Set<string>();

    missingRefIssues.forEach((issue) => {
      const ref = issue.data as MissingReference;
      if (ref.type !== "account") return;
      ref.usedIn.forEach((usage) => {
        if (usage.type === "ledger") {
          const prev = ledgerPatch.get(usage.id) ?? {};
          if (usage.field === "fromAccountId") {
            ledgerPatch.set(usage.id, { ...prev, fromAccountId: undefined });
          } else if (usage.field === "toAccountId") {
            ledgerPatch.set(usage.id, { ...prev, toAccountId: undefined });
          }
        } else if (usage.type === "trade") {
          tradeRemoveIds.add(usage.id);
        }
      });
    });

    const fixedLedger = data.ledger.map((entry) => {
      const patch = ledgerPatch.get(entry.id);
      return patch ? { ...entry, ...patch } : entry;
    });
    const fixedTrades = data.trades.filter((trade) => !tradeRemoveIds.has(trade.id));

    const next: AppData = { ...data, ledger: fixedLedger, trades: fixedTrades };
    onChangeData(next);

    toast.success("누락된 참조 수정 완료");
    recheckWith(next);
  };

  return (
    <div>
      <div className="section-header">
        <h2>데이터 무결성 검사</h2>
        <button type="button" className="primary" onClick={runCheck} disabled={isChecking}>
          {isChecking ? "검사 중..." : "무결성 검사 실행"}
        </button>
      </div>

      {issues.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div className="pill" style={{ backgroundColor: "var(--danger-light)", color: "var(--danger)" }}>
              오류: {errorCount}
            </div>
            <div className="pill" style={{ backgroundColor: "var(--warning-light)", color: "var(--warning)" }}>
              경고: {warningCount}
            </div>
            <div className="pill" style={{ backgroundColor: "var(--accent-light)", color: "var(--accent)" }}>
              정보: {infoCount}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {issues.some((i) => i.type === "duplicate" && (i.data as DuplicateTrade).sameId) && (
              <button type="button" className="secondary" onClick={handleFixDuplicates}>
                동일 ID 중복 자동 제거
              </button>
            )}
            {issuesByType.has("missing_reference") && (
              <button type="button" className="secondary" onClick={handleFixMissingReferences}>
                누락된 참조 자동 수정
              </button>
            )}
          </div>
        </div>
      )}

      {issues.length > 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>발견된 문제</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Array.from(issuesByType.entries()).map(([type, typeIssues]) => (
              <div key={type}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                  {ISSUE_TYPE_LABEL[type]} ({typeIssues.length}건)
                </h4>

                {typeIssues.map((issue, issueIndex) => {
                  const guides = buildIssueGuides(issue);
                  const duplicateIds =
                    issue.type === "duplicate"
                      ? (issue.data as DuplicateTrade).entries
                          .map((entry) => (entry as { id?: string }).id)
                          .filter((id): id is string => Boolean(id))
                      : [];

                  return (
                    <div
                      key={`${type}-${issueIndex}`}
                      style={{
                        padding: 12,
                        border: `1px solid ${SEVERITY_COLOR[issue.severity]}`,
                        borderRadius: 8,
                        backgroundColor: `${SEVERITY_COLOR[issue.severity]}15`,
                        marginBottom: 8
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span
                          className="pill"
                          style={{
                            backgroundColor: SEVERITY_COLOR[issue.severity],
                            color: "white",
                            fontSize: 11,
                            padding: "2px 8px"
                          }}
                        >
                          {SEVERITY_LABEL[issue.severity]}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{issue.message}</span>
                      </div>

                      {duplicateIds.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                          항목 ID: {duplicateIds.join(", ")}
                        </div>
                      )}

                      {guides.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 10,
                            borderRadius: 6,
                            border: "1px dashed var(--border)",
                            backgroundColor: "var(--surface)"
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>직접 수정 경로</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {guides.map((guide, guideIndex) => (
                              <div
                                key={`${guide.key}:${guideIndex}`}
                                style={{
                                  padding: 8,
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  backgroundColor: "var(--bg)"
                                }}
                              >
                                <div style={{ fontSize: 12, marginBottom: 2 }}>
                                  탭: <strong>{guide.tabLabel}</strong> · 위치: {guide.location}
                                </div>
                                <div style={{ fontSize: 12, marginBottom: 2 }}>
                                  일자: {guide.date ?? "확인 필요"} · ID: {guide.id ?? "-"}
                                </div>
                                {guide.detail && (
                                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{guide.detail}</div>
                                )}
                                <button
                                  type="button"
                                  className="secondary"
                                  style={{ padding: "4px 8px", fontSize: 11 }}
                                  onClick={() => handleNavigateGuide(guide)}
                                >
                                  {guide.recordType && guide.id ? "해당 항목으로 이동" : "해당 탭으로 이동"}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : !isChecking ? (
        <div className="card">
          <p style={{ textAlign: "center", color: "var(--text-muted)" }}>
            아직 검사를 실행하지 않았습니다. 위 버튼을 눌러 무결성 검사를 시작하세요.
          </p>
        </div>
      ) : null}
    </div>
  );
};
