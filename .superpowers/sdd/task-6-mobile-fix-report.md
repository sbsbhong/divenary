# Task 6 Mobile Fix Report

## Scope

- Base commit reviewed: `546e3f6f12d294b53a48f505b0d9f835449373ab`.
- Commit message: `fix: make account sync crash safe`.
- The final commit hash is reported in the handoff because a commit cannot
  contain its own hash.
- No `packages/supabase` or WatchConnectivity source files were edited.

## Changes

- Replaced fallback outbox persistence with strict versioned parsing, exact
  key validation, user-bound operation keys, immutable duplicate checks, and a
  storage-key-global read-modify-write lock.
- Preserved insertion-order entity heads, shared account entity mutation
  locking, max-ten continuation, rerun demand, and future retry scheduling.
- Made remote completion update local metadata before dequeueing and kept
  failed local completions retryable.
- Added durable remote-delete tombstones. Account list/get wrappers hide the
  row while its base metadata/profile remain available; delete conflicts
  restore the exact current local row as visible conflict data.
- Reconciled durable pending rows into deterministic operations on provider
  startup, including the local-save/outbox-enqueue crash gap.
- Snapshotted validated full profile bytes under an operation-owned key and
  delivered only those immutable bytes. Remote hydration verifies profile
  ownership, digest, byte count, sample count, and sample shape before
  user-scoped profile and metadata persistence.
- Reused principal publications and base repositories, generation-checked
  hydration/drain before publication, kept authenticated-offline startup local,
  and limited invalidation to active log/plan query roots.
- Extended `importWatchMessages` with optional `assertCanCommit`. Persistent
  imports check around every awaited profile write and metadata commit, then
  restore exact prior metadata/profile state inside the mutation queue when
  the guard becomes stale. The local repository also serializes and rolls back
  guarded imports.

## TDD Evidence

- RED coverage exercised corrupt outbox envelopes, cross-user operation IDs,
  changed duplicates, concurrent outbox instances, same-entity retry ordering,
  in-flight edit/delete, failed tombstone/outbox writes, local completion write
  failure, startup reconciliation, exact profile snapshots, malformed profile
  data, strict remote hydration, query invalidation, and max-ten continuation.
- Guard tests suspend a queued metadata write and an async profile write, flip
  the principal guard while suspended, and verify no new metadata/profile
  survives. Metadata rollback also verifies exact prior envelope bytes.

## Verification

- Focused mobile Jest gate: PASS, 6 suites and 82 tests.
- `yarn mobile:typecheck`: PASS.
- Changed-file ESLint: PASS with 0 errors and 7 non-blocking existing-style
  `no-void`/test-shadow warnings.
- `git diff --check`: PASS before commit.
- The whole mobile suite was intentionally not run per the status-checkpoint
  instruction.

## Files

- `apps/mobile/src/sync/account-outbox.ts`
- `apps/mobile/src/sync/account-sync-coordinator.ts`
- `apps/mobile/src/states/account-data.tsx`
- `apps/mobile/src/repositories/dive-log-repository.ts`
- `apps/mobile/src/repositories/local-dive-log-repository.ts`
- `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- `apps/mobile/__tests__/account-outbox.test.ts`
- `apps/mobile/__tests__/account-sync-coordinator.test.ts`
- `apps/mobile/__tests__/account-data-state.test.tsx`
- `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
- `.superpowers/sdd/task-6-mobile-fix-report.md`

## Risks

- The WatchConnectivity follow-up still needs to pass its generation guard via
  the new `assertCanCommit` option; no WatchConnectivity file was changed here.
- Real Supabase transport, background scheduling, and native profile storage
  remain device/integration validation work. Package idempotency is relied on
  for retries after remote completion and before durable local completion.
- Best-effort removal can leave an unreferenced outbox profile snapshot if the
  storage delete itself fails; it does not risk uploading mutable local bytes.
