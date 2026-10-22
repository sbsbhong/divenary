import SwiftUI

struct SessionDetailView: View {
    @ObservedObject var store: DiveSessionStore
    let savedSession: DiveSessionRecord

    /// The store copy reflects sync changes, such as a resend, while this screen is open.
    private var session: DiveSessionRecord {
        store.sessions.first { $0.id == savedSession.id } ?? savedSession
    }

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
                            if let captureProvenanceLabel = session.captureProvenanceLabel {
                                StatusPill(title: captureProvenanceLabel, color: DiveWatchTheme.secondary)
                            }
                            Spacer(minLength: 6)
                            Text(session.syncStatus.label)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(DiveWatchTheme.mutedText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.62)
                        }

                        if let recoveryLabel = session.recoveryLabel {
                            Text(recoveryLabel)
                                .font(.system(size: 12))
                                .foregroundStyle(DiveWatchTheme.secondary)
                        }

                        Text(DiveFormatters.sessionDate.string(from: session.startedAt))
                            .font(DiveWatchTheme.metricFont(size: 20, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(2)
                            .minimumScaleFactor(0.55)

                        DepthProfileSparkline(samples: session.samples)
                            .frame(height: 44)

                        if session.exceedsSupportedDepth {
                            UnsupportedDepthNotice()
                        }
                    }
                }

                if session.syncStatus == .failed {
                    Button {
                        store.retrySync(sessionID: session.id)
                    } label: {
                        Label("Send Again", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                }

                if let feedback = store.syncRetryFeedback[session.id] {
                    Text(feedback)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.danger)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 8) {
                    MetricCard(title: String(localized: "Max Depth"), value: DiveFormatters.depth(summary.maxDepthMeters), compact: true)
                    MetricCard(title: String(localized: "Duration"), value: DiveFormatters.duration(summary.durationSeconds), compact: true)
                }

                InstrumentCard {
                    VStack(spacing: 6) {
                        SummaryRow(title: String(localized: "Average depth"), value: DiveFormatters.depth(summary.averageDepthMeters))
                        if let averageTemperature = summary.averageWaterTemperatureCelsius {
                            SummaryRow(title: String(localized: "Average temp"), value: DiveFormatters.temperature(averageTemperature))
                        }
                        // Saved sessions keep a short preview; the profile metadata has the full count.
                        SummaryRow(
                            title: String(localized: "Samples"),
                            value: "\(session.profile?.sampleCount ?? summary.sampleCount)"
                        )
                        SummaryRow(
                            title: String(localized: "Ascent reminder max"),
                            value: DiveFormatters.ascentRate(summary.maxAscentRateMetersPerMinute)
                        )
                    }
                }

                modeDetailSection

                metadataSection

                InstrumentCard {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("NOTE")
                            .font(DiveWatchTheme.labelFont())
                            .foregroundStyle(DiveWatchTheme.mutedText)
                        Text(session.notes ?? String(localized: "No note"))
                            .font(.system(size: 12, weight: .regular))
                            .foregroundStyle(DiveWatchTheme.text)
                            .multilineTextAlignment(.leading)
                            .lineLimit(5)
                    }
                }

                DiveDisclaimer(
                    text: String(localized: "This app is a log review aid, not certified dive equipment.")
                )
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Details")
    }

    private var metadataSection: some View {
        InstrumentCard(accent: DiveWatchTheme.secondary) {
            VStack(spacing: 6) {
                if session.diveMode == .scuba {
                    SummaryRow(title: String(localized: "Gas"), value: session.gasLabel ?? String(localized: "Not set"))
                }
                SummaryRow(title: String(localized: "Site"), value: session.siteName ?? String(localized: "Not set"))
                SummaryRow(title: String(localized: "Rating"), value: DiveFormatters.rating(session.rating))
                SummaryRow(title: String(localized: "Visibility"), value: session.visibilityRating.map(String.init) ?? String(localized: "Not set"))
                SummaryRow(title: String(localized: "Water"), value: session.waterCondition.label)
            }
        }
    }

    @ViewBuilder
    private var modeDetailSection: some View {
        switch session.payload {
        case .freedive(let freeSession):
            FreeSegmentListSection(session: freeSession)
        case .scuba(let scubaSession):
            SafetyStopResultSection(session: scubaSession)
        }
    }
}

