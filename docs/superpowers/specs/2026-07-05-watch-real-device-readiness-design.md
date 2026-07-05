# Watch Real Device Readiness Design

## Context

`diving-app`은 Apple Watch 기반 레크리에이션 다이빙 로그 companion app이다. 이 앱은 인증 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치, 비상 판단 시스템이 아니다. 모든 실시간 UI와 문서는 기록, 사후 리뷰, 비중요 리마인더 범위 안에 있어야 한다.

이번 설계의 목표는 Apple Watch Ultra급 지원 기기에서 실제 수심 센서를 기본으로 사용해 실기기 테스트를 시작할 수 있는 상태를 만드는 것이다. 가짜 데이터는 개발, 테스트, 데모 모드에서만 명시적으로 사용한다.

현재 확인된 문제와 요구는 네 축으로 묶인다.

- 모바일 로그 상세에서 샘플이 많으면 수심/수온 프로필이 보이지 않는다.
- 수심 프로필 방향이 사용자의 기대와 반대다. 시간에 따라 깊어지면 선이 아래로 내려가야 한다.
- 워치 UI가 카드와 안내 문구 중심이라 실제 수중 기록 화면으로는 복잡하고, 수심계/시간/종료 버튼/문구가 겹친다.
- 실기기 테스트, 데모 체험, 수심 감지 자동 실행 준비가 필요하다.

## Decisions

- Approach: 실기기 readiness 통합 패스로 진행한다. 모바일 차트, 워치 UI, 워치 계획 흐름, 실제 센서, 데모, 자동 실행 준비를 한 스펙에 묶되 구현은 단계별로 나눈다.
- Real data policy: 일반 사용자/실기기 기록은 실제 센서만 사용한다. 테스트 데이터는 명시적 데모/테스트 모드에서만 사용한다.
- Watch install policy: iPhone 앱은 유지하고, companion watch 앱은 Apple Watch Ultra급 수중 수심 기능 지원 기기에서만 설치/실행 가능한 방향으로 제한한다. 빌드 설정만으로 완전 제한이 안 되면 runtime gate를 함께 둔다.
- Watch planning policy: 워치에서 계획 작성/편집 기능은 제거한다. 모바일에서 내려온 계획은 선택만 가능하다. 계획 없는 프리다이빙/스쿠버 즉시 시작은 유지한다.
- Watch recording UI: 일반 기록은 수심 최우선 계기판형으로 간다. 세이프티 스톱 상태에서만 타이머 중심 전용 화면으로 전환한다.
- Demo policy: 데모 세션은 Digital Crown 등으로 수심을 조작할 수 있고 저장 가능하다. 워치/모바일 list/detail/chart/import 전체에서 `Demo` 표시를 보존한다.
- Chart policy: raw watch samples는 보존하고, 렌더링 전용 point만 다운샘플링한다. 단순 head cut이 아니라 peak를 보존하는 방식으로 chart 형태를 유지한다.

## Goals

- 850개 이상 watch sample이 있는 로그에서도 모바일 수심/수온 profile을 안정적으로 렌더링한다.
- 수심 chart는 `0m = 상단`, 깊을수록 하단으로 표시한다.
- watch recording 화면에서 수심 숫자, 시간, 수심계, 종료 버튼, 안내 문구가 겹치지 않는다.
- watch Home은 시작 허브로 단순화한다.
- watch plan 작성 UI를 없애고 mobile planned dive 선택만 남긴다.
- 실제 지원 watch에서 일반 기록은 `CMWaterSubmersionManager` 기반 sample만 사용한다.
- demo/test data path가 실제 recording path와 섞이지 않게 코드 구조로 분리한다.
- 수심 감지 자동 실행 설정/status UI를 준비한다.
- 실기기 검증 체크리스트를 명확히 남긴다.

## Non-Goals

- 감압 의무, 조직 loading, NDL, gas switching safety, emergency decision 계산은 하지 않는다.
- "safe to ascend", "deco clear", "ceiling clear", "상승 가능", "감압 완료", "이제 안전합니다" 같은 보장 표현은 쓰지 않는다.
- Supabase, auth, cloud sync는 추가하지 않는다.
- 모바일 전체 로그북 리디자인은 하지 않는다.
- 워치에서 전체 planbook 관리 기능을 만들지 않는다.

## Architecture

### Sensor Providers

`DepthSensorProvider` protocol은 유지하되 구현과 주입 경계를 명확히 나눈다.

- `RealDepthSensorProvider`
  - `CMWaterSubmersionManager` delegate를 구현한다.
  - `didUpdateMeasurement`에서 depth, pressure, surface pressure, submersion state를 읽는다.
  - depth는 meter로, pressure는 kPa로 변환해 `DepthSample`에 넣는다.
  - `didUpdateTemperature`는 최신 수온을 cache하고 이후 sample에 반영한다.
  - depth/pressure가 nil이거나 sensor depth error 상태면 sample을 만들지 않거나 recorder 상태에 sensor warning을 남긴다.
