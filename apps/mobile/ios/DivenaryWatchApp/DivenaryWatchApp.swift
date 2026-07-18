import AppIntents
import SwiftUI

@main
struct DivenaryWatchApp: App {
    @WKApplicationDelegateAdaptor(DivenaryWatchApplicationDelegate.self)
    private var applicationDelegate

    @StateObject private var sessionStore: DiveSessionStore
    @StateObject private var water: WaterSubmersionCoordinator
    @StateObject private var realRecorder: DiveSessionRecorder
    @StateObject private var realCoordinator: RealDiveSessionCoordinator

    init() {
        let services = DiveAppServices.shared
        AppDependencyManager.shared.add(dependency: services.actionButtonBridge)
        _sessionStore = StateObject(wrappedValue: services.store)
        _water = StateObject(wrappedValue: services.water)
        _realRecorder = StateObject(wrappedValue: services.realRecorder)
        _realCoordinator = StateObject(wrappedValue: services.realCoordinator)
    }

    var body: some Scene {
        WindowGroup {
            rootView
        }
    }

    @ViewBuilder
    private var rootView: some View {
        #if DEBUG
        if let fixture = RecordingLayoutFixture(
            rawValue: ProcessInfo.processInfo.environment["DIVE_WATCH_LAYOUT_FIXTURE"] ?? ""
        ) {
            RecordingLayoutFixtureView(fixture: fixture)
        } else {
            homeView
        }
        #else
        homeView
        #endif
    }

    private var homeView: some View {
        HomeView(
            store: sessionStore,
            water: water,
            realRecorder: realRecorder,
            realCoordinator: realCoordinator
        )
    }
}
