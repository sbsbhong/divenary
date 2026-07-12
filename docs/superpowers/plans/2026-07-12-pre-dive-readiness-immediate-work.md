# Pre-Dive Readiness Immediate Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Finish the three immediate pre-dive tasks by validating dry-device WatchConnectivity behavior, serializing duplicate imports, preserving unknown water temperature, separating cloud status from local import acknowledgement, and promoting the remaining pre-dive backlog to P0.

**Architecture:** Keep Watch transport, iPhone local import, and future remote sync as separate layers. Route automatic and manual Watch imports through one process-wide coordinator, make Watch temperature optional end to end, migrate mobile log persistence to explicit cloudSyncStatus, then record physical-device evidence and update the durable wiki and pending-work skill.

**Tech Stack:** React Native 0.85.3, React 19, TypeScript 5.8, Jest, TanStack Query, AsyncStorage, Swift, SwiftUI, Core Motion CMWaterSubmersionManager, WatchConnectivity, Xcode CLI, Yarn 1.22.22.

## Global Constraints

- Use Yarn 1.22.22; do not update lockfiles with npm, pnpm, or bun.
- Do not add dependencies.
- Do not modify generated contract output directly.
- Preserve raw Watch captures and all manual mobile edits during migration or re-import.
- Do not calculate or imply NDL, ceiling, tissue loading, gas-switching safety, decompression obligation, or emergency decisions.
- A shallow-water result is not evidence for deep water, sustained ascent/descent, freediving, or scuba validation.
- Count physical-device cases and commands as passed only when actually run and recorded with build, device, OS, and connection conditions.
- Preserve unrelated existing changes in skills-lock.json and untracked .agents/skills directories.

---

## File Map

### WatchConnectivity import ownership

- Create: apps/mobile/src/states/watch-connectivity-import-coordinator.ts
- Modify: apps/mobile/src/states/watch-connectivity-sync.tsx
- Test: apps/mobile/__tests__/watch-connectivity-sync.test.tsx

### Optional temperature ownership

- Modify: apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift
- Modify: apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift
- Modify: apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift
- Modify: apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift
- Modify: apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift
- Modify: apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift
- Modify: apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift
- Modify: apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift
- Test: apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift
- Test: apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift
- Test: apps/mobile/__tests__/watch-connectivity-native-source.test.ts

### Mobile cloud status ownership

- Modify: apps/mobile/src/types/dive-log-entry.ts
- Modify: apps/mobile/src/repositories/persistent-dive-log-repository.ts
- Modify: apps/mobile/src/repositories/local-dive-log-repository.ts
- Modify: apps/mobile/src/utils/create-dive-log-entry.ts
- Modify: apps/mobile/src/utils/watch-session-to-dive-log-entry.ts
- Delete: apps/mobile/src/utils/dive-log-sync-status.ts
- Modify: apps/mobile/src/states/use-dive-logbook.ts
- Modify: apps/mobile/src/states/watch-connectivity-sync.tsx
- Modify: apps/mobile/src/screens/logbook/screen.tsx
- Modify: apps/mobile/src/screens/home/screen.tsx
- Modify: apps/mobile/src/screens/logbook/log-entry-form-schema.ts
- Modify: apps/mobile/src/i18n/resources.ts
- Test: affected fixtures and assertions under apps/mobile/__tests__

### Physical validation and backlog ownership

- Create: docs/verification/watchconnectivity/2026-07-12-dry-device-results.md
- Modify: docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md
- Modify: .agents/skills/pending-work/SKILL.md
- Create: .wiki/raw/decisions/2026-07-12-pre-dive-readiness-immediate-work.md
- Modify: .wiki/wiki/architecture/implementation-priorities.md
- Modify: .wiki/wiki/questions/open-questions.md
- Modify: .wiki/wiki/architecture/sync-flow.md
- Modify: .wiki/wiki/architecture/watch-app.md
- Modify: .wiki/wiki/architecture/mobile.md
- Modify: .wiki/wiki/project/diving-app-qa-test-plan.md
- Modify: .wiki/wiki/index.md and .wiki/wiki/log.md