- `DemoDepthSensorProvider`
  - 기존 mock provider의 역할을 명시적으로 바꾼다.
  - demo screen 또는 automated tests에서만 사용한다.
  - 일반 recording initializer의 기본값이 되어서는 안 된다.
- Test fake provider
  - deterministic test-only source로 둔다.
  - demo UX와 product code path를 오염시키지 않는다.

`RecordingView`는 `recordingMode: real | demo` 또는 동등한 명시적 값을 받는다. 일반 시작 버튼과 mobile planned dive 시작은 `real`을 넘기고, demo button만 `demo`를 넘긴다.

### Watch Home Flow

Watch Home은 scrollable card feed가 아니라 시작 허브가 된다.

- 작은 상태줄: sensor availability, auto-launch status, saved log count.
- 주요 액션: `프리다이빙 시작`, `스쿠버 시작`.
- mobile planned dives: 있으면 선택 리스트를 보여준다.
- demo action: 일반 시작과 분리된 `Demo` entry point.
- recent session: 한 줄 요약 수준.
- large `Dive Watch` 안내 카드는 제거한다.
- 반복적인 안전 문구는 live screen 중심에 두지 않고 하단/정보 화면으로 축소한다.

### Watch Planning Flow

워치의 plan 작성/편집 surface는 제거한다.

- `DivePlanSetupView`의 text fields, stepper, mode picker 등 watch-side editing controls를 제거한다.
- `WatchPlannedDive.preDivePlan`은 mobile plan 선택 시만 사용한다.
- 선택된 mobile plan이 현재 start mode와 맞지 않으면 선택을 해제하거나 mode에 맞는 plan만 보여준다.
- plan 없이도 real freedive/scuba start는 가능해야 한다.

### Watch Recording UI

일반 기록 화면은 수심 최우선 계기판형이다.

- 현재 수심 숫자가 가장 크다.
- "현재 수심" 같은 설명 문구는 UI에서 제거하거나 accessibility label로만 둔다.
- 시간은 수심계와 겹치지 않는 고정 위치에 둔다.
- max depth, temperature, ascent reference는 작은 숫자 중심으로 둔다.
- guide/disclaimer text는 반복적으로 중앙에 노출하지 않는다.
- `다이브 종료` 버튼은 live instrument와 하단 disclaimer 사이에 충분한 spacing을 갖는다.

세이프티 스톱 화면은 상태가 active, paused, completed일 때만 전용 UI로 전환한다.

- 정상 범위에서는 설명 문구를 계속 보여주지 않는다.
- 구간 이탈이나 timer pause처럼 사용자가 바로 알아야 할 때만 색상 band, gauge highlight, haptic을 사용한다.
- 문구는 recommended stop reminder 수준을 유지한다.
- 인증 장비 대체나 안전 보장 표현은 금지한다.

### Demo Flow

Demo는 실제 기록 UI와 같은 계기판을 쓰되 `Demo` 배지를 항상 보인다.

- Digital Crown으로 수심을 조절한다.
- scripted descent/ascent profile은 보조 control로 둘 수 있다.
- demo session은 저장 가능하다.
- summary, session list, session detail, mobile import, mobile logbook detail에서 demo marker가 보존된다.

## Mobile Chart Design

현재 `SessionProfile`은 sample마다 bar view를 만든다. 이 방식은 850개 이상 samples에서 렌더링 부담과 작은 flex width 문제가 생긴다.

새 chart renderer는 이미 설치된 `react-native-svg`를 사용한다. 새 chart library는 추가하지 않는다.

### Data Handling

- raw `watchCapture.samples`는 절대 줄이거나 덮어쓰지 않는다.
- chart renderer 내부에서만 render points를 만든다.
- input samples는 timestamp 기준으로 정렬한다.
- NaN, Infinity, 음수 수심, 중복 timestamp는 방어적으로 처리한다.
- 수온이 모두 missing이면 temperature chart는 unavailable state를 보여준다.

### Downsampling

샘플이 많은 경우 chart width 또는 최대 point 수를 기준으로 렌더링 전용 다운샘플링을 한다.

- 단순히 앞 N개만 자르지 않는다.
- min/max bucket 또는 LTTB 계열처럼 peak와 valley를 보존하는 방식을 사용한다.
- chart shape가 실제 profile의 중요한 변화를 잃지 않게 한다.
- downsampling 함수는 순수 함수로 분리해 단위 테스트한다.

### Depth Direction

Depth chart는 다음 방향을 고정한다.

- `0m`는 chart 상단.
- `maxDepthMeters`는 chart 하단.
- 시간이 지날수록 더 깊어지는 profile은 화면에서 아래로 내려간다.

Temperature chart는 별도 scale을 사용한다. 수심 방향과 혼동되지 않게 색상과 legend를 분리한다.

## Sync Contract And Data Model

Demo 여부는 watch/mobile sync contract에 보존되어야 한다. generated output은 직접 수정하지 않고 schema/generator를 거쳐 갱신한다.

Preferred additions:

```json
{
  "captureMode": "real"
}
```

