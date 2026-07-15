import CoreMotion
import Foundation
import WatchKit

enum DepthSensorReadiness: Equatable {
    case ready
    case simulatorRequiresRealWatch
    case unsupportedDevice
}

struct DepthSensorAvailability {
    let isWaterSubmersionAvailable: Bool
    let authorizationStatusDescription: String
    let waterResistanceDescription: String
    let isRunningInSimulator: Bool

    var readiness: DepthSensorReadiness {
        if isWaterSubmersionAvailable {
            return .ready
        }

        return isRunningInSimulator ? .simulatorRequiresRealWatch : .unsupportedDevice
    }

    var canStartRealDive: Bool {
        readiness == .ready
    }

    var canSelectPlannedDives: Bool {
        canStartRealDive
    }

    static var current: DepthSensorAvailability {
        DepthSensorAvailability(
            isWaterSubmersionAvailable: CMWaterSubmersionManager.waterSubmersionAvailable,
            authorizationStatusDescription: String(describing: CMWaterSubmersionManager.authorizationStatus),
            waterResistanceDescription: String(describing: WKInterfaceDevice.current().waterResistanceRating),
            isRunningInSimulator: Self.isRunningInSimulator
        )
    }

    static var launchPlaceholder: DepthSensorAvailability {
        DepthSensorAvailability(
            isWaterSubmersionAvailable: false,
            authorizationStatusDescription: "notLoaded",
            waterResistanceDescription: "notLoaded",
            isRunningInSimulator: Self.isRunningInSimulator
        )
    }

    private static var isRunningInSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
}
