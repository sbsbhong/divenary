# Watch Profile File Sync Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store bounded one-hertz Watch dive profiles as durable per-session files, deliver every session through `transferFile`, make mobile import/ACK/notification lifecycle crash-safe, and repair the physical-iPhone notification toggle.

**Architecture:** Raw Watch sensor callbacks keep driving live UI and transient engines while a one-second bucket sampler writes a canonical review profile. A small Watch manifest points to immutable session artifacts; iPhone native code copies each WC file into a durable inbox and owns a revision-aware ACK outbox; mobile AsyncStorage stores sample-free metadata and native profile references. Session bodies use `transferFile` only, while ACK and planned-dive control traffic retain their small-message paths.

**Tech Stack:** Swift 6, SwiftUI, Combine, WatchConnectivity, CryptoKit, Foundation file APIs, React Native 0.85.3, React 19, TypeScript 5.8, React Query 5, AsyncStorage, Notifee 9.1.8, Jest 29, XCTest, JSON Schema generators, Yarn 1.22.22, Turborepo.

## Global Constraints

- The product is a recreational logging and post-dive review companion, not a certified dive computer, decompression computer, medical device, life-support system, or emergency decision system.
- Do not add decompression, tissue loading, gas-switching safety, emergency decisions, or certified-device claims.
- Use Yarn `1.22.22`; do not update lockfiles with npm, pnpm, or bun.
- Generated contract output is never edited directly; change schemas/generators, then run generation.
- New Watch session bodies use `WCSession.transferFile` only; do not add a chunk protocol.
- ACK and planned-dive control messages remain small message/user-info/application-context traffic.
- Raw sensor callbacks remain available to live UI/state; persisted profile buckets are one second, contain actual observations only, and never synthesize missing seconds or `0°C`.
- Store artifact SHA-256 and byte count outside the artifact bytes in manifests/descriptors/references/ACKs to avoid circular hashing.
- Supabase, Auth, RLS, remote push, and remote upload are outside implementation scope.
- Explicit iPhone force-quit does not promise immediate transfer or notification; recover on a later launch.
- Preserve unrelated dirty files in the main checkout, especially `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings` and `skills-lock.json`.
- Update the repository wiki in Korean with immutable raw sources, compiled pages, index, and log.

## File Structure

### Contracts

- Create `packages/contracts/schemas/watch-profile-metadata.schema.json`: versioned profile cadence/revision/count/interrupted metadata embedded in the session artifact.
- Modify `packages/contracts/schemas/watch-depth-sample.schema.json`: optional bucket minimum/maximum depth.
- Modify `packages/contracts/schemas/watch-session.schema.json`: optional `profile` metadata for backward compatibility.
- Regenerate `packages/contracts/generated/typescript/index.ts` and `packages/contracts/generated/swift/WatchContracts.swift` through existing scripts.

### Watch app

- Create `apps/mobile/ios/DiveWatchApp/Recording/OneHertzProfileSampler.swift`: pure bucket aggregation.
- Create `apps/mobile/ios/DiveWatchApp/Storage/DiveProfileArtifactStore.swift`: journal, immutable artifact, digest, manifest, migration, and recovery.
- Modify `apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift`: bucket-extrema representation and validation.
- Modify `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`: profile metadata, preview creation, artifact encoding without self-hash.
- Modify `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`: raw/live path plus one-hertz persistence path.
- Modify `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`: manifest-backed list, atomic legacy migration, retry by artifact identity.
- Modify `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncEnvelope.swift`: revision/digest file metadata and revision-aware ACK.
- Modify `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`: file-only session enqueue and outstanding-transfer dedupe.
- Modify `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`: target membership for new Swift/test files.
- Create focused XCTest files under `apps/mobile/ios/DiveWatchAppTests/`.

### iPhone native

- Create `apps/mobile/ios/DiveMobile/WatchProfileFileStore.swift`: durable inbox/permanent/quarantine file operations and SHA-256 verification.
- Create `apps/mobile/ios/DiveMobile/WatchAcknowledgementOutbox.swift`: Codable ACK state and retry decisions.
- Modify `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`: activation state machine, file descriptors, legacy normalization, ACK orchestration.
- Modify `apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift` and `WatchConnectivityModuleBridge.m`: descriptor/read/promote/store/read/delete/complete bridge methods.
- Create `apps/mobile/ios/DiveMobileTests/WatchProfileFileStoreTests.swift` and `WatchAcknowledgementOutboxTests.swift`, plus an iOS unit-test target/scheme in the Xcode project.
- Create `apps/mobile/scripts/ios-native-test.mjs` and add `ios:native:test` to `apps/mobile/package.json`: select an available iPhone Simulator and run the native test scheme deterministically.

### Mobile TypeScript/React Native

