import test from "node:test";
import assert from "node:assert/strict";
import { mergeLedgerAdditions } from "../lib/ledger-gist-merge.mjs";

const entry = (id, extra = {}) => ({ id, date: "2026-10-18", kind: "expense", amount: 7000, description: "가게", fromAccountId: "card", ...extra });
const data = (ledger = []) => ({ accounts: [{ id: "card" }, { id: "ISA" }], ledger, trades: [{ id: "T1" }], savingsGoals: [{ id: "S1" }], arbitraryUserSetting: { preserve: true } });

test("원격 사용자 설정과 기존 거래를 보존하며 누락 거래만 추가한다", () => {
  const original = data([entry("old", { amount: 5000 })]);
  const result = mergeLedgerAdditions(original, [entry("new")]);
  assert.equal(result.added.length, 1);
  assert.equal(result.data.ledger.length, 2);
  assert.equal(original.ledger.length, 1);
  for (const key of Object.keys(original).filter((key) => key !== "ledger")) assert.strictEqual(result.data[key], original[key]);
});
test("반복 실행해도 같은 ID의 거래를 중복 입력하지 않는다", () => {
  const first = mergeLedgerAdditions(data(), [entry("new")]);
  const again = mergeLedgerAdditions(first.data, [entry("new")]);
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped.length, 1);
  assert.equal(again.data.ledger.length, 1);
});
test("같은 금액·가게·날짜의 실제 두 결제는 두 건으로 보존한다", () => {
  const result = mergeLedgerAdditions(data([entry("known")]), [entry("photo-1"), entry("photo-2")]);
  assert.equal(result.added.length, 1);
  assert.equal(result.data.ledger.length, 2);
});
test("뒤에 나오는 기존 ID를 다른 동일 결제의 중복 판정에 쓰지 않는다", () => {
  const result = mergeLedgerAdditions(data([entry("known")]), [entry("new"), entry("known")]);
  assert.deepEqual(result.added.map((row) => row.id), ["new"]);
  assert.deepEqual(result.skipped, ["known"]);
});
test("같은 ID의 금액이 바뀌면 기존 거래를 덮어쓰지 않고 중단한다", () => {
  assert.throws(() => mergeLedgerAdditions(data([entry("known")]), [entry("known", { amount: 8000 })]), /내용이 다릅니다/);
});
test("계좌·날짜·금액·중복 ID가 불명확하면 중단한다", () => {
  for (const extra of [{ fromAccountId: "missing" }, { date: "2026-02-30" }, { amount: -1 }, { amount: null }]) {
    assert.throws(() => mergeLedgerAdditions(data(), [entry("bad", extra)]));
  }
  assert.throws(() => mergeLedgerAdditions(data(), [entry("same"), entry("same")]));
});
test("ISA 입금은 소비가 아닌 계좌 이체로 그대로 보존한다", () => {
  const transfer = entry("transfer", { kind: "transfer", amount: 200000, toAccountId: "ISA" });
  const result = mergeLedgerAdditions(data(), [transfer]);
  assert.deepEqual(result.data.ledger[0], transfer);
});
