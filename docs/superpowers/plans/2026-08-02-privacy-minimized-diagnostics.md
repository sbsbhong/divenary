# Privacy-Minimized Mobile and Watch Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-minimized, device-local diagnostic pipeline that records bounded Mobile/Watch events, automatically copies Watch diagnostics to iPhone, supports fixed-category incident markers and manual JSONL export, and leaves remote collection disabled behind a future sink boundary.

**Architecture:** `packages/contracts` generates the shared diagnostic batch/event types. React Native and watchOS record only allowlisted structured events into platform-owned segmented journals; the existing `WCSession` owners transfer diagnostic batches through a distinct kind, pending queue, acknowledgement, and purge protocol. Settings reads summary/export APIs from the native journal, while all recording remains best effort and independent of dive-session import, local repository, account sync, and guest-claim success.

**Tech Stack:** JSON Schema, Node ESM generators, TypeScript, React Native 0.85.3, Jest, Swift/Foundation/CryptoKit/WatchConnectivity/XCTest, Kotlin/Android internal storage/JUnit, React Navigation, i18next.

## Global Constraints

- Keep Yarn 1.22.22 and the existing workspaces; do not update the lockfile with npm, pnpm, or bun.
- Add no third-party telemetry, file-system, sharing, or crash-reporting SDK in this phase.
- All builds use the same privacy policy. Never persist account/user IDs, email, Auth tokens or credentials, device names or stable device IDs, location, site, notes, media, plans, dive values/samples, session IDs, or raw sync payloads.
- Permit only schema-declared enum values, booleans, counts, durations, retry counts, coarse app/OS/device metadata, UUID-scoped event/operation IDs, and normalized stack fingerprints.
- Treat timestamp and coarse device metadata as minimized diagnostics, not guaranteed anonymous data.
- Watch retention is 3 days or 1 MiB; iPhone/Android retention is 14 days or 10 MiB. Prune at whichever limit is reached first.
- Diagnostics are best effort. Journal, transfer, export, or purge failure must not change recording, session save, Watch import acknowledgement, account sync, or guest claim results.
- Watch diagnostic transfer/ACK/purge kinds and durable state must remain distinct from dive-session file transfer, planned-dive state, deletion commands, and import ACK.
- Phase 1 never uploads diagnostics automatically. Remote provider selection, consent/opt-out, privacy policy, sampling, server retention/deletion, native crash capture, and symbolication remain out of scope.
- Do not describe `previous_run_unfinished` as a confirmed crash.
- Preserve the non-certified logging/review product boundary; do not add decompression, tissue-loading, gas-switching, ascent-clearance, or emergency guidance.
- Generated contract outputs are never edited directly; change schema/generators and run generation.
- Add Swift files to the exact iPhone, Watch, and Watch test target memberships required below; do not create a separate Watch workspace.

## File and responsibility map

- `packages/contracts/schemas/diagnostic-batch.schema.json`: source of truth for `DiagnosticBatch`, `DiagnosticEvent`, enums, and strictly bounded attributes.
- `packages/contracts/generated/typescript/diagnostics.ts`: generated TypeScript contract.
- `packages/contracts/generated/swift/DiagnosticContracts.swift`: generated Swift contract used by iPhone and Watch.
- `apps/mobile/src/diagnostics/diagnostic-event.ts`: runtime parser/factory and error normalization; the only place that converts call-site input to a persisted event.
- `apps/mobile/src/diagnostics/diagnostic-recorder.ts`: best-effort recorder and fixed incident-marker API.
- `apps/mobile/src/diagnostics/diagnostic-journal.ts`: platform-neutral sink/journal/summary/export interfaces and the future remote-sink seam.
- `apps/mobile/src/diagnostics/native-diagnostic-journal.ts`: React Native bridge adapter.
- `apps/mobile/src/diagnostics/diagnostics-provider.tsx`: application lifecycle, run marker, dependency publication, and refresh signal.
- `apps/mobile/ios/SharedDiagnostics/DiagnosticFileJournal.swift`: shared segmented journal used by iPhone and Watch.
- `apps/mobile/ios/Divenary/DiagnosticStore.swift`: iPhone singleton, Watch batch import, export, and purge coordination.
- `apps/mobile/ios/Divenary/DiagnosticStorageModule.swift`: React Native promise API and iOS share sheet.
- `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticFileJournal.kt`: Android `noBackupFilesDir` journal.
- `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticStorageModule.kt`: Android React Native bridge and `ACTION_SEND` export.
- `apps/mobile/ios/DivenaryWatchApp/Diagnostics/WatchDiagnosticRecorder.swift`: Watch event factory/recorder with no arbitrary-string API.
- `apps/mobile/ios/SharedDiagnostics/WatchDiagnosticEnvelope.swift`: validated diagnostic transfer, ACK, purge, and purge-ACK dictionaries shared by iPhone and Watch.
- `apps/mobile/src/screens/settings/diagnostics-screen.tsx`: summary, incident categories, export, and destructive-clear confirmation.

---

### Task 1: Generate a strict shared diagnostic contract

**Files:**
- Create: `packages/contracts/schemas/diagnostic-batch.schema.json`
- Modify: `packages/contracts/scripts/generate-typescript.mjs`
- Modify: `packages/contracts/scripts/generate-swift.mjs`
- Generate: `packages/contracts/generated/typescript/diagnostics.ts`
- Generate: `packages/contracts/generated/swift/DiagnosticContracts.swift`
- Create: `apps/mobile/__tests__/diagnostic-contract-source.test.ts`

**Interfaces:**
- Produces: `DiagnosticBatch`, `DiagnosticEvent`, `DiagnosticSource`, `DiagnosticCategory`, `DiagnosticEventName`, `DiagnosticSeverity`, `DiagnosticOutcome`, `DiagnosticPhase`, `DiagnosticErrorCode`, `DiagnosticIncidentCategory`, and `DiagnosticAttributes` in TypeScript and Swift.
- Contract invariant: `additionalProperties: false` at the batch, event, context, and attributes levels.

- [ ] **Step 1: Write the failing source-contract test**

