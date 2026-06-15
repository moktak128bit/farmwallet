import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { AppData, Account, LedgerEntry } from "../types";
import { saveSafetySnapshot } from "../services/backupService";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

const TARGET_CATEGORY = "저축성지출";
const RECHECK_CATEGORY = "재테크";

/** 이 중분류는 재테크에서 "저축"으로, 나머지는 "투자"로 매핑 */
const SUB_TO_SAVINGS: ReadonlySet<string> = new Set([
  "예금",
  "적금",
  "청년도약계좌",
  "주택청약",
  "비상금",
  "빚상환용",
  "기타저축"
]);

function isTargetEntry(l: LedgerEntry): boolean {
  return l.kind === "expense" && l.category === TARGET_CATEGORY;
}

function isRecheckEntry(l: LedgerEntry): boolean {
  return l.kind === "expense" && l.category === RECHECK_CATEGORY;
}

function mapSubToRecheckSub(oldSub: string): "저축" | "투자" {
  const trimmed = (oldSub ?? "").trim();
  return SUB_TO_SAVINGS.has(trimmed) ? "저축" : "투자";
}

function defaultFromAccountId(accounts: Account[]): string {
  const found = accounts.find(
    (a) =>
      (a.institution && a.institution.includes("농협")) ||
      (a.name && a.name.includes("농협"))
  );
  return found?.id ?? "";
}

