# 동기화 흐름 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App repository source, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; Diving App repository implementation, 2026-07-09; pre-device depth safety sync readiness implementation, 2026-07-09; Watch session UI and sync startup fixes, 2026-07-10; Large watch session file transfer, 2026-07-11; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Guest data account claim implementation evidence, 2026-07-19; Guest data account claim staging promotion evidence, 2026-07-20; Guest claim target ID and verifier correction evidence, 2026-07-20; Mobile claim bootstrap and theme recovery, 2026-07-22; Guest claim profile quarantine, 2026-07-22; Watch profile digest recovery and list badges design, 2026-07-24; Device claim live inventory correction, 2026-07-26; Home conditions and device inventory performance hardening, 2026-07-26; Device inventory checkpoint hint hardening, 2026-07-26; Account sync and claim recovery evidence, 2026-07-26; Account float roundtrip recovery evidence, 2026-07-26
Raw: [Pre-Karpathy: 동기화 흐름 구조](../../raw/architecture/sync-flow.md); [Planned dive application context delivery](../../raw/architecture/2026-06-28-planned-dive-application-context-delivery.md); [Planned dive context breakpoint hardening](../../raw/architecture/2026-06-28-planned-dive-context-breakpoint-hardening.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Watch session persistence sanitizer](../../raw/architecture/2026-07-09-watch-session-persistence-sanitizer.md); [Watch session file storage](../../raw/architecture/2026-07-09-watch-session-file-storage.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md); [Watch session UI and sync startup fixes](../../raw/architecture/2026-07-10-watch-session-ui-sync-fixes.md); [Large watch session file transfer](../../raw/architecture/2026-07-11-large-watch-session-file-transfer.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md); [Guest data account claim staging promotion evidence](../../raw/architecture/2026-07-20-guest-data-account-claim-staging-promotion.md); [Guest claim target ID and verifier correction evidence](../../raw/architecture/2026-07-20-guest-claim-target-id-verifier-correction.md); [Mobile claim bootstrap and theme recovery](../../raw/architecture/2026-07-22-mobile-claim-bootstrap-theme-recovery.md); [Guest claim profile quarantine](../../raw/architecture/2026-07-22-guest-claim-profile-quarantine.md); [Watch profile digest recovery and list badges design](../../raw/architecture/2026-07-24-watch-profile-digest-recovery.md); [Device claim live inventory correction](../../raw/architecture/2026-07-26-device-claim-live-inventory.md); [Home conditions and device inventory performance hardening](../../raw/architecture/2026-07-26-home-device-inventory-performance.md); [Device inventory checkpoint hint hardening](../../raw/architecture/2026-07-26-device-inventory-checkpoint-hint-hardening.md); [Account sync and claim recovery evidence](../../raw/architecture/2026-07-26-account-sync-claim-recovery.md); [Account float roundtrip recovery evidence](../../raw/architecture/2026-07-26-account-float-roundtrip-recovery.md)
Updated: 2026-07-26

## 요약

현재 동기화 모델은 Watch-to-mobile local import, authenticated account outbox sync, guest-to-account claim을 서로 다른 durability 경계로 다룬다. Watch import acknowledgement는 mobile local repository 저장만 뜻한다. Account mutation은 local save와 outbox 뒤 remote revision을 조정한다. Guest claim은 immutable snapshot을 staging하고 remote finalize/readback과 account local publication/readback을 마친 뒤 `cleanupPending`을 저장하고 guest reconciliation을 시작한다.

## 현재 상태

Contract source file은 다음과 같다.

- `packages/contracts/schemas/watch-sync-message.schema.json`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/schemas/watch-depth-sample.schema.json`

Generated output은 다음과 같다.

- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`

`WatchSyncMessage` type은 `sessionCreated`, `sessionUpdated`, `sessionEnded`를 지원한다. `WatchSession`은 `localSessionId`, `startedAt`, `samples`를 require하고, 대부분의 metadata는 optional이다. `diveMode`가 있으면 `freedive` mode에는 `freedive` nested payload가 필요하고, `scuba` mode에는 `scuba` nested payload가 필요하다. Schema는 `freedive`와 `scuba` payload가 동시에 있는 payload나 mode와 nested payload가 맞지 않는 payload를 거부한다. 모바일 계획에서 시작한 watch session은 `sourcePlanLocalId`와 `planTitle`을 포함해 import 시점에 원본 계획과 다시 연결할 수 있다.

