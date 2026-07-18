# Mobile Apple Polish Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the residual copy-density and cross-platform regression gaps in the approved mobile Apple polish design without changing authentication or local-data behavior.

**Architecture:** Keep the existing native splash, navigation-owned guest login decision, custom social login controls, and screen structure. Remove only redundant or developer-facing visible text, localize notification permission copy through existing i18n resources, and strengthen source/component tests around platform and authentication states.

**Tech Stack:** React Native 0.85.3, React Navigation native stack 7, Gluestack UI v4 local components, react-i18next, Jest, iOS storyboard/asset catalog, Android resources.

## Global Constraints

- Preserve the approved design in `docs/superpowers/specs/2026-07-17-mobile-apple-polish-design.md`.
- Keep guest Logbook and Planbook local-only; do not change authentication repositories or data ownership.
- Keep one non-certified safety statement on Home, Logbook, Planning, and Memory.
- Keep legal consent labels, actionable permission/error text, and unsupported-depth warnings.
- Keep the visible recent-login provider indication and provider ordering.
- Add no dependency, no artificial splash delay, and no native project/signing change.
- Preserve unrelated dirty files in the main checkout.

---

### Task 1: Finish the visible-copy audit

**Files:**
- Modify: `apps/mobile/__tests__/ui-copy-density.test.ts`
- Modify: `apps/mobile/__tests__/settings-screen.test.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`
- Modify: `apps/mobile/src/screens/memory/screen.tsx`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`

**Interfaces:**
- Consumes: existing translation keys and screen component structure.
- Produces: concise empty states, user-facing unavailable states, and fully localized notification permission alerts.

- [ ] **Step 1: Add failing copy-policy and English-alert tests**

  Extend `ui-copy-density.test.ts` to reject empty-state eyebrows, `staticPreview`, `safeAnalytics`, `photoImportPlaceholder`, and the visible phrases `this build`, `이 빌드`, `placeholder`, and `플레이스홀더`. Extend `settings-screen.test.tsx` to switch to English, deny notification permission, and assert the alert title/message/buttons are English resource values.

- [ ] **Step 2: Verify RED**

  Run: `yarn workspace @repo/mobile test ui-copy-density.test.ts settings-screen.test.tsx --runInBand`

  Expected: FAIL because redundant labels/developer copy remain and notification alert keys are missing.

- [ ] **Step 3: Implement the minimal copy cleanup**

  Remove the eyebrow only from empty Home, Logbook, and Planning states. Remove `memory.staticPreview` and `memory.safeAnalytics` while retaining the card titles. Delete the dead photo-import placeholder key. Shorten Home count, watch-sync unavailable, unconfigured account, native bridge unavailable, and unavailable-login copy without developer terminology. Add Korean and English notification permission/open-settings keys and remove Korean `defaultValue` fallbacks from `settings/screen.tsx`.

- [ ] **Step 4: Verify GREEN**

  Run: `yarn workspace @repo/mobile test ui-copy-density.test.ts settings-screen.test.tsx home-conditions.test.tsx planning-screen.test.tsx logbook-manual-entry.test.tsx preview-metric-placeholders.test.tsx i18n.test.ts --runInBand`

  Expected: all selected suites PASS.

- [ ] **Step 5: Commit**

  Commit message: `refactor(mobile): finish visible copy cleanup`

### Task 2: Harden splash and authentication regression coverage

**Files:**
- Modify: `apps/mobile/__tests__/native-splash.test.ts`
- Modify: `apps/mobile/__tests__/App.test.tsx`
- Modify: `apps/mobile/__tests__/social-login-button.test.tsx`

**Interfaces:**
- Consumes: native splash files, `AuthState`, `SocialLoginButton`, and navigation source.
- Produces: regression coverage for both platform resource paths and every non-guest Home state.

- [ ] **Step 1: Add focused regression assertions**

  Verify iOS and pre-31 Android centering constraints, Android light/dark background values, absence of splash copy, and presence of the system splash configuration. Parameterize the Home test across `authenticated`, `authenticatedOffline`, and `pendingOnboarding`. Verify provider icon/status slot widths for both iOS and Android by mocking `Platform.OS` and reloading the module.

- [ ] **Step 2: Run focused tests**

  Run: `yarn workspace @repo/mobile test native-splash.test.ts App.test.tsx social-login-button.test.tsx --runInBand`

  Expected: PASS without production changes; these assertions lock already-required behavior.

- [ ] **Step 3: Commit**

  Commit message: `test(mobile): harden Apple polish regressions`

### Task 3: Review, native validation, and integration

**Files:**
- Modify: this plan checkbox state only after each gate is complete.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: reviewed commits merged into local `main`.

- [ ] **Step 1: Run static and complete mobile gates**

  Run `yarn mobile:typecheck`, `yarn workspace @repo/mobile test --runInBand`, and `git diff --check`.

- [ ] **Step 2: Run native build gates**

  Run `yarn ios:build` and `cd apps/mobile/android && ./gradlew assembleDebug`. Record exact infrastructure failures without claiming a pass.

- [ ] **Step 3: Perform simulator visual checks**

  Confirm the native splash first frame, guest-only Home login action, compact login sheet, balanced provider logos, and visible recent-provider label on an available simulator. Add no validation-only source to commits.

- [ ] **Step 4: Request final subagent review**

  Review the complete branch against the original four user requirements and this completion plan. Resolve all Critical and Important findings.

- [ ] **Step 5: Merge and verify**

  Fast-forward local `main`, rerun typecheck and complete mobile tests on the merged result, then remove this owned worktree and branch while preserving unrelated main-checkout changes.
