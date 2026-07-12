import Foundation

enum DiveCaptureMode: String, Codable, Equatable {
    case real
    case demo
}

enum DiveDepthSupport {
    static let supportedWatchDepthLimitMeters = 40.0
}

struct UnsupportedDepthRecord: Codable, Equatable {
    let exceeded: Bool
    let limitMeters: Double
    let maxDepthMeters: Double?
    let firstExceededAt: Date?

    static func from(samples: [DepthSample], payload: DiveSessionPayload) -> UnsupportedDepthRecord? {
        let sampleMaxDepthMeters = samples.map(\.depthMeters).max() ?? 0
        let maxDepthMeters = max(sampleMaxDepthMeters, payload.maxDepthMeters)

        guard maxDepthMeters > DiveDepthSupport.supportedWatchDepthLimitMeters else {
            return nil
        }

        let firstExceededAt = samples.first { $0.depthMeters > DiveDepthSupport.supportedWatchDepthLimitMeters }?.timestamp

        return UnsupportedDepthRecord(
            exceeded: true,
            limitMeters: DiveDepthSupport.supportedWatchDepthLimitMeters,
            maxDepthMeters: maxDepthMeters,
            firstExceededAt: firstExceededAt
        )
    }
}

struct DiveSessionRecord: Codable, Identifiable {
    let id: UUID
    let schemaVersion: Int
    let captureMode: DiveCaptureMode
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
    let unsupportedDepth: UnsupportedDepthRecord?
    let payload: DiveSessionPayload

