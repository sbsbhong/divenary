import Foundation

struct ScubaDiveEngine {
    private let sessionID: UUID
    private let startedAt: Date
    private let gasLabel: String?
    private var samples: [DepthSample] = []
    private var safetyStopController = SafetyStopController()
    private var ascentRateEstimator = DisplayAscentRateEstimator()
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

        samples.append(sample)
        maxDepthMeters = max(maxDepthMeters, sample.depthMeters)
        latestAscentRateMetersPerMinute = ascentRateEstimator.append(sample)
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
        let temperatures = samples.compactMap(\.waterTemperatureCelsius)
        guard !temperatures.isEmpty else { return nil }
        return temperatures.reduce(0, +) / Double(temperatures.count)
    }
}
