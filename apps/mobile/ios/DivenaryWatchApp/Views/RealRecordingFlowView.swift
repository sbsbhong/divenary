import SwiftUI

struct RealRecordingFlowView: View {
    @ObservedObject var store: DiveSessionStore
    @ObservedObject var water: WaterSubmersionCoordinator
    @ObservedObject var recorder: DiveSessionRecorder
    @ObservedObject var coordinator: RealDiveSessionCoordinator

    var body: some View {
        Group {
            switch coordinator.phase {
            case .idle:
                EmptyView()
            case .recording:
                RecordingInstrumentView(
                    recorder: recorder,
                    plan: PreDivePlan(diveMode: store.preferredDiveMode),
                    controlPolicy: .real,
                    maximumDepthMeters: water.maximumDepthMeters,
                    showsTouchEndControl: false,
                    onTouchEnd: {}
                )
            case .summary(let session):
                SummaryView(
                    session: session,
                    onSave: { session in
                        if store.save(session) {
                            coordinator.markSummarySaved()
                        }
                    },
                    onDiscard: {
                        coordinator.discardSummary()
                    }
                )
            case .noSamples:
                noSamplesView
            case .persistenceError:
                persistenceErrorView
            }
        }
        .navigationBarBackButtonHidden(true)
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

            Text("Local recording storage could not be prepared.")
                .font(.system(size: 11))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.75)

            Button("Done") {
                coordinator.dismissPersistenceError()
            }
            .buttonStyle(DiveActionButtonStyle(kind: .primary))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}
