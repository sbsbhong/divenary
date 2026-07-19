# Guest Data Account Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-isolated remote Logbook/Planbook storage and a resumable Apple-style guest-data claim flow that displays exact determinate progress such as `3 / 32` without losing or prematurely exposing local records.

**Architecture:** Supabase stores normal account rows separately from claim staging rows, while an authenticated Edge Function verifies profile bytes and invokes a service-role-only transaction to publish a complete batch. Mobile migrates legacy data into `guest` and `user:<uuid>` partitions, persists an immutable claim manifest, resumes item-level uploads, and deletes guest originals only after remote commit and account-local verification. One native form sheet owns choice, running, failure, and completion states; retained guest records remain visible with a `기기 저장` label and a Settings retry action.

**Tech Stack:** Yarn 1.22.22, React Native 0.85.3, React 19.2.3, React Navigation 7, Gluestack UI v4 alpha, TanStack Query 5, AsyncStorage 3.1.1, `@noble/hashes` 1.8.0, Supabase CLI 2.109.1, `@supabase/supabase-js` 2.110.2, PostgreSQL/RLS/pgTAP, Supabase Storage, Supabase Edge Functions, Jest 29, TypeScript 5.8.3.

## Global Constraints

- Start execution in a new worktree created with the `using-git-worktrees` skill; use branch `feat/guest-data-account-claim` and do not implement in the dirty `main` checkout.
- Use the existing staging project as the hosted development backend. Run local Supabase gates first, then staging dry-run/push/deploy gates.
- Keep Google/Apple Auth in staging, while database, Storage, and Edge Function tests run locally before hosted promotion.
- Never expose `service_role`, provider secrets, session tokens, profile contents, or user email in mobile code, logs, fixtures, or error copy.
- Enable RLS and explicit grants on every exposed table. Authorize with `auth.uid()` plus active membership, never `user_metadata` or provider email.
- Revoke `PUBLIC`, `anon`, and `authenticated` execute on the privileged claim finalizer; only `service_role` may invoke it.
- Keep full 1Hz profiles out of list rows. Store them as immutable private Storage objects and verify SHA-256, byte count, and sample count before publication.
- Preserve guest metadata and profile files until remote commit and account-local copy verification both succeed.
- Treat a claim as one snapshot containing Logbook and Planbook. Process plans before logs so `convertedLogLocalId` can be validated and converted.
- Define progress total as log count + plan count. A profile is part of its log step, not a separate progress item.
- Increment completed progress only after one staging record and its optional profile have been uploaded and read-back verified.
- Do not let Watch `session.syncStatus: synced` depend on Supabase. It remains an iPhone local-import acknowledgement.
- Use existing semantic color tokens and UI primitives. Do not add a UI, icon, animation, or font dependency.
- Add `@noble/hashes@1.8.0` as a direct mobile dependency for deterministic cross-platform SHA-256; this exact artifact already exists in `yarn.lock`. Do not hand-roll a digest or depend on React Native Web Crypto availability.
- Use a native `formSheet`, existing `Progress`, `ArrowUpIcon`, system typography, tabular numerals, Dynamic Type, dark mode, and Reduce Motion.
- Do not add safety-critical calculations or imply certified dive-computer, medical, decompression, ascent-permission, or emergency behavior.
- At every task, write a failing test first, run it to confirm the intended failure, implement the smallest passing behavior, rerun the focused gate, and commit only that task's files.
- If the same gate fails three times for the same root cause, stop and report the command, error, attempted fixes, dependency, and safest human action.

---

## File Map

### Supabase boundary

- `supabase/migrations/<generated>_create_account_data_and_guest_claim.sql`: account tables, claim staging tables, private bucket, grants, RLS, indexes.
- `supabase/migrations/<generated>_add_guest_claim_finalizer.sql`: service-role-only atomic publication function.
- `supabase/tests/database/guest_data_claim.test.sql`: pgTAP contract, RLS, privileges, relation checks, atomic publication.
- `supabase/tests/rest/guest-data-claim.mjs`: two-user Data API and Storage smoke test.
- `supabase/functions/finalize-guest-claim/index.ts`: JWT validation, server profile verification, finalizer invocation.
- `supabase/functions/finalize-guest-claim/profile-verifier.ts`: deterministic SHA-256/JSON/sample verification.
- `supabase/tests/functions/finalize-guest-claim.mjs`: local function integration harness.

### Typed package boundary

- `packages/supabase/src/account-data-types.ts`: remote DTO, cursor, mutation, claim input/result types.
- `packages/supabase/src/account-data-repository.ts`: paginated owner data reads and revision-aware mutations.
- `packages/supabase/src/guest-claim-repository.ts`: create/load batch, stage item, profile upload/read-back, finalize, committed read.
- `packages/supabase/src/account-data-mappers.ts`: generated-row/domain-DTO conversion without React Native dependencies.
- `packages/supabase/src/*.test.ts`: package mapping, cursor, errors, idempotency tests.

### Mobile data boundary

- `apps/mobile/src/storage/data-principal.ts`: `guest` and `user:<uuid>` identity and storage-key generation.
- `apps/mobile/src/storage/migrate-legacy-guest-data.ts`: one-time copy/verify/switch migration.
- `apps/mobile/src/repositories/principal-repositories.ts`: principal-specific repository factory and visible guest/account composition.
- `apps/mobile/src/sync/account-outbox.ts`: persistent account mutation queue.
- `apps/mobile/src/sync/account-sync-coordinator.ts`: bounded drain, retry, remote hydration, revision conflict.
- `apps/mobile/src/claim/guest-claim-types.ts`: manifest, progress, error, state types.
- `apps/mobile/src/claim/guest-claim-store.ts`: manifest persistence per user.
- `apps/mobile/src/claim/guest-claim-service.ts`: snapshot, plan-first upload, resume, finalization, cleanup.
- `apps/mobile/src/states/account-data.tsx`: Auth-to-principal transition, repositories, sync, claim state/context.

### Mobile presentation boundary