```ts
import {readFileSync} from 'node:fs';

const repoFile = (path: string) =>
  readFileSync(`${process.cwd()}/../../${path}`, 'utf8');

describe('diagnostic contract generation', () => {
  test('generates strict TypeScript and Swift diagnostic types', () => {
    const schema = JSON.parse(
      repoFile('packages/contracts/schemas/diagnostic-batch.schema.json'),
    );
    const typescript = repoFile(
      'packages/contracts/generated/typescript/diagnostics.ts',
    );
    const swift = repoFile(
      'packages/contracts/generated/swift/DiagnosticContracts.swift',
    );

    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.diagnosticEvent.additionalProperties).toBe(false);
    expect(schema.$defs.diagnosticAttributes.additionalProperties).toBe(false);
    expect(typescript).toContain('export interface DiagnosticEvent');
    expect(typescript).not.toContain('[k: string]: unknown');
    expect(swift).toContain('public struct DiagnosticEvent');
  });

  test('does not expose user-content or identity fields', () => {
    const schema = repoFile(
      'packages/contracts/schemas/diagnostic-batch.schema.json',
    );
    expect(schema).not.toMatch(
      /userId|accountId|email|token|credential|latitude|longitude|siteName|notes|samples|payloadJson|localSessionId/,
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing schema/output failure**

Run: `yarn workspace @repo/mobile test diagnostic-contract-source.test.ts --runInBand`

Expected: FAIL because `diagnostic-batch.schema.json` and generated diagnostic files do not exist.

- [ ] **Step 3: Add the strict schema**

The schema must define these exact shapes and values; spell them out in JSON rather than using an open string field.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://divenary.app/contracts/diagnostic-batch.schema.json",
  "title": "DiagnosticBatch",
  "type": "object",
  "additionalProperties": false,
  "required": ["formatVersion", "batchId", "createdAt", "eventCount", "events"],
  "properties": {
    "formatVersion": {"const": 1},
    "batchId": {"type": "string", "format": "uuid"},
    "createdAt": {"type": "number", "minimum": 0},
    "eventCount": {"type": "integer", "minimum": 0, "maximum": 500},
    "events": {
      "type": "array",
      "maxItems": 500,
      "items": {"$ref": "#/$defs/diagnosticEvent"}
    }
  },
  "$defs": {
    "diagnosticEvent": {
      "title": "DiagnosticEvent",
      "type": "object",
      "additionalProperties": false,
      "required": ["schemaVersion", "eventId", "occurredAt", "sequence", "source", "category", "name", "severity", "context", "attributes"],
      "properties": {
        "schemaVersion": {"const": 1},
        "eventId": {"type": "string", "format": "uuid"},
        "occurredAt": {"type": "number", "minimum": 0},
        "receivedAt": {"type": "number", "minimum": 0},
        "sequence": {"type": "integer", "minimum": 0},
        "source": {"enum": ["mobile", "watch"]},
        "category": {"enum": ["app", "auth", "account", "watchConnectivity", "notification", "recording", "sensor", "diagnostics"]},
        "name": {"enum": ["app_started", "app_foregrounded", "app_backgrounded", "previous_run_unfinished", "render_failed", "auth_state_changed", "repository_bootstrap_completed", "account_hydration_completed", "outbox_reconciliation_completed", "account_sync_completed", "guest_claim_phase_changed", "watch_activation_changed", "watch_payload_import_completed", "watch_ack_enqueued", "notification_permission_completed", "notification_schedule_completed", "notification_opened", "sensor_availability_changed", "sensor_authorization_changed", "sensor_provider_started", "sensor_provider_stopped", "recording_state_changed", "session_save_completed", "planned_dive_receive_completed", "session_transfer_enqueued", "session_transfer_acknowledged", "diagnostic_batch_transfer_enqueued", "diagnostic_batch_acknowledged", "diagnostic_batch_imported", "diagnostic_purge_requested", "diagnostic_purge_completed", "diagnostic_events_dropped", "incident_marked"]},
        "severity": {"enum": ["debug", "info", "warning", "error"]},
        "context": {"$ref": "#/$defs/diagnosticContext"},
        "attributes": {"$ref": "#/$defs/diagnosticAttributes"}
      }
    },
    "diagnosticContext": {
      "title": "DiagnosticContext",
      "type": "object",
      "additionalProperties": false,
      "required": ["appVersion", "buildNumber", "osVersion", "deviceModel"],
      "properties": {
        "appVersion": {"type": "string", "pattern": "^[0-9A-Za-z._-]{1,32}$"},
        "buildNumber": {"type": "string", "pattern": "^[0-9A-Za-z._-]{1,32}$"},
        "osVersion": {"type": "string", "pattern": "^[0-9A-Za-z ._-]{1,48}$"},
        "deviceModel": {"type": "string", "pattern": "^[0-9A-Za-z ,._()-]{1,64}$"}
      }
    },
    "diagnosticAttributes": {
      "title": "DiagnosticAttributes",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "outcome": {"enum": ["succeeded", "failed", "cancelled", "unavailable", "skipped"]},
        "phase": {"enum": ["bootstrap", "restore", "authenticate", "hydrate", "reconcile", "upload", "finalize", "cleanup", "activate", "receive", "validate", "persist", "acknowledge", "start", "stop", "export", "purge"]},
        "errorCode": {"enum": ["unknown_failure", "invalid_data", "io_failure", "storage_full", "checksum_mismatch", "unsupported_version", "bridge_unavailable", "permission_denied", "network_unavailable", "remote_rejected", "timeout"]},
        "count": {"type": "integer", "minimum": 0, "maximum": 1000000},
        "durationMs": {"type": "integer", "minimum": 0, "maximum": 86400000},
        "retryCount": {"type": "integer", "minimum": 0, "maximum": 10000},
        "droppedEventCount": {"type": "integer", "minimum": 0, "maximum": 1000000},
        "isReachable": {"type": "boolean"},
        "isPaired": {"type": "boolean"},
        "isWatchAppInstalled": {"type": "boolean"},
        "operationId": {"type": "string", "format": "uuid"},
        "stackFingerprint": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "incidentCategory": {"enum": ["watch_recording", "sync", "auth_account", "freeze_exit", "notification", "other"]}
      }
    }
  }
}
```

Add a generator pass that compiles this schema to `generated/typescript/diagnostics.ts`, and add a second `quicktype` invocation with `--top-level DiagnosticBatch` that writes `generated/swift/DiagnosticContracts.swift`. Keep the existing Watch contract outputs unchanged.

- [ ] **Step 4: Generate and verify the contract**

Run: `yarn workspace @repo/contracts generate`

Expected: PASS with four generation messages: existing TypeScript/Swift Watch contracts plus TypeScript/Swift diagnostic contracts.

Run: `yarn workspace @repo/mobile test diagnostic-contract-source.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/contracts/schemas/diagnostic-batch.schema.json packages/contracts/scripts/generate-typescript.mjs packages/contracts/scripts/generate-swift.mjs packages/contracts/generated/typescript/diagnostics.ts packages/contracts/generated/swift/DiagnosticContracts.swift apps/mobile/__tests__/diagnostic-contract-source.test.ts
git commit -m "feat: add privacy-safe diagnostic contract"
```

### Task 2: Enforce privacy at the TypeScript recorder boundary

**Files:**
- Create: `apps/mobile/src/diagnostics/diagnostic-journal.ts`
- Create: `apps/mobile/src/diagnostics/diagnostic-event.ts`
- Create: `apps/mobile/src/diagnostics/diagnostic-recorder.ts`
- Create: `apps/mobile/__tests__/diagnostic-recorder.test.ts`

**Interfaces:**
- Consumes: generated `DiagnosticEvent` and enum unions from Task 1.
- Produces:

```ts
export type DiagnosticSummary = {
  oldestOccurredAt?: number;
  newestOccurredAt?: number;
  eventCount: number;
  mobileEventCount: number;
  watchEventCount: number;
  byteCount: number;
  watchPurgePending: boolean;
};

export type DiagnosticExportDescriptor = DiagnosticSummary & {
  filePath: string;
  createdAt: number;
};

export interface DiagnosticSink {
  append(event: DiagnosticEvent): Promise<void>;
}

export interface DiagnosticJournal extends DiagnosticSink {
  getSummary(): Promise<DiagnosticSummary>;
  createExport(): Promise<DiagnosticExportDescriptor>;
  clearAll(before: number): Promise<void>;
}

export class DiagnosticRecorder {
  record(draft: DiagnosticEventDraft): Promise<void>;
  markIncident(category: DiagnosticIncidentCategory): Promise<string>;
}
```

- [ ] **Step 1: Write failing recorder and privacy-canary tests**

