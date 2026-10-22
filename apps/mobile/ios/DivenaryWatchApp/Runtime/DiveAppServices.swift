import Combine
import Foundation

#if DEBUG
@MainActor
final class FailFirstDiveSessionPersisting: DiveSessionPersisting {
    private let base: any DiveSessionPersisting
    private var shouldFail = true

    init(base: any DiveSessionPersisting) {
        self.base = base
    }

    func save(_ session: DiveSessionRecord) -> Bool {
        guard !shouldFail else {
            shouldFail = false
            return false
        }
        return base.save(session)
    }
}
#endif

@MainActor
final class DiveAppServices {
    static let shared = DiveAppServices()

    let store: DiveSessionStore
    let water: WaterSubmersionCoordinator
    let runtime: DiveRuntimeSessionController
    let realSensorProvider: RealDepthSensorProvider
    let realRecorder: DiveSessionRecorder
    let realCoordinator: RealDiveSessionCoordinator
    let actionButtonBridge: DiveActionButtonBridge
    let actionButtonDonor: DiveActionButtonDonating

    private init() {
        let store = DiveSessionStore()
        let water = WaterSubmersionCoordinator.shared
        let runtime = DiveRuntimeSessionController()
        let realSensorProvider = RealDepthSensorProvider(coordinator: water)
        let realRecorder = DiveSessionRecorder(sensorProvider: realSensorProvider)
        let actionButtonDonor = DiveActionButtonDonor()
        let haptics = WatchDiveHaptics()
        let completionStore: any DiveSessionPersisting
        #if DEBUG
        if ProcessInfo.processInfo.environment["DIVE_WATCH_FAIL_FIRST_COMPLETION_SAVE"] == "1" {
            completionStore = FailFirstDiveSessionPersisting(base: store)
        } else {
            completionStore = store
        }
        #else
        completionStore = store
        #endif
        let realCoordinator = RealDiveSessionCoordinator(
            preferredMode: { store.preferredDiveMode },
            updatePreferredMode: store.updatePreferredDiveMode,
            runtime: runtime,
            recorder: realRecorder,
            water: water,
            actionButtonDonor: actionButtonDonor,
            sessionStore: completionStore,
            haptics: haptics
        )
        realCoordinator.recordingPages.observe(
            recorder: realRecorder,
            waterState: water.$latestState.eraseToAnyPublisher()
        )

        self.store = store
        self.water = water
        self.runtime = runtime
        self.realSensorProvider = realSensorProvider
        self.realRecorder = realRecorder
        self.realCoordinator = realCoordinator
        self.actionButtonDonor = actionButtonDonor
        actionButtonBridge = DiveActionButtonBridge(controller: realCoordinator)

        water.startMonitoring()
    }
}