    init(
        id: UUID,
        schemaVersion: Int,
        captureMode: DiveCaptureMode = .real,
        diveMode: DiveMode,
        siteId: String?,
        siteName: String?,
        sourcePlanLocalId: String?,
        planTitle: String?,
        buddyIds: [String],
        gearIds: [String],
        tags: [String],
        notes: String?,
        rating: Int?,
        perceivedExertion: Int?,
        visibilityRating: Int?,
        waterCondition: WaterCondition,
        syncStatus: DiveSyncStatus,
        entryLocation: WatchLocation?,
        exitLocation: WatchLocation?,
        startedAt: Date,
        endedAt: Date?,
        samples: [DepthSample],
        payload: DiveSessionPayload,
        unsupportedDepth: UnsupportedDepthRecord? = nil
    ) {
        self.id = id
        self.schemaVersion = schemaVersion
        self.captureMode = captureMode
        self.diveMode = diveMode
        self.siteId = siteId
        self.siteName = siteName
        self.sourcePlanLocalId = sourcePlanLocalId
        self.planTitle = planTitle
        self.buddyIds = buddyIds
        self.gearIds = gearIds
        self.tags = tags
        self.notes = notes
        self.rating = rating
        self.perceivedExertion = perceivedExertion
        self.visibilityRating = visibilityRating
        self.waterCondition = waterCondition
        self.syncStatus = syncStatus
        self.entryLocation = entryLocation
        self.exitLocation = exitLocation
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.samples = samples
        self.unsupportedDepth = unsupportedDepth ?? UnsupportedDepthRecord.from(samples: samples, payload: payload)
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case schemaVersion
        case captureMode
        case diveMode
        case siteId
        case siteName
        case sourcePlanLocalId
        case planTitle
        case buddyIds
        case gearIds
        case tags
        case notes
        case rating
        case perceivedExertion
        case visibilityRating
        case waterCondition
        case syncStatus
        case entryLocation
        case exitLocation
        case startedAt
        case endedAt
        case samples
        case unsupportedDepth
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(UUID.self, forKey: .id),
            schemaVersion: try container.decode(Int.self, forKey: .schemaVersion),
            captureMode: try container.decodeIfPresent(DiveCaptureMode.self, forKey: .captureMode) ?? .real,
            diveMode: try container.decode(DiveMode.self, forKey: .diveMode),
            siteId: try container.decodeIfPresent(String.self, forKey: .siteId),
            siteName: try container.decodeIfPresent(String.self, forKey: .siteName),
            sourcePlanLocalId: try container.decodeIfPresent(String.self, forKey: .sourcePlanLocalId),
            planTitle: try container.decodeIfPresent(String.self, forKey: .planTitle),
            buddyIds: try container.decode([String].self, forKey: .buddyIds),
            gearIds: try container.decode([String].self, forKey: .gearIds),
            tags: try container.decode([String].self, forKey: .tags),
            notes: try container.decodeIfPresent(String.self, forKey: .notes),
            rating: try container.decodeIfPresent(Int.self, forKey: .rating),
            perceivedExertion: try container.decodeIfPresent(Int.self, forKey: .perceivedExertion),
            visibilityRating: try container.decodeIfPresent(Int.self, forKey: .visibilityRating),
            waterCondition: try container.decode(WaterCondition.self, forKey: .waterCondition),
            syncStatus: try container.decode(DiveSyncStatus.self, forKey: .syncStatus),
            entryLocation: try container.decodeIfPresent(WatchLocation.self, forKey: .entryLocation),
            exitLocation: try container.decodeIfPresent(WatchLocation.self, forKey: .exitLocation),
            startedAt: try container.decode(Date.self, forKey: .startedAt),
            endedAt: try container.decodeIfPresent(Date.self, forKey: .endedAt),
            samples: try container.decode([DepthSample].self, forKey: .samples),
            payload: try container.decode(DiveSessionPayload.self, forKey: .payload),
            unsupportedDepth: try container.decodeIfPresent(UnsupportedDepthRecord.self, forKey: .unsupportedDepth)
        )
    }
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
    let recommendationType: SafetyStopRecommendationType
    let completed: Bool
    let targetDepthMeters: Double
    let minDepthMeters: Double
    let maxDepthMeters: Double
    let durationSeconds: TimeInterval
    let startedAt: Date?
    let completedAt: Date?
    let remainingSeconds: TimeInterval
    let timeInZoneSeconds: TimeInterval

    init(
        status: SafetyStopStatus,
        required: Bool,
        recommendationType: SafetyStopRecommendationType = .recommended,
        completed: Bool,
        targetDepthMeters: Double,
        minDepthMeters: Double,
        maxDepthMeters: Double,
        durationSeconds: TimeInterval,
        startedAt: Date?,
        completedAt: Date?,
        remainingSeconds: TimeInterval,
        timeInZoneSeconds: TimeInterval
    ) {
        self.status = status
        self.required = required
        self.recommendationType = recommendationType
        self.completed = completed
        self.targetDepthMeters = targetDepthMeters
        self.minDepthMeters = minDepthMeters
        self.maxDepthMeters = maxDepthMeters
        self.durationSeconds = durationSeconds
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.remainingSeconds = remainingSeconds
        self.timeInZoneSeconds = timeInZoneSeconds
    }

    private enum CodingKeys: String, CodingKey {
        case status
        case required
        case recommendationType
        case completed
        case targetDepthMeters
        case minDepthMeters
        case maxDepthMeters
        case durationSeconds
        case startedAt
        case completedAt
        case remainingSeconds
        case timeInZoneSeconds
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            status: try container.decode(SafetyStopStatus.self, forKey: .status),
            required: try container.decode(Bool.self, forKey: .required),
            recommendationType: try container.decodeIfPresent(SafetyStopRecommendationType.self, forKey: .recommendationType) ?? .recommended,
            completed: try container.decode(Bool.self, forKey: .completed),
            targetDepthMeters: try container.decode(Double.self, forKey: .targetDepthMeters),
            minDepthMeters: try container.decode(Double.self, forKey: .minDepthMeters),
            maxDepthMeters: try container.decode(Double.self, forKey: .maxDepthMeters),
            durationSeconds: try container.decode(TimeInterval.self, forKey: .durationSeconds),
            startedAt: try container.decodeIfPresent(Date.self, forKey: .startedAt),
            completedAt: try container.decodeIfPresent(Date.self, forKey: .completedAt),
            remainingSeconds: try container.decode(TimeInterval.self, forKey: .remainingSeconds),
            timeInZoneSeconds: try container.decode(TimeInterval.self, forKey: .timeInZoneSeconds)
        )
    }

    static let legacyUnknown = SafetyStopRecord(
        status: .unknown,
        required: false,
        recommendationType: .recommended,
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

enum SafetyStopRecommendationType: String, Codable, Equatable {
    case recommended
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
    static let debugTestTag = "debug-test-capture"

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
            captureMode: .real,
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
        let message = RecordWatchSyncMessagePayload(
            type: type,
            session: RecordWatchSessionPayload(session: sanitizedForPersistence())
        )
        return try JSONEncoder().encode(message)
    }

    func sanitizedForPersistence() -> DiveSessionRecord {
        let safeStartedAt = startedAt.jsonSafe(defaultingTo: Date(timeIntervalSince1970: 0))
        let safeEndedAt = endedAt?.jsonSafeOptional()
        let safeSamples = samples.filter(\.isValidRecordingSample)
        let sampleStats = DiveSampleStats(samples: safeSamples)
        let safePayload = payload.sanitizedForPersistence(
            sampleStats: sampleStats,
            fallbackStart: safeStartedAt,
            fallbackEnd: safeEndedAt
        )

        return DiveSessionRecord(
            id: id,
            schemaVersion: schemaVersion,
            captureMode: captureMode,
            diveMode: diveMode,
            siteId: siteId,
            siteName: siteName,
            sourcePlanLocalId: sourcePlanLocalId,
            planTitle: planTitle,
            buddyIds: buddyIds,
            gearIds: gearIds,
            tags: tags,
            notes: notes,
            rating: rating,
            perceivedExertion: perceivedExertion,
            visibilityRating: visibilityRating,
            waterCondition: waterCondition,
            syncStatus: syncStatus,
            entryLocation: entryLocation?.jsonSafeLocation(),
            exitLocation: exitLocation?.jsonSafeLocation(),
            startedAt: safeStartedAt,
            endedAt: safeEndedAt,
            samples: safeSamples,
            payload: safePayload,
            unsupportedDepth: UnsupportedDepthRecord.from(samples: safeSamples, payload: safePayload)
        )
    }
}