- `apps/mobile/src/screens/account-claim/screen.tsx`: state-driven sheet content.
- `apps/mobile/src/screens/account-claim/depth-trace-progress.tsx`: determinate progress signature and accessibility.
- `apps/mobile/src/components/navigation/index.tsx`: claim route, automatic presentation, non-dismissable running state.
- `apps/mobile/src/screens/logbook/screen.tsx`: `기기 저장` source label.
- `apps/mobile/src/screens/planning/screen.tsx`: `기기 저장` source label.
- `apps/mobile/src/screens/settings/screen.tsx`: eligible-count retry row.
- `apps/mobile/src/i18n/resources.ts`: concise Korean/English claim copy.

---

### Task 1: Create the isolated worktree and record the baseline

**Files:**
- Review: `git status --short`
- Review: `package.json`
- Review: `supabase/config.toml`
- Review: `apps/mobile/package.json`
- Review: `docs/superpowers/specs/2026-07-19-guest-data-account-claim-design.md`

**Interfaces:**
- Consumes: clean `main` commit plus the approved design and this plan.
- Produces: isolated `feat/guest-data-account-claim` checkout with no inherited working-tree edits.

- [ ] **Step 1: Create the feature worktree**

Run the `using-git-worktrees` skill. Use the repository's existing worktree convention when present; otherwise run from the repository root:

```bash
git worktree add .worktrees/guest-data-account-claim -b feat/guest-data-account-claim main
```

Expected: Git reports a new branch checked out at `.worktrees/guest-data-account-claim`.

- [ ] **Step 2: Verify isolation and versions**

Run inside the worktree:

```bash
git status --short
yarn supabase --version
yarn workspace @repo/mobile typecheck
yarn workspace @repo/supabase test
```

Expected: empty Git status, Supabase CLI `2.109.1`, mobile typecheck exit 0, current package tests exit 0.

- [ ] **Step 3: Commit the approved planning artifacts if they are not already on the branch**

```bash
git add PLANS.md docs/superpowers/specs/2026-07-19-guest-data-account-claim-design.md docs/superpowers/plans/2026-07-19-guest-data-account-claim.md
git commit -m "docs: plan guest data account claim"
```

Expected: one documentation-only commit; no cache, Xcode project, or unrelated device-checklist file is staged.

### Task 2: Add account data, claim staging, Storage, grants, and RLS

**Files:**
- Create: `supabase/migrations/<generated>_create_account_data_and_guest_claim.sql`
- Create: `supabase/tests/database/guest_data_claim.test.sql`
- Create: `supabase/tests/rest/guest-data-claim.mjs`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: existing `public.app_memberships` and Auth session ownership.
- Produces: `dive_logs`, `dive_plans`, `guest_claim_batches`, `guest_claim_records`, private `dive-profiles`, explicit owner policies, and indexes.

- [ ] **Step 1: Create the migration through the CLI**

```bash
yarn supabase:local migration new create_account_data_and_guest_claim
```

Expected: one timestamped SQL file appears in `supabase/migrations/`. Use that generated path for every later command and commit.

- [ ] **Step 2: Write failing pgTAP contract tests**

Create tests that assert exact relations, constraints, grants, policies, and indexes. The core fixture and assertions must include:

```sql
begin;
select plan(26);

select has_table('public', 'dive_logs');
select has_table('public', 'dive_plans');
select has_table('public', 'guest_claim_batches');
select has_table('public', 'guest_claim_records');
select has_column('public', 'dive_logs', 'profile_sha256');
select has_column('public', 'dive_plans', 'converted_log_id');
select col_is_unique('public', 'dive_logs', array['user_id', 'local_id']);
select col_is_unique('public', 'dive_plans', array['user_id', 'local_id']);
select col_is_unique('public', 'guest_claim_records', array['batch_id', 'entity_kind', 'client_record_id']);
select policies_are('public', 'dive_logs', array['dive_logs_owner_select', 'dive_logs_owner_insert', 'dive_logs_owner_update']);
select policies_are('public', 'dive_plans', array['dive_plans_owner_select', 'dive_plans_owner_insert', 'dive_plans_owner_update']);
select policies_are('public', 'guest_claim_batches', array['guest_claim_batches_owner_select', 'guest_claim_batches_owner_insert']);
select policies_are('public', 'guest_claim_records', array['guest_claim_records_owner_select', 'guest_claim_records_owner_insert', 'guest_claim_records_owner_update']);
select isnt_empty($$select 1 from storage.buckets where id = 'dive-profiles' and public = false$$);

select * from finish();
rollback;
```

Add behavioral assertions under authenticated JWT claims for owner success, cross-owner empty reads, pre-onboarding denial, no hard delete grant, immutable object overwrite denial, and staging rows absent from `dive_logs`/`dive_plans`.

- [ ] **Step 3: Run the database test to verify RED**

```bash
yarn supabase:reset
yarn supabase:test:db
```

Expected: reset succeeds, then the new suite fails because the four relations and bucket do not exist.

- [ ] **Step 4: Implement the schema and indexes**

Use these exact ownership and record keys; retain domain payloads in versioned JSONB and duplicate only list/sort fields into typed columns:

