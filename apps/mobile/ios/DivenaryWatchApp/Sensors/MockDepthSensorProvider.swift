import Foundation

final class MockDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?

    private var timer: Timer?
    private var elapsedSeconds: TimeInterval = 0

    private let sampleIntervalSeconds: TimeInterval = 1
    private let cycleDurationSeconds: TimeInterval = 120
    private let maxDepthMeters: Double = 13.5
    private let surfacePressureKPa: Double = 101.325
    private let pressureIncreasePerMeterKPa: Double = 9.80665

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
        let phase = (elapsedSeconds.truncatingRemainder(dividingBy: cycleDurationSeconds)) / cycleDurationSeconds
        let depthMeters = depth(for: phase)
        let pressureKPa = surfacePressureKPa + depthMeters * pressureIncreasePerMeterKPa
        let waterTemperatureCelsius = max(23.0, min(25.0, 24.6 - depthMeters * 0.08 + sin(phase * 2 * .pi) * 0.15))

        onSample?(
            DepthSample(
                depthMeters: depthMeters,
                pressureKPa: pressureKPa,
                waterTemperatureCelsius: waterTemperatureCelsius
            )
        )
    }

    private func depth(for phase: Double) -> Double {
        if phase < 0.35 {
            return maxDepthMeters * easeInOut(phase / 0.35)
        }

        if phase < 0.65 {
            let holdPhase = (phase - 0.35) / 0.30
            return maxDepthMeters + sin(holdPhase * 2 * .pi) * 0.35
        }

        return maxDepthMeters * (1 - easeInOut((phase - 0.65) / 0.35))
    }

    private func easeInOut(_ value: Double) -> Double {
        let clamped = max(0, min(1, value))
        return 0.5 - 0.5 * cos(clamped * .pi)
    }
}
