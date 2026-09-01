import Foundation

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
        let realCoordinator = RealDiveSessionCoordinator(
            preferredMode: { store.preferredDiveMode },
            updatePreferredMode: store.updatePreferredDiveMode,
            runtime: runtime,
            recorder: realRecorder,
            water: water,
            actionButtonDonor: actionButtonDonor
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
