import fs from "node:fs";
const rows = fs.readFileSync("data/toss/tx.tsv", "utf8").trim().split(/\r?\n/).slice(1)
  .map((l) => l.split("\t"))
  .map(([date, time, kind, ticker, name, qty, amount, balance, src]) => ({
    date, time, kind, ticker, name,
    qty: qty === "" ? null : +qty,
    amount: amount === "" ? null : +amount,
    balance: balance === "" ? null : +balance,
    src,
  }));

// 잔액이 있는 행만 체인 검증 (시간순)
const chain = rows.filter((r) => r.balance != null && r.amount != null);
let bad = 0, prev = null;
console.log("── 잔액 체인 검증 (이전잔액 + 금액 = 현재잔액) ──");
for (const r of chain) {
  if (prev) {
    const expect = +(prev.balance + r.amount).toFixed(2);
    if (Math.abs(expect - r.balance) > 0.011) {
      bad++;
      console.log(`  ⚠ ${r.date} ${r.time} ${(r.name || r.ticker).padEnd(14)} ${String(r.amount).padStart(9)}`);
      console.log(`      이전 ${prev.balance.toFixed(2)} + ${r.amount} = ${expect.toFixed(2)}  ≠ 기록 ${r.balance.toFixed(2)}   (차이 ${(r.balance - expect).toFixed(2)})`);
    }
  }
  prev = r;
}
console.log(`\n  검증 대상 ${chain.length}행 · 체인 불일치 ${bad}건`);

// 요약
const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log("\n── 유형별 ──");
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);
const tk = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];
console.log(`\n── 종목 ${tk.length}개 ──\n  ${tk.join(" · ")}`);
const d = rows.map((r) => r.date).sort();
console.log(`\n── 기간 ── ${d[0]} ~ ${d[d.length - 1]}  (${rows.length}행)`);
