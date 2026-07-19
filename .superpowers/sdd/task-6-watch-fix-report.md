# Task 6 Watch Principal-Switch Fix Report

## Scope

- Base commit reviewed: `546e3f6f12d294b53a48f505b0d9f835449373ab`
- Commit message: `fix: isolate watch imports by principal`
- Final commit hash is reported in the task handoff because a commit cannot contain its own hash.

## Changes

- Scoped Watch import serialization and payload single-flight to a principal query scope generation.
- Added a narrow `StaleWatchConnectivityImportError` and silent provider cancellation handling.
- Invalidated active imports on provider cleanup or principal scope change.
- Guarded each local mutation boundary and the imported native ACK boundary.
- Preserved successful ordering: local log/profile/plan writes, imported ACK, account enqueue, optional remote drain request.
- Repaired duplicate replay after a local-write crash gap by ACKing first, then enqueueing the existing pending account log and source plan before requesting sync.
- Preserved invalid-payload acknowledgement behavior.

## Tests

Focused RED coverage was observed before the implementation for principal switching, cross-scope payload coalescing, duplicate recovery, and provider cleanup.

`yarn workspace @repo/mobile test --runInBand watch-connectivity-sync`

- PASS: 1 suite, 24 tests.
- Includes switch before local mutation, switch after local save before ACK, same payload under separate scopes, duplicate crash recovery, ACK/enqueue/remote ordering, and provider cleanup.

`yarn mobile:typecheck`

- RUN, but currently blocked by concurrently edited, unowned account sync work: RED tests reference pending scheduler/pause/downloader APIs, and `account-sync-coordinator.ts` has account-outbox signature mismatches.
- The owned Watch files produced no TypeScript diagnostics.

## Files

- `apps/mobile/src/states/watch-connectivity-sync.tsx`
- `apps/mobile/src/states/watch-connectivity-import-coordinator.ts`
- `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- `.superpowers/sdd/task-6-watch-fix-report.md`
