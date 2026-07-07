# Watch Debug Demo Sync And Logbook UX Design

## Context

`diving-app`은 Apple Watch 기반 레크리에이션 다이빙 로그 companion app이다. 이 앱은 인증 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치, 비상 판단 시스템이 아니다. 이번 변경에서도 모든 live UI와 로그북 문구는 기록, 사후 리뷰, 비중요 리마인더 범위 안에 머문다.

사용자 피드백은 다음 문제를 해결해야 한다.

- 일반 Demo는 사용자 체험용인데, 개발자는 프리다이빙과 스쿠버 세션을 모두 빠르게 테스트해야 한다.
- Demo로 실행한 로그가 모바일 로그북에서 가끔 보이지 않는다.
- 스쿠버 로그에는 공기통 시작 압력만 보이고 종료 압력이 보이지 않는다.
- 모바일 로그북의 `완료됨`, `동기화됨`, `대기 중` 같은 배지가 버튼처럼 보이거나 의미가 불명확하다.
- 워치 기록 화면에서 수심계가 우측 상단 시간과 겹치고, 카드형 UI가 실제 기록 화면에 맞지 않는다.
- Demo 중 Digital Crown으로 수심을 조절할 수 없다.
- 세이프티 스톱 중 다시 깊게 내려가면 세이프티 스톱 전용 화면에서 벗어나야 한다.

Apple Depth app은 수중 화면에서 touch와 Digital Crown 입력을 잠그고, 수면에 올라온 뒤 Digital Crown 길게 누르기 또는 Action Button으로 세션을 종료한다. 수면 위에서 10분간 종료하지 않으면 자동으로 종료하고, 그 전에 다시 하강하면 같은 다이빙으로 이어진다. `diving-app`은 Demo와 개발 테스트에서 Digital Crown 수심 제어가 필요하므로 동일한 입력 잠금 모델을 그대로 복제하지 않고, 수면 근처에서만 종료 액션을 노출하는 방식으로 간다.

Reference: https://support.apple.com/en-nz/guide/watch/apd9073c83d6/watchos

## Decisions

- Watch scheme: 새 watch target이나 새 bundle id를 만들지 않고, 같은 `DiveWatchApp` target에 `DiveWatchAppDebug` scheme을 추가한다.
- Debug app behavior: `DiveWatchAppDebug` Debug 빌드에서만 프리다이빙 테스트 시작과 스쿠버 테스트 시작 버튼을 노출한다.
- Demo behavior: 사용자 Demo와 개발 테스트 세션은 실제 저장, summary, sync, mobile import 경로를 통과한다. Demo marker는 watch와 mobile에서 보존한다.
- Mobile sync status: cloud sync가 아직 없으므로 모바일 로그북의 cloud sync 배지는 모두 `대기 중`으로 표시한다. `동기화됨`은 미래 cloud sync 성공 상태에만 예약한다.
- Watch import acknowledgement: watch에서 mobile로 전송되었다는 acknowledgement는 내부 전송 상태로만 다루고, 모바일 로그북의 `동기화됨` 배지로 표현하지 않는다.
- Badge styling: 상태 배지는 primary button과 같은 색을 쓰지 않는다. 버튼처럼 보이지 않는 낮은 대비의 semantic badge 스타일을 사용한다.
- Watch recording layout: 일반 기록 화면은 카드뷰를 쓰지 않는다. 좌측 수심계가 padding과 margin을 제외한 화면 높이를 최대한 차지하고, 남은 영역에 값들을 배치한다.
- End dive control: `다이브 종료` 버튼은 현재 수심이 1.0m 이하에서 3초 이상 유지될 때만 보인다. 수심이 1.2m 이상으로 돌아가면 다시 숨긴다.
- Demo/test depth control: Demo와 Debug 테스트 세션에서는 Digital Crown으로 수심을 직접 조절한다. 수온은 deterministic한 자동 생성 값으로 채운다.
- Safety stop deep exit: 세이프티 스톱 중 counting zone보다 깊게 내려가면 세이프티 스톱 전용 화면에서 벗어나 일반 스쿠버 기록 화면으로 돌아간다.
- Safety stop reset: 세이프티 스톱 타이머는 구간 이탈 직후에는 보존한다. 다만 counting zone 밖에 연속 30초 이상 머무르면 180초부터 다시 시작한다.

