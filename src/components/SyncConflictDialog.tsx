import React from "react";

export interface ConflictItem {
  id: string;
  kind: "ledger" | "account";
  field: string;
  localValue: string;
  remoteValue: string;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

export type ConflictResolution = "local" | "remote";

interface Props {
  open: boolean;
  conflicts: ConflictItem[];
  onResolve: (resolutions: Record<string, ConflictResolution>) => void;
  onCancel: () => void;
}

export const SyncConflictDialog: React.FC<Props> = ({ open, conflicts, onResolve, onCancel }) => {
  const [resolutions, setResolutions] = React.useState<Record<string, ConflictResolution>>({});

  React.useEffect(() => {
    if (open) {
      const initial: Record<string, ConflictResolution> = {};
      conflicts.forEach((c) => { initial[c.id] = "local"; });
      setResolutions(initial);
    }
  }, [open, conflicts]);

  if (!open) return null;

  const allDecided = conflicts.every((c) => resolutions[c.id]);

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div style={{
        background: "var(--surface)", padding: 16, borderRadius: 12,
        width: "min(720px, 95vw)", maxHeight: "85vh", overflow: "auto",
        border: "1px solid var(--border)"
      }}>
        <h3 style={{ marginTop: 0 }}>동기화 충돌 해결</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          로컬과 원격(Gist) 양쪽이 동일 항목을 다르게 수정했습니다. 각 항목을 어느 쪽 값으로 유지할지 선택해주세요.
        </p>

        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: 6 }}>항목</th>
              <th style={{ textAlign: "left", padding: 6 }}>필드</th>
              <th style={{ textAlign: "left", padding: 6 }}>로컬</th>
              <th style={{ textAlign: "left", padding: 6 }}>원격</th>
              <th style={{ textAlign: "center", padding: 6 }}>유지</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border-soft, var(--border))" }}>
                <td style={{ padding: 6 }}>{c.kind} · {c.id.slice(0, 8)}</td>
                <td style={{ padding: 6 }}>{c.field}</td>
                <td style={{ padding: 6 }}>{c.localValue}</td>
                <td style={{ padding: 6 }}>{c.remoteValue}</td>
                <td style={{ padding: 6, textAlign: "center" }}>
                  <select
                    value={resolutions[c.id] ?? "local"}
                    onChange={(e) => setResolutions((r) => ({ ...r, [c.id]: e.target.value as ConflictResolution }))}
                  >
                    <option value="local">로컬</option>
                    <option value="remote">원격</option>
                  </select>
                </td>
              </tr>
            ))}
            {conflicts.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: "center", color: "var(--text-muted)" }}>
                충돌 항목이 없습니다.
              </td></tr>
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 16, textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" disabled={!allDecided} onClick={() => onResolve(resolutions)}>
            적용 ({conflicts.length}건)
          </button>
        </div>
      </div>
    </div>
  );
};
