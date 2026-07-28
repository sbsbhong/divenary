# Local Log Import Performance and Reliability Design

## Context

로그인 뒤 `기기 데이터 가져오기`에서 실제로 새로 보이는 로그는 1개인데 진행 화면이
`15 / 15`를 표시하고 실패하는 경우가 있다. 같은 상태에서 앱 부팅 직후 탭 전환과
버튼 입력이 늦어지며, 샘플이 많은 Watch 로그를 수동으로 가져올 때는 앱이 거의
멈춘 것처럼 보인다.

코드와 시뮬레이터 저장소를 함께 확인한 결과 다음 원인이 겹친다.

- `15`는 현재 eligible row 수가 아니라 이전 guest claim의 immutable snapshot item
  수다. `cleanupPending`에 속한 exact guest row는 목록에서 숨겨질 수 있으므로,
  화면에 보이는 1개와 transaction total 15개가 동시에 존재할 수 있다.
- Claim cleanup은 item마다 `get → profile exact comparison → deleteIf → get`을
  반복하고, persistent repository는 각 단계에서 같은 JSON envelope를 다시
  parse/clone/write한다.
- Claim snapshot은 full profile JSON bytes를 AsyncStorage JSON 안에 복제한다.
  Snapshot read와 write는 큰 문자열 전체를 JSON parse/stringify하고 profile digest를
  다시 검증한다.
- Watch inbox는 full artifact JSON을 native bridge로 올리고 JS에서 parse, sample
  validation, stringify, SHA-256, profile write를 한 payload 안에서 수행한다. Runtime
  yield는 payload 사이에만 있어 하나의 큰 payload가 JS interaction을 오래 막는다.
- Native inbox는 첫 pending payload 하나만 drain한다. 그 항목이 transient failure로
  남으면 뒤의 정상 payload가 head-of-line blocking을 겪는다.
- Cleanup error는 원인을 버린 채 `cleanupPending`으로 남아 foreground마다 자동
  재시도될 수 있다.

Watch import acknowledgement는 계속 “iPhone local repository commit 완료”만
뜻한다. Account cloud publication이나 guest cleanup 완료와 합치지 않는다.

## Goals

- 15개 claim cleanup이 guest Logbook/Planbook metadata를 entity별 한 번만 읽고
  entity별 최대 한 번만 다시 쓰게 한다.
- 큰 claim profile bytes를 AsyncStorage snapshot JSON에서 분리해 file-backed
  sidecar로 보존한다.
- Claim upload, finalizing, cleanup을 서로 다른 진행 의미로 표시해 cleanup을
  `15 / 15 가져오기`처럼 보이지 않게 한다.
- Cleanup failure를 durable하게 기록하고 사용자가 명시적으로 재시도할 수 있게
  하며, 같은 terminal local failure를 foreground마다 무한 재시도하지 않는다.
- iOS Watch artifact의 full sample parse, validation, digest, preview 생성과 profile
  file 준비를 utility queue에서 수행하고 JS에는 bounded metadata/preview만 전달한다.
- 하나의 failed pending Watch payload가 뒤의 정상 payload import를 막지 않게 한다.
- 기존 schema 1 claim snapshot, legacy inline Watch payload, Android/non-native
  fallback을 계속 읽고 처리한다.
- Supabase schema, RLS, Edge Function, Watch JSON contract와 Watch local history 보존
  의미를 변경하지 않는다.

## Non-Goals

- Logbook/Planbook 전체 저장소를 SQLite domain schema로 교체하지 않는다.
- Watch에서 synced session을 자동 삭제하지 않는다.
- Supabase migration이나 production promotion을 수행하지 않는다.
- Remote claim batch의 atomic publication 의미를 약화하거나 item upload 직후 guest
  source를 삭제하지 않는다.
- 감압, 상승 허가, 비상 판단과 같은 안전-critical 기능을 추가하지 않는다.

## Approaches Considered

### A. Minimal patch

현재 claim service에 bulk delete만 추가하고 cleanup UI count를 숨긴다. 변경량과
native risk는 가장 작지만, full profile snapshot과 단일 대형 Watch payload의 JS
blocking이 남아 같은 계열의 성능 문제가 재발한다.

