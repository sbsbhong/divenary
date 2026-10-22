import AppIntents
import Foundation
import OSLog

/// Why an Action Button press did nothing. Each rejection plays a haptic so the press is never silent.
enum DiveActionRejection: Equatable, Sendable {
    /// The log is saving, or a runtime handoff is still in progress.
    case busy
    /// Recording could not start. The recording flow shows the error.
    case startFailed
    /// The End page was shown, but ending is no longer allowed (back in the water, for example).
    case endUnavailable
}

/// What one Action Button press did.
enum DiveActionOutcome: Equatable, Sendable {
    case started
    case pageChanged(RecordingPage)
    case endRequested
    case rejected(DiveActionRejection)

    /// The dive action intent stays on the button until a press ends the dive. After that the
    /// button falls back to `DivenaryStartDiveIntent`.
    var keepsDiveActionOnButton: Bool {
        self != .endRequested
    }
}

/// The latest press for views. `id` grows with every press, so two equal outcomes in a row still
/// read as two presses.
struct DiveActionFeedback: Equatable {
    let id: Int
    let outcome: DiveActionOutcome
}

@MainActor
protocol RealDiveActionControlling: AnyObject, Sendable {
    func handleActionButtonPress() -> DiveActionOutcome
}

extension RealDiveSessionCoordinator: RealDiveActionControlling {}

@MainActor
final class DiveActionButtonBridge: Sendable {
    typealias EndOverride = @MainActor () -> Bool

    private let controller: any RealDiveActionControlling
    private var endOverrideID: UUID?
    private var endOverride: EndOverride?

    init(controller: some RealDiveActionControlling) {
        self.controller = controller
    }

    /// One Action Button press. A demo or debug recording installs an override and keeps its own
    /// end path; otherwise the real coordinator decides what the press does in the current phase.
    func performDiveAction() -> DiveActionOutcome {
        if let endOverride {
            return endOverride() ? .endRequested : .rejected(.endUnavailable)
        }
        return controller.handleActionButtonPress()
    }

    func installEndOverride(_ handler: @escaping EndOverride) -> UUID {
        let token = UUID()
        endOverrideID = token
        endOverride = handler
        return token
    }

    func removeEndOverride(_ token: UUID) {
        guard endOverrideID == token else {
            return
        }
        endOverrideID = nil
        endOverride = nil
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
                result: .result(actionButtonIntent: DivenaryDiveActionIntent())
            )
        },
        onDonationFailure: @escaping DonationFailureObserver = { _ in }
    ) {
        self.donationOperation = donationOperation
        self.onDonationFailure = onDonationFailure
    }

    func donateDiveAction() {
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

/// The first press when Divenary is the Dive app for the Action Button. It runs the same
/// phase-aware press as `DivenaryDiveActionIntent`, then hands the button to that intent.
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
        guard await bridge.performDiveAction().keepsDiveActionOnButton else {
            return .result()
        }
        return .result(actionButtonIntent: DivenaryDiveActionIntent())
    }
}

/// Every later press until the dive ends. Underwater it pages the readouts; at the surface, once
/// ending is allowed, a press on the End page ends through the coordinator's guarded path.
struct DivenaryDiveActionIntent: AppIntent {
    static let title: LocalizedStringResource = "Divenary Dive Action"

    @Dependency private var bridge: DiveActionButtonBridge

    init() {}

    @MainActor
    init(bridge: DiveActionButtonBridge) {
        _bridge = Dependency()
        _bridge.wrappedValue = bridge
    }

    func perform() async throws -> some IntentResult {
        guard await bridge.performDiveAction().keepsDiveActionOnButton else {
            return .result()
        }
        return .result(actionButtonIntent: DivenaryDiveActionIntent())
    }
}
