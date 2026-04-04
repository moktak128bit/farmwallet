const fs = require('fs');

const ledger = JSON.parse(fs.readFileSync('data/ledger.json', 'utf-8'));
const accounts = JSON.parse(fs.readFileSync('data/accounts.json', 'utf-8'));

// === 1. CSV 최종 잔액 — 각 계좌의 가장 최근 행의 BalanceAfter ===
const csvRaw = fs.readFileSync('data/전체계좌.csv', 'utf-8');
const csvLines = csvRaw.trim().split('\n');
const csvBalances = {};
for (let i = 1; i < csvLines.length; i++) {
  const cols = csvLines[i].replace(/\r$/, '').split(',');
  const src = cols[0];
  const dt = cols[2];
  const bal = parseFloat(cols[4]) || 0;
  if (!csvBalances[src] || dt > csvBalances[src].dt) {
    csvBalances[src] = { dt, bal };
  }
}
// dt 제거, bal만 남기기
for (const k of Object.keys(csvBalances)) {
  csvBalances[k] = csvBalances[k].bal;
}

const ACCOUNT_MAP = {
  'NH청년도약계좌': '청년도약', '농협ISA증권': 'ISA', '농협CMA증권': 'CMA',
  '국민나라사랑': '나라사랑', '국민주택청약': '주택청약',
  '토스증권': '토스', '토스뱅크': '유진성우',
  '하나청년사다리통장': '청년사다리', '농협2호': '농협2호', '키움증권': '키움',
  'OK저축은행': '저축은행', '삼성증권': '삼성증권', '농협입출금계좌': '농협',
};

// 증권 계좌 cashAdjustment
const cashAdj = {};
accounts.forEach(a => { if (a.cashAdjustment) cashAdj[a.id] = a.cashAdjustment; });

// === 2. 기존 이월/이월이체 제거 ===
const setupIds = new Set();
ledger.forEach(l => {
  if (l.date === '2025-06-01' && (
    l.subCategory === '이월' || l.subCategory === '이월이체' || l.category === '이월'
  )) {
    setupIds.add(l.id);
  }
});

const cleaned = ledger.filter(l => !setupIds.has(l.id));
console.log('기존 이월/이월이체 제거:', setupIds.size, '건');

// === 3. 각 계좌별 순흐름 계산 (이월 제외) ===
const flows = {};
for (const entry of cleaned) {
  const amt = entry.amount || 0;
  if (entry.kind === 'income') {
    if (entry.toAccountId) flows[entry.toAccountId] = (flows[entry.toAccountId] || 0) + amt;
  } else if (entry.kind === 'expense') {
    if (entry.fromAccountId) flows[entry.fromAccountId] = (flows[entry.fromAccountId] || 0) - amt;
  } else if (entry.kind === 'transfer') {
    if (entry.fromAccountId) flows[entry.fromAccountId] = (flows[entry.fromAccountId] || 0) - amt;
    if (entry.toAccountId) flows[entry.toAccountId] = (flows[entry.toAccountId] || 0) + amt;
  }
}

// === 4. 필요한 이월 계산 ===
const SECURITIES = ['ISA', 'CMA', '토스', '키움', '삼성증권', '연금저축'];

console.log('\n=== 새 이월 계산 ===');
const newSetup = [];