### B. Bounded native preparation and file-backed claim sidecars

Claim metadata cleanup을 bulk transaction으로 바꾸고, claim profile은 file-backed
sidecar에 저장한다. iOS Watch inbox도 native utility queue에서 full artifact를
검증·분리하고 JS에는 preview와 opaque prepared-profile token만 전달한다. 기존
repository와 remote contract는 유지하면서 큰 bytes가 JS/AsyncStorage hot path를
통과하지 않게 한다.

이 접근을 채택한다. 현재 문제의 두 병목을 직접 제거하면서 Supabase와 Watch contract
변경을 피할 수 있다.

### C. Full local database redesign

Logbook, Planbook, profile index, inbox와 claim checkpoint를 SQLite relational
schema와 background worker로 통합한다. 장기적으로 확장성은 가장 좋지만 migration,
query layer, rollback과 physical-device 검증 범위가 이번 버그 수정의 독립적인
epic이 된다.

## Architecture

### 1. Raw profile file boundary

`WatchProfileStorage`에 raw JSON file 연산을 추가한다.

- `writeRaw(key, payloadJson)`
- `readRaw(key)`
- `copyRaw(sourceKey, destinationKey)`
- 기존 `write/read/remove`

iOS는 `WatchProfileStorageModule`의 utility queue와
`Library/Application Support/Divenary/WatchProfiles` 아래 파일을 사용한다. JS에는
arbitrary path를 노출하지 않고 storage key만 전달한다. Fallback storage는 기존
`PersistentKeyValueStore` string을 사용한다.

Claim snapshot item의 profile은 inline `profileBytes` 대신
`profileSidecarStorageKey`를 가질 수 있다. 새 snapshot은 sidecar를 먼저 write/readback
검증한 뒤 checkpoint를 persist한다. 기존 schema 1의 inline `profileBytes`는 읽을 수
있고, 다음 write에서 sidecar로 승격한다.

Active claim이 profile을 upload하거나 account partition으로 publish할 때 sidecar raw
bytes를 읽는다. Account profile publication은 가능한 경우 raw file copy를 사용하고,
모든 byte count, SHA-256, sample count 검증은 유지한다.

### 2. Claim snapshot lifecycle and compaction

Snapshot storage schema 2는 세 상태의 evidence 크기를 구분한다.

1. `prepared/running/finalizing/failed`: remote retry에 필요한 payload/local source
   metadata와 profile sidecar reference를 보존한다.
2. `cleanupPending`: remote와 account local publication이 검증됐으므로 remote payload
   bytes와 profile upload readback bytes를 제거하고 source digest, label, profile
   identity만 남긴다.
3. `committed`: cleanup source bytes도 제거하고 imported count, retained items,
   historical Watch artifact identities만 남긴 compact receipt로 저장한다.

Schema 1 snapshot은 authoritative하게 검증한 뒤 현재 상태에 맞는 schema 2 표현으로
migrate한다. Migration이 실패하면 원본 key를 덮어쓰지 않는다.

Compact committed receipt의 Watch artifact identity는
`localSessionId + contentRevision + artifactSha256`다. 따라서 Watch retransmission을
중복 import하지 않으면서 full local record/profile bytes는 보존하지 않아도 된다.

### 3. Bulk guest cleanup

Persistent Logbook/Planbook repository에 optional bulk conditional delete API를
추가한다. Request는 `localId`와 expected canonical source digest/bytes를 가지며,
결과는 각 ID의 `deleted`, `notFound`, `conditionFailed`를 반환한다.

Cleanup flow:

1. Guest Logbook/Planbook inventory를 각각 한 번 병렬로 읽는다.
2. Snapshot source와 현재 row를 memory map에서 비교한다.
3. 변경된 row는 기존 account local-first/outbox promotion을 수행하고 delete batch에서
   제외한다.
4. Exact plan/log request를 entity별 한 번의 repository mutation으로 삭제한다.
5. Persistent repository는 mutation 안에서 envelope를 한 번 읽고, 모든 조건을 다시
   확인하고, metadata를 한 번 write한다.
