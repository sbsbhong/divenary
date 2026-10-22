// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let watchPlannedDive = try WatchPlannedDive(json)

import Foundation

/// A planned dive the watch can start. It carries no account or backend identifiers.
// MARK: - WatchPlannedDive
public struct WatchPlannedDive: Codable {
    public let buddyIds: [String]
    public let diveMode: DiveMode?
    public let entryStyle, gasLabel: String?
    public let gearIds: [String]
    public let localId: String
    public let notes: String?
    /// Seconds since 1970-01-01T00:00:00Z.
    public let plannedAt: Double?
    public let plannedDurationMinutes, plannedMaxDepthMeters: Double?
    public let siteName: String?
    public let tags: [String]
    public let title: String?

    public init(buddyIds: [String], diveMode: DiveMode?, entryStyle: String?, gasLabel: String?, gearIds: [String], localId: String, notes: String?, plannedAt: Double?, plannedDurationMinutes: Double?, plannedMaxDepthMeters: Double?, siteName: String?, tags: [String], title: String?) {
        self.buddyIds = buddyIds
        self.diveMode = diveMode
        self.entryStyle = entryStyle
        self.gasLabel = gasLabel
        self.gearIds = gearIds
        self.localId = localId
        self.notes = notes
        self.plannedAt = plannedAt
        self.plannedDurationMinutes = plannedDurationMinutes
        self.plannedMaxDepthMeters = plannedMaxDepthMeters
        self.siteName = siteName
        self.tags = tags
        self.title = title
    }
}

// MARK: WatchPlannedDive convenience initializers and mutators

public extension WatchPlannedDive {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WatchPlannedDive.self, from: data)
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
        buddyIds: [String]? = nil,
        diveMode: DiveMode?? = nil,
        entryStyle: String?? = nil,
        gasLabel: String?? = nil,
        gearIds: [String]? = nil,
        localId: String? = nil,
        notes: String?? = nil,
        plannedAt: Double?? = nil,
        plannedDurationMinutes: Double?? = nil,
        plannedMaxDepthMeters: Double?? = nil,
        siteName: String?? = nil,
        tags: [String]? = nil,
        title: String?? = nil
    ) -> WatchPlannedDive {
        return WatchPlannedDive(
            buddyIds: buddyIds ?? self.buddyIds,
            diveMode: diveMode ?? self.diveMode,
            entryStyle: entryStyle ?? self.entryStyle,
            gasLabel: gasLabel ?? self.gasLabel,
            gearIds: gearIds ?? self.gearIds,
            localId: localId ?? self.localId,
            notes: notes ?? self.notes,
            plannedAt: plannedAt ?? self.plannedAt,
            plannedDurationMinutes: plannedDurationMinutes ?? self.plannedDurationMinutes,
            plannedMaxDepthMeters: plannedMaxDepthMeters ?? self.plannedMaxDepthMeters,
            siteName: siteName ?? self.siteName,
            tags: tags ?? self.tags,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum DiveMode: String, Codable {
    case freedive = "freedive"
    case scuba = "scuba"
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
