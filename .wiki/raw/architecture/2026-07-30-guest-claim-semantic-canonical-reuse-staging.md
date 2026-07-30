# Guest claim semantic canonical reuse staging promotion evidence

Source URL: repository migration and staging verification command output
Collected: 2026-07-30
Published: 2026-07-30

## Scope

- Target: Supabase hosted staging project `mclvhwzsuvsxjerdouka`
- Migration: `20260730111944_reconcile_semantic_guest_claim_log_reuse.sql`
- Production: untouched
- Edge Function: source unchanged, so it was not redeployed

## Promotion evidence

- The pre-push migration list showed `20260730111944` as the only local migration missing from staging.
- The staging push dry run selected only `20260730111944_reconcile_semantic_guest_claim_log_reuse.sql`.
- The guarded staging push completed with exit code 0 and applied that migration.
- The CLI emitted a local pg-delta catalog-cache certificate warning after the successful push. The post-push migration list independently confirmed that local and remote histories were aligned through `20260730111944`.
- The existing hosted `finalize-guest-claim` Edge Function was not redeployed because its source did not change; it calls the public database wrapper updated by the migration.

## Hosted verification evidence

- `yarn supabase:staging:verify:guest-claim` completed with `PASS staging guest claim verification`.
- The hosted verifier exercised representation-only canonical reuse with a genuinely different staged digest, canonical target-ID remapping, strict rejection of a user-meaningful divergence, owner RLS, private profile handling, idempotent readback, and fixture cleanup.
- This proves the staging database and the already deployed Edge Function execute the new semantic reconciliation path together.

## Remaining physical gate

- The original preserved iPhone claim batch with 15 staged records has not yet been retried against the promoted staging migration.
- Physical verification must confirm that the one equivalent canonical Watch log is reused, only the fourteen actually new logs are published, local account readback completes, guest cleanup leaves a compact receipt, and a repeat retry does not create duplicates.
