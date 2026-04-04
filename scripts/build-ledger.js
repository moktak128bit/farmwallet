const fs = require('fs');

// === 1. Load ===
const csvRaw = fs.readFileSync('data/전체계좌.csv', 'utf-8');
const ledger = JSON.parse(fs.readFileSync('data/ledger.json', 'utf-8'));

// === 2. CSV parse ===
function parseCSV(raw) {
  const lines = raw.trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r$/, '').split(',');
    const amt = parseFloat(cols[3]) || 0;
    rows.push({
      sourceAccount: cols[0],
      dateTime: cols[2],
      date: cols[2]?.split(' ')[0],
      amount: amt,
      absAmount: Math.abs(amt),
      type: cols[5],
      description: cols[6] || '',
      merchant: cols[7] || '',
      memo: cols[8] || '',
    });
  }
  return rows;
}

// === 3. Account mapping ===
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
  '농협2호': '농협2호',
  '키움증권': '키움',
  'OK저축은행': '저축은행',
  '삼성증권': '삼성증권',
  '농협입출금계좌': '농협',
  '케이뱅크': '케이뱅크',
  '한투증권': '한투증권',
};

// === 4. Noise filter ===
function isNoise(r) {
  if (r.absAmount <= 1 && (r.description === '****' || r.description === '***')) return true;
  if (r.absAmount === 0) return true;
  if (r.type === '카드취소') return true;
  return false;
}

// === 5. Card cancellation netting ===
function processCards(rows) {
  const result = [];
  const cancels = rows.filter(r => r.type === '카드취소');
  const apps = rows.filter(r => r.type !== '카드취소');
  for (const a of apps) {
    const full = cancels.find(c => c.dateTime === a.dateTime && c.description === a.description && c.absAmount === a.absAmount);
    if (full) { cancels.splice(cancels.indexOf(full), 1); continue; }
    const part = cancels.find(c => c.dateTime === a.dateTime && c.description === a.description && c.absAmount < a.absAmount);
    if (part) { a.amount += part.amount; a.absAmount = Math.abs(a.amount); cancels.splice(cancels.indexOf(part), 1); }
    result.push(a);
  }
  return result;
}