---

### Task 1: Capture the Current Dry-Device Baseline

**Files:**
- Create: docs/verification/watchconnectivity/2026-07-12-dry-device-results.md
- Reference: docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md

**Interfaces:**
- Consumes: current commit 07b1d45 and existing DiveMobile, DiveWatchApp, and DiveWatchAppDebug schemes.
- Produces: evidence with device identities, OS versions, build commit, reachability, reproduction steps, crash/log, and per-case status.

- [ ] **Step 1: Discover physical devices outside the sandbox**

Run:

~~~bash
xcrun devicectl list devices
xcodebuild -workspace apps/mobile/ios/DiveMobile.xcworkspace -scheme DiveMobile -showdestinations
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppDebug -showdestinations
~~~

Expected: the paired iPhone appears as an iOS destination. Record whether the Watch is a direct destination or installs through the paired iPhone. If CoreDevice reports an XPC timeout, rerun unsandboxed before changing source.

- [ ] **Step 2: Create the evidence file with explicit unknown results**

Create this exact structure, using NOT RUN instead of empty cells:

~~~markdown
# WatchConnectivity Dry-Device Results - 2026-07-12

- Git commit: 07b1d45
- Build identifier: NOT RUN
- iPhone / iOS: NOT RUN
- Apple Watch / watchOS: NOT RUN
- Pairing / companion install: NOT RUN

| Case | Connection and app state | Payload evidence | Result | Crash/log |
|---|---|---|---|---|
| Connected Test Scuba auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Connected Test Freedive auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Offline save then reconnect auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Reconnect auto import plus manual drain | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Manual retry after delayed auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Duplicate delivery dedupe | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iPhone background delivery | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iPhone killed then launch drain | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Planned dive round trip | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Watch acknowledgement status | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

## Baseline conclusion

NOT RUN

## Post-change regression

NOT RUN
~~~

- [ ] **Step 3: Build and install the baseline**

Run:

~~~bash
xcodebuild -workspace apps/mobile/ios/DiveMobile.xcworkspace -scheme DiveMobile -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath /private/tmp/DiveMobilePhysicalDerivedData -allowProvisioningUpdates build
~~~

Expected: a signed DiveMobile.app containing DiveWatchApp.app. Install the exact product printed by xcodebuild through Xcode or xcrun devicectl, confirm the companion appears on the Watch, and record any signing blocker verbatim.

- [ ] **Step 4: Run the reconnect matrix before source edits**

Use DiveWatchAppDebug Test Scuba and Test Freedive. For offline save, first confirm Settings reports unreachable, save the Watch session, restore connectivity, observe automatic import before manual sync, then repeat while pressing Watch Sync immediately after reconnect.

Expected: every performed case is PASS, FAIL, BLOCKED, or NOT REPRODUCED with exact steps. A crash includes a crash report filename or console excerpt.

- [ ] **Step 5: Commit the baseline evidence**

~~~bash
git add docs/verification/watchconnectivity/2026-07-12-dry-device-results.md
git commit -m "test: record watch reconnect baseline"
~~~

---

### Task 2: Serialize Automatic and Manual Watch Imports

**Files:**
- Create: apps/mobile/src/states/watch-connectivity-import-coordinator.ts
- Modify: apps/mobile/src/states/watch-connectivity-sync.tsx
- Test: apps/mobile/__tests__/watch-connectivity-sync.test.tsx

**Interfaces:**
- Consumes: WatchConnectivityPayload and an async import callback.
- Produces: WatchConnectivityImportCoordinator.run<T>(payload, operation): Promise<T> and one default coordinator shared by provider events and manual drain.

- [ ] **Step 1: Write failing concurrency tests**

Block the first repository import with a deferred promise. Invoke provider event and importPendingWatchConnectivityPayloads concurrently with the same payloadId. Require one repository import, one acknowledgement, and one notification. Add a distinct-payload/same-import-key case that requires two acknowledgements and one repository row.

