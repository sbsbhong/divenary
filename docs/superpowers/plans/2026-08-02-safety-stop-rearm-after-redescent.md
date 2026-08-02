# Safety Stop Rearm After Redescent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rearm the watch's three-minute recommended safety-stop reminder when the current depth reaches 10 meters again after a completed stop.

**Architecture:** Keep the change inside the pure Swift `SafetyStopController`. Reuse the existing `armed` state and configuration threshold, reset only the current recommendation-cycle fields, and preserve the existing sync contract and UI states.

**Tech Stack:** Swift, XCTest, watchOS, Xcode CLI, Karpathy LLM Wiki

## Global Constraints

- Divenary remains a non-certified logging and reminder tool.
- Do not add decompression, tissue-loading, ceiling, NDL, safe-ascent, or physiological calculations.
- Rearming uses the current depth sample at `SafetyStopConfiguration.armDepthMeters`, whose default is exactly 10 meters.
- Rearming resets the recommendation to exactly 180 seconds and reuses `SafetyStopStatus.armed`.
- Do not add contract fields, generated-output changes, UI statuses, dependencies, or user-configurable settings.
- Preserve the existing pre-completion 30-second outside-counting-zone reset behavior.
- Use Yarn 1 repository commands; do not update the lockfile.

---

## File Structure

- `apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift`: owns the completed-to-armed transition and recommendation-cycle reset.
- `apps/mobile/ios/DivenaryWatchAppTests/SafetyStopControllerTests.swift`: proves the threshold, field reset, and fresh countdown behavior.
- `.wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md`: preserves the approved design as source material.
- `.wiki/wiki/domains/diving-app-scuba-mode.md`: records the implemented reminder rule and safety boundary.
- `.wiki/wiki/index.md`: refreshes the Scuba Mode article date.
- `.wiki/wiki/log.md`: records the wiki ingest operation.

### Task 1: Rearm The Completed Safety-Stop Controller

**Files:**
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/SafetyStopControllerTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift`

**Interfaces:**
- Consumes: `SafetyStopConfiguration.armDepthMeters`, `SafetyStopConfiguration.durationSeconds`, `DepthSample.depthMeters`, and existing `SafetyStopStatus.armed`.
- Produces: `SafetyStopController.update(maxDepthMeters:sample:)` transitions `completed -> armed` when `sample.depthMeters >= armDepthMeters`, with a fresh recommendation cycle exposed through `record`.

- [ ] **Step 1: Write focused failing controller tests**

Replace `testCompletedStateIsNotResetByLaterBelowArmDepthUpdate` with these tests and add the helper near the existing helpers:

```swift
func testCompletedStateRemainsCompletedWhileCurrentDepthIsBelowArmDepth() {
    var controller = completedController()
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 9.9))

    XCTAssertEqual(controller.record.status, .completed)
    XCTAssertTrue(controller.record.completed)
    XCTAssertEqual(controller.record.completedAt, EngineTestFixtures.date(182))
}

func testCompletedStateRearmsAtCurrentArmDepth() {
    var controller = completedController()
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 10))

    XCTAssertEqual(controller.record.status, .armed)
    XCTAssertTrue(controller.record.required)
    XCTAssertFalse(controller.record.completed)
    XCTAssertEqual(controller.record.remainingSeconds, 180, accuracy: 0.01)
    XCTAssertEqual(controller.record.timeInZoneSeconds, 0, accuracy: 0.01)
    XCTAssertNil(controller.record.startedAt)
    XCTAssertNil(controller.record.completedAt)
}

func testRearmedStopStartsFreshCountdownOnReturningToCountingZone() {
    var controller = completedController()
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(190, depth: 10))
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(200, depth: 5))
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(210, depth: 5))

    XCTAssertEqual(controller.record.status, .active)
    XCTAssertEqual(controller.record.startedAt, EngineTestFixtures.date(200))
    XCTAssertEqual(controller.record.remainingSeconds, 170, accuracy: 0.01)
    XCTAssertEqual(controller.record.timeInZoneSeconds, 10, accuracy: 0.01)
}

