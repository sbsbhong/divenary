# Staging Auth and Local Development Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `divenary-staging` the real social-Auth integration environment while adding a release-isolated local Supabase password login for deterministic authenticated app development.

**Architecture:** The shared Supabase repository performs both social ID-token and password exchanges, but the mobile composition root exposes password login only from a validated local env in `__DEV__`. A fixture script creates a real local Auth user and writes ignored credentials, while guarded staging scripts pin all remote operations to `mclvhwzsuvsxjerdouka`, deploy migrations without local seed, install staging-only legal rows, and verify the public contract.

**Tech Stack:** Yarn 1 workspaces, React Native 0.85.3, React 19, TypeScript 5.8, Jest, Node test runner, Supabase JS 2.110.2, Supabase CLI 2.109.1, PostgreSQL/RLS.

## Global Constraints

- Work only in `.worktrees/staging-auth-local-dev-login` until integration.
- Never commit or log Supabase secret/service keys, database passwords, sessions, provider secrets, or generated local passwords.
- Local password login must be absent unless `__DEV__`, a recognized local URL, and generated credentials all agree.
- Hosted staging migration must never include `supabase/seed.sql` because its legal URLs use `.invalid`.
- Staging operations must fail closed unless linked project ref is exactly `mclvhwzsuvsxjerdouka`.
- Keep guest Logbook/Planbook local-only with `cloudSyncStatus: notConfigured`.
- Add no remote Logbook sync, account claim, profile, deletion, or safety-critical behavior.
- Use explicit table/function grants because Supabase's 2026 Data API defaults no longer expose new public objects automatically.

---

### Task 1: Add a repository password exchange for local development

**Files:**
- Modify: `packages/supabase/src/auth-repository.ts`
- Modify: `packages/supabase/src/auth-repository.test.ts`
- Modify: `packages/supabase/src/index.ts`

**Interfaces:**
- Consumes: `SupabaseClient<Database>.auth.signInWithPassword({email, password})`.
- Produces: `PasswordSignInInput = {email: string; password: string}` and `AuthRepository.signInWithPassword(input): Promise<Session>`.

- [ ] **Step 1: Write failing repository tests**

  Extend the client mock with `calls.signInWithPassword` and cover success, missing session, Auth error, and transport error. Assert the public error remains `AuthRepositoryError` with `server`, `invalid-session`, or `network` and never includes credentials.

- [ ] **Step 2: Verify RED**

  Run: `yarn workspace @repo/supabase test`

  Expected: FAIL because `AuthRepository.signInWithPassword` is absent.

- [ ] **Step 3: Implement the minimal repository method**

  Add the interface method and use the same `mapRepositoryError(error, 'sign-in', status)` path as social sign-in:

  ```ts
  async signInWithPassword(input) {
    const result = await client.auth.signInWithPassword(input);
    if (result.error) throw mapRepositoryError(result.error, 'sign-in', result.error.status);
    if (!result.data.session) throw new AuthRepositoryError('server');
    return result.data.session;
  }
  ```

- [ ] **Step 4: Verify GREEN**

  Run: `yarn workspace @repo/supabase test && yarn workspace @repo/supabase typecheck`

  Expected: all repository tests and typecheck PASS.

- [ ] **Step 5: Commit**

  Commit message: `feat(auth): support local password sessions`

---

### Task 2: Add local environment selection and development login UI

**Files:**
- Modify: `.gitignore`
- Modify: `apps/mobile/.env.development.example`
- Modify: `apps/mobile/babel.config.js`
- Modify: `apps/mobile/scripts/load-mobile-env.js`
- Modify: `apps/mobile/src/config/env.ts`
- Modify: `apps/mobile/src/auth/create-mobile-auth.ts`
- Modify: `apps/mobile/src/states/auth.tsx`
- Modify: `apps/mobile/src/screens/auth/login-screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/babel-env.test.ts`
- Modify: `apps/mobile/__tests__/supabase-env.test.ts`
- Modify: `apps/mobile/__tests__/auth-state.test.tsx`
- Modify: `apps/mobile/__tests__/auth-screens.test.tsx`

