import Combine
import SwiftUI

enum SimulatedRecordingLifecyclePhase {
    case ready
    case recording
    case summary(DiveSessionRecord)
    case persistenceError
    case cleanupError
    case completed
}

@MainActor
protocol SimulatedRecordingLifecycleRecording: AnyObject {
    @discardableResult
    func startSession(plan: PreDivePlan) -> Bool
    func stopSession() -> DiveSessionRecord?
    @discardableResult
    func cancelSession() -> Bool
    func resetCompletedSession()
}

extension DiveSessionRecorder: SimulatedRecordingLifecycleRecording {}

@MainActor
protocol SimulatedRecordingSessionStoring: AnyObject {
    func save(_ session: DiveSessionRecord) -> Bool
}

extension DiveSessionStore: SimulatedRecordingSessionStoring {}

@MainActor
final class SimulatedRecordingLifecycleController: ObservableObject {
    @Published private(set) var phase: SimulatedRecordingLifecyclePhase = .ready

    var hidesSystemBackButton: Bool {
        switch phase {
        case .recording, .summary, .cleanupError:
            return true
        case .ready, .persistenceError, .completed:
            return false
        }
    }

    private let recorder: any SimulatedRecordingLifecycleRecording
    private let store: any SimulatedRecordingSessionStoring
    private var didStart = false
    private var didComplete = false

    init(
        recorder: some SimulatedRecordingLifecycleRecording,
        store: some SimulatedRecordingSessionStoring
    ) {
        self.recorder = recorder
        self.store = store
    }

    @discardableResult
    func handleFlowAppearance(plan: PreDivePlan) -> Bool {
        if didComplete, case .completed = phase {
            return true
        }
        guard !didStart, case .ready = phase else { return false }

        _ = startRecording(plan: plan)
        return false
    }

    @discardableResult
    func retryStart(plan: PreDivePlan) -> Bool {
        guard !didStart, !didComplete, case .persistenceError = phase else {
            return false
        }
        return startRecording(plan: plan)
    }

    @discardableResult
    func dismissPersistenceError() -> Bool {
        guard !didStart, !didComplete, case .persistenceError = phase else {
            return false
        }
        markCompleted()
        return true
    }

    @discardableResult
    func finishRecording() -> Bool {
        guard case .recording = phase,
              let session = recorder.stopSession()
        else {
            return false
        }

        phase = .summary(session)
        return true
    }

    @discardableResult
    func saveSummary(_ session: DiveSessionRecord) -> Bool {
        guard case .summary = phase,
              !didComplete,
              store.save(session)
        else {
            return false
        }

        markCompleted()
        recorder.resetCompletedSession()
        return true
    }

    @discardableResult
    func discardSummary() -> Bool {
        guard case .summary = phase,
              !didComplete,
              recorder.cancelSession()
        else {
            return false
        }

        markCompleted()
        return true
    }

    func handleFlowDisappearance() {
        guard didStart, !didComplete else { return }

        switch phase {
        case .recording:
            guard recorder.cancelSession() else {
                phase = .cleanupError
                return
            }
            markCompleted()
        case .summary:
            guard recorder.cancelSession() else { return }
            markCompleted()
        case .ready, .persistenceError, .cleanupError, .completed:
            break
        }
    }

    @discardableResult
    func retryExternalCleanup() -> Bool {
        guard didStart, !didComplete, case .cleanupError = phase,
              recorder.cancelSession()
        else {
            return false
        }
        markCompleted()
        return true
    }

    private func startRecording(plan: PreDivePlan) -> Bool {
        guard recorder.startSession(plan: plan) else {
            phase = .persistenceError
            return false
        }
        didStart = true
        phase = .recording
        return true
    }

    private func markCompleted() {
        didComplete = true
        phase = .completed
    }
}

