import AppIntents
import OSLog

@MainActor
protocol RealDiveActionControlling: AnyObject, Sendable {
    @discardableResult
    func startFromActionButton() -> Bool
    func requestActionButtonEnd() -> Bool
}

extension RealDiveSessionCoordinator: RealDiveActionControlling {}

@MainActor
final class DiveActionButtonBridge: Sendable {
    private let controller: any RealDiveActionControlling

    init(controller: some RealDiveActionControlling) {
        self.controller = controller
    }

    @discardableResult
    func startDive() -> Bool {
        controller.startFromActionButton()
    }

    func requestEndDive() -> Bool {
        controller.requestActionButtonEnd()
    }
}

@MainActor
final class DiveActionButtonDonor: DiveActionButtonDonating {
    typealias DonationOperation = @MainActor () async throws -> Void
    typealias DonationFailureObserver = @MainActor (Error) -> Void

    private let logger = Logger(
        subsystem: "com.divenary.app.watchkitapp",
        category: "DiveActionButton"
    )
    private let donationOperation: DonationOperation
    private let onDonationFailure: DonationFailureObserver

    init(
        donationOperation: @escaping DonationOperation = {
            _ = try await DivenaryStartDiveIntent().donate(
                result: .result(actionButtonIntent: DivenaryEndDiveIntent())
            )
        },
        onDonationFailure: @escaping DonationFailureObserver = { _ in }
    ) {
        self.donationOperation = donationOperation
        self.onDonationFailure = onDonationFailure
    }

    func donateEndAction() {
        Task { @MainActor in
            do {
                try await donationOperation()
            } catch {
                logger.error("Action Button donation failed: \(error.localizedDescription)")
                onDonationFailure(error)
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
        guard await bridge.startDive() else {
            return .result()
        }
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