```sql
create table public.dive_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(local_id) between 1 and 256),
  status text not null check (status in ('draft', 'planned', 'completed')),
  planned_at timestamptz,
  dive_mode text check (dive_mode is null or dive_mode in ('scuba', 'freedive')),
  site_name text,
  plan_data jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  converted_log_id uuid,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  deleted_at timestamptz,
  unique (user_id, local_id),
  unique (user_id, id)
);

create table public.dive_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(local_id) between 1 and 256),
  source_plan_id uuid,
  dive_mode text check (dive_mode is null or dive_mode in ('scuba', 'freedive')),
  source text not null check (source in ('manual', 'watch')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds double precision,
  max_depth_meters double precision,
  site_name text,
  title text,
  rating integer check (rating is null or rating between 1 and 5),
  manual_data jsonb not null,
  mobile_data jsonb not null,
  watch_metadata jsonb,
  provenance jsonb not null,
  profile_preview jsonb,
  profile_path text,
  profile_content_revision text,
  profile_sha256 text check (profile_sha256 is null or profile_sha256 ~ '^[0-9a-f]{64}$'),
  profile_byte_count bigint check (profile_byte_count is null or profile_byte_count >= 0),
  profile_sample_count integer check (profile_sample_count is null or profile_sample_count >= 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  deleted_at timestamptz,
  unique (user_id, local_id),
  unique (user_id, id),
  foreign key (user_id, source_plan_id) references public.dive_plans(user_id, id)
);

alter table public.dive_plans
  add constraint dive_plans_converted_log_owner_fk
  foreign key (user_id, converted_log_id) references public.dive_logs(user_id, id)
  deferrable initially deferred;

create table public.guest_claim_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_batch_id text not null check (length(client_batch_id) between 1 and 256),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expected_plan_count integer not null check (expected_plan_count >= 0),
  expected_log_count integer not null check (expected_log_count >= 0),
  status text not null default 'uploading' check (status in ('uploading', 'committed')),
  created_at timestamptz not null default transaction_timestamp(),
  committed_at timestamptz,
  unique (user_id, client_batch_id),
  unique (id, user_id)
);

create table public.guest_claim_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null,
  entity_kind text not null check (entity_kind in ('plan', 'log')),
  client_record_id text not null check (length(client_record_id) between 1 and 256),
  target_record_id uuid not null default gen_random_uuid(),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  source_plan_client_record_id text,
  converted_log_client_record_id text,
  profile_path text,
  profile_content_revision text,
  profile_sha256 text check (profile_sha256 is null or profile_sha256 ~ '^[0-9a-f]{64}$'),
  profile_byte_count bigint check (profile_byte_count is null or profile_byte_count >= 0),
  profile_sample_count integer check (profile_sample_count is null or profile_sample_count >= 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  foreign key (batch_id, user_id) references public.guest_claim_batches(id, user_id) on delete cascade,
  unique (batch_id, entity_kind, client_record_id)
);

create index dive_logs_owner_cursor_idx on public.dive_logs(user_id, started_at desc, id desc) where deleted_at is null;
create index dive_plans_owner_cursor_idx on public.dive_plans(user_id, planned_at desc nulls last, id desc) where deleted_at is null;
create index guest_claim_records_batch_idx on public.guest_claim_records(batch_id, entity_kind, client_record_id);
```

Add `alter table ... enable row level security`, explicit schema/table/sequence grants, membership-aware owner policies, `USING` plus `WITH CHECK` on updates, and no client `DELETE` grants. Insert private bucket `dive-profiles`; Storage paths must start with `<auth.uid()>/claims/` for claim artifacts or `<auth.uid()>/logs/` for normal account writes. Insert/select policies compare `(storage.foldername(name))[1]` to `auth.uid()::text`; do not create an update policy, which makes objects immutable.

- [ ] **Step 5: Write and run the two-user REST/Storage smoke test**

The harness must create two disposable verified users with the local admin key, complete onboarding for both, insert one owner row each, assert cross-user reads return an empty list, assert anonymous and pre-onboarding requests return `401`/`403`, upload one profile per owner, reject overwrite, and delete users in `finally`. It must never print credentials or JWTs.

```bash
node supabase/tests/rest/guest-data-claim.mjs
```

Expected: exit 0 with named checks for owner rows, cross-owner isolation, staging isolation, private objects, and immutable overwrite.

- [ ] **Step 6: Run schema gates and commit**

```bash
yarn supabase:reset
yarn supabase:test:db
yarn supabase:lint:db
yarn supabase:advisors
node supabase/tests/rest/guest-data-claim.mjs
git add supabase/config.toml supabase/migrations supabase/tests/database/guest_data_claim.test.sql supabase/tests/rest/guest-data-claim.mjs
git commit -m "feat: add account data and claim staging schema"
```

Expected: every command exits 0; commit contains only schema and its tests.

### Task 3: Add the server-verified atomic claim finalizer

**Files:**
- Create: `supabase/migrations/<generated>_add_guest_claim_finalizer.sql`
- Create: `supabase/functions/finalize-guest-claim/index.ts`
- Create: `supabase/functions/finalize-guest-claim/profile-verifier.ts`
- Create: `supabase/tests/functions/finalize-guest-claim.mjs`
- Modify: `supabase/tests/database/guest_data_claim.test.sql`

**Interfaces:**
- Consumes: authenticated caller JWT, owned uploading batch, staged records, private profile objects.
- Produces: `POST /functions/v1/finalize-guest-claim` returning `{ batchId, status: 'committed', planCount, logCount }` or a sanitized typed error.

- [ ] **Step 1: Add failing finalizer privilege and atomicity tests**

Extend pgTAP and the function harness to assert:

```sql
select function_privs_are(
  'public',
  'finalize_guest_claim',
  array['uuid', 'uuid', 'jsonb'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'finalize_guest_claim',
  array['uuid', 'uuid', 'jsonb'],
  'authenticated',
  array[]::text[]
);
```

The integration test must cover invalid JWT, cross-owner batch, missing profile, digest mismatch, relationship mismatch, count mismatch, successful publication, repeated finalization returning the same result, and zero visible final rows before success.

- [ ] **Step 2: Run tests to verify RED**

```bash
yarn supabase:test:db
node supabase/tests/functions/finalize-guest-claim.mjs
```

Expected: database test reports missing function and function harness reports `404` because the function is not served/deployed.

- [ ] **Step 3: Implement the pure profile verifier**

Use one verifier shared by the Edge Function path:

```ts
export type ExpectedProfile = {
  sha256: string;
  byteCount: number;
  sampleCount: number;
};

export async function verifyProfileBytes(bytes: Uint8Array, expected: ExpectedProfile): Promise<void> {
  if (bytes.byteLength !== expected.byteCount) {
    throw new Error('profile_byte_count_mismatch');
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actualSha256 !== expected.sha256) {
    throw new Error('profile_digest_mismatch');
  }

  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(parsed) || parsed.length !== expected.sampleCount) {
    throw new Error('profile_sample_count_mismatch');
  }
}
```

- [ ] **Step 4: Implement the Edge Function authorization and verification flow**

The handler must read `Authorization: Bearer`, call a publishable-key client `auth.getUser(jwt)` for caller identity, use a service-role client only after caller verification, fetch the caller-owned batch/records, download and verify every declared profile, then invoke the finalizer with an array of verified record IDs and digests. Map known failures to stable codes and never return raw database or Storage messages.

```ts
type FinalizeRequest = { batchId: string };
type FinalizeResponse = {
  batchId: string;
  status: 'committed';
  planCount: number;
  logCount: number;
};

const knownStatus: Record<string, number> = {
  invalid_token: 401,
  batch_not_found: 404,
  profile_missing: 409,
  profile_digest_mismatch: 409,
  profile_byte_count_mismatch: 409,
  profile_sample_count_mismatch: 409,
  claim_validation_failed: 409,
};
```

