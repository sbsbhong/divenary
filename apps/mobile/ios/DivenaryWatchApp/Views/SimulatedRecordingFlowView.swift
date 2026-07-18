import Combine
import SwiftUI

struct SimulatedRecordingFlowView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    let recordingMode: WatchRecordingMode

    @StateObject private var recorder: DiveSessionRecorder
    @State private var completedSession: DiveSessionRecord?
    @State private var controlledDepthMeters: Double = 0
    @State private var surfaceEndGate = SurfaceEndDiveGate()
    @State private var didCompleteCleanup = false
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
        _recorder = StateObject(
            wrappedValue: DiveSessionRecorder(
                sensorProvider: sensorProvider,
                captureMode: recordingMode.captureMode
            )
        )
    }

    var body: some View {
        Group {
            if let completedSession {
                SummaryView(
                    session: completedSession,
                    onSave: save,
                    onDiscard: discard
                )
            } else {
                RecordingInstrumentView(
                    recorder: recorder,
                    plan: recordingMode.prepare(plan: plan),
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
        }
        .navigationBarBackButtonHidden(recorder.isRecording)
        .onAppear {
            recorder.startSession(plan: recordingMode.prepare(plan: plan))
            recorder.setDemoDepthMeters(controlledDepthMeters)
            crownDepthControlFocused = true
        }
        .onDisappear {
            guard !didCompleteCleanup else { return }
            _ = recorder.cancelSession()
        }
        .onChange(of: recorder.currentDepth) { _, _ in
            updateSurfaceEndGate()
        }
        .onReceive(surfaceGateTimer) { timestamp in
            guard completedSession == nil else { return }
            updateSurfaceEndGate(at: timestamp)
        }
    }

    private func endDive() {
        completedSession = recorder.stopSession()
    }

    private func save(_ session: DiveSessionRecord) {
        guard store.save(session) else { return }
        recorder.resetCompletedSession()
        didCompleteCleanup = true
        dismiss()
    }

    private func discard() {
        guard recorder.cancelSession() else { return }
        didCompleteCleanup = true
        dismiss()
    }

    private func updateSurfaceEndGate(at timestamp: Date = Date()) {
        surfaceEndGate.update(depthMeters: recorder.currentDepth, at: timestamp)
    }
}
