const fs = require('fs');

// === 1. Load data ===
const csvRaw = fs.readFileSync('data/전체계좌.csv', 'utf-8');
const ledger = JSON.parse(fs.readFileSync('data/ledger.json', 'utf-8'));
const accounts = JSON.parse(fs.readFileSync('data/accounts.json', 'utf-8'));

// === 2. Parse CSV ===
function parseCSV(raw) {
  const lines = raw.trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    // Simple split - no quoted commas in this data
    const cols = line.split(',');
    const amt = parseFloat(cols[3]) || 0;
    rows.push({
      sourceAccount: cols[0],
      accountNumber: cols[1],
      dateTime: cols[2],
      date: cols[2]?.split(' ')[0], // "2026-01-01"
      amount: amt,
      absAmount: Math.abs(amt),
      balanceAfter: parseFloat(cols[4]) || 0,
      type: cols[5],
      description: cols[6] || '',
      merchant: cols[7] || '',
      memo: cols[8] || '',
      originalFile: cols[9] || '',
    });
  }
  return rows;
}

// === 3. CSV Source_Account → App accountId mapping ===
const ACCOUNT_MAP = {
  'NH청년도약계좌': '청년도약',
  '농협ISA증권': 'ISA',
  '농협CMA증권': 'CMA',
  '국민나라사랑': '나라사랑',
  '국민주택청약': '주택청약',
  '삼성카드 국내': '삼성페이카드',
  '삼성카드 해외': '삼성페이카드',
  '토스증권': '토스',
  '토스뱅크': '유진성우',
  '하나청년사다리통장': '청년사다리',
  '농협2호': '농협2���',
  '키움증권': '키��',
  'OK저축은행': '저축은행',
  '삼성증권': '삼성증권',
  '농협입출금계좌': '농협',
  '케이뱅크': null,   // 앱에 없음 - 새로 만들어야 함
  '한투증권': null,    // 앱에 없음
};

// === 4. Filter out noise ===
function isNoise(row) {
  // 1원 인증
  if (row.absAmount <= 1 && (row.description === '****' || row.description === '***')) return true;
  // 0원 조정/이자
  if (row.absAmount === 0) return true;
  // 카드취소 (승인+취소 = 0이므로 쌍으로 제거)
  if (row.type === '카드취소') return true;
  return false;
}

// === 5. Handle card cancellations (net amount) ===
function processCardCancellations(rows) {
  const result = [];
  const cancels = rows.filter(r => r.type === '카드취소');
  const approvals = rows.filter(r => r.type !== '카드취소');

  for (const app of approvals) {
    // 같은 시각에 같은 가맹점에서 전체취소가 있으면 제거
    const fullCancel = cancels.find(c =>
      c.dateTime === app.dateTime &&
      c.description === app.description &&
      c.absAmount === app.absAmount
    );
    if (fullCancel) {
      // 전체취소 - 둘 다 제거
      cancels.splice(cancels.indexOf(fullCancel), 1);
      continue;
    }
    // 부분취소는 금액 차감
    const partialCancel = cancels.find(c =>
      c.dateTime === app.dateTime &&
      c.description === app.description &&
      c.absAmount < app.absAmount
    );
    if (partialCancel) {
      app.amount = app.amount + partialCancel.amount; // cancel amount is positive
      app.absAmount = Math.abs(app.amount);
      cancels.splice(cancels.indexOf(partialCancel), 1);
    }
    result.push(app);
  }
  return result;
}

// === 6. Match CSV row to ledger entry ===
function matchToLedger(csvRow, ledgerEntries, appAccountId) {
  if (!appAccountId) return null;

  const candidates = ledgerEntries.filter(le => {
    // Date match
    if (le.date !== csvRow.date) return false;
    // Account match
    const isFrom = le.fromAccountId === appAccountId;
    const isTo = le.toAccountId === appAccountId;
    if (!isFrom && !isTo) return false;
    return true;
  });

  // Try exact amount match
  for (const c of candidates) {
    if (c.amount === csvRow.absAmount) return { entry: c, matchType: 'exact' };
  }
  // Try fuzzy amount match (within 500 KRW)
  for (const c of candidates) {
    if (Math.abs(c.amount - csvRow.absAmount) <= 500) return { entry: c, matchType: 'fuzzy', diff: c.amount - csvRow.absAmount };
  }
  // Try wider fuzzy (within 5000 KRW) for larger amounts
  for (const c of candidates) {
    if (csvRow.absAmount > 10000 && Math.abs(c.amount - csvRow.absAmount) <= 5000) {
      return { entry: c, matchType: 'wide_fuzzy', diff: c.amount - csvRow.absAmount };
    }
  }
  return null;
}

