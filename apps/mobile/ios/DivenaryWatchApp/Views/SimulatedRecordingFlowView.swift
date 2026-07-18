import Combine
import SwiftUI

enum SimulatedRecordingLifecyclePhase {
    case ready
    case recording
    case summary(DiveSessionRecord)
    case completed
}

@MainActor
protocol SimulatedRecordingLifecycleRecording: AnyObject {
    func startSession(plan: PreDivePlan)
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

    func handleFlowAppearance(plan: PreDivePlan) {
        guard !didStart, !didComplete, case .ready = phase else { return }

        didStart = true
        recorder.startSession(plan: plan)
        phase = .recording
    }

    func finishRecording() {
        guard case .recording = phase,
              let session = recorder.stopSession()
        else {
            return
        }

        phase = .summary(session)
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
        case .recording, .summary:
            guard recorder.cancelSession() else { return }
            markCompleted()
        case .ready, .completed:
            break
        }
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

    @StateObject private var recorder: DiveSessionRecorder
    @StateObject private var lifecycle: SimulatedRecordingLifecycleController
    @State private var controlledDepthMeters: Double = 0
    @State private var surfaceEndGate = SurfaceEndDiveGate()
    @FocusState private var crownDepthControlFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private let surfaceGateTimer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    init(store: DiveSessionStore, plan: PreDivePlan, recordingMode: WatchRecordingMode) {
        precondition(recordingMode != .real, "Real recording must use the app-scoped service graph")
        guard let sensorProvider = recordingMode.makeSimulatedSensorProvider() else {
            preconditionFailure("Simulated recording requires a demo depth provider")
        }

        self.store = store
        self.plan = plan
        self.recordingMode = recordingMode
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
        .navigationBarBackButtonHidden(recorder.isRecording)
        .onAppear {
            lifecycle.handleFlowAppearance(plan: preparedPlan)
            recorder.setDemoDepthMeters(controlledDepthMeters)
            crownDepthControlFocused = true
        }
        .onDisappear {
            lifecycle.handleFlowDisappearance()
        }
        .onChange(of: recorder.currentDepth) { _, _ in
            updateSurfaceEndGate()
        }
        .onReceive(surfaceGateTimer) { timestamp in
            guard case .recording = lifecycle.phase else { return }
            updateSurfaceEndGate(at: timestamp)
        }
    }

    @ViewBuilder
    private var flowContent: some View {
        switch lifecycle.phase {
        case .ready, .recording:
            recordingContent
        case .summary(let session):
            SummaryView(
                session: session,
                onSave: save,
                onDiscard: discard
            )
        case .completed:
            Color.clear
        }
    }

    private var recordingContent: some View {
        RecordingInstrumentView(
            recorder: recorder,
            plan: preparedPlan,
            controlPolicy: recordingMode.controlPolicy,
            maximumDepthMeters: nil,
            showsTouchEndControl: surfaceEndGate.isVisible,
            onTouchEnd: endDive
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

    private func endDive() {
        lifecycle.finishRecording()
    }

    private func save(_ session: DiveSessionRecord) {
        guard lifecycle.saveSummary(session) else { return }
        dismiss()
    }

    private func discard() {
        guard lifecycle.discardSummary() else { return }
        dismiss()
    }

    private func updateSurfaceEndGate(at timestamp: Date = Date()) {
        surfaceEndGate.update(depthMeters: recorder.currentDepth, at: timestamp)
    }
}