struct SimulatedRecordingFlowView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    let recordingMode: WatchRecordingMode
    let actionButtonBridge: DiveActionButtonBridge
    let actionButtonDonor: DiveActionButtonDonating

    @StateObject private var recorder: DiveSessionRecorder
    @StateObject private var lifecycle: SimulatedRecordingLifecycleController
    @State private var controlledDepthMeters: Double = 0
    @State private var actionButtonEndOverrideToken: UUID?
    @FocusState private var crownDepthControlFocused: Bool
    @Environment(\.dismiss) private var dismiss

    init(
        store: DiveSessionStore,
        plan: PreDivePlan,
        recordingMode: WatchRecordingMode,
        actionButtonBridge: DiveActionButtonBridge,
        actionButtonDonor: DiveActionButtonDonating
    ) {
        precondition(recordingMode != .real, "Real recording must use the app-scoped service graph")
        guard let sensorProvider = recordingMode.makeSimulatedSensorProvider() else {
            preconditionFailure("Simulated recording requires a demo depth provider")
        }

        self.store = store
        self.plan = plan
        self.recordingMode = recordingMode
        self.actionButtonBridge = actionButtonBridge
        self.actionButtonDonor = actionButtonDonor
        let recorder = DiveSessionRecorder(
            sensorProvider: sensorProvider,
            captureMode: recordingMode.captureMode
        )
        _recorder = StateObject(wrappedValue: recorder)
        _lifecycle = StateObject(
            wrappedValue: SimulatedRecordingLifecycleController(
                recorder: recorder,
                store: store
            )
        )
    }

    var body: some View {
        ZStack {
            flowContent
        }
        .navigationBarBackButtonHidden(lifecycle.hidesSystemBackButton)
        .onAppear {
            if lifecycle.handleFlowAppearance(plan: preparedPlan) {
                dismiss()
                return
            }
            recorder.setDemoDepthMeters(controlledDepthMeters)
            installActionButtonEndOverride()
            crownDepthControlFocused = true
        }
        .onDisappear {
            removeActionButtonEndOverride()
            lifecycle.handleFlowDisappearance()
        }
        .onChange(of: recorder.currentDepth) { _, _ in
            crownDepthControlFocused = true
        }
    }

    @ViewBuilder
    private var flowContent: some View {
        switch lifecycle.phase {
        case .ready, .recording:
            recordingContent
        case .summary(let session):
            CapturedSessionSummaryView(
                session: session,
                onSave: { save(session) },
                onDiscard: discard
            )
        case .persistenceError:
            persistenceErrorView
        case .cleanupError:
            cleanupErrorView
        case .completed:
            Color.clear
        }
    }

    private var recordingContent: some View {
        RecordingInstrumentView(
            recorder: recorder,
            plan: preparedPlan,
            maximumDepthMeters: nil,
            endControl: recordingMode.endControl,
            onEndDive: {
                _ = endDive()
            }
        )
        .focusable(recordingMode.controlPolicy.usesCrownDepthControl)
        .focused($crownDepthControlFocused)
        .digitalCrownRotation(
            $controlledDepthMeters,
            from: 0,
            through: 60,
            by: 0.1,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onChange(of: controlledDepthMeters) { _, nextDepthMeters in
            recorder.setDemoDepthMeters(nextDepthMeters)
        }
    }

    private var preparedPlan: PreDivePlan {
        recordingMode.prepare(plan: plan)
    }

    private var persistenceErrorView: some View {
        VStack(spacing: 10) {
            Image(systemName: "externaldrive.badge.exclamationmark")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)

            Text("Recording unavailable")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            HStack(spacing: 8) {
                Button("Retry") {
                    if lifecycle.retryStart(plan: preparedPlan) {
                        recorder.setDemoDepthMeters(controlledDepthMeters)
                        installActionButtonEndOverride()
                        crownDepthControlFocused = true
                    }
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button("Done") {
                    guard lifecycle.dismissPersistenceError() else { return }
                    dismiss()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
            }
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    private var cleanupErrorView: some View {
        VStack(spacing: 10) {
            Image(systemName: "externaldrive.badge.exclamationmark")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)

            Text("Cleanup required")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            Button("Retry") {
                guard lifecycle.retryExternalCleanup() else { return }
                dismiss()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    @discardableResult
    private func endDive() -> Bool {
        lifecycle.finishRecording()
    }

    private func save(_ session: DiveSessionRecord) {
        guard lifecycle.saveSummary(session) else { return }
        removeActionButtonEndOverride()
        dismiss()
    }

    private func discard() {
        guard lifecycle.discardSummary() else { return }
        removeActionButtonEndOverride()
        dismiss()
    }

    private func installActionButtonEndOverride() {
        guard actionButtonEndOverrideToken == nil else {
            return
        }
        actionButtonEndOverrideToken = actionButtonBridge.installEndOverride {
            endDive()
        }
        actionButtonDonor.donateEndAction()
    }

    private func removeActionButtonEndOverride() {
        guard let actionButtonEndOverrideToken else {
            return
        }
        actionButtonBridge.removeEndOverride(actionButtonEndOverrideToken)
        self.actionButtonEndOverrideToken = nil
    }
}
