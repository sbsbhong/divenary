# Watch Card Height and Demo Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three immediate-start cards equal, generous tap targets without card copy and add a compact demo-only Crown depth-control hint at the bottom of the recording screen.

**Architecture:** `StartSessionCard` owns its equal 64pt minimum height. The existing simulated-recording lifecycle exposes one active-recording visibility property that both the toolbar end control and the display-only demo footer use, so completion behavior remains centralized in `endDive()`.

**Tech Stack:** SwiftUI, XCTest, Xcode string catalog, Node static UI check, watchOS simulator build.

## Global Constraints

- Change only active watch sources under `apps/mobile/ios/DivenaryWatchApp`.
- Do not change start actions, play affordances, auto-save/retry behavior, Water Lock, Crown depth control, sensors, or depth-gauge drawing.
- The new bottom hint is noninteractive, uses the safe area, and appears only during active demo recording.
- Keep the three immediate-start cards free of subtitle and footnote copy.

---

## File Structure

- `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`: card height and removal of the demo subtitle.
- `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`: demo-only safe-area footer hint.
- `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`: English/Korean Crown hint.
- `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift`: shared active-recording visibility coverage.
- `apps/mobile/scripts/check-watch-ui-language.mjs`: static UI guard.

### Task 1: Equalize immediate-start cards without subtitles

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift:25-75,346-390`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs:1-180`

**Interfaces:**
- Produces: `StartSessionCard.minimumHeight = 64` as the sole shared card height policy.
- Consumes: existing `play.fill` callers and start actions unchanged.

- [ ] **Step 1: Write the failing static UI check**

Extend `immediate-start cards use play affordances and concise labels` so it also fails when:

```js
!homeViewSource.includes('static let minimumHeight: CGFloat = 64') ||
homeViewSource.includes('subtitle: String(localized: "Crown-controlled sample dive")')
```

- [ ] **Step 2: Verify the check is red**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: failure naming `immediate-start cards use play affordances and concise labels`.

- [ ] **Step 3: Implement the shared card height**

Remove the `Demo` card’s `subtitle` argument. In `StartSessionCard`, add:

```swift
static let minimumHeight: CGFloat = 64
```

Apply the height to the card content after `InstrumentCard`:

```swift
.frame(minHeight: Self.minimumHeight)
```

Do not add placeholder subtitle text and do not change the card’s `play.fill` values.

- [ ] **Step 4: Verify the check is green**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 5: Commit the task**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift \
  apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): equalize start card heights"
```

### Task 2: Add a demo-only Crown depth-control footer hint

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:31-47,211-236,274-300`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift:243-430`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs:123-180`

**Interfaces:**
- Produces: `SimulatedRecordingLifecycleController.showsRecordingControls: Bool`, true only for `.recording`.
- Consumes: the existing toolbar `xmark` and `endDive()` save path without adding a second termination route.

- [ ] **Step 1: Write failing XCTest and static UI checks**

Rename the existing active-end-control test to `testRecordingControlsAreVisibleOnlyWhileDemoRecordingIsActive` and assert `showsRecordingControls` before, during, and after `finishRecording()`:

```swift
XCTAssertFalse(controller.showsRecordingControls)
XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan()))
XCTAssertTrue(controller.showsRecordingControls)
XCTAssertTrue(controller.finishRecording())
XCTAssertFalse(controller.showsRecordingControls)
```

Extend the demo static check to require `safeAreaInset(edge: .bottom)`, `Adjust depth with the Digital Crown`, and a `recordingMode == .demo` guard in `simulatedRecordingFlowSource`.

- [ ] **Step 2: Verify the checks are red**

Run the concrete-simulator test command:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests -configuration Debug \
  -destination 'platform=watchOS Simulator,id=4F89FDCE-63D0-4BAD-B60B-B67996F3EF3F' \
  -derivedDataPath /private/tmp/DiveCardHeightDemoHintTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO test
```

Then run: `yarn workspace @repo/mobile watch:ui:check`

Expected: XCTest compilation fails because `showsRecordingControls` is absent; the UI check fails because the safe-area hint is absent.

- [ ] **Step 3: Implement the demo-only display hint**

Rename `showsEndControl` to:

```swift
var showsRecordingControls: Bool {
    if case .recording = phase { return true }
    return false
}
```

Use it for the existing toolbar condition. Add this view modifier to the outer `SimulatedRecordingFlowView` after its toolbar:

```swift
.safeAreaInset(edge: .bottom) {
    if recordingMode == .demo, lifecycle.showsRecordingControls {
        Text("Digital Crown으로 수심 조절")
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
            .frame(maxWidth: .infinity)
            .allowsHitTesting(false)
    }
}
```

Add an English/Korean catalog entry: `Adjust depth with the Digital Crown` / `Digital Crown으로 수심 조절`. Use `String(localized:)` in the `Text` so the source key remains the English catalog key.

- [ ] **Step 4: Verify targeted checks are green**

Run both commands from Step 2.

Expected: XCTest reports 0 failures and the UI check exits 0.

- [ ] **Step 5: Commit the task**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift \
  apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings \
  apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift \
  apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): hint demo crown depth control"
```

### Task 3: Run feature verification

**Files:**
- Verify only: files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: complete card height and demo hint behavior.
- Produces: a clean, verified branch ready for review or merge.

- [ ] **Step 1: Run static UI verification**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 2: Run concrete-simulator watchOS tests**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests -configuration Debug \
  -destination 'platform=watchOS Simulator,id=4F89FDCE-63D0-4BAD-B60B-B67996F3EF3F' \
  -derivedDataPath /private/tmp/DiveCardHeightDemoHintFinalTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO test
```

Expected: `DivenaryWatchAppTests` reports 0 failures.

- [ ] **Step 3: Build the watch app**

Run: `yarn watch:build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Check the feature branch**

```bash
git diff --check main...HEAD
git status --short
```

Expected: no whitespace errors and no unexpected uncommitted files.
