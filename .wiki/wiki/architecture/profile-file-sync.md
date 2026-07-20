# 1Hz 프로파일 파일 저장과 동기화

Sources: Diving App accepted design and implementation, 2026-07-12; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Guest data account claim implementation evidence, 2026-07-20
Raw: [1Hz 프로파일 파일 저장과 WatchConnectivity 신뢰성 결정](../../raw/architecture/2026-07-12-one-hertz-profile-file-sync.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md)
Updated: 2026-07-20

## 요약

Watch 기록은 원시 센서 콜백과 영구 프로파일의 cadence를 분리한다. 실시간 화면과 freedive/scuba 상태 엔진은 모든 유효한 실제 콜백을 사용하고, 저장·전송·모바일 장기 보관용 프로파일은 초당 최대 한 개의 실제 관측값으로 제한한다. 전체 세션은 크기와 관계없이 immutable JSON 파일 하나로 전달하며 chunk protocol은 사용하지 않는다.

## Watch 기록과 파일 구조

`OneHertzProfileSampler`는 세션 시작 시각을 기준으로 1초 bucket을 계산한다.

- 각 non-empty bucket의 마지막 실제 sample을 대표값으로 쓴다.
- 같은 bucket의 `bucketMinDepthMeters`, `bucketMaxDepthMeters`를 보존한다.
- 같은 bucket에서 마지막으로 측정된 실제 수온을 보존한다. 수온이 없으면 `nil`이고 `0°C`를 만들지 않는다.
- 빈 초를 합성하지 않는다.
- out-of-order, 세션 시작 전, non-finite sample은 버린다.
- stop 시 마지막 열린 bucket을 한 번만 flush한다.

따라서 3시간 동안 센서 callback이 계속 들어와도 프로파일은 최대 10,800 sample이다. 이 cadence는 기록·사후 리뷰용이며 다이빙 안전 계산 주기가 아니다.

Watch Application Support의 논리 구조는 다음과 같다.

```text
DivenaryWatchApp/
  session-manifest.json
  Sessions/<localSessionId>/
    active-recording.json
    recording.ndjson
    session-<contentRevision>.json
```

활성 기록 journal은 finalized 1Hz sample을 줄 단위로 append하고 동기화한다. 완료 artifact는 contract의 한 `WatchSyncMessage` 전체를 담는다. Manifest는 bounded preview, 표시용 metadata, sync status, artifact relative path, SHA-256, byte count, sample count를 보관한다. sync status 변경은 큰 artifact를 다시 쓰지 않는다.

## 전송 identity와 재시도

Session body는 항상 `WCSession.transferFile`을 사용한다. `sendMessage`와 `transferUserInfo`는 session body에 사용하지 않지만 planned dive와 acknowledgement control message에는 계속 사용할 수 있다.

Artifact identity는 다음 값의 조합이다.

- `localSessionId`
- `contentRevision`
- `sha256`
- `byteCount`
- `sampleCount`

Watch는 같은 revision/digest의 `outstandingFileTransfers`가 있으면 중복 enqueue하지 않는다. `didFinish fileTransfer` 성공은 iPhone repository import 성공을 뜻하지 않으므로 `pending`을 유지한다. ACK의 session, revision, digest가 현재 manifest와 모두 일치할 때만 `synced`로 바뀐다. Canonical artifact는 WatchConnectivity transfer callback에서 삭제하지 않는다.

## iPhone durable inbox와 ACK outbox

iPhone native delegate는 `WCSessionFile.fileURL`이 callback 뒤 사라질 수 있다는 전제에서 callback 안에 다음 순서를 수행한다.

1. 파일 bytes를 읽고 metadata의 byte count와 SHA-256을 검증한다.
2. JSON 구조가 읽히는지 확인한다.
3. Application Support의 `Divenary/WatchConnectivityInbox/<payloadId>.json`으로 atomic write한다.
4. UserDefaults pending index에는 path와 identity만 저장한다.
5. JS에는 drain 시 한 payload만 문자열로 materialize한다.

JS validator와 mobile repository 저장이 모두 성공하면 native layer는 ACK를 persistent outbox에 먼저 추가한다. 그 다음 inbound index와 file을 삭제한다. WCSession activation 전에는 ACK를 보내지 않고, activation 뒤 `transferUserInfo`에 제출한다. ACK는 enqueue 시점이 아니라 `didFinish userInfoTransfer` 성공 callback에서만 outbox에서 제거한다. activation 실패 시 상태를 다시 비활성으로 돌려 다음 activation에서 재시도한다. 이 순서가 cold start에서 “모바일에는 저장됐지만 Watch는 계속 pending”인 상태를 막는다.

