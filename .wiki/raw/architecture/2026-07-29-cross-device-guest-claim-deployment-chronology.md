Source URL: final re-review implementation and staging verification commands
Collected: 2026-07-29
Published: 2026-07-29

# Cross-device guest claim deployment chronology

## Immutable deployment order

1. `20260729200000_reconcile_guest_claim_target_reuse.sql` was applied only to staging. The Edge Function source was unchanged and no Function deployment accompanied that migration.
2. Commit `fa68f0f` later added the repository-owned exact-argument Function deployment guard. The guarded command then redeployed the unchanged `finalize-guest-claim` source only to the fixed staging project, and the hosted verifier passed.
3. `20260729210000_harden_guest_claim_canonical_candidates.sql` was applied only to staging. The Edge Function source was still unchanged, so there was no additional Function deployment.
4. `20260729220000_revalidate_guest_claim_canonical_candidates.sql` was applied only to staging. The Edge Function source was unchanged and was not redeployed. The existing hosted Function exercised the new database wrapper, and the hosted guest-claim verifier passed.

This chronology supersedes no earlier raw source. It records the later Function redeployment separately so that “no redeploy with migration” is not misread as “never redeployed.”

## Final database boundary

- The public security-definer wrapper keeps the deterministic pre-publication order: batch, staged records, all matching plans, then all matching logs.
- After the private publisher returns, the wrapper locks every matching plan and then every matching log again, including active and soft-deleted rows, in `(local_id, id)` order.
- While those post-publication locks are held, it repeats active-row, payload-digest, log-profile metadata, plan-to-converted-log and log-to-source-plan equivalence checks.
- Canonical target remap and the final active-row invariant run only after that locked revalidation succeeds.
- The wrapper keeps an empty `search_path`, fully qualified references, owner scoping and service-role-only execution.

## Verification evidence

- A clean local reset applied the full migration chain through `20260729220000`.
- Static migration and hosted-verifier contract tests passed 21 tests.
- Local pgTAP passed 109 tests, and the local Function integration harness passed 16 named claim checks.
- The real multi-session PostgreSQL harness used explicit advisory-lock barriers. It proved that a concurrent equivalent unique-key winner is locked before remap, a divergent updater waits behind that lock, and a winner changed to divergent before post-publication validation makes finalization roll back instead of committing divergent data.
- Before staging mutation, migration list and dry-run showed only `20260729220000` pending. After push, local and remote migration histories matched and the hosted guest-claim verifier passed.
- The push completed successfully but emitted a non-blocking local pg-delta catalog-cache certificate-file warning. Post-push migration listing and the hosted verifier independently confirmed the remote result.
- Production was not targeted or changed.

## Remaining physical gate

- The original iPhone’s preserved 15-item batch retry and the second-retry duplicate-prevention observation remain pending. Automated local and hosted results are not treated as physical-device evidence.