- Modify `apps/mobile/src/native/watch-connectivity.ts`: descriptor-based API and profile file bridge.
- Create `apps/mobile/src/repositories/dive-profile-repository.ts`: profile reference and repository interface.
- Create `apps/mobile/src/repositories/native-dive-profile-repository.ts`: native bridge adapter.
- Create `apps/mobile/src/repositories/in-memory-dive-profile-repository.ts`: deterministic test adapter.
- Modify dive-log repository types/implementations and `watch-session-to-dive-log-entry.ts`: sample-free metadata plus profile reference/import outcome.
- Create `apps/mobile/src/states/use-dive-profile.ts`: lazy React Query profile load.
- Modify log detail/home mapping to consume full lazy samples or bounded previews.
- Modify app preferences, Watch sync provider/coordinator, notification service, bootstrap, navigation, and Settings screen for lifecycle/authorization behavior.
- Add focused Jest coverage in existing suites and new focused repository/lifecycle suites.

### Documentation

- Add new `.wiki/raw/architecture/` and `.wiki/raw/decisions/` sources.
- Update compiled Watch/mobile/sync/Supabase-boundary/dive-log/QA/open-question/index/log pages.
- Update `README.md`, active WatchConnectivity checklist, and architecture text that claims hybrid session transport or monolithic sample storage.

---

### Task 1: Extend the generated Watch profile contract

**Files:**
- Create: `packages/contracts/schemas/watch-profile-metadata.schema.json`
- Modify: `packages/contracts/schemas/watch-depth-sample.schema.json`
- Modify: `packages/contracts/schemas/watch-session.schema.json`
- Modify: `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`
- Modify: `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
- Modify: `apps/mobile/src/utils/watch-sync-message-validation.ts`
- Generate: `packages/contracts/generated/typescript/index.ts`
- Generate: `packages/contracts/generated/swift/WatchContracts.swift`

**Interfaces:**
- Produces: `WatchProfileMetadata { formatVersion: 1; contentRevision: string; sampleIntervalSeconds: 1; sampleCount: number; interrupted?: boolean }`.
- Produces: optional `bucketMinDepthMeters` and `bucketMaxDepthMeters` on `WatchDepthSample`.
- Preserves: legacy messages without `session.profile`.

- [ ] **Step 1: Add failing validator tests**

Add test cases that accept exact profile metadata/extrema, reject unknown keys, reject `sampleIntervalSeconds !== 1`, reject negative counts, and continue accepting the existing minimal legacy fixture.

```ts
expect(parseWatchSyncMessage({
  ...baseMessage,
  session: {
    ...baseMessage.session,
    profile: {
      formatVersion: 1,
      contentRevision: 'revision-1',
      sampleIntervalSeconds: 1,
      sampleCount: baseMessage.session.samples.length,
    },
    samples: baseMessage.session.samples.map(sample => ({
      ...sample,
      bucketMinDepthMeters: sample.depthMeters,
      bucketMaxDepthMeters: sample.depthMeters,
    })),
  },
}).ok).toBe(true);
```

- [ ] **Step 2: Prove the tests fail**

Run: `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts --runInBand`

Expected: FAIL because `profile` and bucket extrema are unknown keys.

- [ ] **Step 3: Add schemas and runtime validation**

Define the profile schema with `additionalProperties: false`, exact format/cadence constants, non-empty revision, non-negative integer count, and optional interrupted flag. Reference it from `watch-session.schema.json`; add finite numeric extrema to the sample schema; mirror those rules in `watch-sync-message-validation.ts`.

```ts
type ProfileValidationResult = {
  formatVersion: 1;
  contentRevision: string;
  sampleIntervalSeconds: 1;
  sampleCount: number;
  interrupted?: boolean;
};
```

- [ ] **Step 4: Generate and verify**

Run: `yarn check:quick`

Expected: PASS and generated Swift/TypeScript include `WatchProfileMetadata` plus the optional extrema.

Run: `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/mobile/src/utils/watch-sync-message-validation.ts apps/mobile/__tests__/watch-sync-message-validation.test.ts
git commit -m "feat: define one hertz watch profile contract"
```

### Task 2: Implement deterministic one-hertz Watch sampling

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Recording/OneHertzProfileSampler.swift`
- Create: `apps/mobile/ios/DiveWatchAppTests/OneHertzProfileSamplerTests.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `mutating func append(_ sample: DepthSample) -> DepthSample?` returning the previous finalized bucket.
- Produces: `mutating func finish() -> DepthSample?` flushing the last bucket exactly once.
- Each returned `DepthSample` uses the last actual timestamp/depth and carries bucket extrema/latest optional pressure/temperature.

- [ ] **Step 1: Add failing sampler tests**

Cover multiple callbacks inside one second, bucket rollover, empty seconds, last-bucket flush, missing temperature, a later measured temperature, invalid/out-of-order input, and a three-hour one-hertz bound.

```swift
var sampler = OneHertzProfileSampler(startedAt: Date(timeIntervalSince1970: 1_000))
XCTAssertNil(sampler.append(sample(0.1, depth: 2)))
XCTAssertNil(sampler.append(sample(0.7, depth: 5)))
let first = try XCTUnwrap(sampler.append(sample(1.2, depth: 4)))
XCTAssertEqual(first.depthMeters, 5)
XCTAssertEqual(first.bucketMinDepthMeters, 2)
XCTAssertEqual(first.bucketMaxDepthMeters, 5)
```

- [ ] **Step 2: Prove the tests fail**

Run the existing Watch test scheme filtered to `OneHertzProfileSamplerTests`.

Expected: FAIL because the sampler/type fields do not exist.

- [ ] **Step 3: Implement the sampler**

Use integer bucket indices derived from `floor(sample.timestamp.timeIntervalSince(startedAt))`. Reject timestamps before start or earlier than the latest accepted timestamp. Do not synthesize buckets. Track last/min/max and latest optional measurements in a private bucket value.

```swift
struct OneHertzProfileSampler {
    private let startedAt: Date
    private var currentBucket: Bucket?
    private var lastAcceptedAt: Date?