6. Log profile key는 metadata commit 뒤 serialized
   `removeWatchProfileIfUnreferenced`로 정리한다. Profile bytes를 두 번째로 비교하지
   않는다.
7. 모든 metadata/profile cleanup이 끝난 뒤 compact committed receipt를 persist한다.

Bulk API가 없는 custom repository는 기존 item별 fallback을 사용해 호환성을 유지한다.

### 4. Claim progress and cleanup errors

UI state는 phase별 의미를 분리한다.

- `uploading`: `completed / total`
- `finalizing`: `total / total`과 “계정 데이터 확인 중”
- `cleanup`: numeric import count를 숨기고 “기기 원본 정리 중”과 spinner를 표시
- cleanup failure: `failure.phase = cleanup`과 sanitized error code를 durable하게
  저장하고 failure 화면에서 명시적 retry 제공

`cleanupPending`에 cleanup failure가 있으면 automatic foreground resume 대상에서
제외한다. 사용자의 retry는 error/failure를 지우고 idempotent bulk cleanup을 다시
시작한다. Process termination처럼 failure가 기록되지 않은 `cleanupPending`만 한 번
자동 resume한다.

새 eligible row가 active cleanup snapshot 밖에 있으면 기존 cleanup을 먼저 끝내고,
그 뒤 live inventory refresh에서 별도의 1-item choice를 보여준다.

### 5. Native Watch payload preparation

`WatchConnectivityInbox`는 pending artifact descriptor를 최대 8개까지 반환한다.
Descriptor는 payload ID와 작은 identity metadata만 포함하며 full `payloadJson`을
event body나 drain result에 넣지 않는다.

JS가 descriptor를 선택하면 `preparePendingPayload(payloadId)`를 호출한다. Native
utility queue는 다음을 수행한다.

1. Inbox file을 읽고 artifact byte count와 SHA-256을 다시 확인한다.
2. JSON object와 session/sample shape를 검증한다.
3. 모든 sample의 allowed keys, finite numeric value, `localSessionId`를 검증한다.
4. Full sample array를 raw profile file로 atomic write한다.
5. Full sample raw bytes의 SHA-256, byte count, sample count를 계산한다.
6. peak-preserving 최대 160-sample preview를 만든다.
7. 원본 message에서 `session.samples`만 preview로 바꾼 bounded JSON을 반환한다.

JS는 bounded JSON을 기존 strict validator로 다시 검증한다. Repository import에는
`PreparedWatchProfile`을 전달한다.

```ts
type PreparedWatchProfile = {
  payloadId: string;
  sampleCount: number;
  byteCount: number;
  sha256: string;
};
```

Persistent repository는 native inbox가 준비한 profile을 final principal-scoped storage
key로 atomic copy/adopt하고 metadata preview만 저장한다. Profile adoption 또는 metadata
commit이 실패하면 ACK하지 않으며 기존 rollback 경계를 유지한다. Legacy inline
`payloadJson`, Android와 native method가 없는 환경은 기존 JS import path를 사용한다.

### 6. Failed payload isolation

Native drain은 arrival order를 유지한 bounded descriptor batch를 반환한다. JS automatic
drain과 manual drain은 payload별로 error를 격리한다.

- Contract-invalid 또는 native validation-invalid artifact는 drop acknowledgement 후
  다음 payload를 처리한다.
- Transient file/repository/account enqueue failure는 ACK하지 않고 inbox에 남기되,
  같은 drain cycle에서 뒤 descriptor를 계속 처리한다.
- 한 cycle에서 이미 본 payload ID는 다시 실행하지 않는다.
- Manual import summary는 received/imported/failed count를 반환하고, 하나 이상 실패한
  경우에도 성공한 뒤 payload를 잃지 않는다.
- 다음 foreground/manual retry에서 실패 payload를 다시 시도한다.

ACK는 local repository metadata와 full profile file commit이 모두 끝난 뒤에만 보낸다.

## Concurrency and Data Integrity

