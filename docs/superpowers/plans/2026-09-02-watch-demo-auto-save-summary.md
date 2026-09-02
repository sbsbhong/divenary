# Watch Demo Automatic Save Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically save a completed Watch demo or debug-test recording, then show the saved-log summary with a leading back action and no save/delete controls.

**Architecture:** Move simulated-flow persistence from summary-button actions into the lifecycle controller’s finish transition. The controller owns saving, retry, recorder reset, and terminal navigation states; SwiftUI only renders those states and dismisses after a saved-summary back action. Reuse `SavedSessionSummaryView`, which already matches the real-session summary presentation.

**Tech Stack:** Swift 6 concurrency (`@MainActor`), SwiftUI, XCTest, Xcode watchOS simulator build.

## Global Constraints

- Change only `apps/mobile/ios/DivenaryWatchApp` demo/debug-test completion behaviour; real underwater recording remains unchanged.
- Preserve `0.0 m` as the no-sample initial depth display; do not change Water Lock or sensor behaviour.
- A failed automatic save must retain the captured record and expose only retry; never expose a delete/discard action after capture completes.
- Reuse `SavedSessionSummaryView`; do not duplicate session metric or non-certified safety wording.
- Do not add dependencies, entitlements, generated files, or safety-critical calculations.

---

### Task 1: Make simulated completion persistence controller-owned

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:4-153`
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift:243-551`

**Interfaces:**
- Consumes: `SimulatedRecordingLifecycleRecording.stopSession() -> DiveSessionRecord?`, `SimulatedRecordingSessionStoring.save(_:) -> Bool`.
- Produces: `SimulatedRecordingLifecyclePhase.saving(DiveSessionRecord)`, `.savedSummary(DiveSessionRecord)`, `.savePersistenceError(DiveSessionRecord)`; `finishRecording()`, `retryCompletedSessionSave()`, and `dismissSavedSummary()`.

- [ ] **Step 1: Write the failing lifecycle tests**

Replace explicit-save/discard tests with these cases in `SimulatedRecordingLifecycleControllerTests`:

```swift
func testFinishingAutomaticallySavesAndShowsSavedSummary() {
    let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    let (controller, recorder, store) = makeSystem(session: session)
    controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

    XCTAssertTrue(controller.finishRecording())

    XCTAssertEqual(store.saveCount, 1)
    XCTAssertEqual(recorder.resetCount, 1)
    XCTAssertEqual(recorder.cancelCount, 0)
    assertSavedSummary(controller.phase, sessionID: session.id)
}

func testFailedAutomaticSaveKeepsCaptureForRetry() {
    let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    let (controller, recorder, store) = makeSystem(session: session, saveResults: [false, true])
    controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))

    XCTAssertFalse(controller.finishRecording())
    assertSavePersistenceError(controller.phase, sessionID: session.id)
    XCTAssertEqual(recorder.resetCount, 0)
    XCTAssertEqual(recorder.cancelCount, 0)

    XCTAssertTrue(controller.retryCompletedSessionSave())
    XCTAssertEqual(store.saveCount, 2)
    XCTAssertEqual(recorder.resetCount, 1)
    assertSavedSummary(controller.phase, sessionID: session.id)
}

func testDismissingSavedSummaryCompletesWithoutDeletingSavedRecord() {
    let session = DiveSessionRecord.largeDebugFixture(sampleCount: 1)
    let (controller, recorder, _) = makeSystem(session: session)
    controller.handleFlowAppearance(plan: PreDivePlan(diveMode: .scuba))
    XCTAssertTrue(controller.finishRecording())

    XCTAssertTrue(controller.dismissSavedSummary())

    XCTAssertEqual(recorder.cancelCount, 0)
    assertCompleted(controller.phase)
}
```

Add `assertSavedSummary` and `assertSavePersistenceError` helpers that pattern-match the new associated-value cases.

- [ ] **Step 2: Run test to verify RED**

```bash
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath /private/tmp/DivenaryWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test
```

Expected: compilation failure because the new lifecycle phases and methods do not exist, or assertions fail because `finishRecording()` still stops at `.summary` without saving.

- [ ] **Step 3: Write minimal lifecycle implementation**