or

```json
{
  "isDemo": true
}
```

Recommended shape is `captureMode: "real" | "demo"` because it leaves room for future explicit modes without overloading boolean semantics.

Rules:

- Missing `captureMode` in legacy payloads is treated as `real`.
- Demo payloads import like normal watch logs but carry `Demo` UI marker.
- Manual overlay editing must not erase `captureMode`.
- Mobile list/detail/chart must show `Demo` for demo logs.

## Device Support And Auto Launch

### Install And Runtime Gate

Watch target should declare every feasible capability/build setting/Info.plist requirement that restricts installation to watches with water submersion depth support. If Xcode/App Store cannot express the exact hardware rule, runtime checks are required.

Runtime checks:

- `CMWaterSubmersionManager.waterSubmersionAvailable`
- `CMWaterSubmersionManager.authorizationStatus`
- `WKInterfaceDevice.current().waterResistanceRating` where useful

If unsupported:

- general real start is disabled.
- demo remains available only as demo.
- UI says supported watch is required for real recording.
- iPhone app remains installable and usable for log review.

### Auto Launch

The watch app exposes a status/action for depth-detection auto launch.

- Use `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatusWithCompletion`.
- Display `active`, `inactive`, and error/unsupported states.
- Prepare delegate handling for extended runtime session recovery.
- Actual launch-on-depth behavior remains a real-device validation item until tested on supported hardware.

Auto-launch copy must avoid safety guarantees. It is a convenience setting for opening the app, not a safety system.

## Testing

### Automated Gates

- Contract/schema/generator change: `yarn check:quick`.
- Mobile chart/import change: `yarn mobile:typecheck` and focused Jest tests.
- Watch Swift/UI/native change: `yarn watch:build`.
- Watch UI language boundary: `yarn workspace @repo/mobile watch:ui:check`.
- General handoff after this scope: `yarn codex:check` when local environment permits.

### Automated Test Cases

- Watch session with 850+ samples renders depth and temperature profile.
- Chart renderer preserves raw samples and only downsamples render points.
- Monotonically deepening depth profile produces increasing y coordinates.
- Temperature missing samples do not crash and show sparse/unavailable UI.
- Demo watch session imports with `Demo` marker.
- Demo marker persists in list/detail/chart.
- Legacy payload without `captureMode` imports as real.
- General watch recording path cannot accidentally use demo provider as default.
- Watch Home no longer exposes plan editing fields.
- Mobile planned dive selection remains available on watch.
- Watch safety copy guard continues to block forbidden safety guarantee phrases.

### Manual Real-Device Checklist

- Ultra급 supported watch can install and launch companion app.
- Unsupported watch cannot install companion watch app or cannot start real recording.
- Motion & Fitness permission prompt appears and denied/authorized states are handled.
- Real depth sample arrives.
- Real water temperature sample arrives.
- Surface/submerged transitions arrive.
- Sensor depth error does not produce safety claims.
- General recording uses real sensor only.
- Demo recording is clearly marked and remains marked after sync.
- Auto-launch authorization returns expected active/inactive/error state.
- Depth-detected auto launch works or is documented as unsupported on the tested setup.
- Wet/underwater readability of depth/time/gauge is acceptable.
- End button spacing and haptic feedback are usable.

## Risks

- Watch hardware install restriction may not be fully expressible through build settings alone. Runtime gate and App Store metadata may both be needed.
- `CMWaterSubmersionManager` cannot be validated in simulator.
- Auto-launch can return unsupported if the WatchKit extended runtime session type/capability is not configured correctly.
- Chart downsampling can distort profile shape if it does not preserve peaks and valleys.
- Demo logs can be mistaken for real logs if marker preservation is incomplete.
- Existing dirty worktree files touch watch recording and mobile import paths. Implementation must preserve unrelated user changes.

## Relevant Files

- `apps/mobile/src/components/ui/session-profile.tsx`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/src/screens/home/screen.tsx`
- `apps/mobile/src/screens/memory/screen.tsx`
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- `apps/mobile/src/utils/import-watch-session.ts`
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
- `apps/mobile/src/types/dive-session.ts`
- `apps/mobile/src/types/dive-log-entry.ts`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`
- `apps/mobile/ios/DiveWatchApp/Sensors/DepthSensorProvider.swift`
- `apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift`
- `apps/mobile/ios/DiveWatchApp/Sensors/MockDepthSensorProvider.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SessionListView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

## Acceptance Criteria

- Large watch sample sessions show mobile depth and temperature charts.
- Depth chart direction matches diving intuition: deeper is lower.
- Watch general recording screen is numeric and uncluttered.
- Watch safety stop UI appears only in relevant states.
- Watch plan editing is gone; mobile plan selection remains.
- Real recording uses real sensor provider on supported devices.
- Demo/test provider is only reachable through explicit demo/test entry points.
- Demo sessions remain visibly marked everywhere.
- Auto-launch status/request UI exists and reports unsupported states honestly.
- The implementation passes the relevant local gates or reports exact unverified gates.
