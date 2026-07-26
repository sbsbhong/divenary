# Account Sync and Claim Recovery Design

## Context

로그아웃 상태에서 만든 로그를 로그인 뒤 가져오면 원격 commit은 완료되지만 화면은
`1 / 1` 실패로 남고, 로그인된 두 기기는 서로 만든 cloud 로그를 가져오지 못한다.
guest Logbook/Planbook이 비어 있어도 Home 상단의 account-data recovery Alert가
계속 남는다.

실제 simulator checkpoint와 hosted staging을 읽기 전용으로 확인한 결과 서버
finalizer나 RLS보다 client serialization/recovery 경계의 문제다.

- 실패 checkpoint는 `completed=1/1`, `errorCode=remote_conflict`,
  `failure.phase=finalizing`이다. Upload가 아니라 committed row readback 검증이
  실패했다.
- 앱은 payload timestamp를 `Date#toISOString()`의 `.000Z` 형태로 hash하지만
  PostgreSQL/PostgREST는 같은 순간을 `+00:00` 또는 더 긴 소수 초로 돌려줄 수 있다.
  Claim readback과 normal account save 결과가 이 문자열을 exact 비교한다.
- Claim된 Watch profile은 `user/claims/batch/target/revision.json`에 남지만 generic
  account hydration은 `user/logs/remote/revision.json`만 허용한다.
- Claim snapshot의 relation digest는 target UUID를 알기 전의 `null` 값을 포함한다.
  Finalizer는 실제 `source_plan_id`/`converted_log_id`를 저장하지만 generic hydration은
  claim 전용 null-normalization 규칙을 모른다.
- Remote pull은 account bootstrap에서만 실행된다. Foreground와 화면 refresh는
  outbox push 또는 local query refetch만 수행한다.
- Hydration이 한 번 실패하면 bootstrap `remoteHydration/degraded`를 성공 경로에서
  다시 `ready`로 복구하지 않는다.

## Product Decisions

- UI layout, copy, sheet presentation, badge policy는 바꾸지 않는다.
- PostgreSQL timestamp 표현 차이는 같은 순간이면 같은 persisted value로 취급한다.
- Package mapper는 DB timestamp를 canonical ISO 문자열로 반환한다.
- Remote payload digest는 exact match를 우선한다. Exact match가 실패하고 relation
  UUID가 존재할 때만 claim legacy 규칙에 따라 해당 relation을 `null`로 되돌린
  digest를 한 번 더 검증한다.
- Watch profile path는 owner, record ID, content revision을 모두 검증한 두 canonical
  형식만 허용한다.
  - `user/logs/remoteId/revision.json`
  - `user/claims/batchId/remoteId/revision.json`
- 이미 synced인 Watch log는 canonical local profile key와 remote identity/revision이
  정확히 같고, 저장된 full profile을 session ID, byte count, SHA-256, sample count로
  다시 검증한 경우에만 download/write를 생략한다. Cache가 없거나 손상됐으면 기존
  remote download 검증 경로로 복구한다.
- Foreign owner, 다른 remote ID, invalid batch ID, 다른 revision, path traversal은
  계속 거부한다.
- Foreground 복귀와 Logbook/Planbook/Home의 명시적 refresh는 cloud pull을 포함한다.
- Local save 직후의 `requestSync()`는 성능을 위해 push-only로 유지한다.
- 동시 cloud pull은 publication/coordinator별 single-flight로 합친다.
- 성공한 cloud pull은 `remoteHydration` degraded 상태만 `ready`로 복구한다.
  Migration, claim inspection, outbox reconciliation 오류를 잘못 지우지 않는다.
- 성공한 claim inspection은 `claimInspection` degraded 상태만 복구한다.
- 기존 false conflict는 remote와 local domain content가 동일한 경우에만 synced로
  자동 복구하고 conflict checkpoint를 제거한다. 실제 content divergence는 그대로
  conflict로 보존한다.
- Malformed remote row는 저장하지 않는다. 가능한 정상 row/type은 먼저 적용하고,
  남은 실패는 degraded 상태로 계속 알린다.
- Supabase schema, migration, Edge Function, RLS는 이번 수정에서 변경하지 않는다.

## Timestamp Boundary

1. Account payload 생성 시 timestamp는 canonical ISO로 hash한다.
2. `fromDiveLogRow`와 `fromDivePlanRow`는 non-null timestamp를 같은 canonical ISO로
   변환한다.
3. Repository save readback은 timestamp field에 한해 strict grammar와 epoch가 모두
   유효하고 같은 순간이면 persisted field가 일치한 것으로 본다.
