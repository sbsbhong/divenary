import Foundation

struct DiveSessionRecord: Codable, Identifiable {
    let id: UUID
    let schemaVersion: Int
    let diveMode: DiveMode
    let siteId: String?
    let siteName: String?
    let sourcePlanLocalId: String?
    let planTitle: String?
    let buddyIds: [String]
    let gearIds: [String]
    let tags: [String]
    let notes: String?
    let rating: Int?
    let perceivedExertion: Int?
    let visibilityRating: Int?
    let waterCondition: WaterCondition
    let syncStatus: DiveSyncStatus
    let entryLocation: WatchLocation?
    let exitLocation: WatchLocation?
    let startedAt: Date
    let endedAt: Date?
    let samples: [DepthSample]
    let payload: DiveSessionPayload
}

enum DiveSessionPayload: Codable {
    case freedive(FreeDiveSession)
    case scuba(ScubaDiveSession)

    private enum CodingKeys: String, CodingKey {
        case type
        case freedive
        case scuba
    }

    private enum PayloadType: String, Codable {
        case freedive
        case scuba
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(PayloadType.self, forKey: .type)
        switch type {
        case .freedive:
            self = .freedive(try container.decode(FreeDiveSession.self, forKey: .freedive))
        case .scuba:
            self = .scuba(try container.decode(ScubaDiveSession.self, forKey: .scuba))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .freedive(let session):
            try container.encode(PayloadType.freedive, forKey: .type)
            try container.encode(session, forKey: .freedive)
        case .scuba(let session):
            try container.encode(PayloadType.scuba, forKey: .type)
            try container.encode(session, forKey: .scuba)
        }
    }
}

struct FreeDiveSession: Codable, Equatable {
    let id: UUID
    let startTime: Date
    let endTime: Date?
    let totalDurationSeconds: TimeInterval
    let maxDepthMeters: Double
    let diveCount: Int
    let longestDiveDurationSeconds: TimeInterval
    let segments: [FreeDiveSegment]
}

struct FreeDiveSegment: Codable, Identifiable, Equatable {
    let id: UUID
    let index: Int
    let startTime: Date
    let endTime: Date?
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let minDepthMeters: Double
    let sampleStartIndex: Int
    let sampleEndIndex: Int
    let descentRateMetersPerSecond: Double?
    let ascentRateMetersPerSecond: Double?
}

struct ScubaDiveSession: Codable, Equatable {
    let id: UUID
    let startTime: Date
    let endTime: Date?
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let gasLabel: String?
    let latestAscentRateMetersPerMinute: Double
    let maxAscentRateMetersPerMinute: Double
    let safetyStop: SafetyStopRecord
}

struct SafetyStopRecord: Codable, Equatable {
    let status: SafetyStopStatus
    let required: Bool
    let completed: Bool
    let targetDepthMeters: Double
    let minDepthMeters: Double
    let maxDepthMeters: Double
    let durationSeconds: TimeInterval
    let startedAt: Date?
    let completedAt: Date?
    let remainingSeconds: TimeInterval
    let timeInZoneSeconds: TimeInterval

    static let legacyUnknown = SafetyStopRecord(
        status: .unknown,
        required: false,
        completed: false,
        targetDepthMeters: 5,
        minDepthMeters: 3,
        maxDepthMeters: 6,
        durationSeconds: 180,
        startedAt: nil,
        completedAt: nil,
        remainingSeconds: 180,
        timeInZoneSeconds: 0
    )
}

enum SafetyStopStatus: String, Codable, Equatable {
    case unknown
    case notRequired
    case armed
    case active
    case pausedTooDeep
    case pausedTooShallow
    case completed
    case skippedOrIncomplete
}