~~~ts
expect(repository.importWatchMessages).toHaveBeenCalledTimes(1);
expect(acknowledgeImportedPayloads).toHaveBeenCalledTimes(1);
expect(notifyImportedEntry).toHaveBeenCalledTimes(1);

expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(1, ['payload-a']);
expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(2, ['payload-b']);
expect(await repository.list()).toHaveLength(1);
~~~

- [ ] **Step 2: Verify the tests fail**

~~~bash
yarn workspace @repo/mobile test --runInBand watch-connectivity-sync.test.tsx
~~~

Expected: FAIL because automatic and manual paths import independently.

- [ ] **Step 3: Implement the coordinator**

Create:

~~~ts
import type { WatchConnectivityPayload } from '../native/watch-connectivity';

export class WatchConnectivityImportCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly inFlightByPayloadId = new Map<string, Promise<unknown>>();

  run<T>(payload: WatchConnectivityPayload, operation: () => Promise<T>): Promise<T> {
    const payloadId = payload.payloadId;
    const existing = payloadId ? this.inFlightByPayloadId.get(payloadId) : undefined;
    if (existing) {
      return existing as Promise<T>;
    }

    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);

    if (payloadId) {
      this.inFlightByPayloadId.set(payloadId, result);
      const clearInFlight = () => {
        if (this.inFlightByPayloadId.get(payloadId) === result) {
          this.inFlightByPayloadId.delete(payloadId);
        }
      };
      void result.then(clearInFlight, clearInFlight);
    }

    return result;
  }
}

export const defaultWatchConnectivityImportCoordinator =
  new WatchConnectivityImportCoordinator();
~~~

Inject coordinator into provider props and manual import options. Wrap the existing single-payload body with coordinator.run. Keep validation, save, acknowledgement, plan completion, and notification inside the coordinated operation.

- [ ] **Step 4: Add queue recovery coverage**

Reject the first distinct payload and resolve the second. Require no acknowledgement for the failed payload, acknowledgement for the second, and one stored row.

~~~ts
expect(acknowledgeImportedPayloads).not.toHaveBeenCalledWith(['failed-payload']);
expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['retry-payload']);
expect(await repository.list()).toHaveLength(1);
~~~

- [ ] **Step 5: Run the focused suite**

~~~bash
yarn workspace @repo/mobile test --runInBand watch-connectivity-sync.test.tsx
~~~

Expected: PASS, including invalid payload, source plan, duplicate demo, open-to-ended, and repository failure cases.

- [ ] **Step 6: Commit**

~~~bash
git add apps/mobile/src/states/watch-connectivity-import-coordinator.ts apps/mobile/src/states/watch-connectivity-sync.tsx apps/mobile/__tests__/watch-connectivity-sync.test.tsx
git commit -m "fix: serialize watch payload imports"
~~~

---

### Task 3: Preserve Unknown Watch Temperature

**Files:**
- Modify: apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift
- Modify: apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift
- Modify: apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift
- Modify: apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift
- Modify: apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift
- Modify: apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift
- Modify: apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift
- Modify: apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift
- Test: apps/mobile/ios/DiveWatchAppTests/EngineTestFixtures.swift
- Test: apps/mobile/ios/DiveWatchAppTests/ScubaDiveEngineTests.swift
- Test: apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift
- Test: apps/mobile/__tests__/watch-connectivity-native-source.test.ts

**Interfaces:**
- Consumes: existing optional waterTemperatureCelsius in the JSON contract.
- Produces: DepthSample.waterTemperatureCelsius: Double?; summaries average only measured values; payloads omit unknown temperature.

- [ ] **Step 1: Write failing Swift tests**

Change EngineTestFixtures.sample to temperature: Double? = 24. Add:

~~~swift
func testEngineKeepsDepthSamplesWithoutTemperatureAndAveragesMeasuredValuesOnly() {
    let start = Date(timeIntervalSince1970: 100)
    var engine = ScubaDiveEngine(startedAt: start, gasLabel: "Air")
    engine.append(EngineTestFixtures.sample(0, depth: 1, temperature: nil))
    engine.append(EngineTestFixtures.sample(60, depth: 10, temperature: 20))
    engine.append(EngineTestFixtures.sample(120, depth: 5, temperature: 22))

    let session = engine.finish(at: start.addingTimeInterval(180))

    XCTAssertEqual(session.maxDepthMeters, 10)
    XCTAssertEqual(session.waterTemperatureCelsius, 21)
}
~~~

Add a record encoding test that builds one valid depth/pressure sample with nil temperature, encodes syncMessageData, parses JSONSerialization, and asserts the sample dictionary has no waterTemperatureCelsius key.

~~~swift
func testSyncPayloadOmitsUnknownSampleTemperature() throws {
    let base = Self.debugScubaRecord()
    let record = DiveSessionRecord(
        id: base.id,
        schemaVersion: base.schemaVersion,
        captureMode: base.captureMode,
        diveMode: base.diveMode,
        siteId: base.siteId,
        siteName: base.siteName,
        sourcePlanLocalId: base.sourcePlanLocalId,
        planTitle: base.planTitle,
        buddyIds: base.buddyIds,
        gearIds: base.gearIds,
        tags: base.tags,
        notes: base.notes,
        rating: base.rating,
        perceivedExertion: base.perceivedExertion,
        visibilityRating: base.visibilityRating,
        waterCondition: base.waterCondition,
        syncStatus: base.syncStatus,
        entryLocation: base.entryLocation,
        exitLocation: base.exitLocation,
        startedAt: base.startedAt,
        endedAt: base.endedAt,
        samples: [EngineTestFixtures.sample(0, depth: 1, temperature: nil)],
        payload: base.payload
    )
    let session = try syncSessionObject(from: record)
    let samples = try XCTUnwrap(session["samples"] as? [[String: Any]])

    XCTAssertNil(try XCTUnwrap(samples.first)["waterTemperatureCelsius"])
}
~~~

- [ ] **Step 2: Verify failure**

~~~bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/ScubaDiveEngineTests -only-testing:DiveWatchAppTests/DiveSessionRecordMigrationTests
~~~

Expected: compile/test failure because temperature is non-optional and current averages include every sample.

- [ ] **Step 3: Make temperature optional at the sample boundary**

~~~swift
let waterTemperatureCelsius: Double?

var isValidRecordingSample: Bool {
    depthMeters.isFinite
        && pressureKPa.isFinite
        && waterTemperatureCelsius.map { $0.isFinite } != false
        && depthMeters >= 0
        && pressureKPa >= 0
}
~~~

Pass latestTemperatureCelsius directly from RealDepthSensorProvider. In DiveSessionRecorder.append:

~~~swift
if let measuredTemperature = sample.waterTemperatureCelsius {
    waterTemperatureCelsius = measuredTemperature
}
~~~

- [ ] **Step 4: Average only measured values everywhere**

Use this exact rule in ScubaDiveEngine, DiveSampleStats, and both DiveSessionSummary initializers:

~~~swift
let temperatures = samples.compactMap(\.waterTemperatureCelsius)
let averageWaterTemperatureCelsius = temperatures.isEmpty
    ? nil
    : temperatures.reduce(0, +) / Double(temperatures.count)
~~~

Keep finite-value sanitization for measured values.

- [ ] **Step 5: Hide absent summary temperature**

In SummaryView and SessionDetailView:

~~~swift
if let averageTemperature = summary.averageWaterTemperatureCelsius {
    SummaryRow(
        title: String(localized: "Average temp"),
        value: DiveFormatters.temperature(averageTemperature)
    )
}
~~~

Recording keeps DiveFormatters.temperature(Double?), which renders unknown as --.

- [ ] **Step 6: Add source-boundary assertions**

Assert DepthSample contains Double?, RealDepthSensorProvider does not contain latestTemperatureCelsius ?? 0, and summary code uses compactMap.