## Goals

- 개발자가 Debug scheme에서 프리다이빙과 스쿠버 테스트 세션을 바로 시작할 수 있다.
- Demo로 저장한 로그가 일반 watch log와 같은 sync/import pipeline을 타고 모바일 로그북에 안정적으로 나타난다.
- 모바일 로그북의 cloud sync 상태는 현재 제품 상태에 맞게 `대기 중`으로 일관되게 보인다.
- 모바일 로그 상세에서 스쿠버 공기통 시작 압력과 종료 압력을 모두 표시할 수 있다.
- 모바일 상태 배지가 action button으로 오해되지 않는다.
- 워치 기록 화면에서 수심계, 현재 시간, 값, 종료 버튼이 서로 겹치지 않는다.
- Demo와 Debug 테스트 중에는 Digital Crown으로 수심을 제어할 수 있고, 수온 sample은 자동으로 생성된다.
- 세이프티 스톱은 비중요 reminder로 동작하고, 깊은 구간으로 벗어나면 일반 스쿠버 화면으로 자연스럽게 돌아간다.

## Non-Goals

- 감압 의무, 조직 loading, NDL, deco ceiling, gas switching safety, emergency decision 계산은 하지 않는다.
- `safe to ascend`, `deco clear`, `ceiling clear`, `상승 가능`, `감압 완료`, `이제 안전합니다` 같은 보장 표현은 쓰지 않는다.
- Supabase, auth, cloud sync backend, cloud conflict resolution은 추가하지 않는다.
- 실제 Apple Watch underwater sensor behavior를 인증하거나 보장하지 않는다.
- 스쿠버 gas remaining, gas planning, 호흡량 계산, 종료 압력 자동 추론은 하지 않는다.
- 모바일 로그북 전체 정보 구조를 재설계하지 않는다.

## Relevant Files

- `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchApp.xcscheme`
- `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchAppDebug.xcscheme`
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
- `apps/mobile/ios/DiveWatchApp/DiveWatchApp.swift`
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/DemoDepthSensorProvider.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift`
- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
- `apps/mobile/src/features/watch-connectivity/watch-connectivity-sync.tsx`
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- `apps/mobile/src/hooks/use-dive-logbook.ts`
- `apps/mobile/src/screens/logbook/screen.tsx`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/src/theme/theme.ts`
- `apps/mobile/src/i18n/resources.ts`

## Watch Scheme And Debug Entry Points

`DiveWatchAppDebug`는 same target, same app, Debug configuration의 shared scheme이다. 별도 target을 만들지 않으므로 bundle embedding, signing, WatchConnectivity entitlement, generated source 경로가 분기되지 않는다.

Debug scheme이 필요한 이유는 사용자 Demo와 개발 테스트의 목적이 다르기 때문이다.

- Demo: 사용자가 제품 흐름을 살펴보는 체험용 세션이다.
- Debug test: 개발자가 프리다이빙 engine, 스쿠버 engine, safety stop, 저장, sync, import를 빠르게 검증하는 세션이다.

Debug 버튼은 compile condition이나 build setting에서 유도한 runtime flag로 guard한다. Release scheme에서는 버튼이 노출되지 않는다. Debug 버튼은 기존 recording path를 우회하지 않고, `RecordingView`와 `DiveSessionRecorder`에 명시적 test/demo mode를 전달한다.

Home에서 노출할 개발 버튼은 두 개다.

- `Test Freedive`
- `Test Scuba`

두 버튼은 user-facing release copy가 아니므로 localization 부담을 줄여도 된다. 다만 Debug scheme에서도 safety boundary copy와 Demo marker는 유지한다.

## Recording Mode And Sensor Policy

Recording은 다음 mode를 구분한다.

- `real`: 일반 사용자 기록과 mobile planned dive 시작.
- `demo`: 사용자 Demo.
- `debugTest`: Debug scheme의 프리다이빙/스쿠버 테스트 시작.

