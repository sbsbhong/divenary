# Mobile Claim, Bootstrap, and Theme Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile launch, guest-data claim recovery, Settings entry, and system/light/dark presentation fail safely without deleting or crossing principal-scoped data.

**Architecture:** Publish principal-local repositories before optional remote hydration, represent bootstrap degradation explicitly, and keep claim failures inside a resumable scoped state machine. Treat `themePreference` as the only appearance override and derive React, navigation, native sheet, and overlay surfaces from the resolved appearance.

**Tech Stack:** React Native 0.85.3, React 19.2.3, TypeScript 5.8, React Navigation 7, NativeWind 4.1, Gluestack UI v4 alpha, TanStack Query 5, AsyncStorage, Jest/react-test-renderer.

## Global Constraints

- Preserve guest and `user:<uuid>` partitions; never expose another principal as fallback.
- Never delete guest data before remote commit/readback, account local publication/readback, and exact-match cleanup.
- WatchConnectivity acknowledgement continues to mean mobile local persistence only.
- Do not add dependencies, change Supabase schema, reset AsyncStorage, automatically log out, or add watchOS Auth/Supabase responsibility.
- Reuse semantic tokens and `DepthTraceProgress`; add no decorative illustration, gradient, or font dependency.
- Preserve unrelated uncommitted watchOS changes in the main worktree.

## File Map

- `apps/mobile/src/states/app-preferences.tsx`, `providers.tsx`: appearance preference and provider boundary.
- `apps/mobile/src/components/navigation/index.tsx`: navigation theme, native sheet surface, and single claim route.
- `apps/mobile/src/claim/guest-claim-types.ts`, `guest-claim-store.ts`, `guest-claim-service.ts`: checking phase, failure context, and local preflight.
- `apps/mobile/src/states/account-data.tsx`: early local publication, bootstrap health, and retry.
- `apps/mobile/src/screens/account-claim/screen.tsx`, `settings/screen.tsx`, `home/screen.tsx`: complete claim/recovery UI.
- `apps/mobile/src/components/app-error-boundary.tsx`, `screens/recovery/screen.tsx`: last-resort nonblank recovery.
- `apps/mobile/src/i18n/resources.ts`: Korean and English recovery copy.
- `apps/mobile/__tests__/`: regression tests written before each implementation.
- `.wiki/raw/`, `.wiki/wiki/`: changed architecture and sync recovery semantics.

---

### Task 1: Make theme preference the only appearance override

**Files:**
- Modify: `apps/mobile/src/providers.tsx`
- Modify: `apps/mobile/src/components/ui/gluestack-ui-provider/index.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/screens/auth/login-screen.tsx`
- Modify: `apps/mobile/src/screens/account-claim/screen.tsx`
- Test: `apps/mobile/__tests__/app-preferences.test.tsx`
- Test: `apps/mobile/__tests__/App.test.tsx`
- Test: `apps/mobile/__tests__/navigation.test.ts`

**Interfaces:**
- Consumes: `themePreference`, `resolvedTheme`, and `useGluestackColors()`.
- Produces: `GluestackUIProvider({mode: ThemePreference})` and `createAccountClaimSheetOptions(backgroundColor)`.

- [ ] **Step 1: Write failing tests**

Add a controllable system scheme and NativeWind setter spy. Assert explicit dark followed by system releases the override instead of sending resolved light:

```tsx
await actPreference(renderer, value => value.setThemePreference('dark'));
expect(setColorScheme).toHaveBeenLastCalledWith('dark');
await actPreference(renderer, value => value.setThemePreference('system'));
expect(setColorScheme).toHaveBeenLastCalledWith('system');
expect(latestPreference(renderer).resolvedTheme).toBe('light');
```

Assert NavigationContainer and both form-sheet routes receive the semantic background.

- [ ] **Step 2: Run the tests and confirm failure**

```bash
yarn workspace @repo/mobile test --runInBand app-preferences.test.tsx App.test.tsx navigation.test.ts
```

Expected: FAIL because `Providers` passes `resolvedTheme` and native sheet options have no themed `contentStyle`.

- [ ] **Step 3: Implement the preference boundary**

Use:

```tsx
const {resolvedTheme, themePreference} = useAppPreferences();
return (
  <GluestackUIProvider mode={themePreference}>
    <StatusBar barStyle={resolvedTheme === 'dark' ? 'light-content' : 'dark-content'} />
    {props.children}
  </GluestackUIProvider>
);
```

Keep the NativeWind `setColorScheme(mode)` effect keyed by `mode`, including `system`.

- [ ] **Step 4: Theme navigation and native surfaces**

