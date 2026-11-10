/**
 * FarmWallet — Google Apps Script 서버.
 * 웹앱(나만 실행·나만 접근)으로 React 앱(index.html)을 내보내고, google.script.run으로 아래 함수를 노출한다.
 *
 * 저장 구조 (스프레드시트 "FarmWallet 데이터", 데이터 폴더 안):
 *   _data  (숨김) A열 — 앱 데이터 JSON 원본을 45,000자씩 나눈 조각("~" 접두). 불러오기는 여기만 읽는다(무손실).
 *   _meta  (숨김) 키/값 — revision, updatedAt, schemaVersion, chunks, ledgerCount, 탭별 해시.
 *   가계부·계좌·주식거래 …  보기 전용 표(사람이 보는 용도, 다시 읽지 않음). 모든 칸 텍스트 서식.
 * 백업: 데이터 폴더/백업 — 하루 첫 저장 직전 현재 원본을 JSON 파일로 남긴다(최근 30개 유지).
 * 사진: 사진 폴더/YYYY-MM-DD/ (처리 전), 사진 폴더/처리완료/ (처리 완료). 기록은 "사진" 탭.
 *
 * ID는 저장소(공개)에 두지 않는다 — Config.js(빌드가 .env.gas로 생성, 커밋 안 함)의 CONFIG와 Script Properties.
 */

/* global CONFIG */

var CHUNK = 45000;
var KEEP_BACKUPS = 30;
var FETCH_HOSTS = [
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'finance.yahoo.com',
  'polling.finance.naver.com', 'finance.naver.com', 'm.stock.naver.com', 'api.stock.naver.com', 'ac.stock.naver.com',
  'stooq.pl', 'stooq.com', 'api.coingecko.com'
];
var VIEW_TABS = {
  ledger: '가계부', accounts: '계좌', trades: '주식거래', loans: '대출', recurringExpenses: '반복지출',
  budgetGoals: '예산', savingsGoals: '저축목표', workoutWeeks: '운동기록', workoutRoutines: '운동루틴',
  customExercises: '운동종목', ledgerTemplates: '가계부템플릿', stockPresets: '주식프리셋',
  targetPortfolios: '목표포트폴리오', assetSnapshots: '자산스냅샷', marketEnvSnapshots: '시장환경스냅샷'
};

// ───────────────────────── 웹앱 ─────────────────────────

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('FarmWallet')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ───────────────────────── 설정 · 저장소 ─────────────────────────

function props_() { return PropertiesService.getScriptProperties(); }

var SHEET_NAME = 'FarmWallet 데이터';

/**
 * 스프레드시트를 찾거나 만든다. ID는 만들자마자 Script Properties에 기억한다.
 * (이전 버그: _data·_meta를 둘 다 숨기다 "모든 시트를 숨길 수 없음"으로 실패 → ID를 못 기억해 열 때마다 빈 시트가 생겼다.
 *  그때 생긴 빈 시트는 가장 최근 것 하나만 쓰고 나머지 빈 것은 휴지통으로. 데이터가 든 시트는 건드리지 않는다.)
 */
function store_() {
  var p = props_();
  var ssId = p.getProperty('SPREADSHEET_ID');
  if (ssId) {
    try { return ensureSheets_(SpreadsheetApp.openById(ssId)); } catch (e) { /* 지워졌거나 열 수 없음 → 아래에서 다시 찾는다 */ }
  }
  var folder = DriveApp.getFolderById(CONFIG.DATA_FOLDER_ID);
  var found = [];
  var it = folder.getFilesByName(SHEET_NAME);
  while (it.hasNext()) found.push(it.next());
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  var ss;
  if (found.length) {
    ss = SpreadsheetApp.openById(found[0].getId());
    for (var i = 1; i < found.length; i++) {
      var other = SpreadsheetApp.openById(found[i].getId()).getSheetByName('_data');
      if (!other || other.getLastRow() === 0) found[i].setTrashed(true);
    }
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  }
  p.setProperty('SPREADSHEET_ID', ss.getId());
  return ensureSheets_(ss);
}

