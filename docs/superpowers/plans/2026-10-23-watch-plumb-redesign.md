# 워치 리디자인 "Plumb · 측심" 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확정된 디자인 캔버스(`docs/superpowers/specs/2026-10-23-watch-plumb-redesign/`)대로 watchOS 앱의 표현·모션·문구를 바꾼다. 기록 판단 로직은 바꾸지 않는다.

**Architecture:** 공통 디자인 시스템(토큰, 모션 도우미, 공통 부품, 게이지 기하 계산)을 먼저 만들고, 기록 화면 → 출발 전 화면 → 다이빙 후·기록 화면 순서로 갈아끼운다. 페이지 판단(`RecordingPageModel`), 기록/저장 흐름(coordinator, lifecycle), 햅틱 5종, 1Hz 갱신은 그대로 호출만 한다. 단계마다 문구 카탈로그와 jest 소스 고정 테스트를 함께 고쳐 매 커밋이 초록색이 되게 한다.

**Tech Stack:** SwiftUI(watchOS 10 deployment target, watchOS 26 API는 `if #available`), Xcode 프로젝트 `apps/mobile/ios/Divenary.xcodeproj`(폴더 자동 동기화 없음), XCTest `DivenaryWatchAppTests`, jest 소스 테스트, `Localizable.xcstrings`.

## Global Constraints

