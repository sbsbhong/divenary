import SwiftUI

struct SessionDetailView: View {
    let session: DiveSessionRecord

    private var summary: DiveSessionSummary {
        session.summary
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                InstrumentCard(accent: DiveWatchTheme.primary) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            StatusPill(title: session.diveMode.label)
                            Spacer(minLength: 6)
                            Text(session.syncStatus.label)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(DiveWatchTheme.mutedText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.62)
                        }

                        Text(DiveFormatters.sessionDate.string(from: session.startedAt))
                            .font(DiveWatchTheme.metricFont(size: 20, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(2)
                            .minimumScaleFactor(0.55)

                        DepthProfileSparkline(samples: session.samples)
                            .frame(height: 44)
                    }
                }

                HStack(spacing: 8) {
                    MetricCard(title: String(localized: "Max Depth"), value: DiveFormatters.depth(summary.maxDepthMeters), compact: true)
                    MetricCard(title: String(localized: "Duration"), value: DiveFormatters.duration(summary.durationSeconds), compact: true)
                }

                InstrumentCard {
                    VStack(spacing: 6) {
                        SummaryRow(title: String(localized: "Average depth"), value: DiveFormatters.depth(summary.averageDepthMeters))
                        SummaryRow(title: String(localized: "Average temp"), value: DiveFormatters.temperature(summary.averageWaterTemperatureCelsius))
                        SummaryRow(title: String(localized: "Samples"), value: "\(summary.sampleCount)")
                        SummaryRow(
                            title: String(localized: "Ascent reminder max"),
                            value: DiveFormatters.ascentRate(summary.maxAscentRateMetersPerMinute)
                        )
                    }
                }

                InstrumentCard(accent: DiveWatchTheme.secondary) {
                    VStack(spacing: 6) {
                        SummaryRow(title: String(localized: "Gas"), value: session.gasLabel ?? String(localized: "Not set"))
                        SummaryRow(title: String(localized: "Site"), value: session.siteName ?? String(localized: "Not set"))
                        SummaryRow(title: String(localized: "Rating"), value: DiveFormatters.rating(session.rating))
                        SummaryRow(title: String(localized: "Visibility"), value: session.visibilityRating.map(String.init) ?? String(localized: "Not set"))
                        SummaryRow(title: String(localized: "Water"), value: session.waterCondition.label)
                    }
                }

                InstrumentCard {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("NOTE")
                            .font(DiveWatchTheme.labelFont())
                            .foregroundStyle(DiveWatchTheme.mutedText)
                        Text(session.notes ?? String(localized: "No note"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DiveWatchTheme.text)
                            .multilineTextAlignment(.leading)
                            .lineLimit(5)
                    }
                }

                DiveDisclaimer(text: String(localized: "LOG REVIEW ONLY. NON-CERTIFIED ASSISTANT."))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Details")
    }
}
