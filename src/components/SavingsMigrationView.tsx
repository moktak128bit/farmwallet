import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import type { AppData, Account, LedgerEntry } from "../types";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

const TARGET_CATEGORY = "저축성지출";
const RECHECK_CATEGORY = "재테크";

/** 이 세부 항목은 재테크에서 "저축"으로, 나머지는 "투자"로 매핑 */
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

  const handleApply = () => {
    if (!fromAccountId.trim()) {
      toast.error("출금 계좌(농협)를 선택해주세요.");
      return;
    }

    let updated = 0;
    const newLedger = ledger.map((entry) => {
      if (!isTargetEntry(entry)) return entry;
      const sub = (entry.subCategory ?? "").trim();
      const toId = sub ? subCategoryToAccountId[sub] ?? undefined : undefined;
      updated += 1;
      return {
        ...entry,
        fromAccountId: fromAccountId.trim() || undefined,
        toAccountId: toId?.trim() || undefined
      };
    });

    onChangeData({ ...data, ledger: newLedger });
    toast.success(`저축성지출 ${updated}건의 출금·입금 계좌를 적용했습니다.`);
  };

  const handleConvertToRecheck = () => {
    let updated = 0;
    const newLedger = ledger.map((entry) => {
      if (!isTargetEntry(entry)) return entry;
      updated += 1;
      return {
        ...entry,
        category: RECHECK_CATEGORY,
        subCategory: mapSubToRecheckSub(entry.subCategory ?? "")
      };
    });
    onChangeData({ ...data, ledger: newLedger });
    toast.success(`저축성지출 ${updated}건을 재테크(저축/투자)로 전환했습니다.`);
  };

  const recheckEntries = useMemo(() => ledger.filter(isRecheckEntry), [ledger]);
  const [recheckFromAccountId, setRecheckFromAccountId] = useState<string>(() =>
    defaultFromAccountId(accounts)
  );

  const handleRecheckFromAccountApply = () => {
    if (!recheckFromAccountId.trim()) {
      toast.error("출금 계좌(농협)를 선택해주세요.");
      return;
    }
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
            대상 <strong>{targetEntries.length}건</strong>. 출금 계좌를 농협으로 통일하고, 세부 항목별 입금 계좌를 지정한 뒤 일괄 적용합니다.
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
          세부 항목별 입금 계좌
        </div>
        <table className="data-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>세부 항목</th>
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

      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>재테크로 전환</h3>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-muted)" }}>
        대분류를 <strong>재테크</strong>로, 세부 항목을 <strong>저축</strong> 또는 <strong>투자</strong>로 일괄 변경합니다.
        <br />
        예금·적금·청년도약계좌·주택청약·비상금·빚상환용·기타저축 → 저축, 그 외 → 투자.
      </p>
      <button
        type="button"
        className="primary"
        onClick={handleConvertToRecheck}
        style={{ padding: "10px 20px", fontSize: 14 }}
      >
        저축성지출 {targetEntries.length}건 재테크로 전환
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
