import Foundation

enum DiveMode: String, Codable, CaseIterable, Identifiable {
    case scuba
    case freedive

    var id: String { rawValue }

    var label: String {
        switch self {
        case .scuba:
            return String(localized: "Scuba")
        case .freedive:
            return String(localized: "Freedive")
        }
    }

    static func defaultingRemovedDiveModeToScuba(_ rawValue: String?) -> DiveMode {
        guard let rawValue, let diveMode = DiveMode(rawValue: rawValue) else {
            return .scuba
        }

        return diveMode
    }
}

enum WaterCondition: String, Codable, CaseIterable, Identifiable {
    case calm
    case mild
    case choppy
    case surge
    case current
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .calm:
            return String(localized: "Calm")
        case .mild:
            return String(localized: "Mild")
        case .choppy:
            return String(localized: "Choppy")
        case .surge:
            return String(localized: "Surge")
        case .current:
            return String(localized: "Current")
        case .unknown:
            return String(localized: "Unknown")
        }
    }
}

enum DiveSyncStatus: String, Codable {
    case pending
    case synced
    case failed

    var label: String {
        switch self {
        case .pending:
            return String(localized: "Pending sync")
        case .synced:
            return String(localized: "Synced")
        case .failed:
            return String(localized: "Sync failed")
        }
    }
}

struct WatchLocation: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let horizontalAccuracyMeters: Double?
    let capturedAt: Date?
}

struct PreDivePlan: Codable, Equatable {
    var sourcePlanLocalId: String?
    var title: String = ""
    var diveMode: DiveMode = .scuba
    var gasLabel: String = String(localized: "Air")
    var siteName: String = ""
    var buddyName: String = ""
    var gearIds: [String] = []
    var userTags: [String] = []
    var quickNote: String = ""
    var plannedMaxDepthMeters: Double = 18
    var plannedDurationMinutes: Double?

    var buddyIds: [String] {
        normalizedToken(from: buddyName).map { [$0] } ?? []
    }

    var tags: [String] {
        var values = ["watch-capture"]
        values.append(contentsOf: userTags)
        if let sourcePlanLocalId {
            values.append("plan-\(sourcePlanLocalId)")
        }
        if plannedMaxDepthMeters > 0 {
            values.append("planned-\(Int(plannedMaxDepthMeters))m")
        }
        return values
    }

    private func normalizedToken(from value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed.lowercased().replacingOccurrences(of: " ", with: "-")
    }
}

struct WatchPlannedDive: Codable, Identifiable, Equatable {
    let localId: String
    let title: String?
    let siteName: String?
    let diveMode: DiveMode?
    let entryStyle: String?
    let plannedAt: TimeInterval?
    let plannedMaxDepthMeters: Double?
    let plannedDurationMinutes: Double?
    let gasLabel: String?
    let buddyIds: [String]
    let gearIds: [String]?
    let tags: [String]
    let notes: String?

    var id: String { localId }

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }

        if let siteName, !siteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return siteName
        }

        return String(localized: "Planned dive")
    }

    var preDivePlan: PreDivePlan {
        PreDivePlan(
            sourcePlanLocalId: localId,
            title: title ?? "",
            diveMode: diveMode ?? .scuba,
            gasLabel: gasLabel ?? String(localized: "Air"),
            siteName: siteName ?? "",
            buddyName: buddyIds.joined(separator: ", "),
            gearIds: gearIds ?? [],
            userTags: tags,
            quickNote: notes ?? "",
            plannedMaxDepthMeters: plannedMaxDepthMeters ?? 18,
            plannedDurationMinutes: plannedDurationMinutes
        )
    }
}

struct DiveSession: Codable, Identifiable {
    let id: UUID
    let schemaVersion: Int
    let diveMode: DiveMode
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
    let waterCondition: WaterCondition
    let syncStatus: DiveSyncStatus
    let entryLocation: WatchLocation?
    let exitLocation: WatchLocation?
    let startedAt: Date
    let endedAt: Date?
    let samples: [DepthSample]

    var summary: DiveSessionSummary {
        DiveSessionSummary(session: self)
    }