    mutating func append(_ sample: DepthSample) -> DepthSample?
    mutating func finish() -> DepthSample?
}
```

- [ ] **Step 4: Run focused and existing model tests**

Expected: sampler tests PASS; existing invalid-sample and optional-temperature tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Recording/OneHertzProfileSampler.swift apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift apps/mobile/ios/DiveWatchAppTests/OneHertzProfileSamplerTests.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: persist bounded one hertz watch samples"
```

### Task 3: Add journaled Watch profile artifacts and manifest migration

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Storage/DiveProfileArtifactStore.swift`
- Create: `apps/mobile/ios/DiveWatchAppTests/DiveProfileArtifactStoreTests.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `DiveProfileArtifactIdentity(localSessionId: UUID, contentRevision: String, sha256: String, byteCount: Int, sampleCount: Int, relativePath: String)`.
- Produces: `DiveProfileManifestEntry` containing preview samples, summary, identity, and transfer state but no full sample array.
- Consumes: finalized one-hertz `DepthSample` values from Task 2.

- [ ] **Step 1: Add failing artifact and migration tests**

Test append/reopen, atomic finalization, digest/byte verification, immutable revision paths, bounded preview, interrupted recovery, corruption isolation, and all-or-nothing legacy migration.

```swift
let identity = try store.finalize(record: record, journalURL: journalURL)
let artifact = try Data(contentsOf: store.url(for: identity))
XCTAssertEqual(identity.byteCount, artifact.count)
XCTAssertEqual(identity.sha256, SHA256.hash(data: artifact).hexString)
XCTAssertEqual(try decodedMessage(from: artifact).session.samples.count, identity.sampleCount)
```

- [ ] **Step 2: Prove the tests fail**

Run the Watch test scheme filtered to artifact/migration tests.

Expected: FAIL because `DiveProfileArtifactStore` and manifest identities do not exist.

- [ ] **Step 3: Implement journal and immutable finalization**

Use Application Support `DiveWatchApp/Sessions/<session-id>/`. Append one compact JSON sample per line. Stream the finalized `WatchSyncMessage` framing and samples into a temporary file, atomically replace the revision artifact, calculate digest/bytes after finalization, verify decode, then update the small manifest.

```swift
struct DiveProfileArtifactIdentity: Codable, Equatable {
    let localSessionId: UUID
    let contentRevision: String
    let sha256: String
    let byteCount: Int
    let sampleCount: Int
    let relativePath: String
}
```

- [ ] **Step 4: Integrate recorder and store**

Keep raw callbacks for live fields/engines. Feed valid callbacks to the sampler; append only emitted buckets to the journal/profile array. Flush on stop. Persist active metadata at start and recover an interrupted record using the last journal timestamp on next launch. Change `DiveSessionStore` to publish manifest records/previews and retry from artifact identities.

- [ ] **Step 5: Implement idempotent legacy migration**

Convert each legacy full record to an artifact, verify it, and add a manifest entry. Retain `savedDiveSessionRecords.json` until all entries verify. A second migration run must reuse matching artifacts and produce no duplicate session.

- [ ] **Step 6: Run tests and build**

Run focused Watch tests, then `yarn watch:build`.