Build the NavigationContainer theme from `DefaultTheme`/`DarkTheme` plus semantic palette values. Add `contentStyle: {backgroundColor: palette.background}` to stack defaults and both form sheets. Export:

```ts
export function createAccountClaimSheetOptions(
  backgroundColor: string,
): NativeStackNavigationOptions {
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: AUTH_LOGIN_SHEET_ALLOWED_DETENTS,
    sheetGrabberVisible: true,
    sheetCornerRadius: 28,
    contentStyle: {backgroundColor},
  };
}
```

Give login and claim safe-area roots `flex-1 bg-background`.

- [ ] **Step 5: Verify and commit**

```bash
yarn workspace @repo/mobile test --runInBand app-preferences.test.tsx App.test.tsx navigation.test.ts account-claim-screen.test.tsx auth-screens.test.tsx
yarn mobile:typecheck
git add apps/mobile/src apps/mobile/__tests__/app-preferences.test.tsx apps/mobile/__tests__/App.test.tsx apps/mobile/__tests__/navigation.test.ts apps/mobile/__tests__/account-claim-screen.test.tsx apps/mobile/__tests__/auth-screens.test.tsx
git commit -m "fix(mobile): restore system theme across sheets"
```

Expected: selected tests PASS and TypeScript exits 0.

---

### Task 2: Preflight every claim before remote writes

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Test: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Test: `apps/mobile/__tests__/guest-claim-service.test.ts`

**Interfaces:**
- Produces: `GuestClaimFailureDetail`, checking progress, and persistent safe failure context.
- Consumes: immutable snapshot, profile verification helpers, and existing error codes.

- [ ] **Step 1: Write failing preflight tests**

For missing/corrupt profile and invalid relationship, assert the failed snapshot identifies the item and every remote method has zero calls:

```ts
expect(result).toMatchObject({
  manifest: {status: 'failed'},
  errorCode: 'profile_corrupt',
  failure: {
    phase: 'checking',
    entityKind: 'log',
    clientRecordId: 'watch-log-1',
    label: 'Moon Island',
  },
});
expect(remoteRepository.createOrLoadBatch).not.toHaveBeenCalled();
expect(remoteRepository.stageRecord).not.toHaveBeenCalled();
expect(remoteRepository.uploadProfile).not.toHaveBeenCalled();
```

Add store round-trip coverage for old snapshots without `failure` and new snapshots with sanitized failure detail.

- [ ] **Step 2: Run tests and confirm failure**

```bash
yarn workspace @repo/mobile test --runInBand guest-claim-service.test.ts guest-claim-store.test.ts
```

Expected: FAIL because no checking phase or failure detail exists.

- [ ] **Step 3: Add safe types and storage normalization**

Define:

```ts
export type GuestClaimFailureDetail = {
  phase: 'checking' | 'uploading' | 'finalizing' | 'cleanup';
  entityKind?: 'plan' | 'log';
  clientRecordId?: string;
  label?: string;
};
```

Add `checking` to progress phases and optional `failure` to the snapshot outside the digest-covered manifest. Normalize only declared phase/kind and bounded nonblank identifiers/labels; reject payload/profile bytes.

- [ ] **Step 4: Implement local-only full preflight**

Before `createOrLoadBatch`, loop through all manifest items, verify sidecar presence, relationships, payload shape, profile bytes/digest/sample count, and emit checking progress. Convert any item error to a snapshot with `status: failed`, error code, and safe item context. Do not set `running` until the loop succeeds.

Clear failure detail only after explicit retry passes preflight. Auto-resume only `network_unavailable`, interrupted running/finalizing, and committed cleanup; do not auto-resume permanent errors or `session_expired`.

- [ ] **Step 5: Verify and commit**

```bash
yarn workspace @repo/mobile test --runInBand guest-claim-service.test.ts guest-claim-store.test.ts account-data-state.test.tsx
yarn mobile:typecheck
git add apps/mobile/src/claim apps/mobile/__tests__/guest-claim-service.test.ts apps/mobile/__tests__/guest-claim-store.test.ts apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix(mobile): preflight guest claims before upload"
```

Expected: selected tests PASS and TypeScript exits 0.

---

### Task 3: Publish local account data before optional initialization

**Files:**
- Modify: `apps/mobile/src/states/account-data.tsx`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Produces: `AccountDataBootstrapState`, `retryBootstrap()`, and `claim.refresh()`.
- Consumes: principal repositories, migration, outbox, coordinator, and claim service.

- [ ] **Step 1: Write failing fail-open tests**

Inject failures for migration, pending-operation reconciliation, coordinator hydrate/drain, and claim-store refresh. Assert the desired principal repository and children remain published with degraded status:

