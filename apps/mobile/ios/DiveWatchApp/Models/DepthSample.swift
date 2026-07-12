import Foundation

struct DepthSample: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let depthMeters: Double
    let pressureKPa: Double
    let waterTemperatureCelsius: Double?

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        depthMeters: Double,
        pressureKPa: Double,
        waterTemperatureCelsius: Double?
    ) {
        self.id = id
        self.timestamp = timestamp
        self.depthMeters = depthMeters
        self.pressureKPa = pressureKPa
        self.waterTemperatureCelsius = waterTemperatureCelsius
    }

    var isValidRecordingSample: Bool {
        depthMeters.isFinite
            && pressureKPa.isFinite
            && (waterTemperatureCelsius?.isFinite ?? true)
            && depthMeters >= 0
            && pressureKPa >= 0
    }
}
