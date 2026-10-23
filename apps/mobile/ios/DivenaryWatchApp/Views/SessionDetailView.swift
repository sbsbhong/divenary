import SwiftUI

/// One saved log on three system vertical pages (spec F #37–#41), titled with its date: the dive
/// (type, time, sync, profile, maximum depth and time, and the resend when a send failed), the
/// stats, then the recommended-stop record or the dive list with the conditions, memo and the
/// non-certified sentence. A page longer than the screen scrolls before the next page.
struct SessionDetailView: View {
    @ObservedObject var store: DiveSessionStore
    let savedSession: DiveSessionRecord

    private let sizeClass = DiveType.SizeClass.current

    /// The store copy reflects sync changes, such as a resend, while this screen is open.
    private var session: DiveSessionRecord {
        store.sessions.first { $0.id == savedSession.id } ?? savedSession
    }

    @ViewBuilder
    private var headerBadges: some View {
        StatusChip(title: session.diveMode.label)
        if let captureProvenanceLabel = session.captureProvenanceLabel {
            MarkerChip(title: captureProvenanceLabel)
        }
        Text(DiveFormatters.timeOfDay(session.startedAt))
            .diveFont(.eyebrow)
            .foregroundStyle(DiveWatchTheme.ink2)
            .fixedSize()
    }

    var body: some View {
        // The summary replays the whole depth profile, so it is computed once per update.
        let summary = session.summary
        TabView {
            DetailPage { divePage(summary: summary) }
            DetailPage { statsPage(summary: summary) }
            DetailPage { recordsPage }
        }
        .tabViewStyle(.verticalPage(transitionStyle: .blur))
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .environment(\.diveType, sizeClass.postDiveType)
        .navigationTitle(DiveFormatters.dayTitle(session.startedAt))
    }

    // MARK: Page 1: the dive

