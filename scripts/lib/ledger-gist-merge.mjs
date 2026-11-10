import { createHash } from "node:crypto";

export function contentHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function transactionKey(row) {
  return JSON.stringify([row.date, row.kind, row.amount, row.currency ?? "KRW",
    row.fromAccountId ?? "", row.toAccountId ?? "", row.description.trim()]);
}

/** 최신 원격 장부에 새 거래만 추가한다. 동일 금액의 별개 거래도 개수대로 보존한다. */
export function mergeLedgerAdditions(current, additions) {
  if (!current || !Array.isArray(current.ledger) || !Array.isArray(current.accounts) || !Array.isArray(current.trades)) {
    throw new Error("원격 장부 구조를 확인할 수 없습니다.");
  }
  if (!Array.isArray(additions) || additions.length === 0) throw new Error("입력할 거래가 없습니다.");
  const accounts = new Set(current.accounts.map((row) => row.id));
  const byId = new Map(current.ledger.map((row) => [row.id, row]));
  const batchIds = new Set();
  const reservedIds = new Set(additions.filter((row) => row && byId.has(row.id)).map((row) => row.id));
  const available = new Map();
  for (const row of current.ledger) {
    if (reservedIds.has(row.id)) continue;
    const key = transactionKey(row);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const added = [];
  const skipped = [];
  for (const row of additions) {
    if (!row || typeof row.id !== "string" || !row.id || batchIds.has(row.id)) throw new Error("입력 거래 ID가 없거나 중복됩니다.");
    batchIds.add(row.id);
    const day = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "";
    const parsed = day ? new Date(`${day}T12:00:00+09:00`) : null;
    const dateValid = parsed && Number.isFinite(parsed.getTime()) && new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(parsed) === day;
    if (!dateValid || !["income", "expense", "transfer"].includes(row.kind) || !Number.isFinite(row.amount) || row.amount <= 0 || typeof row.description !== "string" || !row.description.trim()) {
      throw new Error(`거래 형식을 확인하세요: ${row.id}`);
    }
    const required = row.kind === "income" ? [row.toAccountId] : row.kind === "expense" ? [row.fromAccountId] : [row.fromAccountId, row.toAccountId];
    if (required.some((id) => !accounts.has(id)) || (row.kind === "transfer" && row.fromAccountId === row.toAccountId)) throw new Error(`계좌를 확인하세요: ${row.id}`);
    const key = transactionKey(row);
    const existing = byId.get(row.id);
    if (existing && transactionKey(existing) !== key) throw new Error(`기존 거래와 같은 ID의 내용이 다릅니다: ${row.id}`);
    if (existing || (available.get(key) ?? 0) > 0) {
      if (!existing) available.set(key, (available.get(key) ?? 0) - 1);
      skipped.push(row.id);
    } else {
      added.push(row);
    }
  }
  return { data: { ...current, ledger: [...current.ledger, ...added] }, added, skipped };
}
