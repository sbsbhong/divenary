# Physical Device Cold Start and Data Integrity Design

Date: 2026-07-26
Status: Implemented with verification concerns
Approval: Approved design

## 배경

실기기에서 다음 세 문제가 함께 확인됐다.

1. 앱을 완전히 종료한 뒤 처음 실행하면 Home의 첫 위치·날씨 요청이 실패하고, 사용자가 다시 시도하면 성공한다.
2. 앱 시작 뒤 탭 전환, 로그아웃 같은 단순 입력까지 약 2~3초 늦게 반응한다.
3. 같은 bundle ID의 앱을 Xcode로 덮어 설치한 뒤 기기에만 있던 로그가 보이지 않고 계정 로그만 남은 것처럼 보였다.

사용자는 앱을 삭제하지 않았으며 `Clean Build Folder`와 재빌드만 수행했다. 따라서 iOS app container가 uninstall로 제거된 경우는 이번 현상의 원인이 아니다.

## 실기기 증거

코드 변경 전에 연결된 iPhone의 `Library` app-data container를 별도로 복사했다. 백업에는 AsyncStorage SQLite 본체, WAL, SHM, Watch profile file과 native WatchConnectivity inbox file이 포함된다.

백업 복사본의 현재 상태는 다음과 같다.

- account Logbook: 6개
- guest Logbook: 0개
- 실패한 guest claim checkpoint: Watch log snapshot 15개
- claim failure: `remote_conflict`, phase `finalizing`
- native WatchConnectivity inbox: 2개
- inbox 2개 중 하나는 실패 checkpoint에 이미 존재하는 artifact이고 하나는 어느 repository/checkpoint에도 없는 새 artifact다.

실패 checkpoint의 15개는 이전 가져오기 시도에서 만든 immutable source snapshot이다. 사용자가 이후 기기 항목을 삭제했으므로 이 snapshot을 현재 live guest inventory로 세거나 자동 복구하면 안 된다. 다만 snapshot과 profile bytes는 명시적 복구를 위한 보존본으로 유지한다.

## 확인된 원인

### 첫 위치·날씨 실패

실기기의 Core Location은 cold start에서 일시적으로 `kCLErrorLocationUnknown`을 보낼 수 있다. 이 상태는 Core Location이 위치를 계속 찾는 중이라는 뜻이다.

현재 `@react-native-community/geolocation` iOS 구현은 이 값을 JS의 `POSITION_UNAVAILABLE`로 전달하고 pending callback을 끝낸다. `location-service.ts`는 이를 최종 실패로 해석하며, Home controller는 Open-Meteo 요청을 시작하지 않는다. 잠시 뒤 native location cache가 준비되므로 사용자 재시도는 성공한다.

### 전체 입력 지연

`WatchConnectivityInbox`는 native pending file을 `String(contentsOfFile:)`로 읽고 pending metadata를 encode/write하는 작업을 iOS main queue에서 동기 실행한다. 새 Watch file 수신과 JS drain 모두 이 경로를 사용한다.

로그인 뒤 account hydration은 remote Watch profile을 JS에서 byte hashing, strict UTF-8 decode, JSON parse, schema validation한 뒤 저장한다. 이 작업도 cold-start interaction과 경쟁한다.

Pressable, tab dispatch와 logout 자체에는 의도적인 delay나 debounce가 없다. 따라서 입력 handler가 늦게 실행되거나 React commit이 늦는 원인은 boot/background 작업의 main/JS thread 점유다.

### 로컬 데이터 손실 위험

`PersistentJsonStore.read()`는 JSON parse, schema version 또는 nested validation이 하나라도 실패하면 오류를 숨기고 `defaultValue()`를 반환한다. Logbook/Planbook의 기본값은 빈 배열이다.

로그인 뒤 remote hydration이 첫 cloud row를 저장하면 repository는 다시 빈 배열을 읽고 cloud row만 담은 새 envelope를 기존 key에 기록할 수 있다. 이 경로는 기존 raw local bytes를 실제로 덮어쓸 수 있다.

현재 실기기 백업은 stale checkpoint와 pending inbox를 통해 일부 과거 artifact가 보존돼 있음을 보여준다. 그러나 silent fallback 경로 자체는 향후 데이터 손실을 만들 수 있으므로 별도로 차단해야 한다.

## 목표

