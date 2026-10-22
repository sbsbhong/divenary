import Combine
import CoreMotion
import Foundation

enum WaterSubmersionState: Equatable, Sendable {
    case unknown
    case notSubmerged
    case submerged
}

enum WaterDepthState: Equatable, Sendable {
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
    private struct ForwardedWaterSubmersionError: LocalizedError, Sendable {
        let errorDescription: String?
    }

    static let shared = WaterSubmersionCoordinator()
    static let temperatureFreshnessSeconds: TimeInterval = 60

    var onSample: ((DepthSample) -> Void)?
    var onDepthState: ((WaterDepthState, Date) -> Void)?
    var onEvent: ((WaterSubmersionState, Date) -> Void)?
    var onError: ((Error) -> Void)?

    @Published private(set) var latestState: WaterSubmersionState = .unknown
    @Published private(set) var latestDepthState: WaterDepthState = .unknown
    @Published private(set) var latestDepthMeters: Double?
    @Published private(set) var maximumDepthMeters: Double?

    private let managerFactory: () -> CMWaterSubmersionManager?
    private var manager: CMWaterSubmersionManager?
    private var hasStartedMonitoring = false
    private(set) var latestTemperature: (celsius: Double, measuredAt: Date)?

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

    nonisolated static func waterState(for state: CMWaterSubmersionEvent.State) -> WaterSubmersionState {
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

    nonisolated static func depthState(for state: CMWaterSubmersionMeasurement.DepthState) -> WaterDepthState {
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

    nonisolated static func maximumDepthMeters(from maximumDepth: Measurement<UnitLength>?) -> Double? {
        maximumDepth?.converted(to: .meters).value
    }

    nonisolated func forwardEvent(
        state: WaterSubmersionState,
        at timestamp: Date,
        maximumDepthMeters: Double?
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            receiveEvent(state: state, at: timestamp)
            receiveMaximumDepth(maximumDepthMeters)
        }
    }

    nonisolated func forwardMeasurement(
        timestamp: Date,
        depthMeters: Double?,
        pressureKPa: Double?,
        depthState: WaterDepthState,
        maximumDepthMeters: Double?
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            receiveMeasurement(
                timestamp: timestamp,
                depthMeters: depthMeters,
                pressureKPa: pressureKPa,
                depthState: depthState
            )
            receiveMaximumDepth(maximumDepthMeters)
        }
    }

    nonisolated func forwardTemperature(celsius: Double, at timestamp: Date, maximumDepthMeters: Double?) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            receiveTemperature(celsius: celsius, at: timestamp)
            receiveMaximumDepth(maximumDepthMeters)
        }
    }

    nonisolated func forwardError(description: String, maximumDepthMeters: Double?) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            receive(error: ForwardedWaterSubmersionError(errorDescription: description))
            receiveMaximumDepth(maximumDepthMeters)
        }
    }

    func receiveEvent(state: WaterSubmersionState, at timestamp: Date) {
        publish(\.latestState, state)
        if state == .notSubmerged {
            publish(\.latestDepthMeters, nil)
            latestTemperature = nil
        }
        onEvent?(state, timestamp)
    }

    func receiveMeasurement(
        timestamp: Date,
        depthMeters: Double?,
        pressureKPa: Double?,
        depthState: WaterDepthState
    ) {
        publish(\.latestDepthState, depthState)
        onDepthState?(depthState, timestamp)
        guard let sample = Self.makeSample(
            timestamp: timestamp,
            depthMeters: depthMeters,
            pressureKPa: pressureKPa,
            temperatureCelsius: freshTemperature(at: timestamp),
            depthState: depthState
        ) else {
            if depthState == .notSubmerged || depthState == .sensorDepthError {
                publish(\.latestDepthMeters, nil)
            }
            return
        }

        publish(\.latestDepthMeters, sample.depthMeters)
        onSample?(sample)
    }

    func receiveTemperature(celsius: Double, at timestamp: Date) {
        guard celsius.isFinite else {
            return
        }
        latestTemperature = (celsius, timestamp)
    }

    /// Drops a reading taken before the current session so it never labels the new dive.
    func resetWaterTemperature() {
        latestTemperature = nil
    }

    private func freshTemperature(at timestamp: Date) -> Double? {
        guard let latestTemperature,
              timestamp.timeIntervalSince(latestTemperature.measuredAt) <= Self.temperatureFreshnessSeconds
        else {
            return nil
        }
        return latestTemperature.celsius
    }

    func receive(error: Error) {
        onError?(error)
    }

    private func receiveMaximumDepth(_ maximumDepthMeters: Double?) {
        publish(\.maximumDepthMeters, maximumDepthMeters)
    }

    /// Sensor callbacks repeat unchanged values; publishing them would re-render every observer.
    private func publish<Value: Equatable>(
        _ keyPath: ReferenceWritableKeyPath<WaterSubmersionCoordinator, Value>,
        _ value: Value
    ) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    #if DEBUG
    func forwardMaximumDepthForTesting(_ maximumDepthMeters: Double?) {
        receiveMaximumDepth(maximumDepthMeters)
    }
    #endif

    private func refreshMaximumDepth(from manager: CMWaterSubmersionManager) {
        receiveMaximumDepth(Self.maximumDepthMeters(from: manager.maximumDepth))
    }
}

extension WaterSubmersionCoordinator: CMWaterSubmersionManagerDelegate {
    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate event: CMWaterSubmersionEvent) {
        let state = Self.waterState(for: event.state)
        let timestamp = event.date
        let maximumDepthMeters = Self.maximumDepthMeters(from: manager.maximumDepth)
        forwardEvent(state: state, at: timestamp, maximumDepthMeters: maximumDepthMeters)
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterSubmersionMeasurement) {
        let timestamp = measurement.date
        let depthMeters = measurement.depth?.converted(to: .meters).value
        let pressureKPa = measurement.pressure?.converted(to: .kilopascals).value
        let depthState = Self.depthState(for: measurement.submersionState)
        let maximumDepthMeters = Self.maximumDepthMeters(from: manager.maximumDepth)
        forwardMeasurement(
            timestamp: timestamp,
            depthMeters: depthMeters,
            pressureKPa: pressureKPa,
            depthState: depthState,
            maximumDepthMeters: maximumDepthMeters
        )
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, didUpdate measurement: CMWaterTemperature) {
        let celsius = measurement.temperature.converted(to: .celsius).value
        let timestamp = measurement.date
        let maximumDepthMeters = Self.maximumDepthMeters(from: manager.maximumDepth)
        forwardTemperature(celsius: celsius, at: timestamp, maximumDepthMeters: maximumDepthMeters)
    }

    nonisolated func manager(_ manager: CMWaterSubmersionManager, errorOccurred error: Error) {
        let description = error.localizedDescription
        let maximumDepthMeters = Self.maximumDepthMeters(from: manager.maximumDepth)
        forwardError(description: description, maximumDepthMeters: maximumDepthMeters)
    }
}
