import Foundation

enum WatchSyncEnvelope {
    static let kind = "watchSyncMessage"
    static let acknowledgementKind = "watchSyncAcknowledgement"
    static let plannedDivesKind = "watchPlannedDives"
    static let kindKey = "kind"
    static let payloadBase64Key = "payloadBase64"
    static let localSessionIdKey = "localSessionId"
    static let sentAtKey = "sentAt"
    static let acknowledgedAtKey = "acknowledgedAt"
    static let plannedDivesJsonKey = "plannedDivesJson"

    static func userInfo(for session: DiveSessionRecord, sentAt: Date = Date()) throws -> [String: Any] {
        let payloadData = try syncMessageData(for: session)

        return [
            kindKey: kind,
            payloadBase64Key: payloadData.base64EncodedString(),
            localSessionIdKey: session.id.uuidString,
            sentAtKey: sentAt.timeIntervalSince1970
        ]
    }

    private static func syncMessageData(for session: DiveSessionRecord, type: String = "sessionEnded") throws -> Data {
        let message = RecordWatchSyncMessagePayload(type: type, session: RecordWatchSessionPayload(session: session))
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
    let entryLocation: WatchLocationPayload?
    let exitLocation: WatchLocationPayload?
    let startedAt: Double
    let endedAt: Double?
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let samples: [RecordWatchDepthSamplePayload]

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
        entryLocation = session.entryLocation.map(WatchLocationPayload.init(location:))
        exitLocation = session.exitLocation.map(WatchLocationPayload.init(location:))
        startedAt = session.startedAt.timeIntervalSince1970
        endedAt = session.endedAt?.timeIntervalSince1970
        maxDepthMeters = summary.maxDepthMeters
        averageDepthMeters = summary.averageDepthMeters
        waterTemperatureCelsius = summary.averageWaterTemperatureCelsius
        samples = session.samples.map { RecordWatchDepthSamplePayload(sessionId: session.id.uuidString, sample: $0) }
    }
}

private struct WatchLocationPayload: Encodable {
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
