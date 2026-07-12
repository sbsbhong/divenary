import Foundation

struct DiveSessionSummary: Codable {
    let durationSeconds: TimeInterval
    let maxDepthMeters: Double
    let averageDepthMeters: Double
    let averageWaterTemperatureCelsius: Double?
    let sampleCount: Int
    let latestAscentRateMetersPerMinute: Double
    let maxAscentRateMetersPerMinute: Double

    init(session: DiveSession) {
        let endedAt = session.endedAt ?? Date()
        let durationSeconds = max(0, endedAt.timeIntervalSince(session.startedAt))
        let sampleCount = session.samples.count
        let maxDepthMeters = session.samples.map(\.depthMeters).max() ?? 0
        let averageDepthMeters = sampleCount == 0
            ? 0
            : session.samples.reduce(0) { $0 + $1.depthMeters } / Double(sampleCount)
        let temperatures = session.samples.compactMap(\.waterTemperatureCelsius)
        let averageWaterTemperatureCelsius = temperatures.isEmpty
            ? nil
            : temperatures.reduce(0, +) / Double(temperatures.count)

        self.durationSeconds = durationSeconds
        self.maxDepthMeters = maxDepthMeters
        self.averageDepthMeters = averageDepthMeters
        self.averageWaterTemperatureCelsius = averageWaterTemperatureCelsius
        self.sampleCount = sampleCount
        self.latestAscentRateMetersPerMinute = DiveSessionSummary.ascentRate(
            from: session.samples.dropLast().last,
            to: session.samples.last
        )
        self.maxAscentRateMetersPerMinute = session.samples.indices.dropFirst().reduce(0) { maxRate, index in
            max(maxRate, DiveSessionSummary.ascentRate(from: session.samples[index - 1], to: session.samples[index]))
        }
    }

    init(record: DiveSessionRecord) {
        let sampleCount = record.samples.count
        let sampleMaxDepthMeters = record.samples.map(\.depthMeters).max() ?? 0
        let averageDepthMeters = sampleCount == 0
            ? 0
            : record.samples.reduce(0) { $0 + $1.depthMeters } / Double(sampleCount)
        let temperatures = record.samples.compactMap(\.waterTemperatureCelsius)
        let averageWaterTemperatureCelsius = temperatures.isEmpty
            ? nil
            : temperatures.reduce(0, +) / Double(temperatures.count)
        let latestAscentRateMetersPerMinute = DiveSessionSummary.ascentRate(
            from: record.samples.dropLast().last,
            to: record.samples.last
        )
        let maxAscentRateMetersPerMinute = record.samples.indices.dropFirst().reduce(0) { maxRate, index in
            max(maxRate, DiveSessionSummary.ascentRate(from: record.samples[index - 1], to: record.samples[index]))
        }

        switch record.payload {
        case .freedive(let session):
            self.durationSeconds = session.totalDurationSeconds
            self.maxDepthMeters = max(session.maxDepthMeters, sampleMaxDepthMeters)
            self.averageDepthMeters = averageDepthMeters
            self.averageWaterTemperatureCelsius = averageWaterTemperatureCelsius
            self.sampleCount = sampleCount
            self.latestAscentRateMetersPerMinute = latestAscentRateMetersPerMinute
            self.maxAscentRateMetersPerMinute = maxAscentRateMetersPerMinute
        case .scuba(let session):
            self.durationSeconds = session.durationSeconds
            self.maxDepthMeters = max(session.maxDepthMeters, sampleMaxDepthMeters)
            self.averageDepthMeters = session.averageDepthMeters
            self.averageWaterTemperatureCelsius = session.waterTemperatureCelsius
            self.sampleCount = sampleCount
            self.latestAscentRateMetersPerMinute = session.latestAscentRateMetersPerMinute
            self.maxAscentRateMetersPerMinute = session.maxAscentRateMetersPerMinute
        }
    }

    private static func ascentRate(from previous: DepthSample?, to current: DepthSample?) -> Double {
        guard let previous, let current else { return 0 }
        let elapsed = current.timestamp.timeIntervalSince(previous.timestamp)
        guard elapsed > 0, current.depthMeters < previous.depthMeters else { return 0 }
        return (previous.depthMeters - current.depthMeters) / elapsed * 60
    }
}

extension DiveSessionRecord {
    var summary: DiveSessionSummary {
        DiveSessionSummary(record: self)
    }

    var gasLabel: String? {
        guard case .scuba(let session) = payload else {
            return nil
        }

        return session.gasLabel
    }

    func applyingPostDive(
        rating: Int?,
        perceivedExertion: Int?,
        visibilityRating: Int?,
        waterCondition: WaterCondition,
        notes: String?
    ) -> DiveSessionRecord {
        DiveSessionRecord(
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
            syncStatus: .pending,
            entryLocation: entryLocation,
            exitLocation: exitLocation,
            startedAt: startedAt,
            endedAt: endedAt,
            samples: samples,
            payload: payload,
            unsupportedDepth: unsupportedDepth
        )
    }

    func withSyncStatus(_ nextSyncStatus: DiveSyncStatus) -> DiveSessionRecord {
        DiveSessionRecord(
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
            syncStatus: nextSyncStatus,
            entryLocation: entryLocation,
            exitLocation: exitLocation,
            startedAt: startedAt,
            endedAt: endedAt,
            samples: samples,
            payload: payload,
            unsupportedDepth: unsupportedDepth
        )
    }
}