private func completedController() -> SafetyStopController {
    var controller = activeController()
    controller.update(maxDepthMeters: 12, sample: EngineTestFixtures.sample(182, depth: 5))
    return controller
}
```

- [ ] **Step 2: Run the focused test class and verify RED**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  -only-testing:DivenaryWatchAppTests/SafetyStopControllerTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: FAIL in `testCompletedStateRearmsAtCurrentArmDepth` because the current early return keeps `completed`; the fresh-countdown test also fails because the timer never rearms.

- [ ] **Step 3: Implement the minimal completed-to-armed transition**

Replace the completed/incomplete guard in `update(maxDepthMeters:sample:)` with:

```swift
if status == .completed {
    guard sample.depthMeters >= configuration.armDepthMeters else { return }
    rearmCompletedStop()
}

guard status != .skippedOrIncomplete else {
    return
}
```

Add this helper immediately before `elapsedSinceLastSample(to:)`:

```swift
private mutating func rearmCompletedStop() {
    startedAt = nil
    outsideZoneStartedAt = nil
    completedAt = nil
    remainingSeconds = configuration.durationSeconds
    timeInZoneSeconds = 0
    status = .armed
}
```

Do not change `SafetyStopRecord`, `SafetyStopStatus`, `ScubaDiveEngine`, SwiftUI, or the sync contract.

- [ ] **Step 4: Run the focused test class and verify GREEN**

Run the exact focused `xcodebuild test` command from Step 2.

Expected: `SafetyStopControllerTests` passes, including existing pause, reset, completion, surfacing, and banned-copy assertions.

- [ ] **Step 5: Run the full watch test scheme**

```bash
xcodebuild test \
  -project apps/mobile/ios/Divenary.xcodeproj \
  -scheme DivenaryWatchAppTests \
  -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm)' \
  -derivedDataPath /private/tmp/DivenaryWatchAppTestsDerivedData \
  CODE_SIGNING_ALLOWED=NO
```

Expected: all `DivenaryWatchAppTests` pass.

- [ ] **Step 6: Review and commit the controller fix**

```bash
git diff --check -- apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift apps/mobile/ios/DivenaryWatchAppTests/SafetyStopControllerTests.swift
git diff -- apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift apps/mobile/ios/DivenaryWatchAppTests/SafetyStopControllerTests.swift
git add apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift apps/mobile/ios/DivenaryWatchAppTests/SafetyStopControllerTests.swift
git commit -m "fix: rearm safety stop after redescent"
```

Expected: only the controller and its tests are committed. Existing `.turbo` cache changes remain untouched.

### Task 2: Record The Safety Reminder Rule And Verify The Repository

**Files:**
- Create: `.wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md`
- Modify: `.wiki/wiki/domains/diving-app-scuba-mode.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: the implemented controller behavior and `docs/superpowers/specs/2026-08-02-safety-stop-rearm-after-redescent-design.md`.
- Produces: durable Korean documentation of the current-depth rearm rule, with raw provenance and index/log consistency.

- [ ] **Step 1: Preserve the approved design as an immutable raw source**

Create `.wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md` with:

```markdown
Source URL: docs/superpowers/specs/2026-08-02-safety-stop-rearm-after-redescent-design.md
Collected: 2026-08-02
Published: 2026-08-02

# Safety stop rearm after redescent

The watch safety-stop controller currently treats `completed` as a terminal state. Once the recommended three-minute countdown reaches zero, all later depth samples are ignored. A diver who descends again during the same scuba recording therefore never receives another safety-stop reminder.

After a completed safety stop, reaching a current depth of at least 10 meters rearms the existing three-minute recommended safety-stop reminder. The threshold reuses `SafetyStopConfiguration.armDepthMeters`, depends on the current depth sample rather than historical maximum depth, and is a fixed reminder rule rather than a physiological or decompression calculation.

The controller reuses `armed`. Rearming resets `remainingSeconds` to 180 seconds and `timeInZoneSeconds` to zero, and clears `startedAt`, `completedAt`, and outside-zone timing state. Entering the existing 2.7-6.3 meter counting zone then starts a fresh countdown.

The feature remains a rule-based recommended reminder. It does not claim that a diver is safe to ascend, that decompression is complete, or that three minutes is sufficient for a particular physiological state. It does not replace a certified dive computer or dive plan.
```

