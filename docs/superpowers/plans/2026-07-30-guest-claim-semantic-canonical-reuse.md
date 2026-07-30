# Guest Claim Semantic Canonical Reuse Implementation Plan

Date: 2026-07-30

## Goal

Make the observed fifteen-record physical-device claim complete atomically by
reusing the one semantically identical canonical watch log while retaining
strict conflict rejection for meaningful differences.

## Task 1: Lock the regression contract with failing tests

Files:

- `supabase/scripts/guest-claim-hardening-migration.test.mjs`
- `supabase/tests/functions/finalize-guest-claim.mjs`
- hosted staging verifier and its unit tests

Implementation:

- Require a new private semantic-equivalence helper and a pre-private-finalizer
  normalization step.
- Add a claim fixture whose canonical log differs only in timestamp spelling,
  safe float readback, and allowed import bookkeeping timestamps.
- Assert canonical target reuse, no duplicate row, staged digest publication,
  and full-batch commit.
- Retain explicit negative cases for title/rating/profile/relation divergence.

Gate:

- Run the smallest affected Node tests and confirm the new assertions fail
  before implementation.

Risk:

- Static SQL assertions alone can pass while PostgreSQL behavior is wrong, so
  integration coverage is mandatory.

## Task 2: Implement the locked semantic repair

File:

- `supabase/migrations/20260730111944_reconcile_semantic_guest_claim_log_reuse.sql`

Implementation:

- Add a private null-safe float readback-equivalence helper.
- Add a private log semantic-equivalence helper with the approved allowlist.
- Replace the public wrapper with the current lock/revalidation flow plus a
  phase-one normalization update before calling the private finalizer.
- Preserve canonical identity and immutable profile storage fields.
- Explicitly revoke helper execution and preserve service-role-only access to
  the public finalizer.

Gate:

- Static migration tests pass.
- Local database reset and claim integration tests pass.

Risk:

- An overly broad JSON comparison could hide meaningful edits. Strip only the
  three approved bookkeeping timestamps and compare everything else.

## Task 3: Verify transaction, concurrency, and database safety

Files:

- existing Supabase test and verification scripts

Implementation:

- Run the claim function integration suite.
- Run claim concurrency coverage.
- Run relevant pgTAP, database lint, and advisor checks.
- Run mobile typecheck because the hosted finalizer contract is consumed by
  the mobile claim state machine, even though no mobile source change is
  expected.

Gate:

- Every relevant local gate passes with recorded command output.

Risk:

- Local Supabase services or Docker may be unavailable. Retry environment-only
  failures once and report any genuine unavailable gate without claiming it
  passed.

## Task 4: Record the architecture decision

Files:

- new immutable `.wiki/raw/architecture/` source
- relevant `.wiki/wiki/` compiled articles, index, and log

Implementation:

- Record the physical-device evidence and exact semantic allowlist.
- Explain that canonical reuse is an atomic pre-finalization normalization,
  not relaxed digest validation.
- Keep the remaining physical-device validation gap explicit.

Gate:

- Wiki lint and repository agent checks pass.

Risk:

- Do not write physical success into the wiki until it has actually happened.

## Task 5: Deploy and verify staging

Files:

- the new database migration
- hosted staging verifier changes

Implementation:

- Confirm only the intended migration is pending for staging project
  `mclvhwzsuvsxjerdouka`.
- Push the migration.
- Run the automated hosted verifier, including semantic canonical reuse.

Gate:

- Migration history is aligned and the hosted verifier passes.

Risk:

- This mutates staging. Do not target production and do not deploy unrelated
  functions or migrations.

## Task 6: Physical-device proof and integration

Implementation:

- Stop and ask the user to connect and unlock the iPhone.
- Attach logs, retry the existing claim, and capture fresh local state.
- Verify the remote batch committed, the canonical row was reused, fourteen
  new rows were added, account-local readback finished, and exact guest cleanup
  ran.
- Update the wiki with observed evidence only after success.
- Commit, merge the feature branch into local `main`, and rerun focused gates
  on the merged commit while preserving unrelated root worktree changes.

Gate:

- Physical evidence and merged-main verification both pass.

Risk:

- Do not infer success from UI progress alone. Confirm local transaction state
  and remote canonical rows.
