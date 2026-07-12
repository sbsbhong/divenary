import Foundation

struct OneHertzProfileSampler {
    private struct Bucket {
        let index: Int
        var lastSample: DepthSample
        var minDepthMeters: Double
        var maxDepthMeters: Double
        var latestMeasuredTemperatureCelsius: Double?

        init(index: Int, sample: DepthSample) {
            self.index = index
            lastSample = sample
            minDepthMeters = sample.depthMeters
            maxDepthMeters = sample.depthMeters
            latestMeasuredTemperatureCelsius = sample.waterTemperatureCelsius
        }

        mutating func append(_ sample: DepthSample) {
            lastSample = sample
            minDepthMeters = min(minDepthMeters, sample.depthMeters)
            maxDepthMeters = max(maxDepthMeters, sample.depthMeters)
            if let measuredTemperature = sample.waterTemperatureCelsius {
                latestMeasuredTemperatureCelsius = measuredTemperature
            }
        }

        func finalizedSample() -> DepthSample {
            DepthSample(
                id: lastSample.id,
                timestamp: lastSample.timestamp,
                depthMeters: lastSample.depthMeters,
                bucketMinDepthMeters: minDepthMeters,
                bucketMaxDepthMeters: maxDepthMeters,
                pressureKPa: lastSample.pressureKPa,
                waterTemperatureCelsius: latestMeasuredTemperatureCelsius
            )
        }
    }

    private let startedAt: Date
    private var currentBucket: Bucket?
    private var lastAcceptedAt: Date?

    init(startedAt: Date) {
        self.startedAt = startedAt
    }

    mutating func append(_ sample: DepthSample) -> DepthSample? {
        guard sample.isValidRecordingSample,
              sample.timestamp >= startedAt,
              lastAcceptedAt.map({ sample.timestamp >= $0 }) ?? true else {
            return nil
        }

        let bucketIndex = Int(floor(sample.timestamp.timeIntervalSince(startedAt)))
        lastAcceptedAt = sample.timestamp

        guard var bucket = currentBucket else {
            currentBucket = Bucket(index: bucketIndex, sample: sample)
            return nil
        }

        if bucket.index == bucketIndex {
            bucket.append(sample)
            currentBucket = bucket
            return nil
        }

        let finalized = bucket.finalizedSample()
        currentBucket = Bucket(index: bucketIndex, sample: sample)
        return finalized
    }

    mutating func finish() -> DepthSample? {
        defer { currentBucket = nil }
        return currentBucket?.finalizedSample()
    }
}
