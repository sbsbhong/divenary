import SwiftUI

struct RealRecordingFlowView: View {
    @ObservedObject var water: WaterSubmersionCoordinator
    @ObservedObject var recorder: DiveSessionRecorder
    @ObservedObject var coordinator: RealDiveSessionCoordinator
    /// Chooses the Wet Ready start copy. Home reads it from watchOS.
    var autoLaunchStatus: DepthAutoLaunchStatus = .unknown
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var systemBottomInset: CGFloat = 0

    var body: some View {
        Group {
            switch coordinator.phase {
            case .idle:
                EmptyView()
            case .wetReady(let mode):
                WetReadyView(
                    mode: mode,
                    currentDepthMeters: water.latestDepthMeters,
                    autoLaunchStatus: autoLaunchStatus,
                    hasActionButton: ActionButtonHint.current.isLikelyUltra,
                    onSelect: coordinator.selectWetReadyMode,
                    onHome: coordinator.dismissWetReady
                )
            case .recording(_, let plan):
                RecordingInstrumentView(
                    recorder: recorder,
                    plan: plan,
                    maximumDepthMeters: water.maximumDepthMeters,
                    endControl: WatchRecordingMode.real.endControl,
                    waterState: water.latestState,
                    pages: coordinator.recordingPages
                )
                // RC-END: the instrument stays visible at 30 % under the ending line. Nothing
                // moves; the dim and the line only fade.
                .opacity(coordinator.isEnding ? 0.3 : 1)
                .overlay {
                    if coordinator.isEnding {
                        endingView
                            .transition(.opacity)
                    }
                }
                .animation(DiveMotion.animation(.ending, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced),
                           value: coordinator.isEnding)
            case .completing:
                savingView
            case .savedSummary(let session):
                SavedSessionSummaryView(
                    session: session,
                    onBack: coordinator.dismissSavedSummary,
                    showsNextDiveHint: ActionButtonHint.current.isLikelyUltra
                )
            case .noSamples:
                noSamplesView
            case .awaitingRuntimeInvalidation:
                startPersistenceErrorView(allowsDismissal: false)
            case .startPersistenceError:
                startPersistenceErrorView(allowsDismissal: true)
            case .savePersistenceError:
                savePersistenceErrorView
            }
        }
        .navigationBarBackButtonHidden(true)
        .safeAreaInset(edge: .bottom) {
            if case .savePersistenceError = coordinator.phase {
                EmptyView()
            } else if let message = coordinator.failureFeedback {
                WatchFlowFailureNote(message: message, systemBottomInset: systemBottomInset)
            }
        }
        // The banner sits 8 pt above the screen's edge, in the band the system leaves at the bottom.
        .background { SystemBottomInsetReader(inset: $systemBottomInset) }
        .onChange(of: scenePhase) { _, nextPhase in
            if nextPhase == .active {
                coordinator.retryCompletedSessionSave()
            }
        }
    }