`real`은 실제 sensor provider를 사용해야 한다. 기존 PoC 상태에서 mock provider가 남아 있다면 일반 release 시작 버튼과 섞이지 않게 명시적 boundary를 둔다.

`demo`와 `debugTest`는 deterministic provider를 쓴다.

- Digital Crown 값이 수심의 primary input이다.
- 수심은 0m 이하로 내려가지 않는다.
- 수온은 depth, elapsed time, session mode를 기반으로 자동 생성한다.
- 수온 생성은 테스트 재현성을 위해 random이 아니라 deterministic formula를 사용한다.
- sample은 일반 session sample과 같은 model로 저장한다.

Digital Crown control은 Demo와 Debug 테스트에서만 활성화한다. 실제 수중 기록에서는 Crown을 수심 입력 장치로 취급하지 않는다.

## Watch Recording Layout

일반 기록 화면은 instrument-first layout이다.

- root는 카드가 아니라 full-screen ZStack/VStack/HStack 기반 화면이다.
- 시스템 safe area와 watch corner를 고려한 작은 padding만 둔다.
- 좌측에는 `DepthGaugeRail`을 배치한다.
- `DepthGaugeRail`은 padding과 margin을 제외한 usable height를 채운다.
- 우측 영역에는 현재 수심, elapsed time, max depth, temperature, mode-specific values를 숫자 중심으로 배치한다.
- 현재 시간이 표시되는 watchOS top-right area와 수심계가 겹치지 않도록 수심계는 좌측 고정으로 둔다.
- 반복적인 설명 문구는 live recording 중앙에 배치하지 않는다.
- `Demo` 또는 `Test` marker는 작고 읽히는 badge로만 둔다.

`DepthGaugeRail`은 고정 `62x118` 계기판에서 벗어나 부모 height에 맞춰 렌더링한다. scale label과 current marker는 rail 내부에서 안정적으로 정렬되어 hover나 값 변경에 따른 layout shift가 없어야 한다.

## Surface-Gated End Dive

`다이브 종료` 버튼은 항상 보이지 않는다. 기록 중 대부분의 시간에는 수심계와 값들이 화면을 모두 사용한다.

노출 조건:

- current depth가 1.0m 이하이다.
- 위 조건이 3초 이상 유지된다.
- recording state가 finishing 중이 아니다.

숨김 조건:

- current depth가 1.2m 이상이 된다.
- session이 종료된다.
- view가 inactive finishing state로 들어간다.

이 threshold는 종료 버튼 깜빡임을 줄이기 위한 hysteresis다. Demo와 Debug 테스트에서도 같은 조건을 사용한다. 따라서 Crown으로 수심을 1.0m 이하에 두면 종료 버튼이 나타난다.

이 정책은 Apple Depth app의 surface-after-dive 종료 흐름을 참고하되, Demo/test에서 Crown depth control이 필요한 현재 앱 요구에 맞춘다.

## Safety Stop Policy

Safety stop은 scuba mode의 비중요 reminder다. 감압 의무, 안전 보장, 상승 허가를 뜻하지 않는다.

기본 값은 기존 wiki와 현재 구현의 v1 값을 유지한다.

- arm depth: 10m
- target depth: 5m
- display zone: 3m to 6m
- counting zone: 2.7m to 6.3m
- duration: 180s
- reset threshold: 30s continuously outside counting zone

State policy:

- max depth가 10m 미만이면 required가 아니다.
- max depth가 10m 이상이면 safety stop이 armed 상태가 된다.
- ascent 중 display zone에 들어오면 safety stop 전용 화면을 보여줄 수 있다.
- counting zone 안에서는 elapsed delta만큼 remaining seconds를 줄인다.
- counting zone 밖에서는 timer를 pause한다.
- counting zone보다 얕으면 세이프티 스톱 전용 화면에서 pause/shallow 상태를 보여도 된다.
- counting zone보다 깊으면 세이프티 스톱 전용 화면에서 벗어나 일반 scuba recording 화면으로 돌아간다.
- counting zone 밖에 연속 30초 이상 있으면 remaining seconds를 180s로 reset하고 time-in-zone도 0으로 reset한다.
- reset 후 다시 display zone에 진입하면 타이머는 처음부터 시작한다.
- completed 상태는 보존한다. completed 후 다시 깊게 내려가는 경우는 새 stop obligation을 계산하지 않는다.

