# Watch Underwater Runtime 실기기 검증 체크리스트

## 목적과 판정 원칙

이 체크리스트는 Divenary watch app의 실기기 underwater runtime 경로를 확인하기 위한 것이다. Divenary는 레크리에이션 다이빙 기록과 사후 리뷰 companion이며, 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기 또는 비상 판단 시스템이 아니다.

Simulator XCTest와 `yarn watch:build`는 코드 통합의 근거일 뿐 실제 `CMWaterSubmersionManager` sensor, Water Lock, Digital Crown, Action Button, provisioning 또는 `When Submerged` 동작의 성공 근거가 아니다. Xcode Easy Submersion은 simulator에서 system session delivery/adoption과 real recording UI navigation을 확인할 수 있지만, physical sensor delivery, 실제 hardware의 `When Submerged` 선택/auto-launch, Water Lock 또는 device release readiness를 검증하지 않는다. 각 physical 행의 pass는 아래에 적은 기기 evidence가 있어야만 기록한다.

15cm bag/tank test는 수동으로 시작한 real session에서 얕은 sample이 들어오는지만 검증한다. 약 `0.1 m` 표시는 `When Submerged` automatic launch 통과가 아니다. Xcode Easy Submersion 결과는 simulator integration evidence로만 기록한다. physical automatic launch는 지원 hardware에서 Wet Ready를 확인한 뒤 watchOS가 제공하는 threshold에서 별도 검증한다.

## 실측 기록

### 2026-07-19: 15cm 비닐봉지 테스트

- 확인: 실제 수심과 수온 sample 수신.
- 확인: 수심 감지 시 Divenary 자동 실행.
- 미확인: `submergedDeep` 진입과 watchOS 자동 `WKExtendedRuntimeSession` 전달. 테스트 수심이 1m 미만이므로 자동 다이빙 세션이 시작되지 않은 결과는 실패로 판정하지 않는다.
- `D4b`: **NOT RUN**. 얕은 입수에서 Wet Ready, Water Lock, Crown mode 선택을 확인한 뒤 지원 hardware의 platform-provided threshold에서 `handle(_:)`, `systemAutoLaunch`, local session ID를 확인한다.
- `D5`: **NOT RUN**. D4b 통과 뒤 Wet Ready에서 고른 mode가 recording 시작 후 저장 preference 변경에도 유지되는지 확인한다.
- `D6`: **NOT RUN**. sample이 있는 real recording 종료 뒤 touch 입력 없이 local save와 Saved summary가 한 번만 나타나는지 확인한다.
- `D13`: **NOT RUN**. Debug-only forced local-save failure 뒤 같은 local session ID의 retry와 cleanup 순서를 확인한다.
- 미기록 evidence: build/version, Watch model/watchOS, authorization status, local session ID, 사진 또는 screen recording. 다음 실행 때 사전 기록 항목과 함께 보완한다.

## 사전 기록

각 실행에 다음을 남긴다.

- 날짜와 build version/build number
- Apple Watch model, case size, watchOS version, paired iPhone model/iOS version
- Divenary가 설치된 상태인지와 재설치 여부
- `requestAutoLaunchAuthorizationStatus` 표시값
- 시작 원인, local session ID, sample 수, summary 수, crash/console log
- 사진 또는 screen recording: Settings 선택 화면, live depth/Water Lock, summary, Action Button 결과

## Signed Bundle 및 Provisioning Gate

