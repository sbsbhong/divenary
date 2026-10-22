import SwiftUI

struct RealRecordingFlowView: View {
    @ObservedObject var water: WaterSubmersionCoordinator
    @ObservedObject var recorder: DiveSessionRecorder
    @ObservedObject var coordinator: RealDiveSessionCoordinator
    /// Chooses the Wet Ready start copy. Home reads it from watchOS.
    var autoLaunchStatus: DepthAutoLaunchStatus = .unknown
    @Environment(\.scenePhase) private var scenePhase

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
                .overlay {
                    if coordinator.isEnding {
                        endingView
                    }
                }
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
                WatchFlowFailureNote(message: message)
            }
        }
        .onChange(of: scenePhase) { _, nextPhase in
            if nextPhase == .active {
                coordinator.retryCompletedSessionSave()
            }
        }
    }

    private var noSamplesView: some View {
        VStack(spacing: 12) {
            Text("No depth samples captured")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.75)

            Button("Done") {
                coordinator.dismissNoSamples()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    private func startPersistenceErrorView(allowsDismissal: Bool) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "externaldrive.badge.exclamationmark")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)

            Text("Recording unavailable")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            Text("Recording setup could not be completed.")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.75)

            if allowsDismissal {
                Button("Done") {
                    coordinator.dismissStartPersistenceError()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))
            } else {
                ProgressView()
                    .tint(DiveWatchTheme.primary)
                BusyPressNote(pages: coordinator.recordingPages)
            }
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    /// Shown at once, not after a delay: saving holds the main thread, so a timer could not fire.
    private var endingView: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(DiveWatchTheme.primary)
            Text(String(localized: "Ending recording"))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
            BusyPressNote(pages: coordinator.recordingPages)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    private var savingView: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(DiveWatchTheme.primary)
            Text("Saving log")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
            BusyPressNote(pages: coordinator.recordingPages)
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

                Text(String(localized: "Action Button: retry save, then start a new dive."))
                    .font(.system(size: 11))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.center)

                if let message = coordinator.failureFeedback {
                    WatchFlowFailureNote(message: message, dismissesAutomatically: false)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button("Retry Save") {
                    coordinator.retryCompletedSessionSave()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button(String(localized: "Back to Home")) {
                    coordinator.returnHomeKeepingPendingRecord()
                }
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}

/// A new failure message includes its attempt number, so consecutive failed actions are visible.
/// Outside save-failure content, the note expires to leave the recording readout clear.
struct WatchFlowFailureNote: View {
    let message: String
    var dismissesAutomatically = true
    @State private var isVisible = true

    var body: some View {
        Group {
            if isVisible {
                Text(message)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DiveWatchTheme.edgeMargin)
            }
        }
        .task(id: message) {
            isVisible = true
            guard dismissesAutomatically else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            isVisible = false
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
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.mutedText)
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