/** 보이는 "안내" 탭 하나 + 숨김 _data·_meta (모든 탭을 숨기면 hideSheet가 오류를 낸다) */
function ensureSheets_(ss) {
  if (!ss.getSheetByName('안내')) {
    var first = ss.getSheets()[0];
    var guide = /^(Sheet1|시트1)$/.test(first.getName()) && first.getLastRow() === 0 ? first : ss.insertSheet('안내', 0);
    guide.setName('안내');
    guide.getRange(1, 1, 4, 1).setValues([
      ['FarmWallet 데이터 — 앱(GAS 웹앱)이 저장하는 보관용 시트입니다.'],
      ['수정은 앱에서만 하세요. 여기서 고친 내용은 앱에 반영되지 않고, 다음 저장 때 덮어써집니다.'],
      ['가계부·계좌 등 탭은 보기용 표입니다. 원본은 숨김 탭(_data)에 있습니다.'],
      ['백업: 같은 폴더의 "백업" 폴더(하루 첫 저장 전 자동).']
    ]);
  }
  ['_data', '_meta'].forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (!sh.isSheetHidden()) sh.hideSheet();
  });
  return ss;
}

function backupFolder_() {
  var p = props_();
  var id = p.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워짐 → 다시 만든다 */ } }
  var folder = DriveApp.getFolderById(CONFIG.DATA_FOLDER_ID).createFolder('백업');
  p.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

function readMeta_(ss) {
  var sh = ss.getSheetByName('_meta');
  var meta = {};
  if (!sh || sh.getLastRow() === 0) return meta;
  var rows = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0]) meta[String(rows[i][0])] = String(rows[i][1]);
  return meta;
}

function writeMeta_(ss, meta) {
  var sh = ss.getSheetByName('_meta');
  var keys = Object.keys(meta).sort();
  sh.clearContents();
  if (!keys.length) return;
  var range = sh.getRange(1, 1, keys.length, 2);
  range.setNumberFormat('@');
  range.setValues(keys.map(function (k) { return [k, String(meta[k])]; }));
}

function readJson_(ss) {
  var sh = ss.getSheetByName('_data');
  var n = sh.getLastRow();
  if (n === 0) return '';
  return sh.getRange(1, 1, n, 1).getValues().map(function (r) { return String(r[0]).slice(1); }).join('');
}

function writeJson_(ss, json) {
  var sh = ss.getSheetByName('_data');
  var parts = [];
  for (var i = 0; i < json.length; i += CHUNK) parts.push(['~' + json.slice(i, i + CHUNK)]);
  sh.clearContents();
  var range = sh.getRange(1, 1, parts.length, 1);
  range.setNumberFormat('@');
  range.setValues(parts);
  return parts.length;
}

function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function kstDate_(d) { return Utilities.formatDate(d || new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }

// ───────────────────────── 데이터 API (google.script.run) ─────────────────────────

/**
 * 이전용 초기 데이터 — 배포에 Seed.html(기존 앱 데이터 JSON)이 함께 올라왔고 시트가 한 번도 저장된 적 없을 때만
 * 그 데이터로 시트를 채운다. 이미 저장된 시트는 절대 덮지 않는다. 이전이 끝나면 Seed 없이 다시 배포한다.
 */
function seedIfEmpty_(ss, meta) {
  if (meta.updatedAt) return meta;
  var seed = '';
  try { seed = HtmlService.createHtmlOutputFromFile('Seed').getContent(); } catch (e) { return meta; }
  if (!seed) return meta;
  var data = JSON.parse(seed);
  if (!Array.isArray(data.ledger) || !data.ledger.length) return meta;
  meta.chunks = writeJson_(ss, seed);
  writeViews_(ss, data, meta);
  meta.revision = 1;
  meta.updatedAt = new Date().toISOString();
  meta.schemaVersion = Number(data.schemaVersion || 0);
  meta.ledgerCount = data.ledger.length;
  meta.device = '이전(Seed)';
  meta.lastBackupDate = '';
  writeMeta_(ss, meta);
  return meta;
}

/** 원본 불러오기. 아직 저장된 적 없으면 dataJson "" */
function loadData() {
  var ss = store_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var meta;
  try {
    meta = seedIfEmpty_(ss, readMeta_(ss));
  } finally {
    lock.releaseLock();
  }
  return {
    dataJson: readJson_(ss),
    updatedAt: meta.updatedAt || '',
    revision: Number(meta.revision || 0),
    schemaVersion: Number(meta.schemaVersion || 0)
  };
}

/**
 * 원본 저장. 빈 데이터로 기존 데이터를 덮는 저장은 거절한다(과거 "빈 탭이 빈 데이터를 덮은" 사고 방지).
 * 하루 첫 저장 직전에는 현재 원본을 백업 폴더에 남긴다.
 */
function saveData(dataJson, schemaVersion, device) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(dataJson);
    var ss = store_();
    var meta = readMeta_(ss);
    var incomingLedger = Array.isArray(data.ledger) ? data.ledger.length : 0;
    var incomingAccounts = Array.isArray(data.accounts) ? data.accounts.length : 0;
    var storedLedger = Number(meta.ledgerCount || 0);
    if (storedLedger > 0 && incomingLedger === 0 && incomingAccounts === 0) {
      throw new Error('빈 데이터로 기존 데이터(가계부 ' + storedLedger + '건)를 덮는 저장을 거절했습니다.');
    }
    var today = kstDate_();
    if (meta.updatedAt && meta.lastBackupDate !== today) {
      backupNow_(ss, '하루 첫 저장 직전');
      meta.lastBackupDate = today;
    }
    meta.chunks = writeJson_(ss, dataJson);
    writeViews_(ss, data, meta);
    var now = new Date().toISOString();
    meta.revision = Number(meta.revision || 0) + 1;
    meta.updatedAt = now;
    meta.schemaVersion = schemaVersion || 0;
    meta.ledgerCount = incomingLedger;
    meta.device = device || '';
    writeMeta_(ss, meta);
    return { updatedAt: now, revision: meta.revision };
  } finally {
    lock.releaseLock();
  }
}