private struct DiveSampleStats {
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let averageWaterTemperatureCelsius: Double?
    let latestAscentRateMetersPerMinute: Double
    let maxAscentRateMetersPerMinute: Double

    init(samples: [DepthSample]) {
        maxDepthMeters = samples.map(\.depthMeters).max() ?? 0
        averageDepthMeters = samples.isEmpty
            ? 0
            : samples.reduce(0) { $0 + $1.depthMeters } / Double(samples.count)
        let temperatures = samples.compactMap(\.waterTemperatureCelsius)
        averageWaterTemperatureCelsius = temperatures.isEmpty
            ? nil
            : temperatures.reduce(0, +) / Double(temperatures.count)
        latestAscentRateMetersPerMinute = Self.ascentRate(from: samples.dropLast().last, to: samples.last)
        maxAscentRateMetersPerMinute = samples.indices.dropFirst().reduce(0) { maxRate, index in
            max(maxRate, Self.ascentRate(from: samples[index - 1], to: samples[index]))
        }
    }

    private static func ascentRate(from previous: DepthSample?, to current: DepthSample?) -> Double {
        guard let previous, let current else { return 0 }
        let elapsed = current.timestamp.timeIntervalSince(previous.timestamp)
        guard elapsed > 0, current.depthMeters < previous.depthMeters else { return 0 }
        return (previous.depthMeters - current.depthMeters) / elapsed * 60
    }
}

private extension DiveSessionPayload {
    var maxDepthMeters: Double {
        switch self {
        case .freedive(let session):
            return session.maxDepthMeters
        case .scuba(let session):
            return session.maxDepthMeters
        }
    }

