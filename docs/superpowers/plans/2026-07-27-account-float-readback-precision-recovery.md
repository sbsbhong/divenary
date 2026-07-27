# Account Float Readback Precision Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover intact account Watch logs whose typed Supabase floating summaries use the observed 15-significant-digit REST representation while preserving exact payload digest validation.

**Architecture:** Add one directional typed-readback comparison to `@repo/supabase`, use it for repository save readback and mobile payload reconstruction, and keep the full stored SHA-256 as the final authority. No schema, RLS, Storage, WatchConnectivity, or profile validation changes are permitted.

**Tech Stack:** TypeScript, Node test runner, Jest, React Native account sync coordinator, Supabase/PostgREST typed repository, Karpathy project wiki.

## Global Constraints

- Yarn 1.22.22 workspace commands only; do not change dependency or lock files.
- Only `duration_seconds` and `max_depth_meters` receive typed floating readback compatibility.
- `rating`, timestamps, profile identity, owner, relations, and all other payload fields remain fail-closed.
- Never use epsilon, percentage tolerance, or an arbitrary maximum ULP distance.
- Restore an embedded source value only when the complete candidate payload matches the stored SHA-256.
- Preserve all existing user Watch/Xcode worktree changes.

---

### Task 1: Directional typed floating readback comparison

**Files:**
- Modify: `packages/supabase/src/account-data-numbers.test.ts`
- Modify: `packages/supabase/src/account-data-numbers.ts`
- Modify: `packages/supabase/src/index.ts`

**Interfaces:**
- Consumes: existing `sameAccountFloat(left, right): boolean`
- Produces: `sameAccountFloatReadback(typedValue: number, sourceValue: number): boolean`

- [ ] **Step 1: Write the failing numeric compatibility tests**

Add tests asserting the observed typed/source pairs are accepted:

```ts
assert.equal(
  sameAccountFloatReadback(13.8907051086426, 13.890705108642578),
  true,
);
assert.equal(
  sameAccountFloatReadback(6.91755499840561, 6.917554998405613),
  true,
);
assert.equal(
  sameAccountFloatReadback(18.4634580612183, 18.46345806121826),
  true,
);
```

Also assert directionality, `11.5` divergence, non-finite values, and existing
exact/adjacent behavior. Use `120` versus `120.000000000003` as a control that
remains distinct after 15-significant-digit conversion.

- [ ] **Step 2: Run the package test and verify RED**

Run:

```bash
yarn workspace @repo/supabase test
```

Expected: FAIL because `sameAccountFloatReadback` is not exported.

- [ ] **Step 3: Implement the minimal directional comparison**

Keep `sameAccountFloat` unchanged and add:

```ts
const ACCOUNT_FLOAT_READBACK_SIGNIFICANT_DIGITS = 15;

export function sameAccountFloatReadback(
  typedValue: number,
  sourceValue: number,
): boolean {
  if (!Number.isFinite(typedValue) || !Number.isFinite(sourceValue)) {
    return false;
  }
  return (
    sameAccountFloat(typedValue, sourceValue) ||
    Number(sourceValue.toPrecision(
      ACCOUNT_FLOAT_READBACK_SIGNIFICANT_DIGITS,
    )) === typedValue
  );
}
```

Export it from `packages/supabase/src/index.ts`.

- [ ] **Step 4: Run the package test and verify GREEN**

Run:

```bash
yarn workspace @repo/supabase test
```

Expected: all package tests pass.

---

### Task 2: Repository and mobile payload recovery

**Files:**
- Modify: `packages/supabase/src/account-data-repository.test.ts`
- Modify: `packages/supabase/src/account-data-repository.ts`
- Modify: `apps/mobile/__tests__/account-sync-coordinator.test.ts`
- Modify: `apps/mobile/src/sync/account-payload.ts`

**Interfaces:**
- Consumes: `sameAccountFloatReadback(typedValue, sourceValue)`
- Produces: consistent save-readback and remote-hydration compatibility for the observed Watch values

- [ ] **Step 1: Write failing repository and mobile regression tests**

Add a repository save test using typed `13.8907051086426` and source
`13.890705108642578`.

Extend the Watch fixture to accept source/readback duration and depth. Add
mobile parser cases for:

```ts
[
  {
    sourceDuration: 13.890705108642578,
    typedDuration: 13.8907051086426,
    sourceDepth: 6.917554998405613,
    typedDepth: 6.91755499840561,
  },
  {
    sourceDuration: 18.46345806121826,
    typedDuration: 18.4634580612183,
    sourceDepth: 12,
    typedDepth: 12,
  },
]
```

Assert both original values are restored and the original payload SHA-256 is
preserved. Keep or add controls showing `11.5`, changed embedded source,
unrelated payload mutation, and fractional `rating` remain rejected.
Update the prior repository control from `120.00000000000003`, which is a
valid 15-significant-digit readback of `120`, to `120.000000000003`, which
remains distinct and must stay a conflict.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
yarn workspace @repo/supabase test
yarn workspace @repo/mobile test --runInBand --runTestsByPath __tests__/account-sync-coordinator.test.ts
```

Expected: the observed multi-ULP repository and mobile cases fail.

- [ ] **Step 3: Use the directional helper at both boundaries**

In `account-data-repository.ts`, compare the typed row value against the
outgoing source value:

```ts
return sameAccountFloatReadback(row[key], value);
```

In `account-payload.ts`, replace a typed summary only when:

```ts
sameAccountFloatReadback(typedValue, sourceValue)
```

Do not alter the final `matchesPayloadDigest` call or other fields.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the two commands from Step 2.

Expected: all focused package and mobile tests pass.

---

### Task 3: Durable sync documentation and full verification

**Files:**
- Create: `.wiki/raw/architecture/2026-07-27-account-float-readback-precision-recovery.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: verified implementation and the two observed remote rows
- Produces: durable project knowledge describing the bounded compatibility rule

- [ ] **Step 1: Capture immutable implementation evidence**

Create the raw source with:

```md
Source URL: apps/mobile/src/sync/account-payload.ts; packages/supabase/src/account-data-numbers.ts; simulator account cache
Collected: 2026-07-27
Published: 2026-07-27
```

Record the 12-, 4-, and 11-ULP observations, exact source-restored SHA-256
matches, the directional 15-significant-digit rule, and retained rejection
controls without storing user IDs, tokens, full UUIDs, or private notes.

- [ ] **Step 2: Update the compiled sync article, index, and log**

Update `sync-flow.md` to replace the one-ULP-only statement with the verified
directional typed-readback rule. Add the raw link, set `Updated: 2026-07-27`,
refresh the matching index row, and append:

```md
## [2026-07-27] ingest | Account float readback precision recovery
- Updated: 동기화 흐름 구조
```

- [ ] **Step 3: Run fresh verification**

Run:

```bash
yarn workspace @repo/supabase test
yarn workspace @repo/mobile test --runInBand --runTestsByPath __tests__/account-sync-coordinator.test.ts __tests__/account-data-state.test.tsx __tests__/utf8.test.ts
yarn mobile:typecheck
yarn codex:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Review the final diff**

Confirm only the planned Supabase, mobile test/sync, wiki, spec, and plan files
are included in this task. Do not stage or rewrite the user's pre-existing
Watch/Xcode changes.
