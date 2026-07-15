import Foundation

protocol DepthSensorProvider: AnyObject {
    var onSample: ((DepthSample) -> Void)? { get set }

    func start()
    func stop()
}
