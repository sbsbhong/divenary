import Combine
import Foundation

/// A readout page during a real recording. The Action Button cycles through `pages`; crown rotation
/// moves between `live` and `details` only. `end` is in the cycle only while ending is allowed.
enum RecordingPage: Equatable, Sendable {
    case live
    case details
    case end
}

/// Why the page changed. Only the Action Button and the crown are the diver's doing; every other
/// reason is automatic and plays no haptic.
enum RecordingPageChangeReason: Equatable {
    case actionButton
    case crown
    /// No press for `RecordingPageModel.idleReturnSeconds`.
    case idleTimeout
    /// Freedive descent or surfacing.
    case divePhase
    /// The recommended stop became active.
    case recommendedStop
    /// Live depth went stale, reported a sensor error or left the sensor-authorized range.
    case depthSignal
    /// The display dimmed to Always-On.
    case alwaysOn
    /// Ending stopped being allowed while the End page was shown.
    case endUnavailable

    var isUserInitiated: Bool {
        self == .actionButton || self == .crown
    }
}

struct RecordingPageChange: Equatable {
    let page: RecordingPage
    let reason: RecordingPageChangeReason

    var userInitiated: Bool {
        reason.isUserInitiated
    }
}

/// Whether an Action Button press can end the recording. It mirrors the guard in
/// `RealDiveSessionCoordinator.requestActionButtonEnd()`, which still decides at press time.
enum RecordingEndAvailability: Equatable {
    /// Submerged, or the water state is unknown.
    case notAtSurface
    /// Out of the water, but the recording is shorter than the minimum. `seconds` counts down.
    case availableIn(seconds: Int)
    /// Out of the water and long enough. The End page is in the Action Button cycle.
    case available
}

/// The recorder and water values the page model reacts to.
struct RecordingPageSignals: Equatable {
    var waterState: WaterSubmersionState = .unknown
    var elapsedTime: TimeInterval = 0
    var liveDepthSignal: LiveDepthSignal = .awaitingFirstSample
    var freediveState: FreeDiveSessionState?
    var safetyStopStatus: SafetyStopStatus = .unknown
}

@MainActor
protocol RecordingPageReturnScheduling: AnyObject {
    func schedule(after delay: TimeInterval, _ action: @escaping @MainActor () -> Void)
    func cancel()
}

@MainActor
final class TaskRecordingPageReturnScheduler: RecordingPageReturnScheduling {
    private var task: Task<Void, Never>?

    func schedule(after delay: TimeInterval, _ action: @escaping @MainActor () -> Void) {
        cancel()
        task = Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            action()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }
}

/// Which readout a real recording shows. The coordinator turns it on for the `recording` phase only,
/// so demo and debug flows never page. Every change the diver did not cause is flagged with an
/// automatic reason and plays no haptic.
@MainActor
final class RecordingPageModel: ObservableObject {
    static let idleReturnSeconds: TimeInterval = 10

    @Published private(set) var page: RecordingPage = .live
    /// The latest page change. `nil` at the start of each recording.
    @Published private(set) var lastChange: RecordingPageChange?
    @Published private(set) var endAvailability: RecordingEndAvailability = .notAtSurface
    /// The latest Action Button press in any phase, for a short hint after a rejected press.
    @Published private(set) var lastActionFeedback: DiveActionFeedback?

    private(set) var isRecording = false
    private var signals = RecordingPageSignals()
    private var actionFeedbackCount = 0
    private var signalSubscription: AnyCancellable?
    private let minimumEndElapsedSeconds: TimeInterval
    private let haptics: DiveHapticPlaying
    private let returnScheduler: RecordingPageReturnScheduling

    init(
        minimumEndElapsedSeconds: TimeInterval,
        haptics: DiveHapticPlaying,
        returnScheduler: RecordingPageReturnScheduling
    ) {
        self.minimumEndElapsedSeconds = minimumEndElapsedSeconds
        self.haptics = haptics
        self.returnScheduler = returnScheduler
    }

    /// The Action Button cycle, in order.
    var pages: [RecordingPage] {
        endAvailability == .available ? [.live, .details, .end] : [.live, .details]
    }

    var pageIndex: Int {
        pages.firstIndex(of: page) ?? 0
    }

    /// The page the next Action Button press shows, or `nil` on the End page, where a press asks to end.
    var nextActionButtonPage: RecordingPage? {
        guard page != .end else { return nil }
        return pages[(pageIndex + 1) % pages.count]
    }

