import CryptoKit
import XCTest
@testable import DivenaryWatchApp

final class DiveProfileArtifactStoreTests: XCTestCase {
    func testBeginRecordingRejectsJournalCreationFailureAndCleansPartialActiveFiles() throws {
        let rootURL = temporaryDirectory()
        let fileManager = FailingJournalCreationFileManager()
        let store = DiveProfileArtifactStore(rootURL: rootURL, fileManager: fileManager)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000112")!
        )

        XCTAssertThrowsError(try store.beginRecording(metadata))

        let sessionURL = sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
        XCTAssertFalse(fileManager.fileExists(atPath: sessionURL.appendingPathComponent("active-recording.json").path))
        XCTAssertFalse(fileManager.fileExists(atPath: sessionURL.appendingPathComponent("recording.ndjson").path))
    }

    func testFinalizesImmutableArtifactWithExternalIntegrityAndBoundedManifestPreview() throws {
        let rootURL = temporaryDirectory()
        let store = DiveProfileArtifactStore(
            rootURL: rootURL,
            makeRevision: { "revision-large-1" }
        )
        let record = DiveSessionRecord.largeDebugFixture(sampleCount: 8_000)

        let entry = try store.finalize(record: record)
        let artifactData = try Data(contentsOf: store.artifactURL(for: entry.artifact))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: artifactData) as? [String: Any])
        let session = try XCTUnwrap(object["session"] as? [String: Any])
        let profile = try XCTUnwrap(session["profile"] as? [String: Any])
        let samples = try XCTUnwrap(session["samples"] as? [[String: Any]])

        XCTAssertEqual(entry.artifact.byteCount, artifactData.count)
        XCTAssertEqual(entry.artifact.sha256, SHA256.hash(data: artifactData).hexString)
        XCTAssertEqual(entry.artifact.sampleCount, 8_000)
        XCTAssertEqual(profile["contentRevision"] as? String, "revision-large-1")
        XCTAssertEqual(profile["sampleIntervalSeconds"] as? Double, 1)
        XCTAssertEqual(profile["sampleCount"] as? Int, 8_000)
        XCTAssertEqual(samples.count, 8_000)
        XCTAssertLessThanOrEqual(entry.displayRecord.samples.count, 160)

        let reloaded = try DiveProfileArtifactStore(rootURL: rootURL).loadEntries()
        XCTAssertEqual(reloaded.count, 1)
        XCTAssertEqual(reloaded.first?.artifact, entry.artifact)
        XCTAssertLessThanOrEqual(try XCTUnwrap(reloaded.first).displayRecord.samples.count, 160)
    }

    func testJournalSurvivesStoreReconstructionWithoutSyntheticSamples() throws {
        let rootURL = temporaryDirectory()
        let metadata = ActiveDiveRecordingMetadata(
            localSessionId: UUID(uuidString: "00000000-0000-0000-0000-000000000111")!,
            startedAt: EngineTestFixtures.start,
            captureMode: .real,
            plan: PreDivePlan(diveMode: .freedive)
        )
        let firstStore = DiveProfileArtifactStore(rootURL: rootURL)

        try firstStore.beginRecording(metadata)
        try firstStore.append(EngineTestFixtures.sample(0.8, depth: 3), to: metadata.localSessionId)
        try firstStore.append(EngineTestFixtures.sample(10.8, depth: 8), to: metadata.localSessionId)

        let recovered = try DiveProfileArtifactStore(rootURL: rootURL).loadActiveRecordings()

        XCTAssertEqual(recovered.count, 1)
        XCTAssertEqual(recovered.first?.metadata, metadata)
        XCTAssertEqual(recovered.first?.samples.map(\.depthMeters), [3, 8])
    }

    func testRetryAfterFullyWrittenAppendFailureDoesNotDuplicateSample() throws {
        let rootURL = temporaryDirectory()
        let fileManager = FailFirstPendingRemovalFileManager()
        let store = DiveProfileArtifactStore(rootURL: rootURL, fileManager: fileManager)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000113")!
        )
        let sample = EngineTestFixtures.sample(0.8, depth: 6)
        try store.beginRecording(metadata)

        XCTAssertThrowsError(try store.append(sample, to: metadata.localSessionId))
        XCTAssertTrue(
            fileManager.fileExists(
                atPath: sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
                    .appendingPathComponent("recording-pending.json")
                    .path
            )
        )

        XCTAssertNoThrow(try store.append(sample, to: metadata.localSessionId))

        let recovered = try store.loadActiveRecordings()
        XCTAssertEqual(recovered.first?.samples.count, 1)
        XCTAssertEqual(recovered.first?.samples.first?.timestamp, sample.timestamp)
        XCTAssertEqual(recovered.first?.samples.first?.depthMeters, sample.depthMeters)
    }

    func testRetryRepairsPartialJournalWriteFromPendingAppend() throws {
        let rootURL = temporaryDirectory()
        let fileManager = FailFirstPendingRemovalFileManager()
        let store = DiveProfileArtifactStore(rootURL: rootURL, fileManager: fileManager)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000114")!
        )
        let sample = EngineTestFixtures.sample(0.8, depth: 7)
        try store.beginRecording(metadata)
        XCTAssertThrowsError(try store.append(sample, to: metadata.localSessionId))

        let sessionURL = sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
        let journalURL = sessionURL.appendingPathComponent("recording.ndjson")
        let completeLine = try Data(contentsOf: journalURL)
        XCTAssertGreaterThan(completeLine.count, 1)
        try Data(completeLine.prefix(completeLine.count / 2)).write(to: journalURL, options: .atomic)

        XCTAssertNoThrow(try store.append(sample, to: metadata.localSessionId))

        let recovered = try store.loadActiveRecordings()
        XCTAssertEqual(recovered.first?.samples.count, 1)
        XCTAssertEqual(recovered.first?.samples.first?.timestamp, sample.timestamp)
        XCTAssertEqual(recovered.first?.samples.first?.depthMeters, sample.depthMeters)
        XCTAssertEqual(try Data(contentsOf: journalURL).last, 0x0A)
    }

    func testLoadDropsOnlyTruncatedFinalRecordAndPreservesValidJournalPrefix() throws {
        let rootURL = temporaryDirectory()
        let store = DiveProfileArtifactStore(rootURL: rootURL)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000115")!
        )
        let validSample = EngineTestFixtures.sample(0.8, depth: 5)
        let truncatedSample = EngineTestFixtures.sample(1.8, depth: 8)
        try store.beginRecording(metadata)
        try store.append(validSample, to: metadata.localSessionId)

        let journalURL = sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
            .appendingPathComponent("recording.ndjson")
        let validJournal = try Data(contentsOf: journalURL)
        let nextRecord = try JSONEncoder().encode(truncatedSample)
        var damagedJournal = validJournal
        damagedJournal.append(nextRecord.prefix(nextRecord.count / 2))
        try damagedJournal.write(to: journalURL, options: .atomic)

        let recovered = try store.loadActiveRecordings()

        XCTAssertEqual(recovered.first?.samples.count, 1)
        XCTAssertEqual(recovered.first?.samples.first?.depthMeters, validSample.depthMeters)
        XCTAssertEqual(try Data(contentsOf: journalURL), validJournal)
    }

    func testLoadCanonicalizesDecodableFinalRecordWithoutNewline() throws {
        let rootURL = temporaryDirectory()
        let store = DiveProfileArtifactStore(rootURL: rootURL)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000119")!
        )
        let sample = EngineTestFixtures.sample(0.8, depth: 9)
        try store.beginRecording(metadata)
        let journalURL = sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
            .appendingPathComponent("recording.ndjson")
        try JSONEncoder().encode(sample).write(to: journalURL, options: .atomic)

        let recovered = try store.loadActiveRecordings()

        XCTAssertEqual(recovered.first?.samples.first?.depthMeters, sample.depthMeters)
        XCTAssertEqual(try Data(contentsOf: journalURL).last, 0x0A)
    }

    func testInteriorCorruptionQuarantinesOnlyActiveFilesAndKeepsCanonicalArtifact() throws {
        let rootURL = temporaryDirectory()
        let sessionID = UUID(uuidString: "00000000-0000-0000-0000-000000000116")!
        let store = DiveProfileArtifactStore(rootURL: rootURL, makeRevision: { "canonical-116" })
        let canonicalEntry = try store.finalize(
            record: DiveSessionRecord.largeDebugFixture(sampleCount: 2).withIdentity(sessionID)
        )
        let metadata = makeMetadata(sessionID: sessionID)
        try store.beginRecording(metadata)
        try store.append(EngineTestFixtures.sample(0.8, depth: 5), to: sessionID)
        let sessionURL = sessionDirectory(rootURL: rootURL, sessionID: sessionID)
        let journalURL = sessionURL.appendingPathComponent("recording.ndjson")
        let handle = try FileHandle(forWritingTo: journalURL)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("not-json\n".utf8))
        try handle.close()

        XCTAssertTrue(try store.loadActiveRecordings().isEmpty)

        XCTAssertNoThrow(try store.verifyArtifact(canonicalEntry.artifact))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.artifactURL(for: canonicalEntry.artifact).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: sessionURL.appendingPathComponent("active-recording.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: journalURL.path))
        let quarantineURL = sessionURL.appendingPathComponent("Quarantine", isDirectory: true)
        let batches = try FileManager.default.contentsOfDirectory(
            at: quarantineURL,
            includingPropertiesForKeys: nil
        )
        let batchURL = try XCTUnwrap(batches.first)
        let quarantinedNames = try FileManager.default.contentsOfDirectory(
            at: batchURL,
            includingPropertiesForKeys: nil
        ).map(\.lastPathComponent)
        XCTAssertEqual(Set(quarantinedNames), ["active-recording.json", "recording.ndjson"])
    }

    func testMixedValidAndCorruptActiveSessionsRecoverValidSession() throws {
        let rootURL = temporaryDirectory()
        let store = DiveProfileArtifactStore(rootURL: rootURL)
        let validMetadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000117")!
        )
        let corruptMetadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000118")!
        )
        let validSample = EngineTestFixtures.sample(0.8, depth: 4)
        try store.beginRecording(validMetadata)
        try store.append(validSample, to: validMetadata.localSessionId)
        try store.beginRecording(corruptMetadata)
        let corruptJournalURL = sessionDirectory(
            rootURL: rootURL,
            sessionID: corruptMetadata.localSessionId
        ).appendingPathComponent("recording.ndjson")
        try Data("not-json\n".utf8).write(to: corruptJournalURL, options: .atomic)

        let recovered = try store.loadActiveRecordings()

        XCTAssertEqual(recovered.map(\.metadata.localSessionId), [validMetadata.localSessionId])
        XCTAssertEqual(recovered.first?.samples.first?.depthMeters, validSample.depthMeters)
    }

    func testCorruptMetadataIsQuarantinedWithItsActiveJournal() throws {
        let rootURL = temporaryDirectory()
        let store = DiveProfileArtifactStore(rootURL: rootURL)
        let metadata = makeMetadata(
            sessionID: UUID(uuidString: "00000000-0000-0000-0000-000000000120")!
        )
        try store.beginRecording(metadata)
        let sessionURL = sessionDirectory(rootURL: rootURL, sessionID: metadata.localSessionId)
        try Data("not-json".utf8).write(
            to: sessionURL.appendingPathComponent("active-recording.json"),
            options: .atomic
        )

        XCTAssertTrue(try store.loadActiveRecordings().isEmpty)

        XCTAssertFalse(FileManager.default.fileExists(atPath: sessionURL.appendingPathComponent("active-recording.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: sessionURL.appendingPathComponent("recording.ndjson").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sessionURL.appendingPathComponent("Quarantine").path))
    }

    func testMigratesLegacyRecordFileOnlyAfterEveryArtifactVerifies() throws {
        let rootURL = temporaryDirectory()
        let legacyURL = rootURL.appendingPathComponent("savedDiveSessionRecords.json")
        let records = [
            DiveSessionRecord.largeDebugFixture(sampleCount: 20),
            DiveSessionRecord.largeDebugFixture(sampleCount: 40).withIdentity(
                UUID(uuidString: "00000000-0000-0000-0000-000000001A6F")!
            ),
        ]
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try JSONEncoder().encode(records).write(to: legacyURL, options: .atomic)
        let store = DiveProfileArtifactStore(rootURL: rootURL, makeRevision: { UUID().uuidString })

        let migrated = try store.migrateLegacyRecords(at: legacyURL)

        XCTAssertEqual(migrated.count, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyURL.path))
        XCTAssertEqual(try store.loadEntries().count, 2)
        for entry in migrated {
            XCTAssertNoThrow(try store.verifyArtifact(entry.artifact))
        }
    }

    func testKeepsUnreadableLegacySourceAndExistingManifest() throws {
        let rootURL = temporaryDirectory()
        let legacyURL = rootURL.appendingPathComponent("savedDiveSessionRecords.json")
        let store = DiveProfileArtifactStore(rootURL: rootURL, makeRevision: { "revision-existing" })
        _ = try store.finalize(record: DiveSessionRecord.largeDebugFixture(sampleCount: 10))
        try Data("not-json".utf8).write(to: legacyURL, options: .atomic)

        XCTAssertThrowsError(try store.migrateLegacyRecords(at: legacyURL))
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacyURL.path))
        XCTAssertEqual(try store.loadEntries().count, 1)
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("DiveProfileArtifactStoreTests")
            .appendingPathComponent(UUID().uuidString)
    }

    private func makeMetadata(sessionID: UUID) -> ActiveDiveRecordingMetadata {
        ActiveDiveRecordingMetadata(
            localSessionId: sessionID,
            startedAt: EngineTestFixtures.start,
            captureMode: .real,
            plan: PreDivePlan(diveMode: .freedive)
        )
    }

    private func sessionDirectory(rootURL: URL, sessionID: UUID) -> URL {
        rootURL
            .appendingPathComponent("Sessions", isDirectory: true)
            .appendingPathComponent(sessionID.uuidString, isDirectory: true)
    }
}

private final class FailingJournalCreationFileManager: FileManager {
    override func createFile(
        atPath path: String,
        contents data: Data?,
        attributes attr: [FileAttributeKey: Any]? = nil
    ) -> Bool {
        guard URL(fileURLWithPath: path).lastPathComponent != "recording.ndjson" else {
            return false
        }
        return super.createFile(atPath: path, contents: data, attributes: attr)
    }
}

private final class FailFirstPendingRemovalFileManager: FileManager {
    private var didFailPendingRemoval = false

    override func removeItem(at URL: URL) throws {
        if !didFailPendingRemoval, URL.lastPathComponent == "recording-pending.json" {
            didFailPendingRemoval = true
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.removeItem(at: URL)
    }
}

private extension Digest {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
