import Foundation
import WatchKit

/// Whether watchOS launches Divenary when the watch is submerged
/// (Settings > General > Auto-Launch > When Submerged).
enum DepthAutoLaunchStatus: Equatable {
    case active
    case inactive
    /// Not read yet, or watchOS could not report it. Copy treats it as "start from Home".
    case unknown

    init(_ status: WKExtendedRuntimeSessionAutoLaunchAuthorizationStatus) {
        switch status {
        case .active:
            self = .active
        case .inactive:
            self = .inactive
        case .unknown:
            self = .unknown
        @unknown default:
            self = .unknown
        }
    }

    var displayText: String {
        switch self {
        case .active:
            return String(localized: "Auto launch active")
        case .inactive:
            return String(localized: "Auto launch inactive")
        case .unknown:
            return String(localized: "Auto launch status unavailable")
        }
    }
}

@MainActor
final class DepthAutoLaunchAuthorization: ObservableObject {
    @Published private(set) var status: DepthAutoLaunchStatus = .unknown

    var statusText: String {
        status.displayText
    }

    func refresh() {
        WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus { status, error in
            Task { @MainActor in
                self.status = error == nil ? DepthAutoLaunchStatus(status) : .unknown
            }
        }
    }
}