// === 6. Merchant category map ===
const MERCHANT_CATS = [
  // 주유/교통
  [/주유소|오일뱅크|SK에너지|오일스타|청정에너지/i, { cat: '유류교통비', sub: '주유' }],
  [/쏘카/i, { cat: '유류교통비', sub: '교통' }],
  [/코레일/i, { cat: '유류교통비', sub: '교통' }],
  [/아이파킹/i, { cat: '유류교통비', sub: '주차' }],
  [/세차|워시/i, { cat: '유류교통비', sub: '세차' }],
  [/자동차공업/i, { cat: '유류교통비', sub: '차량정비' }],

  // 구독/AI
  [/CLAUDE/i, { cat: '구독비', sub: 'Claude' }],
  [/CURSOR/i, { cat: '구독비', sub: 'Cursor' }],
  [/OPENAI|CHATGPT/i, { cat: '구독비', sub: 'ChatGPT' }],
  [/XAI|GROK/i, { cat: '구독비', sub: 'Grok' }],
  [/구글페이먼트|구글클라우드/i, { cat: '구독비', sub: 'Google' }],
  [/네이버플러스 멤버십/i, { cat: '구독비', sub: '네이버' }],
  [/와우.?멤버십|쿠팡\(와우/i, { cat: '구독비', sub: '쿠팡와우' }],

  // 보험
  [/삼성화재/i, { cat: '보험비', sub: '자동차보험' }],

  // 식비
  [/이마트/i, { cat: '식비', sub: '마트' }],
  [/맘스터치/i, { cat: '식비', sub: '외식' }],
  [/KFC|케이에프씨/i, { cat: '식비', sub: '외식' }],
  [/노브랜드버거/i, { cat: '식비', sub: '외식' }],
  [/BHC|비에이치씨/i, { cat: '식비', sub: '외식' }],
  [/스타벅스/i, { cat: '식비', sub: '카페' }],
  [/갈비|한우|샤브|어묵|쉼어묵|꾸석지/i, { cat: '식비', sub: '외식' }],
  [/와플대학/i, { cat: '식비', sub: '외식' }],
  [/성심당/i, { cat: '식비', sub: '간식' }],
  [/마켓무/i, { cat: '식비', sub: '간식' }],
  [/세븐일레븐|GS25|지에스/i, { cat: '식비', sub: '편의점' }],
  [/하림산업/i, { cat: '식비', sub: '마트' }],
  [/르솔티|카페진리|서혜커피/i, { cat: '식비', sub: '카페' }],
  [/과자점|앙토낭/i, { cat: '식비', sub: '간식' }],
  [/삼청동샤브/i, { cat: '식비', sub: '외식' }],
  [/쿠팡/i, { cat: '식비', sub: '쿠팡' }],

  // 데이트
  [/화원|우리화원/i, { cat: '데이트비', sub: '꽃' }],
  [/캐치테이블/i, { cat: '데이트비', sub: '외식' }],
  [/우시야/i, { cat: '데이트비', sub: '외식' }],
  [/용용선생/i, { cat: '데이트비', sub: '외식' }],
  [/환이네갈비/i, { cat: '데이트비', sub: '외식' }],
  [/코엑스|신세계프라퍼티/i, { cat: '데이트비', sub: '문화생활' }],
  [/윤담/i, { cat: '데이트비', sub: '외식' }],

  // 의료/미용
  [/치과|고릴라치과/i, { cat: '의료건강비', sub: '치과' }],
  [/약국/i, { cat: '의료건강비', sub: '약' }],
  [/블루클럽/i, { cat: '의류미용비', sub: '미용' }],

  // 문화
  [/교보문고|종로서적/i, { cat: '문화생활비', sub: '서적' }],
  [/노래연습장|노래방/i, { cat: '유흥오락비', sub: '노래방' }],
  [/보드게임|팜스보드/i, { cat: '유흥오락비', sub: '놀이' }],

  // 쇼핑/생활
  [/다이소|아성다이소/i, { cat: '생활용품비', sub: '다이소' }],
  [/삼성전자\(주\)/i, { cat: '생활용품비', sub: '전자' }],
  [/에이션패션/i, { cat: '의류미용비', sub: '의류' }],
  [/테무/i, { cat: '생활용품비', sub: '온라인쇼핑' }],
  [/네이버페이/i, { cat: '생활용품비', sub: '온라인쇼핑' }],
  [/네이버.*웹툰/i, { cat: '구독비', sub: '웹툰' }],
  [/스틸시리즈/i, { cat: '생활용품비', sub: '전자' }],
  [/비바리퍼블리카/i, { cat: '수수료', sub: '수수료' }],
  [/주식회사 돕/i, { cat: '생활용품비', sub: '온라인쇼핑' }],
  [/움버거앤윙스/i, { cat: '식비', sub: '외식' }],

  // 숙박
  [/호텔컴/i, { cat: '유흥오락비', sub: '숙박' }],
  [/리젠드호텔/i, { cat: '데이트비', sub: '숙박' }],

  // 카카오
  [/카카오(?!뱅크)/i, { cat: '생활용품비', sub: '온라인쇼핑' }],
];

// === 7. Auto-categorize ===
function autoCategorize(row) {
  const desc = row.description || '';
  const merchant = row.merchant || '';
  const combined = desc + ' ' + merchant;
  const accId = ACCOUNT_MAP[row.sourceAccount];
  const isIncome = row.amount > 0;

  // --- 카드 ---
  if (row.type === '카드승인' || row.type === '해외승인') {
    for (const [regex, cat] of MERCHANT_CATS) {
      if (regex.test(combined)) {
        return { kind: 'expense', ...cat, description: desc, fromAccountId: accId };
      }
    }
    // 기타 카드
    return { kind: 'expense', cat: '기타', sub: '', description: desc, fromAccountId: accId };
  }

  // --- 은행/증권 ---

  // 이자
  if (row.type === '이자' || desc.includes('통장 이자') || desc === '이자' || desc.includes('예탁금이용료')) {
    return { kind: 'income', cat: '수입', sub: '이자', description: desc, toAccountId: accId };
  }
  if (desc.includes('대출결산이자') || desc.includes('대출이자')) {
    return { kind: 'expense', cat: '대출상환', sub: '이자', description: desc, fromAccountId: accId };
  }
  if (desc.includes('이자상계')) {
    return { kind: 'expense', cat: '대출상환', sub: '이자', description: '이자상계', fromAccountId: accId };
  }
  if (desc.includes('결산이자') && !desc.includes('대출')) {
    return { kind: 'income', cat: '수입', sub: '이자', description: desc, toAccountId: accId };
  }
  if (desc === '예금이자') {
    return { kind: 'income', cat: '수입', sub: '이자', description: desc, toAccountId: accId };
  }

  // 환전
  if (desc.includes('달러로 환전') || desc.includes('환전')) {
    return { kind: 'expense', cat: '환전', sub: '', description: desc, fromAccountId: accId };
  }

  // 리워드
  if (desc.includes('리워드')) {
    return { kind: 'income', cat: '수입', sub: '캐시백', description: desc, toAccountId: accId };
  }

  // --- 특정 수동 매핑 (사용자가 알려준 것) ---

  // CD현금 ATM
  if (desc === 'CD현금' && row.absAmount === 2850000) {
    return { kind: 'income', cat: '수입', sub: '지원', description: '외할머니 지원', toAccountId: accId };
  }
  if (desc === 'CD현금' && row.absAmount === 120000) {
    return { kind: 'income', cat: '수입', sub: '용돈', description: '용돈', toAccountId: accId };
  }
  if (desc === 'CD현금' && row.absAmount === 1500000) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '현금입금', toAccountId: accId };
  }
  // 참가비, 교통비 입금
  if (merchant === '참가비') {
    return { kind: 'income', cat: '수입', sub: '정산', description: '참가비', toAccountId: accId };
  }
  if (merchant === '교통비') {
    return { kind: 'income', cat: '수입', sub: '정산', description: '교통비', toAccountId: accId };
  }
  // PC우리은행 입금
  if (desc === 'PC우리은행' && row.absAmount === 30000) {
    return { kind: 'income', cat: '수입', sub: '', description: '', toAccountId: accId };
  }
  if (desc === 'PC우리은행' && row.absAmount === 6000) {
    return { kind: 'income', cat: '수입', sub: '정산', description: '정산', toAccountId: accId };
  }
  // PC신한은�� 81300
  if (desc === 'PC신한은행' && merchant === '김성우' && row.absAmount === 81300) {
    return { kind: 'income', cat: '수입', sub: '정산', description: '정산', toAccountId: accId };
  }
  // 신한카드 1원 인증
  if (desc === 'PC신한은행' && row.absAmount <= 1) {
    return null; // 노이즈 - 제거
  }

  // --- 카드대금 ---
  if (desc === '카드대금' || merchant?.includes('삼성카드')) {
    return { kind: 'expense', cat: '신용결제', sub: '신용결제', description: '삼성카드 결제', fromAccountId: accId };
  }

  // --- 업비트 ---
  if (desc.includes('업비트 입금')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '업비트 입금', fromAccountId: accId, toAccountId: '업비트' };
  }
  if (desc.includes('업비트 출금')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '업비트 출금', fromAccountId: '업비트', toAccountId: accId };
  }

  // --- ���권사 입출금 (재테크) ---
  const SECURITIES = ['ISA', 'CMA', '삼성증권', '키움', '토스', '한투증권'];
  if (SECURITIES.includes(accId)) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc || '증권 입금', toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc || '증권 출금', fromAccountId: accId };
    }
  }

  // --- 본인 이체 패턴 ---
  if (desc.includes('토스 김성우') || desc.includes('토뱅 김성우') || desc.includes('토뱅고유진')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, fromAccountId: accId };
    }
  }
  if (desc.includes('실시간이체') || desc.includes('NH올원뱅크') || desc.includes('PC하나은행') || desc.includes('폰하나은행')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, fromAccountId: accId };
    }
  }
  if (desc.includes('스마트당행')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, fromAccountId: accId };
    }
  }
  // 오픈뱅킹 이체
  if (desc === '오픈뱅킹' || desc.includes('오픈뱅킹')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: merchant || '오픈뱅킹', toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: merchant || '오픈뱅킹', fromAccountId: accId };
    }
  }
  // E-증권사
  if (desc.startsWith('E-') || desc.includes('폰키움증권')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, fromAccountId: accId };
    }
  }

  // 김성우 (본인)
  if (desc === '김성우') {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '본인 이체', toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '본인 이체', fromAccountId: accId };
    }
  }
  // 민성현
  if (desc.includes('민성현')) {
    if (isIncome) {
      return { kind: 'income', cat: '수입', sub: '', description: desc, toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: desc, fromAccountId: accId };
    }
  }

  // 일반업무(자동화) - 나라사랑 자동이체
  if (merchant?.includes('일반업무') || desc.includes('일반업무')) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '자동이체', toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '자동이체', fromAccountId: accId };
    }
  }

  // OK저축은행 → 하나 청년사다리 이체
  if (desc.includes('하나전자') || (desc === '김성우' && merchant?.includes('하나전자'))) {
    if (isIncome) {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '저축은행→청년사다리', toAccountId: accId };
    } else {
      return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '저축은행→청년사다리', fromAccountId: accId };
    }
  }

  // 72원 소액 입금
  if (row.absAmount <= 100 && isIncome) {
    return { kind: 'income', cat: '수입', sub: '캐시백', description: desc || '소액입금', toAccountId: accId };
  }

  // 키움자동충전
  if (desc.includes('키움자동충전') || merchant?.includes('키움자동충전')) {
    return { kind: 'transfer', cat: '이체', sub: '계좌이체', description: '키움 자동충전', fromAccountId: accId, toAccountId: '키움' };
  }

  // 나머지
  if (isIncome) {
    return { kind: 'income', cat: '미분류', sub: '', description: combined.trim(), toAccountId: accId };
  } else {
    return { kind: 'expense', cat: '미분류', sub: '', description: combined.trim(), fromAccountId: accId };
  }
}

