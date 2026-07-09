# 동기화 흐름 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App repository source, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; Diving App repository implementation, 2026-07-09
Raw: [Pre-Karpathy: 동기화 흐름 구조](../../raw/architecture/sync-flow.md); [Planned dive application context delivery](../../raw/architecture/2026-06-28-planned-dive-application-context-delivery.md); [Planned dive context breakpoint hardening](../../raw/architecture/2026-06-28-planned-dive-context-breakpoint-hardening.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Watch session persistence sanitizer](../../raw/architecture/2026-07-09-watch-session-persistence-sanitizer.md); [Watch session file storage](../../raw/architecture/2026-07-09-watch-session-file-storage.md)
Updated: 2026-07-09

## 요약

현재 동기화 모델은 계약을 먼저 정의하는 방식이다. `packages/contracts`가 mode-aware watch sync message를 정의하고, watch 앱은 `DiveSessionRecord`를 동기화 가능한 JSON으로 encode한 뒤 WatchConnectivity `transferUserInfo` envelope로 enqueue한다. 양쪽 앱이 reachable이면 같은 envelope를 `sendMessage`로도 보내 활성 상태의 수신 지연을 줄인다. 모바일 iOS native code는 WatchConnectivity userInfo와 message를 원시 JSON payload로 복원해 durable inbox에 저장하고 React Native로 전달한다. 모바일 JS는 payload를 실행 시점에 검증한 뒤 `DiveLogEntry`로 변환해 영구 저장 repository에 import하고, import가 끝난 payload는 native inbox에서 제거하면서 watch에 `watchSyncAcknowledgement`를 돌려보낸다. 이 acknowledgement는 native WatchConnectivity import 완료만 뜻하며, future cloud sync 성공을 뜻하지 않는다. Cloud sync가 아직 없으므로 imported watch log의 visible cloud status는 현재 `pending`으로 표시된다. 반대 방향의 planned dive 목록은 event history가 아니라 최신 상태이므로, 모바일은 `watchPlannedDives` application context를 갱신하고 watch가 reachable이면 `sendMessage`를 live fast path로 같이 보낸다. iOS native code는 Swift throwing `updateApplicationContext` 호출 대신 Objective-C `updateApplicationContext:error:` selector를 통해 NSError를 상태값으로 받는다.

## 현재 상태

Contract source file은 다음과 같다.

- `packages/contracts/schemas/watch-sync-message.schema.json`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/schemas/watch-depth-sample.schema.json`

Generated output은 다음과 같다.

- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`

`WatchSyncMessage` type은 `sessionCreated`, `sessionUpdated`, `sessionEnded`를 지원한다. `WatchSession`은 `localSessionId`, `startedAt`, `samples`를 require하고, 대부분의 metadata는 optional이다. `diveMode`가 있으면 `freedive` mode에는 `freedive` nested payload가 필요하고, `scuba` mode에는 `scuba` nested payload가 필요하다. Schema는 `freedive`와 `scuba` payload가 동시에 있는 payload나 mode와 nested payload가 맞지 않는 payload를 거부한다. 모바일 계획에서 시작한 watch session은 `sourcePlanLocalId`와 `planTitle`을 포함해 import 시점에 원본 계획과 다시 연결할 수 있다.

## 상세

Session contract가 지원하는 값은 다음과 같다.

- dive mode: `scuba`, `freedive`
- freedive nested payload: `diveCount`, `maxDepthMeters`, `longestDiveDurationSeconds`, `segments`
- freedive segment: `segmentId`, `index`, `startedAt`, `endedAt`, `durationSeconds`, `maxDepthMeters`, `minDepthMeters`, sample range, optional descent/ascent rate
- scuba nested payload: gas label, max/average depth, water temperature, latest/max ascent rate, `safetyStop`
- safety stop record: `unknown`, `notRequired`, `armed`, `active`, `pausedTooDeep`, `pausedTooShallow`, `completed`, `skippedOrIncomplete`, required/completed flags, target/min/max depth, duration, remaining time, time in zone, optional start/completion timestamp
- gas label, site id/name, buddy, gear, tag, note
- source plan local id와 plan title
- capture mode: `real`, `demo`
- rating, perceived exertion, visibility rating, water condition
- sync status: `pending`, `synced`, `failed`
- entry/exit location placeholder
- Unix-second 기반 시작/종료 timestamp
- max depth, average depth, water temperature, depth sample