- [ ] **Step 7: Run tests and Watch build**

~~~bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/ScubaDiveEngineTests -only-testing:DiveWatchAppTests/DiveSessionRecordMigrationTests
yarn workspace @repo/mobile test --runInBand watch-connectivity-native-source.test.ts
yarn watch:build
~~~

Expected: PASS. If the simulator is unavailable, run build-for-testing with generic/platform=watchOS Simulator and report Swift tests as unexecuted.

- [ ] **Step 8: Commit**

~~~bash
git add apps/mobile/ios/DiveWatchApp apps/mobile/ios/DiveWatchAppTests apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "fix: preserve unknown watch temperature"
~~~

---

### Task 4: Separate Mobile Cloud Status from Watch Transfer

**Files:**
- Modify: apps/mobile/src/types/dive-log-entry.ts
- Modify: apps/mobile/src/repositories/persistent-dive-log-repository.ts
- Modify: apps/mobile/src/repositories/local-dive-log-repository.ts
- Modify: apps/mobile/src/utils/create-dive-log-entry.ts
- Modify: apps/mobile/src/utils/watch-session-to-dive-log-entry.ts
- Delete: apps/mobile/src/utils/dive-log-sync-status.ts
- Modify: apps/mobile/src/states/use-dive-logbook.ts
- Modify: apps/mobile/src/states/watch-connectivity-sync.tsx
- Modify: apps/mobile/src/screens/logbook/screen.tsx
- Modify: apps/mobile/src/screens/home/screen.tsx
- Modify: apps/mobile/src/screens/logbook/log-entry-form-schema.ts
- Modify: apps/mobile/src/i18n/resources.ts
- Test: apps/mobile/__tests__/persistent-dive-log-repository.test.ts
- Test: apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts
- Test: apps/mobile/__tests__/use-dive-logbook.test.ts
- Test: apps/mobile/__tests__/logbook-manual-entry.test.tsx
- Test: apps/mobile/__tests__/App.test.tsx
- Test: every mobile entry fixture found by rg

**Interfaces:**
- Consumes: legacy DiveLogEntry.syncStatus and generated Watch session.syncStatus.
- Produces: DiveLogEntry.cloudSyncStatus with notConfigured, pending, synced, failed; raw Watch transfer status remains at watchCapture.session.syncStatus.

- [ ] **Step 1: Write failing migration tests**

Store schema-2 entries with all legacy status values under mobileStorageKeys.logbook. Require:

~~~ts
expect(entries.map(entry => entry.cloudSyncStatus)).toEqual([
  'notConfigured',
  'notConfigured',
  'notConfigured',
  'notConfigured',
]);
expect(watchEntry.watchCapture?.session.syncStatus).toBe('synced');
expect(watchEntry.manual.notes).toBe('Keep mobile edits.');
~~~

- [ ] **Step 2: Write failing UI and conversion tests**

~~~ts
expect(watchSessionToDiveLogEntry({ session }).cloudSyncStatus).toBe('notConfigured');
expect(diveLogEntryToMobileSession(entry).syncStatus)
  .toBe(entry.watchCapture?.session.syncStatus);
expect(root.findAllByProps({ testID: 'logbook-filter-synced' })).toHaveLength(0);
expect(root.findAllByProps({ testID: 'logbook-filter-pending' })).toHaveLength(0);
~~~

Also require the Home latest-log header to have no status pill.

- [ ] **Step 3: Verify failure**

~~~bash
yarn workspace @repo/mobile test --runInBand persistent-dive-log-repository.test.ts watch-session-to-dive-log-entry.test.ts use-dive-logbook.test.ts logbook-manual-entry.test.tsx App.test.tsx
~~~

Expected: FAIL because mobile entries use syncStatus, schema is 2, and cloud filters/pills render.

- [ ] **Step 4: Add the explicit cloud field**

~~~ts
export type CloudSyncStatus =
  | 'notConfigured'
  | 'pending'
  | 'synced'
  | 'failed';

