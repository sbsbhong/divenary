import XCTest
@testable import DivenaryWatchApp

final class DiveSessionRecordMigrationTests: XCTestCase {
    @MainActor
    func testFreediveRecorderLiveMaxUsesRawSamplesBeforeSegmentStarts() async {
        let sensorProvider = ManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            profileStore: StubProfileRecordingStore(),
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .freedive))
        sensorProvider.emit(EngineTestFixtures.sample(0, depth: 0.9))
        await Task.yield()

        XCTAssertEqual(recorder.maxDepth, 0.9, accuracy: 0.001)
        recorder.cancelSession()
    }

    func testFreediveRecordSummaryUsesRawSampleMaxWhenPayloadHasNoSegments() {
        let samples = [
            EngineTestFixtures.sample(0, depth: 0),
            EngineTestFixtures.sample(1, depth: 0.9),
            EngineTestFixtures.sample(2, depth: 0.4)
        ]
        let record = DiveSessionRecord(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000789")!,
            schemaVersion: 2,
            diveMode: .freedive,
            siteId: nil,
            siteName: nil,
            sourcePlanLocalId: nil,
            planTitle: nil,
            buddyIds: [],
            gearIds: [],
            tags: [],
            notes: nil,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(2),
            samples: samples,
            payload: .freedive(
                FreeDiveSession(
                    id: UUID(uuidString: "00000000-0000-0000-0000-000000000789")!,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(2),
                    totalDurationSeconds: 2,
                    maxDepthMeters: 0,
                    diveCount: 0,
                    longestDiveDurationSeconds: 0,
                    segments: []
                )
            )
        )

        XCTAssertEqual(record.summary.maxDepthMeters, 0.9, accuracy: 0.001)
    }

    @MainActor
    func testScubaRecorderDropsNonFiniteSamplesBeforePersistence() async throws {
        let sensorProvider = ManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            captureMode: .demo,
            profileStore: StubProfileRecordingStore(),
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(EngineTestFixtures.sample(0, depth: 0))
        sensorProvider.emit(EngineTestFixtures.sample(60, depth: .nan))
        sensorProvider.emit(EngineTestFixtures.sample(120, depth: 0.4))
        await Task.yield()

        let record = try XCTUnwrap(recorder.stopSession())

        XCTAssertEqual(record.samples.map(\.depthMeters), [0, 0.4])
        XCTAssertTrue(record.samples.allSatisfy(\.isValidRecordingSample))
        XCTAssertNoThrow(try JSONEncoder().encode([record]))
    }

    @MainActor
    func testScubaRecorderKeepsLastMeasuredTemperatureWhenNextSampleHasNone() async throws {
        let sensorProvider = ManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            captureMode: .demo,
            profileStore: StubProfileRecordingStore(),
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(EngineTestFixtures.sample(0, depth: 0, temperature: 24))
        sensorProvider.emit(EngineTestFixtures.sample(60, depth: 2, temperature: nil))
        await Task.yield()

        let record = try XCTUnwrap(recorder.stopSession())

        XCTAssertEqual(recorder.waterTemperatureCelsius, 24)
        XCTAssertEqual(record.samples.count, 2)
        XCTAssertNil(record.samples.last?.waterTemperatureCelsius)
    }

    @MainActor
    func testRecorderUsesRawCallbacksForLiveStateAndPersistsOneSamplePerSecond() async throws {
        let sensorProvider = ManualDepthSensorProvider()
        let profileStore = StubProfileRecordingStore()
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            captureMode: .demo,
            profileStore: profileStore,
            now: { EngineTestFixtures.start }
        )

        recorder.startSession(plan: PreDivePlan(diveMode: .scuba))
        sensorProvider.emit(EngineTestFixtures.sample(0.1, depth: 2, temperature: 21))
        sensorProvider.emit(EngineTestFixtures.sample(0.8, depth: 7, temperature: nil))
        await Task.yield()

        XCTAssertEqual(recorder.currentDepth, 7)
        XCTAssertEqual(recorder.maxDepth, 7)
        XCTAssertTrue(recorder.samples.isEmpty)

        sensorProvider.emit(EngineTestFixtures.sample(1.2, depth: 4, temperature: 22))
        await Task.yield()
        let record = try XCTUnwrap(recorder.stopSession())

        XCTAssertEqual(record.schemaVersion, 3)
        XCTAssertEqual(record.samples.map(\.depthMeters), [7, 4])
        XCTAssertEqual(record.samples.first?.bucketMinDepthMeters, 2)
        XCTAssertEqual(record.samples.first?.bucketMaxDepthMeters, 7)
        XCTAssertEqual(record.samples.first?.waterTemperatureCelsius, 21)
        XCTAssertEqual(profileStore.appendedSamples.map(\.depthMeters), [7, 4])
    }

    @MainActor
    func testStoreSavesDebugFreediveWhenCompanionTransportFails() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let transport = StubWatchSyncTransport(enqueueStatus: .failed)
        let store = DiveSessionStore(userDefaults: userDefaults, syncTransport: transport, recordsStorageURL: storageURL)
        let record = Self.debugFreediveRecord()

        store.save(record)

        XCTAssertEqual(store.sessions.count, 1)
        XCTAssertEqual(store.sessions.first?.id, record.id)
        XCTAssertEqual(store.sessions.first?.syncStatus, .failed)
        XCTAssertEqual(transport.enqueuedArtifacts.map(\.localSessionId), [record.id])

        let persisted = try profileEntries(at: storageURL)
        XCTAssertEqual(persisted.map(\.id), [record.id])
        XCTAssertEqual(persisted.first?.displayRecord.syncStatus, .failed)
        XCTAssertNil(userDefaults.data(forKey: "savedDiveSessionRecords"))
    }

    @MainActor
    func testStoreRecoversValidInterruptedSessionWhenPeerMetadataIsCorrupt() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let rootURL = storageURL.deletingLastPathComponent()
        let profileStore = DiveProfileArtifactStore(rootURL: rootURL)
        let validSessionID = UUID(uuidString: "00000000-0000-0000-0000-000000000121")!
        let corruptSessionID = UUID(uuidString: "00000000-0000-0000-0000-000000000122")!
        let validMetadata = ActiveDiveRecordingMetadata(
            localSessionId: validSessionID,
            startedAt: EngineTestFixtures.start,
            captureMode: .real,
            plan: PreDivePlan(diveMode: .scuba)
        )
        let corruptMetadata = ActiveDiveRecordingMetadata(
            localSessionId: corruptSessionID,
            startedAt: EngineTestFixtures.start,
            captureMode: .real,
            plan: PreDivePlan(diveMode: .scuba)
        )
        try profileStore.beginRecording(validMetadata)
        try profileStore.append(EngineTestFixtures.sample(0.8, depth: 4), to: validSessionID)
        try profileStore.beginRecording(corruptMetadata)
        let corruptMetadataURL = rootURL
            .appendingPathComponent("Sessions", isDirectory: true)
            .appendingPathComponent(corruptSessionID.uuidString, isDirectory: true)
            .appendingPathComponent("active-recording.json")
        try Data("not-json".utf8).write(to: corruptMetadataURL, options: .atomic)

        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL,
            profileStore: profileStore
        )

        XCTAssertEqual(store.sessions.map(\.id), [validSessionID])
        XCTAssertEqual(store.sessions.first?.samples.first?.depthMeters, 4)
        XCTAssertEqual(store.sessions.first?.profile?.interrupted, true)
    }

    @MainActor
    func testStoreSavesDebugScubaWhenCompanionTransportFails() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let transport = StubWatchSyncTransport(enqueueStatus: .failed)
        let store = DiveSessionStore(userDefaults: userDefaults, syncTransport: transport, recordsStorageURL: storageURL)
        let record = Self.debugScubaRecord()

        store.save(record)

        XCTAssertEqual(store.sessions.count, 1)
        XCTAssertEqual(store.sessions.first?.id, record.id)
        XCTAssertEqual(store.sessions.first?.syncStatus, .failed)
        XCTAssertEqual(transport.enqueuedArtifacts.map(\.localSessionId), [record.id])

        let persisted = try profileEntries(at: storageURL)
        XCTAssertEqual(persisted.map(\.id), [record.id])
        XCTAssertEqual(persisted.first?.displayRecord.syncStatus, .failed)
        XCTAssertNil(userDefaults.data(forKey: "savedDiveSessionRecords"))
    }

    @MainActor
    func testStoreHandlesMobileDeletionCommandAndAcknowledgesPhysicalRemoval() async throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let rootURL = storageURL.deletingLastPathComponent()
        let profileStore = DiveProfileArtifactStore(rootURL: rootURL)
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: transport,
            recordsStorageURL: storageURL,
            profileStore: profileStore
        )
        let record = Self.debugFreediveRecord()
        XCTAssertTrue(store.save(record))
        let entry = try XCTUnwrap(profileStore.loadEntries().first)
        let artifactURL = profileStore.artifactURL(for: entry.artifact)
        let command = try XCTUnwrap(WatchSessionDeletionCommand(dictionary: [
            WatchSyncEnvelope.kindKey:
                WatchSyncEnvelope.sessionDeletionCommandKind,
            WatchSyncEnvelope.formatVersionKey: 1,
            WatchSyncEnvelope.commandIdKey: String(repeating: "d", count: 64),
            WatchSyncEnvelope.localSessionIdKey: record.id.uuidString,
            WatchSyncEnvelope.requestedAtKey: 300.0,
            WatchSyncEnvelope.contentRevisionKey:
                entry.artifact.contentRevision,
            WatchSyncEnvelope.artifactSha256Key: entry.artifact.sha256,
        ]))

        transport.onSessionDeletionRequested?(command)
        await Task.yield()

        XCTAssertTrue(store.sessions.isEmpty)
        XCTAssertEqual(transport.cancelledSessionIds, [record.id])
        XCTAssertEqual(transport.deletionResults.count, 1)
        XCTAssertEqual(transport.deletionResults.first?.outcome, .deleted)
        XCTAssertEqual(
            transport.deletionResults.first?.removedContentRevision,
            entry.artifact.contentRevision
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: artifactURL.path))
        XCTAssertTrue(try profileStore.isSessionDeleted(record.id))
    }

    @MainActor
    func testStoreAcceptsCanonicalIdenticalRetryAfterCleanupFailure() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let fileManager = FailFirstActiveCleanupFileManager()
        let revisions = RevisionSequence()
        let profileStore = DiveProfileArtifactStore(
            rootURL: storageURL.deletingLastPathComponent(),
            fileManager: fileManager,
            makeRevision: { revisions.next() }
        )
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: transport,
            recordsStorageURL: storageURL,
            fileManager: fileManager,
            profileStore: profileStore
        )
        let record = Self.debugScubaRecord()
        try profileStore.beginRecording(
            ActiveDiveRecordingMetadata(
                localSessionId: record.id,
                startedAt: record.startedAt,
                captureMode: record.captureMode,
                plan: PreDivePlan(diveMode: record.diveMode)
            )
        )

        XCTAssertFalse(store.save(record))

        XCTAssertTrue(transport.enqueuedArtifacts.isEmpty)
        XCTAssertTrue(store.sessions.isEmpty)
        let firstEntry = try XCTUnwrap(profileStore.loadEntries().first)
        XCTAssertEqual(revisions.values, ["review-revision-1"])
        XCTAssertEqual(fileManager.activeCleanupFailureCount, 1)
        XCTAssertEqual(try profileStore.loadActiveRecordings().map(\.metadata.localSessionId), [record.id])
        let expectedArtifact = try profileStore.canonicalArtifact(for: record, matching: firstEntry.artifact)
        XCTAssertEqual(expectedArtifact.identity, firstEntry.artifact)
        XCTAssertEqual(expectedArtifact.data, try Data(contentsOf: profileStore.artifactURL(for: firstEntry.artifact)))
        XCTAssertTrue(try profileStore.matchesCanonicalArtifact(for: record, existing: firstEntry.artifact))

        XCTAssertTrue(store.save(record))

        let entries = try profileStore.loadEntries()
        XCTAssertEqual(entries.map(\.artifact), [firstEntry.artifact])
        XCTAssertEqual(revisions.values, ["review-revision-1"])
        XCTAssertEqual(transport.enqueuedArtifacts, [firstEntry.artifact])
        XCTAssertEqual(store.sessions.map(\.id), [record.id])
        XCTAssertTrue(try profileStore.loadActiveRecordings().isEmpty)
    }

    @MainActor
    func testStoreRejectsConflictingSameIDRecordBeforeCleanupEnqueueOrPublication() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let fileManager = FailFirstActiveCleanupFileManager()
        let revisions = RevisionSequence()
        let profileStore = DiveProfileArtifactStore(
            rootURL: storageURL.deletingLastPathComponent(),
            fileManager: fileManager,
            makeRevision: { revisions.next() }
        )
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: transport,
            recordsStorageURL: storageURL,
            fileManager: fileManager,
            profileStore: profileStore
        )
        let record = Self.debugScubaRecord()
        try profileStore.beginRecording(
            ActiveDiveRecordingMetadata(
                localSessionId: record.id,
                startedAt: record.startedAt,
                captureMode: record.captureMode,
                plan: PreDivePlan(diveMode: record.diveMode)
            )
        )

        XCTAssertFalse(store.save(record))
        let existingEntry = try XCTUnwrap(profileStore.loadEntries().first)
        let conflictingRecord = record.withSamples(
            record.samples + [EngineTestFixtures.sample(240, depth: 21)]
        )

        XCTAssertFalse(store.save(conflictingRecord))

        XCTAssertTrue(transport.enqueuedArtifacts.isEmpty)
        XCTAssertTrue(store.sessions.isEmpty)
        XCTAssertEqual(try profileStore.loadEntries().map(\.artifact), [existingEntry.artifact])
        XCTAssertEqual(revisions.values, ["review-revision-1"])
        XCTAssertEqual(
            try profileStore.loadActiveRecordings().map(\.metadata.localSessionId),
            [record.id]
        )
    }

    @MainActor
    func testStoreRejectsExplicitConflictingProfileBeforeCleanupEnqueueOrPublication() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let fileManager = FailFirstActiveCleanupFileManager()
        let revisions = RevisionSequence()
        let profileStore = DiveProfileArtifactStore(
            rootURL: storageURL.deletingLastPathComponent(),
            fileManager: fileManager,
            makeRevision: { revisions.next() }
        )
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: transport,
            recordsStorageURL: storageURL,
            fileManager: fileManager,
            profileStore: profileStore
        )
        let record = Self.debugScubaRecord()
        try profileStore.beginRecording(
            ActiveDiveRecordingMetadata(
                localSessionId: record.id,
                startedAt: record.startedAt,
                captureMode: record.captureMode,
                plan: PreDivePlan(diveMode: record.diveMode)
            )
        )

        XCTAssertFalse(store.save(record))
        let existingEntry = try XCTUnwrap(profileStore.loadEntries().first)
        let conflictingRecord = record.withProfile(
            DiveProfileMetadata(
                contentRevision: "conflicting-revision",
                sampleCount: record.samples.count
            )
        )

        XCTAssertFalse(store.save(conflictingRecord))

        XCTAssertTrue(transport.enqueuedArtifacts.isEmpty)
        XCTAssertTrue(store.sessions.isEmpty)
        XCTAssertEqual(try profileStore.loadEntries().map(\.artifact), [existingEntry.artifact])
        XCTAssertEqual(revisions.values, ["review-revision-1"])
        XCTAssertEqual(
            try profileStore.loadActiveRecordings().map(\.metadata.localSessionId),
            [record.id]
        )
    }

    @MainActor
    func testStoreRepairsPendingManifestAfterSyncedStatusWriteFailsThenRetryReturnsFailed() async throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let rootURL = storageURL.deletingLastPathComponent()
        let fileManager = FileManager.default
        let transport = StubWatchSyncTransport(enqueueStatuses: [.synced, .failed])
        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: transport,
            recordsStorageURL: storageURL
        )
        let record = Self.debugScubaRecord()
        transport.onEnqueue = {
            guard transport.enqueuedArtifacts.count == 1 else {
                return
            }
            try? fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o555)],
                ofItemAtPath: rootURL.path
            )
        }
        defer {
            try? fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o700)],
                ofItemAtPath: rootURL.path
            )
            try? fileManager.removeItem(at: rootURL)
        }

        XCTAssertTrue(store.save(record))
        XCTAssertEqual(store.sessions.first?.syncStatus, .synced)
        XCTAssertEqual(try profileEntries(at: storageURL).first?.displayRecord.syncStatus, .pending)

        try fileManager.setAttributes(
            [.posixPermissions: NSNumber(value: 0o700)],
            ofItemAtPath: rootURL.path
        )
        await store.refreshFromCompanion()

        XCTAssertEqual(transport.enqueuedArtifacts.count, 2)
        XCTAssertEqual(store.sessions.first?.syncStatus, .synced)
        XCTAssertEqual(try profileEntries(at: storageURL).first?.displayRecord.syncStatus, .synced)
    }

    @MainActor
    func testStoreSanitizesNonFiniteDebugScubaValuesBeforePersistenceAndSync() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(userDefaults: userDefaults, syncTransport: transport, recordsStorageURL: storageURL)
        let record = Self.debugScubaRecordWithNonFiniteDerivedValues()

        let sanitized = record.sanitizedForPersistence()
        XCTAssertNoThrow(try JSONEncoder().encode([sanitized]))
        XCTAssertNoThrow(try sanitized.syncMessageData())

        store.save(record)

        let fileURL = try XCTUnwrap(transport.enqueuedFileURLs.first)
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)))
        let persisted = try XCTUnwrap(profileEntries(at: storageURL).first?.displayRecord)
        assertScubaPayloadIsJSONSafe(persisted)
    }

    @MainActor
    func testStoreSanitizesRealScubaValuesBeforePersistenceAndSync() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(userDefaults: userDefaults, syncTransport: transport, recordsStorageURL: storageURL)
        let record = Self.realScubaRecordWithNonFiniteDerivedValuesAndMetadata()

        store.save(record)

        let fileURL = try XCTUnwrap(transport.enqueuedFileURLs.first)
        let session = try syncSessionObject(fromArtifactAt: fileURL)
        XCTAssertEqual(session["captureMode"] as? String, "real")
        XCTAssertNil(session["entryLocation"])
        XCTAssertNil(session["exitLocation"])
        XCTAssertEqual((session["samples"] as? [[String: Any]])?.count, 3)
        XCTAssertNotNil(session["scuba"])
    }

    @MainActor
    func testStorePersistsLargeSessionOutsideUserDefaultsLimit() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let transport = StubWatchSyncTransport(enqueueStatus: .pending)
        let store = DiveSessionStore(userDefaults: userDefaults, syncTransport: transport, recordsStorageURL: storageURL)
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 8_000)
        let encodedRecord = try JSONEncoder().encode([record.sanitizedForPersistence()])

        XCTAssertGreaterThan(encodedRecord.count, 1_048_576)

        store.save(record)

        XCTAssertNil(userDefaults.data(forKey: "savedDiveSessionRecords"))
        let persisted = try XCTUnwrap(profileEntries(at: storageURL).first)
        XCTAssertEqual(persisted.id, record.id)
        XCTAssertEqual(persisted.artifact.sampleCount, record.samples.count)

        let reloaded = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL
        )
        XCTAssertEqual(reloaded.sessions.first?.id, record.id)
        XCTAssertLessThanOrEqual(reloaded.sessions.first?.samples.count ?? .max, 160)
    }

    func testLargeSavedSessionExceedsDirectMessageLimitAndKeepsFileTransferMetadataSmall() throws {
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 8_000).sanitizedForPersistence()
        let payloadData = try record.syncMessageData()
        let identity = DiveProfileArtifactIdentity(
            localSessionId: record.id,
            contentRevision: "revision-1",
            sha256: String(repeating: "a", count: 64),
            byteCount: payloadData.count,
            sampleCount: record.samples.count,
            relativePath: "session.json"
        )
        let metadata = WatchSyncEnvelope.fileMetadata(for: identity, sentAt: EngineTestFixtures.start)

        XCTAssertGreaterThan(payloadData.count, 48 * 1024)
        XCTAssertEqual(metadata[WatchSyncEnvelope.kindKey] as? String, WatchSyncEnvelope.kind)
        XCTAssertEqual(metadata[WatchSyncEnvelope.localSessionIdKey] as? String, record.id.uuidString)
        XCTAssertNil(metadata[WatchSyncEnvelope.payloadBase64Key])
        XCTAssertTrue(PropertyListSerialization.propertyList(metadata, isValidFor: .binary))
    }

    func testLargeDebugFixtureExceedsDirectMessageLimit() throws {
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 1_200)
        let data = try record.syncMessageData()

        XCTAssertGreaterThan(data.count, 48 * 1024)
        XCTAssertEqual(record.captureMode, .demo)
        XCTAssertTrue(record.tags.contains(DiveSessionRecord.debugTestTag))
    }

    @MainActor
    func testStoreMigratesLegacyUserDefaultsRecordsToFileStorage() throws {
        let userDefaults = makeIsolatedUserDefaults()
        let storageURL = makeIsolatedRecordsStorageURL()
        let record = Self.debugScubaRecord()
        let legacyData = try JSONEncoder().encode([record])
        userDefaults.set(legacyData, forKey: "savedDiveSessionRecords")

        let store = DiveSessionStore(
            userDefaults: userDefaults,
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL
        )

        XCTAssertEqual(store.sessions.map(\DiveSessionRecord.id), [record.id])
        XCTAssertNil(userDefaults.data(forKey: "savedDiveSessionRecords"))
        XCTAssertEqual((try profileEntries(at: storageURL)).map(\.id), [record.id])
    }

    func testFreediveSanitizerMakesNonFiniteDerivedValuesJSONSafe() throws {
        let record = Self.debugFreediveRecordWithNonFiniteDerivedValues()

        let sanitized = record.sanitizedForPersistence()

        XCTAssertNoThrow(try JSONEncoder().encode([sanitized]))
        XCTAssertNoThrow(try sanitized.syncMessageData())
        guard case .freedive(let session) = sanitized.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertTrue(session.totalDurationSeconds.isFinite)
        XCTAssertTrue(session.maxDepthMeters.isFinite)
        XCTAssertTrue(session.longestDiveDurationSeconds.isFinite)
        XCTAssertTrue(session.segments.allSatisfy { segment in
            segment.durationSeconds.isFinite
                && segment.maxDepthMeters.isFinite
                && segment.minDepthMeters.isFinite
                && (segment.descentRateMetersPerSecond?.isFinite ?? true)
                && (segment.ascentRateMetersPerSecond?.isFinite ?? true)
        })
    }

    @MainActor
    func testOnlyRealRecordingsMarkTheirPlannedDiveExecuted() throws {
        let plannedDive = WatchPlannedDive(
            localId: "plan-1",
            title: "Reef",
            siteName: nil,
            diveMode: .scuba,
            entryStyle: nil,
            plannedAt: nil,
            plannedMaxDepthMeters: 12,
            plannedDurationMinutes: nil,
            gasLabel: nil,
            buddyIds: [],
            gearIds: nil,
            tags: [],
            notes: nil
        )
        let demoStore = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: makeIsolatedRecordsStorageURL()
        )
        let realStore = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: makeIsolatedRecordsStorageURL()
        )
        demoStore.replacePlannedDives([plannedDive])
        realStore.replacePlannedDives([plannedDive])

        XCTAssertTrue(demoStore.save(Self.debugScubaRecord(captureMode: .demo, sourcePlanLocalId: "plan-1")))
        XCTAssertTrue(realStore.save(Self.debugScubaRecord(captureMode: .real, sourcePlanLocalId: "plan-1")))

        XCTAssertEqual(demoStore.plannedDives.map(\.localId), ["plan-1"])
        XCTAssertEqual(realStore.plannedDives.map(\.localId), [])
    }

    func testDemoStartPlanDropsThePlannedDiveLink() {
        var plan = PreDivePlan()
        plan.sourcePlanLocalId = "plan-1"
        plan.title = "Reef"
        plan.userTags = ["plan-plan-1", "night"]
        plan.siteName = "House Reef"

        let demoPlan = plan.withoutPlannedDiveLink

        XCTAssertNil(demoPlan.sourcePlanLocalId)
        XCTAssertEqual(demoPlan.title, "")
        XCTAssertEqual(demoPlan.userTags, ["night"])
        XCTAssertEqual(demoPlan.siteName, "House Reef")
        XCTAssertFalse(demoPlan.tags.contains { $0.hasPrefix("plan-") })
    }

    @MainActor
    func testRetrySyncResendsOnlyAFailedSession() throws {
        let transport = StubWatchSyncTransport(enqueueStatuses: [.failed, .pending])
        let store = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: transport,
            recordsStorageURL: makeIsolatedRecordsStorageURL()
        )
        let record = Self.debugScubaRecord()
        XCTAssertTrue(store.save(record))
        XCTAssertEqual(store.sessions.first?.syncStatus, .failed)

        store.retrySync(sessionID: record.id)

        XCTAssertEqual(transport.enqueuedArtifacts.count, 2)
        XCTAssertEqual(store.sessions.first?.syncStatus, .pending)
    }

    @MainActor
    func testSaveRetriesDeletionRecoveryThatFailedAtLaunch() throws {
        let storageURL = makeIsolatedRecordsStorageURL()
        let ledgerURL = try corruptDeletionLedger(besides: storageURL)
        let store = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL
        )
        let record = Self.debugScubaRecord()

        XCTAssertFalse(store.save(record))

        try FileManager.default.removeItem(at: ledgerURL)
        XCTAssertTrue(store.save(record))
        XCTAssertEqual(store.sessions.map(\.id), [record.id])
    }

    @MainActor
    func testCompanionRefreshRetriesDeletionRecoveryAndReloadsSavedSessions() async throws {
        let storageURL = makeIsolatedRecordsStorageURL()
        let record = Self.debugScubaRecord()
        let firstLaunch = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL
        )
        XCTAssertTrue(firstLaunch.save(record))
        let ledgerURL = try corruptDeletionLedger(besides: storageURL)
        let store = DiveSessionStore(
            userDefaults: makeIsolatedUserDefaults(),
            syncTransport: StubWatchSyncTransport(enqueueStatus: .pending),
            recordsStorageURL: storageURL
        )
        XCTAssertEqual(store.sessions.map(\.id), [])

        try FileManager.default.removeItem(at: ledgerURL)
        await store.refreshFromCompanion()

        XCTAssertEqual(store.sessions.map(\.id), [record.id])
    }

    func testRecordsFromBeforeCaptureModeExistedReadAsDemo() throws {
        let encoded = try JSONEncoder().encode(Self.debugScubaRecord())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object.removeValue(forKey: "captureMode")
        let decoded = try JSONDecoder().decode(
            DiveSessionRecord.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let legacy = DiveSessionRecord(legacySession: DiveSession(
            diveMode: .scuba,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(60),
            samples: [EngineTestFixtures.sample(0, depth: 0), EngineTestFixtures.sample(30, depth: 8)]
        ))

        XCTAssertEqual(decoded.captureMode, .demo)
        XCTAssertEqual(legacy.captureMode, .demo)
    }

    func testOldFreediveSessionAdaptsToOneSegment() {
        let samples = [
            EngineTestFixtures.sample(0, depth: 0),
            EngineTestFixtures.sample(4, depth: 12),
            EngineTestFixtures.sample(20, depth: 0.4)
        ]
        let old = DiveSession(
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(20),
            samples: samples
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .freedive(session) = record.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments.count, 1)
        XCTAssertEqual(session.maxDepthMeters, 12)
        XCTAssertEqual(session.segments.first?.index, 1)
        XCTAssertEqual(session.segments.first?.durationSeconds, 20)
        XCTAssertEqual(record.schemaVersion, 2)
        XCTAssertEqual(record.samples.map(\.id), samples.map(\.id))
        XCTAssertEqual(record.samples.map(\.depthMeters), samples.map(\.depthMeters))
    }

    func testEmptyOldFreediveSessionAdaptsWithoutSegments() {
        let old = DiveSession(
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(15),
            samples: []
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .freedive(session) = record.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertEqual(session.diveCount, 0)
        XCTAssertEqual(session.longestDiveDurationSeconds, 0)
        XCTAssertTrue(session.segments.isEmpty)
        XCTAssertTrue(record.samples.isEmpty)
        XCTAssertEqual(record.schemaVersion, 2)
    }

    func testOldFreediveSessionSegmentIdIsStableAcrossMigrations() {
        let old = DiveSession(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000456")!,
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(20),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(4, depth: 12),
                EngineTestFixtures.sample(20, depth: 0.4)
            ]
        )

        let firstRecord = DiveSessionRecord(legacySession: old)
        let secondRecord = DiveSessionRecord(legacySession: old)

        guard case let .freedive(firstSession) = firstRecord.payload,
              case let .freedive(secondSession) = secondRecord.payload else {
            return XCTFail("Expected freedive payloads")
        }
        XCTAssertEqual(firstSession.segments.first?.id, old.id)
        XCTAssertEqual(secondSession.segments.first?.id, old.id)
        XCTAssertEqual(firstSession.segments.first?.id, secondSession.segments.first?.id)
        XCTAssertEqual(firstSession.segments.first?.index, 1)
        XCTAssertEqual(firstSession.segments.first?.durationSeconds, 20)
    }

    func testOldScubaSessionAdaptsWithUnknownSafetyStop() {
        let old = DiveSession(
            diveMode: .scuba,
            gasLabel: "Air",
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(1200),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(60, depth: 21.2),
                EngineTestFixtures.sample(1200, depth: 0)
            ]
        )

        let record = DiveSessionRecord(legacySession: old)

        guard case let .scuba(session) = record.payload else {
            return XCTFail("Expected scuba payload")
        }
        XCTAssertEqual(session.gasLabel, "Air")
        XCTAssertEqual(session.safetyStop.status, .unknown)
    }

    func testOldSessionMetadataIsPreserved() {
        let entryLocation = WatchLocation(
            latitude: 37.5665,
            longitude: 126.9780,
            horizontalAccuracyMeters: 5,
            capturedAt: EngineTestFixtures.date(0)
        )
        let exitLocation = WatchLocation(
            latitude: 37.5670,
            longitude: 126.9790,
            horizontalAccuracyMeters: 8,
            capturedAt: EngineTestFixtures.date(1200)
        )
        let old = DiveSession(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000123")!,
            diveMode: .scuba,
            gasLabel: "Nitrox 32",
            siteId: "site-1",
            siteName: "Moon Bay",
            sourcePlanLocalId: "plan-1",
            planTitle: "Morning dive",
            buddyIds: ["buddy-1"],
            gearIds: ["mask-1", "computer-1"],
            tags: ["reef", "training"],
            notes: "Post-dive note",
            rating: 4,
            perceivedExertion: 2,
            visibilityRating: 3,
            waterCondition: .mild,
            syncStatus: .failed,
            entryLocation: entryLocation,
            exitLocation: exitLocation,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(1200),
            samples: [EngineTestFixtures.sample(60, depth: 18)]
        )

        let record = DiveSessionRecord(legacySession: old)

        XCTAssertEqual(record.id, old.id)
        XCTAssertEqual(record.schemaVersion, 2)
        XCTAssertEqual(record.diveMode, old.diveMode)
        XCTAssertEqual(record.siteId, old.siteId)
        XCTAssertEqual(record.siteName, old.siteName)
        XCTAssertEqual(record.sourcePlanLocalId, old.sourcePlanLocalId)
        XCTAssertEqual(record.planTitle, old.planTitle)
        XCTAssertEqual(record.buddyIds, old.buddyIds)
        XCTAssertEqual(record.gearIds, old.gearIds)
        XCTAssertEqual(record.tags, old.tags)
        XCTAssertEqual(record.notes, old.notes)
        XCTAssertEqual(record.rating, old.rating)
        XCTAssertEqual(record.perceivedExertion, old.perceivedExertion)
        XCTAssertEqual(record.visibilityRating, old.visibilityRating)
        XCTAssertEqual(record.waterCondition, old.waterCondition)
        XCTAssertEqual(record.syncStatus, old.syncStatus)
        XCTAssertEqual(record.entryLocation, old.entryLocation)
        XCTAssertEqual(record.exitLocation, old.exitLocation)
        XCTAssertEqual(record.startedAt, old.startedAt)
        XCTAssertEqual(record.endedAt, old.endedAt)
        XCTAssertEqual(record.samples.map(\.id), old.samples.map(\.id))
    }

    func testPayloadCodableRoundTripPreservesTagShape() throws {
        let old = DiveSession(
            diveMode: .freedive,
            syncStatus: .pending,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(20),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(4, depth: 12),
                EngineTestFixtures.sample(20, depth: 0.4)
            ]
        )
        let record = DiveSessionRecord(legacySession: old)

        let data = try JSONEncoder().encode(record)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let payload = try XCTUnwrap(object["payload"] as? [String: Any])
        XCTAssertEqual(payload["type"] as? String, "freedive")
        XCTAssertNotNil(payload["freedive"])
        XCTAssertNil(payload["scuba"])

        let decoded = try JSONDecoder().decode(DiveSessionRecord.self, from: data)
        guard case let .freedive(session) = decoded.payload else {
            return XCTFail("Expected freedive payload")
        }
        XCTAssertEqual(decoded.id, record.id)
        XCTAssertEqual(decoded.schemaVersion, 2)
        XCTAssertEqual(session.diveCount, 1)
        XCTAssertEqual(session.segments.count, 1)
        XCTAssertEqual(session.maxDepthMeters, 12)
    }

    func testFreediveSyncMessageEncodesOnlyFreedivePayload() throws {
        let record = DiveSessionRecord(
            id: UUID(uuidString: "00000000-0000-0000-0000-00000000F001")!,
            schemaVersion: 2,
            diveMode: .freedive,
            siteId: nil,
            siteName: "Blue Line",
            sourcePlanLocalId: nil,
            planTitle: nil,
            buddyIds: [],
            gearIds: [],
            tags: ["watch-capture"],
            notes: nil,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(120),
            samples: [
                EngineTestFixtures.sample(0, depth: 0.4),
                EngineTestFixtures.sample(30, depth: 12),
                EngineTestFixtures.sample(60, depth: 0.5)
            ],
            payload: .freedive(
                FreeDiveSession(
                    id: UUID(uuidString: "00000000-0000-0000-0000-00000000F001")!,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(120),
                    totalDurationSeconds: 120,
                    maxDepthMeters: 12,
                    diveCount: 1,
                    longestDiveDurationSeconds: 60,
                    segments: [
                        FreeDiveSegment(
                            id: UUID(uuidString: "00000000-0000-0000-0000-00000000F101")!,
                            index: 1,
                            startTime: EngineTestFixtures.date(0),
                            endTime: EngineTestFixtures.date(60),
                            durationSeconds: 60,
                            maxDepthMeters: 12,
                            minDepthMeters: 0.4,
                            sampleStartIndex: 0,
                            sampleEndIndex: 2,
                            descentRateMetersPerSecond: nil,
                            ascentRateMetersPerSecond: nil
                        )
                    ]
                )
            )
        )

        let session = try syncSessionObject(from: record)
        let freedive = try XCTUnwrap(session["freedive"] as? [String: Any])
        XCTAssertNil(session["scuba"])
        XCTAssertEqual(session["diveMode"] as? String, "freedive")
        XCTAssertEqual((freedive["diveCount"] as? NSNumber)?.intValue, 1)
        XCTAssertNotNil(freedive["segments"])
    }

    func testScubaSyncMessageEncodesOnlyScubaPayload() throws {
        let record = DiveSessionRecord(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000005C01")!,
            schemaVersion: 2,
            diveMode: .scuba,
            siteId: nil,
            siteName: nil,
            sourcePlanLocalId: nil,
            planTitle: nil,
            buddyIds: [],
            gearIds: [],
            tags: ["watch-capture"],
            notes: nil,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(1200),
            samples: [
                EngineTestFixtures.sample(0, depth: 0),
                EngineTestFixtures.sample(60, depth: 18),
                EngineTestFixtures.sample(1200, depth: 0.5)
            ],
            payload: .scuba(
                ScubaDiveSession(
                    id: UUID(uuidString: "00000000-0000-0000-0000-000000005C01")!,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(1200),
                    durationSeconds: 1200,
                    maxDepthMeters: 18,
                    averageDepthMeters: 9,
                    waterTemperatureCelsius: 24,
                    gasLabel: "Air",
                    latestAscentRateMetersPerMinute: 0,
                    maxAscentRateMetersPerMinute: 6,
                    safetyStop: SafetyStopRecord(
                        status: .completed,
                        required: true,
                        completed: true,
                        targetDepthMeters: 5,
                        minDepthMeters: 3,
                        maxDepthMeters: 6,
                        durationSeconds: 180,
                        startedAt: EngineTestFixtures.date(1000),
                        completedAt: EngineTestFixtures.date(1180),
                        remainingSeconds: 0,
                        timeInZoneSeconds: 180
                    )
                )
            )
        )

        let session = try syncSessionObject(from: record)
        let scuba = try XCTUnwrap(session["scuba"] as? [String: Any])
        let safetyStop = try XCTUnwrap(scuba["safetyStop"] as? [String: Any])
        XCTAssertNil(session["freedive"])
        XCTAssertEqual(session["diveMode"] as? String, "scuba")
        XCTAssertEqual(safetyStop["status"] as? String, "completed")
        XCTAssertEqual((safetyStop["timeInZoneSeconds"] as? NSNumber)?.doubleValue, 180)
    }

    private func syncSessionObject(from record: DiveSessionRecord) throws -> [String: Any] {
        let data = try record.syncMessageData()
        let message = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(message["session"] as? [String: Any])
    }

    private func syncSessionObject(fromArtifactAt fileURL: URL) throws -> [String: Any] {
        let message = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [String: Any]
        )
        return try XCTUnwrap(message["session"] as? [String: Any])
    }

    private func makeIsolatedUserDefaults() -> UserDefaults {
        let suiteName = "DivenaryWatchAppTests.\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        userDefaults.removePersistentDomain(forName: suiteName)
        return userDefaults
    }

    private func corruptDeletionLedger(besides storageURL: URL) throws -> URL {
        let rootURL = storageURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let ledgerURL = rootURL.appendingPathComponent("deleted-session-ledger.json")
        try Data("not a ledger".utf8).write(to: ledgerURL)
        return ledgerURL
    }

    private func makeIsolatedRecordsStorageURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("DivenaryWatchAppTests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("savedDiveSessionRecords.json")
    }

    private func profileEntries(at storageURL: URL) throws -> [DiveProfileManifestEntry] {
        try DiveProfileArtifactStore(rootURL: storageURL.deletingLastPathComponent()).loadEntries()
    }

    private func assertScubaPayloadIsJSONSafe(_ record: DiveSessionRecord) {
        XCTAssertTrue(record.samples.allSatisfy(\.isValidRecordingSample))
        guard case .scuba(let session) = record.payload else {
            return XCTFail("Expected scuba payload")
        }
        XCTAssertTrue(session.durationSeconds.isFinite)
        XCTAssertTrue(session.maxDepthMeters.isFinite)
        XCTAssertTrue(session.averageDepthMeters.isFinite)
        XCTAssertTrue(session.waterTemperatureCelsius?.isFinite ?? true)
        XCTAssertTrue(session.latestAscentRateMetersPerMinute.isFinite)
        XCTAssertTrue(session.maxAscentRateMetersPerMinute.isFinite)
        XCTAssertTrue(session.safetyStop.targetDepthMeters.isFinite)
        XCTAssertTrue(session.safetyStop.minDepthMeters.isFinite)
        XCTAssertTrue(session.safetyStop.maxDepthMeters.isFinite)
        XCTAssertTrue(session.safetyStop.durationSeconds.isFinite)
        XCTAssertTrue(session.safetyStop.remainingSeconds.isFinite)
        XCTAssertTrue(session.safetyStop.timeInZoneSeconds.isFinite)
    }

    private static func debugFreediveRecord() -> DiveSessionRecord {
        let id = UUID(uuidString: "00000000-0000-0000-0000-00000000F00D")!
        let samples = [
            EngineTestFixtures.sample(0, depth: 0.4),
            EngineTestFixtures.sample(5, depth: 5.2),
            EngineTestFixtures.sample(12, depth: 0.5)
        ]
        return DiveSessionRecord(
            id: id,
            schemaVersion: 2,
            captureMode: .demo,
            diveMode: .freedive,
            siteId: nil,
            siteName: "Debug Free",
            sourcePlanLocalId: nil,
            planTitle: nil,
            buddyIds: [],
            gearIds: [],
            tags: ["watch-capture"],
            notes: nil,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(12),
            samples: samples,
            payload: .freedive(
                FreeDiveSession(
                    id: id,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(12),
                    totalDurationSeconds: 12,
                    maxDepthMeters: 5.2,
                    diveCount: 1,
                    longestDiveDurationSeconds: 12,
                    segments: [
                        FreeDiveSegment(
                            id: UUID(uuidString: "00000000-0000-0000-0000-00000000F101")!,
                            index: 1,
                            startTime: EngineTestFixtures.date(0),
                            endTime: EngineTestFixtures.date(12),
                            durationSeconds: 12,
                            maxDepthMeters: 5.2,
                            minDepthMeters: 0.4,
                            sampleStartIndex: 0,
                            sampleEndIndex: 2,
                            descentRateMetersPerSecond: 0.96,
                            ascentRateMetersPerSecond: 0.67
                        )
                    ]
                )
            )
        )
    }

    private static func debugScubaRecord(
        captureMode: DiveCaptureMode = .demo,
        sourcePlanLocalId: String? = nil
    ) -> DiveSessionRecord {
        let id = UUID(uuidString: "00000000-0000-0000-0000-000000005C0B")!
        let samples = [
            EngineTestFixtures.sample(0, depth: 0),
            EngineTestFixtures.sample(60, depth: 12),
            EngineTestFixtures.sample(180, depth: 0.5)
        ]
        return DiveSessionRecord(
            id: id,
            schemaVersion: 2,
            captureMode: captureMode,
            diveMode: .scuba,
            siteId: nil,
            siteName: "Debug Scuba",
            sourcePlanLocalId: sourcePlanLocalId,
            planTitle: nil,
            buddyIds: [],
            gearIds: [],
            tags: ["watch-capture"],
            notes: nil,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: EngineTestFixtures.date(0),
            endedAt: EngineTestFixtures.date(180),
            samples: samples,
            payload: .scuba(
                ScubaDiveSession(
                    id: id,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(180),
                    durationSeconds: 180,
                    maxDepthMeters: 12,
                    averageDepthMeters: 4.16,
                    waterTemperatureCelsius: 24,
                    gasLabel: "Air",
                    latestAscentRateMetersPerMinute: 5.75,
                    maxAscentRateMetersPerMinute: 5.75,
                    safetyStop: .legacyUnknown
                )
            )
        )
    }

    private static func debugScubaRecordWithNonFiniteDerivedValues() -> DiveSessionRecord {
        let base = debugScubaRecord()
        return DiveSessionRecord(
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
            samples: base.samples,
            payload: .scuba(
                ScubaDiveSession(
                    id: base.id,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(180),
                    durationSeconds: .infinity,
                    maxDepthMeters: .nan,
                    averageDepthMeters: .nan,
                    waterTemperatureCelsius: .infinity,
                    gasLabel: "Air",
                    latestAscentRateMetersPerMinute: .infinity,
                    maxAscentRateMetersPerMinute: .nan,
                    safetyStop: SafetyStopRecord(
                        status: .active,
                        required: true,
                        completed: false,
                        targetDepthMeters: .nan,
                        minDepthMeters: .nan,
                        maxDepthMeters: .infinity,
                        durationSeconds: .infinity,
                        startedAt: EngineTestFixtures.date(120),
                        completedAt: nil,
                        remainingSeconds: .nan,
                        timeInZoneSeconds: .infinity
                    )
                )
            )
        )
    }

    private static func realScubaRecordWithNonFiniteDerivedValuesAndMetadata() -> DiveSessionRecord {
        let base = debugScubaRecordWithNonFiniteDerivedValues()
        return DiveSessionRecord(
            id: base.id,
            schemaVersion: base.schemaVersion,
            captureMode: .real,
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
            entryLocation: WatchLocation(
                latitude: .nan,
                longitude: 126.9780,
                horizontalAccuracyMeters: .infinity,
                capturedAt: nil
            ),
            exitLocation: WatchLocation(
                latitude: 37.5665,
                longitude: .infinity,
                horizontalAccuracyMeters: .nan,
                capturedAt: nil
            ),
            startedAt: base.startedAt,
            endedAt: base.endedAt,
            samples: base.samples + [EngineTestFixtures.sample(90, depth: .nan)],
            payload: base.payload
        )
    }

    private static func debugFreediveRecordWithNonFiniteDerivedValues() -> DiveSessionRecord {
        let base = debugFreediveRecord()
        return DiveSessionRecord(
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
            samples: base.samples,
            payload: .freedive(
                FreeDiveSession(
                    id: base.id,
                    startTime: EngineTestFixtures.date(0),
                    endTime: EngineTestFixtures.date(12),
                    totalDurationSeconds: .nan,
                    maxDepthMeters: .infinity,
                    diveCount: 1,
                    longestDiveDurationSeconds: .nan,
                    segments: [
                        FreeDiveSegment(
                            id: UUID(uuidString: "00000000-0000-0000-0000-00000000F102")!,
                            index: 1,
                            startTime: EngineTestFixtures.date(0),
                            endTime: EngineTestFixtures.date(12),
                            durationSeconds: .nan,
                            maxDepthMeters: .infinity,
                            minDepthMeters: .nan,
                            sampleStartIndex: 0,
                            sampleEndIndex: 2,
                            descentRateMetersPerSecond: .infinity,
                            ascentRateMetersPerSecond: .nan
                        )
                    ]
                )
            )
        )
    }
}