// === 7. Auto-categorize unmatched entries ===
const MERCHANT_CATEGORIES = {
  // 주유/교통
  '주유소': { cat: '유류교통비', sub: '주유' },
  '오일뱅크': { cat: '유류교통비', sub: '주유' },
  'SK에너지': { cat: '유류교통비', sub: '주유' },
  '오일스타': { cat: '유류교통비', sub: '주유' },
  '청정에너지': { cat: '유류교통비', sub: '주유' },
  '쏘카': { cat: '유류교통비', sub: '교통' },
  '코레일': { cat: '유류교통비', sub: '교통' },
  '아이파킹': { cat: '유류교통비', sub: '주차' },
  '세차': { cat: '유류교통비', sub: '세차' },
  '워시': { cat: '유류교���비', sub: '세차' },

  // 식비
  '쿠팡': { cat: '식비', sub: '쿠팡' },
  '맘스터치': { cat: '식비', sub: '외식' },
  'KFC': { cat: '식���', sub: '외식' },
  '케이에프씨': { cat: '식비', sub: '외식' },
  '노브랜드버거': { cat: '식비', sub: '외식' },
  '이마트': { cat: '식비', sub: '마트' },
  'BHC': { cat: '식비', sub: '외식' },
  '비에이치씨': { cat: '식비', sub: '외식' },
  '스타벅스': { cat: '식비', sub: '카페' },
  '카페': { cat: '식비', sub: '��페' },
  '갈��': { cat: '식비', sub: '외식' },
  '와플': { cat: '식비', sub: '외식' },
  '샤브': { cat: '식���', sub: '외식' },
  '한우': { cat: '식비', sub: '���식' },
  '어묵': { cat: '식비', sub: '외식' },
  '버거': { cat: '식��', sub: '외식' },
  '성심당': { cat: '식비', sub: '간식' },
  '마켓무': { cat: '식비', sub: '간식' },
  '세븐일레븐': { cat: '식비', sub: '편의점' },
  'GS25': { cat: '식비', sub: '편의점' },
  '하림산업': { cat: '식비', sub: '마트' },
  '르솔티': { cat: '���비', sub: '카페' },
  '과자점': { cat: '식비', sub: '간식' },

  // 구독/AI
  'CLAUDE': { cat: '구독비', sub: 'Claude' },
  'CURSOR': { cat: '구독���', sub: 'Cursor' },
  'OPENAI': { cat: '구독비', sub: 'ChatGPT' },
  'XAI': { cat: '구독비', sub: 'Grok' },
  'GROK': { cat: '구독비', sub: 'Grok' },
  '구글페이먼트': { cat: '구독비', sub: 'Google' },
  '구글클라우드': { cat: '구독���', sub: 'Google Cloud' },
  '네이버플러스': { cat: '구독비', sub: '네이버' },
  '쿠팡(와우': { cat: '구독비', sub: '쿠팡와우' },
  '와우멤버십': { cat: '구독비', sub: '쿠팡와우' },
  '와우 멤버십': { cat: '구독비', sub: '쿠팡와우' },

  // 쇼핑
  '다이소': { cat: '생활용품비', sub: '다이소' },
  '아성다이소': { cat: '생활용품비', sub: '다��소' },
  '삼성전자': { cat: '생활용품비', sub: '전자' },
  '에이션패션': { cat: '의류미용비', sub: '의류' },
  '테무': { cat: '생활용품비', sub: '온라인쇼��' },
  '토스페이_테무': { cat: '��활용품비', sub: '온라인쇼핑' },
  '네이버페이': { cat: '생활��품비', sub: '온라인쇼���' },
  '스틸시리즈': { cat: '생활용품비', sub: '전자' },

  // 의료/미용
  '치과': { cat: '의료건강비', sub: '치과' },
  '약국': { cat: '의료건강비', sub: '약' },
  '블루클럽': { cat: '의류미���비', sub: '미용' },

  // 보험
  '삼성화재': { cat: '보험비', sub: '자동차보험' },

  // 문화
  '교보문고': { cat: '문화생활비', sub: '서적' },
  '종로서적': { cat: '문화생활비', sub: '서적' },
  '노래': { cat: '유흥오락비', sub: '노래방' },
  '보드게��': { cat: '유흥오락비', sub: '놀이' },

  // 데이트 관련
  '화원': { cat: '데이트비', sub: '꽃' },
  '캐치테이블': { cat: '데이트비', sub: '외식' },
  '우시야': { cat: '데이트비', sub: '외식' },
  '용용선생': { cat: '데이트비', sub: '외식' },
  '코엑스': { cat: '데이트비', sub: '문화생활' },
  '호텔': { cat: '데이��비', sub: '숙박' },
  '리젠드호텔': { cat: '데��트비', sub: '숙박' },
  '윤담': { cat: '데이트비', sub: '외식' },
  '서혜커피': { cat: '데이트비', sub: '카페' },

  // 숙박/여행
  '호텔컴': { cat: '유흥오락비', sub: '숙박' },

  // 기타
  '카카오': { cat: '생활용품비', sub: '온라인쇼핑' },
  '비바리퍼블리카': { cat: '수수료', sub: '수수료' },
  '주식회사 돕': { cat: '생활���품비', sub: '온라인쇼핑' },
  '자동차공업': { cat: '유류교��비', sub: '차량정비' },
};

