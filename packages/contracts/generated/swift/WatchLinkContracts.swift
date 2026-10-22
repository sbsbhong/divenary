// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let watchLinkMessage = try WatchLinkMessage(json)

import Foundation

/// Control messages between the phone and its companion watch. Every message is a flat
/// object of string keys and JSON values, so any phone-watch transport can carry it.
///
/// Watch to phone. Metadata sent with the session file; the file holds one WatchSyncMessage
/// and its bytes are delivered unchanged.
///
/// Phone to watch. The session file with this identity is stored in the phone's local
/// logbook; it says nothing about cloud upload.
///
/// Phone to watch, latest value only. plannedDivesJson is a JSON array of WatchPlannedDive
/// (watch-planned-dive.schema.json).
///
/// Phone to watch, queued. Delete one saved session; the revision and artifact digest are
/// sent together or not at all.
///
/// Watch to phone, queued. The session is gone from the watch, or was never there.
// MARK: - WatchLinkMessage
public struct WatchLinkMessage: Codable {
    public let byteCount: Int?
    public let contentRevision: String?
    public let formatVersion: Int?
    public let kind: Kind
    public let localSessionId: String?
    public let sampleCount: Int?
    public let sentAt: Double?
    public let sha256: String?
    public let acknowledgedAt: Double?
    public let plannedDivesJson: String?
    public let updatedAt: Double?
    public let artifactSha256, commandId: String?
    public let requestedAt: Double?
    public let removedArtifactSha256: String?
    public let removedContentRevision: String?
    public let result: Result?

    public init(byteCount: Int?, contentRevision: String?, formatVersion: Int?, kind: Kind, localSessionId: String?, sampleCount: Int?, sentAt: Double?, sha256: String?, acknowledgedAt: Double?, plannedDivesJson: String?, updatedAt: Double?, artifactSha256: String?, commandId: String?, requestedAt: Double?, removedArtifactSha256: String?, removedContentRevision: String?, result: Result?) {
        self.byteCount = byteCount
        self.contentRevision = contentRevision
        self.formatVersion = formatVersion
        self.kind = kind
        self.localSessionId = localSessionId
        self.sampleCount = sampleCount
        self.sentAt = sentAt
        self.sha256 = sha256
        self.acknowledgedAt = acknowledgedAt
        self.plannedDivesJson = plannedDivesJson
        self.updatedAt = updatedAt
        self.artifactSha256 = artifactSha256
        self.commandId = commandId
        self.requestedAt = requestedAt
        self.removedArtifactSha256 = removedArtifactSha256
        self.removedContentRevision = removedContentRevision
        self.result = result
    }
}

// MARK: WatchLinkMessage convenience initializers and mutators

public extension WatchLinkMessage {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchLinkMessage.self, from: data)
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
        byteCount: Int?? = nil,
        contentRevision: String?? = nil,
        formatVersion: Int?? = nil,
        kind: Kind? = nil,
        localSessionId: String?? = nil,
        sampleCount: Int?? = nil,
        sentAt: Double?? = nil,
        sha256: String?? = nil,
        acknowledgedAt: Double?? = nil,
        plannedDivesJson: String?? = nil,
        updatedAt: Double?? = nil,
        artifactSha256: String?? = nil,
        commandId: String?? = nil,
        requestedAt: Double?? = nil,
        removedArtifactSha256: String?? = nil,
        removedContentRevision: String?? = nil,
        result: Result?? = nil
    ) -> WatchLinkMessage {
        return WatchLinkMessage(
            byteCount: byteCount ?? self.byteCount,
            contentRevision: contentRevision ?? self.contentRevision,
            formatVersion: formatVersion ?? self.formatVersion,
            kind: kind ?? self.kind,
            localSessionId: localSessionId ?? self.localSessionId,
            sampleCount: sampleCount ?? self.sampleCount,
            sentAt: sentAt ?? self.sentAt,
            sha256: sha256 ?? self.sha256,
            acknowledgedAt: acknowledgedAt ?? self.acknowledgedAt,
            plannedDivesJson: plannedDivesJson ?? self.plannedDivesJson,
            updatedAt: updatedAt ?? self.updatedAt,
            artifactSha256: artifactSha256 ?? self.artifactSha256,
            commandId: commandId ?? self.commandId,
            requestedAt: requestedAt ?? self.requestedAt,
            removedArtifactSha256: removedArtifactSha256 ?? self.removedArtifactSha256,
            removedContentRevision: removedContentRevision ?? self.removedContentRevision,
            result: result ?? self.result
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Kind: String, Codable {
    case watchPlannedDives = "watchPlannedDives"
    case watchSessionDeletionAcknowledgement = "watchSessionDeletionAcknowledgement"
    case watchSessionDeletionCommand = "watchSessionDeletionCommand"
    case watchSyncAcknowledgement = "watchSyncAcknowledgement"
    case watchSyncMessage = "watchSyncMessage"
}

public enum Result: String, Codable {
    case alreadyAbsent = "alreadyAbsent"
    case deleted = "deleted"
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
