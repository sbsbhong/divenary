import AppIntents
import OSLog

@MainActor
protocol RealDiveActionControlling: AnyObject, Sendable {
    func startFromActionButton()
    func requestActionButtonEnd() -> Bool
}

extension RealDiveSessionCoordinator: RealDiveActionControlling {}

@MainActor
final class DiveActionButtonBridge: Sendable {
    private let controller: any RealDiveActionControlling

    init(controller: some RealDiveActionControlling) {
        self.controller = controller
    }

    func startDive() {
        controller.startFromActionButton()
    }

    func requestEndDive() -> Bool {
        controller.requestActionButtonEnd()
    }
}

@MainActor
final class DiveActionButtonDonor: DiveActionButtonDonating {
    private let logger = Logger(
        subsystem: "com.divenary.app.watchkitapp",
        category: "DiveActionButton"
    )

    func donateEndAction() {
        Task {
            do {
                _ = try await DivenaryStartDiveIntent().donate(
                    result: .result(actionButtonIntent: DivenaryEndDiveIntent())
                )
            } catch {
                logger.error("Action Button donation failed: \(error.localizedDescription)")
            }
        }
    }
}

struct DivenaryStartDiveIntent: StartDiveIntent {
    static let title: LocalizedStringResource = "Start Divenary Dive"

    @Dependency private var bridge: DiveActionButtonBridge

    init() {}

    @MainActor
    init(bridge: DiveActionButtonBridge) {
        _bridge = Dependency()
        _bridge.wrappedValue = bridge
    }

    func perform() async throws -> some IntentResult {
        await bridge.startDive()
        return .result(actionButtonIntent: DivenaryEndDiveIntent())
    }
}

struct DivenaryEndDiveIntent: AppIntent {
    static let title: LocalizedStringResource = "End Divenary Dive"

    @Dependency private var bridge: DiveActionButtonBridge

    init() {}

    @MainActor
    init(bridge: DiveActionButtonBridge) {
        _bridge = Dependency()
        _bridge.wrappedValue = bridge
    }

    func perform() async throws -> some IntentResult {
        if await bridge.requestEndDive() {
            return .result()
        }
        return .result(actionButtonIntent: DivenaryEndDiveIntent())
    }
}