Depth sample은 `localSessionId`, Unix-second `timestamp`, `depthMeters`를 require한다. `pressureKPa`와 `waterTemperatureCelsius`는 optional이다.

Mobile import 동작은 다음과 같다.

- `src/types/dive-session.ts`는 generated TypeScript contract type을 import한다.
- `src/utils/watch-sync-message-validation.ts`는 원시 JSON string이나 `unknown` value가 `WatchSyncMessage` contract를 만족하는지 실행 시점에 검증한다. Mode와 nested payload가 맞지 않거나 `freedive`와 `scuba` payload가 동시에 있는 session은 import 전에 거부한다. 다만 pre-upgrade watch가 이미 보낸 schema v1/unknown flat session 중 `diveMode`는 있지만 nested payload가 없는 payload는 import 전에 compatibility payload를 합성한다. Freedive는 one-segment payload로, scuba는 unknown safety stop 상태로 보강해 pending inbox 항목이 invalid로 acknowledge되어 유실되지 않게 한다.
- `src/utils/watch-fixtures.ts`는 `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`을 import하고 validator를 통과한 message만 앱 fixture로 export한다.
- `src/native/watch-connectivity.ts`는 iOS native `WatchConnectivityModule`에서 전달되는 raw JSON payload를 React Native event와 drain method로 받고, 무효 payload drop acknowledge와 import 완료 acknowledge를 구분한다. 또한 planned dive update와 linked watch status query를 노출한다.
- `src/states/watch-connectivity-sync.tsx`는 pending native payload를 drain하고 새 event를 구독한 뒤, validator를 통과한 payload를 repository import로 넘긴다. 저장에 성공한 WatchConnectivity 수신 항목은 native inbox에서 import acknowledge되지만, mobile log의 top-level `syncStatus`는 future cloud sync가 없으므로 `pending`으로 남긴다. Raw watch capture 안의 원본 `session.syncStatus`는 보존한다. 새 entry를 자동 import한 경우 root navigation으로 imported entry를 전달해 safe-area 안쪽 toast를 띄우고, 사용자는 toast의 로그 작성 action으로 해당 Logbook detail route를 열거나 닫을 수 있다. Settings opt-in이 켜져 있고 앱이 foreground가 아니면 Notifee local notification도 요청한다.
- `watch-session-to-dive-log-entry.ts`는 `WatchSession`을 watch source `DiveLogEntry`로 변환한다. Freedive segment metadata, scuba safety stop metadata, raw capture mode는 `watchCapture.session`에 보존하고, detail 화면에서 mode별 section과 demo capture marker로 표시한다.
- 모바일 계획에서 시작한 watch session은 import 중 `sourcePlanLocalId`로 원본 `DivePlan`을 조회한다. 찾은 계획의 title, site, buddy, gear, tags, notes, dive mode, gas label, training metadata를 imported log의 manual overlay에 합치고, 원본 계획은 `status: completed`, `completedAt`, `convertedLogLocalId`를 저장한다. 계획 최대 수심과 계획 시간은 실제 측정값이 아니므로 watch capture의 실측 summary를 대체하지 않는다.
- `DiveLogRepository.importWatchMessages`는 validator를 통과해 typed `WatchSyncMessage[]`가 된 payload를 import한다.
- Import는 `localSessionId`와 `endedAt` 기반 key로 deduplicate하고, 기존 manual/mobile field와 `importedAt`을 보존하며, mobile log의 cloud sync 상태를 현재 `pending`으로 둔다. Demo capture도 같은 경로로 import/acknowledge되고 visible log로 남는다. Duplicate native payload는 각각 import acknowledgement를 받을 수 있지만 repository row는 dedupe된다.
- `useDiveLogbook`은 React Query hook을 통해 repository list/save/delete/import mutation을 호출한다.
- `src/utils/dive-log-sync-status.ts`는 현재 visible cloud sync 표시를 중앙화한다. `localOnly`를 제외한 `pending`, `synced`, `failed` model status는 cloud backend가 없는 현재 UI에서 모두 `pending`으로 접는다. `synced` enum은 future cloud sync를 위해 type에 남아 있다.
- `useDivePlans`는 아직 완료되지 않았고 로그로 전환되지 않은 `DivePlan`을 watch에 전달한다. `draft`와 `planned` 상태는 watch Home의 실행 전 계획 후보가 되고, `completed`나 `convertedLogLocalId`가 있는 계획은 제외된다. 모바일 payload는 plan local id, title, site, dive mode, entry style, planned timestamp, planned max depth, planned duration, gas label, buddy ids, gear ids, tags, objective/training focus/notes를 합친 notes를 포함한다.