모바일 local data는 `guest`와 `user:<uuid>` principal로 분리된다. Account 저장은 durable outbox를 통해 typed Supabase repository로 전달되고, guest claim은 separate persistent manifest로 재개된다. 두 cloud 흐름 모두 현재 authenticated user에 묶이며 user 전환 뒤 stale callback을 publish하지 않는다.

## 상세

Session contract가 지원하는 값은 다음과 같다.

- dive mode: `scuba`, `freedive`
- freedive nested payload: `diveCount`, `maxDepthMeters`, `longestDiveDurationSeconds`, `segments`
- freedive segment: `segmentId`, `index`, `startedAt`, `endedAt`, `durationSeconds`, `maxDepthMeters`, `minDepthMeters`, sample range, optional descent/ascent rate
- scuba nested payload: gas label, max/average depth, water temperature, latest/max ascent rate, `safetyStop`
- safety stop record: `unknown`, `notRequired`, `armed`, `active`, `pausedTooDeep`, `pausedTooShallow`, `completed`, `skippedOrIncomplete`, compatibility `required` flag, completed flag, optional `recommendationType: "recommended"`, target/min/max depth, duration, remaining time, time in zone, optional start/completion timestamp
- unsupported depth record: whether the session exceeded the Apple Watch based supported limit, `limitMeters`, observed `maxDepthMeters`, optional `firstExceededAt`, and source `reason`
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
- `src/utils/watch-sync-message-validation.ts`는 원시 JSON string이나 `unknown` value가 `WatchSyncMessage` contract를 만족하는지 실행 시점에 검증한다. Mode와 nested payload가 맞지 않거나 `freedive`와 `scuba` payload가 동시에 있는 session은 import 전에 거부한다. Optional `unsupportedDepth` metadata와 `safetyStop.recommendationType: "recommended"`는 strict key/type validation을 통과해야 한다. Mandatory/decompression처럼 읽히는 다른 recommendation type은 현재 v1 contract에서 거부한다. 다만 pre-upgrade watch가 이미 보낸 schema v1/unknown flat session 중 `diveMode`는 있지만 nested payload가 없는 payload는 import 전에 compatibility payload를 합성한다. Freedive는 one-segment payload로, scuba는 unknown safety stop 상태와 `recommendationType: "recommended"`로 보강해 pending inbox 항목이 invalid로 acknowledge되어 유실되지 않게 한다.
- `src/utils/watch-fixtures.ts`는 `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`을 import하고 validator를 통과한 message만 앱 fixture로 export한다.
- `src/native/watch-connectivity.ts`는 iOS native `WatchConnectivityModule`에서 전달되는 raw JSON payload를 React Native event와 drain method로 받고, 무효 payload drop acknowledge와 import 완료 acknowledge를 구분한다. 또한 planned dive update와 linked watch status query를 노출한다.
- `src/states/watch-connectivity-sync.tsx`는 새 native event를 먼저 구독한 뒤 pending native payload를 drain하고, validator를 통과한 payload를 repository import로 넘긴다. Provider와 manual action은 `WatchConnectivityImportCoordinator` singleton을 공유한다. 같은 concurrent `payloadId`는 한 번만 저장·acknowledge·notify하고, 다른 payload는 직렬 처리하며 선행 실패 뒤에도 다음 작업을 실행한다. 저장 성공 항목의 `cloudSyncStatus`는 `notConfigured`이고 raw watch capture의 `session.syncStatus`는 보존한다.
- `watch-session-to-dive-log-entry.ts`는 `WatchSession`을 watch source `DiveLogEntry`로 변환한다. Freedive segment metadata, scuba safety stop metadata, raw capture mode, unsupported-depth metadata는 `watchCapture.session`에 보존하고, detail 화면에서 mode별 section, demo capture marker, unsupported-depth marker로 표시한다.
- 모바일 계획에서 시작한 watch session은 import 중 `sourcePlanLocalId`로 원본 `DivePlan`을 조회한다. 찾은 계획의 title, site, buddy, gear, tags, notes, dive mode, gas label, training metadata를 imported log의 manual overlay에 합치고, 원본 계획은 `status: completed`, `completedAt`, `convertedLogLocalId`를 저장한다. 계획 최대 수심과 계획 시간은 실제 측정값이 아니므로 watch capture의 실측 summary를 대체하지 않는다.
- `DiveLogRepository.importWatchMessages`는 validator를 통과해 typed `WatchSyncMessage[]`가 된 payload를 import한다.
- iOS native inbox가 `WatchConnectivityPayload.sha256`과 byte count로 `sessionEnded` 전체 artifact bytes를 검증한 뒤, 모바일은 full sample array의 `JSON.stringify` UTF-8 SHA-256을 별도로 계산한다. `watchCapture.profile.sha256`은 이 profile sample digest이고 remote profile object와 account outbox/guest claim 검증에만 사용한다. `artifactSha256`은 전송 artifact digest로서 mobile local metadata와 Watch artifact 중복 판정에만 사용하며 remote database나 Supabase Storage contract로 보내지 않는다.
- Import는 `localSessionId`와 `endedAt` 기반 key로 deduplicate하고, 같은 Watch artifact 재수신은 `localSessionId`, `contentRevision`, `artifactSha256`으로 판정한다. `artifactSha256`이 없는 legacy row는 기존 `sha256`을 artifact digest로 해석해 같은 artifact를 중복 저장하지 않는다. 기존 manual/mobile field와 `importedAt`을 보존하며, mobile cloud 상태를 `notConfigured`로 둔다. 열려 있는 session은 key의 `endedAt` 자리에 `open`을 사용하고, 나중에 같은 `localSessionId`의 ended session이 들어오면 별도 ended import key로 저장된다. Demo와 DEBUG large fixture도 같은 경로로 import/acknowledge된다.
- `useDiveLogbook`은 React Query hook을 통해 repository list/save/delete/import mutation을 호출한다.
- 모바일 Logbook envelope는 기존 `dive-app:logbook:v2` key를 유지하면서 schema 3을 사용한다. Schema 2의 `localOnly`/`pending`/`synced`/`failed` top-level 값은 모두 `cloudSyncStatus: notConfigured`로 migration하고 raw Watch status와 manual edit는 유지한다.
- `useDivePlans`는 아직 완료되지 않았고 로그로 전환되지 않은 `DivePlan`을 watch에 전달한다. `draft`와 `planned` 상태는 watch Home의 실행 전 계획 후보가 되고, `completed`나 `convertedLogLocalId`가 있는 계획은 제외된다. 모바일 payload는 plan local id, title, site, dive mode, entry style, planned timestamp, planned max depth, planned duration, gas label, buddy ids, gear ids, tags, objective/training focus/notes를 합친 notes를 포함한다.

