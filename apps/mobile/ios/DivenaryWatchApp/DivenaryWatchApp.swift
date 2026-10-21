import AppIntents
import SwiftUI

@main
struct DivenaryWatchApp: App {
    @WKApplicationDelegateAdaptor(DivenaryWatchApplicationDelegate.self)
    private var applicationDelegate

    // DiveAppServices keeps these alive for the whole process. The app root holds them without
    // observing, so a published change re-renders only the views that read it.
    private let sessionStore: DiveSessionStore
    private let water: WaterSubmersionCoordinator
    private let realRecorder: DiveSessionRecorder
    private let realCoordinator: RealDiveSessionCoordinator

    init() {
        let services = DiveAppServices.shared
        AppDependencyManager.shared.add(dependency: services.actionButtonBridge)
        sessionStore = services.store
        water = services.water
        realRecorder = services.realRecorder
        realCoordinator = services.realCoordinator
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
            realCoordinator: realCoordinator,
            actionButtonBridge: DiveAppServices.shared.actionButtonBridge,
            actionButtonDonor: DiveAppServices.shared.actionButtonDonor
        )
    }
}
