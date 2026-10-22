import Combine
import Foundation

enum RealDiveStartSource: Equatable {
    case manual
    case systemAutoLaunch
    case actionButton
}

enum RealDivePhase {
    case idle
    case wetReady(mode: DiveMode)
    case recording(source: RealDiveStartSource, plan: PreDivePlan)
    case completing(record: DiveSessionRecord)
    case savedSummary(record: DiveSessionRecord)
    case noSamples
    case awaitingRuntimeInvalidation(source: RealDiveStartSource)
    case startPersistenceError(source: RealDiveStartSource)
    case savePersistenceError(record: DiveSessionRecord)

    var presentsRecordingFlow: Bool {
        switch self {
        case .idle:
            return false
        case .wetReady, .recording, .completing, .savedSummary, .noSamples,
             .awaitingRuntimeInvalidation, .startPersistenceError, .savePersistenceError:
            return true
        }
    }
}

@MainActor
protocol WetReadyExitScheduling: AnyObject {
    func schedule(_ action: @escaping @MainActor () -> Void)
    func cancel()
}

@MainActor
final class TaskWetReadyExitScheduler: WetReadyExitScheduling {
    private var task: Task<Void, Never>?

    func schedule(_ action: @escaping @MainActor () -> Void) {
        cancel()
        task = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            action()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }
}

@MainActor
protocol DiveSessionRecording: AnyObject {
    var elapsedTime: TimeInterval { get }
    var hasCapturedDepthSample: Bool { get }

    @discardableResult
    func startSession(plan: PreDivePlan) -> Bool
    func stopSession() -> DiveSessionRecord?
    @discardableResult
    func cancelSession() -> Bool
    func resetCompletedSession()
}

@MainActor
protocol DiveSessionPersisting: AnyObject {
    @discardableResult
    func save(_ session: DiveSessionRecord) -> Bool
}

@MainActor
protocol DiveActionButtonDonating: AnyObject {
    /// Tells watchOS that the next Action Button press runs `DivenaryDiveActionIntent`.
    func donateDiveAction()
}

@MainActor
final class RealDiveSessionCoordinator: ObservableObject {
    @Published private(set) var phase: RealDivePhase = .idle {
        didSet {
            // Readout pages exist only while recording; any other phase resets them to Live.
            if case .recording = phase {
                recordingPages.setRecording(true)
            } else {
                recordingPages.setRecording(false)
                isEnding = false
            }
        }
    }

    /// Readout pages for the real recording screen. Views observe it; the Action Button and crown move it.
    let recordingPages: RecordingPageModel
    @Published private(set) var isEnding = false
    @Published private(set) var failureFeedback: String?
    private var failureCount = 0
    // Records remain backed by their existing on-disk journals until save succeeds.
    // Retain their completed values too, so Home can retry without waiting for a relaunch.
    private var pendingRecords: [UUID: DiveSessionRecord] = [:]
    private var suppressesWetReadyUntilDry = false

    private let preferredMode: () -> DiveMode
    private let updatePreferredMode: (DiveMode) -> Void
    private let runtime: DiveRuntimeSessionControlling
    private let recorder: DiveSessionRecording
    private let sessionStore: DiveSessionPersisting
    private let water: WaterSubmersionStateReading
    private let actionButtonDonor: DiveActionButtonDonating
    private let wetReadyExitScheduler: WetReadyExitScheduling
    private let schedulePersistence: (@escaping @MainActor () -> Void) -> Void
    private let haptics: DiveHapticPlaying
    private let minimumHardwareEndElapsedSeconds: TimeInterval = 180

