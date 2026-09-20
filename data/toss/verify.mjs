import fs from "node:fs";
const R = fs.readFileSync("data/toss/tx.tsv", "utf8").trim().split(/\r?\n/).slice(1)
  .map((l) => l.split("\t"))
  .map(([date, time, kind, ticker, name, qty, amount, balance, src]) => ({
    date, time, kind, ticker, name,
    qty: qty === "" ? null : +qty,
    amount: amount === "" ? null : +amount,
    balance: balance === "" ? null : +balance, src,
  }));

// 현금 이동만 체인 대상 (수량만 있는 입고·대차 제외)
const cash = R.filter((r) => r.amount != null);
cash.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

// 같은 (날짜,시각) 묶음 안에서는 잔액이 이어지도록 재배열
const groups = [];
for (const r of cash) {
  const k = r.date + " " + r.time;
  if (!groups.length || groups.at(-1).k !== k) groups.push({ k, rows: [r] });
  else groups.at(-1).rows.push(r);
}
const eq = (a, b) => Math.abs(a - b) < 0.011;
let prevBal = null, gaps = [], ordered = [];
for (const g of groups) {
  let pool = [...g.rows], seq = [], cur = prevBal;
  // 잔액을 아는 행부터 체인 연결 시도
  for (let n = 0; n < g.rows.length; n++) {
    let i = pool.findIndex((r) => cur != null && r.balance != null && eq(cur + r.amount, r.balance));
    if (i < 0) i = pool.findIndex((r) => r.balance == null);   // 잔액 미표시 행은 순서 확정 불가 → 통과
    if (i < 0) break;
    const r = pool.splice(i, 1)[0];
    seq.push(r);
    if (r.balance != null) cur = r.balance;
    else if (cur != null) cur = +(cur + r.amount).toFixed(2);
  }
  if (pool.length) {
    const known = pool.filter((r) => r.balance != null);
    gaps.push({ at: g.k, prevBal, need: known.map((r) => `${r.name || r.ticker} ${r.amount} → ${r.balance}`) });
    for (const r of pool) { seq.push(r); if (r.balance != null) cur = r.balance; }
  }
  ordered.push(...seq);
  prevBal = cur;
}

console.log(`── 현금 이동 ${cash.length}행 · 묶음 ${groups.length}개 ──`);
if (!gaps.length) console.log("  ✅ 잔액 체인 완전 연결 — 누락 없음");
else {
  console.log(`  ⚠ 체인 끊김 ${gaps.length}곳 (= 아직 안 옮긴 구간)\n`);
  for (const g of gaps.slice(0, 12))
    console.log(`   ${g.at}  직전잔액 ${g.prevBal ?? "-"} 에서 연결 안 됨\n      ${g.need.slice(0, 3).join("\n      ")}`);
  if (gaps.length > 12) console.log(`   ... 외 ${gaps.length - 12}곳`);
}
const last = ordered.filter((r) => r.balance != null).at(-1);
console.log(`\n  최종 잔액 ${last ? "$" + last.balance.toFixed(2) : "-"}  (${last?.date})`);
const d = R.map((r) => r.date).sort();
console.log(`  전체 ${R.length}행 · ${d[0]} ~ ${d.at(-1)} · 종목 ${new Set(R.map(r=>r.ticker).filter(Boolean)).size}개`);
