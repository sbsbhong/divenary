import SwiftUI

struct SessionSummaryContent: View {
    let session: DiveSessionRecord
    let statusTitle: LocalizedStringKey
    let footer: LocalizedStringKey?
    /// "Action ▸ Start next dive", for a real summary on a watch that probably has an Action Button.
    let showsNextDiveHint: Bool
    /// The summary replays the whole depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary

    init(
        session: DiveSessionRecord,
        statusTitle: LocalizedStringKey,
        footer: LocalizedStringKey?,
        showsNextDiveHint: Bool = false
    ) {
        self.session = session
        self.statusTitle = statusTitle
        self.footer = footer
        self.showsNextDiveHint = showsNextDiveHint
        summary = session.summary
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // First, because the diver cannot scroll or close the summary under Water Lock.
                if showsNextDiveHint {
                    NextDiveActionHint()
                }

                InstrumentCard {
                    VStack(alignment: .leading, spacing: 8) {
                        // The one place the save status and the Demo/Test marker appear.
                        HStack(spacing: 6) {
                            Text(statusTitle)
                                .font(DiveWatchTheme.labelFont())
                                .foregroundStyle(DiveWatchTheme.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule()
                                        .fill(DiveWatchTheme.secondary.opacity(0.16))
                                )
                            if let captureProvenanceLabel = session.captureProvenanceLabel {
                                StatusPill(title: captureProvenanceLabel, color: DiveWatchTheme.secondary)
                            }
                            Spacer(minLength: 0)
                        }

                        if let recoveryLabel = session.recoveryLabel {
                            Text(recoveryLabel)
                                .font(.system(size: 12))
                                .foregroundStyle(DiveWatchTheme.secondary)
                        }

                        HStack(alignment: .top, spacing: 10) {
                            SummaryHeadlineMetric(
                                title: String(localized: "Max Depth"),
                                value: DiveFormatters.depth(summary.maxDepthMeters)
                            )
                            SummaryHeadlineMetric(
                                title: String(localized: "Duration"),
                                value: DiveFormatters.duration(summary.durationSeconds)
                            )
                        }

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
                        .font(.system(size: 10, weight: .regular))
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

    /// Maximum depth and duration lead the header, so this section holds the rest.
    private var commonMetricsSection: some View {
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
    var showsNextDiveHint = false

    var body: some View {
        SessionSummaryContent(
            session: session,
            statusTitle: "Saved",
            footer: "Edit details on iPhone.",
            showsNextDiveHint: showsNextDiveHint
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
                Text("Safety Stop Summary")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                // The status appears once, as this row.
                SummaryRow(title: String(localized: "Status"), value: safetyStop.status.displayText, accent: statusColor)
                SummaryRow(title: String(localized: "Remaining"), value: DiveFormatters.duration(safetyStop.reviewRemainingSeconds))
                SummaryRow(title: String(localized: "Time in zone"), value: DiveFormatters.duration(safetyStop.reviewTimeInZoneSeconds))
                SummaryRow(title: String(localized: "Recommendation"), value: String(localized: "Recommended reminder"))
                SummaryRow(title: String(localized: "Completed"), value: safetyStop.status == .unknown ? "--" : localizedBoolean(safetyStop.completed))

                Text(String(localized: "Recommended safety stop reminder · no safety calculation"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }
        }
    }

    private var statusColor: Color {
        safetyStop.status.reviewTint
    }

    private func localizedBoolean(_ value: Bool) -> String {
        value ? String(localized: "Yes") : String(localized: "No")
    }
}

/// One of the two values a summary leads with.
private struct SummaryHeadlineMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(value)
                .font(DiveWatchTheme.metricFont(size: 22, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