```tsx
expect(probe.latest()).toMatchObject({
  principal: {kind: 'user', userId},
  bootstrap: {
    status: 'degraded',
    issue: {stage: 'remoteHydration', retryable: true},
  },
});
expect(renderer.root.findByProps({testID: 'account-data-child'})).toBeTruthy();
```

For a repository factory throw, assert `recoveryRequired` is rendered instead of an empty Fragment. Assert previous-principal queries are removed.

- [ ] **Step 2: Run tests and confirm failure**

```bash
yarn workspace @repo/mobile test --runInBand account-data-state.test.tsx
```

Expected: FAIL because optional errors reject the monolithic publication.

- [ ] **Step 3: Add bootstrap state**

Define and expose:

```ts
export type AccountDataBootstrapState =
  | {status: 'loading'}
  | {status: 'ready'}
  | {status: 'degraded'; issue: {stage: BootstrapStage; retryable: boolean}}
  | {status: 'recoveryRequired'; issue: {stage: 'localRepository'; retryable: true}};
```

Add `bootstrap`, `retryBootstrap(): void`, and `claim.refresh(): Promise<void>` to the context contracts.

- [ ] **Step 4: Split initialization**

Within the generation guard: attempt migration and capture failure; create only the desired principal repositories; clear previous-principal queries; publish local repositories; then run claim inspection, outbox reconciliation, hydrate, and drain in guarded optional stages. Optional failure keeps the local publication and sets degraded. Repository creation failure clears mismatched publication and sets recoveryRequired; it never substitutes guest or another account.

Implement retry with a `bootstrapAttempt` counter so an older generation cannot overwrite the result. Implement `claim.refresh` with existing guarded `refreshClaim(..., {resumeActive: false})` and no remote start.

- [ ] **Step 5: Verify and commit**

```bash
yarn workspace @repo/mobile test --runInBand account-data-state.test.tsx principal-repositories.test.ts account-sync-coordinator.test.ts
yarn mobile:typecheck
git add apps/mobile/src/states/account-data.tsx apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix(mobile): keep local data available during recovery"
```

Expected: selected tests PASS and TypeScript exits 0.

---

### Task 4: Make every claim entry visible and actionable

**Files:**
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/screens/account-claim/screen.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/settings-screen.test.tsx`
- Test: `apps/mobile/__tests__/account-claim-screen.test.tsx`
- Test: `apps/mobile/__tests__/App.test.tsx`
- Test: `apps/mobile/__tests__/i18n.test.ts`

**Interfaces:**
- Consumes: bootstrap state, complete claim state, `claim.refresh()`, and the single `accountClaim` route.
- Produces: recovery banner props and nonempty sheet content for every actionable state.

- [ ] **Step 1: Write failing UI tests**

Assert Settings keeps the row visible for running, failed, deferred, and eligible-hidden claims. Press the real navigation row and assert `account-claim-screen` renders. For hidden state, assert the sheet renders preparation and refreshes:

```tsx
mockClaim = claimFixture({status: 'hidden'}, {logCount: 3, planCount: 2});
const renderer = await renderScreen();
expect(renderer.root.findByProps({testID: 'account-claim-preparing'})).toBeTruthy();
expect(mockClaim.refresh).toHaveBeenCalledTimes(1);
```

Add checking, item-specific failure, rejected-action containment, and Korean/English copy tests.

- [ ] **Step 2: Run tests and confirm failure**

```bash
yarn workspace @repo/mobile test --runInBand settings-screen.test.tsx account-claim-screen.test.tsx App.test.tsx i18n.test.ts
```

Expected: FAIL because hidden produces an empty content-fit sheet, running is hidden, and failure ignores item context.

- [ ] **Step 3: Implement complete Settings/sheet states**

Show the row for an owned authenticated account when eligible count is positive or state is running/failed/deferred. Use active total/completed when eligible counts are zero. Offline users may view status but cannot start upload.

Render hidden as `PreparingContent`, call `claim.refresh()` once, render checking with determinate progress, and map failure code/phase/label to direct copy. Catch action rejection inside the sheet and refresh instead of leaking an unhandled promise.

- [ ] **Step 4: Add the compact home recovery banner**

Extend `HomeScreenProps` with:

```ts
recovery?: {
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
};
```

Render one quiet card with an amber status point and blue text action. Navigation supplies it for degraded bootstrap or failed/deferred claim and opens the corresponding recovery/claim surface.

- [ ] **Step 5: Verify and commit**

```bash
yarn workspace @repo/mobile test --runInBand settings-screen.test.tsx account-claim-screen.test.tsx App.test.tsx i18n.test.ts ui-copy-density.test.ts
yarn mobile:typecheck
git add apps/mobile/src/screens apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/settings-screen.test.tsx apps/mobile/__tests__/account-claim-screen.test.tsx apps/mobile/__tests__/App.test.tsx apps/mobile/__tests__/i18n.test.ts
git commit -m "fix(mobile): surface actionable claim recovery"
```

Expected: selected tests PASS and TypeScript exits 0.

---

### Task 5: Replace unrecoverable blank rendering with a recovery shell

**Files:**
- Create: `apps/mobile/src/components/app-error-boundary.tsx`
- Create: `apps/mobile/src/screens/recovery/screen.tsx`
- Modify: `apps/mobile/src/providers.tsx`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/App.test.tsx`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Consumes: recoveryRequired bootstrap and current semantic theme.
- Produces: themed retry-only recovery screens with no destructive action.

