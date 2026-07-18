import Combine
import CoreMotion
import Foundation

enum WaterSubmersionState: Equatable {
    case unknown
    case notSubmerged
    case submerged
}

enum WaterDepthState: Equatable {
    case unknown
    case notSubmerged
    case submergedShallow
    case submergedDeep
    case approachingMaxDepth
    case pastMaxDepth
    case sensorDepthError
}

@MainActor
protocol WaterSubmersionStateReading: AnyObject {
    var latestState: WaterSubmersionState { get }
}

@MainActor
final class WaterSubmersionCoordinator: NSObject, ObservableObject, WaterSubmersionStateReading {
    static let shared = WaterSubmersionCoordinator()

    var onSample: ((DepthSample) -> Void)?
    var onEvent: ((WaterSubmersionState, Date) -> Void)?
    var onError: ((Error) -> Void)?

    @Published private(set) var latestState: WaterSubmersionState = .unknown
    @Published private(set) var latestDepthState: WaterDepthState = .unknown
    @Published private(set) var maximumDepthMeters: Double?

    private let managerFactory: () -> CMWaterSubmersionManager?
    private var manager: CMWaterSubmersionManager?
    private var hasStartedMonitoring = false
    private var latestTemperatureCelsius: Double?

    init(managerFactory: @escaping () -> CMWaterSubmersionManager? = {
        guard CMWaterSubmersionManager.waterSubmersionAvailable else {
            return nil
        }
        return CMWaterSubmersionManager()
    }) {
        self.managerFactory = managerFactory
    }

    func startMonitoring() {
        guard !hasStartedMonitoring else {
            return
        }
        hasStartedMonitoring = true

        guard let manager = managerFactory() else {
            return
        }

        self.manager = manager
        manager.delegate = self
        refreshMaximumDepth(from: manager)
    }

    static func waterState(for state: CMWaterSubmersionEvent.State) -> WaterSubmersionState {
        switch state {
        case .unknown:
            return .unknown
        case .notSubmerged:
            return .notSubmerged
        case .submerged:
            return .submerged
        @unknown default:
            return .unknown
        }
    }

    static func depthState(for state: CMWaterSubmersionMeasurement.DepthState) -> WaterDepthState {
        switch state {
        case .unknown:
            return .unknown
        case .notSubmerged:
            return .notSubmerged
        case .submergedShallow:
            return .submergedShallow
        case .submergedDeep:
            return .submergedDeep
        case .approachingMaxDepth:
            return .approachingMaxDepth
        case .pastMaxDepth:
            return .pastMaxDepth
        case .sensorDepthError:
            return .sensorDepthError
        @unknown default:
            return .unknown
        }
    }

    static func makeSample(
        timestamp: Date,
        depthMeters: Double?,
        pressureKPa: Double?,
        temperatureCelsius: Double?,
        depthState: WaterDepthState
    ) -> DepthSample? {
        guard depthState != .sensorDepthError,
              let depthMeters,
              let pressureKPa,
              depthMeters.isFinite,
              pressureKPa.isFinite,
              depthMeters >= 0,
              pressureKPa >= 0
        else {
            return nil
        }

        let normalizedTemperature = temperatureCelsius?.isFinite == true ? temperatureCelsius : nil
        return DepthSample(
            timestamp: timestamp,
            depthMeters: depthMeters,
            pressureKPa: pressureKPa,
            waterTemperatureCelsius: normalizedTemperature
        )
    }

    static func maximumDepthMeters(from maximumDepth: Measurement<UnitLength>?) -> Double? {
        maximumDepth?.converted(to: .meters).value
    }

    func receiveEvent(state: WaterSubmersionState, at timestamp: Date) {
        latestState = state
        onEvent?(state, timestamp)
    }

    func receiveMeasurement(
        timestamp: Date,
        depthMeters: Double?,
        pressureKPa: Double?,
        depthState: WaterDepthState
    ) {
        latestDepthState = depthState
        guard let sample = Self.makeSample(
            timestamp: timestamp,
            depthMeters: depthMeters,
            pressureKPa: pressureKPa,
            temperatureCelsius: latestTemperatureCelsius,
            depthState: depthState
        ) else {
            return
        }

        onSample?(sample)
    }

    func receiveTemperature(celsius: Double) {
        guard celsius.isFinite else {
            return
        }
        latestTemperatureCelsius = celsius
    }

    func receive(error: Error) {
        onError?(error)
    }

    private func refreshMaximumDepth(from manager: CMWaterSubmersionManager) {
        maximumDepthMeters = manager.maximumDepth?.converted(to: .meters).value
    }
}

extension WaterSubmersionCoordinator: CMWaterSubmersionManagerDelegate {
    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate event: CMWaterSubmersionEvent) {
        MainActor.assumeIsolated {
            receiveEvent(state: Self.waterState(for: event.state), at: event.date)
            refreshMaximumDepth(from: manager)
        }
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterSubmersionMeasurement) {
        MainActor.assumeIsolated {
            receiveMeasurement(
                timestamp: measurement.date,
                depthMeters: measurement.depth?.converted(to: .meters).value,
                pressureKPa: measurement.pressure?.converted(to: .kilopascals).value,
                depthState: Self.depthState(for: measurement.submersionState)
            )
            refreshMaximumDepth(from: manager)
        }
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterTemperature) {
        MainActor.assumeIsolated {
            receiveTemperature(celsius: measurement.temperature.converted(to: .celsius).value)
            refreshMaximumDepth(from: manager)
        }
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, errorOccurred error: Error) {
        MainActor.assumeIsolated {
            receive(error: error)
            refreshMaximumDepth(from: manager)
        }
    }
}