Expected: PASS; long fixture produces a bounded preview and full artifact without a monolithic persisted session array.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp apps/mobile/ios/DiveWatchAppTests apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: store watch profiles as immutable artifacts"
```

### Task 4: Make Watch session transport file-only and revision-aware

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncEnvelope.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- Modify: `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`

**Interfaces:**
- Changes: `enqueue(artifact: DiveProfileArtifactIdentity, fileURL: URL) -> DiveSyncStatus` replaces session-body enqueue.
- Produces: file metadata keys for revision, digest, byte count, sample count, and format version.
- Consumes: revision-aware ACK dictionaries and reports `(sessionId, revision, digest, status)`.

- [ ] **Step 1: Add failing transport tests**

Assert short and large artifacts both call `transferFile`, no session body calls `sendMessage`/`transferUserInfo`, retries skip an equivalent `outstandingFileTransfer`, canonical files survive transfer completion, and stale ACKs do not sync newer revisions.

- [ ] **Step 2: Prove the tests fail**

Run focused Watch transport tests and native source contract Jest.

Expected: FAIL because the current 48 KiB hybrid path remains.

- [ ] **Step 3: Implement file-only enqueue**

Remove `directMessagePayloadLimitBytes` selection for session bodies. Guard activation/file existence/integrity, compare metadata identity against outstanding transfers, and call `transferFile(fileURL, metadata:)` once per identity. Do not delete canonical files from `didFinish`.

- [ ] **Step 4: Implement revision-aware ACK matching**

Require acknowledgement kind, local session ID, content revision, and digest. Update Watch status only when all match the current manifest entry. Preserve planned-dive control handling.

- [ ] **Step 5: Run tests and commit**

Expected: focused tests and `yarn watch:build` PASS.

```bash
git add apps/mobile/ios/DiveWatchApp/Sync apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift apps/mobile/ios/DiveWatchAppTests apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "feat: send watch sessions through transfer files"
```

### Task 5: Build the iPhone durable file inbox

**Files:**
- Create: `apps/mobile/ios/DiveMobile/WatchProfileFileStore.swift`
- Create: `apps/mobile/ios/DiveMobileTests/WatchProfileFileStoreTests.swift`
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
- Create/Modify: `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveMobileTests.xcscheme`
- Create: `apps/mobile/scripts/ios-native-test.mjs`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Produces: `PendingWatchProfileDescriptor` with payload ID, relative path, identity, received time, byte count, and promotion state.
- Produces: synchronous `receive(fileURL:metadata:) throws -> PendingWatchProfileDescriptor` that copies and verifies before returning.
- Produces: legacy inline normalization into the same descriptor type.

- [ ] **Step 1: Add the iOS unit-test target and failing tests**

Test transient copy durability, descriptor-only UserDefaults encoding, restart reconstruction, same-identity dedupe, size/digest mismatch quarantine, legacy inline normalization, promote idempotency, cleanup, and simulated write failure.

```swift
let descriptor = try store.receive(fileURL: transientURL, metadata: metadata)
XCTAssertTrue(FileManager.default.fileExists(atPath: store.url(for: descriptor).path))
let persistedDescriptors = try XCTUnwrap(userDefaults.data(forKey: pendingKey))
XCTAssertNil(persistedDescriptors.range(of: payloadData))
```

- [ ] **Step 2: Prove the tests fail**

Create `ios-native-test.mjs` to read `xcrun simctl list devices available --json`, select the first available iPhone, and invoke `xcodebuild` with that device UDID. Run: `yarn workspace @repo/mobile ios:native:test`.

Expected: FAIL before target/store implementation.

- [ ] **Step 3: Implement file store and descriptor persistence**

Use Application Support subdirectories `WatchSync/Inbox`, `WatchSync/Profiles`, and `WatchSync/Quarantine`. Sanitize filenames from generated payload IDs, copy through a temporary sibling, calculate CryptoKit SHA-256, compare metadata, atomically move, then persist the descriptor. Never encode payload JSON in UserDefaults.

- [ ] **Step 4: Integrate WC delegate and legacy messages**

Replace `Data -> String -> UserDefaults` in `didReceive file` with the synchronous store operation. Convert accepted legacy inline messages into an inbox file before dispatching the event. Events and drains expose descriptor dictionaries only.

- [ ] **Step 5: Add DEBUG fixture injection**

Add a `#if DEBUG` native method that accepts a complete fixture JSON string, writes it through the same receive/verify path, and emits the normal descriptor event. The Release compilation path must not export it.

- [ ] **Step 6: Run native tests and commit**

Expected: `DiveMobileTests` PASS and native source Jest confirms payload bodies are absent from UserDefaults.

```bash
git add apps/mobile/ios/DiveMobile apps/mobile/ios/DiveMobileTests apps/mobile/ios/DiveMobile.xcodeproj apps/mobile/scripts/ios-native-test.mjs apps/mobile/package.json
git commit -m "feat: persist watch files in a durable iphone inbox"
```

### Task 6: Add a durable activation-gated ACK outbox

**Files:**
- Create: `apps/mobile/ios/DiveMobile/WatchAcknowledgementOutbox.swift`
- Create: `apps/mobile/ios/DiveMobileTests/WatchAcknowledgementOutboxTests.swift`
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift`
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityModuleBridge.m`

**Interfaces:**
- Produces: `PendingWatchSyncAcknowledgement` keyed by session/revision/digest.
- Produces: `completeImportedPayload(payloadId:)` transaction that durably enqueues ACK before removing inbound state.
- Produces: activation/reachability/restart flush with outstanding user-info dedupe.