/** 버전 목록 — [0]은 현재 원본(충돌 감지용), 그 뒤로 백업 파일(최신순) */
function listVersions(maxCount) {
  var ss = store_();
  var meta = readMeta_(ss);
  var out = [];
  if (meta.updatedAt) out.push({ sha: 'rev-' + meta.revision, committedAt: meta.updatedAt, url: 'head' });
  var files = [];
  var it = backupFolder_().getFiles();
  while (it.hasNext()) { var f = it.next(); files.push({ id: f.getId(), at: f.getDateCreated().toISOString(), name: f.getName() }); }
  files.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  for (var i = 0; i < files.length && out.length < (maxCount || 5); i++) {
    out.push({ sha: files[i].name, committedAt: files[i].at, url: 'backup:' + files[i].id });
  }
  return out;
}

/** 버전 불러오기 — 'head' 또는 'backup:<파일ID>' */
function loadVersion(url) {
  if (url === 'head') { var cur = loadData(); return { dataJson: cur.dataJson, committedAt: cur.updatedAt }; }
  var id = String(url).replace(/^backup:/, '');
  var file = DriveApp.getFileById(id);
  if (file.getParents().next().getId() !== backupFolder_().getId()) throw new Error('백업 폴더 밖의 파일은 불러올 수 없습니다.');
  return { dataJson: file.getBlob().getDataAsString('UTF-8'), committedAt: file.getDateCreated().toISOString() };
}

/** 지금 원본을 백업 폴더에 남긴다 (위험 작업 직전 등에서 호출) */
function backupNow(label) {
  var ss = store_();
  return backupNow_(ss, label || '수동');
}

function backupNow_(ss, label) {
  var json = readJson_(ss);
  if (!json) return null;
  var name = 'farmwallet-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss') + '.json';
  var folder = backupFolder_();
  var file = folder.createFile(name, json, 'application/json');
  file.setDescription(String(label || ''));
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = KEEP_BACKUPS; i < files.length; i++) files[i].setTrashed(true);
  return { id: file.getId(), name: name };
}

// ───────────────────────── 보기 전용 표 ─────────────────────────

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    var s = JSON.stringify(v);
    return s.length > 49000 ? s.slice(0, 49000) + '…(잘림)' : s;
  }
  return String(v);
}

