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
                WatchFlowFailureNote(message: message)
            }
            if recordingMode == .demo, lifecycle.showsRecordingControls {
                Text(String(localized: "Adjust depth with the Digital Crown"))
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .frame(maxWidth: .infinity)
                    .allowsHitTesting(false)
            }
        }
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
            markerTitle: recordingMode.markerTitle
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

    private var savingView: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(DiveWatchTheme.primary)
            Text("Saving log")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    private var savePersistenceErrorView: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "externaldrive.badge.exclamationmark")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.danger)

                Text("Keeping your captured log.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .multilineTextAlignment(.center)

                Text(String(localized: "Kept for automatic save retry from Home."))
                    .font(.system(size: 11))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.center)

                Text(String(localized: "The Action Button retries saving this demo log."))
                    .font(.system(size: 11))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.center)

                if let message = lifecycle.failureFeedback {
                    WatchFlowFailureNote(message: message, dismissesAutomatically: false)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button("Retry Save") {
                    _ = endDive()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button(String(localized: "Back to Home")) {
                    guard lifecycle.returnHomeKeepingPendingRecord(keepPendingRecord) else { return }
                    removeActionButtonEndOverride()
                    dismiss()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
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