function autoCategorize(csvRow) {
  const desc = csvRow.description || '';
  const merchant = csvRow.merchant || '';
  const combined = desc + ' ' + merchant;

  // 1. 카드 가맹점 매칭
  if (csvRow.type === '카드승인' || csvRow.type === '해외승인') {
    for (const [keyword, cat] of Object.entries(MERCHANT_CATEGORIES)) {
      if (combined.toUpperCase().includes(keyword.toUpperCase())) {
        return { kind: 'expense', ...cat, description: desc };
      }
    }
    return { kind: 'expense', cat: '기타', sub: '', description: desc };
  }

  // 2. 은행 거래 패턴
  // 이자
  if (csvRow.type === '이자' || desc.includes('이자') || desc.includes('결산이자')) {
    if (desc.includes('대출결산이자') || desc.includes('대출��자')) {
      return { kind: 'expense', cat: '대출상환', sub: '이자', description: desc };
    }
    return { kind: 'income', cat: '수입', sub: '이자', description: desc };
  }

  // 환전
  if (desc.includes('달러로 환전') || desc.includes('환전')) {
    return { kind: 'expense', cat: '환전', sub: '', description: desc };
  }

  // 업비트
  if (desc.includes('업비트 입금')) {
    return { kind: 'transfer', cat: '이체', sub: '계��이체', description: '���비트 입금' };
  }
  if (desc.includes('업비트 ��금')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '업비트 출금' };
  }

  // 키움 자동충전
  if (desc.includes('키움자동충전')) {
    return { kind: 'transfer', cat: '이체', sub: '계���이체', description: '키움증권 자동충전' };
  }

  // 리워드
  if (desc.includes('리워드')) {
    return { kind: 'income', cat: '수입', sub: '캐시백', description: desc };
  }

  // 실시간이체, 본인 이름 이체 → transfer
  if (desc.includes('실시간이체') || desc.includes('NH올원뱅크') || desc.includes('PC하나은행')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc };
  }

  // 이자상계
  if (desc.includes('이자상계')) {
    return { kind: 'expense', cat: '대출상환', sub: '이자', description: desc };
  }

  // 토스/농협 본인이체 패턴
  if (desc.includes('토스 김성우') || desc.includes('토뱅 김성우') || desc.includes('토뱅고유진')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이���', description: desc };
  }

  // 김성우 (본인 이름) - 대부분 본인 계좌 이체
  if (desc === '김성우') {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '본인 이체' };
  }

  // 민성현 - 타인 이체
  if (desc.includes('민성현')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc };
  }

  return { kind: 'unknown', cat: '미분류', sub: '', description: desc || '확인필요' };
}

// === 8. Run the matching ===
const csvRows = parseCSV(csvRaw);
console.log(`\n=== 전체 CSV: ${csvRows.length}건 ===\n`);

// Filter noise
const noise = csvRows.filter(isNoise);
const meaningful = csvRows.filter(r => !isNoise(r));
console.log(`노이즈 제거: ${noise.length}건 (1원인증, 0원조정, 카드취소)`);

// Process card cancellations
const cardRows = meaningful.filter(r => r.sourceAccount.startsWith('삼성카드'));
const bankRows = meaningful.filter(r => !r.sourceAccount.startsWith('삼성카드'));
const processedCards = processCardCancellations(cardRows);
const processed = [...bankRows, ...processedCards].sort((a, b) =>
  new Date(b.dateTime) - new Date(a.dateTime)
);
console.log(`카드 전체/부분취소 처리 후: ${processed.length}건`);
console.log(`  은행: ${bankRows.length}건, 카드: ${processedCards.length}건\n`);

// Track used ledger entries to prevent double matching
const usedLedgerIds = new Set();

const results = {
  matched_exact: [],
  matched_fuzzy: [],
  auto_categorized: [],
  unknown: [],
  skipped_no_account: [],
};

