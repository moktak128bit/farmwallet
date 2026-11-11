"""GAS 웹앱 안정성 스트레스 점검 — 무한 루프·무한 로딩·멈춘 저장을 실제와 비슷한 서버 조건에서 잰다.

    python scripts/gas-stress.py <장부.json> [시나리오,...] [--html gas/index.html] [--out <폴더>] [--quick]

- 화면은 `npm run build:gas`가 만든 gas/index.html을 그대로 연다(google.script.run은 가짜 서버로 바꿈).
- 장부 JSON은 인자로만 받는다(실장부는 저장소에 넣지 않는다 — gas/Seed.html 내용 등을 로컬 경로로).
- 가짜 서버는 시나리오별로 지연·실패·무응답(hang)을 흉내 낸다. 시세 proxyFetch는 네트워크 없이 빈 응답.
- 측정: React 커밋 수(DevTools 훅), 서버 호출 수·미응답 호출, 로딩 문구가 남은 시간, 콘솔 오류·미처리 거절.
- 판정(실패 시 종료 코드 1):
    · 가만히 있을 때 React 커밋 > 초당 IDLE_COMMITS_PER_SEC  → 렌더 루프
    · 가만히 있을 때 같은 서버 함수가 반복 호출(saveData ≥ 2, loadData/listVersions 과다) → 호출 루프
    · 로딩/저장 표시가 STUCK_SEC 넘게 남음 → 무한 로딩
    · 미처리 오류·오류 경계 화면
"""
import json, sys, time, pathlib, argparse

from playwright.sync_api import sync_playwright

IDLE_COMMITS_PER_SEC = 3.0
STUCK_SEC = 150
TABS = ["dashboard", "accounts", "ledger", "stocks", "insights", "dividends", "debt", "budget", "workout", "categories", "reports", "settings"]

# 시나리오: 함수별 (최소지연ms, 최대지연ms, 실패확률, 무응답 여부)
SCENARIOS = {
    "normal": {"*": [200, 1200, 0, False]},
    "slow": {"*": [3000, 8000, 0, False]},
    "flaky": {"*": [300, 2000, 0.35, False]},
    "hang-save": {"*": [200, 800, 0, False], "saveData": [0, 0, 0, True]},
    "hang-load": {"*": [200, 800, 0, False], "loadData": [0, 0, 0, True]},
    "hang-load-nocache": {"*": [200, 800, 0, False], "loadData": [0, 0, 0, True]},
    "hang-versions": {"*": [200, 800, 0, False], "listVersions": [0, 0, 0, True]},
    "hang-proxy": {"*": [200, 800, 0, False], "proxyFetch": [0, 0, 0, True]},
    "hang-all": {"*": [0, 0, 0, True]},
}

