import CoreMotion
import Foundation

final class RealDepthSensorProvider: NSObject, DepthSensorProvider, CMWaterSubmersionManagerDelegate {
    var onSample: ((DepthSample) -> Void)?

    private let manager = CMWaterSubmersionManager()
    private var latestTemperatureCelsius: Double?

    func start() {
        guard CMWaterSubmersionManager.waterSubmersionAvailable else {
            return
        }

        manager.delegate = self
    }

    func stop() {
        manager.delegate = nil
    }

    func manager(_ manager: CMWaterSubmersionManager, didUpdate event: CMWaterSubmersionEvent) {
        _ = event
    }

    func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterSubmersionMeasurement) {
        guard measurement.submersionState != .sensorDepthError,
              let depth = measurement.depth?.converted(to: .meters).value,
              let pressure = measurement.pressure?.converted(to: .kilopascals).value,
              depth.isFinite,
              pressure.isFinite,
              depth >= 0
        else {
            return
        }

        onSample?(
            DepthSample(
                timestamp: measurement.date,
                depthMeters: depth,
                pressureKPa: pressure,
                waterTemperatureCelsius: latestTemperatureCelsius
            )
        )
    }

    func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterTemperature) {
        let temperature = measurement.temperature.converted(to: .celsius).value
        guard temperature.isFinite else {
            return
        }

        latestTemperatureCelsius = temperature
    }

    func manager(_ manager: CMWaterSubmersionManager, errorOccurred error: Error) {
        _ = error
    }
}
