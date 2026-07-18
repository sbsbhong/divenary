import Foundation

struct DisplayAscentRateEstimator {
    private let minimumWindowDuration: TimeInterval
    private let maximumWindowDuration: TimeInterval
    private let depthDeadbandMeters: Double
    private var samples: [DepthSample] = []

    init(
        minimumWindowDuration: TimeInterval = 3,
        maximumWindowDuration: TimeInterval = 5,
        depthDeadbandMeters: Double = 0.15
    ) {
        precondition(minimumWindowDuration.isFinite && minimumWindowDuration > 0)
        precondition(maximumWindowDuration.isFinite && maximumWindowDuration >= minimumWindowDuration)
        precondition(depthDeadbandMeters.isFinite && depthDeadbandMeters >= 0)

        self.minimumWindowDuration = minimumWindowDuration
        self.maximumWindowDuration = maximumWindowDuration
        self.depthDeadbandMeters = depthDeadbandMeters
    }

    mutating func append(_ sample: DepthSample) -> Double {
        guard isUsable(sample), isStrictlyNewer(sample) else {
            return 0
        }

        samples.append(sample)
        prune(relativeTo: sample.timestamp)

        guard let oldest = samples.first else {
            return 0
        }

        return rate(from: oldest, to: sample)
    }

    mutating func reset() {
        samples.removeAll(keepingCapacity: true)
    }

    private func isUsable(_ sample: DepthSample) -> Bool {
        sample.isValidRecordingSample
            && sample.timestamp.timeIntervalSinceReferenceDate.isFinite
    }

    private func isStrictlyNewer(_ sample: DepthSample) -> Bool {
        guard let last = samples.last else {
            return true
        }

        let elapsed = sample.timestamp.timeIntervalSince(last.timestamp)
        return elapsed.isFinite && elapsed > 0
    }

    private mutating func prune(relativeTo newestTimestamp: Date) {
        let cutoff = newestTimestamp.addingTimeInterval(-maximumWindowDuration)
        samples.removeAll { $0.timestamp < cutoff }
    }

    private func rate(from oldest: DepthSample, to newest: DepthSample) -> Double {
        let elapsed = newest.timestamp.timeIntervalSince(oldest.timestamp)
        let netDepthDecrease = oldest.depthMeters - newest.depthMeters

        guard elapsed.isFinite,
              elapsed >= minimumWindowDuration,
              netDepthDecrease.isFinite,
              exceedsDeadbandIgnoringULPNoise(netDepthDecrease) else {
            return 0
        }

        let rate = netDepthDecrease / elapsed * 60
        return rate.isFinite && rate > 0 ? rate : 0
    }

    private func exceedsDeadbandIgnoringULPNoise(_ netDepthDecrease: Double) -> Bool {
        let comparisonTolerance = max(depthDeadbandMeters.ulp, netDepthDecrease.ulp) * 16
        return netDepthDecrease > depthDeadbandMeters + comparisonTolerance
    }
}
