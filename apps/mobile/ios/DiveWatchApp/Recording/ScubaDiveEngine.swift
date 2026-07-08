import Foundation

struct ScubaDiveEngine {
    private let sessionID: UUID
    private let startedAt: Date
    private let gasLabel: String?
    private var samples: [DepthSample] = []
    private var safetyStopController = SafetyStopController()
    private var maxDepthMeters: Double = 0
    private var latestAscentRateMetersPerMinute: Double = 0
    private var maxAscentRateMetersPerMinute: Double = 0

    init(startedAt: Date, gasLabel: String?, sessionID: UUID = UUID()) {
        self.sessionID = sessionID
        self.startedAt = startedAt
        self.gasLabel = gasLabel
    }

    var currentDepthMeters: Double {
        samples.last?.depthMeters ?? 0
    }

    var safetyStopRecord: SafetyStopRecord {
        safetyStopController.record
    }

    mutating func append(_ sample: DepthSample) {
        guard sample.isValidRecordingSample else {
            return
        }

        let previous = samples.last
        samples.append(sample)
        maxDepthMeters = max(maxDepthMeters, sample.depthMeters)
        latestAscentRateMetersPerMinute = Self.ascentRate(from: previous, to: sample)
        maxAscentRateMetersPerMinute = max(maxAscentRateMetersPerMinute, latestAscentRateMetersPerMinute)
        safetyStopController.update(maxDepthMeters: maxDepthMeters, sample: sample)
    }

    mutating func finish(at date: Date) -> ScubaDiveSession {
        if currentDepthMeters <= 0.8 {
            safetyStopController.markSurfaced(at: date)
        }

        return ScubaDiveSession(
            id: sessionID,
            startTime: startedAt,
            endTime: date,
            durationSeconds: max(0, date.timeIntervalSince(startedAt)),
            maxDepthMeters: maxDepthMeters,
            averageDepthMeters: averageDepth,
            waterTemperatureCelsius: averageTemperature,
            gasLabel: gasLabel,
            latestAscentRateMetersPerMinute: latestAscentRateMetersPerMinute,
            maxAscentRateMetersPerMinute: maxAscentRateMetersPerMinute,
            safetyStop: safetyStopController.record
        )
    }

    private var averageDepth: Double {
        guard !samples.isEmpty else { return 0 }
        return samples.reduce(0) { $0 + $1.depthMeters } / Double(samples.count)
    }

    private var averageTemperature: Double? {
        guard !samples.isEmpty else { return nil }
        return samples.reduce(0) { $0 + $1.waterTemperatureCelsius } / Double(samples.count)
    }

    private static func ascentRate(from previous: DepthSample?, to current: DepthSample) -> Double {
        guard let previous else { return 0 }
        let elapsed = current.timestamp.timeIntervalSince(previous.timestamp)
        guard elapsed > 0, current.depthMeters < previous.depthMeters else { return 0 }
        return (previous.depthMeters - current.depthMeters) / elapsed * 60
    }
}
