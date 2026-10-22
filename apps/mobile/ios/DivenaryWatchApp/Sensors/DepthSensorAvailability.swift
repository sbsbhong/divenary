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

    private static var isRunningInSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
}

/// A guess at whether this watch has an Action Button, from its model identifier. There is no public
/// API for the button, or for whether Divenary is the app assigned to it, so copy built on this hint
/// stays conditional ("If you assigned Divenary to the Action Button ...").
struct ActionButtonHint: Equatable {
    let modelIdentifier: String?

    /// Apple Watch Ultra (Watch6,18), Ultra 2 (Watch7,5) and Ultra 3 (Watch7,12).
    /// Needs confirmation on hardware before release; an unknown identifier reads as "no button".
    static let ultraModelIdentifiers: Set<String> = ["Watch6,18", "Watch7,5", "Watch7,12"]

    static let current = ActionButtonHint(modelIdentifier: currentModelIdentifier())

    var isLikelyUltra: Bool {
        modelIdentifier.map(Self.ultraModelIdentifiers.contains) ?? false
    }

    private static func currentModelIdentifier() -> String? {
        #if targetEnvironment(simulator)
        // hw.machine reports the Mac's architecture in the simulator.
        return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        #else
        var size = 0
        guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 0 else {
            return nil
        }
        var machine = [CChar](repeating: 0, count: size)
        guard sysctlbyname("hw.machine", &machine, &size, nil, 0) == 0 else {
            return nil
        }
        return String(cString: machine)
        #endif
    }
}