```ts
test('persists only a generated allowlisted event', async () => {
  const journal = new CapturingJournal();
  const recorder = makeRecorder(journal);

  await recorder.record({
    category: 'watchConnectivity',
    name: 'watch_payload_import_completed',
    severity: 'info',
    attributes: {outcome: 'succeeded', count: 2, durationMs: 18},
  });

  expect(journal.events).toEqual([
    expect.objectContaining({
      source: 'mobile',
      sequence: 1,
      attributes: {outcome: 'succeeded', count: 2, durationMs: 18},
    }),
  ]);
});

test.each(['userId', 'email', 'token', 'siteName', 'notes', 'samples', 'payloadJson']) (
  'rejects the forbidden %s field at runtime',
  async forbidden => {
    const journal = new CapturingJournal();
    const recorder = makeRecorder(journal);
    await expect(
      recorder.record({
        category: 'app',
        name: 'app_started',
        severity: 'info',
        attributes: {[forbidden]: 'privacy-canary'},
      } as never),
    ).resolves.toBeUndefined();
    expect(journal.events).toEqual([]);
  },
);

test('normalizes an error without persisting its message or absolute path', async () => {
  const normalized = normalizeDiagnosticError(
    new Error('token=secret-value at /Users/person/private.ts:12:9'),
  );
  expect(normalized.errorCode).toBe('unknown_failure');
  expect(normalized.stackFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(normalized)).not.toContain('secret-value');
  expect(JSON.stringify(normalized)).not.toContain('/Users/person');
});
```

- [ ] **Step 2: Run the test and confirm missing-module failures**

Run: `yarn workspace @repo/mobile test diagnostic-recorder.test.ts --runInBand`

Expected: FAIL because the diagnostics modules do not exist.

- [ ] **Step 3: Implement the journal contract, strict parser, and best-effort recorder**

`DiagnosticEventDraft` must expose only exact properties; do not add `Record<string, unknown>`.

```ts
export type DiagnosticEventDraft = Pick<
  DiagnosticEvent,
  'category' | 'name' | 'severity'
> & {
  attributes?: DiagnosticAttributes;
};

export type DiagnosticRecorderDependencies = {
  journal: DiagnosticJournal;
  sinks?: readonly DiagnosticSink[];
  source: DiagnosticSource;
  context: DiagnosticContext;
  now: () => number;
  createId: () => string;
  fingerprint: (value: string) => string;
};
```

`record()` must build a fresh object, call `parseDiagnosticEvent()`, append only a successful parse, and fan out to `sinks ?? [journal]` independently. A failing sink must not block the journal or another sink. Swallow journal/parser failure, increment a capped in-memory drop count, and attach that count to the next valid event. Phase 1 constructs the recorder with the local journal only; the `DiagnosticSink` seam is the future `RemoteDiagnosticSink` extension point and must not contain network code now. `markIncident()` must call `record()` with `name: 'incident_marked'`, `category: 'diagnostics'`, a generated `operationId`, and the chosen fixed category. It returns that operation ID and accepts no text.

Normalize errors by mapping known typed errors to the finite `DiagnosticErrorCode` union. For unknown errors, strip URLs, absolute paths, quoted values, query strings, and `key=value` fragments before hashing the normalized stack with `@noble/hashes`; persist only `unknown_failure` and the SHA-256 fingerprint.

- [ ] **Step 4: Run recorder tests and typecheck**

Run: `yarn workspace @repo/mobile test diagnostic-recorder.test.ts --runInBand`

Expected: PASS.

Run: `yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the privacy boundary**

```bash
git add apps/mobile/src/diagnostics/diagnostic-journal.ts apps/mobile/src/diagnostics/diagnostic-event.ts apps/mobile/src/diagnostics/diagnostic-recorder.ts apps/mobile/__tests__/diagnostic-recorder.test.ts
git commit -m "feat: enforce diagnostic privacy boundary"
```

### Task 3: Build bounded no-backup journals for iOS, Watch, and Android

**Files:**
- Create: `apps/mobile/ios/SharedDiagnostics/DiagnosticFileJournal.swift`
- Create: `apps/mobile/ios/Divenary/DiagnosticStore.swift`
- Create: `apps/mobile/ios/Divenary/DiagnosticStorageModule.swift`
- Create: `apps/mobile/ios/Divenary/DiagnosticStorageModuleBridge.m`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/DiagnosticFileJournalTests.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`
- Create: `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticFileJournal.kt`
- Create: `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticStorageModule.kt`
- Create: `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticStoragePackage.kt`
- Create: `apps/mobile/android/app/src/test/java/com/divemobile/diagnostics/DiagnosticFileJournalTest.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/divemobile/MainApplication.kt`
- Modify: `apps/mobile/android/app/build.gradle`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: generated `DiagnosticEvent`/`DiagnosticBatch` from Task 1.
- Produces Swift:

```swift
struct DiagnosticJournalLimits { let maxAge: TimeInterval; let maxBytes: Int }
struct DiagnosticJournalSummary: Codable, Equatable {
    let oldestOccurredAt: TimeInterval?
    let newestOccurredAt: TimeInterval?
    let eventCount: Int
    let mobileEventCount: Int
    let watchEventCount: Int
    let byteCount: Int
}
struct PendingDiagnosticBatch { let batch: DiagnosticBatch; let fileURL: URL; let sha256: String }

final class DiagnosticFileJournal {
    func append(encodedEvent: Data) throws
    func importBatch(_ data: Data, expectedSHA256: String) throws -> Int
    func summary() throws -> DiagnosticJournalSummary
    func createExport(at destinationURL: URL, receivedAt: Date) throws -> DiagnosticJournalSummary
    func makePendingBatch(maxEvents: Int, maxBytes: Int) throws -> PendingDiagnosticBatch?
    func acknowledge(batchID: UUID) throws
    func clear(before: Date?) throws
}
```

- Produces React Native module methods: `appendEvent`, `getSummary`, `getContext`, `createExport`, `clearAll(before)`, `beginRun`, and `markRunBackgrounded`. Task 8 adds `shareExport` after the platform share paths exist.

- [ ] **Step 1: Write failing Swift journal tests**

```swift
func testPrunesByAgeAndThenByByteLimit() throws {
    let journal = try makeJournal(maxAge: 3 * 86_400, maxBytes: 1_024)
    try journal.append(encodedEvent: eventData(id: 1, occurredAt: 100))
    clock.now = Date(timeIntervalSince1970: 100 + 3 * 86_400 + 1)
    try journal.append(encodedEvent: eventData(id: 2, occurredAt: clock.now.timeIntervalSince1970))
    XCTAssertEqual(try journal.summary().eventCount, 1)

    for index in 3...100 {
        try journal.append(encodedEvent: eventData(id: index, occurredAt: clock.now.timeIntervalSince1970))
    }
    XCTAssertLessThanOrEqual(try journal.summary().byteCount, 1_024)
}

func testRecoversValidSegmentsAndDropsTruncatedTail() throws {
    let journal = try makeJournal()
    try journal.append(encodedEvent: eventData(id: 1, occurredAt: 100))
    try appendRawTail("{\"schemaVersion\":1")
    XCTAssertEqual(try journal.summary().eventCount, 1)
}

func testImportIsIdempotentAndRejectsChecksumMismatch() throws {
    let journal = try makeJournal()
    let batch = try batchData(events: [eventData(id: 1, occurredAt: 100)])
    XCTAssertEqual(try journal.importBatch(batch, expectedSHA256: sha256(batch)), 1)
    XCTAssertEqual(try journal.importBatch(batch, expectedSHA256: sha256(batch)), 0)
    XCTAssertThrowsError(try journal.importBatch(batch, expectedSHA256: String(repeating: "0", count: 64)))
}
```

