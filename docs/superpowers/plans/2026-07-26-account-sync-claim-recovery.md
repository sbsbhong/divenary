# Account Sync and Claim Recovery Implementation Plan

**Goal:** UI를 바꾸지 않고 `1/1` guest claim false failure, account save false conflict,
claimed Watch/profile compatibility, cross-device pull, sticky Home Alert를 함께 복구한다.

## Global Constraints

- 일반 Git branch에서만 작업하고 unrelated dirty Watch/Xcode 파일은 수정·stage하지 않는다.
- TDD 순서로 각 production change 전에 실제 PostgREST-shaped failing test를 추가한다.
- Timestamp 외 persisted field의 exact comparison을 완화하지 않는다.
- Legacy claim digest fallback은 relation UUID 하나를 `null`로 되돌린 경우로 제한한다.
- Profile path는 canonical `/logs/`와 `/claims/<uuid>/` 형식만 허용한다.
- Local save의 `requestSync()`는 push-only로 유지하고 foreground/explicit refresh만
  pull을 추가한다.
- 성공 복구는 동일 bootstrap issue stage만 지운다.
- Content가 다른 conflict는 자동 해결하지 않는다.
- UI layout/copy, Supabase schema/RLS/Edge Function, WatchConnectivity contract는
  변경하지 않는다.

## Task 1: Lock and Fix Timestamp Roundtrips

**Files:**

- `packages/supabase/src/account-data-mappers.ts`
- `packages/supabase/src/account-data-mappers.test.ts`
- `packages/supabase/src/account-data-repository.ts`
- `packages/supabase/src/account-data-repository.test.ts`
- `apps/mobile/__tests__/guest-claim-service.test.ts`
- `apps/mobile/src/claim/guest-claim-service.ts`

**Steps:**

1. Add RED tests for DB rows returning equivalent `+00:00`/microsecond timestamps.
2. Assert log/plan save readback remains `saved`, not `conflict`.
3. Add RED claim tests whose committed readback uses equivalent offset timestamps and assert
   account-local publication plus cleanup.
4. Canonicalize mapped DB timestamps and compare persisted timestamp fields semantically.
5. Reuse normal remote parsers in committed claim verification after relationship normalization.
6. Run focused package and claim tests.

## Task 2: Lock and Fix Claimed Cloud Row Compatibility

**Files:**

- `apps/mobile/src/sync/account-payload.ts`
- `apps/mobile/src/sync/account-sync-coordinator.ts`
- `apps/mobile/src/sync/account-outbox.ts`
- `apps/mobile/__tests__/account-sync-coordinator.test.ts`
- `apps/mobile/__tests__/account-outbox.test.ts`

**Steps:**

1. Add RED parser tests for finalizer-shaped relation rows whose stored digest used null relation.
2. Add RED hydration tests for canonical claim profile paths.
3. Add rejection tests for foreign owner, wrong remote ID/batch/revision and traversal-like paths.
4. Add RED test proving an equivalent historical conflict becomes synced while divergent content
   remains conflict.
5. Implement constrained legacy relation digest fallback.
6. Implement canonical claim/log profile path validation.
7. Add strict unchanged-profile cache validation so foreground hydration does not repeatedly
   download/write an already verified synced profile; keep missing/corrupt cache on full fallback.
8. Add entity-scoped conflict metadata removal and equivalent-content recovery.
9. Continue valid rows/types when another remote row fails, then surface aggregate failure.
10. Run focused coordinator/outbox tests.

## Task 3: Add Recoverable Bidirectional Pull

**Files:**

- `apps/mobile/src/states/account-data.tsx`
- `apps/mobile/src/states/use-dive-logbook.ts`
- `apps/mobile/src/states/use-dive-plans.ts`
- `apps/mobile/__tests__/account-data-state.test.tsx`
- relevant hook tests

**Steps:**

1. Add RED tests: failed initial hydration followed by foreground success publishes remote rows and
   changes `remoteHydration/degraded` to `ready`.
2. Add RED tests for explicit Logbook/Planbook refresh invoking remote hydration before local
   refetch.
3. Add a concurrency test proving overlapping foreground/refresh pulls share one hydration.
4. Add a publication-scoped single-flight hydration helper.
5. Keep local mutation `requestSync()` as drain-only; add a separate cloud refresh API.
6. Invoke cloud refresh on foreground and explicit list/home refresh.
7. Clear only matching `remoteHydration` or `claimInspection` degraded stages after success.
8. Invalidate scoped queries after partial or complete remote publication.
9. Run focused account state and hook tests.

## Task 4: Durable Knowledge and Full Verification

**Files:**

- new immutable `.wiki/raw/` sync recovery note
- `.wiki/wiki/architecture/sync-flow.md`
- `.wiki/wiki/index.md`
- `.wiki/wiki/log.md`

**Steps:**

1. Record timestamp normalization, claim path/digest compatibility, foreground pull, and conflict
   recovery boundaries in the wiki.
2. Run focused mobile/package tests.
3. Run `yarn mobile:typecheck`.
4. Run the full mobile logic suite and relevant root/package tests.
5. Run `yarn ios:build` using the Xcode harness environment.
6. Run `yarn codex:check`.
7. Review the complete branch diff and run an independent code review.
8. Commit only task files, merge the branch into `main`, and confirm unrelated user changes remain
   untouched.