    func sanitizedForPersistence(
        sampleStats: DiveSampleStats,
        fallbackStart: Date,
        fallbackEnd: Date?
    ) -> DiveSessionPayload {
        switch self {
        case .freedive(let session):
            let safeStart = session.startTime.jsonSafe(defaultingTo: fallbackStart)
            let safeEnd = session.endTime?.jsonSafeOptional() ?? fallbackEnd
            let safeSegments = session.segments.map {
                $0.sanitizedForPersistence(fallbackStart: safeStart, fallbackEnd: safeEnd)
            }
            let durationFallback = safeEnd.map { max(0, $0.timeIntervalSince(safeStart)) } ?? 0
            let maxDepthFallback = max(sampleStats.maxDepthMeters, safeSegments.map(\.maxDepthMeters).max() ?? 0)
            let longestFallback = safeSegments.map(\.durationSeconds).max() ?? durationFallback

            return .freedive(
                FreeDiveSession(
                    id: session.id,
                    startTime: safeStart,
                    endTime: safeEnd,
                    totalDurationSeconds: session.totalDurationSeconds.finiteNonNegative(defaultingTo: durationFallback),
                    maxDepthMeters: session.maxDepthMeters.finiteNonNegative(defaultingTo: maxDepthFallback),
                    diveCount: max(0, session.diveCount),
                    longestDiveDurationSeconds: session.longestDiveDurationSeconds.finiteNonNegative(defaultingTo: longestFallback),
                    segments: safeSegments
                )
            )
        case .scuba(let session):
            let safeStart = session.startTime.jsonSafe(defaultingTo: fallbackStart)
            let safeEnd = session.endTime?.jsonSafeOptional() ?? fallbackEnd
            let durationFallback = safeEnd.map { max(0, $0.timeIntervalSince(safeStart)) } ?? 0

            return .scuba(
                ScubaDiveSession(
                    id: session.id,
                    startTime: safeStart,
                    endTime: safeEnd,
                    durationSeconds: session.durationSeconds.finiteNonNegative(defaultingTo: durationFallback),
                    maxDepthMeters: session.maxDepthMeters.finiteNonNegative(defaultingTo: sampleStats.maxDepthMeters),
                    averageDepthMeters: session.averageDepthMeters.finiteNonNegative(defaultingTo: sampleStats.averageDepthMeters),
                    waterTemperatureCelsius: session.waterTemperatureCelsius.finite(defaultingTo: sampleStats.averageWaterTemperatureCelsius),
                    gasLabel: session.gasLabel,
                    latestAscentRateMetersPerMinute: session.latestAscentRateMetersPerMinute.finiteNonNegative(defaultingTo: sampleStats.latestAscentRateMetersPerMinute),
                    maxAscentRateMetersPerMinute: session.maxAscentRateMetersPerMinute.finiteNonNegative(defaultingTo: sampleStats.maxAscentRateMetersPerMinute),
                    safetyStop: session.safetyStop.sanitizedForPersistence()
                )
            )
        }
    }
}

private extension FreeDiveSegment {
    func sanitizedForPersistence(fallbackStart: Date, fallbackEnd: Date?) -> FreeDiveSegment {
        let safeStart = startTime.jsonSafe(defaultingTo: fallbackStart)
        let safeEnd = endTime?.jsonSafeOptional() ?? fallbackEnd
        let durationFallback = safeEnd.map { max(0, $0.timeIntervalSince(safeStart)) } ?? 0

        return FreeDiveSegment(
            id: id,
            index: max(0, index),
            startTime: safeStart,
            endTime: safeEnd,
            durationSeconds: durationSeconds.finiteNonNegative(defaultingTo: durationFallback),
            maxDepthMeters: maxDepthMeters.finiteNonNegative(defaultingTo: 0),
            minDepthMeters: minDepthMeters.finiteNonNegative(defaultingTo: 0),
            sampleStartIndex: max(0, sampleStartIndex),
            sampleEndIndex: max(0, sampleEndIndex),
            descentRateMetersPerSecond: descentRateMetersPerSecond.finite(),
            ascentRateMetersPerSecond: ascentRateMetersPerSecond.finite()
        )
    }
}