extension DiveSessionRecord {
    init(legacySession session: DiveSession) {
        let summary = session.summary
        let payload: DiveSessionPayload

        switch session.diveMode {
        case .freedive:
            let segment = FreeDiveSegment(
                id: session.id,
                index: 1,
                startTime: session.startedAt,
                endTime: session.endedAt,
                durationSeconds: summary.durationSeconds,
                maxDepthMeters: summary.maxDepthMeters,
                minDepthMeters: session.samples.map(\.depthMeters).min() ?? 0,
                sampleStartIndex: 0,
                sampleEndIndex: max(0, session.samples.count - 1),
                descentRateMetersPerSecond: nil,
                ascentRateMetersPerSecond: nil
            )
            payload = .freedive(
                FreeDiveSession(
                    id: session.id,
                    startTime: session.startedAt,
                    endTime: session.endedAt,
                    totalDurationSeconds: summary.durationSeconds,
                    maxDepthMeters: summary.maxDepthMeters,
                    diveCount: session.samples.isEmpty ? 0 : 1,
                    longestDiveDurationSeconds: session.samples.isEmpty ? 0 : summary.durationSeconds,
                    segments: session.samples.isEmpty ? [] : [segment]
                )
            )
        case .scuba:
            payload = .scuba(
                ScubaDiveSession(
                    id: session.id,
                    startTime: session.startedAt,
                    endTime: session.endedAt,
                    durationSeconds: summary.durationSeconds,
                    maxDepthMeters: summary.maxDepthMeters,
                    averageDepthMeters: summary.averageDepthMeters,
                    waterTemperatureCelsius: summary.averageWaterTemperatureCelsius,
                    gasLabel: session.gasLabel,
                    latestAscentRateMetersPerMinute: summary.latestAscentRateMetersPerMinute,
                    maxAscentRateMetersPerMinute: summary.maxAscentRateMetersPerMinute,
                    safetyStop: .legacyUnknown
                )
            )
        }

        self.init(
            id: session.id,
            schemaVersion: 2,
            diveMode: session.diveMode,
            siteId: session.siteId,
            siteName: session.siteName,
            sourcePlanLocalId: session.sourcePlanLocalId,
            planTitle: session.planTitle,
            buddyIds: session.buddyIds,
            gearIds: session.gearIds,
            tags: session.tags,
            notes: session.notes,
            rating: session.rating,
            perceivedExertion: session.perceivedExertion,
            visibilityRating: session.visibilityRating,
            waterCondition: session.waterCondition,
            syncStatus: session.syncStatus,
            entryLocation: session.entryLocation,
            exitLocation: session.exitLocation,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            samples: session.samples,
            payload: payload
        )
    }

    func syncMessageData(type: String = "sessionEnded") throws -> Data {
        let message = RecordWatchSyncMessagePayload(type: type, session: RecordWatchSessionPayload(session: self))
        return try JSONEncoder().encode(message)
    }
}

private struct RecordWatchSyncMessagePayload: Encodable {
    let type: String
    let session: RecordWatchSessionPayload
}

private struct RecordWatchSessionPayload: Encodable {
    let localSessionId: String
    let schemaVersion: Int
    let diveMode: String
    let gasLabel: String?
    let siteId: String?
    let siteName: String?
    let sourcePlanLocalId: String?
    let planTitle: String?
    let buddyIds: [String]
    let gearIds: [String]
    let tags: [String]
    let notes: String?
    let rating: Int?
    let perceivedExertion: Int?
    let visibilityRating: Int?
    let waterCondition: String
    let syncStatus: String
    let entryLocation: RecordWatchLocationPayload?
    let exitLocation: RecordWatchLocationPayload?
    let startedAt: Double
    let endedAt: Double?
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let samples: [RecordWatchDepthSamplePayload]
    let freedive: RecordWatchFreeDivePayload?
    let scuba: RecordWatchScubaPayload?

    init(session: DiveSessionRecord) {
        let summary = session.summary
        localSessionId = session.id.uuidString
        schemaVersion = session.schemaVersion
        diveMode = session.diveMode.rawValue
        gasLabel = session.gasLabel
        siteId = session.siteId
        siteName = session.siteName
        sourcePlanLocalId = session.sourcePlanLocalId
        planTitle = session.planTitle
        buddyIds = session.buddyIds
        gearIds = session.gearIds
        tags = session.tags
        notes = session.notes
        rating = session.rating
        perceivedExertion = session.perceivedExertion
        visibilityRating = session.visibilityRating
        waterCondition = session.waterCondition.rawValue
        syncStatus = session.syncStatus.rawValue
        entryLocation = session.entryLocation.map(RecordWatchLocationPayload.init(location:))
        exitLocation = session.exitLocation.map(RecordWatchLocationPayload.init(location:))
        startedAt = session.startedAt.timeIntervalSince1970
        endedAt = session.endedAt?.timeIntervalSince1970
        maxDepthMeters = summary.maxDepthMeters
        averageDepthMeters = summary.averageDepthMeters
        waterTemperatureCelsius = summary.averageWaterTemperatureCelsius
        samples = session.samples.map { RecordWatchDepthSamplePayload(sessionId: session.id.uuidString, sample: $0) }

        switch session.payload {
        case .freedive(let freeSession):
            freedive = RecordWatchFreeDivePayload(session: freeSession)
            scuba = nil
        case .scuba(let scubaSession):
            freedive = nil
            scuba = RecordWatchScubaPayload(session: scubaSession)
        }
    }
}

