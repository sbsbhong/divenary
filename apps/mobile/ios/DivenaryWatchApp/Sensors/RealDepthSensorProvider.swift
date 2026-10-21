import Foundation

@MainActor
final class RealDepthSensorProvider: DepthSensorProvider, DepthSensorConditionReporting {
    var onSample: ((DepthSample) -> Void)?
    var onCondition: ((DepthSensorCondition) -> Void)?

    private let coordinator: WaterSubmersionCoordinator

    init(coordinator: WaterSubmersionCoordinator) {
        self.coordinator = coordinator
    }

    convenience init() {
        self.init(coordinator: .shared)
    }

    func start() {
        coordinator.resetWaterTemperature()
        coordinator.onSample = { [weak self] sample in
            self?.onSample?(sample)
        }
        coordinator.onDepthState = { [weak self] state, timestamp in
            guard let self else { return }
            self.onCondition?(self.condition(for: state, at: timestamp))
        }
        coordinator.onError = { [weak self] _ in
            self?.onCondition?(.sensorError(at: Date()))
        }
        coordinator.startMonitoring()
    }

    func stop() {
        coordinator.onSample = nil
        coordinator.onDepthState = nil
        coordinator.onError = nil
    }

    private func condition(for state: WaterDepthState, at timestamp: Date) -> DepthSensorCondition {
        switch state {
        case .pastMaxDepth:
            return .beyondSensorRange(limitMeters: coordinator.maximumDepthMeters, at: timestamp)
        case .sensorDepthError:
            return .sensorError(at: timestamp)
        case .unknown, .notSubmerged, .submergedShallow, .submergedDeep, .approachingMaxDepth:
            return .normal(at: timestamp)
        }
    }
}