**Interfaces:**
- Consumes: `AuthRepository.signInWithPassword`, ignored `apps/mobile/.env.local`, and `MOBILE_ENVIRONMENT=local`.
- Produces: `LocalDevelopmentAuthEnvironment`, `MobileAuth.developmentSignIn?: () => Promise<Session>`, `AuthContextValue.isDevelopmentSignInAvailable`, and `AuthContextValue.signInForDevelopment()`.

- [ ] **Step 1: Write failing env and composition tests**

  Cover `.env.local` selection only for `MOBILE_ENVIRONMENT=local`, production file isolation, `SUPABASE_ANDROID_URL`, loopback-only local credentials, and social adapter omission when development sign-in is active.

- [ ] **Step 2: Write failing state and screen tests**

  Cover pending/completed/error development login, double-tap serialization, no recent-provider write, local button visibility/busy/error behavior, and absence without local credentials.

- [ ] **Step 3: Verify RED**

  Run: `yarn workspace @repo/mobile test babel-env.test.ts supabase-env.test.ts auth-state.test.tsx auth-screens.test.tsx --runInBand`

  Expected: FAIL because local env and development sign-in APIs are absent.

- [ ] **Step 4: Implement local env parsing and release isolation**

  Add inlined `SUPABASE_ANDROID_URL`, `LOCAL_AUTH_EMAIL`, and `LOCAL_AUTH_PASSWORD`. `parseLocalDevelopmentAuthEnvironment` returns credentials only when development is true and the effective URL host is `localhost`, `127.0.0.1`, or `10.0.2.2`; production always returns `undefined`.

- [ ] **Step 5: Implement the shared Auth state path**

  Generalize the serialized sign-in operation to `SocialProvider | 'development'`. Development calls the encapsulated password action and skips recent-provider persistence; all post-exchange validation and onboarding logic remains shared.

- [ ] **Step 6: Implement the local-only login control**

  Render one full-width `Button` labeled `로컬 테스트 계정` / `Local test account` only when `isDevelopmentSignInAvailable`. Use the same 44pt minimum, busy lock, generic error, and close prevention as social actions.

- [ ] **Step 7: Verify GREEN**

  Run: `yarn workspace @repo/mobile test babel-env.test.ts supabase-env.test.ts auth-state.test.tsx auth-screens.test.tsx --runInBand && yarn mobile:typecheck`

  Expected: selected suites and typecheck PASS.

- [ ] **Step 8: Commit**

  Commit message: `feat(mobile): add local development login`

---

### Task 3: Generate a real local Auth fixture and environment

**Files:**
- Create: `supabase/scripts/local-mobile-auth-fixture.mjs`
- Create: `supabase/scripts/prepare-local-mobile-auth.mjs`
- Create: `supabase/scripts/local-mobile-auth-fixture.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: local CLI status JSON, local Auth admin REST API, `get_onboarding_status()`.
- Produces: `prepareLocalMobileAuth(options): Promise<{email: string; envPath: string}>` and ignored `apps/mobile/.env.local`.

- [ ] **Step 1: Write failing fixture unit tests**

  Inject CLI status, fetch, randomness, and file writer. Assert delete/recreate, confirmed user creation, password grant, pending RPC with exactly terms/privacy, Android URL generation, atomic env write, and no secret logging.

- [ ] **Step 2: Verify RED**

  Run: `node --test supabase/scripts/local-mobile-auth-fixture.test.mjs`

  Expected: FAIL because the fixture module is absent.

- [ ] **Step 3: Implement fixture preparation**

  Use deterministic email `divenary-local@development.invalid`, a fresh 32-byte base64url password, local `SECRET_KEY` only in request headers, and a temporary file renamed to `apps/mobile/.env.local` after every remote assertion succeeds.

- [ ] **Step 4: Add ergonomic commands**

  Add:

  ```json
  "mobile:auth:local:prepare": "node supabase/scripts/prepare-local-mobile-auth.mjs",
  "mobile:start:local": "MOBILE_ENVIRONMENT=local yarn workspace @repo/mobile start",
  "mobile:ios:local": "MOBILE_ENVIRONMENT=local yarn workspace @repo/mobile ios",
  "mobile:android:local": "MOBILE_ENVIRONMENT=local yarn workspace @repo/mobile android"
  ```

- [ ] **Step 5: Verify against real local Supabase**

  Run: `yarn supabase:reset`, `yarn mobile:auth:local:prepare`, then a non-secret probe that signs in using the generated file and asserts `get_onboarding_status().isComplete === false` with two documents.

  Expected: all commands PASS and no credential appears in stdout.

- [ ] **Step 6: Commit**

  Commit message: `feat(dev): prepare local authenticated fixture`

---

### Task 4: Guard and promote the hosted staging Auth foundation

**Files:**
- Create: `docs/legal/staging/2026-07-18/terms.md`
- Create: `docs/legal/staging/2026-07-18/privacy.md`
- Create: `supabase/scripts/staging-project.mjs`
- Create: `supabase/scripts/run-staging-supabase.mjs`
- Create: `supabase/scripts/verify-staging-auth.mjs`
- Create: `supabase/scripts/staging-project.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Supabase CLI login, fixed project ref `mclvhwzsuvsxjerdouka`, public GitHub raw URLs, checked-in migration.
- Produces: guarded `supabase:staging:*` commands and exact hosted legal rows at version `2026-07-18-staging.1`, pinned to the promotion commit.