export type DiveLogEntry = {
  localId: string;
  remoteId?: string;
  ownerUserId?: string;
  source: DiveLogSource;
  cloudSyncStatus: CloudSyncStatus;
  // retain existing timestamps, fields, capture, and provenance
};
~~~

Set cloudSyncStatus: 'notConfigured' in manual creation, Watch conversion, local import final save, and mobile fixtures. Never rewrite watchCapture.session.syncStatus.

- [ ] **Step 5: Implement schema-3 migration**

Keep key dive-app:logbook:v2 so installed data is found, set PersistentJsonStore schemaVersion to 3, and use:

~~~ts
type LegacyDiveLogEntry = Omit<DiveLogEntry, 'cloudSyncStatus'> & {
  syncStatus?: 'localOnly' | 'pending' | 'synced' | 'failed';
};

function migrateLogbookEnvelope(
  envelope: StoredEnvelope<unknown>,
): DiveLogEntry[] {
  if (envelope.schemaVersion === 3) {
    return envelope.value as DiveLogEntry[];
  }

  if (envelope.schemaVersion === 2 && Array.isArray(envelope.value)) {
    return (envelope.value as LegacyDiveLogEntry[]).map(
      ({ syncStatus: _legacyStatus, ...entry }) => ({
        ...entry,
        cloudSyncStatus: 'notConfigured',
      }),
    );
  }

  throw new UnsupportedStorageVersionError(
    mobileStorageKeys.logbook,
    Number(envelope.schemaVersion),
  );
}
~~~

Import StoredEnvelope and UnsupportedStorageVersionError from persistent-json-store. Keep the v1 key reset behavior.

- [ ] **Step 6: Remove false cloud UI and mapping**

Delete dive-log-sync-status.ts. In diveLogEntryToMobileSession, do not override syncStatus for Watch captures; spread preserves Watch transfer provenance. Manual sessions omit it. Remove Logbook cloud filter state/control, per-row cloud pill, syncStatusTone, and Home latest-log status pill. Remove now-unused labels.

- [ ] **Step 7: Update fixtures without changing raw Watch status**

Run rg -l '\\bsyncStatus:' apps/mobile/src apps/mobile/__tests__. Replace only mobile DiveLogEntry fields with cloudSyncStatus. Keep generated/raw Watch session syncStatus. Preserve entry.cloudSyncStatus in log-entry-form-schema.ts.

- [ ] **Step 8: Run status suites and typecheck**

~~~bash
yarn workspace @repo/mobile test --runInBand persistent-dive-log-repository.test.ts watch-session-to-dive-log-entry.test.ts use-dive-logbook.test.ts logbook-manual-entry.test.tsx App.test.tsx watch-connectivity-sync.test.tsx watch-sync-notification-service.test.ts
yarn mobile:typecheck
rg -n 'DiveLogSyncStatus|toVisibleCloudSyncStatus|toMobileSessionSyncStatus|entry\.syncStatus' apps/mobile/src apps/mobile/__tests__
~~~

Expected: tests and typecheck PASS; final rg has no matches. Raw session.syncStatus remains.

- [ ] **Step 9: Commit**

~~~bash
git add apps/mobile/src apps/mobile/__tests__
git commit -m "refactor: separate cloud and watch sync status"
~~~

---

### Task 5: Add a Deterministic Large-Session Debug Fixture

**Files:**
- Modify: apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift
- Modify: apps/mobile/ios/DiveWatchApp/Views/HomeView.swift
- Test: apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift
- Test: apps/mobile/__tests__/watch-connectivity-native-source.test.ts

**Interfaces:**
- Consumes: DiveSessionRecord.debugTestTag, debug controls, and WatchSyncEnvelope.directMessagePayloadLimitBytes.
- Produces: DEBUG-only DiveSessionRecord.largeDebugFixture(sampleCount:) extracted from the existing 8,000-sample test helper, plus a Test Large Sync action through the normal store/transport path.

- [ ] **Step 1: Write a failing payload-size test**