// === 8. Build new ledger ===
const csvRows = parseCSV(csvRaw);
const meaningful = csvRows.filter(r => !isNoise(r));
const cardRows = meaningful.filter(r => r.sourceAccount.startsWith('삼성카드'));
const bankRows = meaningful.filter(r => !r.sourceAccount.startsWith('삼성카드'));
const processed = [...bankRows, ...processCards(cardRows)];

// Match to existing ledger first
const usedIds = new Set();
function matchToLedger(row, entries, accId) {
  if (!accId) return null;
  const cands = entries.filter(le => le.date === row.date && (le.fromAccountId === accId || le.toAccountId === accId));
  for (const c of cands) if (c.amount === row.absAmount) return { entry: c, type: 'exact' };
  for (const c of cands) if (Math.abs(c.amount - row.absAmount) <= 500) return { entry: c, type: 'fuzzy' };
  for (const c of cands) if (row.absAmount > 10000 && Math.abs(c.amount - row.absAmount) <= 5000) return { entry: c, type: 'wide' };
  return null;
}

const newEntries = [];
const stats = { matched: 0, newFromCsv: 0, skippedNoise: 0, unknown: 0 };

for (const row of processed) {
  const accId = ACCOUNT_MAP[row.sourceAccount];

  // Try match existing ledger
  const avail = ledger.filter(le => !usedIds.has(le.id));
  const match = matchToLedger(row, avail, accId);

  if (match) {
    // Use existing entry but update amount to CSV value
    usedIds.add(match.entry.id);
    const updated = { ...match.entry, amount: row.absAmount };
    newEntries.push(updated);
    stats.matched++;
  } else {
    // Auto-categorize
    const cat = autoCategorize(row);
    if (cat === null) { stats.skippedNoise++; continue; } // 노이즈 제거

    const entry = {
      id: 'L' + Date.now() + Math.random().toString(36).slice(2, 6),
      date: row.date,
      kind: cat.kind,
      isFixedExpense: false,
      category: cat.cat,
      subCategory: cat.sub || undefined,
      description: cat.description || '',
      amount: row.absAmount,
    };
    if (cat.fromAccountId) entry.fromAccountId = cat.fromAccountId;
    if (cat.toAccountId) entry.toAccountId = cat.toAccountId;

    // USD for 해외 카드
    if (row.sourceAccount === '삼성카드 해외') {
      entry.currency = 'USD';
    }

    newEntries.push(entry);
    stats.newFromCsv++;
    if (cat.cat === '미분류') stats.unknown++;
  }
}

