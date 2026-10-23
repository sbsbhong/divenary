import Combine
import SwiftUI

enum SimulatedRecordingLifecyclePhase {
    case ready
    case recording
    case saving(DiveSessionRecord)
    case savedSummary(DiveSessionRecord)
    case persistenceError
    case savePersistenceError(DiveSessionRecord)
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
    @Published private(set) var failureFeedback: String?
    private var failureCount = 0

    var hidesSystemBackButton: Bool {
        switch phase {
        case .recording, .saving, .savedSummary, .savePersistenceError, .cleanupError:
            return true
        case .ready, .persistenceError, .completed:
            return false
        }
    }

    var showsRecordingControls: Bool {
        if case .recording = phase {
            return true
        }
        return false
    }

    var keepsActionButtonOverride: Bool {
        switch phase {
        case .recording, .saving, .savePersistenceError:
            return true
        default:
            return false
        }
    }

    @discardableResult
    func handleActionButtonPress() -> Bool {
        if case .savePersistenceError = phase { return retryCompletedSessionSave() }
        return finishRecording()
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

        return persistCompletedSession(session)
    }

    @discardableResult
    func retryCompletedSessionSave() -> Bool {
        guard case let .savePersistenceError(session) = phase else { return false }
        return persistCompletedSession(session)
    }

    @discardableResult
    func returnHomeKeepingPendingRecord(_ keepRecord: (DiveSessionRecord) -> Void) -> Bool {
        guard case let .savePersistenceError(session) = phase else { return false }
        keepRecord(session)
        // Reset memory only; the journal remains available for recovery after relaunch too.
        recorder.resetCompletedSession()
        markCompleted()
        return true
    }

    @discardableResult
    func dismissSavedSummary() -> Bool {
        guard case .savedSummary = phase else { return false }
        markCompleted()
        return true
    }

    func handleFlowDisappearance() {
        guard didStart, !didComplete else { return }

        switch phase {
        case .recording:
            guard recorder.cancelSession() else {
                phase = .cleanupError
                reportFailure(String(localized: "Could not return Home. Please retry."))
                return
            }
            markCompleted()
        case .ready, .saving, .savedSummary, .persistenceError, .savePersistenceError,
             .cleanupError, .completed:
            break
        }
    }

    @discardableResult
    func retryExternalCleanup() -> Bool {
        guard didStart, !didComplete, case .cleanupError = phase else { return false }
        guard recorder.cancelSession() else {
            reportFailure(String(localized: "Could not return Home. Please retry."))
            return false
        }
        markCompleted()
        return true
    }

    private func startRecording(plan: PreDivePlan) -> Bool {
        guard recorder.startSession(plan: plan) else {
            phase = .persistenceError
            reportFailure(String(localized: "Could not start recording."))
            return false
        }
        didStart = true
        failureFeedback = nil
        phase = .recording
        return true
    }

    @discardableResult
    private func persistCompletedSession(_ session: DiveSessionRecord) -> Bool {
        phase = .saving(session)
        guard store.save(session) else {
            phase = .savePersistenceError(session)
            reportFailure(String(localized: "Save failed. Your log is kept."))
            return false
        }

        recorder.resetCompletedSession()
        phase = .savedSummary(session)
        failureFeedback = nil
        return true
    }

    private func markCompleted() {
        didComplete = true
        phase = .completed
    }

    private func reportFailure(_ message: String) {
        failureCount += 1
        failureFeedback = String(localized: "\(message) (\(failureCount))")
    }
}