~~~swift
func testLargeDebugFixtureExceedsDirectMessageLimit() throws {
    let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1_200)
    let data = try record.syncMessageData()

    XCTAssertGreaterThan(
        data.count,
        WatchSyncEnvelope.directMessagePayloadLimitBytes
    )
    XCTAssertEqual(record.captureMode, .demo)
    XCTAssertTrue(record.tags.contains(DiveSessionRecord.debugTestTag))
}
~~~

- [ ] **Step 2: Verify failure**

Run the Task 3 Watch test command with only-testing DiveSessionRecordMigrationTests/testLargeDebugFixtureExceedsDirectMessageLimit.

Expected: compile failure because largeDebugFixture is absent.

- [ ] **Step 3: Implement the DEBUG fixture and action**

Move the existing deterministic sample construction from the test-only largeDebugScubaRecord helper into the DEBUG factory, then have the existing transport-size tests call the production factory. The factory uses finite samples with this shape:

~~~swift
let samples = (0..<sampleCount).map { index in
    let depth = Double(index % 300) / 10
    return DepthSample(
        timestamp: startedAt.addingTimeInterval(Double(index)),
        depthMeters: depth,
        pressureKPa: 101.325 + depth * 10,
        waterTemperatureCelsius: 24 - depth * 0.03
    )
}
~~~

Build a completed demo scuba record with debug-test-capture. Guard factory and Home action with #if DEBUG and DIVE_WATCH_DEBUG_CONTROLS. Add compact Test Large Sync that saves/enqueues through DiveSessionStore and WatchSyncTransport. Do not expose it in release.

- [ ] **Step 4: Add source assertions**

Require largeDebugFixture, debugTestTag, #if DEBUG, and the normal store/transport calls.

- [ ] **Step 5: Run tests and build**

~~~bash
xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Ultra 3 (49mm),OS=26.5' -derivedDataPath /private/tmp/DiveWatchAppDerivedData CODE_SIGNING_ALLOWED=NO test -only-testing:DiveWatchAppTests/DiveSessionRecordMigrationTests
yarn workspace @repo/mobile test --runInBand watch-connectivity-native-source.test.ts
yarn watch:build
~~~

Expected: PASS and encoded fixture size above the direct-message threshold.

- [ ] **Step 6: Commit**

~~~bash
git add apps/mobile/ios/DiveWatchApp apps/mobile/ios/DiveWatchAppTests apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "test: add large watch sync fixture"
~~~

---

### Task 6: Run Post-Change Physical Regression

**Files:**
- Modify: docs/verification/watchconnectivity/2026-07-12-dry-device-results.md
- Modify: docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md

**Interfaces:**
- Consumes: Tasks 2-5 and paired physical devices.
- Produces: completed post-change dry matrix and explicit unrun shallow-water cases.

- [ ] **Step 1: Build and install the changed app**

Repeat Task 1 with derived data /private/tmp/DiveMobilePhysicalDerivedDataPostChange. Record exact commit/build.

- [ ] **Step 2: Repeat every baseline case**

Repeat connected captures, offline reconnect, immediate manual drain, background, killed-launch drain, planned-dive round trip, acknowledgement, and Test Large Sync file transfer.

Expected: no crash; one row per import key; acknowledgement only after local save; Watch status reflects local import acknowledgement.

- [ ] **Step 3: Update evidence and checklist**

Use PASS, FAIL, BLOCKED, or NOT RUN. Add payload bytes and transport for Test Large Sync. Split checklist headings into Dry physical-device gate, Shallow-water gate, and Real-dive-only gate. Leave unperformed cases unchecked.

- [ ] **Step 4: Commit**

~~~bash
git add docs/verification/watchconnectivity/2026-07-12-dry-device-results.md docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md
git commit -m "test: verify watch sync on paired devices"
~~~

---

### Task 7: Promote All Remaining Pre-Dive Work to P0