@MainActor
private final class ManualDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?

    func start() {}

    func stop() {}

    func emit(_ sample: DepthSample) {
        onSample?(sample)
    }
}

private final class StubProfileRecordingStore: DiveProfileRecordingStoring {
    private(set) var metadata: ActiveDiveRecordingMetadata?
    private(set) var appendedSamples: [DepthSample] = []

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {
        self.metadata = metadata
    }

    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        appendedSamples.append(sample)
    }

    func clearActiveRecording(sessionID: UUID) throws {}
}

private final class StubWatchSyncTransport: WatchSyncTransporting {
    var onTransferStatusChanged: ((DiveProfileArtifactIdentity, DiveSyncStatus) -> Void)?
    var onActivationCompleted: (() -> Void)?
    var onPlannedDivesChanged: (([WatchPlannedDive]) -> Void)?
    var onSessionDeletionRequested: ((WatchSessionDeletionCommand) -> Void)?

    var onEnqueue: (() -> Void)?
    private var enqueueStatuses: [DiveSyncStatus]
    private let fallbackEnqueueStatus: DiveSyncStatus
    private(set) var enqueuedArtifacts: [DiveProfileArtifactIdentity] = []
    private(set) var enqueuedFileURLs: [URL] = []
    private(set) var activateCallCount = 0
    private(set) var cancelledSessionIds: [UUID] = []
    private(set) var deletionResults: [WatchSessionDeletionResult] = []

