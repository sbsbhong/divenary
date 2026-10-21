import SwiftUI

struct SessionSummaryContent: View {
    let session: DiveSessionRecord
    let statusTitle: LocalizedStringKey
    let footer: LocalizedStringKey?
    /// The summary replays the whole depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary

    init(session: DiveSessionRecord, statusTitle: LocalizedStringKey, footer: LocalizedStringKey?) {
        self.session = session
        self.statusTitle = statusTitle
        self.footer = footer
        summary = session.summary
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                InstrumentCard(accent: DiveWatchTheme.primary) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(statusTitle)
                                .font(DiveWatchTheme.labelFont())
                                .foregroundStyle(DiveWatchTheme.primary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule()
                                        .fill(DiveWatchTheme.primary.opacity(0.16))
                                )
                            if let captureProvenanceLabel = session.captureProvenanceLabel {
                                StatusPill(title: captureProvenanceLabel, color: DiveWatchTheme.secondary)
                            }
                            Spacer(minLength: 6)
                            Text("\(summary.sampleCount)")
                                .font(DiveWatchTheme.metricFont(size: 15, weight: .semibold))
                                .foregroundStyle(DiveWatchTheme.primary)
                                .monospacedDigit()
                            Text("samples")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(DiveWatchTheme.mutedText)
                        }

                        Text("Dive Summary")
                            .font(DiveWatchTheme.metricFont(size: 24, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(1)
                            .minimumScaleFactor(0.62)

                        DepthProfileSparkline(samples: session.samples, color: DiveWatchTheme.primary)
                            .frame(height: 42)

                        if session.exceedsSupportedDepth {
                            UnsupportedDepthNotice()
                        }
                    }
                }

                modeSummarySection
                commonMetricsSection

                DiveDisclaimer(text: String(localized: "SAVED LOG ONLY. NON-CERTIFIED ASSISTANT."))

                if let footer {
                    Text(footer)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Summary")
    }

    private var commonMetricsSection: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                MetricCard(title: String(localized: "Duration"), value: DiveFormatters.duration(summary.durationSeconds), compact: true)
                MetricCard(title: String(localized: "Max Depth"), value: DiveFormatters.depth(summary.maxDepthMeters), compact: true)
            }

            InstrumentCard {
                VStack(spacing: 6) {
                    SummaryRow(title: String(localized: "Average depth"), value: DiveFormatters.depth(summary.averageDepthMeters))
                    if let averageTemperature = summary.averageWaterTemperatureCelsius {
                        SummaryRow(title: String(localized: "Average temp"), value: DiveFormatters.temperature(averageTemperature))
                    }
                    SummaryRow(
                        title: String(localized: "Ascent reminder max"),
                        value: DiveFormatters.ascentRate(summary.maxAscentRateMetersPerMinute)
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var modeSummarySection: some View {
        switch session.payload {
        case .freedive(let freeSession):
            FreeSessionSummarySection(session: freeSession)
        case .scuba(let scubaSession):
            SafetyStopSummarySection(session: scubaSession)
        }
    }
}

struct SavedSessionSummaryView: View {
    let session: DiveSessionRecord
    let onBack: () -> Void

    var body: some View {
        SessionSummaryContent(
            session: session,
            statusTitle: "Saved",
            footer: "Edit details on iPhone."
        )
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel(Text("Back"))
            }
        }
    }
}

private struct FreeSessionSummarySection: View {
    let session: FreeDiveSession

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Free Session Summary")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                SummaryRow(title: String(localized: "Dive count"), value: "\(session.diveCount)")
                SummaryRow(title: String(localized: "Longest dive"), value: DiveFormatters.duration(session.longestDiveDurationSeconds))
                SummaryRow(title: String(localized: "Max Depth"), value: DiveFormatters.depth(session.maxDepthMeters))
                SummaryRow(title: String(localized: "Total session time"), value: DiveFormatters.duration(session.totalDurationSeconds))

                Text(String(localized: "Supplemental log · no safety calculation"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }
        }
    }
}

private struct SafetyStopSummarySection: View {
    let session: ScubaDiveSession

    private var safetyStop: SafetyStopRecord {
        session.safetyStop
    }

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Safety Stop Summary")
                        .font(DiveWatchTheme.labelFont())
                        .foregroundStyle(DiveWatchTheme.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Spacer(minLength: 4)
                    StatusPill(title: safetyStop.status.displayText, color: statusColor)
                }

                SummaryRow(title: String(localized: "Status"), value: safetyStop.status.displayText, accent: statusColor)
                SummaryRow(title: String(localized: "Remaining"), value: DiveFormatters.duration(safetyStop.remainingSeconds))
                SummaryRow(title: String(localized: "Time in zone"), value: DiveFormatters.duration(safetyStop.timeInZoneSeconds))
                SummaryRow(title: String(localized: "Recommendation"), value: String(localized: "Recommended reminder"))
                SummaryRow(title: String(localized: "Completed"), value: localizedBoolean(safetyStop.completed))

                Text(String(localized: "Recommended safety stop reminder · no safety calculation"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }
        }
    }

    private var statusColor: Color {
        safetyStop.completed ? DiveWatchTheme.secondary : DiveWatchTheme.primary
    }

    private func localizedBoolean(_ value: Bool) -> String {
        value ? String(localized: "Yes") : String(localized: "No")
    }
}
