# Active Physical-Device Test Cases

이 문서는 자동화할 수 없는 현재 활성 수동 테스트만 관리한다. Simulator와 mock 결과는 paired WatchConnectivity delivery나 실제 수중 sensor 동작의 증거로 사용하지 않는다.

## 관리 규칙

- `ONCE-*`: 현재 구현의 일회성 인수 테스트다. 사용자가 해당 ID를 통과했다고 보고하면 이 문서의 활성 목록에서 해당 행을 삭제한다.
- 삭제 전에 날짜, build identifier, iPhone/Watch 모델과 OS, 결과를 `docs/verification/watchconnectivity/`의 dated evidence에 남긴다.
- 실패한 항목은 삭제하지 않는다. 관찰 결과와 재현 조건을 evidence에 기록하고 후속 작업으로 유지한다.
- `REPEAT-*`: 지정된 trigger가 발생할 때 다시 실행한다. 한 번 통과해도 삭제하지 않는다.
- 실제 프리다이빙·스쿠버, 깊은 수심, 40m 경계와 실제 safety-stop profile은 이 문서의 범위가 아니다.

## 실행 준비

- 같은 build의 iPhone 앱과 embedded Watch 앱을 사용한다.
- Debug test가 필요한 항목은 `DiveWatchAppDebug` scheme과 `DIVE_WATCH_DEBUG_CONTROLS=1`을 사용한다.
- 알림, 연결, background 상태를 바꾸기 전에 각 단계의 초기 상태를 기록한다.

## 일회성 인수 테스트

| ID | 테스트 | 통과 조건 |
|---|---|---|
| `ONCE-01` | Companion 설치와 연결 | iPhone 앱과 Watch 앱이 같은 build로 설치되고 Settings가 supported, paired, installed 상태를 표시한다. Watch Home과 Debug test control이 정상 표시된다. |
| `ONCE-02` | Foreground 양방향 기본 흐름 | `Test Scuba`와 `Test Freedive`가 각각 자동 import되어 Logbook에 한 행만 생성된다. toast의 Open/Close가 동작하고, local save 뒤 Watch session이 `synced`가 된다. Cloud sync 문구나 pill은 표시되지 않는다. |
| `ONCE-03` | Reconnect, 수동 drain, 중복과 retry | 연결 해제 중 저장 후 재연결해 자동 import와 수동 sync를 가깝게 실행해도 crash와 중복 행이 없다. 실패 payload는 acknowledge되지 않고 앱 재시작 또는 수동 sync로 재시도된다. |
| `ONCE-04` | Background와 killed delivery | iPhone background에서 local import 후에만 알림이 나타나고 tap 시 해당 Logbook detail로 이동한다. Force-quit 상태의 실제 OS delivery 결과와 재실행 시 durable inbox drain 결과를 기록한다. |
| `ONCE-05` | Planned dive round trip | 미완료 scuba/freedive plan만 Watch에 나타난다. 선택한 plan으로 기록·저장하면 mobile log가 plan metadata로 보강되고 source plan에 완료 상태와 `convertedLogLocalId`가 남는다. |
| `ONCE-06` | 대용량 file transfer | Watch의 `Test Large Sync` 8,000 sample fixture가 저장되고 file transfer로 mobile에 한 번만 import된다. delivery 중 수동 sync를 실행해도 crash·중복이 없고 acknowledgement가 완료된다. |
| `ONCE-07` | 알림 opt-in, 거부와 문구 | 알림 off에서도 foreground toast가 동작한다. 허용 상태는 재시작 후 유지되고, 거부 상태에서는 preference가 off인 채 local import가 동작한다. 문구에 cloud upload, backup, 인증 장비 주장이 없다. |
| `ONCE-08` | 얕은 물 depth와 pressure | 통제된 얕은 물통·수영장에서 real recording의 depth와 pressure가 침수에 반응하고 꺼낸 뒤 surface 값 쪽으로 돌아온다. 비정상 spike/고정값 여부를 기록한다. |
| `ONCE-09` | 수온 미수신과 지연 수신 | OS가 수온을 주기 전에는 live, sample, summary와 mobile detail에 `0°C` 또는 빈 temperature profile이 나타나지 않는다. 실제 수온 수신 후에는 측정값만 저장·표시된다. |
| `ONCE-10` | 얕은 물 lifecycle과 조작성 | 안전하게 통제 가능한 수심에서만 auto-launch/auto-start와 background handoff를 관찰한다. 젖은 화면 가독성, Crown, haptic, accidental-end protection과 non-certified reminder 문구를 확인한다. |

## 반복 회귀 테스트

| ID | Trigger | 다시 확인할 범위 |
|---|---|---|
| `REPEAT-01` | 모든 TestFlight/App Store 후보 build | iPhone·Watch 설치/launch, Settings 연결 상태, foreground test session 한 건의 import와 acknowledgement smoke test |
| `REPEAT-02` | WatchConnectivity, native inbox, repository, import coordinator 또는 저장 schema 변경 | reconnect, 자동·수동 race, duplicate delivery, retry, background/killed drain과 large file transfer |
| `REPEAT-03` | sensor provider, recording lifecycle, watchOS 또는 지원 Watch hardware 변경 | 얕은 물 depth/pressure, optional temperature, auto-launch/handoff, wet control과 haptic |
| `REPEAT-04` | Planbook, notification 또는 Logbook routing 변경 | planned dive round trip, notification opt-in/deny, notification press routing과 local-only copy |
| `REPEAT-05` | signing, bundle identifier, entitlement 또는 companion embed 변경 | 같은 build 설치, paired/installed/reachable, Watch launch와 양방향 WatchConnectivity smoke test |

## 결과 보고 형식

사용자는 완료한 ID와 관찰 결과만 보고해도 된다.

```text
Date / build:
iPhone / iOS:
Watch / watchOS:
Passed IDs:
Failed IDs and observations:
Crash or payload evidence:
```

`Passed IDs`의 `ONCE-*`는 evidence 반영 후 이 문서에서 삭제한다. `REPEAT-*` 결과는 기록만 추가하고 목록은 유지한다.