function writeViews_(ss, data, meta) {
  Object.keys(VIEW_TABS).forEach(function (key) {
    var rows = data[key];
    if (!Array.isArray(rows)) return;
    var h = hash_(JSON.stringify(rows));
    if (meta['view:' + key] === h) return;
    var name = VIEW_TABS[key];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    var cols = [];
    rows.forEach(function (r) { Object.keys(r || {}).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    if (!cols.length) { meta['view:' + key] = h; return; }
    var values = [cols].concat(rows.map(function (r) { return cols.map(function (c) { return cell_(r ? r[c] : ''); }); }));
    var range = sh.getRange(1, 1, values.length, cols.length);
    range.setNumberFormat('@');
    range.setValues(values);
    sh.setFrozenRows(1);
    meta['view:' + key] = h;
  });
}

// ───────────────────────── 외부 요청 대리 (CORS 우회) ─────────────────────────

/** 허용한 시세 사이트만 GET. 같은 URL은 60초 캐시 */
function proxyFetch(url, encoding) {
  var host = String(url).replace(/^https?:\/\//, '').split(/[\/?#]/)[0].toLowerCase();
  if (FETCH_HOSTS.indexOf(host) < 0) throw new Error('허용하지 않은 주소: ' + host);
  var cache = CacheService.getScriptCache();
  var key = 'f:' + hash_(url + '|' + (encoding || ''));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (FarmWallet)' }
  });
  var out = { status: res.getResponseCode(), body: res.getContentText(encoding === 'euc-kr' ? 'EUC-KR' : 'UTF-8') };
  var packed = JSON.stringify(out);
  if (out.status === 200 && packed.length < 90000) cache.put(key, packed, 60);
  return out;
}

// ───────────────────────── 사진 업로드 ─────────────────────────

function photoRoot_() { return DriveApp.getFolderById(CONFIG.PHOTO_FOLDER_ID); }

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function photoLog_() {
  var ss = store_();
  var sh = ss.getSheetByName('사진');
  if (!sh) {
    sh = ss.insertSheet('사진');
    sh.getRange(1, 1, 1, 6).setValues([['파일ID', '이름', '올린시각', '상태', '처리시각', '크기']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 사진 한 장 저장 — base64 본문. 이름 앞에 올린 시각을 붙여 내려받아도 구분되게 한다 */
function uploadPhoto(name, mimeType, base64) {
  var now = new Date();
  var stamp = Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd_HHmmss');
  var safe = String(name || 'photo').replace(/[\\/:*?"<>|]/g, '_');
  var folder = subFolder_(photoRoot_(), kstDate_(now));
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'image/jpeg', stamp + '_' + safe);
  var file = folder.createFile(blob);
  var log = photoLog_();
  log.appendRow([file.getId(), file.getName(), now.toISOString(), '처리 전', '', blob.getBytes().length]);
  return { id: file.getId(), name: file.getName(), uploadedAt: now.toISOString(), status: '처리 전' };
}

/** 올린 사진 목록 (최신순) */
function listPhotos() {
  var sh = photoLog_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 6).getValues().map(function (r) {
    return { id: String(r[0]), name: String(r[1]), uploadedAt: String(r[2]), status: String(r[3]), processedAt: String(r[4]), size: Number(r[5]) || 0 };
  }).reverse();
}

/** 처리 완료/처리 전으로 표시 — 처리 완료는 "처리완료" 폴더로, 되돌리면 올린 날짜 폴더로 옮긴다 */
function setPhotosProcessed(ids, processed) {
  var sh = photoLog_();
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var rows = sh.getRange(2, 1, n - 1, 6).getValues();
  var want = {};
  (ids || []).forEach(function (id) { want[String(id)] = true; });
  var done = subFolder_(photoRoot_(), '처리완료');
  var changed = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]);
    if (!want[id]) continue;
    var file = DriveApp.getFileById(id);
    if (processed) {
      file.moveTo(done);
      rows[i][3] = '처리 완료';
      rows[i][4] = new Date().toISOString();
    } else {
      file.moveTo(subFolder_(photoRoot_(), kstDate_(new Date(String(rows[i][2])))));
      rows[i][3] = '처리 전';
      rows[i][4] = '';
    }
    changed++;
  }
  sh.getRange(2, 1, rows.length, 6).setValues(rows);
  return changed;
}

/** 이름(올린 시각 접두 포함)으로 사진 ID 찾기 — Claude가 내려받은 파일 이름으로 변경분에 적을 때 */
function photoIdsByName(names) {
  var byName = {};
  listPhotos().forEach(function (p) { byName[p.name] = p.id; });
  return (names || []).map(function (n) { return byName[String(n)] || ''; });
}
