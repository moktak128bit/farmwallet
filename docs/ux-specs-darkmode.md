# darkmode 최종 스펙

## 인사이트 다크모드 대응 — 최종 구현 스펙 (검증·수정 반영판)

### 작업 범위와 절대 금지
- 수정 허용 파일: `src/styles.css`, `src/hooks/useTheme.ts`, `src/features/insights/**`(insightsShared.tsx, InsightsHeader.tsx, InsightsTabNav.tsx, ForecastView.tsx, tabs/*.tsx), `src/features/dating/SettlementView.tsx`. **그 외 파일 수정 금지.**
- 특히 금지: `src/features/ledger|stocks|budget|accounts/**`, `src/utils/pointer.ts`(방금 추가된 isCoarsePointer 탭 편집·삭제 confirm·토스트 영역), `src/features/dashboard|reports|workout/**`(차트), `src/pages/InsightsPage.tsx`(부모 — props/콜백 계약 불변 유지).
- 컴포넌트에 **새 prop 추가 금지** — Card는 기존 `accent` prop으로만 분기. React.memo·콜백 안정성 계약에 영향 주는 변경 금지(이번 작업은 전부 렌더 내 스타일 리터럴 교체라 본질적으로 무관).
- recharts `isAnimationActive={false}`는 전부 그대로 유지(사용자 선호). **styles.css에 `.recharts-cartesian-grid line { ... }` 같은 전역 recharts 규칙을 추가하지 말 것** — 대시보드·리포트·주식·운동 차트의 기존 stroke를 덮어쓰는 앱 전역 부작용이 있음.

### 0단계 — styles.css 변수 추가 (d:\05farmwallet\src\styles.css)
- `:root`(L5-67 블록)에 추가: `--text-faint: #94a3b8;` `--chart-grid: #e2e8f0;`
- `:root.dark`(L69-109 블록)에 추가: `--text-faint: #64748b;` `--chart-grid: #334155;`
- `.high-contrast`(L1325 블록)에 추가: `--text-faint: #666666;` `--chart-grid: #999999;`
- `.high-contrast.dark`(L1341 블록)에 추가: `--text-faint: #999999;` `--chart-grid: #666666;`

### 0.5단계 — useTheme.ts PWA 상태바 대응 (d:\05farmwallet\src\hooks\useTheme.ts)
파일 상단에 헬퍼 추가 후, 테마가 적용되는 두 지점(useEffect 초기화의 classList 조작 직후, toggleTheme의 classList 조작 직후)에서 호출:
```ts
function applyThemeColor(dark: boolean) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#0d9488");
}
```
(index.html L12의 정적 메타는 그대로 둠 — 초기 페인트용.)

### 1단계 — 공용 매핑 테이블 (기계적 적용, 단 2단계 원칙이 우선)
| 기존 | 치환 | 비고 |
|---|---|---|
| `#fff`/`#ffffff` 배경 (plain Card, 테이블 컨테이너, 도넛 홀, topDates 칩) | `var(--surface)` | 고정 다크/파스텔 패널 내부 흰 박스(ExpenseTab L183·L194)는 제외 |
| `#f8f9fa`, `#f8fafc` (배너·인셋 패널) | `var(--bg)` | ExpenseTab L234 Row·파스텔 내부는 2단계 예외 참조 |
| `#f0f0f0` (게이지/프로그레스 트랙) | `var(--surface-hover)` | ExpenseTab L289는 예외(유지) |
| `#f0f0f0`(보더), `#f5f5f5`, `#eee`, `#f1f5f9` (헤어라인) | `var(--border-light)` | 파스텔 패널 내부 #eee는 유지 |
| `#e2e8f0`, `#e0e0e0`, `#ddd`, `#ccc`(보더·input) | `var(--border)` | |
| `#1a1a2e`(텍스트), `#0f172a`(텍스트), `#333`(텍스트) | `var(--text)` | 배경/그라데이션의 #1a1a2e는 절대 제외 |
| `#444`, `#555`, `#475569` | `var(--text-secondary)` | ExpenseTab L217·221은 예외(유지) |
| `#666`, `#64748b`, `#888` | `var(--text-muted)` | |
| `#999`, `#aaa`, `#bbb`, `#94a3b8`, `#ccc`(텍스트) | `var(--text-faint)` | ExpenseTab L172-179는 예외(유지) |
| 차트 `<CartesianGrid ... stroke="#eee" />` (인사이트 탭 전체 ~25곳) | `stroke="var(--chart-grid)"` | 속성 직접 치환 — 대시보드의 stroke="var(--border)"와 동일한 기존 검증된 패턴 |

### 2단계 — 동반 치환 원칙 (매핑 테이블보다 우선하는 절대 규칙)
어떤 중립색이든 **자기 조상 배경(가장 가까운 명시적 bg)이 테마화될 때만** 치환한다. 고정 배경(다크 그라데이션·파스텔) 위 색은 배경과 함께가 아니면 절대 건드리지 않는다.

**치환 금지 A — 고정 다크 배경 위 (전부 현행 유지):**
- insightsShared CT 툴팁(L144-150) 전체, Card `accent` 분기 색 전체(그라데이션·rgba 화이트·boxShadow·border)
- InsightsHeader.tsx 전체(고정 다크 히어로가 디자인 아이덴티티 — `<option style={{color:"#1a1a2e"}}>` 포함 유지. select 자체 color가 #fff라 인라인 제거 시 라이트 OS 팝업에서 흰 글씨 위험)
- ForecastView L84-88, IncomeTab L142-148 다크 그라데이션 패널 내부 전체
- OverviewTab L54-86 이상치 배너(그라데이션+#fff+rgba), L149 게이지 오버레이 #fff+textShadow
- Kpi `color="#fff"` 3곳: OverviewTab L92, InvestTab L90, SubTab L70
- FunTab L29-34 (accent 카드 내부 rgba 화이트·#fff)

**치환 금지 B — 고정 파스텔 배경과 그 내부 일체 (1차 정책: 쌍으로 유지):**
bg·짝 border·내부 #555/#666/#999/#eee/#94a3b8/#0f172a 전부 유지 —
- OverviewTab: 장부vs실질류 파스텔 카드, L310 지출관성 상태박스, L378-382 지표 행 5종(bg/border 쌍), L412 subInsights 조건부 파스텔, L444+ Insight bg/color 쌍
- ExpenseTab: L168-198 #fef3c7/#f0fdf4 패널 일체(**내부 #94a3b8 L172-179, #78350f, #92400e, 흰 박스 L183·194 포함 유지**), L234-247 Row bg 파스텔(**Row 컴포넌트 텍스트 L217·221 #0f172a/#475569도 유지** — 파스텔 행 공용), L284 예산 파스텔(**내부 트랙 #f0f0f0 L289 유지**), L561/576, L615-630, L639 subInsights
- IncomeTab L126-141 파스텔 3종, L216-231, L243 / AssetTab L234, L248-271 / InvestTab L206, L228-243(#d4edda/#f8d7da), L338-367 / DateTab L331-343, L352 / ForecastView L91-110 KPI 2-4, L212 / SettlementView L97, L111, L115 / SubTab L143-163 파스텔 3종
- `Insight` 호출부의 bg/color 하드코딩 쌍 전부(컴포넌트 자체도 변경 없음)

**예외 — 반투명 틴트로 즉시 전환 (혼재 컨텍스트 2곳):**
1. PatternTab topDates(L151-174): 행 bg `idx < 3 ? "rgba(233,69,96,0.08)" : "var(--bg)"`, 행 border `idx < 3 ? "1px solid rgba(233,69,96,0.25)" : "1px solid var(--border-light)"`, L158 순위 `idx < 3 ? "#e94560" : "var(--text-faint)"`, L159 날짜 #666→`var(--text-muted)`, 칩(L164) bg #fff→`var(--surface)`·border #eee→`var(--border-light)`·color #999→`var(--text-faint)`, L168 #999→`var(--text-faint)`. L156 rgba 오버레이·L160 #e94560 유지.
2. ExpenseTab 분담통장 테이블(L313-358): L329 행 하이라이트 `isHighlight ? "#fff7ed" : "transparent"` → `isHighlight ? "rgba(245,158,11,0.12)" : "transparent"`, 셀 #0f172a(L331·332)→`var(--text)`, 비고 #92400e(L340)→`var(--warning)`. L315·348 thead/tfoot bg #f8fafc→`var(--bg)`·보더 #e2e8f0→`var(--border)`·th #475569(L316-321)→`var(--text-muted)`, L329 행보더 #f1f5f9→`var(--border-light)`. **L368 #92400e→`var(--warning)`** (카드 표면 위 — 다크 비가시 버그). #dc2626/#059669 시맨틱 셀은 유지.

**유지 C — 양 테마 가시 시맨틱/시리즈 색 전부 유지:** 팔레트 C 12색, #e94560/#0f3460/#f0c040/#48c9b0/#533483/#059669/#dc2626/#d97706/#f59e0b/#2563eb/#7c3aed/#b45309/#92400e(파스텔 내부)/#2ecc71/#3498db/#f39c12 등 데이터 색, ForecastView L172 ±σ 밴드 #999(시각화 요소), SubTab CATEGORY_PATTERNS·`${color}33`·`g.color+"15"`, ExpenseTab velocityColors·z배지 등.

### 3단계 — insightsShared.tsx (핵심)
**Card(L38-46)**: plain 분기만 변경 — `background: accent ? (기존 그라데이션) : "var(--surface)"`, `border: accent ? (기존) : "1px solid var(--border-light)"`, `color: accent ? "#fff" : "var(--text)"`, 타이틀(L46) `color: accent ? "rgba(255,255,255,0.6)" : "var(--text-faint)"`. boxShadow는 현행 유지. style 객체 끝에 로컬 변수 주입:
```tsx
...(accent
  ? { "--ins-muted": "rgba(255,255,255,0.7)", "--ins-faint": "rgba(255,255,255,0.55)", "--ins-chip-bg": "rgba(255,255,255,0.15)" }
  : { "--ins-muted": "var(--text-muted)", "--ins-faint": "var(--text-faint)", "--ins-chip-bg": "var(--surface-hover)" }
) as React.CSSProperties
```
**Kpi(L52-85)**: label(L57) `color: "var(--ins-faint, #999)"`, sub(L81) `color: "var(--ins-muted, #666)"`, info 배지(L70-71) `background: "var(--ins-chip-bg, rgba(255,255,255,0.15))"`, `color: "var(--ins-muted, rgba(255,255,255,0.7))"`. 기본 `color="#e94560"`·badge 색(L82) 유지. → ExpenseTab '월간 지출 변동성'의 ⓘ 흰배경 위 흰글씨 기존 버그도 함께 해결됨.
**Section(L111-117)**: `#1a1a2e` 2곳(텍스트·borderBottom)→`var(--text)`, `#ddd`→`var(--border)`, `#666`→`var(--text-muted)`.
**C·CT·Insight·pieLabel: 변경 없음.**

### 4단계 — InsightsTabNav.tsx
L28: bg `#fff`→`var(--surface)`, borderBottom `#eee`→`var(--border-light)`. L33: 활성 필 `background: "var(--text)"`, `color: "var(--bg)"`(반전 테마화 — 라이트 현행과 거의 동일, 다크에서 밝은 필로 가시성 확보. var(--primary) 사용 금지 — 무채색 톤 유지); 비활성 color `#666`→`var(--text-muted)`. L36 #e94560 유지.

### 5단계 — 파일별 특이 지점 (1단계 매핑 + 2단계 금지를 기본 적용한 뒤)
- **ForecastView**: L64 배너 #f8f9fa→var(--bg)·#666→var(--text-muted). L72-74 lookback 버튼: 활성 bg/border `var(--text)`·color `var(--bg)`, 비활성 bg `var(--surface)`·border `var(--border)`·color `var(--text-muted)`. L114-134 진행현황 패널: bg→var(--bg), #1a1a2e→var(--text), #999→var(--text-faint). L139 테이블 bg→var(--surface), L141 thead bg→`var(--surface-hover)`+`2px solid var(--border)`, th #666→var(--text-muted), L155 행보더 #f0f0f0→var(--border-light), L157 #ccc(0원)→var(--text-faint), L159 #1a1a2e→var(--text), L164/192/198 #999→var(--text-faint), L167 분포 트랙→var(--surface-hover), L207 #666→var(--text-muted). L93/129/216 #0f3460, L100/158 #d97706, 심각도 색, L172 #999 밴드, L183 #059669 유지.
- **OverviewTab**: L103 #555→var(--text-secondary), L104/108 #f0f0f0→var(--border-light), #999 다수→var(--text-faint), #f8f9fa 인셋→var(--bg), L131 트랙→var(--surface-hover), L135 마커 #1a1a2e→var(--text), L152 '목표' #333→var(--text-secondary), L155 #666→var(--text-muted), L300 #1a1a2e→var(--text), L302 #ccc→var(--text-faint), L305 #666→var(--text-muted), L333 도넛 홀 #fff→var(--surface), L358 #999→var(--text-faint), L361 트랙→var(--surface-hover), L372 #999/#f8f9fa→var(--text-faint)/var(--bg), L399 중립 지표행: bg #f8f9fa→var(--bg)·border #eee→var(--border-light)·#999→var(--text-faint)·#aaa→var(--text-faint) (이 행만 — L378-382 파스텔 행은 유지), L420 #555→var(--text-secondary). CartesianGrid 4곳 stroke→var(--chart-grid).
- **ExpenseTab**: 배너·#f5f5f5 헤어라인·트랙(L86,390)·#999/#bbb/#aaa·#f8fafc(L149,234는 아래 참조)·#64748b·#0f172a(텍스트)·#475569·#94a3b8·#f1f5f9·#666/#888 → 매핑대로. 단 **L234 Row ① bg #f8fafc는 var(--bg)로 치환하되 Row 내부 텍스트(L217·221·218·222)는 유지**(파스텔 행 공용 컴포넌트 — 라이트 파스텔 위에서 어두운 텍스트 필요). L249-259 설명 패널은 통째 테마화: bg→var(--bg), #475569→var(--text-secondary), #0f172a→var(--text), #94a3b8→var(--text-faint). L149-164 활용률 패널: bg→var(--bg), #64748b→var(--text-muted), 트랙 #e2e8f0(L153)→var(--border). 분담통장 테이블·L368은 2단계 예외 절차대로. CartesianGrid 5곳 치환.
- **IncomeTab**: L48 배너, L78 fallback `"#333"`→`"var(--text)"`, L85 #555→var(--text-secondary), L105 #f5f5f5→var(--border-light), L109 트랙→var(--surface-hover), #999→var(--text-faint), CartesianGrid 4곳. L9 GROUP_COLORS·L106/114 #059669·L126-148 파스텔+다크 패널 유지.
- **AssetTab**: L57 배너, L98 #666→var(--text-muted), L105 트랙→var(--surface-hover), L118 #f8f9fa→var(--bg), L122/187/192 #999→var(--text-faint), L186 #f0f0f0→var(--border-light), L188 양수 잔액 #333→var(--text)(음수 #e94560 유지), L210 grid, L238 #666→var(--text-muted). L234 체크리스트 파스텔·Insight 쌍 유지.
- **InvestTab**: L60 배너, #999/#666 매핑대로, #f5f5f5(L269,317)→var(--border-light), #f8f9fa(L247,253,260)→var(--bg), L96 #999→var(--text-faint), CartesianGrid 2곳. L90 Kpi #fff·L103 #0f3460·#2ecc71/#e94560·파스텔/subInsights 유지.
- **DateTab**: L105 배너, L110-112 #999→var(--text-faint)(.card 내부 — 안전), #f5f5f5/#eee 헤어라인→var(--border-light), 테이블 #999/#666/#888 매핑대로, L382 #f8f9fa→var(--bg), CartesianGrid 6곳. Kpi·차트 시맨틱색·L331-343/L352 파스텔 유지.
- **PatternTab**: L44 배너, grid 3곳, #999 캡션→var(--text-faint), L159… topDates는 2단계 예외대로. 셀색·L156 오버레이·L181-206 Insight 쌍 유지.
- **SubTab**: **L95 버그 수정** — `border: \`1px solid ${cat ? cat.color + "33" : "var(--border-light)"}\`` (현행 `${cat?.color ?? "#eee"}33`은 미분류 시 "#eee33" 무효 색상으로 보더 선언이 통째로 무시됨), borderLeft fallback `"#ccc"`→`"var(--border)"`. L95/116/127 #f8f9fa→var(--bg), L127 #bbb→var(--border), L57/98/132 #999→var(--text-faint), L101/121/129/146 #666→var(--text-muted), L78 grid. L70 Kpi #fff·CATEGORY_PATTERNS·#e94560·파스텔 3종(L143-163 내부 #444/#666 포함) 유지.
- **FunTab**: 트랙 #f0f0f0(L47,53,95)→var(--surface-hover), L77/92/116 #999→var(--text-faint), L84 #444→var(--text-secondary), L115 #f0f0f0 보더→var(--border-light). L29-34 accent 내부·막대 상태색 유지.
- **SettlementView**: L55-61 빈 상태(#f8f9fa→var(--bg), #666→var(--text-muted), #1a1a2e→var(--text), #999→var(--text-faint)), L89 배너, L98 #666→var(--text-muted), L101 input #ccc→var(--border), L103 #999→var(--text-faint), L107-109 인셋(bg→var(--bg), #666→var(--text-muted), #1a1a2e→var(--text)), **L126-129 정산 버튼: 활성 bg `var(--text)`+color `var(--bg)`, disabled bg `var(--border)`+color `var(--text-muted)`** (다크에서 배경에 묻히는 현존 문제+disabled 저대비 동시 해결), L134 #999→var(--text-faint), L144-151 테이블(#fff→var(--surface), #eee→var(--border-light), thead #f8f9fa→var(--surface-hover), #e0e0e0→var(--border), #666→var(--text-muted)), L156-160(#f5f5f5→var(--border-light), #666/#888→var(--text-muted)), L183-193(#f8f9fa→var(--bg), #666→var(--text-muted)), L196-200(#fff→var(--surface), #eee/#f5f5f5→var(--border-light), #444→var(--text-secondary)). L97/111/115 파스텔·L113/117/162/189/201 시맨틱색 유지.

### 검증 (전부 통과해야 완료)
1. `npx tsc --noEmit` — 0 에러 (baseline 0 확인됨).
2. **PowerShell에서** `npm test` — 26파일/352개 전부 통과 (baseline 통과 확인됨. 주의: bash에서 `npx vitest run` 직접 실행은 이 환경 문제로 'no tests' 실패를 내므로 사용 금지).
3. `npm run build` — 성공 (prebuild의 check-text 포함).
4. 회귀 가드: `git diff --stat`에 인사이트·dating·styles.css·useTheme.ts 외 파일이 없어야 함. 특히 dashboard/reports/stocks/workout 차트와 ledger 계열 파일 diff 0.
5. 수동 체크리스트 — 라이트: accent 카드 4종 KPI(특히 '실질 저축률' #fff 값)·CT 툴팁·인사이트 헤더·파스텔 패널이 변화 없는지. 다크: 탭내브 활성 필·lookback 활성 버튼·정산 버튼 가시, plain Card가 #1e293b 표면, 차트 그리드 #334155, 인셋 패널이 카드보다 어두운지, 분담통장 하이라이트 행·⚠ 비고 텍스트 가독. 공통: ExpenseTab '월간 지출 변동성' ⓘ 배지 양 테마 가시(버그 수정 확인), SubTab 미분류 구독 카드에 1px 보더 표시(버그 수정 확인), 고대비 모드(.high-contrast) 라이트/다크 토글 시 깨짐 없음, 모바일(다크)에서 상태바 색이 #0f172a로 바뀌는지(theme-color 메타).