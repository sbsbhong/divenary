import XCTest
@testable import DiveWatchApp

final class DiveSessionRecordMigrationTests: XCTestCase {
    @MainActor
    func testFreediveRecorderLiveMaxUsesRawSamplesBeforeSegmentStarts() async {
        let sensorProvider = ManualDepthSensorProvider()
        let recorder = DiveSessionRecorder(sensorProvider: sensorProvider)

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
}

private final class ManualDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?

    func start() {}

    func stop() {}

    func emit(_ sample: DepthSample) {
        onSample?(sample)
    }
}