// Keep existing ledger entries NOT in CSV (except 재테크 조정)
const y26 = ledger.filter(l => l.date >= '2026-01-01' && l.date <= '2026-04-04');
const kept = [];
const removed = [];
for (const entry of y26) {
  if (usedIds.has(entry.id)) continue; // Already matched → CSV version used

  // 재테크 조정 삭제
  if (entry.description?.includes('환차익') || entry.description?.includes('계좌 금액 맞추기') || entry.description?.includes('금액 맞추기')) {
    removed.push(entry);
    continue;
  }
  if (entry.subCategory === '투자수익' && entry.description?.includes('환차')) {
    removed.push(entry);
    continue;
  }

  // 나머지 유지
  kept.push(entry);
}

// 2026 이전 데이터도 유지
const before2026 = ledger.filter(l => l.date < '2026-01-01' || l.date > '2026-04-04');

// Merge
const finalLedger = [...newEntries, ...kept, ...before2026];
// Sort by date desc
finalLedger.sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));

// === 9. Report ===
console.log('========================================');
console.log('         새 Ledger 빌드 결과');
console.log('========================================\n');
console.log('CSV 매칭 (기존 카테고리 유지, 금액 CSV로):', stats.matched);
console.log('CSV 신규 (자동 카테고리):', stats.newFromCsv);
console.log('노이즈 제거 (1원 인증 등):', stats.skippedNoise);
console.log('기존 ledger 유지 (CSV에 없��� 건):', kept.length);
console.log('재테크 조정 삭제:', removed.length);
console.log('2026 이전 데이터:', before2026.length);
console.log('');
console.log('최종 ledger:', finalLedger.length, '건');
console.log('');