```swift
enum SimulatedRecordingLifecyclePhase {
    case ready
    case recording
    case saving(DiveSessionRecord)
    case savedSummary(DiveSessionRecord)
    case persistenceError
    case savePersistenceError(DiveSessionRecord)
    case cleanupError
    case completed
}

@discardableResult
func finishRecording() -> Bool {
    guard case .recording = phase, let session = recorder.stopSession() else { return false }
    return persistCompletedSession(session)
}

@discardableResult
func retryCompletedSessionSave() -> Bool {
    guard case let .savePersistenceError(session) = phase else { return false }
    return persistCompletedSession(session)
}

@discardableResult
func dismissSavedSummary() -> Bool {
    guard case .savedSummary = phase else { return false }
    markCompleted()
    return true
}

@discardableResult
private func persistCompletedSession(_ session: DiveSessionRecord) -> Bool {
    phase = .saving(session)
    guard store.save(session) else {
        phase = .savePersistenceError(session)
        return false
    }
    recorder.resetCompletedSession()
    phase = .savedSummary(session)
    return true
}
```

Update `hidesSystemBackButton` so `.recording`, `.saving`, `.savedSummary`, `.savePersistenceError`, and `.cleanupError` remain app-managed. In `handleFlowDisappearance`, retain cancellation only for `.recording`; never cancel/delete a saved summary or a failed-save record.

- [ ] **Step 4: Run test to verify GREEN**

Run the command from Step 2. Expected: `TEST SUCCEEDED`.

- [ ] **Step 5: Commit the lifecycle and test change**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift
git commit -m "feat(watch): auto-save demo session summaries"
```

### Task 2: Render saved summary and retry UI without destructive actions

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:229-359`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift:107-132`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`

**Interfaces:**
- Consumes: lifecycle `.savedSummary`, `.saving`, `.savePersistenceError`; `SavedSessionSummaryView(session:onBack:)`.
- Produces: a demo completion surface with the same session content and leading chevron back action as a real completed session.

- [ ] **Step 1: Write a failing source-boundary test**

Extend `apps/mobile/scripts/check-watch-ui-language.mjs` to assert that the demo flow source includes `SavedSessionSummaryView`, `retryCompletedSessionSave`, and `dismissSavedSummary`, and excludes `CapturedSessionSummaryView`, `saveSummary`, and `discardSummary`. Give each failed assertion a message naming the deprecated completion control.

- [ ] **Step 2: Run the UI check to verify RED**

```bash
yarn workspace @repo/mobile watch:ui:check
```

Expected: failure because the demo flow still renders `CapturedSessionSummaryView` and contains the old explicit save/discard actions.

- [ ] **Step 3: Write minimal view implementation**

Render phases as:

```swift
case .saving:
    savingView
case .savedSummary(let session):
    SavedSessionSummaryView(session: session, onBack: dismissSavedSummary)
case .savePersistenceError:
    savePersistenceErrorView
```

Make `dismissSavedSummary` call the lifecycle method, remove the Action Button override, then dismiss the route. Add `savingView` and `savePersistenceErrorView` using the existing real-flow copy: `Saving log`, `Keeping your captured log.`, and `Retry Save`. Remove the explicit save/discard helper actions and `CapturedSessionSummaryView` use. Remove the unused `CapturedSessionSummaryView` declaration from `SummaryView.swift`.

- [ ] **Step 4: Run UI and lifecycle verification**

```bash
yarn workspace @repo/mobile watch:ui:check
xcodebuild -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath /private/tmp/DivenaryWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test
```

Expected: UI-source check exits 0 and `TEST SUCCEEDED`.

- [ ] **Step 5: Commit the UI change**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift apps/mobile/scripts/check-watch-ui-language.mjs
git commit -m "feat(watch): show saved demo summary"
```

### Task 3: Verify watch target and final scope

**Files:**
- Verify: `apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift`
- Verify: `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift`
- Verify: `apps/mobile/ios/DivenaryWatchAppTests/ScubaDiveEngineTests.swift`

- [ ] **Step 1: Run repository watch build**

```bash
yarn watch:build
```

Expected: exit 0. Simulator-service warnings are environment noise only when the build succeeds.

- [ ] **Step 2: Review final scope**

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Confirm only planned demo lifecycle, summary view, tests, UI check, and design/plan documentation changed; confirm no contract, entitlement, or sensor logic files changed.

- [ ] **Step 3: Report evidence**

Report the automatic-save lifecycle, removal of explicit Save/Discard controls, retry-on-save-failure behaviour, and verification commands/results. State that physical watch sensor behaviour was not changed or re-tested by this UI-flow change.