WatchConnectivity PoC 동작은 다음과 같다.

- Watch app의 `WatchSyncTransport`는 `WCSession`을 activate하고, 저장된 `DiveSessionRecord`의 `syncMessageData()` 결과를 base64로 감싼 property-list userInfo를 `transferUserInfo`로 enqueue한다. `WCSession.isReachable`이면 같은 payload를 `sendMessage`로도 보낸다. activation 완료와 reachability 변경 시 아직 `synced`가 아닌 저장 세션을 다시 enqueue한다. WatchConnectivity가 user info transfer 오류를 알리면 watch local `DiveSessionStore`의 저장 세션 `syncStatus`를 `failed`로 갱신하되, 이미 `synced`인 세션을 뒤늦은 failed 결과로 내리지 않는다. 전송 완료 자체는 모바일 import 완료가 아니므로 `synced`로 바꾸지 않는다.
- Watch app의 `DiveSessionStore`는 session save, persisted load, retry, sync status update 전에 `DiveSessionRecord.sanitizedForPersistence()`를 거친다. 이 단계는 raw sample guard를 통과했더라도 derived payload field나 location metadata에 남을 수 있는 JSON-unsafe `NaN`/`Infinity` 값을 제거하거나 finite fallback으로 바꾼다. Session record array는 CFPreferences/NSUserDefaults 1MB data 제한을 피하기 위해 `Application Support/DiveWatchApp/savedDiveSessionRecords.json` 파일에 저장하며, 기존 `savedDiveSessionRecords` UserDefaults data는 처음 load 때 file storage로 migrate하고 old key를 제거한다. Companion phone이나 WatchConnectivity transport가 없어도 local save는 유지되어야 하며, transport failure는 local persistence 실패가 아니라 watch local `syncStatus` 결과로만 남는다.
- iOS app의 `WatchConnectivityInbox`는 앱 시작 시 `WCSession`을 activate하고, `didReceiveUserInfo`와 `didReceiveMessage`에서 `kind: watchSyncMessage`와 `payloadBase64` envelope를 해독한다.
- Native inbox는 pending payload를 `UserDefaults`에 저장하고 payload별 `payloadId`를 붙인다. `WatchConnectivityModule`은 `drainPendingPayloads`, `DiveWatchSyncPayloadReceived` event, `acknowledgePayloads`, `acknowledgeImportedPayloads` method로 JS에 전달한다.
- JS provider는 repository import 성공 시 `acknowledgeImportedPayloads`를 호출해 mobile inbox에서 payload를 제거하고 watch에 `watchSyncAcknowledgement`를 보낸다. iOS native acknowledgement도 `transferUserInfo`를 기본으로 쓰고, watch가 reachable이면 `sendMessage`로도 보낸다. Watch transport는 acknowledgement를 `didReceiveUserInfo`와 `didReceiveMessage` 양쪽에서 처리한다. 이 acknowledgement는 payload가 모바일 local repository에 저장됐다는 의미이며, Supabase upload나 cloud backup 완료가 아니다. Contract validation 실패처럼 재시도해도 의미가 없는 payload는 mobile inbox에서만 acknowledge한다. Repository save/import 실패는 acknowledge하지 않아 앱 재시작 뒤 다시 drain될 수 있다.
- iOS app의 `WatchConnectivityInbox.updatePlannedDives`는 planned dive JSON을 `watchPlannedDives` application context로 갱신하고, watch가 reachable이면 같은 context를 `sendMessage`로도 보낸다. `WCSession` activation 전이나 일시 실패 시 최신 planned dive JSON을 보관했다가 activation 완료, reachability 변경, watch state 변경 뒤 다시 application context로 flush한다. Planned dive 목록은 최신 상태를 나타내는 데이터라서 stale snapshot이 쌓일 수 있는 `transferUserInfo(context)` queued fallback을 쓰지 않는다. 같은 planned dive JSON이 이미 `WCSession.applicationContext`에 있으면 application context rewrite를 건너뛰어 mobile/watch build 전환 중 같은 상태를 반복 publish하지 않는다. Watch app의 `WatchSyncTransport`는 application context와 message 양쪽에서 planned dives를 decode해 `DiveSessionStore`로 넘기며, activation 완료 시 이미 저장된 `receivedApplicationContext`도 한 번 읽어 watch 앱 시작 시점을 놓치지 않게 한다.
- `WCSession.updateApplicationContext`는 session not activated, paired/watch install state mismatch, companion app not installed, session inactive, invalid parameter, payload too large, unsupported property-list type 같은 NSError를 만들 수 있다. Swift throwing API로 직접 호출하면 catch로 처리해도 Xcode Swift Error breakpoint가 해당 줄에서 멈출 수 있으므로, 모바일 native code는 Objective-C `updateApplicationContext:error:` selector를 직접 호출해 NSError를 `lastContextErrorDomain`, `lastContextErrorCode`, `lastContextErrorDescription` 상태값으로만 보관한다.
- 활성 iPhone/watch simulator 조합에서는 watch pending 세션의 mobile import, mobile durable inbox 비움, watch `syncStatus: "synced"` acknowledgement까지 확인됐다. 이 경로는 compile과 활성 simulator import behavior를 확인하기 위한 PoC이며, background delivery가 실제 기기에서 검증됐다는 뜻은 아니다.