WatchConnectivity PoC 동작은 다음과 같다.

- Watch app의 `WatchSyncTransport`는 `WCSession`을 activate하고 session 크기와 관계없이 finalized artifact 하나를 `transferFile`로 enqueue한다. `transferUserInfo`와 `sendMessage`는 session body 전송에 쓰지 않고 acknowledgement와 planned-dive control path에만 남긴다. Activation 완료와 reachability 변경 시 아직 `synced`가 아닌 저장 세션을 다시 enqueue한다. WatchConnectivity file transfer 오류가 나면 watch local `DiveSessionStore`의 저장 세션 `syncStatus`를 `failed`로 갱신하되, 이미 `synced`인 세션을 뒤늦은 failed 결과로 내리지 않는다. 전송 완료 자체는 모바일 import 완료가 아니므로 `synced`로 바꾸지 않는다.
- Watch app의 `DiveSessionStore`는 session save, persisted load, retry, sync status update 전에 `DiveSessionRecord.sanitizedForPersistence()`를 거친다. 이 단계는 raw sample guard를 통과했더라도 derived payload field나 location metadata에 남을 수 있는 JSON-unsafe `NaN`/`Infinity` 값을 제거하거나 finite fallback으로 바꾼다. Session record array는 CFPreferences/NSUserDefaults 1MB data 제한을 피하기 위해 `Application Support/DivenaryWatchApp/savedDiveSessionRecords.json` 파일에 저장하며, 기존 `savedDiveSessionRecords` UserDefaults data는 처음 load 때 file storage로 migrate하고 old key를 제거한다. Companion phone이나 WatchConnectivity transport가 없어도 local save는 유지되어야 하며, transport failure는 local persistence 실패가 아니라 watch local `syncStatus` 결과로만 남는다.
- iOS app의 `WatchConnectivityInbox`는 `AppDelegate` launch와 React Native module init 양쪽에서 `WCSession`을 activate한다. 현재 file-only sender의 `didReceive file`에서는 callback 동안만 유효한 URL을 즉시 읽어 durable pending artifact로 복사하고 revision/digest/byte/sample identity를 검증한다. `didReceiveUserInfo`와 `didReceiveMessage`의 `kind: watchSyncMessage`/`payloadBase64` decoder는 이전 watch build의 queued payload를 잃지 않기 위한 legacy inbound compatibility path다.
- Native inbox는 pending payload를 `UserDefaults`에 저장하고 payload별 `payloadId`를 붙인다. `WatchConnectivityModule`은 `drainPendingPayloads`, `DiveWatchSyncPayloadReceived` event, `acknowledgePayloads`, `acknowledgeImportedPayloads` method로 JS에 전달한다.
- JS provider는 repository import 성공 시 `acknowledgeImportedPayloads`를 호출해 mobile inbox에서 payload를 제거하고 watch에 `watchSyncAcknowledgement`를 보낸다. Live event payload가 `payloadId` 없이 들어온 경우에는 repository import를 시도하되 native acknowledgement 대상에는 넣지 않는다. iOS native acknowledgement도 `transferUserInfo`를 기본으로 쓰고, watch가 reachable이면 `sendMessage`로도 보낸다. Watch transport는 acknowledgement를 `didReceiveUserInfo`와 `didReceiveMessage` 양쪽에서 처리한다. 이 acknowledgement는 payload가 모바일 local repository에 저장됐다는 의미이며, Supabase upload나 cloud backup 완료가 아니다. Contract validation 실패처럼 재시도해도 의미가 없는 payload는 mobile inbox에서만 acknowledge한다. Repository save/import 실패는 acknowledge하지 않아 앱 재시작 뒤 다시 drain될 수 있다.
- iOS app의 `WatchConnectivityInbox.updatePlannedDives`는 planned dive JSON을 `watchPlannedDives` application context로 갱신하고, watch가 reachable이면 같은 context를 `sendMessage`로도 보낸다. `WCSession` activation 전이나 일시 실패 시 최신 planned dive JSON을 보관했다가 activation 완료, reachability 변경, watch state 변경 뒤 다시 application context로 flush한다. Planned dive 목록은 최신 상태를 나타내는 데이터라서 stale snapshot이 쌓일 수 있는 `transferUserInfo(context)` queued fallback을 쓰지 않는다. 같은 planned dive JSON이 이미 `WCSession.applicationContext`에 있으면 application context rewrite를 건너뛰어 mobile/watch build 전환 중 같은 상태를 반복 publish하지 않는다. Watch app의 `WatchSyncTransport`는 application context와 message 양쪽에서 planned dives를 decode해 `DiveSessionStore`로 넘기며, activation 완료 시 이미 저장된 `receivedApplicationContext`도 한 번 읽어 watch 앱 시작 시점을 놓치지 않게 한다.
- `WCSession.updateApplicationContext`는 session not activated, paired/watch install state mismatch, companion app not installed, session inactive, invalid parameter, payload too large, unsupported property-list type 같은 NSError를 만들 수 있다. Swift throwing API로 직접 호출하면 catch로 처리해도 Xcode Swift Error breakpoint가 해당 줄에서 멈출 수 있으므로, 모바일 native code는 Objective-C `updateApplicationContext:error:` selector를 직접 호출해 NSError를 `lastContextErrorDomain`, `lastContextErrorCode`, `lastContextErrorDescription` 상태값으로만 보관한다.
- 활성 iPhone/watch simulator 조합에서는 watch pending 세션의 mobile import, mobile durable inbox 비움, watch `syncStatus: "synced"` acknowledgement까지 확인됐다. 사용자는 Auth 도입 전 실기기에서 약 4분의 foreground pairing, 자동 import, local save와 Watch `synced` 전환도 확인했다. 이는 foreground 기준선이며 post-Auth regression, background/reconnect/large-transfer 증거는 아니다.