**Files:**
- Modify: .agents/skills/pending-work/SKILL.md
- Create: .wiki/raw/decisions/2026-07-12-pre-dive-readiness-immediate-work.md
- Modify: .wiki/wiki/architecture/implementation-priorities.md
- Modify: .wiki/wiki/questions/open-questions.md
- Modify: .wiki/wiki/architecture/sync-flow.md
- Modify: .wiki/wiki/architecture/watch-app.md
- Modify: .wiki/wiki/architecture/mobile.md
- Modify: .wiki/wiki/project/diving-app-qa-test-plan.md
- Modify: .wiki/wiki/index.md
- Modify: .wiki/wiki/log.md

**Interfaces:**
- Consumes: Tasks 1-6 evidence.
- Produces: P0 waves 0-5, separate Real-dive gate, closed immediate questions, and pending-work recommendations from the earliest incomplete dependency wave.

- [ ] **Step 1: Update pending-work behavior**

Add exact rules:

~~~markdown
- Treat every unimplemented task that can be designed, built, or validated before actual freediving/scuba as P0 pre-dive.
- Group P0 into dependency waves: immediate hardening, dry physical-device validation, shallow submersion validation, remote foundation, product completion, safety/release readiness.
- Keep actual freedive/scuba-only validation in a separate Real-dive gate.
- Recommend the next 1-3 tasks from the earliest incomplete wave, but do not describe later P0 waves as lower priority.
~~~

Keep local import separate from cloud sync.

- [ ] **Step 2: Add raw evidence**

Record commits, commands/outcomes, physical matrix, crash result, optional temperature, cloud migration, P0 waves, Real-dive gate, and safety boundary.

- [ ] **Step 3: Compile wiki updates**

State the coordinator, acknowledgement/cloud boundary, cloudSyncStatus notConfigured, unknown-until-measured temperature, completed physical cases, remaining shallow/real-dive cases, and all Supabase/auth, Memory/share, migration, product, and safety-boundary work as P0 dependency waves.

Close only questions proved by code and recorded tests.

- [ ] **Step 4: Run repository checks**

~~~bash
yarn codex:check
yarn workspace @repo/mobile test --runInBand
~~~

Expected: PASS.

- [ ] **Step 5: Check stale vocabulary**

~~~bash
rg -n 'DiveLogSyncStatus|toVisibleCloudSyncStatus|toMobileSessionSyncStatus|entry\.syncStatus|cloud-pending' apps/mobile/src apps/mobile/__tests__ .wiki/wiki
~~~

Expected: no code matches. Wiki matches only describe replaced historical behavior.

- [ ] **Step 6: Commit**

~~~bash
git add .agents/skills/pending-work/SKILL.md .wiki docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md
git commit -m "docs: prioritize the full pre-dive backlog"
~~~

---

### Task 8: Final Review and Handoff

**Files:**
- Review: all files changed by Tasks 1-7
- Review: docs/superpowers/specs/2026-07-12-pre-dive-readiness-immediate-work-design.md
- Review: docs/verification/watchconnectivity/2026-07-12-dry-device-results.md

**Interfaces:**
- Consumes: all deliverables.
- Produces: evidence-backed Wave 0 completion and exact next P0 wave.

- [ ] **Step 1: Review commits and diff**

~~~bash
git status --short
git log --oneline 07b1d45..HEAD
git diff --stat 07b1d45..HEAD
git diff --check 07b1d45..HEAD
~~~

Expected: only intentional files, no whitespace errors, no unrelated skill-install changes.

- [ ] **Step 2: Re-run completion gates**

~~~bash
yarn codex:check
yarn workspace @repo/mobile test --runInBand
~~~

Expected: PASS with fresh output.

- [ ] **Step 3: Check all design completion criteria**

Confirm all eight criteria. A blocked device command is not pass. A fully exercised but non-reproduced crash is recorded as NOT REPRODUCED.

- [ ] **Step 4: Prepare handoff**

Report commits, crash result/evidence, temperature behavior, state separation, actual automated outcomes, actual dry-device outcomes, unrun shallow/real-dive gates, and next P0 wave.