- [ ] **Step 2: Add failing Kotlin journal tests**

```kotlin
@Test fun prunesOldestSegmentsAtTenMiB() {
  val journal = makeJournal(maxAgeSeconds = 14 * 86_400L, maxBytes = 10 * 1024 * 1024)
  repeat(20_000) { journal.append(eventJson(sequence = it)) }
  assertTrue(journal.summary().byteCount <= 10 * 1024 * 1024)
}

@Test fun rejectsUnknownOrForbiddenFields() {
  val journal = makeJournal()
  org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
    journal.append(validEventObject().put("email", "privacy-canary").toString())
  }
}
```

Add `testImplementation("junit:junit:4.13.2")`; this dependency is test-only and does not change the app runtime.

- [ ] **Step 3: Run the new tests and confirm missing implementations**

Run: `xcodebuild build-for-testing -project apps/mobile/ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath /private/tmp/DivenaryWatchTestsDerivedData CODE_SIGNING_ALLOWED=NO`

Expected: FAIL because `DiagnosticFileJournal` does not exist or lacks target membership.

Run: `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest --tests '*DiagnosticFileJournalTest'`

Expected: FAIL because the Kotlin journal does not exist.

- [ ] **Step 4: Implement segmented journal behavior**

Use `segments/<firstSequence>-<uuid>.jsonl`, an atomic `index.json`, and a `pending-batches/` directory. Validate each line by decoding `DiagnosticEvent`; reject trailing unknown fields through the generated Codable type plus an explicit `JSONSerialization` allowed-key check. Segment rotation occurs at 64 KiB or 200 events. On read, keep valid newline-terminated records, truncate only an incomplete final line, and discard a segment with interior corruption without copying its bytes into quarantine.

Mobile-origin events set `receivedAt` equal to `occurredAt` before append. Watch-origin events omit it on Watch; `importBatch` creates a validated copy with one iPhone `receivedAt` value for the whole import. Preserve Watch `occurredAt` and `sequence` so export can diagnose clock skew and retain source order.

Before each append/import, prune by `occurredAt`, then by total bytes. Set `URLResourceKey.isExcludedFromBackupKey = true` on iOS/watchOS roots and `.completeUntilFirstUserAuthentication` protection on created files. Instantiate:

```swift
static let mobileLimits = DiagnosticJournalLimits(
    maxAge: 14 * 86_400,
    maxBytes: 10 * 1_024 * 1_024
)
static let watchLimits = DiagnosticJournalLimits(
    maxAge: 3 * 86_400,
    maxBytes: 1 * 1_024 * 1_024
)
```

Android must root the journal at `reactContext.noBackupFilesDir.resolve("diagnostics")`, use the same 64 KiB/200-event segmentation and 14-day/10-MiB limits, and write index/segment replacements through a sibling temporary file plus atomic rename.

`DiagnosticStore.shared` owns the iPhone journal. The React Native module performs file work on a dedicated serial utility queue and resolves promises on completion. `getContext()` returns only Bundle app version/build, system version, and generic hardware model; it must never call `UIDevice.current.name`, IDFV, advertising ID, serial APIs, or account state. `beginRun(runId)` atomically replaces a small active-run marker and returns whether a different unfinished marker existed; `markRunBackgrounded(runId)` clears only the matching marker. `clearAll(before)` must persist Task 7's Watch purge intent before deleting local events, so local deletion cannot lose the cross-device request.

The React Native summary wrapper adds `watchPurgePending` to the six journal counters. It is `false` on Android and reflects Task 7's separate durable purge queue on iOS.

Add `DiagnosticContracts.swift` and `DiagnosticFileJournal.swift` to the iPhone, `DivenaryWatchApp`, and `DivenaryWatchAppTests` source phases. Add the iPhone store/module/bridge only to `Divenary`; add the Swift test only to `DivenaryWatchAppTests`.

- [ ] **Step 5: Register Android and native test scripts**

```kotlin
PackageList(this).packages.apply {
  add(ReverseGeocoderPackage())
  add(DiagnosticStoragePackage())
}
```

Add mobile scripts:

```json
"android:test:diagnostics": "cd android && ./gradlew :app:testDebugUnitTest --tests '*DiagnosticFileJournalTest'",
"watch:test:build": "xcodebuild build-for-testing -project ios/Divenary.xcodeproj -scheme DivenaryWatchAppTests -configuration Debug -destination 'generic/platform=watchOS Simulator' -derivedDataPath /private/tmp/DivenaryWatchTestsDerivedData CODE_SIGNING_ALLOWED=NO"
```

- [ ] **Step 6: Run native journal gates**

Run: `yarn workspace @repo/mobile android:test:diagnostics`

Expected: PASS.

Run: `yarn workspace @repo/mobile watch:test:build`

Expected: `** TEST BUILD SUCCEEDED **`.

Run: `yarn ios:build`

Expected: PASS when the CocoaPods workspace is available; otherwise record the exact setup blocker and do not claim this gate passed.

- [ ] **Step 7: Commit native journals**

```bash
git add apps/mobile/ios/SharedDiagnostics apps/mobile/ios/Divenary/DiagnosticStore.swift apps/mobile/ios/Divenary/DiagnosticStorageModule.swift apps/mobile/ios/Divenary/DiagnosticStorageModuleBridge.m apps/mobile/ios/DivenaryWatchAppTests/DiagnosticFileJournalTests.swift apps/mobile/ios/Divenary.xcodeproj/project.pbxproj apps/mobile/android/app/src/main/java/com/divemobile apps/mobile/android/app/src/test/java/com/divemobile/diagnostics apps/mobile/android/app/build.gradle apps/mobile/package.json
git commit -m "feat: add bounded native diagnostic journals"
```

### Task 4: Publish diagnostics to React Native and record app lifecycle failures

**Files:**
- Create: `apps/mobile/src/diagnostics/native-diagnostic-journal.ts`
- Create: `apps/mobile/src/diagnostics/diagnostics-provider.tsx`
- Modify: `apps/mobile/src/providers.tsx`
- Modify: `apps/mobile/src/components/app-error-boundary.tsx`
- Create: `apps/mobile/__tests__/diagnostics-provider.test.tsx`
- Modify: `apps/mobile/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `DiagnosticJournal` and `DiagnosticRecorder` from Task 2; native module from Task 3.
- Produces: `useDiagnostics(): {recorder, summary, refreshSummary}`. Task 8 extends this value with incident/export/share/clear actions after those native paths exist.

- [ ] **Step 1: Write failing provider and ErrorBoundary tests**

```tsx
test('records start, unfinished previous run, and lifecycle transitions', async () => {
  const recorder = capturingRecorder();
  const journal = fakeNativeJournal({previousRunUnfinished: true});
  const renderer = await renderDiagnosticsProvider({recorder, journal});
  emitAppState('background');
  emitAppState('active');
  expect(recorder.names()).toEqual([
    'app_started',
    'previous_run_unfinished',
    'app_backgrounded',
    'app_foregrounded',
  ]);
  renderer.unmount();
});

