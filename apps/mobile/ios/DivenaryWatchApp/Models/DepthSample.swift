import Foundation

struct DepthSample: Codable, Equatable, Identifiable {
    let id: UUID
    let timestamp: Date
    let depthMeters: Double
    let bucketMinDepthMeters: Double?
    let bucketMaxDepthMeters: Double?
    let pressureKPa: Double
    let waterTemperatureCelsius: Double?

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        depthMeters: Double,
        bucketMinDepthMeters: Double? = nil,
        bucketMaxDepthMeters: Double? = nil,
        pressureKPa: Double,
        waterTemperatureCelsius: Double?
    ) {
        self.id = id
        self.timestamp = timestamp
        self.depthMeters = depthMeters
        self.bucketMinDepthMeters = bucketMinDepthMeters
        self.bucketMaxDepthMeters = bucketMaxDepthMeters
        self.pressureKPa = pressureKPa
        self.waterTemperatureCelsius = waterTemperatureCelsius
    }

    var isValidRecordingSample: Bool {
        depthMeters.isFinite
            && pressureKPa.isFinite
            && (waterTemperatureCelsius?.isFinite ?? true)
            && (bucketMinDepthMeters?.isFinite ?? true)
            && (bucketMaxDepthMeters?.isFinite ?? true)
            && depthMeters >= 0
            && pressureKPa >= 0
            && (bucketMinDepthMeters.map { $0 >= 0 && $0 <= depthMeters } ?? true)
            && (bucketMaxDepthMeters.map { $0 >= depthMeters } ?? true)
            && validBucketRange
    }

    private var validBucketRange: Bool {
        guard let bucketMinDepthMeters, let bucketMaxDepthMeters else {
            return true
        }
        return bucketMinDepthMeters <= bucketMaxDepthMeters
    }
}
