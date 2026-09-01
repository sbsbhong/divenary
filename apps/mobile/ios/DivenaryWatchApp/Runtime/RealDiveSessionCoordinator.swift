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
    var currentDepth: Double { get }
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
    func donateEndAction()
}

@MainActor
final class RealDiveSessionCoordinator: ObservableObject {
    @Published private(set) var phase: RealDivePhase = .idle

    private let preferredMode: () -> DiveMode
    private let updatePreferredMode: (DiveMode) -> Void
    private let runtime: DiveRuntimeSessionControlling
    private let recorder: DiveSessionRecording
    private let sessionStore: DiveSessionPersisting
    private let water: WaterSubmersionStateReading
    private let actionButtonDonor: DiveActionButtonDonating
    private let wetReadyExitScheduler: WetReadyExitScheduling
    private let minimumHardwareEndElapsedSeconds: TimeInterval = 180
    private let surfaceEndDepthMeters = 1.0

    init(
        preferredMode: @escaping () -> DiveMode,
        updatePreferredMode: @escaping (DiveMode) -> Void,
        runtime: DiveRuntimeSessionControlling,
        recorder: DiveSessionRecording,
        water: WaterSubmersionStateReading,
        actionButtonDonor: DiveActionButtonDonating,
        wetReadyExitScheduler: WetReadyExitScheduling? = nil,
        sessionStore: DiveSessionPersisting
    ) {
        self.preferredMode = preferredMode
        self.updatePreferredMode = updatePreferredMode
        self.runtime = runtime
        self.recorder = recorder
        self.sessionStore = sessionStore
        self.water = water
        self.actionButtonDonor = actionButtonDonor
        self.wetReadyExitScheduler = wetReadyExitScheduler ?? TaskWetReadyExitScheduler()
        runtime.onEvent = { [weak self] event in
            self?.handleRuntimeEvent(event)
        }
    }

    @discardableResult
    func startManual(plan: PreDivePlan) -> Bool {
        guard case .idle = phase else {
            return false
        }

        guard recorder.startSession(plan: plan) else {
            phase = .startPersistenceError(source: .manual)
            return false
        }
        guard acquireManualRuntime(source: .manual) else {
            return false
        }
        phase = .recording(source: .manual, plan: plan)
        actionButtonDonor.donateEndAction()
        return true
    }

    @discardableResult
    func startFromActionButton() -> Bool {
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
            guard case .idle = phase else { return }
            phase = .wetReady(mode: preferredMode())
        case .notSubmerged:
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

    func requestActionButtonEnd() -> Bool {
        guard case .recording = phase,
              recorder.elapsedTime >= minimumHardwareEndElapsedSeconds,
              canEndFromCurrentSurfaceState
        else {
            return false
        }

        runtime.invalidate()
        return true
    }

    func retryCompletedSessionSave() {
        guard case let .savePersistenceError(record) = phase else { return }
        persistCompletedRecord(record)
    }

    func dismissSavedSummary() {
        guard case .savedSummary = phase else { return }
        phase = .idle
    }

    func dismissNoSamples() {
        guard case .noSamples = phase else {
            return
        }

        guard recorder.cancelSession() else {
            return
        }
        phase = .idle
    }

    func dismissStartPersistenceError() {
        guard case .startPersistenceError = phase else {
            return
        }
        guard recorder.cancelSession() else {
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
        actionButtonDonor.donateEndAction()
    }

    private func preferredPlan() -> PreDivePlan {
        PreDivePlan(diveMode: preferredMode())
    }

    private var canEndFromCurrentSurfaceState: Bool {
        switch water.latestState {
        case .notSubmerged:
            return true
        case .unknown:
            return recorder.currentDepth <= surfaceEndDepthMeters
        case .submerged:
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

    private func persistCompletedRecord(_ record: DiveSessionRecord) {
        phase = .completing(record: record)
        guard sessionStore.save(record) else {
            phase = .savePersistenceError(record: record)
            return
        }

        recorder.resetCompletedSession()
        phase = .savedSummary(record: record)
    }

    private func cancelWithoutSamples(source: RealDiveStartSource) {
        let didClearActiveRecording = recorder.cancelSession()
        phase = source == .systemAutoLaunch && didClearActiveRecording ? .idle : .noSamples
    }
}
