Source URL: docs/superpowers/specs/2026-07-29-cross-device-guest-claim-reconciliation-design.md; commits 4e1ede2, 26f47a0, 3e48b23; staging verification commands
Collected: 2026-07-29
Published: 2026-07-29

# Cross-device guest claim reconciliation evidence

## 관찰된 원본 문제

- 원래 물리 iPhone에는 현재 live guest log 1건과 별개로 log 15건을 담은 보존 claim snapshot이 있다.
- 보존된 15개 항목은 record/profile staging과 readback을 마쳤다.
- Account local row와 claim snapshot 사이에 같은 `localId`인 log가 1건 있었고, 그 account remote ID와 claim의 staged target ID는 서로 달랐다.
- 기존 finalizer는 이 동일 항목의 canonical-ID 충돌 때문에 batch 전체를 rollback했다. 물리 기기에서 보존 batch를 다시 시도하면 이미 끝난 upload를 `15/15`로 다시 표시한 뒤 같은 finalization 실패로 돌아갔다.

## 선택한 조정 규칙

- 같은 owner, 같은 `localId`, 같은 payload/profile/relationship으로 private finalizer 검증을 통과한 cross-device claim은 기존 account row의 canonical remote ID를 재사용한다.
- Public wrapper는 private 검증과 publish가 끝난 같은 transaction에서 staged `target_record_id`를 canonical account row ID로 바꾸고 모든 staged/final row가 정확히 대응하는지 확인한다.
- Payload digest, profile revision/digest/count 또는 plan/log 관계가 다르면 transaction 전체를 계속 rollback한다. 서로 다른 내용을 자동 병합하지 않는다.
- Mobile committed readback은 모든 row와 관계를 먼저 검증한 뒤 canonical IDs를 snapshot에 반영하고, 이 snapshot을 저장한 다음 account local copy를 publish한다.
- `remoteBatchId`가 있고 모든 item upload receipt가 완료된 retry는 `uploading`을 다시 emit하지 않고 `finalizing`으로 시작한다. 따라서 과거 `15/15`를 재생하지 않고 `계정 데이터를 확인하는 중` 단계로 진입한다.

## 변경 근거

- Server migration: `supabase/migrations/20260729200000_reconcile_guest_claim_target_reuse.sql`
- Hosted verifier와 tests: `supabase/scripts/verify-staging-guest-claim.mjs`, `supabase/scripts/verify-staging-guest-claim.test.mjs`, `supabase/tests/functions/finalize-guest-claim.mjs`
- Mobile service/store와 tests: `apps/mobile/src/claim/guest-claim-service.ts`, `apps/mobile/src/claim/guest-claim-store.ts`, `apps/mobile/__tests__/guest-claim-service.test.ts`, `apps/mobile/__tests__/guest-claim-store.test.ts`
- Task commits: server `4e1ede2`, mobile `26f47a0`, profile receipt correction `3e48b23`

## 2026-07-29 자동 검증 결과

- `node --test supabase/scripts/verify-staging-guest-claim.test.mjs`: exit 0, 17/17 passed.
- `yarn workspace @repo/mobile test guest-claim-service.test.ts guest-claim-store.test.ts account-claim-screen.test.tsx --runInBand`: exit 0, 3 suites와 122/122 tests passed.
- `yarn mobile:typecheck`: exit 0.
- `yarn codex:check`: sandbox 안의 watch Swift macro 실행은 권한 제한으로 exit 65였고, sandbox 밖에서 같은 전체 command를 다시 실행해 exit 0과 `BUILD SUCCEEDED`를 확인했다.
- `yarn supabase:reset`: sandbox 밖에서도 exit 1. Docker daemon이 실행 중이 아니어서 local reset을 검증하지 못했다.
- `yarn supabase:test:db`: exit 1. Local PostgreSQL에 연결할 수 없어 pgTAP을 검증하지 못했다.
- `node supabase/tests/functions/finalize-guest-claim.mjs`: exit 1. Docker daemon이 실행 중이 아니어서 local function integration을 검증하지 못했다.

## Staging 배포와 검증 결과

- Guard 상수와 linked project-ref가 production이 아닌 staging `mclvhwzsuvsxjerdouka`와 정확히 일치함을 mutation 전에 확인했다.
- 적용 전 migration list는 기존 네 migration의 local/remote 일치와 `20260729200000` 한 건의 pending 상태만 표시했다.
- `yarn supabase:staging:push:dry-run`: exit 0, `20260729200000_reconcile_guest_claim_target_reuse.sql` 한 건만 표시했다.
- `yarn supabase:staging:push`: exit 0, 해당 migration을 staging에 적용했다. Docker 미가동 때문에 pg-delta migration catalog의 local cache를 만들지 못했다는 경고가 있었지만 remote push는 완료됐다.
- 적용 후 migration list는 `20260729200000`을 포함한 다섯 migration의 local/remote가 모두 일치했다.
- 이번 변경은 Edge Function source를 수정하지 않았다. 기존 staging `finalize-guest-claim`이 새 database wrapper를 호출하며, 별도 Function 재배포 없이 hosted verifier가 이 실제 경로를 실행했다.
- `yarn supabase:staging:verify:guest-claim`: exit 0, `PASS staging guest claim verification`. Equivalent second batch는 canonical IDs로 조정되고 divergent batch는 거부됐으며 verifier의 disposable users 정리도 완료됐다.
- Production에는 migration, Function 또는 다른 변경을 적용하지 않았다.

## 남은 물리 기기 gate

- 원래 실패한 15-item batch의 물리 claim retry는 아직 실행하지 않았다. 자동 검증이나 staging verifier 결과를 물리 성공으로 바꾸어 기록하지 않는다.
- 원래 iPhone을 잠금 해제하고 staging build를 실행한 뒤 필요하면 account 인증을 완료해야 한다.
- Retry가 stale `15/15`가 아니라 `계정 데이터를 확인하는 중`으로 시작하는지, cleanup과 `committed`까지 끝나는지, account local/remote 목록에 중복 없는 복구 row가 있는지, 남은 live guest log 1건이 별도 제안되는지, 두 번째 retry가 row를 중복 생성하지 않는지 확인해야 한다.