MOCK = r"""
(() => {
  const SC = __SCENARIO__;
  const seed = __SEED__;
  const S = { dataJson: seed, updatedAt: '2026-11-08T03:00:00.000Z', revision: 5, schemaVersion: 12 };
  const log = { calls: [], pending: {}, commits: 0, commitTimes: [], errors: [], server: S };
  window.__stress = log;
  // React DevTools 훅 — 운영 빌드도 커밋마다 onCommitFiberRoot를 부른다
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false, checkDCE() {},
    inject(r) { this.renderers.set(1, r); return 1; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot() { log.commits++; log.commitTimes.push(performance.now()); if (log.commitTimes.length > 20000) log.commitTimes.splice(0, 10000); },
  };
  window.addEventListener('error', (e) => log.errors.push('error: ' + (e.message || '')));
  window.addEventListener('unhandledrejection', (e) => log.errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  if (__NOCACHE__) { try { localStorage.clear(); } catch (e) {} }
  else { try { if (!localStorage.getItem('farmwallet-data-v1')) localStorage.setItem('farmwallet-data-v1', seed); } catch (e) {} }
  let seq = 0;
  const api = {
    loadData: () => ({ dataJson: S.dataJson, updatedAt: S.updatedAt, revision: S.revision, schemaVersion: S.schemaVersion }),
    saveData: (json) => { S.dataJson = json; S.revision++; S.updatedAt = new Date().toISOString(); return { updatedAt: S.updatedAt, revision: S.revision }; },
    listVersions: () => [{ sha: 'rev-' + S.revision, committedAt: S.updatedAt, url: 'rev-' + S.revision }],
    loadVersion: () => ({ dataJson: S.dataJson, committedAt: S.updatedAt }),
    backupNow: () => 'ok',
    proxyFetch: () => ({ status: 404, body: '' }),
    listPhotos: () => [], uploadPhoto: () => null, setPhotosProcessed: () => 0,
    photoIdsByName: (n) => (n || []).map(() => ''),
    pendingDeltas: () => [], markDeltaApplied: () => true,
  };
  const prof = (fn) => SC[fn] || SC['*'];
  const make = (ok, fail) => {
    const r = { withSuccessHandler: (f) => make(f, fail), withFailureHandler: (f) => make(ok, f), withUserObject: () => r };
    for (const k of Object.keys(api)) r[k] = (...args) => {
      const id = ++seq; const t0 = performance.now();
      log.calls.push({ fn: k, t: t0, key: k === 'proxyFetch' ? String(args[0]).slice(0, 300) : '' }); log.pending[id] = { fn: k, t: t0 };
      const [lo, hi, failP, hang] = prof(k);
      if (hang) return;
      setTimeout(() => {
        delete log.pending[id];
        if (Math.random() < failP) { fail && fail(new Error('Exceeded maximum execution time (모의 실패)')); return; }
        try { ok && ok(api[k](...args)); } catch (e) { fail && fail(e); }
      }, lo + Math.random() * (hi - lo));
    };
    return r;
  };
  window.google = { script: { run: make(null, null) } };
})();
"""

STATE_JS = r"""() => {
  const s = window.__stress; const now = performance.now();
  const txt = (document.querySelector('#root') || document.body).innerText;
  // 진행 표시만 본다 — 안내문(예: 설정 '자동 저장 중 10분마다…')을 로딩으로 오인하지 않게
  const busy = [];
  const ind = document.querySelector('.gas-save-status');
  const indText = ind ? ind.innerText.trim() : '';
  if (/저장 중|확인 중/.test(indText)) busy.push('저장표시:' + indText.split(/\s+/).slice(0, 3).join(' '));
  for (const re of [/불러오는 중/g, /갱신 중\.\.\.|갱신 중…/g, /계산 중/g]) { const m = txt.match(re); if (m) busy.push(re.source); }
  const ariaBusy = document.querySelectorAll('[aria-busy="true"]').length;
  const spin = document.querySelectorAll('.spin, .spinner, [class*="spinner"], .animate-spin').length;
  const pend = Object.values(s.pending).map(p => p.fn + '@' + Math.round((now - p.t) / 1000) + 's');
  const boundary = /앱 오류가 발생했습니다|탭 렌더 오류/.test(txt);
  return { now, saveIndicator: indText, commits: s.commits, calls: s.calls.map(c => c.fn), keys: s.calls.map(c => c.key || ''), pending: pend, busy, ariaBusy, spin, errors: s.errors.slice(-20), boundary, len: txt.length };
}"""