    private func divePage(summary: DiveSessionSummary) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { headerBadges }
                VStack(alignment: .leading, spacing: 4) { headerBadges }
            }
            .accessibilityElement(children: .combine)

            // Where the log is, in full words, under the badges (D3).
            DiveSyncStatusLine(status: session.syncStatus)
                .padding(.top, 6)

            if let recoveryLabel = session.recoveryLabel {
                Text(recoveryLabel)
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .padding(.top, 4)
            }

            if let feedback = store.syncRetryFeedback[session.id] {
                DiveFailureNote(message: DiveFailureMessage(message: feedback), isBanner: false)
                    .padding(.top, 6)
            }

            if session.syncStatus == .failed {
                Button {
                    store.retrySync(sessionID: session.id)
                } label: {
                    Text("Send Again")
                }
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                // Capsules run the platter width, wider than the text gutters (spec C12).
                .padding(.horizontal, DiveLayout.platterInset(sizeClass) - PostDiveLayout.textGutter(sizeClass))
                .padding(.top, 6)
            }

            DiveDrawnProfile(
                points: DiveProfilePointCache.shared.points(for: session, maximumCount: 160),
                accessibilityText: DiveFormatters.profileAccessibilitySummary(samples: session.samples)
            )
            .frame(height: PostDiveLayout.detailProfileHeight(sizeClass, sendFailed: session.syncStatus == .failed))
            .padding(.top, 8)

            VStack(alignment: .leading, spacing: 0) {
                Text(String(localized: "Max Depth"))
                    .diveFont(.eyebrow)
                    .foregroundStyle(DiveWatchTheme.ink2)
                DiveValueText(value: DiveFormatters.depth(summary.maxDepthMeters), numberRole: .metricL, unitRole: .unitL)
                    .padding(.vertical, -2)
            }
            .accessibilityElement(children: .combine)
            .padding(.top, 8)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                // A scuba dive's time is "다이빙 시간"; a freediving session's length "총 기록 시간" (C15).
                Text(session.diveMode.savedTimeTitle)
                    .diveFont(.eyebrow)
                    .foregroundStyle(DiveWatchTheme.ink2)
                DiveValueText(
                    value: DiveFormatters.savedDuration(summary.durationSeconds),
                    numberRole: .metricM,
                    unitRole: .unitM
                )
            }
            .accessibilityElement(children: .combine)
            .padding(.top, 2)

            if session.exceedsSupportedDepth {
                UnsupportedDepthNotice()
                    .padding(.top, 10)
            }
        }
    }

    // MARK: Page 2: stats

    private func statsPage(summary: DiveSessionSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DiveStatPair {
                SummaryRow(title: String(localized: "Average depth"), value: DiveFormatters.depth(summary.averageDepthMeters))
            } trailing: {
                if let averageTemperature = summary.averageWaterTemperatureCelsius {
                    SummaryRow(title: String(localized: "Average temp"), value: DiveFormatters.temperature(averageTemperature))
                } else {
                    Color.clear.frame(height: 0)
                }
            }
            .diveScrollEdge()

            DiveStatPair {
                SummaryRow(
                    title: String(localized: "Ascent reminder max"),
                    value: DiveFormatters.ascentRate(summary.maxAscentRateMetersPerMinute)
                )
            } trailing: {
                // Saved sessions keep a short preview; the profile metadata has the full count.
                SummaryRow(
                    title: String(localized: "Samples"),
                    value: (session.profile?.sampleCount ?? summary.sampleCount).formatted()
                )
            }
            .diveScrollEdge()

            metadataSection
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SummaryRow(title: String(localized: "Site"), value: session.siteName ?? String(localized: "Not set"),
                       wordRole: .headline)
                .diveScrollEdge()

            DiveStatPair {
                if session.diveMode == .scuba {
                    SummaryRow(title: String(localized: "Gas"), value: session.gasLabel ?? String(localized: "Not set"))
                } else {
                    ratingStat
                }
            } trailing: {
                if session.diveMode == .scuba {
                    ratingStat
                } else {
                    Color.clear.frame(height: 0)
                }
            }
            .diveScrollEdge()
        }
    }

    /// "평점" over the stars, read as "평점, 5점 중 4점".
    private var ratingStat: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(String(localized: "Rating"))
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
            DiveStarRating(rating: session.rating)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: Page 3: records, conditions and memo

    private var recordsPage: some View {
        VStack(alignment: .leading, spacing: 12) {
            modeDetailSection

            DiveStatPair {
                SummaryRow(
                    title: String(localized: "Visibility"),
                    value: session.visibilityRating.map { String(localized: "\($0)/5") } ?? String(localized: "Not set")
                )
            } trailing: {
                SummaryRow(title: String(localized: "Water"), value: session.waterCondition.label)
            }
            .diveScrollEdge()

            VStack(alignment: .leading, spacing: 2) {
                Text("NOTE")
                    .diveFont(.eyebrow)
                    .foregroundStyle(DiveWatchTheme.ink2)
                Text(session.notes ?? String(localized: "No note"))
                    .diveFont(.body)
                    .foregroundStyle(session.notes == nil ? DiveWatchTheme.ink2 : DiveWatchTheme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous)
                    .fill(DiveWatchTheme.platter)
            )
            .accessibilityElement(children: .combine)
            .diveScrollEdge()

            DiveDisclaimer(
                text: String(localized: "This app is a log review aid, not certified dive equipment.")
            )
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

/// One detail page: its content scrolls when it is longer than the screen, inside the free-text
/// gutters (spec B3) and clear of the page indicator.
private struct DetailPage<Content: View>: View {
    let content: Content

    private let sizeClass = DiveType.SizeClass.current

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, PostDiveLayout.textGutter(sizeClass))
                .padding(.bottom, 12)
        }
        .ignoresSafeArea(.container, edges: .horizontal)
    }
}

private struct FreeSegmentListSection: View {
    let session: FreeDiveSession

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            DiveSectionEyebrow(title: String(localized: "Free Segment List"))

            if segmentRows.isEmpty {
                Text(String(localized: "No segments"))
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
            } else {
                ForEach(segmentRows) { row in
                    FreeSegmentRow(row: row)
                        .diveScrollEdge()
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

/// One freediving dive: its number, time and depth, then the surface interval before it.
private struct FreeSegmentRow: View {
    let row: FreeSegmentRowModel

    private var segment: FreeDiveSegment {
        row.segment
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(segmentTitle)
                    .diveFont(.footnoteEmphasis)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                DiveValueText(
                    value: "\(DiveFormatters.duration(segment.durationSeconds)) · \(DiveFormatters.depth(segment.maxDepthMeters))",
                    numberRole: .footnoteMetric,
                    unitRole: .unitM
                )
            }

            if let surfaceIntervalSeconds = row.surfaceIntervalSeconds {
                Text(verbatim: "\(String(localized: "Surface interval")) \(DiveFormatters.duration(surfaceIntervalSeconds))")
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var segmentTitle: String {
        let indexText = String(format: "%02d", segment.index)
        return String(format: String(localized: "Dive #%@"), indexText)
    }
}

private struct SafetyStopResultSection: View {
    let session: ScubaDiveSession

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DiveSectionEyebrow(title: String(localized: "Safety Stop Result"))
            // The note sits first, so it is always on screen with the record (C12).
            DiveSectionNote(text: String(localized: "Recommended safety stop reminder · no safety calculation"))
            SafetyStopRecordStats(safetyStop: session.safetyStop)
                .padding(.top, 2)
        }
    }
}