Watch sync notification 동작은 다음과 같다.

- `src/notifications/watch-sync-notification-service.ts`는 Notifee permission request, local notification display, notification press data를 다룬다.
- Settings의 watch sync notification opt-in은 사용자가 켤 때 permission을 요청하고, 거부되면 preference를 켜지 않는다.
- Notification은 `WatchConnectivitySyncProvider`가 payload를 local repository에 저장하고 imported acknowledge까지 처리한 뒤 best-effort로 요청한다. Notification 실패는 repository import나 native inbox acknowledgement를 되돌리지 않는다.
- Foreground 사용자는 local notification 대신 사용자가 닫기 전까지 유지되는 in-app toast를 본다.
- Notification 문구는 local repository 저장 결과만 뜻하며 Supabase upload, cloud backup, certified dive computer data verification을 뜻하지 않는다.

현재 비어 있는 부분은 다음과 같다.

- WatchConnectivity entitlement, background delivery, 장시간 retry, 실기기 paired delivery 검증 없음. Companion embed 구조는 `apps/mobile/ios/DiveMobile.xcodeproj`에 포함되어 있고 활성 simulator 전송은 확인됐지만, 실제 설치/전송은 아직 지원 hardware에서 검증되지 않았다.
- Durable native inbox, reachable live message, acknowledgement 기반 재처리 경로가 있고, Logbook import action은 pending native inbox를 수동 drain한다. Planned dive context는 mobile-to-watch로 전달되지만 사용자-facing retry status와 backoff policy는 아직 없다.
- Watch sync notification code boundary와 Settings opt-in은 구현됐지만, background/killed 상태의 실제 OS delivery와 local notification 표시가 physical paired device에서 검증되지는 않았다.
- Supabase upload와 cloud sync 없음. 따라서 imported watch log는 local save와 watch acknowledgement가 끝나도 cloud status를 `pending`으로 표시한다.
- 인증된 사용자 연결 없음.
- Generated Swift contract는 현재 watch target에 compile되지 않음.
- Legacy watch sessions는 record adapter 또는 mobile runtime compatibility path를 통해 새 mode-aware payload로 동기화될 수 있다. 기존 freedive log는 하나의 segment로 보존되고, 기존 scuba log의 safety stop 상태는 unknown 또는 not required로 취급한다.

## 관련 문서

- [모바일 구조](mobile.md)
- [Watch 앱 구조](watch-app.md)
- [Supabase 구조](supabase.md)
- [다이브 로그 도메인](../domains/dive-log.md)
