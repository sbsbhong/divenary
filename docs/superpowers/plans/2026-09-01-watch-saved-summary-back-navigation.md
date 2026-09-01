# Watch Saved Summary Back Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the real saved-summary bottom Done button with toolbar back navigation that returns to Home and immediately restores Wet Ready when the current water state is submerged.

**Architecture:** `RealDiveSessionCoordinator` remains the only state-machine authority: dismissing a saved summary first enters `idle`, then processes its injected current water state using the existing Wet Ready transition. `SessionSummaryContent` owns scrollable metrics and an optional footer; the real saved wrapper supplies the iPhone-edit footer and toolbar action, while simulated Save/Discard remains unchanged.

**Tech Stack:** Swift, SwiftUI, XCTest, Xcode CLI, Yarn 1

## Global Constraints

- Saved-summary back navigation must not alter local save, retry, record ID, runtime adoption, active-plan lock, or Water Lock semantics.
- `submerged` after saved-summary dismissal enters Wet Ready; `notSubmerged` and `unknown` remain idle/Home.
- Keep no-sample and start-error Done buttons unchanged.
- Keep demo/debug explicit Save/Discard unchanged.
- Do not add dependencies, change generated contracts, or modify Yarn lockfiles.

---

### Task 1: Restore Wet Ready After Saved-Summary Back Navigation

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`

**Interfaces:**
- Consumes: `dismissSavedSummary()`, injected `WaterSubmersionStateReading`, and existing `receiveWaterState(_:)` transition logic.
- Produces: a saved-summary dismissal that returns to `.idle` and immediately maps a current `.submerged` state to `.wetReady(mode:)`.

- [ ] **Step 1: Write the failing coordinator test**

Add beside `testDismissSavedSummaryOnlyChangesUIState`:

```swift
func testDismissSavedSummaryReentersWetReadyWhenCurrentWaterStateIsSubmerged() {
    let calls = LifecycleCallLog()
    let runtime = FakeDiveRuntime(calls: calls)
    let recorder = FakeDiveRecorder(calls: calls, hasCapturedDepthSample: true)
    let water = FakeWaterStateReader(latestState: .notSubmerged)
    let coordinator = makeCoordinator(runtime: runtime, recorder: recorder, water: water)
    coordinator.startManual(plan: PreDivePlan(diveMode: .freedive))
    runtime.emit(.didInvalidate(reason: .none, errorDescription: nil))

    assertSavedSummary(coordinator)
    water.latestState = .submerged
    coordinator.dismissSavedSummary()

    assertWetReady(coordinator, mode: .scuba)
}
```

The expected `.scuba` is the retained preferred mode; the manual session’s `.freedive` plan must not become the next armed mode.

- [ ] **Step 2: Verify RED**

Run:

```bash
xcodebuild test -quiet \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  -only-testing:DivenaryWatchAppTests/RealDiveSessionCoordinatorTests/testDismissSavedSummaryReentersWetReadyWhenCurrentWaterStateIsSubmerged \
  CODE_SIGNING_ALLOWED=NO
```

Expected: failure because the phase remains `.idle`.

- [ ] **Step 3: Add the minimal state re-evaluation**

Replace the terminal assignment in `dismissSavedSummary()` with:

```swift
phase = .idle
receiveWaterState(water.latestState)
```

Do not duplicate the Wet Ready switch or add a depth/timer threshold; `receiveWaterState(_:)` is the established transition owner.

- [ ] **Step 4: Verify GREEN**

Re-run the Step 2 command.

Expected: the new test passes and the next state is `.wetReady(mode: .scuba)`.

### Task 2: Move Saved-Summary Exit and Edit Guidance Into Navigation and Scroll Content

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`

**Interfaces:**
- Consumes: `SavedSessionSummaryView(session:onBack:)` and shared `SessionSummaryContent`.
- Produces: saved real summary with a `.topBarLeading` toolbar back button, no bottom Done button, and `Edit details on iPhone.` inside its scroll content after the disclaimer.

- [ ] **Step 1: Add a failing static UI regression check**

In `check-watch-ui-language.mjs`, add this check to `checks`:

```javascript
{
  name: 'saved real summary uses toolbar back navigation and a scroll footer',
  failed:
    !/struct SavedSessionSummaryView[\s\S]*ToolbarItem\(placement: \.topBarLeading\)[\s\S]*onBack/.test(summaryViewSource) ||
    /Button\("Done"/.test(
      summaryViewSource.slice(
        summaryViewSource.indexOf('struct SavedSessionSummaryView'),
        summaryViewSource.indexOf('struct CapturedSessionSummaryView'),
      ),
    ) ||
    !/struct SessionSummaryContent[\s\S]*DiveDisclaimer[\s\S]*if let footer[\s\S]*Text\(footer\)/.test(summaryViewSource),
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
yarn workspace @repo/mobile watch:ui:check
```

Expected: failure for `saved real summary uses toolbar back navigation and a scroll footer`.

- [ ] **Step 3: Keep the footer inside `SessionSummaryContent` and use a toolbar back action**

Change the shared view interface and bottom stack as follows:

```swift
struct SessionSummaryContent: View {
    let session: DiveSessionRecord
    let statusTitle: LocalizedStringKey
    let footer: LocalizedStringKey?
    // …
    DiveDisclaimer(text: String(localized: "SAVED LOG ONLY. NON-CERTIFIED ASSISTANT."))
    if let footer {
        Text(footer)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(DiveWatchTheme.mutedText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
}
```

Update the real wrapper and call site:

```swift
struct SavedSessionSummaryView: View {
    let session: DiveSessionRecord
    let onBack: () -> Void

    var body: some View {
        SessionSummaryContent(
            session: session,
            statusTitle: "Saved",
            footer: "Edit details on iPhone."
        )
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel("Back")
            }
        }
    }
}
```

`CapturedSessionSummaryView` passes `footer: nil`. In `RealRecordingFlowView`, pass `onBack: coordinator.dismissSavedSummary`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
yarn workspace @repo/mobile watch:ui:check
xcodebuild test -quiet \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  -only-testing:DivenaryWatchAppTests/RealDiveSessionCoordinatorTests \
  CODE_SIGNING_ALLOWED=NO
yarn watch:build
```

Expected: all commands exit 0.

- [ ] **Step 5: Review and commit**

Run:

```bash
git diff --check -- apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/scripts/check-watch-ui-language.mjs
git add apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): streamline saved summary exit"
```

Do not stage existing `.turbo` cache changes or an unrelated `Localizable.xcstrings` reordering.