- transient Core Location unknown 상태를 사용자 오류로 표시하지 않고 첫 요청 안에서 회복한다.
- 앱 화면과 탭 입력을 weather, Watch import, Supabase hydration보다 먼저 사용할 수 있게 한다.
- local durable data를 읽지 못하면 빈 목록으로 대체하지 않고 모든 destructive/publishing write를 차단한다.
- 새 Watch artifact는 개수 제한 없이 모두 정확히 한 번 import한다.
- 현재 repository에는 없지만 inactive claim checkpoint에 exact artifact가 남은 경우 자동 재생성하지 않고 imported acknowledgement만 보낸다.
- stale checkpoint item은 live device inventory count로 사용하지 않는다.
- 기존 UI의 시각 구조는 유지한다.

## 비목표

- Supabase schema, RLS, Storage path 또는 Edge Function 변경
- Watch session contract 변경
- 인증된 dive computer 또는 안전 판단 기능
- 전체 local persistence를 SQLite domain schema로 재작성
- 사용자가 과거에 명시적으로 삭제한 15개 checkpoint item의 자동 복구
- production cloud 승격 또는 account deletion

## 설계

### 1. Fail-closed durable JSON

Logbook과 Planbook은 persistent JSON read 오류를 빈 배열로 바꾸지 않는다.

- read failure는 storage key와 cause를 가진 typed error로 throw한다.
- 원본 main key는 수정하지 않는다.
- 원본 raw bytes는 SHA-256으로 식별한 quarantine key에 exact copy하고 readback을 검증한다.
- quarantine write가 실패해도 main key를 수정하지 않고 typed error를 throw한다.
- account bootstrap은 selected principal의 Logbook/Planbook을 publish 전에 한 번 검증한다.
- 검증 실패 시 `recoveryRequired/localRepository` 상태를 사용한다.
- 이 상태에서는 remote hydrate, outbox reconciliation, claim cleanup, save와 delete가 시작되지 않는다.

App preferences처럼 기존 fallback이 안전한 store는 기존 default-on-error 정책을 유지한다. Fail-closed는 durable Logbook/Planbook에 명시적으로 적용한다.

### 2. Recoverable write journal

Logbook/Planbook write는 main key를 교체하기 전에 recoverable journal을 사용한다.

1. 새 envelope를 pending key에 쓴다.
2. pending readback bytes와 SHA-256을 검증한다.
3. digest를 포함한 commit marker를 쓴다.
4. main key에 exact pending bytes를 쓴다.
5. main readback과 digest를 검증한다.
6. commit marker와 pending key를 정리한다.

다음 launch에서 valid commit marker와 pending bytes가 함께 남아 있으면 main write를 완료한다. Pending만 있고 commit marker가 없으면 main이 계속 authoritative하다. Marker나 pending이 malformed하면 main을 덮어쓰지 않고 recovery-required error를 낸다.

AsyncStorage의 single-key replacement 위에 이 journal을 두는 이유는 partial JSON write를 가정하기 위해서가 아니라 multi-step repository/profile 작업과 process termination 사이에서 어느 bytes가 commit 대상이었는지 명시하기 위해서다.

### 3. Historical Watch artifact reconciliation

Watch inbox는 항목 수가 아니라 artifact identity로 판정한다.

Identity는 다음 값이 모두 있을 때만 historical duplicate 판정에 사용한다.

- `localSessionId`
- `contentRevision`
- artifact `sha256`

처리 순서는 다음과 같다.

1. 현재 account/guest repository의 exact artifact를 먼저 확인한다.
2. 현재 row가 없으면 account principal의 inactive claim checkpoint를 확인한다.
3. checkpoint source item도 현재 guest inventory에 없고 exact artifact identity가 일치하면 historical duplicate로 판단한다.
4. Historical duplicate는 repository에 다시 만들지 않고 imported acknowledgement만 native inbox와 Watch에 보낸다.
5. 어느 repository/checkpoint에도 없는 artifact는 정상 import하고 현재 principal에 local commit한 뒤 acknowledge한다.

Checkpoint parse는 cold-start input path에서 즉시 실행하지 않는다. Watch drain 자체를 first interactions 뒤 실행하고, 한 publication 안에서 parsed artifact history를 cache한다.

