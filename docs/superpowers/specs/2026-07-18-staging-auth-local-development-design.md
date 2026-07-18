# Staging Auth and Local Development Login Design

**Date:** 2026-07-18
**Status:** Approved for implementation

## Context

Divenary currently has one hosted Supabase project, already named `divenary-staging`, and a reproducible Docker-based local Supabase stack. The mobile development environment points at the hosted project, whose public Auth settings report Google and Apple enabled. The hosted project does not yet contain the checked-in Auth foundation migration, `current_legal_documents`, or `get_onboarding_status()`, so a social token exchange cannot become a stable authenticated app state.

Daily feature development must not depend on repeating Google or Apple consent flows. At the same time, authentication-required behavior must use a real Supabase session and JWT so RLS, RPC authorization, session restore, and mandatory consent remain testable. A fake React `authenticated` state is useful for unit tests but is insufficient as the manual integration path.

## Selected Approach

Use three explicit verification layers:

1. **Hosted staging:** real Google and Apple provider, callback, signing, first/repeat/cancel, and session restoration checks.
2. **Local Supabase:** real password session issued by local GoTrue for day-to-day app development, RLS, RPC, consent, and restart checks.
3. **Injected tests:** deterministic Auth state and UI tests that do not require Docker or external providers.

This keeps real provider integration honest while making ordinary authenticated feature work fast and reproducible.

## Environment Boundaries

- `apps/mobile/.env.development` remains an ignored developer-owned hosted staging configuration.
- `apps/mobile/.env.local` is generated, ignored, and selected only when `MOBILE_ENVIRONMENT=local`.
- Production Babel builds load neither development file.
- Local Auth credentials are generated per fixture preparation, never committed, and accepted only when `__DEV__` is true and the Supabase URL is a recognized loopback/emulator endpoint.
- iOS Simulator uses `http://127.0.0.1:54321`; Android Emulator uses `http://10.0.2.2:54321`.
- A local development login control is absent from staging and production builds. In local mode, social provider buttons are omitted so a local Apple or Google token is not sent to a GoTrue instance whose social providers are intentionally disabled.

## Local Fixture Flow

`supabase/scripts/prepare-local-mobile-auth.mjs` will:

1. Read the running local stack through the repository's isolated Supabase CLI wrapper.
2. Remove a previous deterministic local test user if present.
3. Create a verified password user through the local Auth admin API with a fresh random password.
4. Sign in through local Auth and verify that `get_onboarding_status()` returns the two required documents and an incomplete membership.
5. Write only local URL, publishable key, Android emulator URL, and generated credentials to `apps/mobile/.env.local`.

The first manual login reaches mandatory consent. Completing consent naturally turns the same fixture into an authenticated account. Re-running preparation resets it to the pending state through the existing Auth cascade.

## Mobile Auth Changes

- The provider-independent Supabase repository gains a password sign-in operation used only by the local development composition path.
- `createMobileAuth()` reads an optional validated local-development credential configuration. When present, it exposes one encapsulated development sign-in action and no social adapters.
- `AuthProvider` serializes development login through the same session verification, membership cache, onboarding, cancellation, and logout state machine as social login.
- `LoginScreen` renders one subdued local-account action only when the Auth context reports it available. It shares the existing busy/error/dismissal behavior and does not participate in recent-social-provider persistence.

## Hosted Staging Promotion

The staging project reference is public configuration and is fixed in a staging-only CLI wrapper. The wrapper removes unrelated `SUPABASE_PROJECT_ID` variables while retaining the user's Supabase access token, and refuses to operate if the worktree is linked to another project.

Promotion is split into explicit, reviewable actions:

1. Link and inspect `divenary-staging`.
2. Run `db push --linked --dry-run`.
3. Apply checked-in migrations without the local seed.
4. Apply a staging-only legal document SQL file through `db query --linked`.
5. Verify public legal rows, onboarding RPC presence, and Google/Apple provider flags over HTTPS.

The local `.invalid` seed is never sent to hosted staging.

## Staging Legal Documents

Versioned Korean staging-only terms and privacy documents live under `docs/legal/staging/2026-07-18/`. Their URLs use the public repository's raw `main` path and are inserted as version `2026-07-18-staging.1`. They are explicitly internal test documents, not production policy. The staging seeder verifies both URLs return the expected version marker before changing the database.

Production legal documents remain a separate release prerequisite.

## Error Handling and Safety

- Missing Docker, local stack status, Auth admin failure, password exchange failure, or RPC mismatch stops fixture generation without writing a partial env file.
- Staging scripts fail closed on a project-ref mismatch, inaccessible legal URL, missing access token, migration failure, or post-apply verification mismatch.
- No service-role key, secret key, database password, social provider secret, session, or generated password is logged or committed.
- Guest Logbook and Planbook repositories remain local-only and unchanged.
- No cloud Logbook sync, account claim, profile, deletion, or safety-critical behavior is added.

## Verification

- Environment parser tests cover local/staging selection, production isolation, Android emulator URL, and invalid remote development credentials.
- Supabase repository tests cover password sign-in success and error mapping.
- Auth state tests cover development login pending/completed/error/concurrency behavior and recent-provider non-persistence.
- Auth screen tests cover local-action visibility, busy state, error state, and absence in staging/production fixtures.
- Script tests cover fixture generation and staging project guards without external writes.
- Local gates run reset, pgTAP, REST Auth smoke, fixture preparation, and a real password/RPC probe.
- Hosted gates run migration dry-run, migration apply, staging legal seed, public schema/RPC checks, and provider settings checks.
- Mobile typecheck and complete Jest suites must pass. Native social provider success remains a signed-device manual gate because it requires user interaction.

## Alternatives Rejected

- **Use only hosted staging for all development:** slow, network-dependent, and mixes repeatable feature work with external provider state.
- **Mock authenticated state for manual development:** does not exercise Supabase JWTs, RLS, RPCs, restore, or consent.
- **Enable real Google/Apple providers in local GoTrue:** retains external provider dependency and secrets without improving ordinary authenticated feature testing.
