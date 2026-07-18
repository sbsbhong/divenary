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

    private init() {
        let store = DiveSessionStore()
        let water = WaterSubmersionCoordinator.shared
        let runtime = DiveRuntimeSessionController()
        let realSensorProvider = RealDepthSensorProvider(coordinator: water)
        let realRecorder = DiveSessionRecorder(sensorProvider: realSensorProvider)
        let realCoordinator = RealDiveSessionCoordinator(
            preferredMode: { store.preferredDiveMode },
            runtime: runtime,
            recorder: realRecorder,
            water: water,
            actionButtonDonor: DiveActionButtonDonor()
        )

        self.store = store
        self.water = water
        self.runtime = runtime
        self.realSensorProvider = realSensorProvider
        self.realRecorder = realRecorder
        self.realCoordinator = realCoordinator
        actionButtonBridge = DiveActionButtonBridge(controller: realCoordinator)

        water.startMonitoring()
    }
}
