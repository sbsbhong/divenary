# Compact Plan Completion Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the plan-completion actions full-width and side-by-side while reducing only their visual height to a 44pt compact treatment.

**Architecture:** Reuse the existing `InstrumentButton` component and override its size tokens only at the `CompletionPrompt` call sites. This avoids a speculative shared variant and leaves every other instrument button unchanged.

**Tech Stack:** React Native 0.85.3, React 19.2.3, TypeScript, Jest, Gluestack UI v4, NativeWind.

## Global Constraints

- Preserve the two equal-width `flex-1` actions and their existing order.
- Use `min-h-11 px-4 py-2` only for the two completion-prompt buttons.
- Keep current labels, text size, colors, callbacks and 44pt minimum touch target.
- Do not change the shared `InstrumentButton` defaults or add dependencies.
- Preserve all pre-existing user-owned watchOS, Xcode, cache, script and checklist changes.

---

### Task 1: Compact the plan-completion actions

**Files:**
- Modify: `apps/mobile/__tests__/planning-screen.test.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx:501-523`

**Interfaces:**
- Consumes: `InstrumentButton` and its existing `className` override.
- Produces: two completion actions with equal width and compact 44pt sizing.

- [ ] **Step 1: Write the failing style regression**

In the existing `completes a plan and lets the user choose Later` test, assert both rendered actions have the local compact tokens while retaining equal width:

```tsx
const laterButton = root.findByProps({
  testID: 'planning-complete-later',
});
const createLogButton = root.findByProps({
  testID: 'planning-complete-create-log',
});

for (const button of [laterButton, createLogButton]) {
  expect(button.props.className).toEqual(
    expect.stringContaining('flex-1 min-h-11 px-4 py-2'),
  );
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/planning-screen.test.tsx \
  -t 'completes a plan and lets the user choose Later'
```

Expected: FAIL because both buttons currently expose only `flex-1` at the call site and inherit the 48pt shared treatment.

- [ ] **Step 3: Apply the local compact sizing**

Update both completion actions without changing the shared component:

```tsx
<InstrumentButton
  testID="planning-complete-later"
  className="flex-1 min-h-11 px-4 py-2"
  label={t('planning.later', { defaultValue: 'Later' })}
  onPress={props.onLater}
/>
<InstrumentButton
  testID="planning-complete-create-log"
  className="flex-1 min-h-11 px-4 py-2"
  label={t('planning.createLogFromPlan', {
    defaultValue: 'Create log from plan',
  })}
  variant="primary"
  onPress={props.onCreateLog}
/>
```

- [ ] **Step 4: Run focused and screen tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/planning-screen.test.tsx
yarn mobile:typecheck
git diff --check
```

Expected: the planning suite and typecheck pass, with no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/mobile/__tests__/planning-screen.test.tsx \
  apps/mobile/src/screens/planning/screen.tsx \
  docs/superpowers/plans/2026-07-28-compact-plan-completion-actions.md
git commit -m "fix(mobile): compact plan completion actions"
```