private struct RecordWatchFreeDivePayload: Encodable {
    let diveCount: Int
    let maxDepthMeters: Double
    let longestDiveDurationSeconds: TimeInterval
    let segments: [RecordWatchFreeDiveSegmentPayload]

    init(session: FreeDiveSession) {
        diveCount = session.diveCount
        maxDepthMeters = session.maxDepthMeters
        longestDiveDurationSeconds = session.longestDiveDurationSeconds
        segments = session.segments.map(RecordWatchFreeDiveSegmentPayload.init(segment:))
    }
}

private struct RecordWatchFreeDiveSegmentPayload: Encodable {
    let segmentId: String
    let index: Int
    let startedAt: Double
    let endedAt: Double
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let minDepthMeters: Double
    let sampleStartIndex: Int
    let sampleEndIndex: Int
    let descentRateMetersPerSecond: Double?
    let ascentRateMetersPerSecond: Double?

    init(segment: FreeDiveSegment) {
        segmentId = segment.id.uuidString
        index = segment.index
        startedAt = segment.startTime.timeIntervalSince1970
        endedAt = (segment.endTime ?? segment.startTime.addingTimeInterval(segment.durationSeconds)).timeIntervalSince1970
        durationSeconds = segment.durationSeconds
        maxDepthMeters = segment.maxDepthMeters
        minDepthMeters = segment.minDepthMeters
        sampleStartIndex = segment.sampleStartIndex
        sampleEndIndex = segment.sampleEndIndex
        descentRateMetersPerSecond = segment.descentRateMetersPerSecond
        ascentRateMetersPerSecond = segment.ascentRateMetersPerSecond
    }
}

private struct RecordWatchScubaPayload: Encodable {
    let gasLabel: String?
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let latestAscentRateMetersPerMinute: Double
    let maxAscentRateMetersPerMinute: Double
    let safetyStop: RecordWatchSafetyStopPayload

    init(session: ScubaDiveSession) {
        gasLabel = session.gasLabel
        maxDepthMeters = session.maxDepthMeters
        averageDepthMeters = session.averageDepthMeters
        waterTemperatureCelsius = session.waterTemperatureCelsius
        latestAscentRateMetersPerMinute = session.latestAscentRateMetersPerMinute
        maxAscentRateMetersPerMinute = session.maxAscentRateMetersPerMinute
        safetyStop = RecordWatchSafetyStopPayload(record: session.safetyStop)
    }
}

private struct RecordWatchSafetyStopPayload: Encodable {
    let status: String
    let required: Bool
    let completed: Bool
    let targetDepthMeters: Double
    let minDepthMeters: Double
    let maxDepthMeters: Double
    let durationSeconds: TimeInterval
    let startedAt: Double?
    let completedAt: Double?
    let remainingSeconds: TimeInterval
    let timeInZoneSeconds: TimeInterval

    init(record: SafetyStopRecord) {
        status = record.status.rawValue
        required = record.required
        completed = record.completed
        targetDepthMeters = record.targetDepthMeters
        minDepthMeters = record.minDepthMeters
        maxDepthMeters = record.maxDepthMeters
        durationSeconds = record.durationSeconds
        startedAt = record.startedAt?.timeIntervalSince1970
        completedAt = record.completedAt?.timeIntervalSince1970
        remainingSeconds = record.remainingSeconds
        timeInZoneSeconds = record.timeInZoneSeconds
    }
}

private struct RecordWatchLocationPayload: Encodable {
    let latitude: Double
    let longitude: Double
    let horizontalAccuracyMeters: Double?
    let capturedAt: Double?

    init(location: WatchLocation) {
        latitude = location.latitude
        longitude = location.longitude
        horizontalAccuracyMeters = location.horizontalAccuracyMeters
        capturedAt = location.capturedAt?.timeIntervalSince1970
    }
}

private struct RecordWatchDepthSamplePayload: Encodable {
    let localSessionId: String
    let timestamp: Double
    let depthMeters: Double
    let pressureKPa: Double?
    let waterTemperatureCelsius: Double?

    init(sessionId: String, sample: DepthSample) {
        localSessionId = sessionId
        timestamp = sample.timestamp.timeIntervalSince1970
        depthMeters = sample.depthMeters
        pressureKPa = sample.pressureKPa
        waterTemperatureCelsius = sample.waterTemperatureCelsius
    }
}
