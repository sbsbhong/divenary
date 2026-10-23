# Plumb 워치 재디자인 시뮬레이터 점검 (2026-10-23)

대상: `main` 기준 `a4f30bb` 이후 워치 앱 (`apps/mobile/ios/DivenaryWatchApp`).
목적: 실제 SwiftUI 화면을 크기가 다른 Apple Watch 시뮬레이터 4종에서 캡처해 레이아웃 문제를 찾고, 명확한 버그만 고친다.

## 1. 환경과 방법

- 시뮬레이터: Apple Watch Ultra 3 (49mm), Series 11 (46mm), Series 11 (42mm), SE 3 (40mm), watchOS 26.5.
- 빌드: `DivenaryWatchApp` 스킴, Debug, `CODE_SIGNING_ALLOWED=NO`.
- 상태 주입: 점검용 임시 harness를 `DivenaryWatchApp.swift`에 두고 환경 변수로 화면을 골랐다. 임시 harness와 상태 주입용 임시 setter 변경(`RealDiveSessionCoordinator.swift`, `RecordingPageModel.swift`)은 캡처 후 모두 `git checkout`으로 되돌렸다. 커밋에는 포함되지 않는다.
- 캡처: `xcrun simctl io <udid> screenshot`. 홈 스크롤만 시뮬레이터 스와이프로 얻었다.
- 설계 기준: `docs/superpowers/specs/2026-10-23-watch-plumb-redesign/DECISIONS.md`의 D10(시스템 크롬 예산), D13, D20.

## 2. 기기별 캡처 범위

각 기기에서 다음 상태를 캡처했다: 홈 위, 준비 화면(스쿠버, 프리다이빙), 라이브 기록, 권장 스탑, 종료 페이지(동작 버튼 있음/없음), 프리다이빙 수면 대기, 데모 라이브, 종료 중 오버레이, 시작 실패(배너 표시), 저장 실패, 요약(동작 버튼 있음/없음), 저장 목록, 상세 1페이지. 홈 스크롤은 Ultra 3에서 확인했다.

Always-On과 Reduce Motion은 확인하지 못했다. 두 설정 모두 SwiftUI의 `isLuminanceReduced`와 `accessibilityReduceMotion` 환경 값이 읽기 전용이라 harness에서 강제할 수 없었다. 자세한 내용은 6절에 적었다.

## 3. 확인 결과

- 상태 칩과 시스템 시계/툴바 원: 4종 모두 칩이 시계와 겹치지 않는다. 46mm와 40mm에서도 D10의 36/31pt 오프셋이 적용된다. 툴바 원(뒤로 가기)과 칩의 간격도 유지된다.
- 디스플레이 모서리 잘림: 텍스트 줄은 모두 모서리 곡선 안쪽에 있다. 시작 실패 배너는 화면 하단 모서리 안에 들어온다.
- 시작 실패 배너: 42mm와 40mm에서 배너가 "완료" 버튼을 가렸다. 버튼이 배너 위에 오도록 고쳤다(수정 1).
- 한글 줄바꿈: "Divenary"와 조사가 떨어지지 않는다. 40mm 홈의 두 카드 제목은 같은 11pt로 한 줄에 들어가며 축소되지 않는다(수정 5).
- 40mm 준비 화면: 깊이 판독값이 "0… m"으로 잘리던 문제를 고쳤다(수정 3). 40mm에서는 "수심" 라벨이 칩 아래 줄로 내려간다.
- 40mm 권장 스탑 화면: 한 화면에 맞는다. 칩 "크라운 앞으로 ▸ 상세"와 스탑 구간 표시가 잘리지 않는다.
- 종료 중 오버레이: 게이지는 30% 실루엣으로 남고, 값 열(큰 수치, 행, 힌트 칩, 하단 슬롯)은 0으로 사라진다. 스피너와 "기록을 종료하고 있습니다."는 값 열 가운데에 뜬다(수정 4).
- 저장 실패: 두 줄 메시지와 "다시 저장"이 보인다. "홈 화면으로"는 스크롤 영역 아래쪽에 있어 46mm와 Ultra에서는 하단 모서리에 살짝 걸린다(7절 참고).
- 요약: 최대 수심과 시간이 먼저 보이고, 상태는 한 곳에만 있다. 동작 버튼 힌트 칩은 하단에 있다.
- 홈 스크롤(Ultra 3): 접힌 제목 "다이빙"이 시계 아래 오른쪽에 있고, 카드가 상단 페이드 아래로 지나간다.

## 4. 수정 사항