- [ ] **Step 1: Add failing state-machine tests**

Cover enqueue-before-delete, activation not completed, activation error then retry, restart reconstruction, send error, user-info completion success/error, duplicate identity, and stale-revision separation.

- [ ] **Step 2: Prove the tests fail**

Run the `DiveMobileTests` ACK filter.

Expected: FAIL because acknowledgement intent is not persisted.

- [ ] **Step 3: Implement the pure outbox state**

```swift
struct PendingWatchSyncAcknowledgement: Codable, Equatable {
    let acknowledgementId: String
    let localSessionId: String
    let contentRevision: String
    let sha256: String
    let acknowledgedAt: TimeInterval
    var attemptCount: Int
}
```

Persist small values to UserDefaults. The state layer must not call WatchConnectivity directly; `WatchConnectivityInbox` supplies current activation/outstanding-transfer facts and applies state transitions.

- [ ] **Step 4: Fix activation and ACK orchestration**

Replace the sticky `isActivated` Boolean with requested/completed/error-aware activation state. Flush only after `.activated`. Use reachable message as a fast attempt and queued user-info as durable delivery. Retain the app outbox until one transport completion succeeds; on error increment/retain for the next trigger. Call `completeImportedPayload` only after JS repository commit.

- [ ] **Step 5: Run tests and commit**

Expected: native ACK tests PASS; cold-start import can persist an ACK before inbound cleanup even while activation is incomplete.

```bash
git add apps/mobile/ios/DiveMobile apps/mobile/ios/DiveMobileTests
git commit -m "fix: make watch import acknowledgements durable"
```

### Task 7: Expose native profile files and add the mobile profile repository

