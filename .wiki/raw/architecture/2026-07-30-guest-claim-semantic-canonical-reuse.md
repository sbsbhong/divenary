Source URL: docs/superpowers/specs/2026-07-30-guest-claim-semantic-canonical-reuse-design.md; physical iPhone console and app-container readback; local Supabase verification commands
Collected: 2026-07-30
Published: 2026-07-30

# Guest claim semantic canonical reuse evidence

## 물리 기기에서 확인한 원인

- iPhone의 보존 claim은 log 15건 모두 staging과 profile 검증을 끝냈지만
  finalization에서 `remote_conflict`로 rollback됐다.
- Account에는 이 중 1건과 같은 owner/local ID인 Watch log가 다른 canonical
  remote ID로 이미 존재했다. 나머지 14건은 새 log였다.
- 충돌한 두 row의 profile content revision, sample SHA-256, byte count와 sample
  count는 모두 같았다.
- 사용자 의미가 있는 title, site, rating, notes, mode, provenance와 profile
  preview도 같았다.
- Payload digest 차이는 같은 시각의 `Z`/`+00:00` 표기, source-derived
  binary64의 `11.600000000000001`/typed readback `11.6`,
  `_local_record.createdAt`, `_local_record.updatedAt`,
  `watch_metadata.importedAt`뿐이었다.
- 기존 wrapper는 byte-level `payload_sha256`이 같은 경우에만 canonical ID를
  재사용했다. Private finalizer가 digest mismatch를 먼저 거부하므로 public
  remap에 도달하지 못했고 14건의 새 log까지 함께 rollback됐다.

## 선택한 보정 경계

- Digest mismatch를 일반적으로 허용하지 않는다.
- Active profiled Watch log이고 owner/local ID, source-plan 관계, profile
  revision/digest/byte/sample tuple과 모든 사용자 의미 field가 같은 경우만
  semantic reuse 후보가 된다.
- 허용 차이는 같은 `timestamptz` instant, 모바일 account float readback
  규칙과 같은 좁은 source-derived float 차이, 위 세 import bookkeeping
  timestamp뿐이다.
- Wrapper는 phase-one canonical row lock을 보유한 채 eligible row의 payload
  표현과 digest만 staged 표현으로 정규화한다. Canonical ID, owner, local ID,
  profile path/revision과 relation은 바꾸지 않는다.
- 기존 private finalizer의 strict digest/profile/relationship 검사, phase-two
  lock/revalidation과 canonical target remap은 그대로 수행한다. 이후 단계가
  실패하면 정규화와 새 row publication이 같은 transaction에서 모두
  rollback된다.
- Title/site/rating/notes, profile tuple, relation, deletion state 또는 다른
  JSON 차이는 계속 fail closed다.

## 구현과 로컬 검증

- Migration:
  `supabase/migrations/20260730111944_reconcile_semantic_guest_claim_log_reuse.sql`
- Static contract:
  `supabase/scripts/guest-claim-hardening-migration.test.mjs`
- Local Function integration:
  `supabase/tests/functions/finalize-guest-claim.mjs`
- Hosted verifier:
  `supabase/scripts/verify-staging-guest-claim.mjs`
- Local database reset은 전체 migration을 적용했다.
- Edge Function integration은 representation-only mismatch의 canonical ID
  재사용과 commit, title divergence의 whole-batch rollback을 통과했다.
- pgTAP 109개, canonical concurrency 2개, Supabase package 70개, mobile
  account-sync 80개, staging verifier/static 24개와 mobile typecheck가
  통과했다.
- Database security advisor는 issue 0건이었다. DB lint는 기존 wrapper loop
  변수의 `warning extra`만 보고했고 error gate는 통과했다.
- SQL float helper는 관찰값 `11.6/11.600000000000001`과
  `13.8907051086426/13.890705108642578`을 허용하고, `11.5/11.600...`과
  `120/120.000000000003`은 거부했다.

## 남은 gate

- 이 source 작성 시점에는 migration을 hosted staging에 적용하지 않았다.
- Staging migration history/dry-run/push와 semantic reuse hosted verifier를
  통과해야 한다.
- 원래 iPhone의 15-item batch를 재시도해 canonical 1건 재사용, 새 14건
  publication, account local readback, exact guest cleanup과 compact receipt를
  실제로 확인해야 한다.
- 자동 검증 결과를 원래 물리 batch의 성공으로 기록하지 않는다.