30초 reset threshold는 wiki의 수심/시간 기본 값 위에 추가하는 product policy다. 이 앱은 NDL, tissue loading, deco ceiling을 계산하지 않으므로 reset은 safety calculation이 아니라 reminder timer 정책으로만 설명한다.

## Demo Sync And Import

Demo와 Debug 테스트 세션은 저장 후 일반 watch sync envelope로 export한다.

Rules:

- Demo/test 세션도 `localSessionId`를 가진다.
- `captureMode` 또는 기존 equivalent field가 `demo`/`debugTest` 의미를 잃지 않는다.
- mobile import는 Demo/test payload를 거부하지 않는다.
- 이미 import된 payload가 다시 들어오면 duplicate를 만들지 않고 acknowledgement는 보낸다.
- acknowledgement는 watch local transfer status 갱신에만 사용한다.
- mobile logbook에 나타나는 cloud sync badge에는 acknowledgement 결과를 반영하지 않는다.

현재 contract에 `captureMode`가 이미 있다면 schema 변경 없이 mapper와 UI 보존만 수정한다. 없다면 schema 원본을 수정하고 generated TypeScript/Swift 출력은 generator로 갱신한다.

## Mobile Cloud Sync Status

모바일 로그북의 sync badge는 cloud sync 기준으로 정의한다.

현재 cloud sync backend가 없으므로 모든 logbook row는 `대기 중`으로 표시한다. watch에서 mobile로 전송되어 local storage에 저장된 상태는 사용자가 볼 cloud sync 성공이 아니다.

Status semantics:

- `대기 중`: cloud sync가 아직 수행되지 않았거나 backend가 없어 대기 중인 상태.
- `동기화됨`: 미래 cloud sync가 실제로 성공한 상태.

`동기화됨`을 watch import success나 local storage write success에 쓰지 않는다. 현재 구현에서 top-level `syncStatus: 'synced'`가 mobile local import 성공을 의미한다면, 사용자 UI mapper에서는 이를 cloud-synced로 해석하지 않는다. 필요하면 domain naming을 나눠 다음처럼 분리한다.

- watch transfer status: watch to mobile import acknowledgement
- local persistence status: mobile storage write success
- cloud sync status: future backend sync status

이번 구현은 cloud sync backend를 추가하지 않고 UI 표시와 mapper 의미만 정리한다.

## Mobile Badge Styling

Badge는 action button과 시각적으로 구분되어야 한다.

Guidelines:

- primary button과 같은 filled primary color를 쓰지 않는다.
- status badge는 low-chroma background, subtle border, semantic foreground를 사용한다.
- `완료됨`은 neutral success tone으로 보이되 primary CTA처럼 보이지 않는다.
- `대기 중`은 warning이 아니라 pending/queued 상태다. 과한 노란색 경고 배지는 피한다.
- `동기화됨`은 미래 cloud success 상태이며, release 전까지 일반 rows에는 나타나지 않는다.
- 터치 가능한 row action과 터치 불가능 status pill의 hit target, elevation, color를 구분한다.

이 변경은 logbook list와 detail에서 같은 status vocabulary를 쓰게 한다.

## Pressure Metadata

스쿠버 pressure model은 시작 압력과 종료 압력을 모두 표현한다.

Rules:

- Manual scuba log는 start pressure와 end pressure를 입력, 저장, 표시할 수 있다.
- Watch-imported scuba log는 watch가 실제 tank pressure sensor를 갖고 있지 않으므로 end pressure를 자동 생성하지 않는다.
- Watch-imported scuba log에 기본 start pressure가 seed되어 있다면, end pressure는 비어 있는 값으로 둔다.
- 사용자가 모바일에서 imported log를 수정할 때 end pressure를 입력할 수 있어야 한다.
- 상세 화면은 둘 다 있으면 `start -> end unit` 형태로 보여준다.
- start만 있으면 start만 보여준다.
- end만 있으면 end value를 잃지 않고 표시한다.