**Files:**
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift`
- Modify: `apps/mobile/ios/DiveMobile/WatchConnectivityModuleBridge.m`
- Modify: `apps/mobile/src/native/watch-connectivity.ts`
- Create: `apps/mobile/src/repositories/dive-profile-repository.ts`
- Create: `apps/mobile/src/repositories/native-dive-profile-repository.ts`
- Create: `apps/mobile/src/repositories/in-memory-dive-profile-repository.ts`
- Create: `apps/mobile/__tests__/dive-profile-repository.test.ts`

**Interfaces:**
- Produces: `DiveProfileReference { profileId; localSessionId; contentRevision; sha256; byteCount; sampleCount; sampleIntervalSeconds; previewSamples }`.
- Produces: `DiveProfileRepository.promotePending`, `storeLegacy`, `load`, and `delete`.
- Consumes: descriptor APIs from Tasks 5-6.

- [ ] **Step 1: Add failing TypeScript repository tests**

Test idempotent promote/store, reference equality, artifact parse/load, missing profile error, delete, bounded extrema-preserving preview, and no profile JSON in the reference.

```ts
const reference = await repository.promotePending({ payloadId: 'payload-1', profileId: 'profile-1' });
expect(reference).toMatchObject({ profileId: 'profile-1', sha256: 'digest-1', sampleIntervalSeconds: 1 });
await expect(repository.load(reference)).resolves.toEqual(samples);
```

- [ ] **Step 2: Prove the tests fail**

Run: `yarn workspace @repo/mobile test dive-profile-repository.test.ts --runInBand`

Expected: FAIL because the repository APIs do not exist.

- [ ] **Step 3: Add native bridge methods**

Expose descriptor drain, read-one-pending JSON, promote pending, store legacy artifact, read stored artifact, delete stored artifact, complete imported payload, and DEBUG injection. Validate all identifier strings natively and reject missing/corrupt files with structured errors.

- [ ] **Step 4: Implement TypeScript adapters**

The native adapter parses/validates artifact JSON only on explicit load. The in-memory adapter mirrors identity/dedupe behavior for Jest. Build previews with the existing peak-preserving render-model utility capped at 160 points while preserving bucket extrema in canonical samples.

- [ ] **Step 5: Run tests/typecheck and commit**

Expected: focused tests and `yarn mobile:typecheck` PASS.

```bash
git add apps/mobile/ios/DiveMobile/WatchConnectivityModule* apps/mobile/src/native/watch-connectivity.ts apps/mobile/src/repositories/*dive-profile* apps/mobile/__tests__/dive-profile-repository.test.ts
git commit -m "feat: add native-backed mobile dive profiles"
```

### Task 8: Migrate log metadata and make imports transactional/idempotent

**Files:**
- Modify: `apps/mobile/src/types/dive-log-entry.ts`
- Modify: `apps/mobile/src/repositories/dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/local-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/default-dive-log-repository.ts`
- Modify: `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/states/watch-connectivity-import-coordinator.ts`
- Modify: related repository/import Jest suites.

**Interfaces:**
- Produces: sample-free `WatchSessionMetadata = Omit<WatchSession, 'samples'>`.
- Changes: `DiveLogWatchCapture` owns `profile: DiveProfileReference`, not duplicate sample arrays.
- Produces: `importWatchProfile(input) -> { entries; importedEntry?; outcome: 'created' | 'updated' | 'duplicate' }`.
- Calls: native `completeImportedPayload` only after profile promotion and metadata commit.

- [ ] **Step 1: Add failing migration/import tests**

Cover schema-3 embedded samples migrated to a verified profile before schema-4 metadata write; manual fields/provenance preservation; new import; duplicate revision; newer revision; crash after promote/before metadata; repository failure with no complete/ACK; and duplicate redelivery re-enqueuing ACK without notification.

- [ ] **Step 2: Prove the tests fail**

Run the persistent repository and Watch sync Jest suites.

Expected: FAIL because samples remain duplicated and ACK occurs through the old method.

- [ ] **Step 3: Introduce sample-free types and import outcome**

```ts
export type WatchSessionMetadata = Omit<WatchSession, 'samples'>;

export type WatchProfileImportResult = {
  entries: DiveLogEntry[];
  importedEntry?: DiveLogEntry;
  outcome: 'created' | 'updated' | 'duplicate';
};
```

Strip samples only after the profile repository confirms durability. Preserve current manual/mobile merge rules and use session/revision/digest as content identity.

- [ ] **Step 4: Add async legacy migration**

Allow schema-3 data to decode, write each Watch profile through `storeLegacy`, verify load/count, then write schema-4 entries containing references. If any profile write fails, do not write schema 4 and surface the read error; retry on next read.

- [ ] **Step 5: Rewrite descriptor import transaction**

Drain descriptors, read one payload, validate, promote, import metadata, update query cache, persist ACK/complete inbound, then present only when outcome is created/updated. Invalid contract payloads quarantine/remove only through an explicit native invalid-payload method and never send success ACK.

- [ ] **Step 6: Run tests/typecheck and commit**

Expected: focused repository/import tests and `yarn mobile:typecheck` PASS; serialized coordinator continues after failures.

```bash
git add apps/mobile/src apps/mobile/__tests__
git commit -m "refactor: separate dive metadata from profile files"
```

### Task 9: Load full profiles lazily in mobile UI

**Files:**
- Create: `apps/mobile/src/states/use-dive-profile.ts`
- Modify: `apps/mobile/src/states/use-dive-logbook.ts`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Modify: `apps/mobile/__tests__/use-dive-logbook.test.ts`

**Interfaces:**
- Produces: `useDiveProfile(reference, repository)` React Query result keyed by profile ID/revision/digest.
- Home/session mapping consumes `profile.previewSamples`; detail consumes the full query result.

- [ ] **Step 1: Add failing UI/state tests**

Assert list/home render from summary/preview without loading full JSON, detail shows loading state then full depth/temperature profiles, missing profile shows a non-destructive unavailable message, and delete removes metadata then profile.

- [ ] **Step 2: Prove the tests fail**

Run focused logbook and hook tests.

Expected: FAIL because components read `watchCapture.samples` synchronously.

- [ ] **Step 3: Implement lazy query and UI states**

```ts
export const diveProfileQueryKey = (reference: DiveProfileReference) => [
  'dive-profile', reference.profileId, reference.contentRevision, reference.sha256,
] as const;
```

Use preview samples only in `diveLogEntryToMobileSession`. Pass loaded samples into `LogEntryDetail`; do not mutate metadata entries with loaded arrays. Keep temperature profile hidden when no measured temperature exists.

- [ ] **Step 4: Run tests and commit**

Expected: focused tests and `yarn mobile:typecheck` PASS.

```bash
git add apps/mobile/src/states/use-dive-profile.ts apps/mobile/src/states/use-dive-logbook.ts apps/mobile/src/screens/logbook apps/mobile/src/components/navigation/index.tsx apps/mobile/__tests__
git commit -m "feat: load dive profiles on demand"
```

### Task 10: Fix preference hydration, AppState drain, and notification press lifecycle

**Files:**
- Modify: `apps/mobile/src/states/app-preferences.tsx`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/notifications/watch-sync-notification-service.ts`
- Create: `apps/mobile/src/notifications/watch-sync-notification-open-storage.ts`
- Modify: `apps/mobile/index.js`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/__tests__/app-preferences.test.tsx`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Modify: `apps/mobile/__tests__/watch-sync-notification-service.test.ts`

**Interfaces:**
- Adds: `AppPreferences.isHydrated: boolean`.
- Adds: `registerWatchSyncNotificationBackgroundHandler()` called once before `AppRegistry.registerComponent`.
- Produces: persisted `consumePendingWatchSyncNotificationOpen()` and navigation-ready queue.
- Presentation outcome is exclusive: active toast, non-active authorized local notification, duplicate none.

- [ ] **Step 1: Add failing lifecycle tests**

Test delayed stored `true` hydration before first drain, storage failure resolving hydration, missed event recovered on background→active, background import without queued toast, foreground import without local notification, duplicate revision silence, bootstrap PRESS persistence, and navigation-ready consumption.

- [ ] **Step 2: Prove the tests fail**

Run the three focused Jest suites.

Expected: FAIL for initial false race, no AppState listener, and absent background handler.

- [ ] **Step 3: Add hydration and resume drain**

Set `isHydrated` in `finally` after preference load. Subscribe to native events immediately but queue descriptors until hydration. Serialize a drain when hydration becomes true and on AppState transition to active; coalesce overlapping drains through the existing coordinator.

- [ ] **Step 4: Make presentation exclusive and revision-deduped**

Capture AppState at presentation time. Invoke toast only for `active`; invoke Notifee only for non-active and enabled/authorized. Persist a revision presentation marker with the imported metadata or coordinator result so redelivery/ACK retry does not present again.

- [ ] **Step 5: Register background press and defer navigation**

Call the registration function in `index.js`. Persist valid Watch notification open data through the existing key-value abstraction; on navigation `onReady`, consume initial, background, and buffered foreground opens through one decoder and one local-ID dedupe set.

- [ ] **Step 6: Run tests and commit**

Expected: focused tests and `yarn mobile:typecheck` PASS.

```bash
git add apps/mobile/index.js apps/mobile/src/states apps/mobile/src/notifications apps/mobile/src/components/navigation/index.tsx apps/mobile/__tests__
git commit -m "fix: reconcile watch imports across app lifecycle"
```

### Task 11: Repair the physical-iPhone notification toggle

**Files:**
- Modify: `apps/mobile/src/notifications/watch-sync-notification-service.ts`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/states/app-preferences.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/watch-sync-notification-service.test.ts`
- Modify: `apps/mobile/__tests__/settings-screen.test.tsx`
- Modify: `apps/mobile/__tests__/app-preferences.test.tsx`

**Interfaces:**
- Produces: `getWatchSyncNotificationAuthorization() -> 'notDetermined' | 'denied' | 'authorized'`.
- Produces: `enableWatchSyncNotifications() -> { status: 'enabled' | 'denied' | 'error' }`.
- Produces: `openWatchSyncNotificationSettings()` using `Linking.openSettings()` on iOS and Notifee settings on Android.
- Reconciles effective enabled state on AppState active.

- [ ] **Step 1: Add failing permission-state tests**

Cover already authorized, provisional, first request granted/denied, prior denied without repeated prompt, iOS `Linking.openSettings`, Android Notifee settings, return from Settings authorized, revoked permission, request exception, busy double tap, and disable behavior.

```ts
(notifee.getNotificationSettings as jest.Mock).mockResolvedValueOnce({
  authorizationStatus: AuthorizationStatus.DENIED,
});
await expect(enableWatchSyncNotifications()).resolves.toEqual({ status: 'denied' });
expect(notifee.requestPermission).not.toHaveBeenCalled();
```

- [ ] **Step 2: Prove the tests fail**

Run Settings, notification service, and preferences tests.

Expected: FAIL because the current Boolean permission helper silently returns false.

- [ ] **Step 3: Implement authorization service**

Read settings first. Request only from `NOT_DETERMINED`, then read again. Treat AUTHORIZED and PROVISIONAL as authorized. Return structured denied/error outcomes. Use `Linking.openSettings()` for iOS because installed Notifee 9.1.8 makes `openNotificationSettings()` Android-only.

- [ ] **Step 4: Implement Settings UX and reconciliation**

Disable the row while the async operation is active. On denied, show an accessible translated Alert with Cancel and Open Settings. On AppState active, re-read authorization; enable stored preference when the user just granted from Settings, and make effective state false if authorization was revoked. Disabling updates app preference only.

- [ ] **Step 5: Run tests and commit**

Expected: focused tests and `yarn mobile:typecheck` PASS.

```bash
git add apps/mobile/src/notifications/watch-sync-notification-service.ts apps/mobile/src/screens/settings/screen.tsx apps/mobile/src/states/app-preferences.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__
git commit -m "fix: reconcile physical notification permission toggle"
```

### Task 12: Update the detailed repository wiki and active documentation

**Files:**
- Create: `.wiki/raw/architecture/2026-07-12-one-hertz-watch-profile-storage.md`
- Create: `.wiki/raw/architecture/2026-07-12-file-backed-watch-sync-reliability.md`
- Create: `.wiki/raw/decisions/adr-one-hertz-file-backed-watch-profiles.md`
- Update: `.wiki/wiki/architecture/watch-app.md`
- Update: `.wiki/wiki/architecture/mobile.md`
- Update: `.wiki/wiki/architecture/sync-flow.md`
- Update: `.wiki/wiki/architecture/supabase.md`
- Update: `.wiki/wiki/domains/dive-log.md`
- Update: `.wiki/wiki/architecture/implementation-priorities.md`
- Update: `.wiki/wiki/project/diving-app-qa-test-plan.md`
- Update: `.wiki/wiki/questions/open-questions.md`
- Update: `.wiki/wiki/questions/diving-app-open-questions.md`
- Update: `.wiki/wiki/decisions/adr-index.md`
- Update: `.wiki/wiki/index.md`
- Update: `.wiki/wiki/log.md`
- Update: `README.md`
- Update: `docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md`

**Interfaces:**
- Documents: source-of-truth ownership, file layout, one-hertz semantics, digest identity, lifecycle state machine, migration/recovery, simulator boundary, physical toggle, and future Supabase metadata-table/private-Storage mapping.

- [ ] **Step 1: Read the wiki workflow skills completely**

Read `.agents/skills/karpathy-llm-wiki/SKILL.md` and `.agents/skills/wiki-writing/SKILL.md`, plus only their references required for architecture/ADR updates.

- [ ] **Step 2: Write immutable raw sources and ADR**

Record exact implemented file names/types/state transitions and the decision to treat source-side one-hertz buckets as canonical review samples. State that live raw callbacks are transient and the app remains non-certified.

- [ ] **Step 3: Update compiled knowledge**

Replace current-state claims about monolithic sample arrays, 48 KiB hybrid session transport, JSON bodies in UserDefaults, duplicate AsyncStorage samples, and non-durable ACKs. Preserve historical dated source documents and verification evidence.

- [ ] **Step 4: Update future Supabase boundary**

Document only the future mapping: session/log metadata row plus private immutable profile object with owner/path/revision/digest/count/format fields. Do not create Supabase directories, schema, client, or claims of implementation.

- [ ] **Step 5: Run wiki checks and commit**

Run the exact lint/compile commands specified by the two wiki skills, then `yarn codex:check` if the skill requires it.

Expected: wiki index/log and compiled pages are consistent; no stale current-state claims remain in README/checklist.

```bash
git add .wiki README.md docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md
git commit -m "docs: document file-backed watch profile sync"
```

### Task 13: Full verification, review, and main integration

**Files:**
- Update if needed: `docs/verification/watchconnectivity/2026-07-12-file-profile-sync-results.md`
- Modify only files required by findings from verification/review.

**Interfaces:**
- Produces: evidence-backed completion report and merged `main` commit.

- [ ] **Step 1: Run focused automated suites**

Run contract validation/generation, sampler/artifact/transport Watch tests, iPhone native tests, profile repository/import/lifecycle/settings Jest tests, and full mobile Jest.

Expected: all executed suites PASS with exact counts captured in the verification document.

- [ ] **Step 2: Run build gates**

Run:

```bash
yarn check:quick
yarn mobile:typecheck
yarn watch:build
yarn ios:build
yarn codex:check
```

Also run explicit Watch XCTest, Watch Release build, iOS native test target, and wiki gates from Task 12.

Expected: every executed command exits 0. If CocoaPods/device/simulator setup blocks a gate, record the exact command/error and do not claim it passed.

- [ ] **Step 3: Run Simulator fixture flow**

Build/launch the iPhone Simulator app, inject the deterministic complete profile artifact through the DEBUG inbox method, and verify one imported log, lazy full profile, toast behavior, durable inbox cleanup, and no chunk path. Relaunch and verify no duplicate import/presentation.

Expected: Simulator validates artifact import only; the evidence explicitly excludes real `transferFile`/queued background claims.

- [ ] **Step 4: Attempt available physical-device checks without overstating evidence**

If the paired iPhone/Watch are reachable, run the active checklist cases relevant to short/large file transfer, background/next-launch, revision ACK, and notification permission toggle. If they are unavailable, leave these cases `NOT RUN` with the environment reason.

- [ ] **Step 5: Review the diff and fix findings test-first**

Inspect `git diff main...HEAD`, search for old session-body `transferUserInfo`, raw JSON UserDefaults persistence, duplicate sample fields, stale ACK identity, missing hydration gates, DEBUG APIs in Release, unfinished markers, and safety-critical wording. Add a failing regression test before every behavioral correction.

- [ ] **Step 6: Write verification evidence and commit**

Create the dated results document with commit, environment, commands, outcomes, simulator boundary, physical cases, and known remaining platform limitations.

```bash
git add docs/verification/watchconnectivity/2026-07-12-file-profile-sync-results.md
git commit -m "test: record file profile sync verification"
```

- [ ] **Step 7: Merge into main without touching unrelated dirty files**

Confirm the main checkout's unrelated changes are still present and non-overlapping. Merge the feature branch with a merge commit. Re-run `git status --short` and the smallest post-merge smoke gate.

Expected: `main` contains the feature merge; pre-existing `Localizable.xcstrings`, `skills-lock.json`, installed skill directories, and cache files remain uncommitted/unmodified by the feature.