    init(
        id: UUID = UUID(),
        schemaVersion: Int = 1,
        diveMode: DiveMode = .scuba,
        gasLabel: String? = nil,
        siteId: String? = nil,
        siteName: String? = nil,
        sourcePlanLocalId: String? = nil,
        planTitle: String? = nil,
        buddyIds: [String] = [],
        gearIds: [String] = [],
        tags: [String] = [],
        notes: String? = nil,
        rating: Int? = nil,
        perceivedExertion: Int? = nil,
        visibilityRating: Int? = nil,
        waterCondition: WaterCondition = .unknown,
        syncStatus: DiveSyncStatus = .pending,
        entryLocation: WatchLocation? = nil,
        exitLocation: WatchLocation? = nil,
        startedAt: Date,
        endedAt: Date?,
        samples: [DepthSample]
    ) {
        self.id = id
        self.schemaVersion = schemaVersion
        self.diveMode = diveMode
        self.gasLabel = gasLabel
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
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        diveMode = DiveMode.defaultingRemovedDiveModeToScuba(try container.decodeIfPresent(String.self, forKey: .diveMode))
        gasLabel = try container.decodeIfPresent(String.self, forKey: .gasLabel)
        siteId = try container.decodeIfPresent(String.self, forKey: .siteId)
        siteName = try container.decodeIfPresent(String.self, forKey: .siteName)
        sourcePlanLocalId = try container.decodeIfPresent(String.self, forKey: .sourcePlanLocalId)
        planTitle = try container.decodeIfPresent(String.self, forKey: .planTitle)
        buddyIds = try container.decodeIfPresent([String].self, forKey: .buddyIds) ?? []
        gearIds = try container.decodeIfPresent([String].self, forKey: .gearIds) ?? []
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        rating = try container.decodeIfPresent(Int.self, forKey: .rating)
        perceivedExertion = try container.decodeIfPresent(Int.self, forKey: .perceivedExertion)
        visibilityRating = try container.decodeIfPresent(Int.self, forKey: .visibilityRating)
        waterCondition = try container.decodeIfPresent(WaterCondition.self, forKey: .waterCondition) ?? .unknown
        syncStatus = try container.decodeIfPresent(DiveSyncStatus.self, forKey: .syncStatus) ?? .pending
        entryLocation = try container.decodeIfPresent(WatchLocation.self, forKey: .entryLocation)
        exitLocation = try container.decodeIfPresent(WatchLocation.self, forKey: .exitLocation)
        startedAt = try container.decode(Date.self, forKey: .startedAt)
        endedAt = try container.decodeIfPresent(Date.self, forKey: .endedAt)
        samples = try container.decodeIfPresent([DepthSample].self, forKey: .samples) ?? []
    }

    func applyingPostDive(
        rating: Int?,
        perceivedExertion: Int?,
        visibilityRating: Int?,
        waterCondition: WaterCondition,
        notes: String?
    ) -> DiveSession {
        DiveSession(
            id: id,
            schemaVersion: schemaVersion,
            diveMode: diveMode,
            gasLabel: gasLabel,
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
            syncStatus: .pending,
            entryLocation: entryLocation,
            exitLocation: exitLocation,
            startedAt: startedAt,
            endedAt: endedAt,
            samples: samples
        )
    }

    func withSyncStatus(_ nextSyncStatus: DiveSyncStatus) -> DiveSession {
        DiveSession(
            id: id,
            schemaVersion: schemaVersion,
            diveMode: diveMode,
            gasLabel: gasLabel,
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
            syncStatus: nextSyncStatus,
            entryLocation: entryLocation,
            exitLocation: exitLocation,
            startedAt: startedAt,
            endedAt: endedAt,
            samples: samples
        )
    }

    func syncMessageData(type: String = "sessionEnded") throws -> Data {
        let message = WatchSyncMessagePayload(type: type, session: WatchSessionPayload(session: self))
        return try JSONEncoder().encode(message)
    }
}

private struct WatchSyncMessagePayload: Encodable {
    let type: String
    let session: WatchSessionPayload
}

private struct WatchSessionPayload: Encodable {
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
    let samples: [WatchDepthSamplePayload]

    init(session: DiveSession) {
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
        samples = session.samples.map { WatchDepthSamplePayload(sessionId: session.id.uuidString, sample: $0) }
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

private struct WatchDepthSamplePayload: Encodable {
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
