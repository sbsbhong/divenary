# Watch Start Card and Demo End Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make watch launch cards explicit immediate actions and replace the demo recording footer end control with an upper safe-area end control that preserves the full-height depth gauge.

**Architecture:** Keep real session behavior and demo persistence inside their existing boundaries. `StartSessionCard` gains an explicit trailing symbol so immediate-action cards use `play.fill`; the demo recording chooses a toolbar end-control presentation while retaining the lifecycle controller’s existing `finishRecording()` save path.

**Tech Stack:** SwiftUI, XCTest, Xcode string catalog, Node static UI check, watchOS simulator build.

## Global Constraints

- Modify active watch sources only under `apps/mobile/ios/DivenaryWatchApp`.
- Do not alter Water Lock, sensors, runtime session ownership, real-session end controls, or depth-gauge dimensions.
- Keep interactive controls in the safe area; only the demo’s visible end control moves from the footer to the leading toolbar.
- Remove safety copy only from the two specified real-session cards; preserve the home safety footer and all other safety boundaries.
- Preserve user-owned uncommitted changes in `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings` when integrating the feature branch.

---

## File Structure

- `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`: immediate-start cards and their localized labels.
- `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift`: presentation-specific end control and toolbar visibility for the shared instrument.
- `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`: demo toolbar `xmark`, delegated to the existing save lifecycle.
- `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`: English/Korean start-card and accessible demo-end strings.
- `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift`: demo end-control lifecycle coverage.
- `apps/mobile/scripts/check-watch-ui-language.mjs`: static guard for visible controls and removed copy.

### Task 1: Make immediate-start cards visually explicit

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift:25-48,354-392`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs:1-175`

**Interfaces:**
- Produces: `StartSessionCard.trailingSystemImage: String`; real and demo cards pass `"play.fill"`, debug cards pass `"chevron.right"`.
- Consumes: existing `startRealDive(mode:)` and demo navigation destinations without changing their actions.

- [ ] **Step 1: Write the failing static UI check**

Read `HomeView.swift` into `homeViewSource` beside the other individual sources. Add this `checks` entry:

```js
{
  name: 'immediate-start cards use play affordances and concise labels',
  failed:
    !homeViewSource.includes('title: "Freediving"') ||
    !homeViewSource.includes('title: "Scuba Diving"') ||
    (homeViewSource.match(/trailingSystemImage: "play.fill"/g) ?? []).length !== 3 ||
    homeViewSource.includes('Supplemental log · no safety calculation') ||
    homeViewSource.includes('Recommended safety stop reminder.'),
},
```

- [ ] **Step 2: Verify the check is red**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: failure naming `immediate-start cards use play affordances and concise labels`.

- [ ] **Step 3: Implement the smallest card API and copy change**

Add a required `trailingSystemImage: String` property to `StartSessionCard`, replacing its hard-coded trailing image with:

```swift
Image(systemName: trailingSystemImage)
    .font(.system(size: 12, weight: .semibold))
    .foregroundStyle(DiveWatchTheme.mutedText)
```

Make `subtitle` optional and render its `Text` only when it is non-nil. For the two real cards use localized titles `"Freediving"` and `"Scuba Diving"`, omit subtitle and footnote, and pass `trailingSystemImage: "play.fill"`. Pass the same play symbol to the demo card and `"chevron.right"` to each debug card.

Add catalog entries using the established `stringUnit` structure: English/Korean `Freediving` → `Freediving` / `프리 다이빙`; `Scuba Diving` → `Scuba Diving` / `스쿠버 다이빙`. Preserve unrelated stale catalog entries.

- [ ] **Step 4: Verify the check is green**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 5: Commit the task**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift \
  apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings \
  apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): clarify immediate dive starts"