Watch sync notification 동작은 다음과 같다.

- `src/notifications/watch-sync-notification-service.ts`는 Notifee permission request, local notification display, notification press data를 다룬다.
- Settings의 watch sync notification opt-in은 현재 OS permission을 먼저 읽는다. 이미 denied이면 시스템 Settings 복구 경로를 제공하고 앱 복귀 시 다시 확인한다.
- Notification은 `WatchConnectivitySyncProvider`가 payload를 local repository에 저장하고 imported acknowledge까지 처리한 뒤 best-effort로 요청한다. Notification 실패는 repository import나 native inbox acknowledgement를 되돌리지 않는다.
- Foreground 사용자는 local notification 대신 사용자가 닫기 전까지 유지되는 in-app toast를 본다.
- Notification 문구는 local repository 저장 결과만 뜻하며 Supabase upload, cloud backup, certified dive computer data verification을 뜻하지 않는다.

Account local-first sync 동작은 다음과 같다.

- Account Logbook/Planbook save는 user-scoped local repository와 durable outbox를 먼저 갱신한다. Coordinator는 outbox operation을 순서대로 remote repository에 적용한다.
- 성공한 remote revision은 local row와 뒤따르는 같은 entity operation에 반영한다. Expected revision이 맞지 않으면 현재 local payload와 remote latest를 conflict record로 보존한다.
- PostgreSQL `timestamptz` readback은 같은 순간을 offset이나 zero-padded fractional second로 반환할 수 있다. Account row mapper는 앱이 표현할 수 있는 millisecond precision을 canonical ISO로 바꾸고, save readback은 timestamp field에만 semantic instant equality를 사용한다. Millisecond 아래 non-zero precision과 다른 persisted field 차이는 fail-closed다.
- PostgreSQL typed floating summary readback은 hashed JSON source와 binary64 표현이 한 ULP 달라질 수 있다. `duration_seconds`, `max_depth_meters`는 exact binary64 neighbor일 때만 save readback을 같은 값으로 취급한다. PostgreSQL `integer`인 `rating`은 exact comparison을 유지한다. Remote parser도 embedded Watch/manual source가 같은 one-ULP 경계를 만족하고 그 값으로 복원한 전체 payload가 stored SHA-256과 정확히 일치할 때만 기존 row를 수용한다. 일반 epsilon, decimal rounding과 새 digest 덮어쓰기는 사용하지 않으며 더 큰 차이와 source/hash mismatch는 계속 fail-closed다.
- Remote pull은 bootstrap뿐 아니라 foreground 복귀와 Logbook/Planbook/Home의 명시적 refresh에서도 수행한다. Local mutation의 immediate `requestSync()`는 push-only를 유지하고, 같은 publication의 겹친 pull은 single-flight로 합친다. 성공한 pull은 `remoteHydration` degraded stage만 해제하며 다른 bootstrap issue를 지우지 않는다.
- Hydration은 Log/Plan collection과 개별 row 실패를 격리해 정상 row를 먼저 local에 반영하고 남은 실패는 degraded로 보고한다. 이전 timestamp false conflict처럼 remote와 local domain content가 동일한 conflict만 remote revision으로 복구하고, 실제 content divergence는 local conflict로 보존한다.
- Profile이 있는 log operation은 operation-owned profile snapshot을 outbox에 보존해 원본 local profile이 바뀌거나 정리되어도 같은 operation을 재시도할 수 있게 한다.
- account partition의 marker 없는 legacy transport-digest row는 outbox 준비 중 full samples의 strict parser·sample count·session ID 검사를 통과할 때만 local account metadata를 원자적으로 sample digest `sha256`과 기존 transport digest `artifactSha256`으로 정규화한다. 이후 upload는 sample digest를 사용한다. `artifactSha256`이 이미 있는 row의 digest 불일치와 구조 검증 실패는 자동 복구하지 않고 fail-closed로 유지한다.
- User 전환과 logout은 account repository, outbox, downloaded profile, claim state와 React Query cache를 user scope로 분리한다. 이전 user generation의 비동기 결과는 새 user state에 commit할 수 없다.