for (const [csvName, appId] of Object.entries(ACCOUNT_MAP)) {
  const csvBal = csvBalances[csvName];
  if (csvBal === undefined) continue;

  const net = Math.round(flows[appId] || 0);
  const adj = cashAdj[appId] || 0;

  let needed;
  if (SECURITIES.includes(appId)) {
    // 이월 + net = ledger잔액, ledger잔액 + cashAdj = CSV
    // 이월 = CSV - cashAdj - net
    needed = csvBal - adj - net;
  } else {
    needed = csvBal - net;
  }
  needed = Math.round(needed);

  console.log(appId + ': CSV=' + csvBal + ', net=' + net + (adj ? ', cashAdj=' + adj : '') + ' → 이월=' + needed.toLocaleString());

  if (Math.abs(needed) <= 1) continue; // 무시

  if (needed > 0) {
    newSetup.push({
      id: 'CARRY_' + appId,
      date: '2025-06-01',
      kind: 'income',
      isFixedExpense: false,
      category: '수입',
      subCategory: '이월',
      description: appId + ' 이월잔액',
      amount: needed,
      toAccountId: appId,
    });
  } else {
    // 음수 → 이월조정 (지출)
    newSetup.push({
      id: 'CARRY_' + appId,
      date: '2025-06-01',
      kind: 'expense',
      isFixedExpense: false,
      category: '이월조정',
      subCategory: '',
      description: appId + ' 시작 잔액 조정',
      amount: Math.abs(needed),
      fromAccountId: appId,
    });
  }
}

// CSV에 없는 계좌도 확인 (유진성우 → 이미 위에서 처리됨)
// 연금저축, 카카오페이 등은 CSV에 없으므로 기존 이월 유지 안 함 (거래가 있으면 흐름만으로 결정)

console.log('\n=== 새 이월 항목 (' + newSetup.length + '건) ===');
newSetup.forEach(e => {
  const dir = e.kind === 'income' ? '+' : '-';
  console.log('  ' + e.kind + ' | ' + dir + e.amount.toLocaleString() + '원 | ' + (e.toAccountId || e.fromAccountId) + ' | ' + e.description);
});

// === 5. 합치기 ===
const final = [...newSetup, ...cleaned];
final.sort((a, b) => a.date.localeCompare(b.date) || (a.id > b.id ? 1 : -1));
// 최신순으로
final.reverse();

// === 6. 검증 ===
console.log('\n=== 검증: 최종 잔액 ===');
const verify = {};
for (const entry of final) {
  const amt = entry.amount || 0;
  if (entry.kind === 'income') {
    if (entry.toAccountId) verify[entry.toAccountId] = (verify[entry.toAccountId] || 0) + amt;
  } else if (entry.kind === 'expense') {
    if (entry.fromAccountId) verify[entry.fromAccountId] = (verify[entry.fromAccountId] || 0) - amt;
  } else if (entry.kind === 'transfer') {
    if (entry.fromAccountId) verify[entry.fromAccountId] = (verify[entry.fromAccountId] || 0) - amt;
    if (entry.toAccountId) verify[entry.toAccountId] = (verify[entry.toAccountId] || 0) + amt;
  }
}

let allOk = true;
for (const [csvName, appId] of Object.entries(ACCOUNT_MAP)) {
  const csvBal = csvBalances[csvName];
  if (csvBal === undefined) continue;
  const adj = cashAdj[appId] || 0;
  const ledgerBal = Math.round(verify[appId] || 0);
  const actualBal = SECURITIES.includes(appId) ? ledgerBal + adj : ledgerBal;
  const diff = actualBal - csvBal;
  const ok = Math.abs(diff) <= 2;
  if (!ok) allOk = false;
  console.log('  ' + appId.padEnd(12) + ' | ledger: ' + ledgerBal.toLocaleString().padStart(12) +
    (adj ? ' + adj ' + adj.toLocaleString() : '') +
    ' = ' + actualBal.toLocaleString().padStart(12) +
    ' | CSV: ' + csvBal.toLocaleString().padStart(12) +
    ' | ' + (ok ? '✓' : '⚠ 차이:' + diff));
}

if (allOk) {
  console.log('\n✓ 모든 계좌 잔액 일치!');
} else {
  console.log('\n⚠ 일부 계좌 불일치 있음');
}

// 저장
fs.writeFileSync('data/ledger.json', JSON.stringify(final, null, 2), 'utf-8');
console.log('\n✓ data/ledger.json 저장 완료 (' + final.length + '건)');