```

### Task 2: Replace the demo footer with a safe-area toolbar end action

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift:35-46,78-103,221-275`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:8-108,209-277,347-362`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift:243-430`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs:123-175`

**Interfaces:**
- Produces: `RecordingEndControl.toolbarEnd`, `RecordingInstrumentView.showsNavigationToolbar`, and `SimulatedRecordingLifecycleController.showsEndControl`.
- Consumes: `SimulatedRecordingLifecycleController.finishRecording()` through the existing `SimulatedRecordingFlowView.endDive()` method; no new persistence API.

- [ ] **Step 1: Write failing lifecycle and static UI checks**

Add this XCTest method to `SimulatedRecordingLifecycleControllerTests`:

```swift
func testEndControlIsVisibleOnlyWhileDemoRecordingIsActive() {
    let (controller, _, _) = makeSystem()

    XCTAssertFalse(controller.showsEndControl)
    XCTAssertFalse(controller.handleFlowAppearance(plan: PreDivePlan()))
    XCTAssertTrue(controller.showsEndControl)

    XCTAssertTrue(controller.finishRecording())
    XCTAssertFalse(controller.showsEndControl)
}
```

Extend the existing demo-completion static check to require `ToolbarItem(placement: .topBarLeading)`, `Image(systemName: "xmark")`, and `endDive()` in `simulatedRecordingFlowSource`, while rejecting `case .demoButton`, `Label("End Dive"`, and `Use the button to end the demo session.` in `recordingViewSource`.

- [ ] **Step 2: Verify the checks are red**

Run:

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests -configuration Debug \
  -destination 'platform=watchOS Simulator,id=4F89FDCE-63D0-4BAD-B60B-B67996F3EF3F' \
  -derivedDataPath /private/tmp/DiveStartCardDemoEndTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO test
yarn workspace @repo/mobile watch:ui:check
```

Expected: XCTest compilation fails because `showsEndControl` is absent; the UI check fails because the demo toolbar end control is absent.

- [ ] **Step 3: Implement the smallest demo-only presentation change**

Add `case toolbarEnd` to `RecordingEndControl` and return it from `WatchRecordingMode.demo.endControl`. Make `RecordingEndControlFooter` render only `crownHint`; `.toolbarEnd` and `.hidden` render no footer.

Add `showsNavigationToolbar: Bool = false` to `RecordingInstrumentView` and replace its current navigation-bar modifier with:

```swift
.toolbar(showsNavigationToolbar ? .visible : .hidden, for: .navigationBar)
```

Pass `showsNavigationToolbar: recordingMode == .demo` from `SimulatedRecordingFlowView`. Add this controller property:

```swift
var showsEndControl: Bool {
    if case .recording = phase { return true }
    return false
}
```

Add this outer toolbar to `SimulatedRecordingFlowView`:

```swift
.toolbar {
    if recordingMode == .demo, lifecycle.showsEndControl {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                _ = endDive()
            } label: {
                Image(systemName: "xmark")
            }
            .accessibilityLabel(Text("End demo"))
        }
    }
}
```

Add an English/Korean `End demo` catalog entry using the existing structure. Do not dismiss directly; the button must call `endDive()` so save/retry behavior remains unchanged.

- [ ] **Step 4: Verify targeted checks are green**

Run both commands from Step 2.

Expected: XCTest reports 0 failures and the UI check exits 0.

- [ ] **Step 5: Commit the task**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift \
  apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift \
  apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings \
  apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift \
  apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): move demo end control to toolbar"
```

### Task 3: Run feature verification

**Files:**
- Verify only: files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: completed start-card and demo-toolbar changes.
- Produces: a clean, verified branch ready for review or merge.

- [ ] **Step 1: Run the static UI gate**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: exit code 0.

- [ ] **Step 2: Run watchOS tests on a concrete simulator**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests -configuration Debug \
  -destination 'platform=watchOS Simulator,id=4F89FDCE-63D0-4BAD-B60B-B67996F3EF3F' \
  -derivedDataPath /private/tmp/DiveStartCardDemoEndFinalTestsDerivedData \
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
