# Watch Start Card Height and Demo Crown Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three immediate-start cards equal, generous one-line rows and place a small Crown depth-control instruction at the bottom of an active demo recording.

**Architecture:** Keep the home-card geometry in `StartSessionCard`, which all three launch cards already use. Add the noninteractive demo hint at the simulated-flow boundary with a bottom `safeAreaInset`, guarded by both demo mode and the existing active-recording lifecycle state.

**Tech Stack:** SwiftUI, XCTest, Xcode string catalog, Node static UI check, watchOS simulator build.

## Global Constraints

- Touch only active watch sources under `apps/mobile/ios/DivenaryWatchApp` and the watch UI check.
- Keep Free, Scuba, and Demo cards free of explanatory subtitle/footnote text.
- Keep the existing real-session safety footer, `play.fill`, toolbar `xmark`, persistence flow, Water Lock, sensor behavior, and depth-gauge implementation unchanged.
- Crown guidance is demo-only, 9 pt, noninteractive, and stays inside the bottom safe area.

---

## File Structure

- `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`: removes the demo subtitle and defines the shared start-card minimum height.
- `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`: adds the demo-only bottom Crown hint.
- `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`: provides English/Korean Crown hint localization.
- `apps/mobile/scripts/check-watch-ui-language.mjs`: statically guards copy, card height, and demo-only hint placement.

### Task 1: Equalize launch-card height and add the demo-only Crown hint

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift:65-77,354-392`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:209-257`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs:1-180`

**Interfaces:**
- Consumes: `StartSessionCard`, `WatchRecordingMode.demo`, and `SimulatedRecordingLifecycleController.showsEndControl`.
- Produces: a shared `.frame(minHeight: 64)` card layout and a demo-only localized bottom hint with no new lifecycle or persistence API.

- [ ] **Step 1: Write the failing static UI check**

Add this check to `checks` in `apps/mobile/scripts/check-watch-ui-language.mjs`:

```js
{
  name: 'start cards share a generous height and demo keeps crown guidance in recording',
  failed:
    !homeViewSource.includes('.frame(minHeight: 64)') ||
    homeViewSource.includes('Crown-controlled sample dive') ||
    !simulatedRecordingFlowSource.includes('.safeAreaInset(edge: .bottom') ||
    !simulatedRecordingFlowSource.includes('recordingMode == .demo, lifecycle.showsEndControl') ||
    !simulatedRecordingFlowSource.includes('Rotate the Digital Crown to adjust depth.'),
},
```

- [ ] **Step 2: Verify the check is red**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: failure naming `start cards share a generous height and demo keeps crown guidance in recording`.

- [ ] **Step 3: Implement the minimum layout and copy changes**

Remove the `subtitle: String(localized: "Crown-controlled sample dive")` argument from the Demo `StartSessionCard` call in `HomeView.swift`. In `StartSessionCard`, add the shared row height after the `HStack`:

```swift
.frame(minHeight: 64)
```

In `SimulatedRecordingFlowView.body`, add this modifier after the existing toolbar:

```swift
.safeAreaInset(edge: .bottom, spacing: 2) {
    if recordingMode == .demo, lifecycle.showsEndControl {
        Text("Rotate the Digital Crown to adjust depth.")
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: .infinity)
    }
}
```

Add the catalog entry `Rotate the Digital Crown to adjust depth.` with English value `Rotate the Digital Crown to adjust depth.` and Korean value `Digital Crown으로 수심 조절` using the existing `stringUnit` structure.

- [ ] **Step 4: Verify the check is green**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 5: Commit the task**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift \
  apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift \
  apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings \
  apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): balance start cards and demo hint"
```

### Task 2: Run feature verification

**Files:**
- Verify only: files changed in Task 1.

**Interfaces:**
- Consumes: shared card-height and demo hint changes.
- Produces: a verified feature branch ready for review or merge.

- [ ] **Step 1: Run the static UI gate**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 2: Run watchOS tests on a concrete simulator**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests -configuration Debug \
  -destination 'platform=watchOS Simulator,id=4F89FDCE-63D0-4BAD-B60B-B67996F3EF3F' \
  -derivedDataPath /private/tmp/DiveCardHeightCrownHintTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO test
```

Expected: `DivenaryWatchAppTests` reports 0 failures.

- [ ] **Step 3: Run the watch build**

Run: `yarn watch:build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Check the feature branch**

```bash
git diff --check main...HEAD
git status --short
```

Expected: no whitespace errors and no unexpected uncommitted files.