Guest data claim 동작은 다음과 같다.

- Remote 작업 전에 guest logs/plans와 profile full bytes를 immutable snapshot/manifest로 저장한다. Manifest는 user, item kind/local ID, target ID, payload digest, 관계와 profile metadata를 고정한다.
- Snapshot 생성과 strict store parse가 관계, payload, profile bytes/digest/sample count를 원격 batch 생성 전에 검사한다. Profile을 확인할 수 없는 log와 그 converted plan 관계 묶음은 `retainedItems` local sidecar로 분리하고 guest 원본 그대로 둔다. 관계 graph, principal 또는 manifest 자체를 신뢰할 수 없는 오류는 전체 hard failure로 남긴다.
- legacy transport-digest row는 `profile.sha256`은 있으나 `artifactSha256`이 없고, full samples가 strict parser·sample count·session ID 검사를 모두 통과할 때만 복구한다. 이때 immutable snapshot의 clone만 sample digest `sha256`과 기존 transport digest `artifactSha256`으로 정규화하며 guest 원본 metadata와 profile file은 수정하지 않는다. `artifactSha256`이 이미 있는 row의 sample digest 불일치, 파일 누락·malformed·sample count/session 불일치는 실제 무결성 오류로 retained/quarantine 상태를 유지하고 자동 보정하지 않는다.
- Remote manifest, expected count와 upload progress에는 검증을 통과한 항목만 포함한다. 부분 claim 완료 뒤 exact cleanup도 manifest 항목만 삭제하며 retained row와 profile reference는 건드리지 않는다. Retained-only 상태는 remote call 없이 terminal로 저장되고 자동 retry하지 않으며, Settings의 명시적 `다시 검사`만 새 preflight를 수행한다.
- Plan staging 뒤 log staging 순서를 사용하고, 각 record/profile의 remote write와 exact readback이 끝난 뒤에만 completed progress를 증가시킨다. Profile은 parsing 결과뿐 아니라 downloaded raw bytes의 digest와 byte count도 검증한다.
- Edge Function과 privileged database finalizer는 complete batch를 한 transaction에서 account rows로 publish한다. 이미 committed 된 같은 batch는 같은 결과를 반환하지만 같은 owner/local ID의 다른 digest는 덮어쓰지 않는다. 같은 digest라도 새 batch의 `target_record_id`가 기존 account row ID와 다르면 batch를 `committed`로 남기지 않고 transaction 전체를 rollback한다. Finalizer는 committed batch/records와 claim profile objects를 idempotent readback/audit용으로 유지하며 post-commit lifecycle cleanup은 아직 없다.
- Claim committed readback은 relation target UUID를 먼저 확인한 뒤 snapshot relation 값으로 정규화하고 normal account remote parser의 timestamp/schema/digest 검증을 재사용한다. Generic hydration은 exact digest를 우선하고, exact 검증이 실패한 경우에도 지정 relation 하나가 유효한 UUID이고 그 값만 `null`로 되돌린 전체 payload digest가 일치할 때만 legacy fallback을 허용한다. Final account row에는 claim provenance가 남지 않으므로 이 제한보다 더 강한 claim-only 구분은 향후 schema 변경 없이는 할 수 없다.
- Claim된 Watch profile object는 final account row에서도 `user/claims/batchId/remoteId/revision.json` path를 유지한다. Hydration은 기존 `user/logs/remoteId/revision.json`과 함께 owner, UUID batch, remote ID, encoded content revision이 정확한 claim path만 허용하고 download 뒤 byte count, SHA-256, sample count를 다시 검증한다.
- Foreground pull은 이미 synced인 같은 remote revision의 Watch row에서 canonical local profile key와 cached full profile의 session ID, byte count, SHA-256, sample count가 모두 재검증된 경우에만 profile download/write를 생략한다. Cache 누락·손상·identity 불일치·conflict row는 항상 기존 remote download 검증 경로를 사용한다.
- 실제 service 순서는 remote finalize와 committed-batch readback 검증, 이미 commit된 snapshot의 account local 직접 publication/readback, persistent `cleanupPending`, guest reconciliation이다. 이 과정에서 transient local `committed` 상태를 먼저 저장하지 않는다.
- Snapshot과 같은 guest row는 exact delete한다. Snapshot 뒤 변경된 row는 normal account local-first repository와 durable outbox에 `pending` mutation으로 저장·readback한 뒤 guest copy를 삭제한다. 모든 row와 unreferenced local profile cleanup이 끝난 뒤에만 manifest를 `committed`로 저장하며, 실패나 중단은 `cleanupPending`으로 남아 재개된다.
- 사용자는 eligible data를 기기에 유지하도록 defer할 수 있다. Deferred claim은 자동 재개하지 않으며 guest row는 account row와 함께 합성된다. 기본 합성은 같은 local ID에서 account-copy-wins지만 snapshot 뒤 변경된 guest row는 삭제하지 않고 임시 guest 우선순위로 보존한다.
- Settings와 자동 claim sheet의 `기기 데이터` 개수는 현재 guest Logbook/Planbook inventory만 센다. Snapshot의 item, retained, failure total과 lightweight checkpoint hint는 transaction 복구 정보이며 현재 inventory count의 fallback이 아니다. Composed guest save/delete는 inventory revision을 발행해 claim presentation을 다시 계산하고, live count가 `0`이면 Settings import row를 숨긴다. Guest inventory read가 실패해도 이전 nonzero count를 유지하지 않고 현재 generation의 claim presentation을 hidden `0`으로 바꾼다. Refresh는 live inventory를 한 번 bulk read한 뒤 필요한 경우에만 snapshot을 읽으며, live count가 `0`이면 inline full snapshot parse 없이 hidden/priority state를 비운다. Recoverable hint가 있을 때만 authoritative full snapshot 검증 뒤 UI-silent resume하고, hint가 없는 legacy snapshot은 interaction 뒤 publication당 one-shot audit로 backfill한다. Snapshot 부재나 read/backfill 실패로 hint가 unknown이어도 같은 publication에서 audit를 반복하지 않는다. Audit와 zero-recovery token은 generation-scoped라 service generation 교체 시 이전 token을 복사하지 않으며, principal 변경이나 nonzero inventory에는 audit를 취소·reset한다. 겹친 refresh는 sequence와 publication generation을 함께 검사해 가장 최근 결과만 publish한다.
- Remote progress가 없는 `prepared`, `deferred`, `failed` checkpoint에서 snapshot source가 현재 guest inventory에서 삭제됐으면 checkpoint를 제거하고 현재 source로 다시 준비한다. Snapshot 이후 추가되거나 변경된 row는 기존 changed-row promotion/outbox 경로가 보존한다. `remoteBatchId`가 있는 checkpoint와 `running`, `finalizing`, `cleanupPending` 상태는 기존 idempotent recovery를 유지한다.
- Claim 선택/진행 UI는 준비·진행·finalizing·cleanup·항목별 실패, snapshot progress, 재시도, 기기에 유지와 Settings 재개 경로를 제공한다. Native sheet는 열릴 때 live inventory를 다시 읽고 mount refresh가 끝나기 전에는 stale action 대신 닫기 가능한 준비 상태를 표시한다. Home recovery action도 live eligible count가 1개 이상일 때만 나타난다. 준비·진행 중에도 sheet를 닫을 수 있으며, dismissal은 provider가 소유한 claim 작업이나 persistent checkpoint를 취소하지 않는다. Settings는 offline에서도 live guest data action을 표시하지만 remote start는 막는다. Hosted staging automated verifier는 published payload digest와 target ID 재사용 rollback까지 통과했지만 screenshot과 iPhone/Android physical claim 검증은 아직 통과로 기록하지 않는다.