test('records a normalized render failure without changing recovery UI', () => {
  const record = jest.fn(async () => undefined);
  const renderer = renderCrashingChild({record});
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({name: 'render_failed', severity: 'error'}),
  );
  expect(renderer.root.findByProps({testID: 'recovery-screen'})).toBeTruthy();
});
```

- [ ] **Step 2: Run tests and confirm missing provider/prop failures**

Run: `yarn workspace @repo/mobile test diagnostics-provider.test.tsx App.test.tsx --runInBand`

Expected: FAIL because the provider/native adapter and ErrorBoundary recorder prop are missing.

- [ ] **Step 3: Implement the bridge adapter and provider**

The adapter must fail closed on malformed native values and return an unavailable no-op journal on unsupported platforms, without throwing during app bootstrap.

```ts
type DiagnosticStorageModule = {
  appendEvent(eventJson: string): Promise<void>;
  getSummary(): Promise<unknown>;
  getContext(): Promise<unknown>;
  createExport(): Promise<unknown>;
  clearAll(before: number): Promise<void>;
  beginRun(runId: string): Promise<boolean>;
  markRunBackgrounded(runId: string): Promise<void>;
};
```

Create one recorder with a launch-scoped UUID and the validated result of native `getContext()`. Put `DiagnosticsProvider` outside `AppErrorBoundary`, Auth, and account data so failures in those providers can still be recorded. Convert `AppErrorBoundary` to accept `recordFailure?: (error: Error, info: React.ErrorInfo) => void`; the default must remain safe for isolated tests.

- [ ] **Step 4: Run provider tests and typecheck**

Run: `yarn workspace @repo/mobile test diagnostics-provider.test.tsx App.test.tsx --runInBand`

Expected: PASS.

Run: `yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the mobile lifecycle integration**

```bash
git add apps/mobile/src/diagnostics apps/mobile/src/providers.tsx apps/mobile/src/components/app-error-boundary.tsx apps/mobile/__tests__/diagnostics-provider.test.tsx apps/mobile/__tests__/App.test.tsx
git commit -m "feat: record mobile diagnostic lifecycle"
```

### Task 5: Instrument Mobile Auth, account, Watch import, and notification outcomes

**Files:**
- Modify: `apps/mobile/src/states/auth.tsx`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/sync/account-sync-coordinator.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/notifications/watch-sync-notification-service.ts`
- Modify: `apps/mobile/__tests__/auth-state.test.tsx`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`
- Modify: `apps/mobile/__tests__/account-sync-coordinator.test.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Create: `apps/mobile/__tests__/diagnostic-instrumentation.test.ts`

**Interfaces:**
- Consumes: `useDiagnostics().recorder` for React providers and optional `DiagnosticRecorder` constructor/function dependencies for non-React coordinators.
- Produces no new product state. Every call is `void recorder.record(...)` after the business result is known.

- [ ] **Step 1: Add failing privacy-safe instrumentation assertions**

```ts
test('watch import records outcome and count without payload identity', async () => {
  const recorder = capturingRecorder();
  await importPayloads({payloads: [fixture], recorder});
  expect(recorder.last()).toEqual(
    expect.objectContaining({
      name: 'watch_payload_import_completed',
      attributes: expect.objectContaining({outcome: 'succeeded', count: 1}),
    }),
  );
  expect(JSON.stringify(recorder.events)).not.toMatch(
    /payloadId|localSessionId|siteName|notes|samples/,
  );
});

test('account sync records a typed failure without principal identity', async () => {
  const recorder = capturingRecorder();
  await runFailingAccountSync({recorder});
  expect(recorder.last()?.name).toBe('account_sync_completed');
  expect(JSON.stringify(recorder.events)).not.toContain('user-id');
});
```

- [ ] **Step 2: Run focused tests and confirm missing diagnostics**

Run: `yarn workspace @repo/mobile test auth-state.test.tsx account-data-state.test.tsx account-sync-coordinator.test.ts watch-connectivity-sync.test.tsx diagnostic-instrumentation.test.ts --runInBand`

Expected: FAIL only on the new diagnostic expectations.

- [ ] **Step 3: Add outcome-only event calls**

Record these exact event names at existing completion boundaries:

- Auth restore/sign-in/sign-out state changes → `auth_state_changed`, phase `restore` or `authenticate`, outcome only.
- Repository bootstrap → `repository_bootstrap_completed`.
- Remote hydration → `account_hydration_completed`, count and duration only.
- Outbox reconciliation → `outbox_reconciliation_completed`, count/retry/duration only.
- Remote push/pull → `account_sync_completed`, outcome/error code/duration only.
- Guest claim phase transitions → `guest_claim_phase_changed`, finite phase/outcome/count only; never batch/item/principal IDs.
- Watch activation/import/local save/ACK enqueue → existing Watch event names with count/duration/reachability only.
- Notification permission/schedule/open → exact notification event names with outcome only.

Do not replace existing user-facing error handling. Remove the existing raw `console.warn/error` only when the same branch now emits a typed event and no developer-only transient console context is still necessary; never pass raw errors to the journal.

- [ ] **Step 4: Run the focused regression suite**

Run: `yarn workspace @repo/mobile test auth-state.test.tsx account-data-state.test.tsx account-sync-coordinator.test.ts watch-connectivity-sync.test.tsx diagnostic-instrumentation.test.ts --runInBand`

Expected: PASS.

Run: `yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Mobile instrumentation**

```bash
git add apps/mobile/src/states/auth.tsx apps/mobile/src/states/account-data.tsx apps/mobile/src/sync/account-sync-coordinator.ts apps/mobile/src/states/watch-connectivity-sync.tsx apps/mobile/src/notifications/watch-sync-notification-service.ts apps/mobile/__tests__
git commit -m "feat: instrument mobile diagnostic outcomes"
```

### Task 6: Record Watch lifecycle, sensor, persistence, and transfer outcomes

**Files:**
- Create: `apps/mobile/ios/DivenaryWatchApp/Diagnostics/WatchDiagnosticRecorder.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sensors/RealDepthSensorProvider.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/WatchDiagnosticRecorderTests.swift`
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: shared `DiagnosticFileJournal` and generated Swift diagnostic types.
- Produces:

```swift
protocol WatchDiagnosticRecording: AnyObject {
    func record(
        name: DiagnosticEventName,
        category: DiagnosticCategory,
        severity: DiagnosticSeverity,
        attributes: DiagnosticAttributes
    )
}
```

The protocol intentionally accepts generated attributes, not `[String: Any]` or a free-form message.

- [ ] **Step 1: Write failing Watch recorder tests**

```swift
func testRecorderWritesAllowedEventAndCarriesDroppedCountForward() throws {
    let journal = FailOnceDiagnosticJournal()
    let recorder = WatchDiagnosticRecorder(journal: journal, now: { self.now })
    recorder.record(name: .sensorProviderStarted, category: .sensor, severity: .info, attributes: .success)
    recorder.record(name: .sensorProviderStarted, category: .sensor, severity: .info, attributes: .success)
    XCTAssertEqual(journal.events.last?.attributes.droppedEventCount, 1)
}

func testSessionPersistenceFailureDoesNotIncludeSessionOrDiveValues() {
    let recorder = CapturingWatchDiagnosticRecorder()
    _ = makeStore(recorder: recorder, failingProfileStore: true).save(makeDive())
    XCTAssertEqual(recorder.events.last?.name, .sessionSaveCompleted)
    XCTAssertFalse(recorder.encodedEvents.contains("localSessionId"))
    XCTAssertFalse(recorder.encodedEvents.contains("depthMeters"))
}
```

