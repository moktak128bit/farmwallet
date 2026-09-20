import fs from "node:fs";
import crypto from "node:crypto";

const base = JSON.parse(fs.readFileSync("data/farmwallet-data.json", "utf8"));
const rows = fs.readFileSync("data/toss/tx.tsv", "utf8").trim().split(/\r?\n/).slice(1)
  .map((l) => l.split("\t"))
  .map(([date, time, kind, ticker, name, qty, amount, balance, src]) => ({
    date, time, kind, ticker, name,
    qty: qty === "" ? null : +qty, amount: amount === "" ? null : +amount,
    balance: balance === "" ? null : +balance, src,
  }));

// ── 환율 시계열 (앱 환전 기록 + 시장 스냅샷) ──
const obs = [];
for (const e of base.ledger) {
  if (e.subCategory !== "환전이체" || e.fromAccountId !== "토스") continue;
  const m = (e.description || "").match(/환율: ([\d,.]+)/);
  if (m) obs.push({ d: e.date, fx: +m[1].replace(/,/g, "") });
}
for (const s of base.marketEnvSnapshots ?? []) if (s.fxRate > 100) obs.push({ d: s.date, fx: s.fxRate });
obs.sort((a, b) => a.d.localeCompare(b.d));
const uniq = [];
for (const o of obs) { const p = uniq.at(-1); if (p && p.d === o.d) p.fx = (p.fx + o.fx) / 2; else uniq.push({ ...o }); }
const ms = (d) => +new Date(d);
const fxAt = (d) => {
  if (d <= uniq[0].d) return uniq[0].fx;
  if (d >= uniq.at(-1).d) return uniq.at(-1).fx;
  for (let i = 1; i < uniq.length; i++) {
    if (d <= uniq[i].d) {
      const a = uniq[i - 1], b = uniq[i];
      const t = (ms(d) - ms(a.d)) / (ms(b.d) - ms(a.d));
      return +(a.fx + (b.fx - a.fx) * t).toFixed(2);
    }
  }
  return uniq.at(-1).fx;
};

const uid = (p) => `${p}-${crypto.randomUUID()}`;
const out = JSON.parse(JSON.stringify(base));

// ── ② usdBalance 정정 ──
const toss = out.accounts.find((a) => a.id === "토스");
const oldUsd = toss.usdBalance;
toss.usdBalance = 0.88;
delete toss.archived;

// ── ① 토스 USD 거래 전량 교체 (0167B0 원화 종목은 유지) ──
const keptTrades = out.trades.filter((t) => !(t.accountId === "토스" && /^[A-Za-z]/.test(t.ticker)));
const removed = out.trades.length - keptTrades.length;
const newTrades = [];
for (const r of rows) {
  if (r.kind === "buy" || r.kind === "sell") {
    if (r.qty == null || r.amount == null) continue;      // 수량 미상 행은 거래로 넣지 않음
    const total = Math.abs(r.amount);
    newTrades.push({
      id: uid("T"), date: r.date, accountId: "토스", ticker: r.ticker, name: r.name || r.ticker,
      side: r.kind, quantity: r.qty, price: +(total / r.qty).toFixed(6), fee: 0,
      totalAmount: total, cashImpact: 0, fxRateAtTrade: fxAt(r.date),
    });
  } else if (r.kind === "event_in") {                      // 출석체크 무상입고 = 원가 0 매수
    newTrades.push({
      id: uid("T"), date: r.date, accountId: "토스", ticker: r.ticker, name: r.name || r.ticker,
      side: "buy", quantity: r.qty, price: 0, fee: 0, totalAmount: 0, cashImpact: 0,
      fxRateAtTrade: fxAt(r.date),
    });
  }
}
out.trades = [...keptTrades, ...newTrades];

// ── 원장: 토스 환전/수입 재구축 ──
const appFxByUsd = new Map();
for (const e of out.ledger) {
  if (e.subCategory !== "환전이체" || !(e.fromAccountId === "토스" || e.toAccountId === "토스")) continue;
  const usd = e.currency === "USD" ? e.amount : null;
  if (usd != null) appFxByUsd.set(usd.toFixed(2), e.date);
}
const addLedger = [];
for (const r of rows) {
  if (r.kind === "fx_in" || r.kind === "fx_out") {
    const usd = Math.abs(r.amount);
    if (appFxByUsd.has(usd.toFixed(2))) continue;          // 앱에 이미 있는 환전(실제 원화액 보유)은 그대로 둔다
    const fx = fxAt(r.date);
    const krw = Math.round(usd * fx);
    const id = `fx-${crypto.randomUUID()}`;
    const desc = r.kind === "fx_in"
      ? `환전: ${krw.toLocaleString()} 원 → $${usd.toFixed(3)} (환율: ${fx}) [복원·환율추정]`
      : `환전: $${usd.toFixed(3)} → ${krw.toLocaleString()} 원 (환율: ${fx}) [복원·환율추정]`;
    if (r.kind === "fx_in") {
      addLedger.push({ id: id + "-from", date: r.date, kind: "transfer", category: "이체", subCategory: "환전이체", description: desc, fromAccountId: "토스", amount: krw, currency: "KRW" });
      addLedger.push({ id: id + "-to", date: r.date, kind: "transfer", category: "이체", subCategory: "환전이체", description: desc, toAccountId: "토스", amount: usd, currency: "USD" });
    } else {
      addLedger.push({ id: id + "-from", date: r.date, kind: "transfer", category: "이체", subCategory: "환전이체", description: desc, fromAccountId: "토스", amount: usd, currency: "USD" });
      addLedger.push({ id: id + "-to", date: r.date, kind: "transfer", category: "이체", subCategory: "환전이체", description: desc, toAccountId: "토스", amount: krw, currency: "KRW" });
    }
  } else if (r.kind === "dividend") {
    addLedger.push({ id: uid("D"), date: r.date, kind: "income", category: "수입", subCategory: "배당",
      description: `${r.ticker} - ${r.name || r.ticker} 배당`, toAccountId: "토스", amount: r.amount, currency: "USD" });
  } else if (r.kind === "interest") {
    addLedger.push({ id: uid("L"), date: r.date, kind: "income", category: "수입", subCategory: "이자",
      description: "외화예탁금이용료", toAccountId: "토스", amount: r.amount, currency: "USD", isFixedExpense: false });
  } else if (r.kind === "lending_fee") {
    addLedger.push({ id: uid("L"), date: r.date, kind: "income", category: "수입", subCategory: "기타수입",
      description: r.name, toAccountId: "토스", amount: r.amount, currency: "USD", isFixedExpense: false });
  } else if (r.kind === "deposit") {
    addLedger.push({ id: uid("L"), date: r.date, kind: "transfer", category: "이체", subCategory: "계좌이체",
      // 출금 계좌(NH투자증권 어느 계좌인지)의 달러 이력을 알 수 없으므로 한쪽(입금)만 기록한다.
      // fromAccountId를 CMA로 잡으면 CMA 달러가 -$1,482로 왜곡된다.
      description: "NH INVESTMENT AND SE 외화입금 (출금계좌 미상)", toAccountId: "토스", amount: r.amount, currency: "USD", isFixedExpense: false });
  }
}
out.ledger = [...out.ledger, ...addLedger];
out._exportedAt = new Date().toISOString();
fs.writeFileSync("data/farmwallet-import-2026-0906-toss.json", JSON.stringify(out));

