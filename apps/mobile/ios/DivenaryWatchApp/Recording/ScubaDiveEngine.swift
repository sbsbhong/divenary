import Foundation

struct ScubaDiveEngine {
    private let sessionID: UUID
    private let startedAt: Date
    private let gasLabel: String?
    private var currentDepth: Double = 0
    private var sampleCount = 0
    private var lastSampleAt: Date?
    private var longestSampleGapSeconds: TimeInterval = 0
    private var depthSum: Double = 0
    private var temperatureCount = 0
    private var temperatureSum: Double = 0
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
        currentDepth
    }

    var safetyStopRecord: SafetyStopRecord {
        safetyStopController.record
    }

    mutating func append(_ sample: DepthSample) {
        guard sample.isValidRecordingSample else {
            return
        }

        longestSampleGapSeconds = max(longestSampleGapSeconds,
            sample.timestamp.timeIntervalSince(lastSampleAt ?? startedAt))
        lastSampleAt = sample.timestamp
        currentDepth = sample.depthMeters
        sampleCount += 1
        depthSum += sample.depthMeters
        if let temperature = sample.waterTemperatureCelsius {
            temperatureCount += 1
            temperatureSum += temperature
        }
        maxDepthMeters = max(maxDepthMeters, sample.depthMeters)
        latestAscentRateMetersPerMinute = ascentRateEstimator.append(sample)
        maxAscentRateMetersPerMinute = max(maxAscentRateMetersPerMinute, latestAscentRateMetersPerMinute)
        safetyStopController.update(maxDepthMeters: maxDepthMeters, sample: sample)
    }

    mutating func finish(at date: Date) -> ScubaDiveSession {
        let coverageIsUnreliable = lastSampleAt == nil || max(longestSampleGapSeconds,
            date.timeIntervalSince(lastSampleAt ?? startedAt)) > 30
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
            safetyStop: coverageIsUnreliable
                ? safetyStopController.record.withUnknownCoverage
                : safetyStopController.record
        )
    }

    // Running sums add samples in arrival order, so the averages match summing a stored array.
    private var averageDepth: Double {
        guard sampleCount > 0 else { return 0 }
        return depthSum / Double(sampleCount)
    }

    private var averageTemperature: Double? {
        guard temperatureCount > 0 else { return nil }
        return temperatureSum / Double(temperatureCount)
    }
}
