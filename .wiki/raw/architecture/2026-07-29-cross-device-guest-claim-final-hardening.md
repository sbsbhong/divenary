Source URL: docs/superpowers/specs/2026-07-29-cross-device-guest-claim-reconciliation-design.md; final review findings; commits e43249c, c98b046; staging verification commands
Collected: 2026-07-29
Published: 2026-07-29

# Cross-device guest claim final hardening evidence

## 최종 검토에서 확인한 경계

- 한 기기의 batch가 만든 immutable staged profile receipt와, 다른 기기가 먼저 확정한 canonical account row의 profile 경로는 서로 다를 수 있다.
- Mobile은 staged receipt를 원래 batch와 target, revision, digest, byte/sample metadata 기준으로 독립 검증한다.
- Committed readback의 canonical profile은 account log namespace 또는 유효한 이전 claim namespace만 허용한다. Owner, canonical remote ID와 encoded revision이 정확히 일치해야 하며 malformed batch, traversal, 다른 namespace는 fail closed다.
- 모든 row, payload, relation과 profile 검증이 끝난 뒤에만 snapshot target ID를 canonical ID로 바꾼다.

## Database hardening

- 새 migration `20260729210000_harden_guest_claim_canonical_candidates.sql`은 기존 migration을 수정하지 않고 public finalizer wrapper를 교체한다.
- Wrapper는 batch row, 현재 batch record를 먼저 잠그고, 같은 owner/local ID의 plan 전체와 log 전체를 각각 안정된 ID 순서로 잠근 뒤 private finalizer를 실행한다.
- Candidate lock에는 active와 soft-deleted row가 모두 포함된다. Canonical ID 재사용은 active row에만 허용한다.
- 같은 내용의 soft-deleted row와 충돌하면 uniqueness violation으로 transaction 전체가 rollback된다. Batch는 uploading 상태에 남고 새 active account row는 생성되지 않는다.
- 이 lock order와 active predicate는 static migration contract test로 고정했다. Docker daemon이 실행되지 않아 실제 PostgreSQL 두 session 동시성 gate는 실행하지 못했으며 정적 검증을 live database 증거로 간주하지 않는다.

## Hosted staging 결과

- 배포 전 migration list와 dry-run은 `20260729210000` 한 건만 pending임을 확인했다.
- 해당 migration은 고정된 non-production staging project에만 적용했다. 적용 후 local/remote migration 이력이 일치했다.
- Edge Function source는 바뀌지 않아 재배포하지 않았다. 기존 hosted Function이 새 database wrapper를 호출하는 실제 경로를 verifier로 검증했다.
- Hosted verifier는 equivalent cross-device canonical reuse와 divergent rollback에 더해 soft-deleted equivalent collision이 validation failure로 끝나고 batch가 uploading인 채 유지되며 active row가 생기지 않는 것을 통과했다.
- Production에는 migration, Function 또는 다른 변경을 적용하지 않았다.

## 남은 gate

- Docker가 실행되는 환경에서 local reset, pgTAP, Function integration과 실제 두 PostgreSQL session concurrency를 다시 실행해야 한다.
- 원래 iPhone에 보존된 15-item batch의 물리 retry와 두 번째 retry 중복 방지는 아직 pending이다.
