Source URL: repository migration, finalizer integration test, and staging verification commands for project mclvhwzsuvsxjerdouka
Collected: 2026-07-20
Published: 2026-07-20

# Guest claim target ID and verifier correction evidence

## 수정 내용

- Review에서 같은 `(user_id, local_id)`와 같은 payload digest를 새 batch가 다른 `target_record_id`로 staging하면 기존 finalizer가 batch를 `committed`로 만들 수 있다는 문제가 발견됐다.
- Migration `20260720230000_reject_guest_claim_target_reuse.sql`은 기존 finalizer를 `private` schema로 옮기고 public service-role wrapper에서 staged target ID와 기존 account row ID가 다르면 transaction 전체를 `claim_validation_failed`로 rollback한다.
- Local finalizer integration test는 이 경우 HTTP 409, batch `uploading` 유지, account plan/log 각 1개 보존을 확인한다.
- Staging verifier는 published plan/log의 `payload_sha256`을 staged digest와 비교하고, 같은 local ID를 다른 target ID로 재사용하는 새 batch가 HTTP 409로 거부되는지도 확인한다.
- Verifier mock을 의도적으로 취약하게 만든 negative tests는 digest 변조와 target ID 재사용 허용을 각각 탐지한다.

## 배포와 검증 결과

- Candidate commit `8b630a3`에서 staging dry-run은 `20260720230000_reject_guest_claim_target_reuse.sql`만 제시했다.
- Migration을 staging `mclvhwzsuvsxjerdouka`에 적용했고 local/remote history가 `20260713135707`, `20260719130604`, `20260719134648`, `20260720230000` 네 migration에서 일치했다.
- `finalize-guest-claim` Edge Function은 같은 staging project에 재배포했으며 function source에는 변경이 없었다.
- `yarn supabase:staging:verify:auth`와 `yarn supabase:staging:verify:guest-claim`이 모두 exit code 0으로 끝났다.
- Supabase script tests 68건, `@repo/supabase` tests 53건, local finalizer 15 checks, pgTAP 109 tests, guest REST smoke 10 checks와 database lint가 통과했다.
- Review 재검사는 두 기존 finding이 해결됐다고 판단해 `APPROVE`로 끝났다.

## 경계

- 이 보정은 hosted staging의 자동 검증 근거다. Physical iPhone/Android claim, Google physical login, force-quit/offline 재개와 접근성 검증을 대신하지 않는다.
- Production Supabase에는 이 migration을 적용하지 않았다.