- [ ] **Step 2: Run the Watch test-build and confirm missing types/target membership**

Run: `yarn workspace @repo/mobile watch:test:build`

Expected: FAIL because `WatchDiagnosticRecorder` and the new test are not implemented or in the target.

- [ ] **Step 3: Implement Watch recorder and inject it from `DiveAppServices`**

Create the Watch journal under `Application Support/DivenaryWatchApp/Diagnostics`, excluded from backup, with Task 3's watch limits. Construct the recorder before `WatchSyncTransport` and `DiveSessionStore`; pass the same recorder to services that emit events.

Record only:

- app/service start;
- sensor availability/authorization and provider start/stop outcome, never samples;
- recording phase transitions and runtime result, never plan/session values;
- local session/profile save outcome;
- planned-dive receive count/outcome, never plan content;
- session transfer enqueue/ACK outcome, never artifact/session identity.

Replace persistence `assertionFailure` branches with a typed diagnostic event plus the existing return/fallback behavior. Keeping `assertionFailure` in Debug is acceptable only if the persisted event remains privacy-safe and the assertion text also omits IDs and content.

- [ ] **Step 4: Build the tests and Watch app**

Run: `yarn workspace @repo/mobile watch:test:build`

Expected: `** TEST BUILD SUCCEEDED **`.

Run: `yarn watch:build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit Watch event recording**

```bash
git add apps/mobile/ios/DivenaryWatchApp/Diagnostics apps/mobile/ios/DivenaryWatchApp/Runtime apps/mobile/ios/DivenaryWatchApp/Sensors/RealDepthSensorProvider.swift apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift apps/mobile/ios/DivenaryWatchAppTests apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: record watch diagnostic outcomes"
```

### Task 7: Transfer Watch diagnostic batches with independent ACK and purge state

**Files:**
- Create: `apps/mobile/ios/SharedDiagnostics/WatchDiagnosticEnvelope.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/Divenary/DiagnosticStore.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m`
- Modify: `apps/mobile/src/native/watch-connectivity.ts`
- Create: `apps/mobile/ios/DivenaryWatchAppTests/WatchDiagnosticEnvelopeTests.swift`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-native.test.ts`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces four independent kinds: `watchDiagnosticBatch`, `watchDiagnosticAcknowledgement`, `watchDiagnosticPurge`, `watchDiagnosticPurgeAcknowledgement`.
- Produces an internal native `queueDiagnosticPurge(before:)` hook used by `DiagnosticStore.clearAll(before:)`; it is not a separate product-facing JavaScript action.

- [ ] **Step 1: Write failing envelope and source-boundary tests**

```swift
func testDiagnosticMetadataCannotParseAsSessionArtifact() throws {
    let metadata = WatchDiagnosticEnvelope.batchMetadata(
        batchID: fixedBatchID,
        sha256: String(repeating: "a", count: 64),
        eventCount: 3,
        createdAt: Date(timeIntervalSince1970: 100)
    )
    XCTAssertNotNil(WatchDiagnosticEnvelope.batch(from: metadata))
    XCTAssertNil(WatchSyncEnvelope.artifactIdentity(from: metadata))
}

func testPurgeRejectsUnknownKeysAndInvalidTime() {
    XCTAssertNil(WatchDiagnosticPurgeCommand(dictionary: ["kind": "watchDiagnosticPurge", "before": -1]))
    XCTAssertNil(WatchDiagnosticPurgeCommand(dictionary: validPurge.merging(["notes": "privacy-canary"]) { _, new in new }))
}
```

```ts
expect(inbox).toContain('watchDiagnosticBatch');
expect(inbox).toContain('pendingDiagnosticAcknowledgements');
expect(inbox).toContain('pendingDiagnosticPurges');
expect(inbox).not.toMatch(/watchDiagnostic[\s\S]{0,200}(payloadJson|localSessionId)/);
```

- [ ] **Step 2: Run focused tests and confirm missing protocol failures**

Run: `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts watch-connectivity-native.test.ts --runInBand`

Expected: FAIL on missing diagnostic kinds/queues/bridge method.

Run: `yarn workspace @repo/mobile watch:test:build`

Expected: FAIL because the envelope/test is missing.

- [ ] **Step 3: Implement the Watch batch lifecycle**

`WatchSyncTransport` remains the sole Watch `WCSessionDelegate`. On activation, reachability change, and recorder-ready notification, ask the journal for at most 200 events/64 KiB, then `transferFile` with diagnostic metadata. Deduplicate only against outstanding diagnostic transfers with the same batch ID. A failed transfer leaves the journal batch pending. Diagnostic ACK calls `journal.acknowledge(batchID:)`; it must never call `onTransferStatusChanged` for a dive artifact.

On purge command, cancel outstanding diagnostic transfers, call `journal.clear(before:)`, and return `watchDiagnosticPurgeAcknowledgement` through reachable `sendMessage` plus durable `transferUserInfo`. Do not delete saved dives or session-transfer manifests.

- [ ] **Step 4: Implement the iPhone import and durable ACK/purge queues**

In `didReceive file`, branch on kind before parsing a dive artifact. For a diagnostic batch:

1. Copy the ephemeral URL to `Application Support/Divenary/DiagnosticsInbox/<batchID>.json`.
2. Validate allowed metadata, byte count, SHA-256, schema version, event count, and decoded events.
3. Call `DiagnosticStore.shared.importWatchBatch`; duplicate event/batch IDs import zero events successfully.
4. Read back the journal summary.
5. Persist `PendingWatchDiagnosticAcknowledgement` separately from session ACKs.
6. Remove the inbox copy only after ACK state is durable.
7. Flush through `sendMessage` when reachable and `transferUserInfo` otherwise.

Set `receivedAt` to the iPhone import time for every accepted Watch event. Do not rewrite `occurredAt`, `sequence`, or event IDs.

`queueDiagnosticPurge(before:)` persists one monotonic purge request outside the diagnostic journal before `DiagnosticStore.clearAll(before:)` removes local events, so clearing the journal cannot delete its own Watch deletion intent. Remove it only after a matching purge ACK. Surface `watchPurgePending: true` through `getSummary()` until that ACK arrives. Store no Watch name or stable identifier.

- [ ] **Step 5: Run transfer tests and builds**

Run: `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts watch-connectivity-native.test.ts --runInBand`

Expected: PASS.

Run: `yarn workspace @repo/mobile watch:test:build && yarn watch:build`

Expected: both builds succeed.

Run: `yarn ios:build`

Expected: PASS when native workspace prerequisites are available.

- [ ] **Step 6: Commit independent diagnostic transport**

```bash
git add apps/mobile/ios/SharedDiagnostics/WatchDiagnosticEnvelope.swift apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift apps/mobile/ios/Divenary/WatchConnectivityInbox.swift apps/mobile/ios/Divenary/DiagnosticStore.swift apps/mobile/ios/Divenary/WatchConnectivityModule.swift apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m apps/mobile/src/native/watch-connectivity.ts apps/mobile/ios/DivenaryWatchAppTests/WatchDiagnosticEnvelopeTests.swift apps/mobile/__tests__/watch-connectivity-native-source.test.ts apps/mobile/__tests__/watch-connectivity-native.test.ts apps/mobile/ios/Divenary.xcodeproj/project.pbxproj
git commit -m "feat: sync watch diagnostics independently"
```

### Task 8: Export JSONL and create fixed-category incidents