- [ ] **Step 2: Update the compiled Scuba Mode article**

In `.wiki/wiki/domains/diving-app-scuba-mode.md`:

1. Append `; safety stop redescent rearm decision and implementation, 2026-08-02` to `Sources:`.
2. Append `; [Safety stop rearm after redescent](../../raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md)` to `Raw:`.
3. Set `Updated:` and `Last reviewed:` to `2026-08-02`.
4. Add this paragraph after the first paragraph in `## v1 Air-only safety stop 범위`:

```markdown
권장 스탑이 완료된 뒤 현재 수심이 `armDepthMeters`의 기본값인 10m에 다시 도달하면 기존 `armed` 상태로 재무장한다. 이때 남은 시간은 180초, stop zone 누적 시간은 0으로 초기화하고 이전 시작·완료 시각을 지운다. 재무장 판단은 session의 과거 `maxDepthMeters`가 아니라 현재 depth sample을 사용한다. 이는 감압 또는 생리 계산식이 아니라 같은 recording 안에서 다시 깊어진 경우에 적용하는 고정 리마인더 규칙이다. 완료 전 counting zone 이탈에 적용되는 기존 30초 reset 규칙은 그대로 유지한다.
```

- [ ] **Step 3: Refresh the wiki index and append the ingest log**

Change the `Diving App / Scuba Mode` row's Updated value in `.wiki/wiki/index.md` from `2026-07-09` to `2026-08-02` without changing its summary.

Append to `.wiki/wiki/log.md`:

```markdown

## [2026-08-02] ingest | Safety stop rearm after redescent
- Added: Safety stop rearm after redescent raw source
- Updated: Diving App / Scuba Mode
- Updated: Knowledge Base Index
- Recorded: completed 권장 스탑 뒤 현재 수심이 10m에 다시 도달하면 같은 recording에서 180초 리마인더를 재무장한다.
- Clarified: 이 동작은 감압·조직 포화 계산이 아닌 고정 리마인더 규칙이며 기존 completed/armed contract를 재사용한다.
```

- [ ] **Step 4: Run the native and repository verification gates**

```bash
yarn watch:build
yarn codex:check
```

Expected: `yarn watch:build` exits 0 for project `apps/mobile/ios/Divenary.xcodeproj`, scheme `DivenaryWatchApp`, destination `generic/platform=watchOS Simulator`, with code signing disabled. Then `yarn codex:check` exits 0 after contract generation, mobile typecheck, and the watch build. CoreSimulator log-permission warnings are environmental when the command exits 0.

- [ ] **Step 5: Review all task files and commit documentation**

```bash
git diff --check -- .wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md .wiki/wiki/domains/diving-app-scuba-mode.md .wiki/wiki/index.md .wiki/wiki/log.md
git diff -- .wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md .wiki/wiki/domains/diving-app-scuba-mode.md .wiki/wiki/index.md .wiki/wiki/log.md
git add .wiki/raw/architecture/2026-08-02-safety-stop-rearm-after-redescent.md .wiki/wiki/domains/diving-app-scuba-mode.md .wiki/wiki/index.md .wiki/wiki/log.md
git commit -m "docs: record safety stop rearm behavior"
git status --short
```

Expected: the wiki source/article/index/log are committed. The only remaining pre-existing changes are the unrelated `.turbo` cache manifests.
