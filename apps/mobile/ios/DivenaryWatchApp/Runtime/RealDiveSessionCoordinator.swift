import Combine
import Foundation

enum RealDiveStartSource: Equatable {
    case manual
    case systemAutoLaunch
    case actionButton
}

enum RealDivePhase {
    case idle
    case recording(source: RealDiveStartSource)
    case summary(DiveSessionRecord)
    case noSamples
}

@MainActor
protocol DiveSessionRecording: AnyObject {
    var elapsedTime: TimeInterval { get }
    var hasCapturedDepthSample: Bool { get }

    func startSession(plan: PreDivePlan)
    func stopSession() -> DiveSessionRecord?
    func cancelSession()
}

@MainActor
protocol DiveActionButtonDonating: AnyObject {
    func donateEndAction()
}

@MainActor
final class RealDiveSessionCoordinator: ObservableObject {
    @Published private(set) var phase: RealDivePhase = .idle

    private let preferredMode: () -> DiveMode
    private let runtime: DiveRuntimeSessionControlling
    private let recorder: DiveSessionRecording
    private let water: WaterSubmersionStateReading
    private let actionButtonDonor: DiveActionButtonDonating

    init(
        preferredMode: @escaping () -> DiveMode,
        runtime: DiveRuntimeSessionControlling,
        recorder: DiveSessionRecording,
        water: WaterSubmersionStateReading,
        actionButtonDonor: DiveActionButtonDonating
    ) {
        self.preferredMode = preferredMode
        self.runtime = runtime
        self.recorder = recorder
        self.water = water
        self.actionButtonDonor = actionButtonDonor
        runtime.onEvent = { [weak self] event in
            self?.handleRuntimeEvent(event)
        }
    }

    func startManual(plan: PreDivePlan) {
        guard case .idle = phase else {
            return
        }

        recorder.startSession(plan: plan)
        phase = .recording(source: .manual)
        runtime.startManualSession()
        actionButtonDonor.donateEndAction()
    }

    func startFromActionButton() {
        guard case .idle = phase else {
            return
        }

        recorder.startSession(plan: preferredPlan())
        phase = .recording(source: .actionButton)
        runtime.startManualSession()
    }

    func requestActionButtonEnd() -> Bool {
        guard case .recording = phase,
              water.latestState == .notSubmerged,
              recorder.elapsedTime >= 180
        else {
            return false
        }

        runtime.invalidate()
        return true
    }

    func markSummarySaved() {
        guard case .summary = phase else {
            return
        }

        recorder.cancelSession()
        phase = .idle
    }

    func discardSummary() {
        guard case .summary = phase else {
            return
        }

        recorder.cancelSession()
        phase = .idle
    }

    func dismissNoSamples() {
        guard case .noSamples = phase else {
            return
        }

        phase = .idle
    }

    private func handleRuntimeEvent(_ event: DiveRuntimeEvent) {
        switch event {
        case .adoptedSystemSession:
            startAdoptedSystemSession()
        case .didInvalidate:
            finalizeAfterRuntimeInvalidation()
        case .didStart, .willExpire:
            break
        }
    }

    private func startAdoptedSystemSession() {
        guard case .idle = phase else {
            return
        }

        recorder.startSession(plan: preferredPlan())
        phase = .recording(source: .systemAutoLaunch)
        actionButtonDonor.donateEndAction()
    }

    private func preferredPlan() -> PreDivePlan {
        PreDivePlan(diveMode: preferredMode())
    }

    private func finalizeAfterRuntimeInvalidation() {
        guard case let .recording(source) = phase else {
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

        phase = .summary(record)
    }

    private func cancelWithoutSamples(source: RealDiveStartSource) {
        recorder.cancelSession()
        phase = source == .systemAutoLaunch ? .idle : .noSamples
    }
}
