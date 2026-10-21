import Foundation

/// Whether the latest depth reading can be shown as live. Only the real sensor reports conditions.
enum DepthSensorCondition: Equatable {
    case normal(at: Date)
    case sensorError(at: Date)
    case beyondSensorRange(limitMeters: Double?, at: Date)
}

protocol DepthSensorConditionReporting: AnyObject {
    @MainActor
    var onCondition: ((DepthSensorCondition) -> Void)? { get set }
}

protocol DepthSensorProvider: AnyObject {
    @MainActor
    var onSample: ((DepthSample) -> Void)? { get set }

    @MainActor
    func start()

    @MainActor
    func stop()
}