1. 시작 실패 배너가 버튼을 가리지 않도록 `DiveFlowMessage`의 배너 상태 간격을 줄였다. 배너가 보이는 동안만 글리프 높이와 여백을 줄인다(`DivePostDive.swift`). 배너가 자동으로 사라져도 레이아웃이 흔들리지 않는다.
2. 40mm 홈 카드 제목이 줄임표로 잘리던 문제를 고쳤다. 제목 최소 축소 비율을 0.8에서 0.6으로 낮추고 우선순위를 올렸다(`HomeView.swift`). 40mm에서만 약 2/3 크기로 보인다. 카드 크기 상수는 `DiveDesignSystemTests`가 고정하므로 건드리지 않았다.
3. 40mm 준비 화면의 상태 띠를 적응형으로 바꿨다(`WetReadyView.swift`). 공간이 충분하면 기존처럼 한 줄(칩, "수심 0.6 m")이고, 좁으면 칩 아래 줄에 수심을 둔다. 42mm와 46mm 이상은 한 줄을 유지한다.

## 5. 테스트와 게이트

2026-10-23 추가 수정(수정 4, 5)에 대한 결과는 8절을 본다. 아래는 `a4f30bb` 기준 첫 점검의 결과다.

- `yarn watch:build`: 성공.
- XCTest `DivenaryWatchAppTests`: Ultra 3(49mm) 442건, Series 11(42mm) 442건 모두 통과. `-derivedDataPath /private/tmp/DiveWatchAppDerivedData-t6 CODE_SIGNING_ALLOWED=NO`로 실행했다.
- `yarn workspace @repo/mobile watch:ui:check`: 통과.
- `yarn mobile:test`: 86개 스위트, 1305건 통과.

## 6. 실기기에서 아직 검증해야 할 것

- 수중 깊이 센서 동작과 수면/수중 전환 타이밍. 시뮬레이터는 깊이 값을 주입한 데모 센서만 사용한다.
- 동작 버튼(Action Button) 동작과 힌트 문구. Ultra 계열 판정은 기기 모델 식별자로 하므로, 시뮬레이터에서는 Ultra 3만 동작 버튼 문구를 보인다. 나머지 기기의 "종료 페이지"와 "요약" 캡처는 모두 동작 버튼 없는 문구다.
- Always-On 실제 밝기와 흐림 처리(`isLuminanceReduced`). 시뮬레이터에서 강제할 수 없었다.
- Reduce Motion 동작(`accessibilityReduceMotion`). 같은 이유로 강제하지 못했다.
- 디지털 크라운 페이지 넘김의 손맛과 속도.
- 실제 저장/시작 실패 흐름. 캡처는 실패 상태를 직접 주입했다. 실제 실패 경로는 기기에서 한 번 확인해야 한다.

## 7. 판단이 필요한 남은 항목

- 40mm 홈 카드 제목 크기는 수정 5로 두 카드가 같아졌다. 다만 한 단계 작은 13pt는 "프리다이빙"이 한 줄에 들어가지 않는다(약 50pt 필요, 제목 폭 약 43pt). 11pt가 축소 없이 들어가는 가장 큰 공용 크기다. 13pt 이상으로 키우려면 owner 결정이 필요하다: 카드 간격 상수(`discToTitle`, 테스트가 고정)나 제목 옆 여백을 바꾸거나, 제목을 두 줄로 두는 방법이다.
- 저장 실패 화면의 "홈 화면으로"는 스크롤 영역 하단에 있다. 46mm와 Ultra에서 하단 모서리에 걸쳐 보인다. 스크롤 암시로 보면 괜찮고, 완전히 보여야 한다면 여백을 조정해야 한다.
- 종료 중 오버레이: 수정 4로 해결했다. 값 열이 사라지므로 문구가 숫자 위에 겹치지 않는다.
- 41mm(176pt)는 실기기나 시뮬레이터로 확인하지 못했다. 이 폭은 수정 5의 좁은 제목 기준(170pt) 바깥이라 16pt 제목을 쓰며, "프리다이빙"이 약 0.93배로 줄어들 수 있다. 실측이 필요하다.
- 영어 로캘의 카드 제목은 이번 점검에 포함하지 않았다. 축소 보호(0.6)는 그대로 남아 있어, 영어 제목이 넘치면 카드별로 다르게 줄 수 있다.

## 8. 2026-10-23 추가 수정 (c2e0e36 이후)

대상: `c2e0e36` 이후 워치 앱. 두 수정 모두 `DECISIONS.md` D20의 종료 오버레이와 좁은 화면 시작 카드 항목을 따른다.

