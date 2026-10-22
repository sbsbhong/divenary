Source URL: git commits 2df2bd13a7faf32cc2bb7c88ef3c7327115484f2, 90d3874ef9da464906d13b7807e5350b7c0269d5; apps/mobile/ios/DivenaryWatchApp
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 워치 기록 정확도와 화면 흐름 수정

## 근거와 범위

`git show --stat 2df2bd1 90d3874`와 두 커밋의 diff를 읽고, 아래 사실을 `apps/mobile/ios/DivenaryWatchApp`의 현재 코드와 대조한 요약이다.

- `2df2bd1` — `fix(watch): keep records accurate and give every stuck screen a way out` (2026-10-22).
- `90d3874` — `fix(watch): stop the save-failure note covering its button, tidy freedive labels` (2026-10-22).

앞선 위키 반영에는 History 복구 재시도, 프리다이빙의 계속 흐르는 기록 시간, 실제 측정 시각 기준 수온 유효성, 모든 Wet Ready 상태의 홈 복귀, 데모 저장 실패 시 동작 버튼 재시도가 이미 들어 있다. 이번 기록은 그 내용을 반복하기보다 빠진 규칙과 후속 화면 수정을 보존한다.

## 계획값과 선택 수명

- `Models/DiveSession.swift`: `PreDivePlan.plannedMaxDepthMeters`는 기본값 없는 선택 값이다. 계획을 선택하지 않은 기본 시작은 목표 수심과 시간을 만들지 않고 `planned-<n>m` 태그도 추가하지 않는다. `WatchPlannedDive.preDivePlan`도 목표 수심이 없으면 그대로 `nil`을 전달하며 예전의 18 m 대체값을 쓰지 않는다. 목표 수심 태그는 유한한 양수이며 정수 변환 가능한 값일 때만 만든다. 전달받은 `buddyIds`는 `plannedBuddyIds` 배열로 보존해 이름 하나로 합치거나 다시 정규화하지 않는다.
- `Views/HomeView.swift`: `HomePlanSelection.validated`는 현재 계획 목록에서 선택 ID를 다시 찾는다. 없으면 다이빙 모드만 남긴 기본 계획으로 되돌린다. Home 표시 시점, 계획 목록 변경, 명시적 시작 직전에 검증하며, 선택 계획과 다른 모드로 시작할 때도 기본 계획을 쓴다. 계획 화면은 선택이 Home에서 시작할 때만 적용된다고 안내한다.
- `Storage/DiveSessionStore.swift`: 실제 기록의 저장에 성공하면 `markPlanExecuted`가 실행된 계획 ID를 저장하고 목록에서 제거한다. 이후 전달 목록에서도 그 ID를 제외하므로 Home 선택이 해제된다. 모바일에서 제거되어 목록에서 사라진 계획도 같은 선택 검증을 거친다. 데모 저장은 실제 계획을 실행됨으로 표시하지 않는다.

## 종료와 저장 실패 흐름

- `Runtime/RealDiveSessionCoordinator.swift`, `Views/RealRecordingFlowView.swift`: 물 밖·180초 조건을 만족한 종료 요청은 runtime invalidation 전에 `isEnding = true`로 바꾸고 즉시 종료 중 화면을 보인다. 같은 종료 요청을 다시 실행하지 않으며, 대기 중 동작 버튼은 `.rejected(.busy)`와 잠시 기다리라는 안내로 처리한다.
- 실제 저장 실패 화면에는 `Retry Save`와 `Back to Home`이 있다. 홈 복귀는 완료 기록을 앱 범위 `pendingRecords`에 맡기고 recorder 메모리만 정리한다. 미저장 저널을 취소·삭제하지 않는다. `Views/HomeView.swift`는 Home 표시와 앱 활성화 때 보류 기록 저장을 자동 재시도하고, 성공한 기록만 보류 목록에서 제거한다.
- 실제 저장 실패 화면은 동작 버튼이 저장을 재시도한 뒤 새 기록을 시작한다고 안내한다. `prepareForNewSession()`은 재저장도 실패하면 기존 기록과 저널을 보존한 채 새 시작 경로로 넘어간다. 저장 성공만을 새 시작의 필수 조건으로 삼는다는 뜻은 아니다.
- `90d3874`의 `Views/RealRecordingFlowView.swift`, `Views/SimulatedRecordingFlowView.swift`: 실제·데모 저장 실패 안내를 하단 inset 대신 스크롤 본문의 버튼 위에 둔다. `WatchFlowFailureNote(..., dismissesAutomatically: false)`로 자동 소멸하지 않게 하며 Retry 버튼을 덮지 않는다. 실패 번호는 연속 실패도 구분한다.