- [ ] **Step 1: Write failing recovery tests**

Inject repository creation failure and assert `account-data-recovery-screen` and retry render. Render a child that throws and assert `app-error-recovery-screen` replaces it. Verify both preserve-data copy and omit clear/delete/sign-out actions.

- [ ] **Step 2: Run tests and confirm failure**

```bash
yarn workspace @repo/mobile test --runInBand App.test.tsx account-data-state.test.tsx
```

Expected: FAIL because the provider renders empty and no render boundary exists.

- [ ] **Step 3: Implement recovery shell and error boundary**

Create a `SafeAreaView className="flex-1 bg-background"` screen with concise preservation copy and one retry button. Reorder providers so `ThemedProviders` encloses Auth and AccountData. Use a class error boundary with `getDerivedStateFromError()` and clear its state only on explicit retry. Log only a sanitized warning without props, payloads, or tokens.

- [ ] **Step 4: Verify and commit**

```bash
yarn workspace @repo/mobile test --runInBand App.test.tsx account-data-state.test.tsx i18n.test.ts
yarn mobile:typecheck
git add apps/mobile/src/components/app-error-boundary.tsx apps/mobile/src/screens/recovery/screen.tsx apps/mobile/src/providers.tsx apps/mobile/src/states/account-data.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/App.test.tsx apps/mobile/__tests__/account-data-state.test.tsx apps/mobile/__tests__/i18n.test.ts
git commit -m "fix(mobile): replace blank launch with recovery UI"
```

Expected: selected tests PASS and TypeScript exits 0.

---

### Task 6: Record semantics, verify, and merge

**Files:**
- Modify: `.wiki/raw/` selected by the repository wiki skills.
- Modify: `.wiki/wiki/` compiled knowledge, index, and log selected by the repository wiki skills.

**Interfaces:**
- Consumes: completed bootstrap, claim, and theme behavior.
- Produces: durable project knowledge and a tested feature branch merged into main.

- [ ] **Step 1: Update wiki with required skills**

Use `karpathy-llm-wiki` and `wiki-writing`. Record early local publication, preflight-before-remote, transient-only auto-resume, one shared claim route, preference/resolved appearance separation, and unchanged Watch ACK/safety boundaries.

- [ ] **Step 2: Run focused and full gates**

```bash
yarn workspace @repo/mobile test --runInBand app-preferences.test.tsx navigation.test.ts account-claim-screen.test.tsx settings-screen.test.tsx guest-claim-service.test.ts guest-claim-store.test.ts account-data-state.test.tsx App.test.tsx i18n.test.ts
yarn workspace @repo/mobile test --runInBand
yarn mobile:typecheck
yarn ios:build
yarn codex:check
```

Expected: all commands exit 0. Environment-only warnings may be reported, but a nonzero command is never called passing.

- [ ] **Step 3: Inspect and commit documentation**

```bash
git diff --check
git status --short
git add .wiki docs/superpowers/plans/2026-07-22-mobile-claim-bootstrap-theme-recovery.md
git commit -m "docs: record mobile recovery boundaries"
```

- [ ] **Step 4: Merge without disturbing the dirty main worktree**

Verify the original worktree's dirty paths remain the pre-existing watchOS files, then run:

```bash
git merge --no-ff codex/mobile-claim-recovery -m "merge: harden mobile claim recovery"
```

If any dirty main path overlaps a feature path, stop before merge and report the overlap. Never stash, reset, or discard user changes.

## Plan Self-Review

- Spec coverage: bootstrap, claim preflight, Settings route, recovery UI, system appearance, sheet surfaces, wiki, and verification gates each have an implementation task.
- Placeholder scan: no deferred marker or unspecified error-handling step remains.
- Type consistency: bootstrap state, failure detail, refresh action, and theme helper are introduced before their consumers.
- Scope: production changes remain in the mobile workspace; no Supabase schema or watchOS implementation change is planned.
