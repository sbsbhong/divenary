import Foundation

@MainActor
final class RealDepthSensorProvider: DepthSensorProvider {
    var onSample: ((DepthSample) -> Void)?

    private let coordinator: WaterSubmersionCoordinator

    init(coordinator: WaterSubmersionCoordinator) {
        self.coordinator = coordinator
    }

    nonisolated init() {
        coordinator = MainActor.assumeIsolated { WaterSubmersionCoordinator.shared }
    }

    func start() {
        coordinator.onSample = { [weak self] sample in
            self?.onSample?(sample)
        }
        coordinator.startMonitoring()
    }

    func stop() {
        coordinator.onSample = nil
    }
}
