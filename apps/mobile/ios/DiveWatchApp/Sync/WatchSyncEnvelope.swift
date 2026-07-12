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
    static let contentRevisionKey = "contentRevision"
    static let sha256Key = "sha256"
    static let byteCountKey = "byteCount"
    static let sampleCountKey = "sampleCount"
    static let formatVersionKey = "formatVersion"

    static func userInfo(for session: DiveSessionRecord, sentAt: Date = Date()) throws -> [String: Any] {
        let payloadData = try session.syncMessageData()

        return [
            kindKey: kind,
            payloadBase64Key: payloadData.base64EncodedString(),
            localSessionIdKey: session.id.uuidString,
            sentAtKey: sentAt.timeIntervalSince1970
        ]
    }

    static func fileMetadata(
        for artifact: DiveProfileArtifactIdentity,
        sentAt: Date = Date()
    ) -> [String: Any] {
        [
            kindKey: kind,
            formatVersionKey: 1,
            localSessionIdKey: artifact.localSessionId.uuidString,
            contentRevisionKey: artifact.contentRevision,
            sha256Key: artifact.sha256,
            byteCountKey: artifact.byteCount,
            sampleCountKey: artifact.sampleCount,
            sentAtKey: sentAt.timeIntervalSince1970
        ]
    }


    static func artifactIdentity(from metadata: [String: Any], relativePath: String = "") -> DiveProfileArtifactIdentity? {
        guard metadata[kindKey] as? String == kind,
              let sessionString = metadata[localSessionIdKey] as? String,
              let localSessionId = UUID(uuidString: sessionString),
              let contentRevision = metadata[contentRevisionKey] as? String,
              let sha256 = metadata[sha256Key] as? String,
              let byteCount = metadata[byteCountKey] as? Int,
              let sampleCount = metadata[sampleCountKey] as? Int else {
            return nil
        }
        return DiveProfileArtifactIdentity(
            localSessionId: localSessionId,
            contentRevision: contentRevision,
            sha256: sha256,
            byteCount: byteCount,
            sampleCount: sampleCount,
            relativePath: relativePath
        )
    }
}