    init(enqueueStatus: DiveSyncStatus) {
        enqueueStatuses = [enqueueStatus]
        fallbackEnqueueStatus = enqueueStatus
    }

    init(enqueueStatuses: [DiveSyncStatus]) {
        precondition(!enqueueStatuses.isEmpty)
        self.enqueueStatuses = enqueueStatuses
        fallbackEnqueueStatus = enqueueStatuses[enqueueStatuses.count - 1]
    }

    func activate() {
        activateCallCount += 1
    }

    func enqueue(artifact: DiveProfileArtifactIdentity, fileURL: URL) -> DiveSyncStatus {
        enqueuedArtifacts.append(artifact)
        enqueuedFileURLs.append(fileURL)
        onEnqueue?()
        guard !enqueueStatuses.isEmpty else {
            return fallbackEnqueueStatus
        }
        return enqueueStatuses.removeFirst()
    }

    func refreshPlannedDives() {}

    func cancelTransfers(localSessionId: UUID) {
        cancelledSessionIds.append(localSessionId)
    }

    func acknowledgeDeletion(_ result: WatchSessionDeletionResult) {
        deletionResults.append(result)
    }
}

private final class RevisionSequence {
    private(set) var values: [String] = []

    func next() -> String {
        let revision = "review-revision-\(values.count + 1)"
        values.append(revision)
        return revision
    }
}

private final class FailFirstActiveCleanupFileManager: FileManager {
    private(set) var activeCleanupFailureCount = 0

    override func removeItem(at URL: URL) throws {
        if activeCleanupFailureCount == 0,
           ["active-recording.json", "recording.ndjson"].contains(URL.lastPathComponent) {
            activeCleanupFailureCount += 1
            throw CocoaError(.fileWriteNoPermission)
        }

        try super.removeItem(at: URL)
    }
}
