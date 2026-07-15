import Foundation
import WatchKit

@MainActor
final class DepthAutoLaunchAuthorization: ObservableObject {
    @Published private(set) var statusText = String(localized: "Auto launch status unavailable")

    func refresh() {
        WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus { status, error in
            Task { @MainActor in
                if error != nil {
                    self.statusText = String(localized: "Auto launch status unavailable")
                } else {
                    self.statusText = Self.displayText(for: status)
                }
            }
        }
    }

    private static func displayText(for status: WKExtendedRuntimeSessionAutoLaunchAuthorizationStatus) -> String {
        switch status {
        case .active:
            return String(localized: "Auto launch active")
        case .inactive:
            return String(localized: "Auto launch inactive")
        case .unknown:
            return String(localized: "Auto launch status unavailable")
        @unknown default:
            return String(localized: "Auto launch status unavailable")
        }
    }
}
