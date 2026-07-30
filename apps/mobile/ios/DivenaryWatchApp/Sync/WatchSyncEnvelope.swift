import Foundation

enum WatchSyncEnvelope {
    static let kind = "watchSyncMessage"
    static let acknowledgementKind = "watchSyncAcknowledgement"
    static let sessionDeletionCommandKind = "watchSessionDeletionCommand"
    static let sessionDeletionAcknowledgementKind = "watchSessionDeletionAcknowledgement"
    static let plannedDivesKind = "watchPlannedDives"
    static let kindKey = "kind"
    static let commandIdKey = "commandId"
    static let payloadBase64Key = "payloadBase64"
    static let localSessionIdKey = "localSessionId"
    static let sentAtKey = "sentAt"
    static let requestedAtKey = "requestedAt"
    static let acknowledgedAtKey = "acknowledgedAt"
    static let plannedDivesJsonKey = "plannedDivesJson"
    static let contentRevisionKey = "contentRevision"
    static let artifactSha256Key = "artifactSha256"
    static let sha256Key = "sha256"
    static let byteCountKey = "byteCount"
    static let sampleCountKey = "sampleCount"
    static let formatVersionKey = "formatVersion"
    static let resultKey = "result"
    static let removedContentRevisionKey = "removedContentRevision"
    static let removedArtifactSha256Key = "removedArtifactSha256"

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

struct WatchSessionDeletionCommand: Equatable {
    let formatVersion: Int
    let commandId: String
    let localSessionId: UUID
    let requestedAt: Date
    let contentRevision: String?
    let artifactSha256: String?

    init?(dictionary: [String: Any]) {
        let allowedKeys = Set([
            WatchSyncEnvelope.kindKey,
            WatchSyncEnvelope.formatVersionKey,
            WatchSyncEnvelope.commandIdKey,
            WatchSyncEnvelope.localSessionIdKey,
            WatchSyncEnvelope.requestedAtKey,
            WatchSyncEnvelope.contentRevisionKey,
            WatchSyncEnvelope.artifactSha256Key,
        ])
        guard Set(dictionary.keys).isSubset(of: allowedKeys),
              dictionary[WatchSyncEnvelope.kindKey] as? String
                == WatchSyncEnvelope.sessionDeletionCommandKind,
              dictionary[WatchSyncEnvelope.formatVersionKey] as? Int == 1,
              let commandId = dictionary[WatchSyncEnvelope.commandIdKey] as? String,
              Self.isSHA256(commandId),
              let localSessionIdString =
                dictionary[WatchSyncEnvelope.localSessionIdKey] as? String,
              let localSessionId = UUID(uuidString: localSessionIdString),
              let requestedAtNumber =
                dictionary[WatchSyncEnvelope.requestedAtKey] as? NSNumber,
              CFGetTypeID(requestedAtNumber) != CFBooleanGetTypeID(),
              requestedAtNumber.doubleValue.isFinite,
              requestedAtNumber.doubleValue >= 0 else {
            return nil
        }
        let contentRevision =
            dictionary[WatchSyncEnvelope.contentRevisionKey] as? String
        let artifactSha256 =
            dictionary[WatchSyncEnvelope.artifactSha256Key] as? String
        guard (contentRevision == nil) == (artifactSha256 == nil),
              contentRevision.map({ !$0.isEmpty && $0.count <= 512 }) ?? true,
              artifactSha256.map(Self.isSHA256) ?? true else {
            return nil
        }

        formatVersion = 1
        self.commandId = commandId
        self.localSessionId = localSessionId
        requestedAt = Date(timeIntervalSince1970: requestedAtNumber.doubleValue)
        self.contentRevision = contentRevision
        self.artifactSha256 = artifactSha256
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.range(
            of: "^[0-9a-f]{64}$",
            options: .regularExpression
        ) != nil
    }
}

enum WatchSessionDeletionOutcome: String {
    case deleted
    case alreadyAbsent
}

struct WatchSessionDeletionResult: Equatable {
    let commandId: String
    let localSessionId: UUID
    let acknowledgedAt: Date
    let outcome: WatchSessionDeletionOutcome
    let removedContentRevision: String?
    let removedArtifactSha256: String?

    var dictionary: [String: Any] {
        var value: [String: Any] = [
            WatchSyncEnvelope.kindKey:
                WatchSyncEnvelope.sessionDeletionAcknowledgementKind,
            WatchSyncEnvelope.formatVersionKey: 1,
            WatchSyncEnvelope.commandIdKey: commandId,
            WatchSyncEnvelope.localSessionIdKey: localSessionId.uuidString,
            WatchSyncEnvelope.acknowledgedAtKey:
                acknowledgedAt.timeIntervalSince1970,
            WatchSyncEnvelope.resultKey: outcome.rawValue,
        ]
        if let removedContentRevision, let removedArtifactSha256 {
            value[WatchSyncEnvelope.removedContentRevisionKey] =
                removedContentRevision
            value[WatchSyncEnvelope.removedArtifactSha256Key] =
                removedArtifactSha256
        }
        return value
    }
}