struct SimulatedRecordingFlowView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    let recordingMode: WatchRecordingMode
    let actionButtonBridge: DiveActionButtonBridge
    let actionButtonDonor: DiveActionButtonDonating
    let keepPendingRecord: (DiveSessionRecord) -> Void

    @StateObject private var recorder: DiveSessionRecorder
    @StateObject private var lifecycle: SimulatedRecordingLifecycleController
    @State private var controlledDepthMeters: Double = 0
    @State private var actionButtonEndOverrideToken: UUID?
    @FocusState private var crownDepthControlFocused: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var systemBottomInset: CGFloat = 0

    init(
        store: DiveSessionStore,
        plan: PreDivePlan,
        recordingMode: WatchRecordingMode,
        actionButtonBridge: DiveActionButtonBridge,
        actionButtonDonor: DiveActionButtonDonating,
        keepPendingRecord: @escaping (DiveSessionRecord) -> Void
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
        self.keepPendingRecord = keepPendingRecord
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
        .toolbar {
            if recordingMode == .demo, lifecycle.showsRecordingControls {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        _ = endDive()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel(Text("End demo"))
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if case .savePersistenceError = lifecycle.phase {
                EmptyView()
            } else if let message = lifecycle.failureFeedback {
                WatchFlowFailureNote(message: message, systemBottomInset: systemBottomInset)
            }
        }
        // The banner sits 8 pt above the screen's edge, in the band the system leaves at the bottom.
        .background { SystemBottomInsetReader(inset: $systemBottomInset) }
        .onAppear {
            if lifecycle.handleFlowAppearance(plan: preparedPlan) {
                dismiss()
                return
            }
            if lifecycle.keepsActionButtonOverride { installActionButtonEndOverride() }
            guard case .recording = lifecycle.phase else { return }
            recorder.setDemoDepthMeters(controlledDepthMeters)
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
        case .saving:
            savingView
        case .savedSummary(let session):
            SavedSessionSummaryView(
                session: session,
                onBack: dismissSavedSummary
            )
        case .persistenceError:
            persistenceErrorView
        case .savePersistenceError:
            savePersistenceErrorView
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
            showsNavigationToolbar: recordingMode == .demo,
            markerTitle: recordingMode.markerTitle,
            // The demo's hint chip sits where a real recording's does, without page dots (C13).
            fixedHint: recordingMode == .demo ? String(localized: "Adjust depth with the Digital Crown") : nil
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

    /// The demo could not start (spec F #30): the same screen as a real start error, with a retry.
    private var persistenceErrorView: some View {
        DiveFlowMessage(
            title: String(localized: "Recording unavailable"),
            detail: String(localized: "Recording setup could not be completed.")
        ) {
            DiveFlowErrorGlyph()
        } actions: {
            Button(String(localized: "Retry")) {
                if lifecycle.retryStart(plan: preparedPlan) {
                    recorder.setDemoDepthMeters(controlledDepthMeters)
                    installActionButtonEndOverride()
                    crownDepthControlFocused = true
                }
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))

            Button(String(localized: "Done")) {
                guard lifecycle.dismissPersistenceError() else { return }
                dismiss()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .secondary))
        }
    }

    /// Leaving the demo could not cancel its recording; the banner says what failed.
    private var cleanupErrorView: some View {
        DiveFlowMessage(title: String(localized: "Cleanup required")) {
            DiveFlowErrorGlyph()
        } actions: {
            Button(String(localized: "Retry")) {
                guard lifecycle.retryExternalCleanup() else { return }
                dismiss()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
    }

    @discardableResult
    private func endDive() -> Bool {
        let didFinish = lifecycle.handleActionButtonPress()
        if lifecycle.keepsActionButtonOverride {
            return didFinish
        }
        removeActionButtonEndOverride()
        return didFinish
    }

    private func dismissSavedSummary() {
        guard lifecycle.dismissSavedSummary() else { return }
        removeActionButtonEndOverride()
        dismiss()
    }

    /// Shown at once, like a real recording's saving screen (spec F #28).
    private var savingView: some View {
        DiveFlowProgress(title: String(localized: "Saving log"))
    }

    private var savePersistenceErrorView: some View {
        DiveSaveFailureView(
            failureFeedback: lifecycle.failureFeedback,
            actionButtonNote: String(localized: "The Action Button retries saving this demo log."),
            onRetry: { _ = endDive() },
            onHome: {
                guard lifecycle.returnHomeKeepingPendingRecord(keepPendingRecord) else { return }
                removeActionButtonEndOverride()
                dismiss()
            }
        )
    }

    private func installActionButtonEndOverride() {
        guard actionButtonEndOverrideToken == nil else {
            return
        }
        actionButtonEndOverrideToken = actionButtonBridge.installEndOverride {
            endDive()
        }
        actionButtonDonor.donateDiveAction()
    }

    private func removeActionButtonEndOverride() {
        guard let actionButtonEndOverrideToken else {
            return
        }
        actionButtonBridge.removeEndOverride(actionButtonEndOverrideToken)
        self.actionButtonEndOverrideToken = nil
    }
}