현재 비어 있는 부분은 다음과 같다.

- 실기기 foreground pairing/import/local acknowledgement 기준선은 있지만 build identifier와 signed entitlement inspection, post-Auth regression, disconnect/reconnect, background/force-quit delivery, 장시간 retry와 8,000-sample large transfer는 아직 지원 hardware에서 검증되지 않았다.
- Durable file inbox, activation-gated acknowledgement outbox, revision/digest 기반 재처리 경로가 있고 Logbook import action은 pending native inbox를 수동 drain한다. 자동 import provider는 preferences hydration 뒤 event subscription과 drain을 시작하고 active 복귀 때 다시 drain한다. 실제 연결 끊김 후 재연결과 background/force-quit wake는 지원 hardware에서 확인해야 한다.
- Watch sync notification code boundary와 Settings opt-in은 구현됐지만, background/killed 상태의 실제 OS delivery와 local notification 표시가 physical paired device에서 검증되지는 않았다.
- Account remote schema, local-first outbox/sync와 guest claim service는 구현됐고 hosted staging migration/Edge Function automated verifier를 통과했다. Physical retry/resume와 completion cleanup은 아직 검증되지 않았다.
- Watch payload에는 account principal이나 `userId`를 추가하지 않는다. Watch import는 현재 mobile principal repository에 저장되지만 그 ACK는 account cloud 성공과 계속 독립적이다.
- Generated Swift contract는 현재 watch target에 compile되지 않음.
- Legacy watch sessions는 record adapter 또는 mobile runtime compatibility path를 통해 새 mode-aware payload로 동기화될 수 있다. 기존 freedive log는 하나의 segment로 보존되고, 기존 scuba log의 safety stop 상태는 unknown 또는 not required로 취급한다.

## 관련 문서

- [모바일 구조](mobile.md)
- [Watch 앱 구조](watch-app.md)
- [Supabase 구조](supabase.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [1Hz 프로파일 파일 저장과 동기화](profile-file-sync.md)