## 화면 이동과 피드백

- `Runtime/RecordingPageModel.swift`, `Views/RecordingHint.swift`: Always-On 진입은 page model을 Live로 돌리고, 해당 상태에서는 동작 버튼과 크라운의 화면 이동 요청을 무시한다. 화면은 별도 Live 대체값이 아니라 `pages.page`를 그린다. `setAlwaysOn(false)` 이후 이동을 다시 허용한다.
- 크라운 힌트와 `Localizable.xcstrings`는 방향을 명시한다. 앞으로 돌리면 상세, 뒤로 돌리면 실시간이며 한국어도 `크라운 앞으로 ▸ 상세`, `크라운 뒤로 ▸ 실시간`이다.
- `Storage/DiveSessionStore.swift`, `Views/SessionDetailView.swift`: 수동 재전송마다 세션별 시도 번호를 늘린다. manifest 읽기 실패, 즉시 전송 실패와 비동기 전송 실패는 그 번호를 붙여 상세 화면에 알리고, 전송 대기나 동기화 완료 상태에서는 실패 안내를 지운다. iPhone이 이미 확인한 기록은 늦은 실패로 되돌리지 않는다.
- `90d3874`의 `Views/RecordingView.swift`, `Localizable.xcstrings`: 프리다이빙 잠수 중 수심이 끊겨도 상태 표시는 `Dive active`를 유지한다. 큰 기록 시간의 라벨을 상태 표시에 반복하지 않으며 마지막 관측 잠수 시간의 짧은 표시명은 `Last seen` / `마지막 확인`이다.

## 기록 불확실성과 복구 표시

- `Recording/DiveSessionRecorder.swift`, `Recording/ScubaDiveEngine.swift`: 측정 사이뿐 아니라 기록 시작부터 첫 측정, 마지막 측정부터 종료 사이의 공백이 30초를 넘는지도 평가한다. 불완전한 관측의 권장 스탑 결과는 `unknown`으로 저장한다.
- `Models/DiveSessionRecord.swift`, `Views/RecordingView.swift`, `Views/SummaryView.swift`, `Views/SessionDetailView.swift`: 실시간 수심이 없으면 권장 스탑 타이머를 일시정지로 표시하고, 저장 결과가 `unknown`이면 완료 여부·남은 시간·구간 내 시간을 `--`로 보인다. 관측하지 못한 시간을 완료로 표현하지 않는다.
- `Models/DiveSessionRecord.swift`, `Views/SessionListView.swift`, `Views/SummaryView.swift`, `Views/SessionDetailView.swift`: 기존 `profile.interrupted == true`인 기록에는 목록·요약·상세에 `Recovered after interruption` / `중단 후 복구됨` 표식을 붙인다.

## 검증과 안전 경계

위 내용은 커밋과 현재 코드의 대조 결과다. 이 수집에서는 build, XCTest, 시뮬레이터 또는 실기기 동작 검증을 수행하지 않았다. 기록·사후 리뷰와 비인증 보조 알림의 경계를 유지하며 권장 스탑을 감압 의무나 안전 판단으로 설명하지 않는다. 실제 센서, Water Lock, Action Button과 Always-On의 하드웨어 검증 완료를 뜻하지 않는다.