export const SavingsMigrationView: React.FC<Props> = ({ data, onChangeData }) => {
  const { accounts, ledger } = data;

  const targetEntries = useMemo(
    () => ledger.filter(isTargetEntry),
    [ledger]
  );

  const distinctSubCategories = useMemo(() => {
    const set = new Set<string>();
    targetEntries.forEach((l) => {
      const sub = (l.subCategory ?? "").trim();
      if (sub) set.add(sub);
    });
    return Array.from(set).sort();
  }, [targetEntries]);

  const [fromAccountId, setFromAccountId] = useState<string>(() =>
    defaultFromAccountId(accounts)
  );
  const [subCategoryToAccountId, setSubCategoryToAccountId] = useState<
    Record<string, string>
  >(() => ({}));

  const handleApply = async () => {
    if (!fromAccountId.trim()) {
      toast.error("출금 계좌(농협)를 선택해주세요.");
      return;
    }
    if (!window.confirm(`저축성지출 ${targetEntries.length}건의 출금·입금 계좌를 일괄 변경합니다. 계속할까요?`)) {
      return;
    }

    await saveSafetySnapshot(data, "저축성지출 계좌 일괄 변경 직전 자동 스냅샷");
    let updated = 0;
    const newLedger = ledger.map((entry) => {
      if (!isTargetEntry(entry)) return entry;
      const sub = (entry.subCategory ?? "").trim();
      const toId = sub ? subCategoryToAccountId[sub] ?? undefined : undefined;
      updated += 1;
      return {
        ...entry,
        fromAccountId: fromAccountId.trim() || undefined,
        // 매핑 안 된 중분류는 기존 입금 계좌 보존 (undefined로 덮어쓰면 입금계좌가 삭제됨)
        toAccountId: toId?.trim() || entry.toAccountId
      };
    });

    onChangeData({ ...data, ledger: newLedger });
    toast.success(`저축성지출 ${updated}건의 출금·입금 계좌를 적용했습니다.`);
  };

  /**
   * 저축성지출 → 현행 스키마(v8 이후)로 전환.
   * dataService 마이그레이션 결과와 동일한 최종 형태로 생성:
   *  - 저축 계열 → kind=transfer, category=이체, subCategory=저축이체
   *  - 그 외(투자) → kind=transfer, category=이체, subCategory=투자이체
   * (이전 구현은 v8 이전 형식(category=재테크, subCategory=저축/투자)을 만들어
   *  마이그레이션이 재실행되지 않는 한 집계에서 어긋났음.)
   */
  const handleConvertToRecheck = async () => {
    if (!window.confirm(`저축성지출 ${targetEntries.length}건을 이체(저축이체/투자이체)로 일괄 전환합니다. 계속할까요?`)) {
      return;
    }
    await saveSafetySnapshot(data, "저축성지출→이체 전환 직전 자동 스냅샷");
    let updated = 0;
    const newLedger = ledger.map((entry) => {
      if (!isTargetEntry(entry)) return entry;
      updated += 1;
      const mapped = mapSubToRecheckSub(entry.subCategory ?? "");
      return {
        ...entry,
        kind: "transfer" as const,
        category: "이체",
        subCategory: mapped === "저축" ? "저축이체" : "투자이체"
      };
    });
    onChangeData({ ...data, ledger: newLedger });
    toast.success(`저축성지출 ${updated}건을 이체(저축이체/투자이체)로 전환했습니다.`);
  };

  const recheckEntries = useMemo(() => ledger.filter(isRecheckEntry), [ledger]);
  const [recheckFromAccountId, setRecheckFromAccountId] = useState<string>(() =>
    defaultFromAccountId(accounts)
  );

  const handleRecheckFromAccountApply = async () => {
    if (!recheckFromAccountId.trim()) {
      toast.error("출금 계좌(농협)를 선택해주세요.");
      return;
    }
    if (!window.confirm(`재테크 ${recheckEntries.length}건의 출금 계좌를 일괄 변경합니다. 계속할까요?`)) {
      return;
    }
    await saveSafetySnapshot(data, "재테크 출금계좌 일괄 변경 직전 자동 스냅샷");
    let updated = 0;
    const newLedger = ledger.map((entry) => {
      if (!isRecheckEntry(entry)) return entry;
      updated += 1;
      return {
        ...entry,
        fromAccountId: recheckFromAccountId.trim() || undefined
      };
    });
    onChangeData({ ...data, ledger: newLedger });
    toast.success(`재테크 ${updated}건의 출금 계좌를 농협으로 변경했습니다.`);
  };

  const updateMapping = (subCategory: string, accountId: string) => {
    setSubCategoryToAccountId((prev) => ({
      ...prev,
      [subCategory]: accountId
    }));
  };

  const accountLabel = (a: Account) => {
    const typeLabel =
      a.type === "securities"
        ? "증권"
        : a.type === "crypto"
          ? "암호화폐"
          : a.type === "savings"
            ? "저축"
            : a.type === "checking"
              ? "입출금"
              : a.type;
    return `${a.name || a.id} (${a.institution || "-"}) [${typeLabel}]`;
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>저축성지출 일괄 수정</h3>

      {targetEntries.length === 0 ? (
        <p style={{ margin: "0 0 16px", color: "var(--text-muted)" }}>
          저축성지출 내역이 없습니다. 적용할 항목이 없습니다.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
            대상 <strong>{targetEntries.length}건</strong>. 출금 계좌를 농협으로 통일하고, 중분류별 입금 계좌를 지정한 뒤 일괄 적용합니다.
          </p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
          출금 계좌 (농협) *
        </label>
        <select
          value={fromAccountId}
          onChange={(e) => setFromAccountId(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            minWidth: 280,
            fontSize: 13
          }}
        >
          <option value="">선택하세요</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
          중분류별 입금 계좌
        </div>
        <table className="data-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>중분류</th>
              <th style={{ textAlign: "left" }}>입금 계좌</th>
            </tr>
          </thead>
          <tbody>
            {distinctSubCategories.map((sub) => (
              <tr key={sub}>
                <td>{sub}</td>
                <td>
                  <select
                    value={subCategoryToAccountId[sub] ?? ""}
                    onChange={(e) => updateMapping(sub, e.target.value)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 4,
                      minWidth: 240,
                      fontSize: 12
                    }}
                  >
                    <option value="">미지정</option>
                    {accounts
                      .filter(
                        (a) =>
                          a.type === "savings" ||
                          a.type === "securities" ||
                          a.type === "crypto" ||
                          a.type === "checking"
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="primary"
        onClick={handleApply}
        style={{ padding: "10px 20px", fontSize: 14 }}
      >
        일괄 적용
      </button>

      <hr style={{ margin: "24px 0", border: "none", borderTop: "1px solid var(--border)" }} />

      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>이체(재테크)로 전환</h3>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
        현행 스키마에 맞게 <strong>이체</strong>(kind=transfer)로 전환하고, 중분류를 <strong>저축이체</strong> 또는 <strong>투자이체</strong>로 일괄 변경합니다.
        <br />
        예금·적금·청년도약계좌·주택청약·비상금·빚상환용·기타저축 → 저축이체, 그 외 → 투자이체.
      </p>
      <button
        type="button"
        className="primary"
        onClick={handleConvertToRecheck}
        style={{ padding: "10px 20px", fontSize: 14 }}
      >
        저축성지출 {targetEntries.length}건 이체로 전환
      </button>
        </>
      )}

      {recheckEntries.length > 0 && (
        <>
          <hr style={{ margin: "24px 0", border: "none", borderTop: "1px solid var(--border)" }} />
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>재테크 출금 계좌 통일</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
            이미 재테크로 된 항목의 출금 계좌를 농협 등 원하는 계좌로 일괄 변경합니다. (현재 CMA 등으로 되어 있는 경우)
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              출금 계좌 (농협) *
            </label>
            <select
              value={recheckFromAccountId}
              onChange={(e) => setRecheckFromAccountId(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, minWidth: 280, fontSize: 13 }}
            >
              <option value="">선택하세요</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="primary"
            onClick={handleRecheckFromAccountApply}
            style={{ padding: "10px 20px", fontSize: 14 }}
          >
            재테크 {recheckEntries.length}건 출금 계좌를 농협으로 통일
          </button>
        </>
      )}
    </div>
  );
};
