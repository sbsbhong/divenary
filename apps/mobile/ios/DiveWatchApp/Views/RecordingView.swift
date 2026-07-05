import SwiftUI

struct RecordingView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    @StateObject private var recorder = DiveSessionRecorder(sensorProvider: MockDepthSensorProvider())
    @State private var completedSession: DiveSessionRecord?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let completedSession {
                SummaryView(
                    session: completedSession,
                    onSave: { session in
                        store.save(session)
                        dismiss()
                    },
                    onDiscard: {
                        dismiss()
                    }
                )
            } else {
                recordingContent
            }
        }
        .navigationBarBackButtonHidden(recorder.isRecording)
        .onAppear {
            recorder.startSession(plan: plan)
        }
        .onDisappear {
            if completedSession == nil {
                recorder.cancelSession()
            }
        }
    }

    private var recordingContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    StatusPill(title: String(localized: "Active dive"))
                    Spacer(minLength: 6)
                    Text(DiveFormatters.duration(recorder.elapsedTime))
                        .font(DiveWatchTheme.metricFont(size: 16, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                }

                LiveDepthPanel(
                    currentDepthMeters: recorder.currentDepth,
                    depth: DiveFormatters.depth(recorder.currentDepth),
                    elapsed: DiveFormatters.duration(recorder.elapsedTime),
                    displayedMaxDepthMeters: recorder.maxDepth,
                    maxDepth: DiveFormatters.depth(recorder.maxDepth),
                    diveMode: plan.diveMode,
                    safetyStopActive: recorder.safetyStopActive
                )

                if plan.diveMode == .scuba {
                    ScubaRecordingStatus(
                        ascentRate: recorder.latestAscentRateMetersPerMinute,
                        ascentWarningActive: recorder.ascentWarningActive,
                        safetyStopActive: recorder.safetyStopActive,
                        safetyStopRemainingSeconds: recorder.safetyStopRemainingSeconds
                    )
                } else {
                    FreediveRecordingStatus(
                        elapsed: recorder.elapsedTime,
                        maxDepth: recorder.maxDepth,
                        trainingFocus: plan.quickNote
                    )
                }

                HStack(spacing: 8) {
                    CompactMetric(title: String(localized: "Temp"), value: DiveFormatters.temperature(recorder.waterTemperatureCelsius))
                    CompactMetric(title: String(localized: "Mode"), value: plan.diveMode.label)
                }

                Button(role: .destructive) {
                    completedSession = recorder.stopSession()
                } label: {
                    Label("End Dive", systemImage: "stop.fill")
                }
                .buttonStyle(DiveActionButtonStyle(kind: .destructive))

                DiveDisclaimer(text: String(localized: "ASSISTANT ONLY. FOLLOW TRAINING AND A CERTIFIED DIVE COMPUTER."))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Live Log")
    }
}

private struct LiveDepthPanel: View {
    let currentDepthMeters: Double
    let depth: String
    let elapsed: String
    let displayedMaxDepthMeters: Double
    let maxDepth: String
    let diveMode: DiveMode
    let safetyStopActive: Bool

    var body: some View {
        InstrumentCard {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("CURRENT DEPTH")
                        .font(DiveWatchTheme.labelFont())
                        .foregroundStyle(DiveWatchTheme.mutedText)

                    Text(depth)
                        .font(DiveWatchTheme.metricFont(size: 38, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.38)

                    HStack(spacing: 8) {
                        LiveDepthStat(title: String(localized: "Time"), value: elapsed)
                        LiveDepthStat(title: String(localized: "Max"), value: maxDepth)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                DepthGaugeRail(
                    depthMeters: currentDepthMeters,
                    maxScaleMeters: maxScaleMeters,
                    stopZone: stopZone,
                    targetDepthMeters: targetDepthMeters
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        if diveMode == .scuba && safetyStopActive {
            return 10
        }

        return max(30, ceil(max(currentDepthMeters, displayedMaxDepthMeters) / 10) * 10)
    }

    private var stopZone: ClosedRange<Double>? {
        diveMode == .scuba && safetyStopActive ? 3...6 : nil
    }

    private var targetDepthMeters: Double? {
        diveMode == .scuba && safetyStopActive ? 5 : nil
    }
}

private struct LiveDepthStat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
            Text(value)
                .font(DiveWatchTheme.metricFont(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.58)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactMetric: View {
    let title: String
    let value: String

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 3) {
                Text(title.uppercased())
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                Text(value)
                    .font(DiveWatchTheme.metricFont(size: 16, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
            }
        }
    }
}

private struct ScubaRecordingStatus: View {
    let ascentRate: Double
    let ascentWarningActive: Bool
    let safetyStopActive: Bool
    let safetyStopRemainingSeconds: TimeInterval

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 8) {
                    StatusPill(title: ascentWarningActive ? String(localized: "Ascent reminder") : String(localized: "Assistant steady"))

                    Spacer(minLength: 4)

                    Text(safetyStopActive ? DiveFormatters.duration(safetyStopRemainingSeconds) : String(localized: "REVIEW"))
                        .font(DiveWatchTheme.metricFont(size: 15, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                }

                Text(
                    ascentWarningActive
                        ? String(localized: "Review ascent rate with certified equipment.")
                        : String(localized: "Reminder review from watch logs only.")
                )
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)

                SummaryRow(
                    title: String(localized: "Ascent"),
                    value: ascentWarningActive ? String(localized: "Reminder active") : DiveFormatters.ascentRate(ascentRate),
                    accent: ascentWarningActive ? DiveWatchTheme.primary : nil
                )
                SummaryRow(
                    title: String(localized: "Safety stop"),
                    value: safetyStopActive ? DiveFormatters.duration(safetyStopRemainingSeconds) : String(localized: "Planning reminder"),
                    accent: safetyStopActive ? DiveWatchTheme.primary : nil
                )

                Text("Air scuba reminder, not a dive computer.")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
            }
        }
    }
}

private struct FreediveRecordingStatus: View {
    let elapsed: TimeInterval
    let maxDepth: Double
    let trainingFocus: String

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.secondary) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 8) {
                    StatusPill(title: String(localized: "Freedive session"))

                    Spacer(minLength: 4)

                    Text(DiveFormatters.duration(elapsed))
                        .font(DiveWatchTheme.metricFont(size: 15, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }

                SummaryRow(title: String(localized: "Session time"), value: DiveFormatters.duration(elapsed), accent: DiveWatchTheme.secondary)
                SummaryRow(title: String(localized: "Max"), value: DiveFormatters.depth(maxDepth))

                if !trainingFocus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    SummaryRow(title: String(localized: "Training"), value: trainingFocus)
                }

                Text("Freedive training reference only.")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
            }
        }
    }
}
