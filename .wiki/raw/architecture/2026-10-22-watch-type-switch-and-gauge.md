Source URL: git commits 0ea5433, 509e43d, a1e8d9c; apps/mobile/ios/DivenaryWatchApp; owner messages in the 2026-10-22 session
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 워치 다이빙 종류 바꾸기, 상태 chip 한 줄, 가변 게이지

## 근거와 범위

세 커밋의 diff와 현재 코드를 대조한 요약이다. 시뮬레이터(Ultra 3 49mm, Series 11 42mm)의 DEBUG 전용 화면 픽스처로 찍은 화면을 확인했지만, 픽스처는 커밋하지 않았고 실기기 검증은 하지 않았다.

- `0ea5433` — `feat(watch): let divers switch dive type before the first descent`.
- `509e43d` — `fix(watch): switch type by Action Button only and give the gauge the full height`.
- `a1e8d9c` — `fix(watch): let the depth gauge range follow the dive again`.

## 소유자 요청

- 프리다이빙 기록 화면의 비어 있는 영역을 줄이고, 단계 chip과 상태 chip을 한 줄에 두며 큰 숫자를 키운다.
- 스쿠버를 하려고 물에 들어갔는데 프리다이빙으로 시작되어 있으면 물 밖으로 나와 다시 시작하는 수밖에 없었다. 첫 하강 전에는 종류를 바꿀 수 있게 한다(소유자 선택 1번).
- 첫 구현의 터치 `바꾸기` 버튼을 보고 "이거 뭔데?"라고 물었다. 기록 화면에는 탭 대상이 없다는 규칙에 어긋나고, 기록 중에는 수중 잠금으로 터치가 막혀 쓸 수 없는 버튼이었다.
- 모든 화면에서 수심계가 짧다고 지적했다.
- 예전에는 깊이 들어갈수록 범위가 넓어지고(30 m를 넘으면 40 m), 권장 스탑 때는 스탑을 부각하려고 범위가 좁아졌다. 어느 정도는 가변이기를 원한다.
- `기록용 · 인증 장비 아님`을 다이빙 중에도 보여야 하는지 물었다. 결정은 아직 내리지 않았다.

## 종류 바꾸기(첫 하강 전)

- `Runtime/RecordingPageModel.swift`: `RecordingPage.switchMode`를 추가했다. `modeSwitchAvailable`은 기록 중이고 `maxDepthMeters`가 `modeSwitchDepthLimitMeters`(1 m)보다 얕으며 종료 화면이 순환에 없을 때만 참이다. Action Button 순환은 `[live, details]` 뒤에 `switchMode`, 또는 종료 가능할 때 `end`를 붙인다. 두 화면 모두 누르면 화면을 넘기지 않고 동작하므로 한 순환에 함께 두지 않는다. 크라운은 `live`와 `details`만 움직이고 바꾸기·종료 화면에서는 뒤로만 나간다. 바꾸기 화면이 열린 채 1 m 아래로 내려가거나 종료가 가능해지면 `modeSwitchClosed` 사유로 햅틱 없이 Live로 돌아간다. 다시 물에 들어가 종료 화면이 빠지면 바꾸기 화면이 돌아온다. `restartRecording()`은 새 기록을 Live에서 시작하고 최대 수심 신호를 0으로 되돌린다.
- `Runtime/RealDiveSessionCoordinator.swift`: 바꾸기 화면에서 Action Button을 누르면 `switchDiveModeBeforeFirstDescent()`가 현재 기록을 `cancelSession()`으로 지우고 다른 종류로 `startSession`을 다시 부른다. runtime session은 유지하고, 선택된 계획은 한 종류에 속하므로 `withoutPlannedDiveLink`로 연결을 끊으며, 선호 종류를 바꾼 종류로 저장한다. 결과는 `.modeSwitched(DiveMode)`이고 시작 햅틱을 울린다. 터치 경로는 없다.
- 취소는 저널 정리에 실패해도 센서 수집을 먼저 멈춘다. 그래서 취소나 재시작이 실패하면 `Could not switch the dive type.`(다이빙 종류를 바꾸지 못했습니다)를 알리고 `awaitingRuntimeInvalidation`으로 runtime을 끝낸다. 그 뒤 시작 오류 화면이 정리를 다시 시도한다. 아무것도 기록하지 않는 "기록 중" 화면을 남기지 않기 위해서다. 결과는 `.rejected(.modeSwitchFailed)`다.
- `Views/RecordingView.swift`의 `SwitchModePageInstrument`: 게이지, `스쿠버로 바꾸기`/`프리다이빙으로 바꾸기`, `아직 잠수 전이라 새로 기록합니다.`를 보이고 탭 대상은 없다. `Views/RecordingHint.swift`: 세부 화면에서 `동작 버튼 ▸ 종류 바꾸기 2/3`, 바꾸기 화면에서 `눌러서 스쿠버로 바꾸기`/`눌러서 프리다이빙으로 바꾸기`를 보인다. 방어용 거부 문구는 `잠수 기록이 있어 바꿀 수 없음`이다.
- Action Button이 없을 것 같은 기기(Ultra 힌트 없음)에서는 바꾸기를 할 수 없다. 크라운이 바꾸기 화면을 고르지 않고 터치도 막혀 있기 때문이다. 그때는 기존처럼 기록을 끝내고 다시 시작한다.