- [ ] **Step 1: Write failing staging guard tests**

  Cover removal of unrelated project-id variables, preservation of `SUPABASE_ACCESS_TOKEN`, mismatch refusal, legal URL/version validation, and sanitized verification output.

- [ ] **Step 2: Verify RED**

  Run: `node --test supabase/scripts/staging-project.test.mjs`

  Expected: FAIL because staging modules are absent.

- [ ] **Step 3: Add staging legal documents and SQL builder**

  Add versioned staging-only text. Implement `buildStagingLegalSql(commitSha)` after validating `/^[0-9a-f]{40}$/`; insert terms/privacy rows and current pointers with `ON CONFLICT` updates and HTTPS raw URLs pinned to that commit.

- [ ] **Step 4: Implement guarded staging commands**

  Add link, migration-list, dry-run, push, legal-seed, and verify scripts. Every linked command reads `supabase/.temp/project-ref` and rejects any ref other than `mclvhwzsuvsxjerdouka`.

- [ ] **Step 5: Verify locally without remote writes**

  Run: `node --test supabase/scripts/staging-project.test.mjs` and `yarn supabase:staging:migrations`.

  Expected: tests PASS and migration list shows local `20260713135707` with no remote match.

- [ ] **Step 6: Commit and publish legal document commit**

  Commit message: `feat(supabase): add guarded staging auth promotion`

  Push the feature branch so the commit-pinned HTTPS legal URLs are reachable before database seeding.

- [ ] **Step 7: Apply staging migration and legal rows**

  Run in order:

  ```bash
  yarn supabase:staging:push:dry-run
  yarn supabase:staging:push
  yarn supabase:staging:seed:auth
  yarn supabase:staging:verify:auth
  ```

  Expected: one migration applied; exact terms/privacy pointers available; onboarding RPC present; Google and Apple flags true.

---

### Task 5: Complete documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `.wiki/raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md`
- Modify: `.wiki/wiki/architecture/supabase.md`
- Modify: `.wiki/wiki/questions/open-questions.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`
- Modify: this plan checkbox state after each gate.

**Interfaces:**
- Consumes: completed local and hosted gates.
- Produces: exact day-to-day commands, staging status, and remaining signed-device social Auth gate.

- [ ] **Step 1: Document the workflows and evidence**

  Record local fixture commands, staging guard commands, exact applied migration/version, and that actual Google/Apple token exchange still requires signed-device user interaction.

- [ ] **Step 2: Run complete gates**

  Run:

  ```bash
  yarn workspace @repo/supabase test
  yarn workspace @repo/supabase typecheck
  node --test supabase/scripts/*.test.mjs
  yarn supabase:test:db
  node supabase/tests/rest/auth-foundation.mjs
  yarn workspace @repo/mobile test --runInBand
  yarn mobile:typecheck
  yarn supabase:staging:verify:auth
  git diff --check
  ```

  Expected: every command exits 0.

- [ ] **Step 3: Request final code review**

  Review security boundaries, release isolation, project-ref guards, secret handling, RLS/RPC correctness, and mobile Auth concurrency. Resolve all Critical and Important findings.

- [ ] **Step 4: Commit final documentation**

  Commit message: `docs: record staging and local auth workflow`
