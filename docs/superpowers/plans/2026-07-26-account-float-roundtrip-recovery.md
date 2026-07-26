# Account Float Roundtrip Recovery Implementation Plan

**Goal:** Supabase가 이미 반환하는 5번째 Watch log를 엄격한 무결성 경계 안에서
복구하고, 성공한 remote hydration 뒤 Home의 generic recovery 안내를 없앤다.

## Global Constraints

- 일반 Git branch `codex/cloud-pull-alert-recovery`에서 작업한다.
- unrelated dirty Watch/Xcode/cache/docs 파일은 수정하거나 stage하지 않는다.
- TDD 순서로 production edit 전에 실제 failure shape의 RED test를 확인한다.
- Stored SHA-256을 최종 authority로 유지한다.
- One-ULP compatibility는 DB typed floating summary field와 payload 안의 hashed source
  duplicate 사이로 한정한다.
- UI, Supabase schema/RLS/migration/Edge Function, Watch contract는 변경하지 않는다.
- 기존 timestamp, profile, relation, owner validation을 완화하지 않는다.

## Task 1: Lock the DB Float Boundary

**Files:**

- `packages/supabase/src/account-data-numbers.ts`
- `packages/supabase/src/account-data-repository.ts`
- `packages/supabase/src/account-data-repository.test.ts`
- `packages/supabase/src/index.ts`

**Steps:**

1. Add RED repository tests whose returned `max_depth_meters` and
   `duration_seconds` are one binary64 neighbor away from the submitted
   payload.
2. Assert the one-ULP readback is `saved`.
3. Add a control asserting a value farther than one ULP remains `conflict`.
4. Implement and export an exact binary64-neighbor comparison without
   percentage/decimal tolerance.
5. Apply it only to the two typed floating log fields in persisted readback;
   keep integer `rating` exact.
6. Run the focused Supabase package test.

## Task 2: Recover Existing Remote Watch Rows

**Files:**

- `apps/mobile/src/sync/account-payload.ts`
- `apps/mobile/__tests__/account-sync-coordinator.test.ts`

**Steps:**

1. Add a RED parser test using the observed value pair
   `11.600000000000001 → 11.6` while retaining the original stored digest.
2. Add RED coordinator hydration coverage proving the row is saved locally
   instead of counted as a partial hydration failure.
3. Add controls for a value more than one ULP away and for changed source
   content; both must remain rejected.
4. Reconstruct summary candidates from `watch_metadata`/`manual_data` using
   the same precedence as `createAccountRemoteLog`.
5. Reuse the shared one-ULP helper before substituting any typed value.
6. Require an exact stored SHA-256 match for the recovered candidate, including
   the existing relation-null combination where applicable.
7. Return the source-derived payload only after full digest validation.
8. Run the focused coordinator test.

## Task 3: Lock Alert Recovery

**Files:**

- `apps/mobile/__tests__/account-data-state.test.tsx`
- `apps/mobile/src/states/account-data.tsx` only if the RED test reveals a state defect

**Steps:**

1. Add a provider test whose first hydration contains the observed float
   roundtrip row and whose successful retry/refresh publishes all account logs.
2. Assert the initial generic issue is `remoteHydration/degraded`.
3. Assert successful recovered hydration changes bootstrap to `ready`.
4. Confirm device claim inventory remains independent and no UI change is
   required.
5. Change production state code only if this regression test exposes behavior
   beyond the parser failure.

## Task 4: Durable Knowledge and Verification

**Files:**

- new immutable `.wiki/raw/architecture/2026-07-26-account-float-roundtrip-recovery.md`
- `.wiki/wiki/architecture/sync-flow.md`
- `.wiki/wiki/index.md`
- `.wiki/wiki/log.md`

**Steps:**

1. Record the observed five-row response, binary64 drift, strict source-derived
   digest recovery and Home issue relationship.
2. Run focused Supabase and mobile tests.
3. Run `yarn mobile:typecheck`.
4. Run the relevant/full mobile logic suites.
5. Run `yarn ios:build` using the Xcode harness environment.
6. Run `yarn codex:check`.
7. Review the complete branch diff and request an independent code review.
8. Commit only task files, fast-forward merge into `main`, and confirm unrelated
   user changes remain untouched.