## 상태 chip 한 줄과 화면 높이

- 프리다이빙 단계(`수면 대기`, `다이빙 중`, `요약`)를 별도 줄이 아니라 게이지 위 상태 chip 줄의 첫 chip으로 옮겼다. `다이빙 중`만 primary 색이고 나머지는 secondary다. 수면 휴식은 큰 값의 caption이 이미 말하므로 chip을 두지 않는다. 종료 화면과 스쿠버에는 단계 chip이 없다.
- 기록 화면 전체가 시스템 하단 안전 영역(42mm 기준 약 33pt)을 비워 두어 게이지가 짧았다. 이제 그 높이를 쓰고, 하단 8pt 여백으로 가운데 안내 chip이 둥근 모서리에 닿지 않게 한다. 42mm 게이지가 약 35% 길어졌다.
- 높이가 늘어 49mm가 넓은 배치가 되자 나란히 놓인 보조 값에서 `2.1 m/min`이 두 줄로 쪼개졌다. 보조 값은 이제 항상 한 줄에 하나씩 쌓고, 이름과 값이 한 줄에 들어가지 않을 때만 이름 아래에 값을 둔다.

## 가변 게이지 범위

- 2026-10-22 가독성 작업 뒤 `RecordingGaugeScale`은 센서 허용 최대 수심을 알면(Ultra는 40 m) 화면이 요청한 범위를 무시하고 항상 0–40 m를 그렸다. 그래서 12 m 다이빙이 게이지의 3분의 1만 쓰고 권장 스탑 화면의 확대도 사라졌다.
- 이제 화면별 범위를 다시 쓴다. Live·세부·프리다이빙·종료 화면은 `max(30, ceil(max(현재, 최대 수심) / 10) * 10)`이라 30 m에서 시작해 최대 수심이 넘을 때 10 m씩 넓어지고 다이빙 중에는 줄지 않는다. 권장 스탑 화면은 `max(10, ceil((max(현재, 스탑 구간 하단) + 2) / 2) * 2)`로 보통 0–10 m이며 3–6 m 구간이 크게 보인다. 센서 허용 최대 수심은 상한으로 남아 그 너머를 그리지 않는다(`upperBound = max(1, min(range, displayLimit))`). 눈금은 1·2·5 단위로 네 개 이하다(30 m는 0/10/20/30, 40 m는 0/20/40, 10 m는 0/5/10).

## 검증과 남은 결정

- 세 커밋 각각에서 `DivenaryWatchAppTests` XCTest(최종 352개), `yarn watch:build`, 워치 UI 언어 검사, watch-connectivity jest pin(45개)을 통과했다. `yarn mobile:lint`는 오류 0개다.
- 실기기 Action Button 바꾸기, 수중 1 m 판정, 하단 여백과 둥근 모서리, 41/46mm 배치는 확인하지 않았다.
- `기록용 · 인증 장비 아님`을 다이빙 중에도 계속 보일지는 소유자 결정 대기다. 현재 규칙과 코드는 모든 기록 화면에 표식을 유지한다.

## 추가: 비인증 표식 결정과 후속 수정

- 소유자 결정: 기록 화면에서는 `기록용 · 인증 장비 아님` 표식을 빼고, 홈·입수 대기·저장 요약·상세의 비인증 문장은 그대로 둔다. `Views/RecordingView.swift`에서 표식을 지웠고, 워치 UI 언어 검사와 jest pin은 기록 화면에 표식이 없고 Home·Wet Ready·저장 요약·상세에 전체 문장이 있는지 확인한다.
- 커밋 `a2929af`: 49mm 워치 홈의 최근 기록 카드에서 `테스트` 배지가 두 줄로 쪼개지던 문제를 배지 전용 줄로 고쳤다. 수중 조작 안내에 `잠수하기 전에는 종류 바꾸기 화면에서 눌러 스쿠버와 프리다이빙을 바꿀 수 있습니다.`를 더했다.
- 소유자가 실기기에서 `눌러서 프리다이빙으로 바꾸기`가 무엇을 누르라는지 알 수 없고, 동작 버튼을 길게 누르면 사이렌이라고 지적했다. 칩을 `동작 버튼 ▸ 스쿠버로 바꾸기`/`동작 버튼 ▸ 프리다이빙으로 바꾸기`로, 수중 조작 안내를 `잠수하기 전에는 종류 바꾸기 화면에서 동작 버튼을 눌러 스쿠버와 프리다이빙을 바꿀 수 있습니다.`로 바꿨다.
- 소유자 실기기 확인: 다이빙 세션 중 크라운을 돌리면 크라운 옆 초록 스크롤 표시만 나타나고 화면이 바뀌지 않았다. 원인은 `RealRecordingPager`가 회전값의 매 변화(소수 단위)를 반올림해 늘 0칸으로 버린 것이다. `CrownDetentCounter`가 누적값의 정수 칸을 세도록 바꾸고 스크롤 표시를 숨겼다. 크라운 감도(`.low`)의 체감은 실기기 확인 대상이다.
