import React, { useMemo, useState } from "react";
import type { AppData } from "../types";
import { runIntegrityCheck, mergeDuplicates, type IntegrityIssue, type DuplicateTrade } from "../utils/dataIntegrity";
import { toast } from "react-hot-toast";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

export const DataIntegrityView: React.FC<Props> = ({ data, onChangeData }) => {
  const [issues, setIssues] = useState<IntegrityIssue[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());

  const runCheck = () => {
    setIsChecking(true);
    try {
      const foundIssues = runIntegrityCheck(data.accounts, data.ledger, data.trades);
      setIssues(foundIssues);
      toast.success(`검사 완료: ${foundIssues.length}개 문제 발견`);
    } catch (error) {
      console.error("무결성 검사 오류:", error);
      toast.error("무결성 검사 중 오류가 발생했습니다");
    } finally {
      setIsChecking(false);
    }
  };

  const issuesByType = useMemo(() => {
    const grouped = new Map<string, IntegrityIssue[]>();
    issues.forEach((issue) => {
      if (!grouped.has(issue.type)) {
        grouped.set(issue.type, []);
      }
      grouped.get(issue.type)!.push(issue);
    });
    return grouped;
  }, [issues]);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  const handleFixDuplicates = () => {
    const duplicateIssues = issues.filter((i) => i.type === "duplicate") as Array<IntegrityIssue & { data: DuplicateTrade }>;
    if (duplicateIssues.length === 0) {
      toast.error("중복 항목이 없습니다");
      return;
    }

    const duplicates = duplicateIssues.map((i) => i.data);
    const { ledger: ledgerToRemove, trades: tradesToRemove } = mergeDuplicates(duplicates, true);

    const newLedger = data.ledger.filter((l) => !ledgerToRemove.has(l.id));
    const newTrades = data.trades.filter((t) => !tradesToRemove.has(t.id));

    onChangeData({
      ...data,
      ledger: newLedger,
      trades: newTrades
    });

    toast.success(`${ledgerToRemove.size + tradesToRemove.size}개 중복 항목 제거됨`);
    runCheck(); // 다시 검사
  };

  const handleFixMissingReferences = () => {
    const missingRefIssues = issues.filter((i) => i.type === "missing_reference");
    if (missingRefIssues.length === 0) {
      toast.error("누락된 참조가 없습니다");
      return;
    }

    // 누락된 계좌 참조를 제거하거나 기본값으로 변경
    let fixedLedger = [...data.ledger];
    let fixedTrades = [...data.trades];

    missingRefIssues.forEach((issue) => {
      const ref = issue.data as any;
      if (ref.type === "account") {
        ref.usedIn.forEach((usage: any) => {
          if (usage.type === "ledger") {
            const entry = fixedLedger.find((l) => l.id === usage.id);
            if (entry) {
              if (usage.field === "fromAccountId") {
                entry.fromAccountId = undefined;
              } else if (usage.field === "toAccountId") {
                entry.toAccountId = undefined;
              }
            }
          } else if (usage.type === "trade") {
            const trade = fixedTrades.find((t) => t.id === usage.id);
            if (trade) {
              // 주식 거래는 계좌가 필수이므로 삭제
              fixedTrades = fixedTrades.filter((t) => t.id !== usage.id);
            }
          }
        });
      }
    });

    onChangeData({
      ...data,
      ledger: fixedLedger,
      trades: fixedTrades
    });

    toast.success("누락된 참조 수정 완료");
    runCheck();
  };

  const severityColors = {
    error: "var(--danger)",
    warning: "var(--warning)",
    info: "var(--accent)"
  };

  const severityLabels = {
    error: "오류",
    warning: "경고",
    info: "정보"
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

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {issuesByType.has("duplicate") && (
              <button type="button" className="secondary" onClick={handleFixDuplicates}>
                중복 항목 자동 제거
              </button>
            )}
            {issuesByType.has("missing_reference") && (
              <button type="button" className="secondary" onClick={handleFixMissingReferences}>
                누락된 참조 수정
              </button>
            )}
          </div>
        </div>
      )}

      {issues.length > 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>발견된 문제</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from(issuesByType.entries()).map(([type, typeIssues]) => (
              <div key={type}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                  {type === "duplicate" && "중복 거래"}
                  {type === "balance_mismatch" && "잔액 불일치"}
                  {type === "missing_reference" && "누락된 참조"}
                  {type === "date_order" && "날짜 순서"}
                  {type === "amount_consistency" && "금액 일관성"}
                  ({typeIssues.length}건)
                </h4>
                {typeIssues.map((issue, idx) => (
                  <div
                    key={`${type}-${idx}`}
                    style={{
                      padding: 12,
                      border: `1px solid ${severityColors[issue.severity]}`,
                      borderRadius: 8,
                      backgroundColor: `${severityColors[issue.severity]}15`,
                      marginBottom: 8
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        className="pill"
                        style={{
                          backgroundColor: severityColors[issue.severity],
                          color: "white",
                          fontSize: 11,
                          padding: "2px 8px"
                        }}
                      >
                        {severityLabels[issue.severity]}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{issue.message}</span>
                    </div>
                    {issue.type === "duplicate" && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        항목 ID: {(issue.data as DuplicateTrade).entries.map((e: any) => e.id).join(", ")}
                      </div>
                    )}
                    {issue.type === "balance_mismatch" && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        계산된 잔액: {(issue.data as any).calculatedBalance.toLocaleString()}원, 예상 잔액:{" "}
                        {(issue.data as any).expectedBalance.toLocaleString()}원
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : issues.length === 0 && !isChecking ? (
        <div className="card">
          <p style={{ textAlign: "center", color: "var(--text-muted)" }}>
            아직 검사를 실행하지 않았습니다. 위의 버튼을 클릭하여 데이터 무결성을 검사하세요.
          </p>
        </div>
      ) : null}
    </div>
  );
};





