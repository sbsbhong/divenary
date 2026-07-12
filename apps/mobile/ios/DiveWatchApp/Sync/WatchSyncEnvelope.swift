import Foundation

enum WatchSyncEnvelope {
    static let directMessagePayloadLimitBytes = 48 * 1024
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
        let payloadData = try session.syncMessageData()

        return [
            kindKey: kind,
            payloadBase64Key: payloadData.base64EncodedString(),
            localSessionIdKey: session.id.uuidString,
            sentAtKey: sentAt.timeIntervalSince1970
        ]
    }

    static func fileMetadata(for session: DiveSessionRecord, sentAt: Date = Date()) -> [String: Any] {
        [
            kindKey: kind,
            localSessionIdKey: session.id.uuidString,
            sentAtKey: sentAt.timeIntervalSince1970
        ]
    }
}