private extension SafetyStopRecord {
    func sanitizedForPersistence() -> SafetyStopRecord {
        let fallback = SafetyStopRecord.legacyUnknown
        let safeMinDepth = minDepthMeters.finiteNonNegative(defaultingTo: fallback.minDepthMeters)
        let safeMaxDepth = max(
            safeMinDepth,
            maxDepthMeters.finiteNonNegative(defaultingTo: fallback.maxDepthMeters)
        )
        let safeTargetDepth = targetDepthMeters
            .finiteNonNegative(defaultingTo: fallback.targetDepthMeters)
            .clamped(to: safeMinDepth...safeMaxDepth)

        return SafetyStopRecord(
            status: status,
            required: required,
            recommendationType: recommendationType,
            completed: completed,
            targetDepthMeters: safeTargetDepth,
            minDepthMeters: safeMinDepth,
            maxDepthMeters: safeMaxDepth,
            durationSeconds: durationSeconds.finiteNonNegative(defaultingTo: fallback.durationSeconds),
            startedAt: startedAt?.jsonSafeOptional(),
            completedAt: completedAt?.jsonSafeOptional(),
            remainingSeconds: remainingSeconds.finiteNonNegative(defaultingTo: fallback.remainingSeconds),
            timeInZoneSeconds: timeInZoneSeconds.finiteNonNegative(defaultingTo: fallback.timeInZoneSeconds)
        )
    }
}

private extension WatchLocation {
    func jsonSafeLocation() -> WatchLocation? {
        guard latitude.isFinite, longitude.isFinite else {
            return nil
        }

        return WatchLocation(
            latitude: latitude,
            longitude: longitude,
            horizontalAccuracyMeters: horizontalAccuracyMeters.finite(),
            capturedAt: capturedAt?.jsonSafeOptional()
        )
    }
}

private extension Date {
    func jsonSafe(defaultingTo fallback: Date) -> Date {
        timeIntervalSince1970.isFinite ? self : fallback
    }

    func jsonSafeOptional() -> Date? {
        timeIntervalSince1970.isFinite ? self : nil
    }
}

private extension Double {
    func finiteNonNegative(defaultingTo fallback: Double) -> Double {
        guard isFinite else {
            return max(0, fallback)
        }

        return max(0, self)
    }

    func clamped(to range: ClosedRange<Double>) -> Double {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private extension Optional where Wrapped == Double {
    func finite(defaultingTo fallback: Double? = nil) -> Double? {
        guard let value = self else {
            return nil
        }

        return value.isFinite ? value : fallback
    }
}

private struct RecordWatchSyncMessagePayload: Encodable {
    let type: String
    let session: RecordWatchSessionPayload
}

private struct RecordWatchSessionPayload: Encodable {
    let localSessionId: String
    let schemaVersion: Int
    let captureMode: String
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
    let unsupportedDepth: RecordUnsupportedDepthPayload?
    let samples: [RecordWatchDepthSamplePayload]
    let freedive: RecordWatchFreeDivePayload?
    let scuba: RecordWatchScubaPayload?

    init(session: DiveSessionRecord) {
        let summary = session.summary
        localSessionId = session.id.uuidString
        schemaVersion = session.schemaVersion
        captureMode = session.captureMode.rawValue
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
        unsupportedDepth = RecordUnsupportedDepthPayload(record: session.unsupportedDepth)
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

private struct RecordUnsupportedDepthPayload: Encodable {
    let exceeded: Bool
    let limitMeters: Double
    let maxDepthMeters: Double?
    let firstExceededAt: Double?

    init?(record: UnsupportedDepthRecord?) {
        guard let record else {
            return nil
        }

        exceeded = record.exceeded
        limitMeters = record.limitMeters
        maxDepthMeters = record.maxDepthMeters
        firstExceededAt = record.firstExceededAt?.timeIntervalSince1970
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
    let recommendationType: String
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
        recommendationType = record.recommendationType.rawValue
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

extension DiveSessionRecord {
    var captureProvenanceLabel: String? {
        guard captureMode == .demo else {
            return nil
        }

        return tags.contains(Self.debugTestTag)
            ? String(localized: "Test")
            : String(localized: "Demo")
    }
}