Return JSON with `Cache-Control: no-store`. The body for failure is `{ code: keyof typeof knownStatus }` only.

- [ ] **Step 5: Implement the service-role-only transaction**

Create the migration with the CLI, then implement `public.finalize_guest_claim(p_user_id uuid, p_batch_id uuid, p_verified_profiles jsonb) returns jsonb`. It must use `security definer set search_path = ''`, lock the batch `for update`, return the committed counts for a repeated call, reject owner/count/digest/profile/relationship mismatches, insert plans first, insert logs second, update deferred plan-to-log foreign keys, set the batch committed, and return counts. Use `(user_id, local_id)` conflicts only when existing payload digest matches; otherwise raise SQLSTATE `23505` with a generic message.

```sql
revoke all on function public.finalize_guest_claim(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_guest_claim(uuid, uuid, jsonb) to service_role;
```

- [ ] **Step 6: Run local function and database gates**

Start Supabase, serve `finalize-guest-claim` in a dedicated terminal/session, then run:

```bash
yarn supabase:reset
yarn supabase:test:db
node supabase/tests/functions/finalize-guest-claim.mjs
yarn supabase:lint:db
yarn supabase:advisors
```

Expected: every gate exits 0; repeated finalization does not create duplicate rows and failed batches expose zero account rows.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/functions/finalize-guest-claim supabase/tests/database/guest_data_claim.test.sql supabase/tests/functions/finalize-guest-claim.mjs
git commit -m "feat: verify and finalize guest claims atomically"
```

### Task 4: Build typed account-data and claim repositories

**Files:**
- Create: `packages/supabase/src/account-data-types.ts`
- Create: `packages/supabase/src/account-data-mappers.ts`
- Create: `packages/supabase/src/account-data-repository.ts`
- Create: `packages/supabase/src/guest-claim-repository.ts`
- Create: `packages/supabase/src/account-data-repository.test.ts`
- Create: `packages/supabase/src/guest-claim-repository.test.ts`
- Modify: `packages/supabase/src/index.ts`
- Modify: `packages/supabase/package.json`
- Generate: `packages/supabase/src/database.types.ts`

**Interfaces:**
- Consumes: generated `Database`, `SupabaseClient<Database>`, remote schema and Edge Function.
- Produces: provider-independent pagination/mutation APIs and `GuestClaimRemoteRepository` for mobile.

- [ ] **Step 1: Define failing repository tests and public interfaces**

Use mocked Supabase query builders and assert keyset tuples, no profile download in list, expected-revision filters, staging idempotency, read-back verification, and sanitized errors. Define these exact public types:

```ts
export type AccountDataCursor = { sortTime: string; id: string };
export type AccountDataPage<T> = { items: T[]; nextCursor?: AccountDataCursor };
export type RemoteDivePlan = { id: string; localId: string; revision: number; payloadSha256: string; payload: Record<string, unknown> };
export type RemoteDiveLog = { id: string; localId: string; revision: number; payloadSha256: string; payload: Record<string, unknown>; profilePath?: string };
export type AccountMutationResult<T> =
  | { status: 'saved'; value: T }
  | { status: 'conflict'; remote: T };