repository metadata와 signed device bundle은 별도 gate다. 먼저 signing credentials가 가능한 환경에서 다음 명령을 실행한다.

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchApp -configuration Debug -destination 'generic/platform=watchOS' -derivedDataPath /private/tmp/DivenaryWatchDeviceDerivedData build
```

성공한 bundle에서 다음을 보관한다.

```bash
plutil -p /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app/Info.plist
codesign -d --entitlements :- /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app
security cms -D -i /private/tmp/DivenaryWatchDeviceDerivedData/Build/Products/Debug-watchos/DivenaryWatchApp.app/embedded.mobileprovision
```

Pass evidence:

- `Info.plist`의 `WKBackgroundModes`에 `underwater-depth`가 있다.
- code-signing entitlement와 embedded provisioning profile 모두에 `com.apple.developer.submerged-shallow-depth-and-pressure`가 있다.
- 설치한 app version/build number, Watch model, watchOS version, `requestAutoLaunchAuthorizationStatus`를 함께 기록했다.

Signing 또는 provisioning이 없으면 exact build failure를 기록하고 이 gate와 이후 physical gate를 미완료로 둔다. `CODE_SIGNING_ALLOWED=NO` simulator build는 이 gate를 대체하지 않는다.

공개 shallow capability는 manager가 허가한 얕은 범위의 sample 접근만 의미한다. 더 깊은 범위는 Apple의 외부 managed entitlement 승인과 provisioning이 필요한 별도 gate다. shallow-signed build를 40m sensor-authorized build로 설명하지 않는다.

## 실기기 행렬

| ID | 순서 | Pass evidence | 실패 시 보관할 내용 | Release gate |
| --- | --- | --- | --- | --- |
| D1 | signed build를 Watch에 설치하고 capability 변경 뒤 재설치한다. Settings > General > Auto-Launch > When Submerged에서 Divenary가 보이고 선택되는지 확인한다. | Settings 화면, 설치 build/version, model/watchOS, authorization status. | 목록 누락 여부, exact status/error, signed-bundle/profile 출력. | required |
| D2 | 15cm bag/tank에서 Home으로 real session을 수동 시작한다. | Water Lock 활성화와 약 `0.1 m` real depth sample, local session ID와 sample 수. | sample 없음, 표시 depth/pressure, Water Lock 미활성, log/crash. | required for shallow manual sampling |
| D3 | D2 결과를 automatic launch로 기록하지 않는다. | test record에 `manual start only; When Submerged not exercised`가 명시돼 있다. | automatic pass로 잘못 분류한 기록. | required classification |
| D4a | Xcode Easy Submersion으로 Wet Ready 뒤 adopted runtime과 runtime-first 순서를 각각 전달한다. | Wet Ready가 먼저 온 경우 armed mode recording, runtime-first인 경우 preferred-mode fallback recording, simulator log/session ID. 이 결과는 simulator integration pass다. | adoption 이전 종료, event-order별 mode 불일치, UI navigation 실패, simulator log. | physical/release gate 아님 |
| D4b | D1에서 선택한 Divenary를 지원 hardware의 얕은 입수에서 Wet Ready로 전환한다. Water Lock이 활성인 상태에서 Crown으로 mode를 고른 뒤 platform-provided threshold에서 `When Submerged` auto-launch를 확인한다. | Wet Ready, active Water Lock, Crown 선택, 실제 hardware `When Submerged` selection, `handle(_:)` adoption, start source `systemAutoLaunch`, build/model/watchOS와 local session ID. | launch 없음, Crown focus/선택 실패, adoption 이전 종료, authorization status/error, hardware/OS/build. | required for physical automatic-launch claim; supported hardware 전에는 not-run |
| D5 | D4b physical automatic start에서 Wet Ready로 고른 Freedive/Scuba mode가 recording mode로 고정되는지 확인하고, recording 시작 뒤 저장 preference를 바꾼다. | active `PreDivePlan`과 recording mode가 Wet Ready 선택을 유지하고 persisted planned dive를 추론하지 않은 evidence. | 예상과 다른 mode, preference overwrite, plan leakage, logs. | required |
| D6 | sample이 있는 real recording을 surface한 뒤 Digital Crown으로 Water Lock을 해제한다. | watchOS invalidation 뒤 post-dive input 또는 Save tap 없이 locally saved summary가 정확히 하나, local session ID 하나. | Water Lock 해제 실패, summary 0개/2개 이상, 조기 Saved 표시, invalidation log. | required |
| D7 | Apple Watch Ultra에서 Divenary를 Action Button Dive app으로 구성한다. existing real recording을 surface한 뒤 `>=180s (3 minutes)`가 지난 시점에만 next press로 종료한다. 수중, unknown state, 또는 `180s` 미만에는 Action Button을 누르지 않는다. | surfaced eligible request 뒤 정확히 하나의 summary와 watchOS invalidation. first-press start와 submerged/unknown/early rejection은 [coordinator unit test](../apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift) 및 [intent unit test](../apps/mobile/ios/DivenaryWatchAppTests/DiveActionButtonIntentTests.swift)로 확인한다. | donation/configuration 실패, surfaced eligible end 실패, summary 0개/2개 이상, start/end log. | required on Action Button hardware |
| D8 | real recording을 surface한 뒤 연속 `>600s (10 minutes)` 동안 다시 잠기지 않는다. | device evidence는 watchOS invalidation timestamp만 기록한다. 별도 source audit에서 [real coordinator](../apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift)에 app timer가 없고, [water-state unit test](../apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift)가 state event만으로 recorder를 끝내지 않음을 확인한다. | invalidation 없음/조기 invalidation, device event timeline. source audit search 결과도 별도 보관한다. | required |
| D9 | surface 후 `600s (10 minutes)` 전에 다시 submerge한다. | 기존 local session ID와 recorder가 계속되고 summary가 새 session으로 분리되지 않는다. | 새 ID/새 summary, event timeline. | required |
| D10 | manual 및 Action Button start를 valid depth sample 없이 종료하고, 별도 system auto-launch no-sample attempt도 종료한다. | manual/Action Button은 한 번의 compact no-sample result와 저장 log 없음. system auto-launch는 silent cancellation과 저장 log 없음. | empty record, unexpected summary/UI, duplicate result. | required |
| D11 | demo/debug recording을 실행해 Crown으로 depth를 조절하고 surface-gated touch end를 사용한다. | Water Lock 없이 demo/test marker, Crown control, touch end summary. `WKExtendedRuntimeSession`을 쓰지 않은 debug path. | Water Lock/runtime 호출, touch end 누락, marker 누락. | regression gate |
| D12 | 42mm, 46mm, 49mm에서 real helper row와 demo end row, depth rail, metrics, disclaimer, live 상태 chip, Dive Plans 화면, 지원 수심 밖 표식, Send Again 버튼을 확인한다. | 각 size의 screenshot에서 clipping/overlap 없음. | model/size/build별 screenshot과 겹침 위치. | required UI coverage |
| D13 | Debug-only forced local-save failure로 sample이 있는 real session을 종료한 뒤 같은 화면에서 자동 retry와 수동 Retry를 각각 실행한다. | `Saved`가 조기 표시되지 않고 같은 local session ID가 유지되며, 성공 뒤 saved session은 정확히 하나다. recorder cleanup은 성공 뒤 한 번만 발생한다. | 실패 record 소실, ID 변경, 중복 session, 조기 cleanup, retry log. | required recovery gate |
| D14 | 얕은 물 real recording에서 depth sample이 5초 넘게 끊기는 상황과, 가능하면 `sensorDepthError`·`pastMaxDepth` 상태를 만든다. | 실시간 화면이 숫자 대신 `--.- m`와 Depth unavailable, Depth sensor error, Outside sensor-authorized depth 중 맞는 상태를 표시하고 상승 속도 숫자를 숨긴다. 30초 넘는 공백이 있었던 저장 기록의 권장 스탑은 `unknown`이다. | 숫자가 계속 남은 화면, 상태 문구, timeline, local session ID. | required |
| D15 | Saved summary가 보이는 상태에서 다시 입수하거나 Home에서 새 real recording을 시작한다. | 이전 summary가 닫히고 새 local session ID로 recording이 시작되며 이전 기록은 정확히 하나만 저장돼 있다. | 시작 거부, summary 잔류, 중복 또는 누락 기록. | required |
| D16 | 권장 스탑 구간(3-6 m)에 머무는 real recording에서 sample 간격과 타이머 감소를 기록한다. | 약 1Hz cadence에서 타이머가 실제 경과 시간과 맞게 줄고, 5초 넘는 sample 공백은 스탑 시간으로 적립되지 않는다. | cadence log, 타이머 화면, local session ID. | required |
| D17 | 입수 전, 입수 중, 출수 뒤의 수온 표시와 저장 sample 수온을 비교한다. | 이전 다이빙이나 recording 시작 전 수온이 새 recording sample에 붙지 않고, 60초 넘게 갱신되지 않은 수온도 sample에 붙지 않는다. | sample JSON, 수온 timeline. | required |
| D18 | iPhone 연결을 끊은 상태로 recording을 저장해 전송을 실패시킨 뒤, 연결을 복구하고 상세 화면의 Send Again을 누른다. | Not sent to iPhone 뒤 Send Again으로 Waiting for iPhone, iPhone import 뒤 Saved on iPhone으로 바뀌고 iPhone에는 기록이 하나만 생긴다. | 상태 전이, iPhone import log, 중복 기록. | required for sync UX |
| D19 | iPhone에서 계획 두 개를 보낸 뒤 Watch Dive Plans 화면에서 선택, 다시 눌러 해제, 선택 상태의 데모 실행을 각각 해 본다. | 선택한 계획으로 시작한 real 기록만 계획을 실행됨으로 표시하고, 데모 기록은 계획을 소모하지 않는다. 수심이 없는 계획은 `--.- m`로 표시된다. | 계획 목록 변화, 기록의 `sourcePlanLocalId`, 화면 캡처. | required |

## 종료 규칙 확인

real recording에는 touch end action이 없다. 종료는 다음 세 경로가 하나의 idempotent finalizer로 수렴하는지를 확인한다.

1. surface 후 Water Lock을 Digital Crown으로 해제해 watchOS invalidation을 받는다.
2. surface 상태이고 elapsed time이 `>=180s (3 minutes)`일 때만 Action Button end request가 runtime invalidation을 요청한다. 수중, unknown state, `180s` 미만 rejection은 unit test 또는 controlled developer harness에서만 확인하며 diver interaction으로 시험하지 않는다.
3. watchOS가 연속 out-of-water `>600s (10 minutes)` 뒤 runtime을 invalidation한다.

단일 `notSubmerged` event는 종료 신호가 아니며, app-side `600-second (10-minute)` timer도 없다. 이 부재는 D8의 device log가 아니라 `RealDiveSessionCoordinator.swift`의 timer-symbol static search와 `testWaterStateChangesDoNotStopOrReplaceRecording` unit test로 감사한다. demo/debug만 Crown depth simulation과 surface-gated touch end를 유지하고 `WKExtendedRuntimeSession`을 사용하지 않는다.

## 배포 판정

- D1-D19의 각 required 행은 pass/fail/not-run과 evidence path를 남긴다.
- signing, `When Submerged`, Water Lock/Crown, timeout, Action Button hardware가 not-run 또는 fail이면 physical runtime success를 주장하거나 release gate를 통과로 표시하지 않는다.
- managed deeper entitlement/provisioning이 없으면 shallow public entitlement 상태로만 기록하고 full-depth behavior는 외부 승인 gate로 둔다.
- 물리 시험 중 sensor/Water Lock/Action Button failure, crash, unexpected multiple summary, no-sample persistence, layout clipping이 나오면 build, device/OS, steps, screenshots/logs, local session ID를 issue에 첨부한다.

## 자동 검증과의 관계

다음은 코드와 simulator 통합 gate다. 실행 성공만으로 위 실기기 행렬의 pass가 되지 않는다.

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData test
yarn watch:build
yarn codex:check
```
