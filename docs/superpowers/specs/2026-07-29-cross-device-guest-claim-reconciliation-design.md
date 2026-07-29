# Cross-device Guest Claim Reconciliation Design

## 문제

동일 계정의 다른 기기가 먼저 같은 guest row를 claim하면 `(user_id, local_id)`가 같은 account row가 이미 존재할 수 있다. 각 claim batch는 독립적으로 `target_record_id`를 생성하므로 두 batch의 target ID는 다르다.

현재 staging finalizer는 payload와 profile이 동일한 기존 row도 target ID가 다르면 `23505`로 rollback한다. 모바일은 이미 stage/profile 검증을 끝낸 checkpoint를 보존하므로 retry 때 과거 전체 항목을 `15/15`로 다시 표시한 뒤 같은 finalization 충돌을 반복한다. 이 상태에서는 충돌하지 않는 나머지 항목도 account에 publish되지 않는다.

실기기 증거:

- live guest log: 1
- 보존된 claim snapshot: log 15
- staged/profile readback 완료: 15
- account local row와 claim의 `localId` 중복: 1
- 중복 row의 account remote ID와 claim target ID: 서로 다름

## 목표

- 같은 사용자, 같은 `localId`, 같은 payload/profile인 cross-device claim을 중복 생성 없이 idempotent success로 처리한다.
- payload, profile 또는 plan/log 관계가 다르면 기존처럼 batch 전체를 fail closed로 rollback한다.
- 이미 upload가 끝난 checkpoint retry는 항목 업로드 진행률 `15/15`가 아니라 remote/account 확인 단계로 표시한다.
- 기존 checkpoint의 나머지 immutable snapshot을 버리지 않는다.

## 비목표

- 서로 다른 payload의 자동 병합
- claim batch 삭제 또는 remote profile lifecycle 변경
- guest inventory와 과거 transaction evidence를 하나의 숫자로 합치기
- production Supabase 승격

## 검토한 접근

### 1. 검증 뒤 canonical target ID로 재조정 — 선택

기존 private finalizer가 payload digest, profile revision/digest/count, plan/log 관계를 모두 검증하고 publish한 뒤, public wrapper가 각 staged record의 `target_record_id`를 실제 account row ID로 정규화한다. transaction 안에서 수행되므로 검증 실패 시 publish와 재조정이 함께 rollback된다.

모바일 committed readback은 서버가 반환한 canonical ID를 snapshot item에 반영한 다음 account local copy를 쓴다. 이후 retry도 remapped staging row와 final row를 동일하게 읽는다.

장점:

- 기존 15개 immutable snapshot을 보존한다.
- 이미 다른 기기에서 들어간 동일 row는 중복 없이 재사용한다.
- 현재 finalizer의 fail-closed payload/profile 검증을 유지한다.
- 기존 문제 batch를 migration 배포 뒤 그대로 복구할 수 있다.

### 2. 낡은 checkpoint 폐기 후 live guest 1건으로 새 batch 생성 — 제외

UI 숫자는 즉시 1이 되지만 remote progress가 있는 snapshot 14건의 유일한 복구 증거를 버릴 수 있다. 데이터 보존 원칙을 위반한다.

### 3. client에서 충돌 row만 제외하고 batch 분할 — 제외

현재 server batch와 manifest는 원자적이며 항목 삭제/취소 API가 없다. 새 cancellation protocol과 profile cleanup까지 필요하고 기존 batch 복구도 해결하지 못한다.

## 서버 설계

새 migration은 `public.finalize_guest_claim(uuid, uuid, jsonb)` wrapper를 교체한다.

1. `private.finalize_guest_claim`을 호출한다.
2. private finalizer가 기존과 동일하게 batch count, payload schema, verified profile, payload digest, profile metadata, plan/log 관계를 검증한다.
3. 검증과 publish가 성공하면 같은 `(user_id, local_id)`의 `dive_plans.id` 또는 `dive_logs.id`를 해당 `guest_claim_records.target_record_id`에 기록한다.
4. remap 결과가 모든 staged record와 정확히 1:1인지 검사한다.
5. 불일치가 있으면 exception으로 transaction 전체를 rollback한다.

`target_record_id` 재조정은 같은 owner의 이미 검증된 동일 content row에만 허용된다. 다른 payload/profile/relationship은 private finalizer에서 계속 `23505`로 실패한다.

## 모바일 설계

`listCommittedBatch`는 remapped staging target ID를 기준으로 기존 방식 그대로 final row를 읽는다.

`verifyCommittedBatch`는 다음 순서로 동작한다.

1. entity kind와 `localId`로 committed row를 찾는다.
2. payload digest와 관계를 canonical remote ID 기준으로 검증한다.
3. 모든 검증이 끝난 뒤 snapshot item의 `targetRecordId`를 canonical remote ID로 갱신한다.
4. remapped snapshot을 저장한 뒤 account local publication/readback을 수행한다.

partial validation 중 snapshot target을 바꾸지 않는다.

## 진행 상태 설계

`remoteBatchId`가 있고 모든 manifest item에 `completedAt`이 있으면 retry는 `running/uploading`을 거치지 않고 `finalizing`으로 시작한다. 따라서 이미 완료된 과거 15건은 `15/15 계정으로 가져오는 중`이 아니라 indeterminate `계정 데이터를 확인하는 중`으로 표시된다.

서버 확인과 account local publication이 끝난 뒤 cleanup은 기존 indeterminate cleanup 화면을 사용한다. 완료 뒤 아직 남은 live guest 1건은 별도의 새 claim 선택으로 표시한다.

## 오류 처리

- 같은 `localId`, 다른 payload digest: `remote_conflict`, 전체 rollback
- 같은 payload, 다른 profile revision/digest/count: `remote_conflict`, 전체 rollback
- plan/log 관계 불일치: `remote_conflict`, 전체 rollback
- remap 후 staged/final 1:1 불일치: `claim_validation_failed`, 전체 rollback
- network interruption: 기존 checkpoint와 canonical mapping을 보존하고 retry

`기기에 유지`는 remote-progress checkpoint를 삭제하지 않는다. 이번 변경은 실패를 숨기기 위해 checkpoint를 버리지 않고 성공 가능한 idempotent transaction으로 복구한다.

## 검증

- database/function test: 같은 digest/profile의 새 batch가 기존 canonical IDs로 commit되고 staging target IDs가 remap된다.
- database/function test: 다른 digest/profile/relationship은 계속 rollback된다.
- package repository test: remapped staging IDs로 committed rows를 정확히 읽는다.
- mobile service test: remote canonical ID가 초기 staged ID와 달라도 검증 뒤 snapshot/account copy에 canonical ID가 저장된다.
- mobile service/screen test: 모든 item이 completed인 retry는 uploading `15/15`를 emit하지 않고 finalizing으로 시작한다.
- staging verifier: cross-device equivalent claim success와 divergent claim denial을 모두 확인한다.
- physical device: 기존 batch retry가 finalizing → cleanup → committed로 끝나고, 남아 있는 live guest 1건이 다음 claim 대상으로 표시되는지 확인한다.

## 승격 경계

변경은 staging project `mclvhwzsuvsxjerdouka`에 먼저 배포하고 automated verifier와 기존 문제 batch로 검증한다. production 승격은 별도 작업이다.