- Guest bulk cleanup은 기존 repository mutation queue와 legacy migration lock 안에서
  실행한다.
- Bulk predicate는 cleanup 전에 읽은 memory row가 아니라 mutation 시점의 current
  row에 다시 적용한다. Snapshot 뒤 편집된 row는 삭제하지 않는다.
- Prepared Watch profile token은 payload ID에 묶고 native inbox 내부에서만 path로
  resolve한다. JS가 임의 파일을 adopt할 수 없다.
- 동일 payload의 automatic event/manual drain은 기존 coordinator single-flight를
  공유한다.
- Principal generation guard가 stale import의 metadata commit과 ACK를 막는다.
- Claim sidecar와 prepared inbox profile의 orphan file은 authoritative metadata가
  참조하지 않을 때만 best-effort로 제거한다.

## Error Handling

- Claim sidecar missing/corrupt는 기존 `profile_missing`/`profile_corrupt`로 표시하고
  guest source를 보존한다.
- Bulk condition failure는 `claim_validation_failed`, item label과 cleanup phase를
  기록한다.
- Native payload validation failure와 file I/O failure를 별도 error code로 구분한다.
  Validation failure만 drop acknowledge한다.
- Cleanup error의 raw filesystem/server message는 UI에 노출하지 않고 DEBUG log에
  sanitized stage와 item identity만 기록한다.
- 세 번 연속 같은 physical validation gate가 같은 이유로 실패하면 더 수정하지 않고
  수동 조치와 증거를 보고한다.

## Compatibility and Migration

- Guest claim snapshot schema 1 read를 유지한다.
- Inline `profileBytes` snapshot은 원격 진행 상태를 보존한 채 sidecar schema 2로
  변환한다.
- Legacy `payloadJson` Watch event/drain result는 current JS path로 import한다.
- Existing pending native inbox record에 prepared profile 정보가 없어도 최초 prepare에서
  backfill한다.
- Existing account/guest Logbook schema version과 Supabase payload digest는 변경하지
  않는다.
- Watch app sender와 JSON Schema/generated contract는 변경하지 않는다.

## Verification

### Claim

- 15-item cleanup이 Logbook/Planbook을 entity별 한 번 읽고 한 번 write한다.
- Snapshot 뒤 변경된 row는 promotion되고 exact rows만 bulk delete된다.
- Bulk condition failure는 guest source를 보존하고 cleanup failure detail을 persist한다.
- Cleanup failure는 foreground마다 자동 재시도되지 않고 explicit retry로 복구된다.
- Schema 1 inline snapshot이 schema 2 sidecar/compact receipt로 복구된다.
- Committed receipt는 historical Watch artifact dedupe를 유지하고 full profile/payload
  bytes를 포함하지 않는다.
- Cleanup UI는 `15 / 15`를 import 진행률로 표시하지 않는다.

### Watch import

- 8,000-sample artifact의 event/drain result에 full payload JSON이 포함되지 않는다.
- Native preparation은 invalid sample, digest mismatch와 path/token mismatch를 거부한다.
- Prepared import는 JS profile stringify/hash를 호출하지 않고 full profile과 bounded
  preview를 저장한다.
- First payload transient failure 뒤 second valid payload가 같은 cycle에서 import/ACK된다.
- Invalid payload는 drop ACK되고 뒤 payload는 계속 처리된다.
- Legacy inline payload와 duplicate/historical ACK semantics가 유지된다.

### Gates

- Focused Jest red/green tests
- Native source boundary tests
- `yarn mobile:typecheck`
- Full mobile Jest
- `yarn ios:build`
- `yarn watch:build`
- `yarn codex:check`
- Physical iPhone: cold launch 3회, 8,000-sample import 중 tab input, failed-first/valid-second
  inbox, 15-item cleanup과 새 1-item claim

## Durable Documentation

구현 완료 뒤 `.wiki/raw/architecture/`에 구현 증거를 추가하고
`.wiki/wiki/architecture/sync-flow.md`, index와 log를 갱신한다. Watch local ACK,
guest account claim, account cloud sync의 세 경계를 계속 구분한다.
