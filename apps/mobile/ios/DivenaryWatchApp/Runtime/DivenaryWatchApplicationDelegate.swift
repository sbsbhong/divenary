import WatchKit

@MainActor
final class DivenaryWatchApplicationDelegate: NSObject, WKApplicationDelegate {
    func handle(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        DiveAppServices.shared.runtime.adoptSystemSession(extendedRuntimeSession)
    }
}
