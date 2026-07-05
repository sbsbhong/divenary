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
                id: UUID(),
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
                    longestDiveDurationSeconds: summary.durationSeconds,
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
}