4. Claim committed readback은 relation을 검증하고 claim snapshot 값으로 되돌린 뒤
   normal remote parser를 통과시켜 schema, timestamp, digest를 함께 검증한다.
5. 다른 문자열 field와 JSON field는 기존 exact comparison을 유지한다.

## Claimed Data Compatibility

### Relationship digest

Claim finalization 전에는 relation target UUID가 없으므로 payload digest의
`source_plan_id`/`converted_log_id`는 `null`이다. Finalized row의 실제 relation UUID는
foreign key가 보장하고, parser는 다음 순서로 검증한다.

1. 실제 relation UUID를 포함한 canonical payload digest를 검사한다.
2. 실패한 경우에만 relation 하나를 `null`로 되돌린 legacy claim digest를 검사한다.
3. 둘 다 실패하면 malformed remote payload로 거부한다.

### Profile path

Hydration은 payload profile descriptor를 먼저 검증한 뒤 path 전체를 예상 문자열과
비교한다. `/claims/` path는 UUID batch segment를 요구하며 owner와 remote record
segment가 현재 row와 정확히 같아야 한다. Download 후 byte count, SHA-256, sample
count 검증은 기존대로 유지한다. 이미 같은 remote revision을 local synced row가
가진 경우에도 canonical local key의 cached full profile 자체를 같은 기준으로
재검증한 뒤에만 remote download를 생략한다.

## Bidirectional Sync Flow

### Bootstrap

1. Principal local repositories와 outbox를 publish한다.
2. Pending operation을 reconcile한다.
3. Online이면 cloud hydration을 single-flight로 수행한다.
4. Hydration 결과를 local query cache에 반영한다.
5. Outbox를 drain한다.
6. 성공하면 stale `remoteHydration` degraded state를 정리한다.

### Foreground and explicit refresh

1. Outbox drain을 먼저 요청해 local pending writes를 server에 전달한다.
2. 같은 publication에서 진행 중인 cloud pull이 있으면 그 Promise를 공유한다.
3. Remote Log/Plan을 hydrate한다.
4. 변경이 있으면 scoped Logbook/Planbook queries를 invalidate한다.
5. 성공하면 `remoteHydration` Alert를 해제한다.
6. 실패하면 local data와 tab interaction은 유지하고 retryable degraded state를
   표시한다.

## Existing Conflict Recovery

Timestamp false conflict는 DB row가 이미 revision 1로 생성됐지만 local row는
`remoteRevision` 없이 `conflict`로 남긴다. Hydration에서 다음 조건을 모두 만족할
때만 복구한다.

- 같은 owner, entity kind, local ID, remote ID다.
- 해당 entity에 pending outbox operation이 없다.
- Remote payload를 local domain model로 변환한 값과 current conflict row가 sync
  metadata 및 local profile storage key를 제외하고 동일하다.
- Profile이 있으면 기존 byte/digest/sample 검증을 통과했다.

조건이 맞으면 remote identity/revision을 가진 synced row를 저장하고 해당 entity의
stale conflict metadata를 제거한다. 내용이 다르면 local conflict를 authoritative로
유지한다.

## Error Isolation

- Log page collection 실패가 Plan page publication을 취소하지 않고, 반대도 동일하다.
- Row parse/profile failure는 해당 row만 거부하고 다른 정상 row 처리를 계속한다.
- Stale principal/online generation error는 즉시 중단하며 다른 failure로 포장하지
  않는다.
- 일부 정상 row를 적용한 뒤 failure가 남으면 query를 invalidate하고 bootstrap은
  degraded로 유지한다.
- Error details는 개발 log에만 남고 UI에는 기존 generic recovery copy를 사용한다.

## Verification

- Supabase mapper/repository: `Z`, offset, microsecond timestamp roundtrip과 실제 mismatch.
- Guest claim: manual log와 plan의 offset readback이 complete/cleanup까지 진행.
- Remote parser: claimed relation UUID fallback, tampered digest rejection.
- Coordinator: `/claims/` profile hydration, invalid path rejection, normal row isolation,
  equivalent historical conflict recovery, unchanged profile cache reuse와
  missing/corrupt cache fallback.
- Account state: initial failure 뒤 foreground/refresh 성공 시 remote rows publication 및
  Alert recovery, concurrent pull coalescing, push-only local save 유지.
- Hooks: Logbook/Planbook refresh가 cloud pull 뒤 local query를 refetch.
- Focused Jest, package tests, mobile typecheck, full mobile Jest, iOS simulator build,
  `yarn codex:check`.
