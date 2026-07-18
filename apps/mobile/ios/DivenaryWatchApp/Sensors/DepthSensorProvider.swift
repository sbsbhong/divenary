import Foundation

protocol DepthSensorProvider: AnyObject {
    @MainActor
    var onSample: ((DepthSample) -> Void)? { get set }

    @MainActor
    func start()

    @MainActor
    func stop()
}