**Files:**
- Modify: `apps/mobile/ios/Divenary/DiagnosticStore.swift`
- Modify: `apps/mobile/ios/Divenary/DiagnosticStorageModule.swift`
- Modify: `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticFileJournal.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/divemobile/diagnostics/DiagnosticStorageModule.kt`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`
- Create: `apps/mobile/android/app/src/main/res/xml/diagnostic_file_paths.xml`
- Modify: `apps/mobile/src/diagnostics/native-diagnostic-journal.ts`
- Modify: `apps/mobile/src/diagnostics/diagnostics-provider.tsx`
- Create: `apps/mobile/src/diagnostics/incident-window.ts`
- Create: `apps/mobile/__tests__/diagnostic-export.test.ts`
- Modify: `apps/mobile/ios/DivenaryWatchAppTests/DiagnosticFileJournalTests.swift`
- Modify: `apps/mobile/android/app/src/test/java/com/divemobile/diagnostics/DiagnosticFileJournalTest.kt`

**Interfaces:**
- Consumes: `DiagnosticRecorder.markIncident()` and native journal summary APIs.
- Produces one JSONL file whose first line is:

```ts
type DiagnosticExportManifest = {
  recordType: 'diagnostic_export_manifest';
  formatVersion: 1;
  createdAt: number;
  oldestOccurredAt?: number;
  newestOccurredAt?: number;
  eventCount: number;
  mobileEventCount: number;
  watchEventCount: number;
  incidentWindows: Array<{
    incidentId: string;
    incidentCategory: DiagnosticIncidentCategory;
    startsAt: number;
    endsAt: number;
  }>;
};
```

- [ ] **Step 1: Write failing export and incident-window tests**

```ts
test('creates an incident with no free-text field', async () => {
  const recorder = makeRecorder(journal);
  const incidentId = await recorder.markIncident('sync');
  const event = journal.events.at(-1)!;
  expect(event.attributes).toEqual({incidentCategory: 'sync', operationId: incidentId});
  expect(JSON.stringify(event)).not.toContain('message');
});

test('rejects a native export descriptor outside the app diagnostic directory', async () => {
  await expect(parseExportDescriptor({filePath: '/tmp/other.jsonl'})).rejects.toThrow();
});

test('derives the approved ten-minute before and five-minute after window', () => {
  expect(incidentWindow({occurredAt: 10_000})).toEqual({
    startsAt: 9_400,
    endsAt: 10_300,
  });
});
```

Native tests must assert manifest-first ordering, stable event ordering by `occurredAt`, then source and sequence, counts by source, unchanged journal after share cancellation, and cleanup of an old temp export on the next module initialization.

- [ ] **Step 2: Run focused tests and confirm export gaps**

Run: `yarn workspace @repo/mobile test diagnostic-recorder.test.ts diagnostic-export.test.ts --runInBand`

Expected: FAIL on missing export descriptor validation/native behavior.

- [ ] **Step 3: Implement atomic export and platform sharing**

Create an immutable journal snapshot, write manifest plus events to `tmp/diagnostics/divenary-diagnostics-<UTC>.jsonl`, fsync/close, and atomically rename. Never include the native inbox, active run marker, pending ACK/purge state, or raw corrupt segments.

Implement `incidentWindow(marker)` as a pure helper that returns `occurredAt - 600` through `occurredAt + 300`. It is analysis metadata only: do not duplicate, mutate, or drop journal events. Include `incidentWindows` in the export manifest as an array of `{incidentId, incidentCategory, startsAt, endsAt}` derived only from fixed marker fields.

iOS `shareExport` presents `UIActivityViewController` for a validated file beneath the diagnostic export directory. Android declares a non-exported `FileProvider`, grants one-time read URI permission, and uses `Intent.ACTION_SEND` with MIME `application/x-ndjson`. Sharing cancellation resolves normally and leaves the journal unchanged. Delete app-owned export temp files after activity completion when possible and always on the next app start if older than 24 hours.

Extend `useDiagnostics()` here with `markIncident`, `createExport`, `shareExport`, and `clearAll(before)`. `clearAll(before)` calls the single native atomic clear API; UI code must not separately queue a Watch purge.

- [ ] **Step 4: Run export, native journal, and type gates**

Run: `yarn workspace @repo/mobile test diagnostic-recorder.test.ts diagnostic-export.test.ts --runInBand`

Expected: PASS.

Run: `yarn workspace @repo/mobile android:test:diagnostics && yarn workspace @repo/mobile watch:test:build && yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 5: Commit export and incidents**

```bash
git add apps/mobile/ios/Divenary/DiagnosticStore.swift apps/mobile/ios/Divenary/DiagnosticStorageModule.swift apps/mobile/android/app/src/main/AndroidManifest.xml apps/mobile/android/app/src/main/res/xml/diagnostic_file_paths.xml apps/mobile/android/app/src/main/java/com/divemobile/diagnostics apps/mobile/android/app/src/test/java/com/divemobile/diagnostics apps/mobile/src/diagnostics/native-diagnostic-journal.ts apps/mobile/src/diagnostics/diagnostics-provider.tsx apps/mobile/src/diagnostics/incident-window.ts apps/mobile/__tests__/diagnostic-export.test.ts apps/mobile/__tests__/diagnostic-recorder.test.ts apps/mobile/ios/DivenaryWatchAppTests/DiagnosticFileJournalTests.swift
git commit -m "feat: export privacy-safe diagnostic incidents"
```

### Task 9: Add the Settings diagnostics screen and cross-device clear action

**Files:**
- Create: `apps/mobile/src/screens/settings/diagnostics-screen.tsx`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/settings-screen.test.tsx`
- Create: `apps/mobile/__tests__/diagnostics-screen.test.tsx`

**Interfaces:**
- Consumes: `useDiagnostics()`, whose `clearAll(before)` atomically persists the Watch purge intent before deleting local events.
- Extends: `SettingsRoute` with `'diagnostics'`.
- UI exposes no event body viewer and no free-text field.

- [ ] **Step 1: Write failing Settings and diagnostics-screen tests**

```tsx
test('opens diagnostics from Settings and shows only summary metadata', async () => {
  const renderer = await renderSettings();
  expect(renderer.root.findByProps({testID: 'settings-row-diagnostics'})).toBeTruthy();

  const diagnostics = await renderDiagnosticsScreen({
    summary: {eventCount: 20, mobileEventCount: 12, watchEventCount: 8, byteCount: 4096, watchPurgePending: false},
  });
  expect(diagnostics.root.findByProps({testID: 'diagnostics-event-count'}).props.children).toContain('20');
  expect(JSON.stringify(diagnostics.toJSON())).not.toMatch(/payload|sample|site|note/i);
});

test.each([
  'watch_recording', 'sync', 'auth_account', 'freeze_exit', 'notification', 'other',
])('marks the fixed %s incident category', async category => {
  const markIncident = jest.fn(async () => 'incident-id');
  const renderer = await renderDiagnosticsScreen({markIncident});
  await press(renderer, `diagnostics-incident-${category}`);
  expect(markIncident).toHaveBeenCalledWith(category);
});