현재 실기기에서는 이 규칙에 따라 inbox의 historical duplicate 한 개는 다시 표시하지 않고, 새 artifact 한 개는 import한다. 대기 항목 두 개가 모두 새 artifact라면 두 개 모두 import한다.

### 4. Cold-start weather state machine

Home은 app state가 `active`가 된 뒤 location request를 시작한다.

- `POSITION_UNAVAILABLE` code 2만 transient로 분류한다.
- transient failure는 bounded retry delay 뒤 같은 logical request 안에서 재시도한다.
- permission denied와 다른 native error는 재시도하지 않는다.
- retry 전체가 끝난 뒤에만 `unavailable`을 publish한다.
- locale별 single-flight와 ready snapshot cache는 유지한다.
- AppState active event가 같은 logical request를 중복 생성하지 않게 한다.
- 좌표나 위치 문자열은 diagnostic log에 남기지 않는다.

기본 retry는 첫 요청을 포함해 최대 3회이며, retry delay는 250ms, 750ms다. 각 native call은 기존 timeout을 유지한다.

### 5. Interaction-first boot scheduling

Cold-start 순서는 다음과 같다.

1. local repository validation과 UI publication
2. Navigation ready 및 첫 interaction
3. native Watch inbox drain
4. account remote hydrate/drain
5. nonessential checkpoint audit

사용자 명시적 refresh는 interaction scheduler를 기다리지 않고 즉시 실행할 수 있다.

JS Watch import는 한 payload씩 직렬 처리하되 payload 사이에 event loop yield를 둔다. Account hydration도 remote row 사이에 yield해 input event와 React commit이 실행될 수 있게 한다.

### 6. iOS WatchConnectivity queue boundary

`WatchConnectivityInbox`는 mutable inbox/outbox state와 file/UserDefaults 작업을 전용 serial queue에서 관리한다.

- `drainPendingPayloads`, acknowledgement와 incoming file enqueue는 main queue에서 file I/O를 수행하지 않는다.
- file-backed payload dictionary는 serial queue에서 materialize한다.
- React Native promise는 async completion으로 resolve한다.
- NotificationCenter/React event 전달에 필요한 작은 immutable dictionary만 main queue로 전달한다.
- `WCSession` activation과 control-message semantics는 유지한다.
- mobile local repository 저장 뒤에만 imported acknowledgement를 만드는 기존 durability 의미를 유지한다.

### 7. Account profile hydration

Remote metadata hydration은 local UI publication 뒤 schedule한다.

- remote row 사이에 cooperative yield를 둔다.
- profile digest/decode/validation failure는 해당 row만 실패시키고 다른 row hydration은 계속한다.
- explicit refresh는 existing single-flight를 재사용한다.
- profile validation과 owner/path/digest/sample-count 검증은 완화하지 않는다.

이번 변경은 profile format이나 Supabase Storage contract를 변경하지 않는다.

## 오류 처리

- Local durable read/journal 오류: `recoveryRequired`; cloud write와 cleanup 금지.
- Location transient unknown: 사용자 오류 없이 bounded retry.
- Location permission denied: 기존 permission UI.
- Watch historical duplicate: imported acknowledgement, no new row/toast.
- Watch new artifact import failure: native inbox에 유지하고 다음 drain에서 재시도.
- Remote hydration row failure: local rows 유지, degraded retry state.
- Stale/non-current principal callback: 기존 generation guard로 commit 금지.

## 계측

개발 빌드에서 다음 duration만 기록한다.

- location logical request와 각 attempt
- Watch native drain/materialization
- Watch JS payload import
- account hydrate row/profile

좌표, payload JSON, note, site name, user ID와 profile bytes는 기록하지 않는다. 100ms를 넘긴 단계만 warning으로 남긴다.

## 테스트

### Durable storage

- malformed current envelope read가 throw하고 raw main bytes를 유지한다.
- future schema read가 throw하고 raw main bytes를 유지한다.
- read failure 뒤 remote hydrate/save를 시도해도 main bytes가 바뀌지 않는다.
- pending/commit/main 각 crash boundary에서 deterministic recovery를 확인한다.
- valid legacy schema migration은 계속 성공한다.

### Watch reconciliation

- 새 payload 2개는 2개 모두 import/acknowledge한다.
- historical duplicate 1개와 새 payload 1개는 새 payload만 저장하고 둘 다 imported acknowledge한다.
- import 실패 payload는 acknowledge하지 않는다.
- exact identity의 한 field라도 다르면 새 revision으로 정상 처리한다.