## 모바일 metadata와 profile 분리

`PersistentDiveLogRepository`는 전체 profile sample을 session/revision별 immutable 항목으로 한 번 저장한다. iOS 실앱에서는 native `WatchProfileStorageModule`이 Application Support의 `Divenary/WatchProfiles`에 JSON 파일로 저장하고, 테스트와 비-iOS fallback만 key-value adapter를 사용한다. `DiveLogEntry`에는 summary, manual/mobile fields, profile reference, digest, sample count와 최대 160개 preview만 남긴다. Preview는 구간별 가장 깊은 sample을 택해 peak를 보존한다. Log detail은 `getWatchProfile(localId)`로 전체 profile을 지연 로드한다. revision 교체와 로그 삭제 시 더 이상 참조하지 않는 local profile file도 같이 삭제한다.

Remote account profile 경계도 코드와 migration에 구현됐다. Private `dive-profiles` bucket은 owner path만 허용하며 normal account object는 `<user_id>/logs/<dive_log_id>/<content_revision>.json`, claim object는 `<user_id>/claims/<batch_id>/<target_record_id>/<content_revision>.json`을 사용한다. List row에는 최대 160개 preview만 두고 full bytes는 detail 또는 claim 검증 때 읽는다. Account-data migration과 claim Edge Function이 hosted staging에 배포됐다는 증거는 아직 없다.

Claim finalizer는 exact profile bytes를 검증한 뒤 account log row가 claim object path를 참조하게 하며, remote commit 뒤 claim object를 account path로 옮기거나 삭제하지 않는다. Committed claim batch/record와 profile object는 현재 idempotent readback/audit 근거로 남는다. Auth user deletion 시 database claim row는 cascade되지만 remote Storage profile object는 자동 삭제되지 않는다. Account deletion과 privileged object cleanup이 아직 구현되지 않아 object는 계속 보존되며, 이 cleanup은 future release gate다. 이는 exact-match guest cleanup 중 unreferenced local profile을 제거하는 mobile 동작과 다른 경계다.

## 알림 생명주기와 한계

Preferences에는 `isHydrated`가 있고 Watch inbox subscription/drain은 hydration 뒤 시작한다. 앱이 active로 돌아오면 pending inbox를 다시 drain한다. Foreground에서는 toast만 보이고 background에서는 사용자가 opt-in하고 OS 권한이 있을 때 Notifee local notification을 표시한다. Notifee background event handler는 app registry 등록 전에 설정한다.

iOS에서 사용자가 알림을 이미 거부했다면 `requestPermission()`은 새 prompt를 띄우지 않는다. Settings의 토글은 현재 권한을 먼저 읽고, denied 상태이면 시스템 Settings를 열 수 있는 안내를 표시한다. 사용자가 돌아오면 권한을 다시 읽고 허용된 경우에만 preference를 켠다.

이 구조는 iPhone 프로세스가 WatchConnectivity delivery로 실행되거나 다음 launch에서 inbox를 drain할 때의 local notification을 다룬다. 별도 remote push provider가 없으므로 사용자가 앱을 force-quit한 모든 경우에 즉시 remote push가 온다고 보장하지 않는다. Simulator는 `transferFile`의 실기기 전달 보증 수단이 아니며 paired hardware 검증이 필요하다.

## 장애 복구와 검증

- legacy monolithic Watch file은 모든 migrated artifact가 검증된 뒤 삭제한다.
- 앱이 기록 중 종료되면 다음 launch에서 NDJSON journal을 복원해 `interrupted` profile artifact로 finalize하고 review 가능한 세션으로 남긴다.
- corrupted/truncated inbound file은 repository에 전달하거나 ACK하지 않는다.
- repository/profile 저장 실패는 inbound item을 남겨 다음 drain에서 재시도한다.
- duplicate identity는 native inbox와 Watch outstanding transfer에서 합친다.
- 자동 검증은 3시간 상한, sparse/invalid/temperature sample, large artifact digest, migration, file-only route, mobile import/dedupe와 permission lifecycle을 포함한다.
- paired iPhone/Watch의 foreground, background, force-quit, offline/reconnect, 8,000 sample 전달은 별도 실기기 gate다.

## 안전 경계

이 profile은 다이빙 기록과 사후 리뷰용이다. 감압 의무, 조직 loading, gas switch 안전, 비상 상승 판단을 계산하지 않으며 인증된 dive computer를 대체하지 않는다.

## 관련 문서

- [동기화 흐름 구조](sync-flow.md)
- [Watch 앱 구조](watch-app.md)
- [모바일 구조](mobile.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [열린 질문](../questions/open-questions.md)