if (stats.unknown > 0) {
  console.log('⚠ 미분류:', stats.unknown, '건');
  const unknowns = newEntries.filter(e => e.category === '미분류');
  unknowns.forEach(u => console.log('  ' + u.date + ' | ' + u.amount + '원 | ' + u.description));
  console.log('');
}

if (removed.length > 0) {
  console.log('🗑 삭제된 재테크 조정:');
  removed.forEach(r => console.log('  ' + r.date + ' | ' + r.amount + '원 | ' + r.category + '/' + (r.subCategory || '') + ' | "' + (r.description || '') + '"'));
  console.log('');
}

// 카테고리별 건수 (2026만)
const y26Final = finalLedger.filter(l => l.date >= '2026-01-01' && l.date <= '2026-04-04');
console.log('--- 2026.01~04 카테고리 분포 (' + y26Final.length + '건) ---');
const byCat = {};
y26Final.forEach(e => {
  const key = e.kind + ' > ' + e.category + (e.subCategory ? '/' + e.subCategory : '');
  byCat[key] = (byCat[key] || 0) + 1;
});
Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ': ' + v));

// 글자 깨짐 확인
console.log('\n--- 글자 깨짐 확인 ---');
const allTexts = y26Final.flatMap(e => [e.category, e.subCategory, e.description].filter(Boolean));
const broken = allTexts.filter(t => /[\ufffd]|[�]/.test(t));
if (broken.length > 0) {
  console.log('⚠ 깨진 문자 발견:', broken);
} else {
  console.log('✓ 글자 깨짐 없음');
}

// 저장
fs.writeFileSync('data/ledger-new.json', JSON.stringify(finalLedger, null, 2), 'utf-8');
console.log('\n✓ data/ledger-new.json 저장 완료 (' + finalLedger.length + '건)');