def run(sc_name, seed, html, out, quick):
    prof = SCENARIOS[sc_name]
    mock = MOCK.replace("__SCENARIO__", json.dumps(prof)).replace("__SEED__", json.dumps(seed)).replace("__NOCACHE__", "true" if sc_name.endswith("nocache") else "false")
    findings = []
    timeline = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1400, "height": 900}, locale="ko-KR", timezone_id="Asia/Seoul")
        ctx.add_init_script(mock)
        ctx.route("**/*", lambda route: route.abort() if not route.request.url.startswith("file:") else route.continue_())
        page = ctx.new_page()
        console_err = []
        page.on("console", lambda m: console_err.append(m.text[:200]) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_err.append("pageerror " + str(e)[:200]))
        page.goto(html.as_uri() + "?tab=dashboard", wait_until="load")

        def state():
            return page.evaluate(STATE_JS)

        def idle(label, sec):
            a = state(); page.wait_for_timeout(int(sec * 1000)); z = state()
            rate = (z["commits"] - a["commits"]) / sec
            new_calls = z["calls"][len(a["calls"]):]
            counts = {}
            for c in new_calls: counts[c] = counts.get(c, 0) + 1
            timeline.append({"at": label, "commitsPerSec": round(rate, 1), "calls": counts, "pending": z["pending"], "busy": z["busy"], "save": z["saveIndicator"]})
            if rate > IDLE_COMMITS_PER_SEC:
                findings.append(f"[렌더 루프] {label}: 가만히 있는데 초당 React 커밋 {rate:.0f}회")
            if counts.get("saveData", 0) >= 2:
                findings.append(f"[저장 루프] {label}: 편집 없이 {sec}s 동안 saveData {counts['saveData']}회")
            for fn in ("loadData", "listVersions", "loadVersion", "proxyFetch", "listPhotos", "pendingDeltas"):
                # 시세는 앱 열 때 종목 수만큼 정상 호출 — 장시간 대기 구간에서만 반복을 루프로 본다
                if fn == "proxyFetch" and not label.startswith("장시간"):
                    continue
                if counts.get(fn, 0) > max(3, sec / 10):
                    findings.append(f"[호출 루프] {label}: {sec}s 동안 {fn} {counts[fn]}회")
            return z

        boot_wait = 20 if not quick else 10
        page.wait_for_timeout(boot_wait * 1000)
        idle("부팅 직후", 10)
        # 탭 순회 — 실제 단축키(Alt+→, TAB_ORDER 순서)로 12개 탭을 차례로
        page.mouse.click(5, 5)
        for t in TABS[1:]:
            page.keyboard.press("Alt+ArrowRight")
            page.wait_for_timeout(1500)
            idle(f"탭 {t}", 6 if not quick else 3)

        # 편집 → 화면 반영 → 시트 저장 (가계부 첫 행 메모 인라인 편집)
        marker = f"스트레스{int(time.time()) % 100000}"
        try:
            page.locator("button.tab-button", has_text="가계부").first.click(timeout=3000)
            page.wait_for_timeout(2500)
            # 텍스트 입력이 열리는 칸(메모)을 찾는다 — 분류 칸은 선택 상자라 글자를 칠 수 없다
            cells = page.locator("td.cell-editable[title$='(더블클릭하여 수정)']")
            found = False
            for i in range(min(cells.count(), 12)):
                cells.nth(i).dblclick(timeout=5000)
                page.wait_for_timeout(300)
                if page.evaluate("() => { const a = document.activeElement; return a && a.tagName === 'INPUT' && a.type === 'text'; }"):
                    found = True
                    break
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
            if not found:
                raise RuntimeError("메모 칸 텍스트 입력을 찾지 못함")
            page.keyboard.press("End")
            page.keyboard.type(" " + marker)
            page.keyboard.press("Enter")
            page.wait_for_timeout(1500)
            if marker not in page.inner_text("main"):
                findings.append("[편집 미반영] 가계부 메모를 고쳤는데 표에 안 보임")
            saved_at = None
            for i in range(60):
                if page.evaluate("(m) => window.__stress.server.dataJson.includes(m)", marker):
                    saved_at = i; break
                page.wait_for_timeout(1000)
            hang_save = prof.get("saveData", [0, 0, 0, False])[3] or prof.get("loadData", [0, 0, 0, False])[3] or prof.get("*")[3]
            if saved_at is None and not hang_save:
                findings.append("[저장 안 됨] 편집 60초가 지나도 시트(가짜 서버)에 저장되지 않음")
            timeline.append({"at": "편집 저장", "savedAfterSec": saved_at})
        except Exception as e:
            # 사본 없이 시트도 못 받은 기기는 장부가 비어 고칠 행이 없다 — 편집 시험 대상이 아님
            if not (sc_name.endswith("nocache") and prof.get("loadData", [0, 0, 0, False])[3]):
                findings.append(f"[편집 시험 실패] {str(e)[:160]}")
        # 대시보드로 돌아가 오래 켜 두기 — 주기 동기화·시세 갱신이 쌓이며 멈추는지
        try:
            page.locator("button.tab-button", has_text="대시보드").first.click(timeout=3000)
        except Exception:
            pass
        # 진행 표시는 STUCK_SEC 동안 5초마다 본다 — 재시도 중엔 잠깐 '저장 중'일 수 있으니 '한 번도 안 풀림'만 무한 로딩으로 판정
        long_sec = max(STUCK_SEC, 120) if not quick else 40
        a = state(); samples = []
        for _ in range(int(long_sec / 5)):
            page.wait_for_timeout(5000)
            samples.append(state())
        z = samples[-1]
        rate = (z["commits"] - a["commits"]) / long_sec
        new_calls = z["calls"][len(a["calls"]):]
        counts = {}
        for c in new_calls: counts[c] = counts.get(c, 0) + 1
        timeline.append({"at": "장시간 대기", "commitsPerSec": round(rate, 1), "calls": counts, "save": [s["saveIndicator"] for s in samples[::6]]})
        if rate > IDLE_COMMITS_PER_SEC:
            findings.append(f"[렌더 루프] 장시간 대기: 초당 React 커밋 {rate:.0f}회")
        for fn, n in counts.items():
            # 시세는 종목 수만큼 순차 호출되는 게 정상(느린 응답이면 대기 구간까지 이어짐) — 총 횟수가 아니라 같은 URL 반복으로 본다
            if fn in ("saveData", "proxyFetch"):
                continue
            if n > max(3, long_sec / 10):
                findings.append(f"[호출 루프] 장시간 대기: {long_sec}s 동안 {fn} {n}회")
        url_counts = {}
        for fn, key in zip(z["calls"][len(a["calls"]):], z["keys"][len(a["keys"]):]):
            if fn == "proxyFetch":
                url_counts[key] = url_counts.get(key, 0) + 1
        if url_counts:
            top_url, top_n = max(url_counts.items(), key=lambda kv: kv[1])
            timeline[-1]["proxyFetchUrls"] = len(url_counts)
            timeline[-1]["proxyFetchMaxSameUrl"] = top_n
            # 환율은 실패 시 5초 간격 최대 3회 재시도(useFxRate, 총 4회 후 멈춤) — 늦게 뜬 앱에선 이 4회가 대기 구간에 들어온다.
            # 끝없는 반복(5초 간격이면 40s에 8회, 150s에 30회)만 잡는다.
            if top_n > max(4, long_sec / 20):
                findings.append(f"[호출 루프] 장시간 대기: {long_sec}s 동안 같은 시세 URL {top_n}회 ({top_url[:80]})")
        stuck = [b for b in samples[0]["busy"] if all(b in s["busy"] for s in samples)]
        if stuck and not quick:
            findings.append(f"[무한 로딩] {long_sec}초 내내 풀리지 않음: {stuck}")
        timeline.append({"at": "최종", "save": z["saveIndicator"]})
        if z["boundary"]:
            findings.append("[오류 화면] 오류 경계 화면이 떠 있음")
        # 네트워크 차단(가짜 서버 밖 요청)으로 생기는 리소스 오류는 시험 환경 탓이라 뺀다
        errs = [e for e in dict.fromkeys(z["errors"] + console_err) if "ERR_FAILED" not in e]
        # 무응답 시나리오에서 앱이 남기는 '서버 응답 없음' 기록은 의도된 처리
        if any(v[3] for v in prof.values()):
            errs = [e for e in errs if "서버 응답 없음" not in e]
        if errs:
            findings.append(f"[오류] {len(errs)}종: " + " | ".join(errs[:6]))
        page.screenshot(path=str(out / f"{sc_name}.png"), full_page=False)
        b.close()
    (out / f"{sc_name}.json").write_text(json.dumps({"findings": findings, "timeline": timeline}, ensure_ascii=False, indent=1), encoding="utf-8")
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("seed")
    ap.add_argument("scenarios", nargs="?", default=",".join(SCENARIOS))
    ap.add_argument("--html", default="gas/index.html")
    ap.add_argument("--out", default="node_modules/.gas-stress")
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    seed_text = pathlib.Path(a.seed).read_text(encoding="utf-8")
    json.loads(seed_text)  # 형식 확인
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    html = pathlib.Path(a.html).resolve()
    total = 0
    for sc in a.scenarios.split(","):
        t0 = time.time()
        f = run(sc, seed_text, html, out, a.quick)
        total += len(f)
        print(f"== {sc} ({time.time() - t0:.0f}s) — {'OK' if not f else str(len(f)) + '건'}", flush=True)
        for x in f: print("   ", x, flush=True)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