export type AccountDataRepository = {
  listLogs(input?: { cursor?: AccountDataCursor; limit?: number }): Promise<AccountDataPage<RemoteDiveLog>>;
  listPlans(input?: { cursor?: AccountDataCursor; limit?: number }): Promise<AccountDataPage<RemoteDivePlan>>;
  saveLog(value: RemoteDiveLog, expectedRevision?: number): Promise<AccountMutationResult<RemoteDiveLog>>;
  savePlan(value: RemoteDivePlan, expectedRevision?: number): Promise<AccountMutationResult<RemoteDivePlan>>;
  deleteLog(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDiveLog>>;
  deletePlan(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDivePlan>>;
};

export type GuestClaimBatchInput = {
  clientBatchId: string;
  manifestSha256: string;
  expectedPlanCount: number;
  expectedLogCount: number;
};

export type GuestClaimStageInput = {
  batchId: string;
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  payloadSha256: string;
  payload: Record<string, unknown>;
  sourcePlanClientRecordId?: string;
  convertedLogClientRecordId?: string;
};

export type GuestClaimRemoteRepository = {
  createOrLoadBatch(input: GuestClaimBatchInput): Promise<{ id: string; status: 'uploading' | 'committed' }>;
  stageRecord(input: GuestClaimStageInput): Promise<{ stagingRecordId: string; targetRecordId: string }>;
  attachProfile(input: { stagingRecordId: string; path: string; contentRevision: string; sha256: string; byteCount: number; sampleCount: number }): Promise<void>;
  uploadProfile(path: string, bytes: Uint8Array): Promise<void>;
  downloadProfile(path: string): Promise<Uint8Array>;
  finalize(batchId: string): Promise<{ status: 'committed'; planCount: number; logCount: number }>;
  listCommittedBatch(batchId: string): Promise<{ plans: RemoteDivePlan[]; logs: RemoteDiveLog[] }>;
};
```

- [ ] **Step 2: Run tests to verify RED**

```bash
yarn workspace @repo/supabase test
```

Expected: TypeScript module-not-found failures for the four new files.

- [ ] **Step 3: Generate types and implement mappers**

```bash
yarn generate:supabase
```

Map database timestamps to ISO strings in the package and leave mobile epoch conversion to mobile mappers. `profile_preview` must be bounded to 160 samples before insert; package list methods must not call Storage.

- [ ] **Step 4: Implement keyset reads and revision-aware mutations**

`listLogs({ cursor, limit: 30 })` orders `started_at desc, id desc`; `listPlans` orders `planned_at desc, id desc`. When a cursor exists, encode the strict tuple condition server-side through a typed RPC or an equivalent `.or()` expression that escapes values through the client API, never string concatenation from user input. Updates filter by owner implicit in RLS, `id`, and `revision`, then write `revision + 1`; zero returned rows trigger a remote fetch and `{ status: 'conflict' }`.

- [ ] **Step 5: Implement claim staging and profile read-back**

`createOrLoadBatch` gets the verified current user from the repository constructor, attempts one insert, and on uniqueness conflict selects the existing `(user_id, client_batch_id)` row and verifies its immutable digest/counts; it does not require a batch update policy. `stageRecord` upserts by `(batch_id, entity_kind, client_record_id)` and returns stable IDs. `uploadProfile` uses `upsert: false`; duplicate-object response is accepted only after `downloadProfile` byte equality/digest verification by the mobile caller. `finalize` invokes the Edge Function with `{ body: { batchId } }`.

- [ ] **Step 6: Run package gates and commit**

```bash
yarn workspace @repo/supabase test
yarn workspace @repo/supabase typecheck
yarn generate:supabase
git diff --exit-code packages/supabase/src/database.types.ts
git add packages/supabase
git commit -m "feat: add typed account data repositories"
```

Expected: package tests/typecheck pass and generated type rerun produces no diff.

### Task 5: Partition local data and migrate legacy guest records once

**Files:**
- Create: `apps/mobile/src/storage/data-principal.ts`
- Create: `apps/mobile/src/storage/migrate-legacy-guest-data.ts`
- Create: `apps/mobile/src/repositories/principal-repositories.ts`
- Create: `apps/mobile/__tests__/data-principal.test.ts`
- Create: `apps/mobile/__tests__/migrate-legacy-guest-data.test.ts`
- Create: `apps/mobile/__tests__/principal-repositories.test.ts`
- Modify: `apps/mobile/src/storage/storage-keys.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-plan-repository.ts`
- Modify: `apps/mobile/src/types/dive-plan.ts`

**Interfaces:**
- Consumes: current unscoped envelopes and profile references.
- Produces: principal-scoped repository factories and exactly-once verified migration to `guest`.

- [ ] **Step 1: Write failing key and migration tests**

Assert exact keys and no user-id collision:

```ts
expect(dataStorageKeys({ kind: 'guest' })).toEqual({
  logbook: 'dive-app:data:guest:logbook:v1',
  planbook: 'dive-app:data:guest:planbook:v1',
  outbox: 'dive-app:data:guest:outbox:v1',
  claim: 'dive-app:data:guest:claim:v1',
});
expect(dataStorageKeys({ kind: 'user', userId: 'user/one' }).logbook)
  .toBe('dive-app:data:user%3Auser%2Fone:logbook:v1');
```

Migration tests must cover: no legacy data, successful metadata/profile copy, crash after copy before marker, corrupt profile abort, existing guest target abort, marker idempotency, and no deletion before read-back equality.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
yarn workspace @repo/mobile test --runInBand data-principal migrate-legacy-guest-data principal-repositories
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement principal keys and repository options**

```ts
export type DataPrincipal =
  | { kind: 'guest' }
  | { kind: 'user'; userId: string };

export function principalScope(principal: DataPrincipal): string {
  return principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`;
}

export function dataStorageKeys(principal: DataPrincipal) {
  const encoded = encodeURIComponent(principalScope(principal));
  return {
    logbook: `dive-app:data:${encoded}:logbook:v1`,
    planbook: `dive-app:data:${encoded}:planbook:v1`,
    outbox: `dive-app:data:${encoded}:outbox:v1`,
    claim: `dive-app:data:${encoded}:claim:v1`,
  } as const;
}
```

Add explicit `storageKey` and `profileKeyPrefix` options to persistent repositories. Extend `DivePlan` with `remoteId?`, `ownerUserId?`, and `cloudSyncStatus` using the same status union as logs; add versioned envelope migration that initializes existing guest plans to `notConfigured`.

- [ ] **Step 4: Implement copy-verify-switch legacy migration**

Read legacy envelopes, validate through existing migration parsers, copy every referenced profile to a guest-prefixed key, read each copy back and deep-compare samples, rewrite guest profile references, write and read-back guest metadata, then write `dive-app:data:legacy-to-guest:v1 = complete`. Remove legacy metadata/profile keys only after the marker and verification. A rerun with a complete marker returns without writes.

- [ ] **Step 5: Implement principal repository composition**

```ts
export type PrincipalRepositories = {
  principal: DataPrincipal;
  queryScope: string;
  logbook: DiveLogRepository;
  planbook: DivePlanRepository;
};

export type PrincipalRepositoryDependencies = {
  metadataStorage: PersistentKeyValueStore;
  profileStorage: WatchProfileStorage;
  now?: () => number;
};

export function createPrincipalRepositories(
  principal: DataPrincipal,
  dependencies: PrincipalRepositoryDependencies,
): PrincipalRepositories;
```

For authenticated display with deferred guest data, expose a separate composition helper returning account rows first plus unclaimed guest rows annotated by `ownerUserId === undefined`; never mutate guest rows through the account repository.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

```bash
yarn workspace @repo/mobile test --runInBand data-principal migrate-legacy-guest-data principal-repositories persistent-dive-log-repository persistent-dive-plan-repository
yarn mobile:typecheck
git add apps/mobile/src/storage apps/mobile/src/repositories apps/mobile/src/types/dive-plan.ts apps/mobile/__tests__
git commit -m "feat: partition local dive data by principal"
```

### Task 6: Add the account outbox and principal-aware data provider

**Files:**
- Create: `apps/mobile/src/sync/account-outbox.ts`
- Create: `apps/mobile/src/sync/account-sync-coordinator.ts`
- Create: `apps/mobile/src/states/account-data.tsx`
- Create: `apps/mobile/__tests__/account-outbox.test.ts`
- Create: `apps/mobile/__tests__/account-sync-coordinator.test.ts`
- Create: `apps/mobile/__tests__/account-data-state.test.tsx`
- Modify: `apps/mobile/src/providers.tsx`
- Modify: `apps/mobile/src/states/use-dive-logbook.ts`
- Modify: `apps/mobile/src/states/use-dive-plans.ts`
- Modify: `apps/mobile/src/states/use-dive-logbook-queries.ts`
- Modify: `apps/mobile/src/states/use-dive-plan-queries.ts`

**Interfaces:**
- Consumes: Auth state, principal repositories, `AccountDataRepository`, QueryClient.
- Produces: account-local-first writes, persistent remote delivery, remote hydration, and no cross-principal cache visibility.

- [ ] **Step 1: Write failing outbox/state tests**

Define the queue item exactly:

```ts
export type AccountOutboxItem = {
  operationId: string;
  userId: string;
  entityKind: 'log' | 'plan';
  entityLocalId: string;
  mutation: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  expectedRevision?: number;
  profileStorageKey?: string;
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
};
```

Test local-save-before-network, duplicate operation id, exponential retry with deterministic injected jitter, foreground resume, conflict preservation, profile-before-metadata delivery, offline no-op, previous-user QueryClient removal, and Watch import acknowledgement before remote calls.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
yarn workspace @repo/mobile test --runInBand account-outbox account-sync-coordinator account-data-state
```

Expected: missing modules and context.

- [ ] **Step 3: Implement persistent outbox and bounded drain**

Use a single-flight drain per user and process at most 10 operations per pass. Retry delay is `min(300, 2 ** attemptCount) + jitterSeconds`, where injected jitter is in `[0, 1)`. Persist each successful dequeue before starting the next item. On revision mismatch, retain the local entity with `cloudSyncStatus: 'conflict'`, persist remote latest separately in the conflict record, and stop retrying that operation.

- [ ] **Step 4: Implement `AccountDataProvider`**

Mount it inside `AuthProvider` and before routed screens:

```tsx
<AuthProvider>
  <AccountDataProvider queryClient={queryClient}>
    <ThemedProviders>{props.children}</ThemedProviders>
  </AccountDataProvider>
</AuthProvider>
```

Map `guest` and Auth bootstrapping states to guest repositories; map `authenticated`/`authenticatedOffline` to `user:<uuid>`. Before changing context value, cancel and remove queries whose key contains the old principal scope. Disable cloud drain for `authenticatedOffline` while retaining local account data.

- [ ] **Step 5: Switch hooks to context repositories**

Keep explicit repository overrides for tests. When no override is supplied, `useDiveLogbook` and `useDivePlans` consume current context repositories and query scope. Account writes save locally, mark pending, enqueue, then invalidate current-principal queries. Guest writes stay local-only.

- [ ] **Step 6: Run state regression gates and commit**

```bash
yarn workspace @repo/mobile test --runInBand account-outbox account-sync-coordinator account-data-state use-dive-logbook use-dive-plans watch-connectivity-sync
yarn mobile:typecheck
git add apps/mobile/src/sync apps/mobile/src/states apps/mobile/src/providers.tsx apps/mobile/__tests__
git commit -m "feat: sync account data from a local outbox"
```

### Task 7: Implement the persistent resumable claim service

**Files:**
- Create: `apps/mobile/src/claim/guest-claim-types.ts`
- Create: `apps/mobile/src/claim/guest-claim-store.ts`
- Create: `apps/mobile/src/claim/guest-claim-service.ts`
- Create: `apps/mobile/src/claim/profile-bytes.ts`
- Create: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Create: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `yarn.lock`

**Interfaces:**
- Consumes: guest/account repositories, profile storage, `GuestClaimRemoteRepository`, current authenticated user.
- Produces: immutable manifest, exact progress snapshots, retry/defer/resume, atomic cleanup.

- [ ] **Step 1: Define failing manifest and orchestration tests**

Use these exact types:

```ts
export type GuestClaimItem = {
  key: string;
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  payloadSha256: string;
  sourcePlanClientRecordId?: string;
  convertedLogClientRecordId?: string;
  profile?: { storageKey: string; contentRevision: string; sha256: string; sampleCount: number };
  stagingRecordId?: string;
  targetRecordId?: string;
  completedAt?: number;
};

export type GuestClaimManifest = {
  schemaVersion: 1;
  userId: string;
  clientBatchId: string;
  remoteBatchId?: string;
  manifestSha256: string;
  status: 'prepared' | 'running' | 'finalizing' | 'committed' | 'cleanupPending' | 'deferred' | 'failed';
  planCount: number;
  logCount: number;
  items: GuestClaimItem[];
  createdAt: number;
  updatedAt: number;
};

export type GuestClaimProgress = {
  completed: number;
  total: number;
  currentLabel?: string;
  phase: 'uploading' | 'finalizing' | 'cleanup';
};

export type GuestClaimErrorCode =
  | 'network_unavailable'
  | 'session_expired'
  | 'profile_missing'
  | 'profile_corrupt'
  | 'relationship_invalid'
  | 'remote_conflict'
  | 'claim_validation_failed';

export type GuestClaimViewState =
  | { status: 'hidden' }
  | { status: 'choice'; logCount: number; planCount: number }
  | { status: 'running'; completed: number; total: number; currentLabel?: string }
  | { status: 'failed'; completed: number; total: number; errorCode: GuestClaimErrorCode }
  | { status: 'complete'; imported: number };
```

Tests must prove plan-first ordering, immutable snapshot, `3 / 32`, profile included in a log step, no increment before read-back digest, termination resume, same remote batch reuse, repeated stage idempotency, relation failure, second-user denial, defer preserving originals, finalizer-before-cleanup, cleanup retry, and guest rows hidden after commit even when physical cleanup initially fails.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
yarn workspace @repo/mobile test --runInBand guest-claim-store guest-claim-service
```

Expected: missing modules.

- [ ] **Step 3: Implement manifest snapshot and storage**

Add exact dependency `"@noble/hashes": "1.8.0"` to the mobile workspace. Normalize plans and logs through explicit mapper functions, encode exact JSON bytes once with `TextEncoder`, hash those bytes with `sha256` from `@noble/hashes/sha256`, and persist lowercase hexadecimal digest in each item. Sort plans by `localId`, then logs by `localId`; do not add records created after snapshot. Build `clientBatchId` as `claim:<createdAt>:<manifestSha256-prefix>` and scope the manifest storage key by user id.

- [ ] **Step 4: Implement item upload and progress persistence**

For each incomplete item: stage payload, persist returned IDs, serialize full profile samples to UTF-8 JSON when present, compute byte count/SHA-256/sample count, upload to `<user_id>/claims/<remote_batch_id>/<target_record_id>/<content_revision>.json`, download bytes, compare count and digest, attach profile metadata, set `completedAt`, persist the manifest, then emit progress. Never emit the increment before manifest persistence.

- [ ] **Step 5: Implement finalization and cleanup**

When every item is complete, persist `finalizing`, call remote finalize, fetch committed batch rows, map them into `user:<uuid>`, verify local ids/counts/relationships, persist `committed`, and only then remove the matching guest metadata/profile files. If cleanup fails, persist `cleanupPending`; presentation must hide manifest guest ids while retrying cleanup. `defer()` sets `deferred` and stops automatic work without deleting staging or guest data.

- [ ] **Step 6: Expose claim state from `AccountDataProvider`**

```ts
export type AccountClaimController = {
  eligible: { logCount: number; planCount: number };
  state: GuestClaimViewState;
  start(): Promise<void>;
  retry(): Promise<void>;
  keepOnDevice(): Promise<void>;
};
```

Automatic eligibility runs only after `authenticated`, migration hydration, and navigation readiness. An existing running/finalizing/cleanup manifest resumes on online foreground. `authenticatedOffline` can display retained guest/account rows but cannot start remote work.

- [ ] **Step 7: Run claim/state gates and commit**

```bash
yarn workspace @repo/mobile test --runInBand guest-claim-store guest-claim-service account-data-state
yarn mobile:typecheck
git add apps/mobile/package.json apps/mobile/src/claim apps/mobile/src/states/account-data.tsx apps/mobile/__tests__ yarn.lock
git commit -m "feat: add resumable guest data claims"
```

### Task 8: Build the Apple-style claim sheet and progress treatment

**Files:**
- Create: `apps/mobile/src/screens/account-claim/screen.tsx`
- Create: `apps/mobile/src/screens/account-claim/depth-trace-progress.tsx`
- Create: `apps/mobile/__tests__/account-claim-screen.test.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/navigation.test.tsx`
- Modify: `apps/mobile/__tests__/i18n.test.ts`

**Interfaces:**
- Consumes: `AccountClaimController` and `GuestClaimViewState`.
- Produces: native form-sheet choice/progress/failure flow with exact count and accessibility state.

- [ ] **Step 1: Write failing UI and navigation tests**

Cover Korean/English copy, `24 + 8 = 32`, exact `3 / 32`, progressbar values, no close control while running, blocked swipe/back only during running/finalizing/cleanup, retry/defer actions on failure, automatic route after login, no route at zero count, no duplicate navigation, and completion pop/invalidation.

```ts
expect(progress.props.accessibilityRole).toBe('progressbar');
expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 32, now: 3 });
expect(renderer.root.findByProps({ testID: 'account-claim-progress-count' }).props.children)
  .toEqual(['3', ' / ', '32']);
```

- [ ] **Step 2: Run focused tests to verify RED**

```bash
yarn workspace @repo/mobile test --runInBand account-claim-screen navigation i18n
```

Expected: missing account-claim route/components and translation keys.

- [ ] **Step 3: Implement concise localized copy**

Add these Korean keys and direct English equivalents:

```ts
accountClaim: {
  choiceTitle: '기기 데이터를 계정으로 가져올까요?',
  logCount: '다이빙 로그',
  planCount: '다이빙 계획',
  importAction: '계정으로 가져오기',
  keepAction: '기기에 유지',
  progressTitle: '계정으로 가져오는 중',
  progressCount: '{{completed}} / {{total}}',
  failureTitle: '가져오기를 완료하지 못했습니다',
  retryAction: '다시 시도',
  deviceBadge: '기기 저장',
  settingsAction: '기기 데이터 가져오기',
}
```

Do not add generic reassurance, cloud marketing, instructional paragraphs, or raw error details.

- [ ] **Step 4: Implement `DepthTraceProgress`**

Compose the existing `Progress` and `ProgressFilledTrack` with a 2px semantic track and a small current-position tick. Use `fontVariant: ['tabular-nums']` for the count, clamp percentage to `0...100`, and set progress accessibility values. Subscribe to React Native `AccessibilityInfo`'s `reduceMotionChanged` event and initialize with `isReduceMotionEnabled()`; when it is active, update without transition.

```tsx
<Progress
  testID="account-claim-progress"
  value={percent}
  accessibilityRole="progressbar"
  accessibilityValue={{ min: 0, max: total, now: completed }}
  className="h-0.5 rounded-full bg-primary/20">
  <ProgressFilledTrack className="bg-primary" />
</Progress>
```

- [ ] **Step 5: Implement the state-driven sheet**

Use one `SafeAreaView` and an unframed `VStack`; no card inside the sheet. Choice shows an `ArrowUpIcon` in a quiet primary-tinted circle, title, two count rows, primary button, and text-style secondary action. Running shows title, current label when available, count, and progress only. Failure shows title, retained count/progress, retry primary, and keep-on-device secondary. Completion announces success and closes without stacking a toast or alert.

- [ ] **Step 6: Integrate the navigation route**

Add `accountClaim: undefined` to `RootStackParamList` and configure:

```ts
{
  presentation: 'formSheet',
  sheetAllowedDetents: AUTH_LOGIN_SHEET_ALLOWED_DETENTS,
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
}
```

Use `usePreventRemove` only for running/finalizing/cleanup. After onboarding finishes, route to the claim sheet if eligible; otherwise return to tabs. Guard route dispatch with current route and current user id to prevent duplicates.

- [ ] **Step 7: Run UI gates and commit**

```bash
yarn workspace @repo/mobile test --runInBand account-claim-screen navigation i18n
yarn mobile:typecheck
git add apps/mobile/src/screens/account-claim apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__
git commit -m "feat: show guest claim progress in a native sheet"
```

### Task 9: Label retained device data and add Settings retry

**Files:**
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/__tests__/logbook-screen.test.tsx`
- Modify: `apps/mobile/__tests__/planning-screen.test.tsx`
- Modify: `apps/mobile/__tests__/settings-screen.test.tsx`

**Interfaces:**
- Consumes: visible composed records and `AccountClaimController.eligible`.
- Produces: source clarity for deferred guest records and an explicit retry entry point.

- [ ] **Step 1: Write failing presentation tests**

Assert that `ownerUserId === undefined` while authenticated renders `기기 저장`, account and guest records with the same `localId` render only the account copy, guest mode renders no badge, Settings row appears only when authenticated with eligible count > 0, and pressing it opens the existing claim route.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
yarn workspace @repo/mobile test --runInBand logbook-screen planning-screen settings-screen
```

Expected: badge and Settings row assertions fail.

- [ ] **Step 3: Add compact source labels**

Place a small semantic-muted text label beside existing row metadata, not as a large pill or new card. Keep the row's fixed tracks and wrapping so Korean/English text at 200% Dynamic Type does not overlap the title/date. The label must have an accessibility label that says the record is stored on this device.

- [ ] **Step 4: Add the Settings action**

Under the account section, add one `SettingRow` using the existing `ArrowUpIcon`, label `기기 데이터 가져오기`, and value `{{count}}`. Do not add an explanatory paragraph. Hide the row for guest, zero eligible count, active running claim, and a different user's deferred manifest.

- [ ] **Step 5: Run presentation gates and commit**

```bash
yarn workspace @repo/mobile test --runInBand logbook-screen planning-screen settings-screen navigation
yarn mobile:typecheck
git add apps/mobile/src/screens apps/mobile/src/components/navigation/index.tsx apps/mobile/__tests__
git commit -m "feat: identify and retry device-only dive data"
```

### Task 10: Verify local behavior, promote to staging, review visuals, and update durable docs

**Files:**
- Modify: `README.md`
- Modify: `apps/mobile/AGENTS.md`
- Modify: the existing Wave 3 raw source selected by `karpathy-llm-wiki`
- Modify: `.wiki/wiki/architecture/supabase.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/domains/dive-log.md`
- Modify: `.wiki/wiki/questions/open-questions.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`
- Create: `docs/2026-07-19-guest-data-account-claim-device-checklist.md`
- Create: `supabase/scripts/verify-staging-guest-claim.mjs`

**Interfaces:**
- Consumes: completed local implementation and all automated gates.
- Produces: staging schema/function deployment, physical/manual evidence, current architecture documentation, reviewed merge candidate.

- [ ] **Step 1: Run complete local automated gates**

```bash
yarn supabase:reset
yarn supabase:test:db
yarn supabase:lint:db
yarn supabase:advisors
node supabase/tests/rest/guest-data-claim.mjs
node supabase/tests/functions/finalize-guest-claim.mjs
yarn workspace @repo/supabase test
yarn workspace @repo/supabase typecheck
yarn workspace @repo/mobile test --runInBand
yarn mobile:typecheck
yarn ios:build
yarn watch:build
yarn codex:check
git diff --check
```

Expected: all commands exit 0. Environment-only simulator/cache warnings are recorded but not treated as failures when commands exit 0.

- [ ] **Step 2: Run staging dry-run and deploy**

```bash
yarn supabase:staging:link
yarn supabase:staging:migrations
yarn supabase:staging:push:dry-run
yarn supabase:staging:push
yarn supabase functions deploy finalize-guest-claim --project-ref mclvhwzsuvsxjerdouka
```

Expected: dry-run lists only the two new migrations; push applies them once; function deploy succeeds. Do not continue if dry-run includes an unexpected migration or destructive statement.

- [ ] **Step 3: Verify staging isolation and claim behavior**

The staging verifier uses two disposable users and cleans them in `finally`. Verify active membership, owner rows, cross-owner denial, private object denial, invalid finalizer JWT, one complete claim, repeated finalization, and no partial rows. Run:

```bash
yarn supabase:staging:verify:auth
node supabase/scripts/verify-staging-guest-claim.mjs
```

Expected: both exit 0 without printing JWTs, email addresses, or object payloads.

- [ ] **Step 4: Perform iPhone and Android visual/manual matrix**

On iPhone, use the verified Apple login and test 24 logs + 8 plans through choice, `3 / 32`, background/foreground, force-quit/resume, offline retry, corrupt profile failure, keep-on-device badge, Settings retry, completion cleanup, logout/login, and second-account isolation. On Android, use a valid staging session/development Auth path and inspect the same claim states. Capture screenshots at 320pt-equivalent and a large phone width in light/dark mode and Dynamic Type/default/font scale 2.0. Confirm no overlap, clipping, nested cards, duplicate sheet, or dismiss during active work.

- [ ] **Step 5: Run Watch regression**

Import a Watch session while guest and while authenticated. Confirm Watch reaches `synced` immediately after iPhone local save even with Supabase offline, then confirm account outbox/claim retries independently.

- [ ] **Step 6: Update durable project knowledge**

Use `karpathy-llm-wiki` with `wiki-writing`. Record implemented facts, schema/RLS/storage/finalizer ownership, progress semantics, claim resume/cleanup behavior, staging evidence, and remaining Google physical-login gate. Replace stale statements that remote Logbook/Planbook and claim do not exist; do not claim production deployment or unexecuted physical checks.

- [ ] **Step 7: Request code review and fix findings**

Use `requesting-code-review`. Review security first, then data-loss paths, principal cache isolation, idempotency, accessibility, and visual layout. Address every accepted finding with a focused regression test and commit.

- [ ] **Step 8: Run final verification and merge through the branch-finishing workflow**

```bash
git status --short
git diff main...HEAD --stat
git log --oneline main..HEAD
git diff --check main...HEAD
```

Use `verification-before-completion`, then `finishing-a-development-branch`. Merge only after the full gate and staging/manual evidence required by the user are recorded. Preserve unrelated dirty files in the original main checkout; never stage or revert them.

Expected: feature branch contains only planned code/tests/docs, all gates pass, and merge to `main` is a clean fast-forward or reviewed non-conflicting merge.

---

## Final Acceptance Checklist

- [ ] Login completion shows one claim sheet only when unclaimed guest data exists.
- [ ] Choice counts Logbook and Planbook accurately and offers import or keep-on-device.
- [ ] Active import displays exact `completed / total`, including `3 / 32`, with a determinate accessibility progressbar.
- [ ] Progress never increments before metadata/profile remote write and read-back verification.
- [ ] Plans and logs retain their conversion relationship after claim.
- [ ] Partial or failed claim rows never appear in normal account queries.
- [ ] Process termination, offline transition, retry, and repeated finalization do not duplicate or delete data.
- [ ] `기기에 유지` preserves and visibly labels guest records while the user remains signed in.
- [ ] Settings exposes retry while eligible device data remains.
- [ ] Guest originals are removed only after remote commit and verified account-local copy.
- [ ] Cross-user database rows, staging rows, Storage objects, local partitions, manifests, and query caches remain isolated.
- [ ] Watch local acknowledgement remains independent from cloud operations.
- [ ] Light/dark, iPhone/Android, 320pt width, Dynamic Type/font scale 2.0, and Reduce Motion states are visually sound.
- [ ] Local Supabase, package, mobile, iOS, watch, staging, review, and diff gates pass before merge.
