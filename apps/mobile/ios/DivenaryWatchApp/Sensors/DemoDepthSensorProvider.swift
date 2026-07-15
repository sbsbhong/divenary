import Foundation

final class DemoDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?

    private var timer: Timer?
    private var elapsedSeconds: TimeInterval = 0
    private var controlledDepthMeters: Double = 0

    private let sampleIntervalSeconds: TimeInterval = 1
    private let maximumControlledDepthMeters: Double = 60
    private let surfacePressureKPa: Double = 101.325
    private let pressureIncreasePerMeterKPa: Double = 9.80665

    func setDepthMeters(_ depthMeters: Double) {
        controlledDepthMeters = sanitizedDepth(depthMeters)

        if timer != nil {
            emitSample()
        }
    }

    func start() {
        guard timer == nil else { return }

        elapsedSeconds = 0
        emitSample()

        timer = Timer.scheduledTimer(withTimeInterval: sampleIntervalSeconds, repeats: true) { [weak self] _ in
            self?.elapsedSeconds += self?.sampleIntervalSeconds ?? 1
            self?.emitSample()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func emitSample() {
        let phase = elapsedSeconds / max(sampleIntervalSeconds, 1)
        let depthMeters = controlledDepthMeters
        let pressureKPa = surfacePressureKPa + depthMeters * pressureIncreasePerMeterKPa
        let waterTemperatureCelsius = max(21.0, min(26.0, 25.2 - depthMeters * 0.05 + sin(phase * 0.3) * 0.12))

        onSample?(
            DepthSample(
                depthMeters: depthMeters,
                pressureKPa: pressureKPa,
                waterTemperatureCelsius: waterTemperatureCelsius
            )
        )
    }

    private func sanitizedDepth(_ depthMeters: Double) -> Double {
        guard depthMeters.isFinite else {
            return 0
        }

        return min(max(0, depthMeters), maximumControlledDepthMeters)
    }
}
