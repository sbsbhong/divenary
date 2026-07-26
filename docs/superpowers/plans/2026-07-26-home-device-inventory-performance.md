# Home and Device Inventory Performance Implementation Plan

**Goal:** UI를 변경하지 않고 Home conditions와 device inventory/claim 검사 병목, stale
count race, 불필요한 claim action을 제거한다.

## Task 1: Lock Home Conditions Regressions

- Add failing controller tests for fresh-cache remount/foreground behavior and in-flight sharing.
- Add failing provider tests proving Weather, Marine, and reverse geocode start concurrently.
- Add a timeout regression where optional enrichment never settles but air temperature becomes
  ready.
- Verify the focused tests fail for the intended reasons.

## Task 2: Implement Bounded Conditions Loading

- Add a locale-scoped 5-minute ready cache and same-locale in-flight coalescing.
- Preserve ready data during forced refresh and avoid duplicate foreground work inside freshness.
- Start Weather, Marine, and reverse geocode together.
- Bound required request and optional enrichment waits without changing the rendered UI.
- Abort expired Weather and Marine fetches.
- Re-run focused conditions tests.

## Task 3: Lock Device Inventory Regressions

- Add a zero-inventory test that asserts claim storage is not read.
- Add an out-of-order refresh test so an older nonzero result cannot overwrite newer zero state.
- Add a reconciliation read-budget test for multi-item snapshots.
- Add Home recovery/action visibility and claim-sheet inspection tests.
- Verify these tests fail for the intended reasons.

## Task 4: Implement Latest-Wins, Inventory-First Claim Inspection

- Issue monotonic refresh IDs and reject stale publication after every await.
- Read live guest inventory before claim checkpoint data.
- Publish and return immediately for zero inventory.
- Persist a lightweight advisory checkpoint hint and resume only verified active checkpoints.
- Defer a one-shot legacy full-snapshot audit until after interactions.
- Reuse bulk-loaded rows for hidden-ID reconciliation and eligible counts.
- Skip record/profile comparison for non-published checkpoints.
- Gate Home recovery on positive live eligibility.
- Keep stale sheet actions unavailable until mount refresh completes.
- Serialize claim-store operations so stale hint backfill cannot overwrite newer recovery state.
- Re-run focused claim/navigation tests.

## Task 5: Verification and Integration

- Run focused Jest suites.
- Run `yarn mobile:typecheck`.
- Run the full mobile Jest suite.
- Read and apply the Xcode harness, then run `yarn ios:build`.
- Update sync-flow wiki if implementation changes the documented refresh/reconciliation behavior.
- Run `yarn codex:check`.
- Review the diff, preserve unrelated dirty watch/Xcode files, commit only task files, and merge the
  branch to `main` after all gates pass.
