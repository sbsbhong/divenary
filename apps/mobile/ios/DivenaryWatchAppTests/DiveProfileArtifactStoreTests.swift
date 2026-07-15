import CryptoKit
import XCTest
@testable import DivenaryWatchApp

final class DiveProfileArtifactStoreTests: XCTestCase {
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
        var firstStore = DiveProfileArtifactStore(rootURL: rootURL)

        try firstStore.beginRecording(metadata)
        try firstStore.append(EngineTestFixtures.sample(0.8, depth: 3), to: metadata.localSessionId)
        try firstStore.append(EngineTestFixtures.sample(10.8, depth: 8), to: metadata.localSessionId)

        let recovered = try DiveProfileArtifactStore(rootURL: rootURL).loadActiveRecordings()

        XCTAssertEqual(recovered.count, 1)
        XCTAssertEqual(recovered.first?.metadata, metadata)
        XCTAssertEqual(recovered.first?.samples.map(\.depthMeters), [3, 8])
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
}

private extension Digest {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