### Weather

- first native callback code 2, second success이면 controller는 ready가 된다.
- code 2가 최대 attempt를 초과하면 unavailable이 된다.
- permission denied는 재시도하지 않는다.
- inactive mount는 요청하지 않고 active transition에서 한 번 시작한다.

### Interaction scheduling

- auto Watch drain과 initial cloud hydrate는 after-interactions scheduler 전에는 시작하지 않는다.
- explicit refresh는 scheduler와 무관하게 실행된다.
- remote row와 Watch payload 사이 yield를 호출한다.
- native source check는 pending file read가 main queue sync block에 없음을 고정한다.

## 구현 및 검증 상태

Tasks 1–4의 설계는 `75b38d3`부터 `ab307e1`까지 구현·검토됐다. 최종 focused evidence는 durable persistence 4 suites/117 tests, location/Home conditions 4 suites/38 tests, Watch history 3 suites/111 tests, interaction scheduling JavaScript 3 suites/186 tests와 native queue 계약 5 tests다.

Task 5에서 Node `22.20.0` 경로를 명시해 새로 실행한 결과는 다음과 같다.

- Brief의 exact 11-suite command: exit `1`, 10/11 suites와 297/309 tests pass. 실패 12개는 모두 현재 user-owned native/watchOS/project/script 파일을 읽는 `watch-connectivity-native-source.test.ts`에 있다. 이 결과를 전체 green으로 기록하지 않는다.
- Native-source를 제외한 relevant 10 suites: exit `0`, 276/276 tests pass.
- Task 4 native queue/measurement 관련 5 tests: exit `0`, 5/5 pass.
- `yarn mobile:typecheck`: exit `0`.
- Sandboxed `yarn ios:build`: CoreSimulator/workspace 접근 제한으로 compile 전 exit `66`. 같은 명령의 approved external run은 `ios/Divenary.xcworkspace`, `Divenary`, `generic/platform=iOS Simulator`에서 exit `0`, `BUILD SUCCEEDED`.
- `yarn codex:check`: exit `0`. Sandbox CoreSimulator/provisioning warning이 있었지만 contract generation, mobile typecheck와 `DivenaryWatchApp` watchOS Simulator build가 모두 완료됐다.
- Wiki deterministic lint: 30 articles/index entries, broken link·missing metadata·depth 오류 0개.

Clean archive의 full native-source 비교는 clean base `4274bee`가 20 pass/11 fail, clean head `ab307e1`이 22 pass/같은 11 fail이다. 현재 dirty working tree의 12 failure와 섞어 Task 1–4 회귀로 분류하지 않으며, 이 Task에서 user-owned watchOS/Xcode/cache/script/checklist 파일을 수정하지 않는다.

새 build에서 실기기 cold launch 3회, sync 중 tab/logout 입력의 100ms 미만 feedback과 live pending inbox reconciliation은 실행하지 않았다. 이 세 항목과 현재 기기 inventory 표시는 manual gate로 남는다.

## 완료 기준

- `yarn mobile:typecheck` 성공
- 관련 Jest suite 성공
- `yarn ios:build` 성공
- `yarn codex:check` 성공
- 실기기 cold launch 3회에서 첫 weather request가 transient error 화면 없이 회복
- background sync 중 tab과 logout 입력 feedback이 100ms 안에 시작
- 현재 inbox의 새 artifact가 한 번 import되고 historical duplicate가 다시 나타나지 않음
- stale checkpoint 15개가 device inventory count로 표시되지 않음
- local durable read failure fixture에서 원본 bytes가 보존됨

현재 자동 gate 중 mobile typecheck, non-native relevant Jest, targeted native boundary, external iOS build와 `codex:check`는 통과했다. Exact combined Jest는 현재 user-dirty native source contract 때문에 red이며, 실기기 세 gate는 미실행이다. 따라서 이 완료 기준 전체를 통과했다고 주장하지 않는다.

## 안전 경계

날씨와 위치는 현재 맥락 표시일 뿐 다이빙 적합성, 조류, 감압, 비상 판단을 제공하지 않는다. Watch profile과 동기화 결과는 기록 및 사후 검토용이며 인증된 dive computer를 대체하지 않는다.