for (const row of processed) {
  const appAccountId = ACCOUNT_MAP[row.sourceAccount];

  if (appAccountId === null) {
    results.skipped_no_account.push(row);
    continue;
  }

  // Try matching
  const available = ledger.filter(le => !usedLedgerIds.has(le.id));
  const match = matchToLedger(row, available, appAccountId);

  if (match) {
    usedLedgerIds.add(match.entry.id);
    if (match.matchType === 'exact') {
      results.matched_exact.push({ csv: row, ledger: match.entry });
    } else {
      results.matched_fuzzy.push({ csv: row, ledger: match.entry, diff: match.diff, matchType: match.matchType });
    }
  } else {
    const auto = autoCategorize(row);
    if (auto.kind === 'unknown') {
      results.unknown.push({ csv: row, suggested: auto });
    } else {
      results.auto_categorized.push({ csv: row, suggested: auto });
    }
  }
}

// === 9. Report ===
console.log('========================================');
console.log('         매칭 결과 리포트');
console.log('========================================\n');

console.log(`✓ 정확 매칭: ${results.matched_exact.length}건`);
console.log(`≈ 근사 매칭 (금액 차이): ${results.matched_fuzzy.length}건`);
console.log(`⚡ 자동 카테고리 분류: ${results.auto_categorized.length}건`);
console.log(`? 수동 확인 필요: ${results.unknown.length}건`);
console.log(`⊘ 앱에 계좌 없음 (케이뱅크/한투): ${results.skipped_no_account.length}건`);
console.log();

// Fuzzy match details
if (results.matched_fuzzy.length > 0) {
  console.log('--- 금액 차이 있는 매칭 ---');
  for (const m of results.matched_fuzzy) {
    console.log(`  ${m.csv.date} | ${m.csv.sourceAccount} | CSV: ${m.csv.amount} → 앱: ${m.ledger.amount} (차이: ${m.diff}) | ${m.ledger.category}/${m.ledger.subCategory || ''}`);
  }
  console.log();
}

// Auto categorized breakdown
if (results.auto_categorized.length > 0) {
  console.log('--- 자동 분류 내역 (카테고리별) ---');
  const byCat = {};
  for (const a of results.auto_categorized) {
    const key = `${a.suggested.cat}/${a.suggested.sub || ''}`;
    if (!byCat[key]) byCat[key] = [];
    byCat[key].push(a);
  }
  for (const [cat, items] of Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${cat}] ${items.length}건`);
    for (const item of items.slice(0, 5)) {
      console.log(`    ${item.csv.date} | ${item.csv.sourceAccount} | ${item.csv.absAmount}원 | ${item.csv.description}`);
    }
    if (items.length > 5) console.log(`    ... 외 ${items.length - 5}��`);
  }
  console.log();
}

// Unknown
if (results.unknown.length > 0) {
  console.log('--- 수동 확인 필요 ---');
  for (const u of results.unknown) {
    console.log(`  ${u.csv.date} | ${u.csv.sourceAccount} | ${u.csv.amount > 0 ? '+' : ''}${u.csv.amount}원 | "${u.csv.description}" | ${u.csv.merchant}`);
  }
  console.log();
}

// Skipped
if (results.skipped_no_account.length > 0) {
  console.log('--- 앱에 계좌 없음 ---');
  for (const s of results.skipped_no_account) {
    console.log(`  ${s.date} | ${s.sourceAccount} | ${s.amount > 0 ? '+' : ''}${s.amount}원 | ${s.description}`);
  }
}

// Summary by account
console.log('\n--- 계좌별 요약 ---');
const accountSummary = {};
for (const row of processed) {
  const acc = row.sourceAccount;
  if (!accountSummary[acc]) accountSummary[acc] = { total: 0, matched: 0, auto: 0, unknown: 0, skipped: 0 };
  accountSummary[acc].total++;
}
for (const m of results.matched_exact) accountSummary[m.csv.sourceAccount].matched++;
for (const m of results.matched_fuzzy) accountSummary[m.csv.sourceAccount].matched++;
for (const a of results.auto_categorized) accountSummary[a.csv.sourceAccount].auto++;
for (const u of results.unknown) accountSummary[u.csv.sourceAccount].unknown++;
for (const s of results.skipped_no_account) accountSummary[s.sourceAccount].skipped++;

for (const [acc, s] of Object.entries(accountSummary).sort((a, b) => b[1].total - a[1].total)) {
  const pct = ((s.matched / s.total) * 100).toFixed(0);
  console.log(`  ${acc.padEnd(20)} | 전체: ${String(s.total).padStart(3)} | 매칭: ${String(s.matched).padStart(3)} (${pct}%) | 자동: ${String(s.auto).padStart(3)} | 미분류: ${String(s.unknown).padStart(3)} | 계좌없음: ${String(s.skipped).padStart(3)}`);
}