    init(
        preferredMode: @escaping () -> DiveMode,
        updatePreferredMode: @escaping (DiveMode) -> Void,
        runtime: DiveRuntimeSessionControlling,
        recorder: DiveSessionRecording,
        water: WaterSubmersionStateReading,
        actionButtonDonor: DiveActionButtonDonating,
        wetReadyExitScheduler: WetReadyExitScheduling? = nil,
        sessionStore: DiveSessionPersisting,
        schedulePersistence: ((@escaping @MainActor () -> Void) -> Void)? = nil,
        haptics: DiveHapticPlaying? = nil,
        pageReturnScheduler: RecordingPageReturnScheduling? = nil
    ) {
        self.preferredMode = preferredMode
        self.updatePreferredMode = updatePreferredMode
        self.runtime = runtime
        self.recorder = recorder
        self.sessionStore = sessionStore
        self.water = water
        self.actionButtonDonor = actionButtonDonor
        self.wetReadyExitScheduler = wetReadyExitScheduler ?? TaskWetReadyExitScheduler()
        // Saving a long dive holds the main thread. Waiting about one frame first puts the
        // "Saving" screen on display before that happens.
        self.schedulePersistence = schedulePersistence ?? { work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 50_000_000)
                work()
            }
        }
        let haptics = haptics ?? WatchDiveHaptics()
        self.haptics = haptics
        recordingPages = RecordingPageModel(
            minimumEndElapsedSeconds: minimumHardwareEndElapsedSeconds,
            haptics: haptics,
            returnScheduler: pageReturnScheduler ?? TaskRecordingPageReturnScheduler()
        )
        runtime.onEvent = { [weak self] event in
            self?.handleRuntimeEvent(event)
        }
    }

    @discardableResult
    func startManual(plan: PreDivePlan) -> Bool {
        guard case .idle = phase else {
            return false
        }

        failureFeedback = nil
        guard recorder.startSession(plan: plan) else {
            phase = .startPersistenceError(source: .manual)
            return false
        }
        guard acquireManualRuntime(source: .manual) else {
            return false
        }
        phase = .recording(source: .manual, plan: plan)
        haptics.play(.start)
        actionButtonDonor.donateDiveAction()
        return true
    }

    /// One Action Button press, whatever the phase. Recording pages through the readouts, and a press
    /// on the End page asks to end through `requestActionButtonEnd()`. Saving and runtime handoffs
    /// reject the press. Every other phase starts a dive, as the first press always has.
    func handleActionButtonPress() -> DiveActionOutcome {
        let outcome: DiveActionOutcome
        switch phase {
        case .recording:
            outcome = isEnding ? .rejected(.busy) : handleRecordingActionButtonPress()
        case .completing, .awaitingRuntimeInvalidation:
            outcome = .rejected(.busy)
        case .idle, .wetReady, .savedSummary, .noSamples, .startPersistenceError, .savePersistenceError:
            outcome = startFromActionButton() ? .started : .rejected(.startFailed)
        }

        switch outcome {
        case .started, .modeSwitched:
            haptics.play(.start)
        case .endRequested:
            haptics.play(.endRequested)
        case .rejected:
            haptics.play(.rejected)
            if outcome == .rejected(.startFailed) {
                reportFailure(String(localized: "Could not start recording."))
            }
        case .pageChanged:
            // The page model plays the page-change haptic for both the Action Button and the crown.
            break
        }
        recordingPages.recordActionFeedback(outcome)
        return outcome
    }

    @discardableResult
    func startFromActionButton() -> Bool {
        guard prepareForNewSession() else {
            return false
        }
        let plan: PreDivePlan
        switch phase {
        case .idle:
            plan = preferredPlan()
        case let .wetReady(mode):
            plan = PreDivePlan(diveMode: mode)
        default:
            return false
        }

        wetReadyExitScheduler.cancel()
        guard recorder.startSession(plan: plan) else {
            phase = .startPersistenceError(source: .actionButton)
            return false
        }
        guard acquireManualRuntime(source: .actionButton) else {
            return false
        }
        phase = .recording(source: .actionButton, plan: plan)
        return true
    }

    func receiveWaterState(_ state: WaterSubmersionState) {
        switch state {
        case .submerged:
            wetReadyExitScheduler.cancel()
            guard !suppressesWetReadyUntilDry else { return }
            if case .savedSummary = phase {
                phase = .idle
            }
            guard case .idle = phase else { return }
            phase = .wetReady(mode: preferredMode())
        case .notSubmerged:
            suppressesWetReadyUntilDry = false
            guard case .wetReady = phase else { return }
            wetReadyExitScheduler.schedule { [weak self] in
                guard let self,
                      self.water.latestState == .notSubmerged,
                      case .wetReady = self.phase
                else {
                    return
                }
                self.phase = .idle
            }
        case .unknown:
            wetReadyExitScheduler.cancel()
        }
    }

    func selectWetReadyMode(_ mode: DiveMode) {
        guard case let .wetReady(currentMode) = phase,
              currentMode != mode
        else {
            return
        }
        updatePreferredMode(mode)
        phase = .wetReady(mode: mode)
    }

    func dismissWetReady() {
        guard case .wetReady = phase else { return }
        wetReadyExitScheduler.cancel()
        suppressesWetReadyUntilDry = water.latestState != .notSubmerged
        phase = .idle
    }

    /// The existing end path: out of the water and at least `minimumHardwareEndElapsedSeconds` in.
    func requestActionButtonEnd() -> Bool {
        guard case .recording = phase,
              !isEnding,
              recorder.elapsedTime >= minimumHardwareEndElapsedSeconds,
              water.latestState == .notSubmerged
        else {
            return false
        }

        isEnding = true
        runtime.invalidate()
        return true
    }

    func keepPendingRecordForRetry(_ record: DiveSessionRecord) {
        pendingRecords[record.id] = record
    }

    func returnHomeKeepingPendingRecord() {
        guard case let .savePersistenceError(record) = phase else { return }
        keepPendingRecordForRetry(record)
        // This clears memory only. Never cancel: cancellation deletes the unsaved journal.
        recorder.resetCompletedSession()
        suppressesWetReadyUntilDry = water.latestState != .notSubmerged
        phase = .idle
    }

    func retryPendingRecords() {
        for record in Array(pendingRecords.values) {
            if sessionStore.save(record) {
                pendingRecords.removeValue(forKey: record.id)
            }
        }
    }

    func retryCompletedSessionSave() {
        guard case let .savePersistenceError(record) = phase else { return }
        persistCompletedRecord(record)
    }

    func dismissSavedSummary() {
        guard case .savedSummary = phase else { return }
        phase = .idle
        receiveWaterState(water.latestState)
    }

    func dismissNoSamples() {
        guard case .noSamples = phase else {
            return
        }

        guard recorder.cancelSession() else {
            reportFailure(String(localized: "Could not return Home. Please retry."))
            return
        }
        phase = .idle
    }

    func dismissStartPersistenceError() {
        guard case .startPersistenceError = phase else {
            return
        }
        guard recorder.cancelSession() else {
            reportFailure(String(localized: "Could not return Home. Please retry."))
            return
        }
        phase = .idle
    }

    private func handleRuntimeEvent(_ event: DiveRuntimeEvent) {
        switch event {
        case .adoptedSystemSession:
            startAdoptedSystemSession()
        case .didInvalidate:
            if case let .awaitingRuntimeInvalidation(source) = phase {
                phase = .startPersistenceError(source: source)
            } else {
                finalizeAfterRuntimeInvalidation()
            }
        case .didStart, .willExpire:
            break
        }
    }

    private func startAdoptedSystemSession() {
        guard prepareForNewSession() else {
            return
        }
        let plan: PreDivePlan
        switch phase {
        case .idle:
            plan = preferredPlan()
        case let .wetReady(mode):
            plan = PreDivePlan(diveMode: mode)
        default:
            return
        }

        wetReadyExitScheduler.cancel()
        guard recorder.startSession(plan: plan) else {
            phase = .awaitingRuntimeInvalidation(source: .systemAutoLaunch)
            runtime.invalidate()
            return
        }
        phase = .recording(source: .systemAutoLaunch, plan: plan)
        actionButtonDonor.donateDiveAction()
    }

    private func handleRecordingActionButtonPress() -> DiveActionOutcome {
        if recordingPages.page == .switchMode {
            return switchDiveModeBeforeFirstDescent()
        }
        guard recordingPages.page == .end else {
            return .pageChanged(recordingPages.advanceFromActionButton())
        }
        guard requestActionButtonEnd() else {
            recordingPages.returnToLiveAfterRejectedEnd()
            return .rejected(.endUnavailable)
        }
        return .endRequested
    }

    /// An Action Button press on the switch page. Restarts the recording as the other dive type, keeping
    /// the runtime session. Allowed only before the first descent below the switch limit, so the
    /// discarded part holds no dive. There is no touch path: the touchscreen is locked while recording.
    private func switchDiveModeBeforeFirstDescent() -> DiveActionOutcome {
        // The page model tracks the recorder's maximum depth and closes the switch at the limit.
        guard case let .recording(source, plan) = phase, recordingPages.modeSwitchAvailable else {
            return .rejected(.modeSwitchUnavailable)
        }

        let nextMode: DiveMode = plan.diveMode == .freedive ? .scuba : .freedive
        // A selected plan belongs to one dive type, so switching drops its link.
        var nextPlan = plan.sourcePlanLocalId == nil ? plan : plan.withoutPlannedDiveLink
        nextPlan.diveMode = nextMode

        // Cancelling stops capture even when it cannot clear the empty recording, so either failure
        // leaves nothing recording. Same recovery as a failed adopted start: end the runtime, and the
        // start error screen retries the cleanup.
        guard recorder.cancelSession(), recorder.startSession(plan: nextPlan) else {
            reportFailure(String(localized: "Could not switch the dive type."))
            phase = .awaitingRuntimeInvalidation(source: source)
            runtime.invalidate()
            return .rejected(.modeSwitchFailed)
        }
        updatePreferredMode(nextMode)
        phase = .recording(source: source, plan: nextPlan)
        recordingPages.restartRecording()
        return .modeSwitched(nextMode)
    }

    private func preferredPlan() -> PreDivePlan {
        PreDivePlan(diveMode: preferredMode())
    }

    /// Clears a finished-session screen so the next dive can start, because the diver
    /// cannot dismiss it underwater. Returns false while a recording or runtime handoff is in progress.
    private func prepareForNewSession() -> Bool {
        switch phase {
        case .idle, .wetReady:
            failureFeedback = nil
            return true
        case .savedSummary:
            failureFeedback = nil
            phase = .idle
            return true
        case .noSamples, .startPersistenceError:
            guard recorder.cancelSession() else {
                return false
            }
            phase = .idle
            return true
        case let .savePersistenceError(record):
            persistCompletedRecord(record, deferred: false)
            if case .savePersistenceError = phase {
                // Keep the unsaved journal on disk; launch recovery restores it as an interrupted session.
                keepPendingRecordForRetry(record)
                recorder.resetCompletedSession()
            }
            phase = .idle
            return true
        case .recording, .completing, .awaitingRuntimeInvalidation:
            return false
        }
    }

    private func acquireManualRuntime(source: RealDiveStartSource) -> Bool {
        guard runtime.startManualSession() else {
            _ = recorder.cancelSession()
            phase = .awaitingRuntimeInvalidation(source: source)
            runtime.invalidate()
            return false
        }
        return true
    }

    private func finalizeAfterRuntimeInvalidation() {
        guard case let .recording(source, _) = phase else {
            return
        }

        guard recorder.hasCapturedDepthSample else {
            cancelWithoutSamples(source: source)
            return
        }

        guard let record = recorder.stopSession() else {
            cancelWithoutSamples(source: source)
            return
        }

        persistCompletedRecord(record)
    }

    /// Shows the saving state, then saves. `deferred: false` saves right away for callers that
    /// need the result before they return.
    private func persistCompletedRecord(_ record: DiveSessionRecord, deferred: Bool = true) {
        phase = .completing(record: record)
        guard deferred else {
            finishPersisting(record)
            return
        }
        schedulePersistence { [weak self] in
            self?.finishPersisting(record)
        }
    }

    private func finishPersisting(_ record: DiveSessionRecord) {
        guard case let .completing(pending) = phase, pending.id == record.id else {
            return
        }
        guard sessionStore.save(record) else {
            phase = .savePersistenceError(record: record)
            reportFailure(String(localized: "Save failed. Your log is kept."))
            return
        }

        recorder.resetCompletedSession()
        phase = .savedSummary(record: record)
        failureFeedback = nil
        haptics.play(.saved)
    }

    private func reportFailure(_ message: String) {
        failureCount += 1
        failureFeedback = String(localized: "\(message) (\(failureCount))")
    }

    private func cancelWithoutSamples(source: RealDiveStartSource) {
        let didClearActiveRecording = recorder.cancelSession()
        phase = source == .systemAutoLaunch && didClearActiveRecording ? .idle : .noSamples
    }
}
