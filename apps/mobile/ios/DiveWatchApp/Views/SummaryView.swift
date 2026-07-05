import SwiftUI

struct SummaryView: View {
    let session: DiveSessionRecord
    let onSave: (DiveSessionRecord) -> Void
    let onDiscard: () -> Void
    @State private var rating = 4
    @State private var perceivedExertion = 2
    @State private var visibilityRating = 3
    @State private var waterCondition = WaterCondition.unknown
    @State private var notes = ""

    private var summary: DiveSessionSummary {
        session.summary
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                InstrumentCard(accent: DiveWatchTheme.primary) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            StatusPill(title: String(localized: "Dive captured"))
                            if session.captureMode == .demo {
                                StatusPill(title: String(localized: "Demo"), color: DiveWatchTheme.secondary)
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
                    }
                }

                modeSummarySection
                commonMetricsSection

                InstrumentCard(accent: DiveWatchTheme.secondary) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("POST-DIVE REVIEW")
                            .font(DiveWatchTheme.labelFont())
                            .foregroundStyle(DiveWatchTheme.secondary)

                        StarRatingControl(title: String(localized: "Rating"), value: $rating)
                        StarRatingControl(title: String(localized: "Effort"), value: $perceivedExertion)
                        StarRatingControl(title: String(localized: "Visibility"), value: $visibilityRating)

                        Picker("Water", selection: $waterCondition) {
                            ForEach(WaterCondition.allCases) { condition in
                                Text(condition.label).tag(condition)
                            }
                        }
                        .labelsHidden()
                        .frame(height: 56)

                        TextField("Quick note", text: $notes)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DiveWatchTheme.text)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 7)
                            .background(
                                RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                                    .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
                            )
                    }
                }

                Button {
                    onSave(
                        session.applyingPostDive(
                            rating: rating,
                            perceivedExertion: perceivedExertion,
                            visibilityRating: visibilityRating,
                            waterCondition: waterCondition,
                            notes: notes.isEmpty ? session.notes : notes
                        )
                    )
                } label: {
                    Label("Save", systemImage: "tray.and.arrow.down.fill")
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button(role: .destructive) {
                    onDiscard()
                } label: {
                    Label("Discard", systemImage: "trash")
                }
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))

                DiveDisclaimer(text: String(localized: "SAVED LOG ONLY. NON-CERTIFIED ASSISTANT."))
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Summary")
        .onAppear {
            rating = session.rating ?? rating
            perceivedExertion = session.perceivedExertion ?? perceivedExertion
            visibilityRating = session.visibilityRating ?? visibilityRating
            waterCondition = session.waterCondition
            notes = session.notes ?? ""
        }
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
                    SummaryRow(title: String(localized: "Average temp"), value: DiveFormatters.temperature(summary.averageWaterTemperatureCelsius))
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
                SummaryRow(title: String(localized: "Required"), value: localizedBoolean(safetyStop.required))
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

private struct StarRatingControl: View {
    let title: String
    @Binding var value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                Spacer(minLength: 4)
                Text("\(value)/5")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.primary)
                    .monospacedDigit()
            }

            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { star in
                    Button {
                        value = star
                    } label: {
                        Image(systemName: star <= value ? "star.fill" : "star")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(star <= value ? DiveWatchTheme.primary : DiveWatchTheme.mutedText)
                            .frame(maxWidth: .infinity, minHeight: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(title) \(star)")
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
        )
    }
}