private struct FreeSegmentListSection: View {
    let session: FreeDiveSession

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Free Segment List")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                if segmentRows.isEmpty {
                    Text(String(localized: "No segments"))
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                } else {
                    ForEach(segmentRows) { row in
                        FreeSegmentRow(row: row)
                    }
                }
            }
        }
    }

    private var segmentRows: [FreeSegmentRowModel] {
        let sortedSegments = session.segments.sorted { left, right in
            if left.startTime == right.startTime {
                return left.index < right.index
            }

            return left.startTime < right.startTime
        }

        return sortedSegments.indices.map { index in
            let segment = sortedSegments[index]
            let previousSegment = index > 0 ? sortedSegments[index - 1] : nil
            let surfaceIntervalSeconds = previousSegment?.endTime.map {
                max(0, segment.startTime.timeIntervalSince($0))
            }

            return FreeSegmentRowModel(segment: segment, surfaceIntervalSeconds: surfaceIntervalSeconds)
        }
    }
}

private struct FreeSegmentRowModel: Identifiable {
    let segment: FreeDiveSegment
    let surfaceIntervalSeconds: TimeInterval?

    var id: UUID {
        segment.id
    }
}

private struct FreeSegmentRow: View {
    let row: FreeSegmentRowModel

    private var segment: FreeDiveSegment {
        row.segment
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(segmentTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Spacer(minLength: 4)

                Text("\(DiveFormatters.duration(segment.durationSeconds)) · \(DiveFormatters.depth(segment.maxDepthMeters))")
                    .font(DiveWatchTheme.metricFont(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.58)
            }

            if let surfaceIntervalSeconds = row.surfaceIntervalSeconds {
                Text("\(String(localized: "Surface interval")): \(DiveFormatters.duration(surfaceIntervalSeconds))")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
        )
    }

    private var segmentTitle: String {
        let indexText = String(format: "%02d", segment.index)
        return String(format: String(localized: "Dive #%@"), indexText)
    }
}

private struct SafetyStopResultSection: View {
    let session: ScubaDiveSession

    private var safetyStop: SafetyStopRecord {
        session.safetyStop
    }

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Safety Stop Result")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                VStack(spacing: 6) {
                    SummaryRow(title: String(localized: "Status"), value: safetyStop.status.displayText, accent: statusColor)
                    SummaryRow(title: String(localized: "Recommendation"), value: String(localized: "Recommended reminder"))
                    SummaryRow(title: String(localized: "Completed"), value: safetyStop.status == .unknown ? "--" : localizedBoolean(safetyStop.completed))
                    SummaryRow(title: String(localized: "Target / zone"), value: targetZoneText)
                    SummaryRow(title: String(localized: "Remaining"), value: DiveFormatters.duration(safetyStop.reviewRemainingSeconds))
                    SummaryRow(title: String(localized: "Time in zone"), value: DiveFormatters.duration(safetyStop.reviewTimeInZoneSeconds))
                    if let startedAt = safetyStop.startedAt {
                        SummaryRow(title: String(localized: "Started"), value: DiveFormatters.sessionDate.string(from: startedAt))
                    }
                    if let completedAt = safetyStop.completedAt {
                        SummaryRow(title: String(localized: "Completed at"), value: DiveFormatters.sessionDate.string(from: completedAt))
                    }
                }

                Text(String(localized: "Recommended safety stop reminder · no safety calculation"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }
        }
    }

    private var targetZoneText: String {
        "\(DiveFormatters.depth(safetyStop.targetDepthMeters)) · \(DiveFormatters.depth(safetyStop.minDepthMeters))-\(DiveFormatters.depth(safetyStop.maxDepthMeters))"
    }

    private var statusColor: Color {
        safetyStop.status.reviewTint
    }

    private func localizedBoolean(_ value: Bool) -> String {
        value ? String(localized: "Yes") : String(localized: "No")
    }
}
