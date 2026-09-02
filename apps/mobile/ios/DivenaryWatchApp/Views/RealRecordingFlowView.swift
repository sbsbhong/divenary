import SwiftUI

struct RealRecordingFlowView: View {
    @ObservedObject var water: WaterSubmersionCoordinator
    @ObservedObject var recorder: DiveSessionRecorder
    @ObservedObject var coordinator: RealDiveSessionCoordinator
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
                    onSelect: coordinator.selectWetReadyMode
                )
            case .recording(_, let plan):
                RecordingInstrumentView(
                    recorder: recorder,
                    plan: plan,
                    maximumDepthMeters: water.maximumDepthMeters,
                    endControl: WatchRecordingMode.real.endControl
                )
            case .completing:
                savingView
            case .savedSummary(let session):
                SavedSessionSummaryView(
                    session: session,
                    onBack: coordinator.dismissSavedSummary
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
                .font(.system(size: 11))
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
            }
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
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
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }

    private var savePersistenceErrorView: some View {
        VStack(spacing: 10) {
            Image(systemName: "externaldrive.badge.exclamationmark")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)

            Text("Keeping your captured log.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .multilineTextAlignment(.center)

            Button("Retry Save") {
                coordinator.retryCompletedSessionSave()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}
