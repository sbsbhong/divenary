# Watch Underwater Runtime 실기기 검증 체크리스트

## 목적과 판정 원칙

이 체크리스트는 Divenary watch app의 실기기 underwater runtime 경로를 확인하기 위한 것이다. Divenary는 레크리에이션 다이빙 기록과 사후 리뷰 companion이며, 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기 또는 비상 판단 시스템이 아니다.

Simulator XCTest, `yarn watch:build`, Xcode Easy Submersion은 코드 통합의 근거일 뿐 실제 `CMWaterSubmersionManager` sensor, Water Lock, Digital Crown, Action Button, provisioning 또는 `When Submerged` 동작의 성공 근거가 아니다. 각 행의 pass는 아래에 적은 기기 evidence가 있어야만 기록한다.

15cm bag/tank test는 수동으로 시작한 real session에서 얕은 sample이 들어오는지만 검증한다. 약 `0.1m` 표시는 `When Submerged` automatic launch 통과가 아니다. automatic launch는 Xcode Easy Submersion 또는 안전하게 통제된 `>1m` 환경에서 별도로 검증한다.

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
| D2 | 15cm bag/tank에서 Home으로 real session을 수동 시작한다. | Water Lock 활성화와 약 `0.1m` real depth sample, local session ID와 sample 수. | sample 없음, 표시 depth/pressure, Water Lock 미활성, log/crash. | required for shallow manual sampling |
| D3 | D2 결과를 automatic launch로 기록하지 않는다. | test record에 `manual start only; When Submerged not exercised`가 명시돼 있다. | automatic pass로 잘못 분류한 기록. | required classification |
| D4 | Xcode Easy Submersion 또는 안전하게 통제한 `>1m`에서 Divenary를 `When Submerged` app으로 선택한 상태로 system launch한다. | `WKApplicationDelegate.handle(_:)` adoption, 같은 real recording UI, start source `systemAutoLaunch`, log/session ID. | launch 없음, adoption 이전 종료, status/error, hardware/OS/build. | required for automatic launch claim |
| D5 | D4 automatic start에서 저장된 preferred dive mode를 바꾸어 각각 재실행한다. | 자동 기록 plan이 마지막 preferred mode이고 persisted planned dive를 추론하지 않은 evidence. | 예상과 다른 mode, plan leakage, logs. | required |
| D6 | sample이 있는 real recording을 surface한 뒤 Digital Crown을 길게 눌러 Water Lock을 해제한다. | watchOS invalidation 뒤 summary가 정확히 하나, local session ID 하나. | Water Lock 해제 실패, summary 0개/2개 이상, invalidation log. | required |
| D7 | Apple Watch Ultra에서 Divenary를 Action Button Dive app으로 구성한다. 첫 press로 시작하고, 수중 또는 3분 미만 press는 종료하지 않음을 확인한다. surface 상태에서 `>=3m` 뒤 next press로 종료한다. | preferred-mode start, rejected request 동안 계속 recording, accepted request 후 정확히 하나의 summary와 invalidation. | donation/configuration 실패, 잘못된 종료, start/end log. | required on Action Button hardware |
| D8 | real recording을 surface한 뒤 연속 `>10m` 동안 다시 잠기지 않는다. | watchOS invalidation과 summary 하나. Divenary가 별도 timer를 실행했다는 evidence가 없어야 한다. | 종료 없음/조기 종료, event timeline, logs. | required |
| D9 | surface 후 10분 전에 다시 submerge한다. | 기존 local session ID와 recorder가 계속되고 summary가 새 session으로 분리되지 않는다. | 새 ID/새 summary, event timeline. | required |
| D10 | manual 및 Action Button start를 valid depth sample 없이 종료하고, 별도 system auto-launch no-sample attempt도 종료한다. | manual/Action Button은 한 번의 compact no-sample result와 저장 log 없음. system auto-launch는 silent cancellation과 저장 log 없음. | empty record, unexpected summary/UI, duplicate result. | required |
| D11 | demo/debug recording을 실행해 Crown으로 depth를 조절하고 surface-gated touch end를 사용한다. | Water Lock 없이 demo/test marker, Crown control, touch end summary. `WKExtendedRuntimeSession`을 쓰지 않은 debug path. | Water Lock/runtime 호출, touch end 누락, marker 누락. | regression gate |
| D12 | 42mm, 46mm, 49mm에서 real helper row와 demo end row, depth rail, metrics, disclaimer를 확인한다. | 각 size의 screenshot에서 clipping/overlap 없음. | model/size/build별 screenshot과 겹침 위치. | required UI coverage |

## 종료 규칙 확인

real recording에는 touch end action이 없다. 종료는 다음 세 경로가 하나의 idempotent finalizer로 수렴하는지를 확인한다.

1. surface 후 Water Lock을 Digital Crown으로 해제해 watchOS invalidation을 받는다.
2. surface 상태이고 elapsed time이 `>=3m`일 때 Action Button end request가 runtime invalidation을 요청한다.
3. watchOS가 연속 out-of-water `>10m` 뒤 runtime을 invalidation한다.

단일 `notSubmerged` event는 종료 신호가 아니며, app-side 10-minute timer도 없다. demo/debug만 Crown depth simulation과 surface-gated touch end를 유지하고 `WKExtendedRuntimeSession`을 사용하지 않는다.

## 배포 판정

- D1-D12의 각 required 행은 pass/fail/not-run과 evidence path를 남긴다.
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