    /// Feeds the real recorder and water state into the model for the life of the app.
    func observe(recorder: DiveSessionRecorder, waterState: AnyPublisher<WaterSubmersionState, Never>) {
        let depth = Publishers.CombineLatest3(recorder.$elapsedTime, recorder.$liveDepthSignal, waterState)
        let phase = Publishers.CombineLatest(
            recorder.$freeSnapshot.map { $0?.state },
            recorder.$scubaSafetyStop.map(\.status)
        )
        signalSubscription = Publishers.CombineLatest(depth, phase)
            .map { depth, phase in
                RecordingPageSignals(
                    waterState: depth.2,
                    elapsedTime: depth.0,
                    liveDepthSignal: depth.1,
                    freediveState: phase.0,
                    safetyStopStatus: phase.1
                )
            }
            .removeDuplicates()
            .sink { [weak self] signals in
                // The recorder and water coordinator publish on the main actor.
                MainActor.assumeIsolated {
                    self?.receive(signals)
                }
            }
    }

    func receive(_ nextSignals: RecordingPageSignals) {
        let previousSignals = signals
        signals = nextSignals
        guard isRecording else { return }

        refreshEndAvailability()
        if let reason = Self.automaticReturnReason(from: previousSignals, to: nextSignals) {
            returnToLive(reason)
        } else if page == .end, endAvailability != .available {
            returnToLive(.endUnavailable)
        }
    }

    /// Called by the coordinator when the `recording` phase starts or ends. Each recording starts on Live.
    func setRecording(_ recording: Bool) {
        guard recording != isRecording else { return }
        isRecording = recording
        returnScheduler.cancel()
        page = .live
        lastChange = nil
        refreshEndAvailability()
    }

    /// An Action Button press that is not on the End page. Returns the page now shown.
    @discardableResult
    func advanceFromActionButton() -> RecordingPage {
        guard isRecording else { return page }
        showPage(pages[(pageIndex + 1) % pages.count], reason: .actionButton)
        return page
    }

    /// Crown rotation by whole detents: positive moves toward Details, negative toward Live.
    /// It stops at Details and never selects the End page; turning back from the End page leaves it.
    func stepFromCrown(by detents: Int) {
        guard isRecording, detents != 0 else { return }
        let crownPages: [RecordingPage] = [.live, .details]
        let target: RecordingPage
        switch page {
        case .end:
            guard detents < 0 else { return }
            target = crownPages[max(crownPages.count + detents, 0)]
        case .live, .details:
            let index = crownPages.firstIndex(of: page) ?? 0
            target = crownPages[min(max(index + detents, 0), crownPages.count - 1)]
        }
        showPage(target, reason: .crown)
    }

    /// Views report `isLuminanceReduced` here. Dimming to Always-On returns to Live without a haptic.
    func setAlwaysOn(_ isAlwaysOn: Bool) {
        guard isAlwaysOn, isRecording else { return }
        returnToLive(.alwaysOn)
    }

    /// A press on the End page that the coordinator's guard refused.
    func returnToLiveAfterRejectedEnd() {
        returnToLive(.endUnavailable)
    }

    func recordActionFeedback(_ outcome: DiveActionOutcome) {
        actionFeedbackCount += 1
        lastActionFeedback = DiveActionFeedback(id: actionFeedbackCount, outcome: outcome)
    }

    private func showPage(_ nextPage: RecordingPage, reason: RecordingPageChangeReason) {
        guard nextPage != page else { return }
        page = nextPage
        lastChange = RecordingPageChange(page: nextPage, reason: reason)
        haptics.play(.pageChange)
        if nextPage == .live {
            returnScheduler.cancel()
        } else {
            returnScheduler.schedule(after: Self.idleReturnSeconds) { [weak self] in
                self?.returnToLive(.idleTimeout)
            }
        }
    }

    private func returnToLive(_ reason: RecordingPageChangeReason) {
        returnScheduler.cancel()
        guard page != .live else { return }
        page = .live
        lastChange = RecordingPageChange(page: .live, reason: reason)
    }

    private func refreshEndAvailability() {
        let nextAvailability: RecordingEndAvailability
        if !isRecording || signals.waterState != .notSubmerged {
            nextAvailability = .notAtSurface
        } else if signals.elapsedTime >= minimumEndElapsedSeconds {
            nextAvailability = .available
        } else {
            let remaining = (minimumEndElapsedSeconds - signals.elapsedTime).rounded(.up)
            nextAvailability = .availableIn(seconds: max(1, Int(remaining)))
        }
        if endAvailability != nextAvailability {
            endAvailability = nextAvailability
        }
    }

    private static func automaticReturnReason(
        from previous: RecordingPageSignals,
        to next: RecordingPageSignals
    ) -> RecordingPageChangeReason? {
        if previous.freediveState != next.freediveState {
            return .divePhase
        }
        if next.safetyStopStatus == .active, previous.safetyStopStatus != .active {
            return .recommendedStop
        }
        if previous.liveDepthSignal == .live, next.liveDepthSignal != .live {
            return .depthSignal
        }
        return nil
    }
}