    /// Nothing was recorded underwater, so nothing was saved (COPY C14): Divenary's depth column, not
    /// a water symbol (D17).
    private var noSamplesView: some View {
        DiveFlowMessage(
            title: String(localized: "No depth samples captured"),
            detail: String(localized: "No values were recorded, so nothing was saved.")
        ) {
            DepthColumnGlyph()
                .foregroundStyle(DiveWatchTheme.ink2)
                .frame(width: PostDiveLayout.noSamplesGlyph, height: PostDiveLayout.noSamplesGlyph)
        } actions: {
            Button(String(localized: "Done")) {
                coordinator.dismissNoSamples()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
    }

    /// Recording could not start (spec F #30). The attempt note shows as the bottom banner.
    private func startPersistenceErrorView(allowsDismissal: Bool) -> some View {
        DiveFlowMessage(
            title: String(localized: "Recording unavailable"),
            detail: String(localized: "Recording setup could not be completed.")
        ) {
            DiveFlowErrorGlyph()
        } actions: {
            if allowsDismissal {
                Button(String(localized: "Done")) {
                    coordinator.dismissStartPersistenceError()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))
            } else {
                DiveFlowSpinner()
                BusyPressNote(pages: coordinator.recordingPages)
            }
        }
        .reservingFailureBanner(coordinator.failureFeedback != nil)
    }

    /// Shown at once, not after a delay: saving holds the main thread, so a timer could not fire. It
    /// has no background, so the dimmed instrument stays behind it, and it sits centred over the
    /// readout column, right of the gauge (spec F #27, RC-END, DECISIONS D20).
    private var endingView: some View {
        DiveFlowProgress(title: String(localized: "Ending recording"), coversContent: false) {
            BusyPressNote(pages: coordinator.recordingPages)
        }
        .padding(.leading, RecordingInstrumentView.readoutColumnLeading)
    }

    private var savingView: some View {
        DiveFlowProgress(title: String(localized: "Saving log")) {
            BusyPressNote(pages: coordinator.recordingPages)
        }
    }

    private var savePersistenceErrorView: some View {
        DiveSaveFailureView(
            failureFeedback: coordinator.failureFeedback,
            actionButtonNote: String(localized: "Action Button: retry save, then start a new dive."),
            onRetry: { coordinator.retryCompletedSessionSave() },
            onHome: { coordinator.returnHomeKeepingPendingRecord() }
        )
    }
}

/// A failure note with its attempt number, so consecutive failed actions are visible (spec C18). At
/// the bottom of a flow it is a banner that rises in and hides after 4 seconds; in the save-failure
/// content it stays.
struct WatchFlowFailureNote: View {
    let message: String
    var dismissesAutomatically = true
    /// The system's bottom inset under the flow, so the banner can sit in that band.
    var systemBottomInset: CGFloat = 0
    @State private var isVisible: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let sizeClass = DiveType.SizeClass.current

    init(message: String, dismissesAutomatically: Bool = true, systemBottomInset: CGFloat = 0) {
        self.message = message
        self.dismissesAutomatically = dismissesAutomatically
        self.systemBottomInset = systemBottomInset
        _isVisible = State(initialValue: !dismissesAutomatically)
    }

    var body: some View {
        ZStack {
            if isVisible {
                DiveFailureNote(message: DiveFailureMessage(message: message))
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 8)))
            }
        }
        // The banner keeps clear of the display's rounded corners, 8 pt above the screen's edge.
        .padding(.horizontal, dismissesAutomatically ? PostDiveLayout.textGutter(sizeClass) : 0)
        .padding(.bottom, dismissesAutomatically ? 8 - systemBottomInset : 0)
        .task(id: message) {
            guard dismissesAutomatically else {
                isVisible = true
                return
            }
            // Rises in without overshooting: the diver may still be in the water.
            withAnimation(reduceMotion ? DiveMotion.reducedMotionCurve.animation : .smooth(duration: 0.3)) {
                isVisible = true
            }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                isVisible = false
            }
        }
    }
}

/// A short note after an Action Button press that came while the log was saving or the runtime was
/// still stopping. The runtime already played the rejection haptic; this view plays none.
private struct BusyPressNote: View {
    @ObservedObject var pages: RecordingPageModel
    @State private var flashedPressID: Int?

    var body: some View {
        Text(String(localized: "Please wait"))
            .diveFont(.footnote)
            .foregroundStyle(DiveWatchTheme.ink2)
            .lineLimit(1)
            .opacity(flashedPressID == nil ? 0 : 1)
            .accessibilityHidden(flashedPressID == nil)
            .onChange(of: pages.lastActionFeedback?.id) { _, _ in
                guard let feedback = pages.lastActionFeedback,
                      feedback.outcome == .rejected(.busy)
                else {
                    return
                }
                flashedPressID = feedback.id
            }
            .task(id: flashedPressID) {
                guard flashedPressID != nil else { return }
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled else { return }
                flashedPressID = nil
            }
    }
}