종료 압력은 로그 메타데이터다. 이 값으로 gas remaining, safety recommendation, emergency decision을 계산하지 않는다.

## Data Flow

Watch Debug/Test:

1. 개발자가 `DiveWatchAppDebug` scheme을 실행한다.
2. Home에서 `Test Freedive` 또는 `Test Scuba`를 선택한다.
3. `RecordingView`가 `debugTest` mode와 선택한 dive mode로 열린다.
4. Digital Crown depth input과 자동 수온 provider가 sample을 만든다.
5. 종료 버튼은 수심 1.0m 이하 3초 조건에서만 나타난다.
6. 종료 후 일반 session store에 저장된다.
7. 일반 sync envelope로 mobile에 전송된다.

User Demo:

1. 사용자가 Demo entry point를 선택한다.
2. `RecordingView`가 `demo` mode로 열린다.
3. Digital Crown으로 수심을 조절하고, 수온은 자동 생성된다.
4. 저장, summary, sync, import, logbook display는 일반 pipeline을 사용한다.
5. watch와 mobile UI는 Demo marker를 보존한다.

Mobile Import:

1. WatchConnectivity receiver가 payload를 받는다.
2. validator와 mapper가 session을 local log entry로 변환한다.
3. dedupe key가 이미 있으면 새 row를 만들지 않는다.
4. local storage write가 성공하면 watch로 acknowledgement를 보낸다.
5. logbook row의 cloud sync badge는 `대기 중`으로 표시한다.

## Error Handling

- Demo/test provider가 sample을 만들 수 없으면 recording UI에 non-blocking local error를 표시하고 저장은 막지 않는다.
- imported Demo payload가 duplicate이면 사용자가 볼 error를 만들지 않는다.
- invalid payload는 기존 validation error 경로를 따른다.
- cloud sync status는 backend 부재를 error로 표현하지 않는다. 현재 상태는 `대기 중`이다.
- safety stop reset은 haptic이나 작은 visual change로 알려줄 수 있지만, 안전 지시처럼 표현하지 않는다.

## Tests And Verification

Focused tests:

- `SafetyStopController` unit tests
  - 10m 이상에서 armed
  - counting zone에서 countdown
  - too deep에서 dedicated safety UI 상태 이탈 신호
  - outside zone 29s는 preserve
  - outside zone 30s는 reset to 180s
- `RecordingView` 또는 view model tests
  - end button hidden above 1.2m
  - end button visible after 3s at 1.0m or shallower
  - Demo/debug depth input updates current depth
- mobile mapper tests
  - Demo payload imports and preserves marker
  - duplicate Demo payload does not create duplicate row and can still acknowledge
  - imported log cloud badge maps to pending
  - pressure start/end display cases
- badge snapshot or component tests where existing test infrastructure supports it.

Verification gates:

- Watch, Swift, scheme changes: `yarn watch:build`
- React Native mobile changes: `yarn mobile:typecheck`
- Contract/schema changes, only if schema changes are needed: `yarn check:quick`
- General handoff after watch/mobile/sync behavior changes: `yarn codex:check`

Commands not run are not reported as passing.

## Risks

- The current worktree already has a modified Xcode project file. Implementation must inspect and preserve unrelated project changes before editing schemes or build settings.
- A same-target Debug scheme must not leak debug buttons into Release. Compile/runtime flags need explicit verification.
- Digital Crown depth control can conflict with scroll focus on watchOS. Demo/test recording screen should avoid scrollable controls while Crown depth input is active.
- Safety stop reset threshold is a product policy, not a certified diving calculation. Copy and docs must keep that distinction clear.
- Existing `syncStatus` naming may conflate local import success and cloud sync. Implementation should minimize broad model churn but prevent the UI from showing cloud success when cloud does not exist.
- End pressure for watch-imported logs cannot be inferred. The implementation must display and preserve user-entered end pressure without fabricating sensor data.