- 설계 우선순위: `DECISIONS.md` > `COPY-OVERRIDES.md` > `spec.md`. spec의 CSS px는 2배 값이므로 pt = px ÷ 2.
- 비인증 경계: 감압·NDL·상승 지시 없음. 권장 스탑은 "권장 스탑" 리마인더로만. 기록 화면에 고정 비인증 문장은 두지 않는다(소유자 결정).
- 큰 숫자는 흰색(권장 스탑 남은 시간만 앰버 #FFC74D). 파랑 #2997FF는 누르기·선택과 "다이빙 중" 칩 글자만.
- 글꼴 굵기 400/600/700만(500 금지). 기록 화면 글자 하한 11pt.
- 모션: 물속 자동 변화는 크로스페이드만, 다이버가 넘길 때만 이동(12pt의 절반인 6pt 오프셋 = spec 12px). 예외는 권장 스탑 범위 전환(30→10 m) 600 ms 보간. 튐·오버슈트는 물 밖에서만. 동작 줄이기면 이동→투명도 200 ms. Always-On이면 애니메이션 없음. 숫자는 굴리지 않는다(`.contentTransition(.identity)`).
- 햅틱은 다이버 조작 확인 5종만(view에서 직접 울리지 않음).
- 가오리는 `LOGO.md`의 실제 로고 경로만. `water.waves` 심볼 금지. 다이빙 종류 글리프는 기존 모노핀/탱크 유지(D19 되돌림).
- 문구는 위키 `mobile-watch-ui-language.md`와 `COPY-OVERRIDES.md` 기준. 새 문구는 en/ko 모두 카탈로그에 넣는다.
- 새 Swift 파일은 `project.pbxproj`에 PBXBuildFile, PBXFileReference, Views 그룹 child, 워치 Sources phase `E3A8DB1C792D6C28097C1986`에 등록한다(아이폰 phase `13B07F871A680F5B00A75B9A`에는 넣지 않음). 테스트 파일은 테스트 타깃 Sources phase에 등록한다.
- 게이트(각 단계 커밋 전): `yarn watch:build`, `yarn workspace @repo/mobile watch:ui:check`, `yarn mobile:test`, 워치 동작이 바뀐 단계는 `xcodebuild test -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO`.
- 기준값(2026-10-23 시작 전): watch:build 성공, watch:ui:check 통과, jest 86 suites / 1303 tests 통과, XCTest 356 tests 통과.

## 구현 메모 (모든 Task 공통)

- **문구 키 정책:** 카탈로그 키(영어 원문)는 고정 테스트와 문구 검사가 잡고 있으므로 가능한 한 키를 유지하고 en/ko 값만 바꾼다. 예: `Scuba Diving` ko→"스쿠버", `Simulated depth` en→"Browse without recording" ko→"기록 없이 둘러보기", `Adjust depth with the Digital Crown` ko→"크라운 ▸ 수심 바꾸기", `Log time`/`Time` en→"Dive time" ko→"다이빙 시간"(홈의 `Time` 사용처는 Task 3에서 사라짐), `Saved` ko→"워치에 저장됨", `Time in zone` ko→"스탑 구간 시간", `Target / zone` ko→"목표 수심 / 스탑 구간", `Could not read saved records.` ko→"저장한 기록을 읽지 못했습니다.", `Send failed. Try again.` ko→"전송하지 못했습니다. 다시 보내 주세요.", `No depth samples captured` ko→"물속 기록이 없습니다". C3 통일: `This app is a log review aid, not certified dive equipment.`, `RECREATIONAL USE ONLY. NON-CERTIFIED ASSISTANT.`, `SAVED LOG ONLY. NON-CERTIFIED ASSISTANT.`, `Supplemental log · no safety calculation`의 ko를 모두 "다이빙 기록·복기용입니다. 인증된 다이브 컴퓨터가 아닙니다."로(en도 "For dive logging and review. Not a certified dive computer."로 통일). 새 문구만 새 키를 만든다(C14 본문 등).
- **고정 테스트 정책:** `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`의 워치 고정값 346개 중 로직·안전·흐름(페이지 판단, 크라운·동작 버튼 경로, `Button(` 금지, 비인증 경계, 범위 공식, `layoutWidth = 46`, `VStack(spacing: 3)`, `.padding(.bottom, 8)`+`ignoresSafeArea`, 힌트 문구 키, Always-On 처리)은 지킨다. 디자인이 의도적으로 바꾸는 시각 고정값(예: WetReady의 `Button(String(localized: "Back to Home"), action: onHome)` → 툴바 원형 버튼, 페이지 점 가로 배열, 숫자 파랑 등)만 같은 의도를 확인하는 새 단언으로 바꾸고, 바꾼 줄과 이유를 커밋 본문에 적는다. 고정값을 지우기만 하고 대체 단언을 빼지 않는다.
- **문구 검사(`check-watch-ui-language.mjs`):** 금지어·굵기 500 금지·11pt 하한·`Button(` 금지·크라운 문구 규칙·en/ko 모두 존재 규칙을 지킨다. 검사가 요구하는 리터럴(예: `Adjust depth with the Digital Crown`, `title: "Scuba Diving"`, `HomeRow(title: "Demo"`, `static let minimumHeight: CGFloat = 64`)은 키 유지로 만족시킨다.
- **애니메이션 구현:** `@Environment(\.accessibilityReduceMotion)`과 `@Environment(\.isLuminanceReduced)`를 `DiveMotion`이 받아 처리한다. 숫자는 `.contentTransition(.identity)`. 다이버 넘김은 `RecordingPageChangeReason.isUserInitiated`로 구분한다.

## 파일 구조

- `Views/DiveFormatters.swift` — 기존 `DiveWatchTheme` 토큰을 새 값으로 갱신(이름 유지, 호출부 호환).
- `Views/DiveDesignSystem.swift` (새 파일) — 타이포 스케일(기록 화면 U/S, compact/tight), 모서리·간격 상수, 모션 도우미(`DiveMotion`), 누름 스타일, 공통 부품(StatusChip, MarkerChip, RecordingHintChip(세로 점), MetricHero, ValueRows, GlyphDisc, LogoMark, DepthColumnGlyph, MiniDepthProfile).
- `Views/DepthGaugeRail.swift` — `RecordingGaugeScale` 유지·확장 + 새 `RecordingGaugeGeometry`(y 매핑, 수심 고정 그라데이션 stop, 라벨 양보, 스탑 구간 최소 높이, 지난 다이빙 표시 선택)와 새 게이지 뷰.
- `Views/RecordingView.swift`, `Views/RecordingHint.swift` — 고정 계기 골격, 페이지별 계기, 힌트 칩, Always-On.
- `Views/HomeView.swift`, `Views/WetReadyView.swift`, `Views/UnderwaterControlsView.swift` — 출발 전.
- `Views/RealRecordingFlowView.swift`, `Views/SimulatedRecordingFlowView.swift`, `Views/SummaryView.swift`, `Views/SessionListView.swift`, `Views/SessionDetailView.swift` — 다이빙 후·기록.
- `DivenaryWatchAppTests/DiveDesignSystemTests.swift` (새 파일) — 게이지 기하·그라데이션·라벨 양보·지난 다이빙 표시·분 표시 순수 로직 테스트.
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`, `apps/mobile/scripts/check-watch-ui-language.mjs`, `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings` — 단계별로 함께 갱신.

---

### Task 1: 설계 문서 저장과 디자인 시스템 기초

**Files:**
- Create: `docs/superpowers/specs/2026-10-23-watch-plumb-redesign/*`(완료), 이 계획서
- Create: `apps/mobile/ios/DivenaryWatchApp/Views/DiveDesignSystem.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DiveDesignSystemTests.swift`
- Modify: `Views/DiveFormatters.swift`(`DiveWatchTheme`), `Views/DepthGaugeRail.swift`(기하 계산만 분리, 화면은 Task 2), `Divenary.xcodeproj/project.pbxproj`
- 함께 커밋: 기존 미커밋 `InfoPlist.xcstrings` 2건(소유자 지시: 겹치지 않으면 포함)

**Interfaces (Produces):**
- `DiveWatchTheme`: `canvas`, `platter #262628`, `chip #1C1C1E`, `marker #3A3A3C`, `ink`, `ink2 #AEAEB2`, `ink3 #8E8E93`, `dotOff #5A5A5E`, `action #2997FF`, `caution #FFC74D`, `danger #FF6B61`, `waterStops`(0 m #2F7FD1, 10 m #1F5A99, 40 m #0B2547), `waterArea`, 기존 이름(`primary`, `secondary`, `mutedText`, `surfaceContainer` 등)은 새 값으로 별칭 유지.
- `RecordingGaugeGeometry`: `y(forDepth:) -> CGFloat`, `waterGradientStops(range:) -> [Gradient.Stop]`, `labelOpacity(tick:currentDepth:) -> Double`(지시선 8pt 이내 0.25), `stopZoneFrame(zone:minHeight:)`, `tideMarks(dives:) -> [TideMark]`(최근 5개, 최신 0.8/이전 0.35).
- `DiveMotion`: `press`, `diverPage`, `autoFade`, `rangeChange`(600 ms smooth), `finale` — 동작 줄이기·Always-On을 받아 `Animation?` 반환.
- 공통 부품 뷰 이름은 위 파일 구조와 같다.

- [ ] 실패하는 테스트 작성: 그라데이션 stop(R=30 → [0 #2F7FD1, 0.3333 #1F5A99, 1.0 #11355F 근사], R=10, R=40, R=6), y 매핑(Ultra rail 높이에서 0 m/최대), 라벨 양보, 스탑 구간 최소 18pt, 지난 다이빙 표시 5개 제한과 불투명도, 권장 스탑 분 표시(180초 기준 완료 분 수).
- [ ] 테스트가 실패하는지 XCTest로 확인.
- [ ] 최소 구현 후 통과 확인.
- [ ] 토큰·모션·부품 구현(아직 화면에 연결하지 않아도 됨), pbxproj 등록, 게이트 통과.
- [ ] 커밋: `feat(watch): add the Plumb design system foundation`

### Task 2: 기록 화면과 게이지

**Files:** `Views/DepthGaugeRail.swift`, `Views/RecordingView.swift`, `Views/RecordingHint.swift`, `Views/SimulatedRecordingFlowView.swift`(데모 칩 문구·xmark 위치), 카탈로그, 고정 테스트, 문구 검사.

- 게이지: 수심 고정 그라데이션 채움(D1), 흰 지시선+검은 테두리+셰브론, 최대 수심 선·노치(프리다이빙 하강 중 숨김), 눈금 라벨 양보, 권장 스탑 구간 앰버 띠·목표 핀·채움 50%, 지난 다이빙 표시(P5), 범위 전환 600 ms(P3), 측정 범위 밖 상한선, Always-On 외곽선. `layoutWidth = 46` 유지.
- 골격: 상태 띠 항상 예약 → 게이지+오른쪽 열(캡션·큰 숫자·상태·행 1·행 2·아래 칸) → 힌트 칩(세로 점, 최대 폭 184pt). 수중 잠금 문장은 아래 칸으로 이동. `VStack(spacing: 3)`, `.padding(.bottom, 8)`, `.ignoresSafeArea(.container, edges: .bottom)` 유지.
- 페이지: 스쿠버 실시간/상세, 권장 스탑(진행·일시정지·완료, 분 표시 P2), 종료(칩에 "동작 버튼 ▸ 기록 종료·저장"), 종류 바꾸기, 프리다이빙 수면 대기/다이빙 중/수면 휴식/상세, 수심 정보 없음, 측정 범위 밖, 데모("크라운 ▸ 수심 바꾸기").
- 모션: 기록 시작 시 레일이 위에서 자람, 다이버 넘김만 이동, 자동 변화 페이드, 숫자 즉시 변경, Always-On 300 ms 정착.
- 문구: C15(새 키 "Dive time" → "다이빙 시간"; 프리다이빙 세션 합계는 "총 기록 시간" 유지), D12 종료 칩, C13 데모 칩, P7 저장 재시도 회색.
- [ ] 바뀌는 jest 고정값을 의도에 맞게 갱신(그라데이션 리터럴, 페이지 점 HStack→VStack, 수중 잠금 위치, 숫자 색), 안전·로직 고정값은 유지.
- [ ] 게이트 + XCTest 통과, 시뮬레이터 Ultra 3에서 데모 기록으로 실시간·상세·종료 화면 확인.
- [ ] 커밋: `feat(watch): rebuild the recording instrument in the Plumb design`

### Task 3: 출발 전 화면

**Files:** `Views/HomeView.swift`, `Views/WetReadyView.swift`, `Views/UnderwaterControlsView.swift`, 카탈로그, 고정 테스트.

- 홈: 큰 제목, 시작 카드(글리프 원+파란 재생 원, 비활성·준비·누름·고리), 계획 행, 최근 기록 카드(전송 상태는 아이콘만, 다이빙 종류 없음, 미니 그래프), 저장한 기록·수중 조작·데모(수심 기둥 반쪽 글리프, "기록 없이 둘러보기") 행, 실제 로고+비인증 문장. HM-ENTER/READY/ARM/SPARK.
- 수중 조작 안내: 세로 페이지, 하드웨어 그림(자동 실행은 물이 차오르는 그림), C7 문장.
- 계획: C11 행(제목/글리프+종류/"계획 최대 수심" 값/날짜), 선택 체크 튐(물 밖).
- 기록 대기: P4 물빛 바탕, P12 툴바 홈 원형 버튼, 종류 타일 슬라이드 선택(튐 없음), 시작 안내 3종, 크라운 줄.
- 문구: C1("스쿠버"), C13 데모 행, C3 홈 문장.
- [ ] 게이트, 시뮬레이터에서 홈·안내·계획·기록 대기 확인.
- [ ] 커밋: `feat(watch): redesign Home, Wet Ready, plans and the controls guide`

### Task 4: 다이빙 후·기록 화면

**Files:** `Views/RealRecordingFlowView.swift`, `Views/SimulatedRecordingFlowView.swift`, `Views/SummaryView.swift`, `Views/SessionListView.swift`, `Views/SessionDetailView.swift`, 카탈로그, 고정 테스트.

- 종료 중·저장 중(즉시 표시), 기록 없음(C14, 수심 기둥 글리프), 시작 오류(배너 안쪽), 저장 실패(문구 유지, "(n)").
- 요약(D11): 최대 수심 → 다이빙 시간 → 그래프 → "워치에 저장됨" → 하단 칩 "동작 버튼 ▸ 다음 다이빙 시작". PD-FINALE: 체크 튐, 값 떠오름, 그래프가 그려지고 실제 로고가 선 끝을 따라감, 최대점 등장. 아래로 스크롤: 전송 상태 줄, 권장 스탑 요약(C12 참고 문장 먼저, C6 행), 통계, C3 문장.
- 목록: 날짜, 값, 미니 그래프, 전송 상태 아이콘(전체 문구 접근성 라벨), 종류는 평문, 데모 칩. 읽기 실패(C10, 행 없음), 빈 목록(실제 로고).
- 상세: 세로 페이지 표시, 전체 전송 문구, C5 재전송 안내, C6 권장 스탑 기록, 별점 접근성.
- 문구: C3 통일, C4, C5, C6, C10, C14, C15(스쿠버 저장 화면 "다이빙 시간").
- 데모 전용 흐름(`SimulatedRecordingFlowView`): 저장 중, 데모 요약(요약 상단 상태 줄 옆이나 날짜 줄에 '데모' 표식 칩, 실제 요약과 같은 D11 순서), 데모 저장 실패(`The Action Button retries saving this demo log.` 문구 유지, 실제 저장 실패와 같은 레이아웃), 시작 실패(`persistenceErrorView`), 정리 오류(`cleanupErrorView`)를 실제 기록의 같은 화면 디자인으로 맞춘다. 데모 기록 화면은 Task 2에서 끝낸다(페이지 넘김 없음, 크라운으로 수심 조절, 툴바 닫기 버튼, 안내 칩 "크라운 ▸ 수심 바꾸기").
- [ ] 게이트 + XCTest, 시뮬레이터에서 데모 다이빙 → 저장 → 요약 → 목록 → 상세 확인.
- [ ] 커밋: `feat(watch): redesign the summary, saved logs and post-dive screens`

### Task 5: 위키 갱신

**Files:** `.wiki/raw/design/2026-10-23-watch-plumb-redesign.md`(새 raw), `.wiki/wiki/design/mobile-watch-ui-language.md`, `.wiki/wiki/architecture/watch-app.md`, `.wiki/wiki/domains/safety-rules.md`(교차 참조), `.wiki/wiki/index.md`, `.wiki/wiki/log.md`.

- `karpathy-llm-wiki`·`wiki-writing` 절차. 바뀐 규칙: 수심 고정 그라데이션(정보), 흰 큰 숫자, 모양 문법(캡슐=누름, 둥근 사각=정보), 모션 규칙과 P3 예외, 세로 힌트 점, 수중 잠금 문장 위치, 실측 크롬, 채택 제안 P2–P13, 문구 C1–C15, 실제 로고만, 수심 앱 연상 회피.
- [ ] `yarn codex:check` 중 가능한 범위 실행.
- [ ] 커밋: `docs(wiki): record the Plumb watch redesign`

### Task 6: 최종 검증과 다듬기

- [ ] Ultra 3(49mm)·Series 11(42mm) 시뮬레이터에서 주요 화면 스크린샷을 캔버스와 나란히 비교, 차이를 고친다.
- [ ] 동작 줄이기·Always-On(시뮬레이터 손목 내림) 확인.
- [ ] 전체 변경 Codex 검수(문구는 위키 대조), 결정 후 수정.
- [ ] 실기기 전용 확인 목록(물속 센서, 동작 버튼, Always-On 실제 밝기)을 남긴다.
- [ ] 커밋: `fix(watch): polish the Plumb redesign after device-size review`
