import CoreMotion
import Foundation
import WatchKit

struct DepthSensorAvailability {
    let isWaterSubmersionAvailable: Bool
    let authorizationStatusDescription: String
    let waterResistanceDescription: String

    static var current: DepthSensorAvailability {
        DepthSensorAvailability(
            isWaterSubmersionAvailable: CMWaterSubmersionManager.waterSubmersionAvailable,
            authorizationStatusDescription: String(describing: CMWaterSubmersionManager.authorizationStatus),
            waterResistanceDescription: String(describing: WKInterfaceDevice.current().waterResistanceRating)
        )
    }
}
