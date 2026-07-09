// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let watchSyncMessage = try WatchSyncMessage(json)

import Foundation

// MARK: - WatchSyncMessage
public struct WatchSyncMessage: Codable {
    public let session: WatchSession
    public let type: TypeEnum

    public init(session: WatchSession, type: TypeEnum) {
        self.session = session
        self.type = type
    }
}

// MARK: WatchSyncMessage convenience initializers and mutators

public extension WatchSyncMessage {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchSyncMessage.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        session: WatchSession? = nil,
        type: TypeEnum? = nil
    ) -> WatchSyncMessage {
        return WatchSyncMessage(
            session: session ?? self.session,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - WatchSession
public struct WatchSession: Codable {
    public let averageDepthMeters: Double?
    public let buddyIds: [String]?
    public let captureMode: CaptureMode?
    public let diveMode: DiveMode?
    /// Unix timestamp in seconds
    public let endedAt: Double?
    public let entryLocation, exitLocation: WatchLocation?
    public let freedive: FreeDivePayload?
    public let gasLabel: String?
    public let gearIds: [String]?
    public let localSessionId: String
    public let maxDepthMeters: Double?
    public let notes: String?
    public let perceivedExertion: Int?
    public let planTitle: String?
    public let rating: Int?
    public let samples: [WatchDepthSample]
    public let schemaVersion: Int?
    public let scuba: ScubaPayload?
    public let siteId, siteName, sourcePlanLocalId: String?
    /// Unix timestamp in seconds
    public let startedAt: Double
    public let syncStatus: SyncStatus?
    public let tags: [String]?
    public let unsupportedDepth: UnsupportedDepthRecord?
    public let visibilityRating: Int?
    public let waterCondition: WaterCondition?
    public let waterTemperatureCelsius: Double?

    public init(averageDepthMeters: Double?, buddyIds: [String]?, captureMode: CaptureMode?, diveMode: DiveMode?, endedAt: Double?, entryLocation: WatchLocation?, exitLocation: WatchLocation?, freedive: FreeDivePayload?, gasLabel: String?, gearIds: [String]?, localSessionId: String, maxDepthMeters: Double?, notes: String?, perceivedExertion: Int?, planTitle: String?, rating: Int?, samples: [WatchDepthSample], schemaVersion: Int?, scuba: ScubaPayload?, siteId: String?, siteName: String?, sourcePlanLocalId: String?, startedAt: Double, syncStatus: SyncStatus?, tags: [String]?, unsupportedDepth: UnsupportedDepthRecord?, visibilityRating: Int?, waterCondition: WaterCondition?, waterTemperatureCelsius: Double?) {
        self.averageDepthMeters = averageDepthMeters
        self.buddyIds = buddyIds
        self.captureMode = captureMode
        self.diveMode = diveMode
        self.endedAt = endedAt
        self.entryLocation = entryLocation
        self.exitLocation = exitLocation
        self.freedive = freedive
        self.gasLabel = gasLabel
        self.gearIds = gearIds
        self.localSessionId = localSessionId
        self.maxDepthMeters = maxDepthMeters
        self.notes = notes
        self.perceivedExertion = perceivedExertion
        self.planTitle = planTitle
        self.rating = rating
        self.samples = samples
        self.schemaVersion = schemaVersion
        self.scuba = scuba
        self.siteId = siteId
        self.siteName = siteName
        self.sourcePlanLocalId = sourcePlanLocalId
        self.startedAt = startedAt
        self.syncStatus = syncStatus
        self.tags = tags
        self.unsupportedDepth = unsupportedDepth
        self.visibilityRating = visibilityRating
        self.waterCondition = waterCondition
        self.waterTemperatureCelsius = waterTemperatureCelsius
    }
}

// MARK: WatchSession convenience initializers and mutators

public extension WatchSession {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchSession.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        averageDepthMeters: Double?? = nil,
        buddyIds: [String]?? = nil,
        captureMode: CaptureMode?? = nil,
        diveMode: DiveMode?? = nil,
        endedAt: Double?? = nil,
        entryLocation: WatchLocation?? = nil,
        exitLocation: WatchLocation?? = nil,
        freedive: FreeDivePayload?? = nil,
        gasLabel: String?? = nil,
        gearIds: [String]?? = nil,
        localSessionId: String? = nil,
        maxDepthMeters: Double?? = nil,
        notes: String?? = nil,
        perceivedExertion: Int?? = nil,
        planTitle: String?? = nil,
        rating: Int?? = nil,
        samples: [WatchDepthSample]? = nil,
        schemaVersion: Int?? = nil,
        scuba: ScubaPayload?? = nil,
        siteId: String?? = nil,
        siteName: String?? = nil,
        sourcePlanLocalId: String?? = nil,
        startedAt: Double? = nil,
        syncStatus: SyncStatus?? = nil,
        tags: [String]?? = nil,
        unsupportedDepth: UnsupportedDepthRecord?? = nil,
        visibilityRating: Int?? = nil,
        waterCondition: WaterCondition?? = nil,
        waterTemperatureCelsius: Double?? = nil
    ) -> WatchSession {
        return WatchSession(
            averageDepthMeters: averageDepthMeters ?? self.averageDepthMeters,
            buddyIds: buddyIds ?? self.buddyIds,
            captureMode: captureMode ?? self.captureMode,
            diveMode: diveMode ?? self.diveMode,
            endedAt: endedAt ?? self.endedAt,
            entryLocation: entryLocation ?? self.entryLocation,
            exitLocation: exitLocation ?? self.exitLocation,
            freedive: freedive ?? self.freedive,
            gasLabel: gasLabel ?? self.gasLabel,
            gearIds: gearIds ?? self.gearIds,
            localSessionId: localSessionId ?? self.localSessionId,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters,
            notes: notes ?? self.notes,
            perceivedExertion: perceivedExertion ?? self.perceivedExertion,
            planTitle: planTitle ?? self.planTitle,
            rating: rating ?? self.rating,
            samples: samples ?? self.samples,
            schemaVersion: schemaVersion ?? self.schemaVersion,
            scuba: scuba ?? self.scuba,
            siteId: siteId ?? self.siteId,
            siteName: siteName ?? self.siteName,
            sourcePlanLocalId: sourcePlanLocalId ?? self.sourcePlanLocalId,
            startedAt: startedAt ?? self.startedAt,
            syncStatus: syncStatus ?? self.syncStatus,
            tags: tags ?? self.tags,
            unsupportedDepth: unsupportedDepth ?? self.unsupportedDepth,
            visibilityRating: visibilityRating ?? self.visibilityRating,
            waterCondition: waterCondition ?? self.waterCondition,
            waterTemperatureCelsius: waterTemperatureCelsius ?? self.waterTemperatureCelsius
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum CaptureMode: String, Codable {
    case demo = "demo"
    case real = "real"
}

public enum DiveMode: String, Codable {
    case freedive = "freedive"
    case scuba = "scuba"
}

// MARK: - WatchLocation
public struct WatchLocation: Codable {
    /// Unix timestamp in seconds
    public let capturedAt: Double?
    public let horizontalAccuracyMeters: Double?
    public let latitude, longitude: Double

    public init(capturedAt: Double?, horizontalAccuracyMeters: Double?, latitude: Double, longitude: Double) {
        self.capturedAt = capturedAt
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.latitude = latitude
        self.longitude = longitude
    }
}

// MARK: WatchLocation convenience initializers and mutators

public extension WatchLocation {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchLocation.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        capturedAt: Double?? = nil,
        horizontalAccuracyMeters: Double?? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil
    ) -> WatchLocation {
        return WatchLocation(
            capturedAt: capturedAt ?? self.capturedAt,
            horizontalAccuracyMeters: horizontalAccuracyMeters ?? self.horizontalAccuracyMeters,
            latitude: latitude ?? self.latitude,
            longitude: longitude ?? self.longitude
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - FreeDivePayload
public struct FreeDivePayload: Codable {
    public let diveCount: Int
    public let longestDiveDurationSeconds, maxDepthMeters: Double
    public let segments: [FreeDiveSegment]

    public init(diveCount: Int, longestDiveDurationSeconds: Double, maxDepthMeters: Double, segments: [FreeDiveSegment]) {
        self.diveCount = diveCount
        self.longestDiveDurationSeconds = longestDiveDurationSeconds
        self.maxDepthMeters = maxDepthMeters
        self.segments = segments
    }
}

// MARK: FreeDivePayload convenience initializers and mutators

public extension FreeDivePayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(FreeDivePayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        diveCount: Int? = nil,
        longestDiveDurationSeconds: Double? = nil,
        maxDepthMeters: Double? = nil,
        segments: [FreeDiveSegment]? = nil
    ) -> FreeDivePayload {
        return FreeDivePayload(
            diveCount: diveCount ?? self.diveCount,
            longestDiveDurationSeconds: longestDiveDurationSeconds ?? self.longestDiveDurationSeconds,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters,
            segments: segments ?? self.segments
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - FreeDiveSegment
public struct FreeDiveSegment: Codable {
    public let ascentRateMetersPerSecond, descentRateMetersPerSecond: Double?
    public let durationSeconds: Double
    /// Unix timestamp in seconds
    public let endedAt: Double
    public let index: Int
    public let maxDepthMeters, minDepthMeters: Double
    public let sampleEndIndex, sampleStartIndex: Int
    public let segmentId: String
    /// Unix timestamp in seconds
    public let startedAt: Double

    public init(ascentRateMetersPerSecond: Double?, descentRateMetersPerSecond: Double?, durationSeconds: Double, endedAt: Double, index: Int, maxDepthMeters: Double, minDepthMeters: Double, sampleEndIndex: Int, sampleStartIndex: Int, segmentId: String, startedAt: Double) {
        self.ascentRateMetersPerSecond = ascentRateMetersPerSecond
        self.descentRateMetersPerSecond = descentRateMetersPerSecond
        self.durationSeconds = durationSeconds
        self.endedAt = endedAt
        self.index = index
        self.maxDepthMeters = maxDepthMeters
        self.minDepthMeters = minDepthMeters
        self.sampleEndIndex = sampleEndIndex
        self.sampleStartIndex = sampleStartIndex
        self.segmentId = segmentId
        self.startedAt = startedAt
    }
}

// MARK: FreeDiveSegment convenience initializers and mutators

public extension FreeDiveSegment {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(FreeDiveSegment.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        ascentRateMetersPerSecond: Double?? = nil,
        descentRateMetersPerSecond: Double?? = nil,
        durationSeconds: Double? = nil,
        endedAt: Double? = nil,
        index: Int? = nil,
        maxDepthMeters: Double? = nil,
        minDepthMeters: Double? = nil,
        sampleEndIndex: Int? = nil,
        sampleStartIndex: Int? = nil,
        segmentId: String? = nil,
        startedAt: Double? = nil
    ) -> FreeDiveSegment {
        return FreeDiveSegment(
            ascentRateMetersPerSecond: ascentRateMetersPerSecond ?? self.ascentRateMetersPerSecond,
            descentRateMetersPerSecond: descentRateMetersPerSecond ?? self.descentRateMetersPerSecond,
            durationSeconds: durationSeconds ?? self.durationSeconds,
            endedAt: endedAt ?? self.endedAt,
            index: index ?? self.index,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters,
            minDepthMeters: minDepthMeters ?? self.minDepthMeters,
            sampleEndIndex: sampleEndIndex ?? self.sampleEndIndex,
            sampleStartIndex: sampleStartIndex ?? self.sampleStartIndex,
            segmentId: segmentId ?? self.segmentId,
            startedAt: startedAt ?? self.startedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - WatchDepthSample
public struct WatchDepthSample: Codable {
    public let depthMeters: Double
    public let localSessionId: String
    public let pressureKPa: Double?
    /// Unix timestamp in seconds
    public let timestamp: Double
    public let waterTemperatureCelsius: Double?

    public init(depthMeters: Double, localSessionId: String, pressureKPa: Double?, timestamp: Double, waterTemperatureCelsius: Double?) {
        self.depthMeters = depthMeters
        self.localSessionId = localSessionId
        self.pressureKPa = pressureKPa
        self.timestamp = timestamp
        self.waterTemperatureCelsius = waterTemperatureCelsius
    }
}

// MARK: WatchDepthSample convenience initializers and mutators

public extension WatchDepthSample {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchDepthSample.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        depthMeters: Double? = nil,
        localSessionId: String? = nil,
        pressureKPa: Double?? = nil,
        timestamp: Double? = nil,
        waterTemperatureCelsius: Double?? = nil
    ) -> WatchDepthSample {
        return WatchDepthSample(
            depthMeters: depthMeters ?? self.depthMeters,
            localSessionId: localSessionId ?? self.localSessionId,
            pressureKPa: pressureKPa ?? self.pressureKPa,
            timestamp: timestamp ?? self.timestamp,
            waterTemperatureCelsius: waterTemperatureCelsius ?? self.waterTemperatureCelsius
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ScubaPayload
public struct ScubaPayload: Codable {
    public let averageDepthMeters: Double
    public let gasLabel: String?
    public let latestAscentRateMetersPerMinute, maxAscentRateMetersPerMinute, maxDepthMeters: Double
    public let safetyStop: SafetyStopRecord
    public let waterTemperatureCelsius: Double?

    public init(averageDepthMeters: Double, gasLabel: String?, latestAscentRateMetersPerMinute: Double, maxAscentRateMetersPerMinute: Double, maxDepthMeters: Double, safetyStop: SafetyStopRecord, waterTemperatureCelsius: Double?) {
        self.averageDepthMeters = averageDepthMeters
        self.gasLabel = gasLabel
        self.latestAscentRateMetersPerMinute = latestAscentRateMetersPerMinute
        self.maxAscentRateMetersPerMinute = maxAscentRateMetersPerMinute
        self.maxDepthMeters = maxDepthMeters
        self.safetyStop = safetyStop
        self.waterTemperatureCelsius = waterTemperatureCelsius
    }
}

// MARK: ScubaPayload convenience initializers and mutators

public extension ScubaPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ScubaPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        averageDepthMeters: Double? = nil,
        gasLabel: String?? = nil,
        latestAscentRateMetersPerMinute: Double? = nil,
        maxAscentRateMetersPerMinute: Double? = nil,
        maxDepthMeters: Double? = nil,
        safetyStop: SafetyStopRecord? = nil,
        waterTemperatureCelsius: Double?? = nil
    ) -> ScubaPayload {
        return ScubaPayload(
            averageDepthMeters: averageDepthMeters ?? self.averageDepthMeters,
            gasLabel: gasLabel ?? self.gasLabel,
            latestAscentRateMetersPerMinute: latestAscentRateMetersPerMinute ?? self.latestAscentRateMetersPerMinute,
            maxAscentRateMetersPerMinute: maxAscentRateMetersPerMinute ?? self.maxAscentRateMetersPerMinute,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters,
            safetyStop: safetyStop ?? self.safetyStop,
            waterTemperatureCelsius: waterTemperatureCelsius ?? self.waterTemperatureCelsius
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SafetyStopRecord
public struct SafetyStopRecord: Codable {
    public let completed: Bool
    /// Unix timestamp in seconds
    public let completedAt: Double?
    public let durationSeconds: Double
    public let maxDepthMeters, minDepthMeters: Double
    public let recommendationType: RecommendationType?
    public let remainingSeconds: Double
    public let safetyStopRecordRequired: Bool
    /// Unix timestamp in seconds
    public let startedAt: Double?
    public let status: Status
    public let targetDepthMeters: Double
    public let timeInZoneSeconds: Double

    public enum CodingKeys: String, CodingKey {
        case completed, completedAt, durationSeconds, maxDepthMeters, minDepthMeters, recommendationType, remainingSeconds
        case safetyStopRecordRequired = "required"
        case startedAt, status, targetDepthMeters, timeInZoneSeconds
    }

    public init(completed: Bool, completedAt: Double?, durationSeconds: Double, maxDepthMeters: Double, minDepthMeters: Double, recommendationType: RecommendationType?, remainingSeconds: Double, safetyStopRecordRequired: Bool, startedAt: Double?, status: Status, targetDepthMeters: Double, timeInZoneSeconds: Double) {
        self.completed = completed
        self.completedAt = completedAt
        self.durationSeconds = durationSeconds
        self.maxDepthMeters = maxDepthMeters
        self.minDepthMeters = minDepthMeters
        self.recommendationType = recommendationType
        self.remainingSeconds = remainingSeconds
        self.safetyStopRecordRequired = safetyStopRecordRequired
        self.startedAt = startedAt
        self.status = status
        self.targetDepthMeters = targetDepthMeters
        self.timeInZoneSeconds = timeInZoneSeconds
    }
}

// MARK: SafetyStopRecord convenience initializers and mutators

public extension SafetyStopRecord {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SafetyStopRecord.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        completed: Bool? = nil,
        completedAt: Double?? = nil,
        durationSeconds: Double? = nil,
        maxDepthMeters: Double? = nil,
        minDepthMeters: Double? = nil,
        recommendationType: RecommendationType?? = nil,
        remainingSeconds: Double? = nil,
        safetyStopRecordRequired: Bool? = nil,
        startedAt: Double?? = nil,
        status: Status? = nil,
        targetDepthMeters: Double? = nil,
        timeInZoneSeconds: Double? = nil
    ) -> SafetyStopRecord {
        return SafetyStopRecord(
            completed: completed ?? self.completed,
            completedAt: completedAt ?? self.completedAt,
            durationSeconds: durationSeconds ?? self.durationSeconds,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters,
            minDepthMeters: minDepthMeters ?? self.minDepthMeters,
            recommendationType: recommendationType ?? self.recommendationType,
            remainingSeconds: remainingSeconds ?? self.remainingSeconds,
            safetyStopRecordRequired: safetyStopRecordRequired ?? self.safetyStopRecordRequired,
            startedAt: startedAt ?? self.startedAt,
            status: status ?? self.status,
            targetDepthMeters: targetDepthMeters ?? self.targetDepthMeters,
            timeInZoneSeconds: timeInZoneSeconds ?? self.timeInZoneSeconds
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum RecommendationType: String, Codable {
    case recommended = "recommended"
}

public enum Status: String, Codable {
    case active = "active"
    case armed = "armed"
    case completed = "completed"
    case notRequired = "notRequired"
    case pausedTooDeep = "pausedTooDeep"
    case pausedTooShallow = "pausedTooShallow"
    case skippedOrIncomplete = "skippedOrIncomplete"
    case unknown = "unknown"
}

public enum SyncStatus: String, Codable {
    case failed = "failed"
    case pending = "pending"
    case synced = "synced"
}

// MARK: - UnsupportedDepthRecord
public struct UnsupportedDepthRecord: Codable {
    public let exceeded: Bool
    /// Unix timestamp in seconds
    public let firstExceededAt: Double?
    public let limitMeters: Double
    public let maxDepthMeters: Double?

    public init(exceeded: Bool, firstExceededAt: Double?, limitMeters: Double, maxDepthMeters: Double?) {
        self.exceeded = exceeded
        self.firstExceededAt = firstExceededAt
        self.limitMeters = limitMeters
        self.maxDepthMeters = maxDepthMeters
    }
}

// MARK: UnsupportedDepthRecord convenience initializers and mutators

public extension UnsupportedDepthRecord {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(UnsupportedDepthRecord.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        exceeded: Bool? = nil,
        firstExceededAt: Double?? = nil,
        limitMeters: Double? = nil,
        maxDepthMeters: Double?? = nil
    ) -> UnsupportedDepthRecord {
        return UnsupportedDepthRecord(
            exceeded: exceeded ?? self.exceeded,
            firstExceededAt: firstExceededAt ?? self.firstExceededAt,
            limitMeters: limitMeters ?? self.limitMeters,
            maxDepthMeters: maxDepthMeters ?? self.maxDepthMeters
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum WaterCondition: String, Codable {
    case calm = "calm"
    case choppy = "choppy"
    case current = "current"
    case mild = "mild"
    case surge = "surge"
    case unknown = "unknown"
}

public enum TypeEnum: String, Codable {
    case sessionCreated = "sessionCreated"
    case sessionEnded = "sessionEnded"
    case sessionUpdated = "sessionUpdated"
}

// MARK: - Helper functions for creating encoders and decoders

func newJSONDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        decoder.dateDecodingStrategy = .iso8601
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        encoder.dateEncodingStrategy = .iso8601
    }
    return encoder
}