console.log("환율 관측점", uniq.length, "개 :", uniq[0].d, "~", uniq.at(-1).d);
console.log("② usdBalance", oldUsd, "→", toss.usdBalance, "· 보관 해제");
console.log("① 토스 USD 거래", removed, "건 삭제 →", newTrades.length, "건 재구축 (0167B0 4건 유지)");
console.log("   원장 추가", addLedger.length, "행 (환전", addLedger.filter(e=>e.subCategory==="환전이체").length,
  "· 배당", addLedger.filter(e=>e.subCategory==="배당").length,
  "· 이자", addLedger.filter(e=>e.subCategory==="이자").length,
  "· 대여료", addLedger.filter(e=>e.subCategory==="기타수입").length,
  "· NH외화입금", addLedger.filter(e=>e.subCategory==="계좌이체").length, ")");
console.log("   trades", base.trades.length, "→", out.trades.length, "| ledger", base.ledger.length, "→", out.ledger.length);

// ── 토스 잔고 캘리브레이션 ──────────────────────────────────────────────
// currentBalance(KRW) = initialCashBalance + 수입 − 지출 + 이체순(KRW) + 거래현금 + cashAdjustment
// usdCash            = usdBalance + 이체순(USD)
// 실제 최종 잔고(복원 표 기준): KRW 0 · USD 0.88 이 되도록 기준값을 역산한다.
{
  let krwIn = 0, krwOut = 0, usdIn = 0, usdOut = 0, inc = 0, exp = 0;
  for (const e of out.ledger) {
    const usd = e.currency === "USD";
    if (e.kind === "transfer") {
      if (e.toAccountId === "토스") (usd ? (usdIn += e.amount) : (krwIn += e.amount));
      if (e.fromAccountId === "토스") (usd ? (usdOut += e.amount) : (krwOut += e.amount));
    } else if (e.kind === "income" && e.toAccountId === "토스" && !usd) inc += e.amount;
    else if (e.kind === "expense" && e.fromAccountId === "토스" && !usd) exp += e.amount;
  }
  const tradeCash = out.trades.filter((t) => t.accountId === "토스").reduce((s, t) => s + (t.cashImpact || 0), 0);
  const usdNet = usdIn - usdOut;
  const krwNet = krwIn - krwOut;
  const t2 = out.accounts.find((a) => a.id === "토스");
  const oldInit = t2.initialCashBalance ?? 0, oldAdj = t2.cashAdjustment ?? 0;
  t2.usdBalance = +(0.88 - usdNet).toFixed(2);
  // 원화는 initialCashBalance(실제 초기금)를 건드리지 않고 cashAdjustment(잔액 조정)로 맞춘다.
  // 토스는 이미 정리된 계좌라 실제 원화 잔고 0. 남는 차액은 미복원 원화 이력이므로 조정값이 정직하다.
  t2.cashAdjustment = +(0 - (inc - exp + krwNet + tradeCash + (t2.initialCashBalance ?? 0))).toFixed(0);
  fs.writeFileSync("data/farmwallet-import-2026-0906-toss.json", JSON.stringify(out));
  console.log("\n── 토스 잔고 캘리브레이션 ──");
  console.log(`  KRW: 수입 ${inc.toLocaleString()} − 지출 ${exp.toLocaleString()} + 이체순 ${Math.round(krwNet).toLocaleString()} + 거래현금 ${tradeCash.toLocaleString()}`);
  console.log(`       cashAdjustment ${oldAdj.toLocaleString()} → ${t2.cashAdjustment.toLocaleString()} (initialCashBalance ${oldInit.toLocaleString()} 유지)  ⇒ 최종 KRW 0원`);
  console.log(`  USD: 이체순 ${usdNet.toFixed(2)} ⇒ usdBalance ${t2.usdBalance} ⇒ 최종 USD $0.88`);
}