- 확인 기기: Apple Watch Ultra 3 (49mm), Series 11 (42mm), SE 3 (40mm). 화면 캡처는 `xcrun simctl io <udid> screenshot`으로 얻었다.
- 임시 harness: 종료 오버레이는 `DivenaryWatchApp.swift`의 DEBUG 전용 환경 변수(`T7_HARNESS=ending`)로 띄웠고, 시작 카드 폭 측정은 `HomeView.swift`에 임시 `onGeometryChange` 출력으로 얻었다. 두 임시 변경은 모두 캡처 후 되돌렸다. 커밋에는 포함되지 않는다.

### 수정 4. 종료 오버레이 (RC-END)

- 게이지(눈금 포함)는 30% 실루엣으로 남는다. 상태 띠도 같은 30%다.
- 값 열(큰 수치, 행, 힌트 칩)과 하단 슬롯(물 밖 잠금 안내, 저장 오류 표시)은 0으로 사라진다. 움직임은 없고 투명도만 바뀐다. 0.15초 ease-out이며 Always-On에서는 애니메이션이 꺼진다(`DiveMotion.animation(.ending)`).
- 스피너와 "기록을 종료하고 있습니다."는 값 열 가운데에 놓인다. 게이지 오른쪽, 전체 높이의 가운데다.
- 구현: `RecordingInstrumentView`에 `isEnding` 입력을 추가했다. `RealRecordingFlowView`는 전체 인스턴스의 불투명도 대신 이 값을 넘기고, 종료 줄은 `RecordingEndingOverlay`로 분리했다.
- 확인: Ultra 3 (49mm) harness, 깊이 14 m 주입. `t7/ending-ultra3-after.png`. 게이지 30%, 값 열 없음, 스피너와 문구가 열 가운데에 있다.

### 수정 5. 좁은 화면 시작 카드 제목 (40mm)

- 이전 상태: 40mm에서 "프리다이빙"은 제목 폭 약 43pt에 맞추려고 `minimumScaleFactor(0.6)`로 약 0.7배(약 11pt)가 되고, "스쿠버"는 16pt였다. 측정값은 자연 폭 "프리다이빙" 62pt, "스쿠버" 37.5pt다.
- 수정: 폭 170pt 미만(40mm)에서는 두 카드 제목에 같은 새 역할 `narrowStartTitle`(11pt, semibold)을 쓴다. 42mm 이상은 기존 `headline`(16pt)을 그대로 쓴다. 판정은 `DiveLayout.startCardTitleRole(screenWidth:)`가 한다.
- 왜 13pt가 아닌가: 한 단계 작은 13pt는 "프리다이빙"이 약 50pt가 필요해 맞지 않는다. 카드 지오메트리 상수(원판, 패딩, 64pt 최소 높이, `discToTitle`)는 테스트가 고정하므로 바꾸지 않았다. 11pt가 축소 없이 들어가는 가장 큰 공용 크기다.
- 측정 결과(40mm, 같은 빌드): "프리다이빙" 제목 폭 42.5pt = 자연 폭 42.5pt, "스쿠버" 25.5pt = 25.5pt. 두 제목 모두 축소되지 않는다.
- 42mm: 두 제목 모두 16pt로 변화 없음. 확인 캡처 `t7/home-top-s11-42-after.png`.
- 40mm 홈 캡처: `t7/home-top-se3-40-after.png`(수정 전 `t7/home-se40-before.png`).
- 테스트: `DiveDesignSystemTests`에 `testStartCardTitleSharesOneSmallerSizeOnTheNarrowestWatch`를 추가했다. 임계값 경계(169/170)와 크기(11pt < 16pt)를 검사한다. `testOffRecordingTypeStartsFromTheLargeTextSize`의 역할 목록에 새 역할 한 줄을 추가했다. `testStartCardKeepsTheSixtyFourPointFloor`의 카드 상수는 바꾸지 않았다.

### 8.1 게이트 (c2e0e36 이후)

- `yarn watch:build`: 성공.
- `yarn workspace @repo/mobile watch:ui:check`: 통과.
- `yarn mobile:test`: 86개 스위트, 1305건 통과.
- XCTest `DivenaryWatchAppTests`, Ultra 3 (49mm): 443건 실행, 실패 0건(`-derivedDataPath /private/tmp/DiveWatchAppDerivedData-t7 CODE_SIGNING_ALLOWED=NO`).
- XCTest `DivenaryWatchAppTests`, Series 11 (42mm): 443건 실행, 실패 0건.