test('requires confirmation before local clear and Watch purge', async () => {
  const clearAll = jest.fn(async () => undefined);
  const renderer = await renderDiagnosticsScreen({clearAll});
  await press(renderer, 'diagnostics-clear');
  expect(clearAll).not.toHaveBeenCalled();
  confirmAlert();
  expect(clearAll).toHaveBeenCalledWith(expect.any(Number));
});
```

- [ ] **Step 2: Run UI tests and confirm missing route/screen failures**

Run: `yarn workspace @repo/mobile test settings-screen.test.tsx diagnostics-screen.test.tsx --runInBand`

Expected: FAIL because the route, row, translations, and screen do not exist.

- [ ] **Step 3: Implement the diagnostics UI**

Add a `진단` / `Diagnostics` row under a separate Settings support section. The detail screen shows:

- included date range;
- total/Mobile/Watch event counts;
- file size;
- disclosure that app/build, OS, general device model, event outcomes, counts, and timing are included;
- disclosure that account identity, location, notes, media, plans, dive values/samples, and raw payloads are excluded;
- six fixed incident buttons;
- `진단 파일 공유` / `Share diagnostic file`;
- destructive `진단 기록 전체 삭제` / `Delete all diagnostic records` with confirmation.

Export button flow: refresh summary → refuse an empty export with localized alert → create export → invoke native share → refresh summary. Clear flow: capture `before = Date.now() / 1000` → call the single `clearAll(before)` action → refresh. When `watchPurgePending` is true, state that Watch deletion will resume when connected rather than reporting complete cross-device deletion.

- [ ] **Step 4: Run UI, navigation, and localization gates**

Run: `yarn workspace @repo/mobile test settings-screen.test.tsx diagnostics-screen.test.tsx App.test.tsx --runInBand`

Expected: PASS.

Run: `yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the diagnostics UI**

```bash
git add apps/mobile/src/screens/settings apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/settings-screen.test.tsx apps/mobile/__tests__/diagnostics-screen.test.tsx apps/mobile/__tests__/App.test.tsx
git commit -m "feat: add diagnostics settings workflow"
```

### Task 10: Prove privacy, failure isolation, and repository-wide readiness

**Files:**
- Create: `apps/mobile/__tests__/diagnostic-privacy-regression.test.ts`
- Create: `docs/testing/diagnostics-device-checklist.md`
- Modify after implementation evidence: `.wiki/raw/architecture/2026-08-02-device-local-diagnostics-implementation.md`
- Modify after implementation evidence: `.wiki/wiki/decisions/adr-privacy-minimized-diagnostics.md`
- Modify after implementation evidence: `.wiki/wiki/architecture/implementation-priorities.md`
- Modify after implementation evidence: `.wiki/wiki/questions/open-questions.md`
- Modify after implementation evidence: `.wiki/wiki/index.md`
- Modify after implementation evidence: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes every Task 1–9 deliverable.
- Produces automated evidence plus a paired-device checklist; wiki changes must distinguish automated implementation from unverified physical behavior.

- [ ] **Step 1: Add a repository-wide privacy regression test**

```ts
test('diagnostic call sites cannot persist forbidden data names', () => {
  const sources = readDiagnosticCallSiteSources();
  expect(sources).not.toMatch(
    /attributes\s*:\s*\{[^}]*\b(userId|accountId|email|token|credential|latitude|longitude|siteName|notes|samples|payloadJson|localSessionId)\b/s,
  );
});

test('session and diagnostic acknowledgement code paths remain distinct', () => {
  const source = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
  expect(source).toContain('pendingAcknowledgements');
  expect(source).toContain('pendingDiagnosticAcknowledgements');
  expect(source).not.toMatch(
    /acknowledgeImportedOnStateQueue[\s\S]*pendingDiagnosticAcknowledgements/,
  );
});
```

- [ ] **Step 2: Run the privacy test and fix only concrete violations**

Run: `yarn workspace @repo/mobile test diagnostic-privacy-regression.test.ts --runInBand`

Expected: PASS. If it fails, remove or map the violating field to a finite safe enum/count; never weaken the regex by excluding a production call site.

- [ ] **Step 3: Write the physical-device checklist**

The checklist must contain exact pass evidence for:

- iPhone/Watch foreground transfer and independent diagnostic ACK;
- Watch unreachable → reconnect → one idempotent import;
- duplicate file delivery and ACK loss;
- iPhone background/force-quit receive and next-launch summary;
- 3-day/1-MiB Watch and 14-day/10-MiB mobile pruning;
- incident marker with 10-minute pre/5-minute post analysis window;
- JSONL opening in the repository with manifest/count/order validation;
- no location, user/account ID, token, notes, plan, dive values/samples, session ID, or payload in a canary export;
- clear while Watch offline, reconnect, purge ACK, and no old diagnostic replay;
- dive session import/local ACK continuing when diagnostic journal/transfer is forced to fail;
- Android local record/export/clear behavior;
- explicit statement that no remote upload/native crash capture is present.

- [ ] **Step 4: Run the complete automated gates**

Run: `yarn workspace @repo/mobile test --runInBand`

Expected: all mobile Jest suites pass.

Run: `yarn workspace @repo/mobile android:test:diagnostics`

Expected: Android diagnostic journal tests pass.

Run: `yarn workspace @repo/mobile watch:test:build`

Expected: Watch XCTest target builds.

Run: `yarn check:quick`

Expected: contract regeneration succeeds with no unexpected generated drift.

Run: `yarn mobile:typecheck`

Expected: PASS.

Run: `yarn ios:build`

Expected: PASS when CocoaPods workspace prerequisites are available.

Run: `yarn watch:build`

Expected: `** BUILD SUCCEEDED **`.

Run: `yarn codex:check`

Expected: PASS. Sandbox cache/global-folder and CoreSimulator logging warnings are environmental only when the command exits successfully.

- [ ] **Step 5: Perform paired-device gates without overstating results**

Execute `docs/testing/diagnostics-device-checklist.md` on a signed iPhone/Watch pair. Record build identifier, OS/device families, exact scenario, exported file SHA-256, and pass/fail. Do not include Watch name, account identity, dive data, location, or raw diagnostic contents in the evidence document. Leave every unrun scenario unchecked.

- [ ] **Step 6: Update wiki from implementation evidence**

Create the new immutable raw source first. Change the ADR status to `Implemented; physical verification pending` only after Tasks 1–9 and automated gates pass. Keep remote collection/native crash work in open questions. Mark individual physical behaviors complete only when the checklist contains evidence. Update wiki index/log per `karpathy-llm-wiki` and Korean wording/safety boundaries per `wiki-writing`.

- [ ] **Step 7: Commit final verification and wiki evidence**

```bash
git add apps/mobile/__tests__/diagnostic-privacy-regression.test.ts docs/testing/diagnostics-device-checklist.md .wiki/raw/architecture/2026-08-02-device-local-diagnostics-implementation.md .wiki/wiki/decisions/adr-privacy-minimized-diagnostics.md .wiki/wiki/architecture/implementation-priorities.md .wiki/wiki/questions/open-questions.md .wiki/wiki/index.md .wiki/wiki/log.md
git commit -m "docs: record device-local diagnostics readiness"
```

## Execution notes

- Execute tasks in order. Task 1 fixes the cross-language contract; Tasks 2–4 establish the recording/storage boundary; Tasks 5–7 add producers and Watch transport; Tasks 8–9 expose explicit user actions; Task 10 is the release-quality evidence gate.
- Review each commit for forbidden-field leakage before starting the next task. A later privacy test does not excuse unsafe intermediate call-site APIs.
- If the same verification gate fails three times for the same reason, stop and report the command, concise error, attempted fixes, and required manual action.
- Do not install or configure a remote diagnostics plugin/provider as part of this plan.
