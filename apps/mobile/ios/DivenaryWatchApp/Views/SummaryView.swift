import SwiftUI

/// The saved summary (DECISIONS D11): maximum depth, then the dive time, the profile and the save
/// status, with the next Action Button press pinned at the bottom. Below the fold: where the log is
/// on its way to iPhone, the recommended stop or freediving summary, the stats and the fine print.
/// The first appearance after a save plays the finale (spec PD-FINALE); a tap or a crown turn jumps
/// to its end.
struct SessionSummaryContent: View {
    let session: DiveSessionRecord
    let statusTitle: LocalizedStringKey
    let footer: LocalizedStringKey?
    /// "Action ▸ Start next dive", for a real summary on a watch that probably has an Action Button.
    let showsNextDiveHint: Bool
    /// The summary replays the whole depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary
    private let profilePoints: [CGPoint]
    private let profileAccessibility: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var finale = SummaryFinale()
    @State private var finaleTask: Task<Void, Never>?
    @State private var scrollStart: CGFloat?

    private let sizeClass = DiveType.SizeClass.current
    private static let scrollSpace = "summaryScroll"

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
        profilePoints = MiniDepthProfile.normalizedPoints(
            depths: MiniDepthProfile.thinnedDepths(session.samples.map(\.depthMeters), maximumCount: 160)
        )
        profileAccessibility = DiveFormatters.profileAccessibilitySummary(samples: session.samples)
    }

    var body: some View {
        let plan = DiveFinalePlan(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced)
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        maxDepthBlock
                            .opacity(finale.showsDepth ? 1 : 0)
                            .offset(y: finale.showsDepth ? 0 : plan.valueRise)

                        diveTimeRow
                            .opacity(finale.showsTime ? 1 : 0)
                            .offset(y: finale.showsTime ? 0 : plan.valueRise)

                        DiveProfileChart(
                            points: profilePoints,
                            accessibilityText: profileAccessibility,
                            progress: finale.lineProgress,
                            waterOpacity: finale.waterOpacity,
                            showsDeepest: finale.showsDeepest,
                            depthLabel: DiveFormatters.depth(summary.maxDepthMeters),
                            riderOpacity: finale.riderOpacity,
                            ridesLogo: plan.ridesLogo
                        )
                        .frame(height: PostDiveLayout.summaryProfileHeight(sizeClass))
                        .opacity(plan.tracesLine ? 1 : finale.waterOpacity)
                        .padding(.top, 6)

                        savedStatusRow
                            .padding(.top, 6)
                    }
                    // A tap or a crown turn starts these over at their end state.
                    .id(finale.generation)

                    belowTheFold
                }
                .padding(.horizontal, PostDiveLayout.textGutter(sizeClass))
                .padding(.bottom, showsNextDiveHint ? Self.hintClearance(sizeClass) : 12)
                .background(alignment: .top) {
                    GeometryReader { proxy in
                        Color.clear.preference(
                            key: SummaryScrollOffsetKey.self,
                            value: proxy.frame(in: .named(Self.scrollSpace)).minY
                        )
                    }
                }
                .contentShape(Rectangle())
                .simultaneousGesture(TapGesture().onEnded { finishFinale() })
            }
            .coordinateSpace(name: Self.scrollSpace)
            .onPreferenceChange(SummaryScrollOffsetKey.self) { offset in
                guard let scrollStart else {
                    scrollStart = offset
                    return
                }
                if abs(offset - scrollStart) > 2 { finishFinale() }
            }

            // The next Action Button press, pinned at the bottom like a recording page's hint chip.
            if showsNextDiveHint {
                NextDiveActionHint()
            }
        }
        // The scroll runs under the pinned chip to the screen's edge, as a recording page does.
        .ignoresSafeArea(.container, edges: [.horizontal, .bottom])
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .environment(\.diveType, sizeClass.postDiveType)
        .navigationTitle("Summary")
        .onAppear { startFinale(plan) }
        .onChange(of: isLuminanceReduced) { _, isAlwaysOn in
            if isAlwaysOn { finishFinale() }
        }
        .onDisappear { finaleTask?.cancel() }
    }

    private var maxDepthBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(String(localized: "Max Depth"))
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .trailing) {
                    // A demo or test log never reads as a real dive.
                    if let captureProvenanceLabel = session.captureProvenanceLabel {
                        MarkerChip(title: captureProvenanceLabel)
                    }
                }
            DiveValueText(
                value: DiveFormatters.depth(summary.maxDepthMeters),
                numberRole: .metricXL,
                unitRole: .unitL
            )
            .padding(.vertical, -3)
        }
        .accessibilityElement(children: .combine)
    }

    private var diveTimeRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(diveTimeTitle)
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
            DiveValueText(
                value: DiveFormatters.savedDuration(summary.durationSeconds),
                numberRole: .metricM,
                unitRole: .unitM
            )
        }
        .accessibilityElement(children: .combine)
    }

    /// A scuba dive's time is "다이빙 시간"; a freediving session's whole length stays "총 기록 시간" (C15).
    private var diveTimeTitle: String {
        session.diveMode == .scuba ? String(localized: "Log time") : String(localized: "Duration")
    }

    /// Where the log was saved, shown once (C4). The send direction is the sync line below the fold.
    private var savedStatusRow: some View {
        HStack(spacing: 5) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(DiveWatchTheme.ink)
                .symbolEffect(.bounce, value: finale.bounceCount)
            Text(statusTitle)
                .foregroundStyle(DiveWatchTheme.ink)
        }
        .diveFont(.footnoteEmphasis)
        .accessibilityElement(children: .combine)
    }

    private var belowTheFold: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                DiveSyncStatusLine(status: session.syncStatus)
                if let recoveryLabel = session.recoveryLabel {
                    Text(recoveryLabel)
                        .diveFont(.footnote)
                        .foregroundStyle(DiveWatchTheme.ink2)
                }
                if session.exceedsSupportedDepth {
                    UnsupportedDepthNotice()
                }
            }
            .diveScrollEdge()

            modeSummarySection
            commonMetricsSection

            if let footer {
                Text(footer)
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            DiveDisclaimer(text: String(localized: "SAVED LOG ONLY. NON-CERTIFIED ASSISTANT."))
        }
        // Without the pinned chip its place stays empty, so the first lines below the fold never
        // show half-cut by the display's curve (D13).
        .padding(.top, 18 + (showsNextDiveHint ? 0 : Self.hintClearance(sizeClass)))
    }

    /// Maximum depth and duration lead the summary, so this section holds the rest.
    private var commonMetricsSection: some View {
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
            SummaryRow(
                title: String(localized: "Ascent reminder max"),
                value: DiveFormatters.ascentRate(summary.maxAscentRateMetersPerMinute)
            )
            .diveScrollEdge()
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

    /// Room under the last line so it scrolls clear of the pinned chip.
    private static func hintClearance(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        DiveSpacing.hintChipHeight(sizeClass) + 20
    }

    // MARK: Finale

    private func startFinale(_ plan: DiveFinalePlan) {
        guard !finale.hasStarted else { return }
        finale.hasStarted = true
        guard plan.animates else {
            finale.finish()
            return
        }

        if plan.bounces { finale.bounceCount += 1 }
        withAnimation(.smooth(duration: plan.valueDuration)) {
            finale.showsDepth = true
        }
        withAnimation(.smooth(duration: plan.valueDuration).delay(plan.valueStagger)) {
            finale.showsTime = true
        }
        if plan.tracesLine {
            withAnimation(.easeInOut(duration: plan.lineDuration).delay(plan.lineDelay)) {
                finale.lineProgress = 1
                finale.waterOpacity = 1
            }
        } else {
            finale.lineProgress = 1
            withAnimation(.easeInOut(duration: plan.fadeDuration)) {
                finale.waterOpacity = 1
            }
        }
        if plan.ridesLogo {
            withAnimation(.linear(duration: plan.riderFadeInDuration).delay(plan.lineDelay)) {
                finale.riderOpacity = 1
            }
        }
        let dotAnimation: Animation = plan.tracesLine
            ? .snappy(duration: plan.dotDuration).delay(plan.dotDelay)
            : .easeInOut(duration: plan.dotDuration)
        withAnimation(dotAnimation) {
            finale.showsDeepest = true
        }

        finaleTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(plan.riderFadeOutDelay))
            guard !Task.isCancelled, !finale.isFinished else { return }
            withAnimation(.easeOut(duration: plan.riderFadeOutDuration)) {
                finale.riderOpacity = 0
            }
            try? await Task.sleep(for: .seconds(plan.riderFadeOutDuration))
            guard !Task.isCancelled else { return }
            finale.isFinished = true
        }
    }

    /// Jumps to the finished summary: no values rising, the profile drawn, no logo.
    private func finishFinale() {
        guard finale.hasStarted, !finale.isFinished else { return }
        finaleTask?.cancel()
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            finale.finish()
            finale.generation += 1
        }
    }

    /// The pinned bottom chip (DECISIONS D11): what the next Action Button press does, drawn as the
    /// recording hint chip without page dots, 8 pt above the screen's edge on a band that hides the
    /// rows scrolling under it. It stands in for RecordingHint.swift's text-only chip of this name.
    private struct NextDiveActionHint: View {
        var body: some View {
            RecordingHintChip(text: String(localized: "Action ▸ Start next dive"))
                .padding(.top, 6)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity)
                .background {
                    LinearGradient(
                        stops: [
                            .init(color: DiveWatchTheme.canvas.opacity(0), location: 0),
                            .init(color: DiveWatchTheme.canvas, location: 0.2),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
        }
    }
}

/// The finale's state: what has appeared, how far the profile has drawn, and whether the logo rides.
private struct SummaryFinale {
    var hasStarted = false
    var isFinished = false
    var showsDepth = false
    var showsTime = false
    var lineProgress: CGFloat = 0
    var waterOpacity: Double = 0
    var showsDeepest = false
    var riderOpacity: Double = 0
    var bounceCount = 0
    /// Bumped when the finale is cut short, so its views start over at their end state.
    var generation = 0

    mutating func finish() {
        isFinished = true
        showsDepth = true
        showsTime = true
        lineProgress = 1
        waterOpacity = 1
        showsDeepest = true
        riderOpacity = 0
    }
}

private struct SummaryScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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
        VStack(alignment: .leading, spacing: 6) {
            DiveSectionEyebrow(title: String(localized: "Free Session Summary"))
            DiveStatPair {
                SummaryRow(title: String(localized: "Dive count"), value: "\(session.diveCount)")
            } trailing: {
                SummaryRow(
                    title: String(localized: "Longest dive"),
                    value: DiveFormatters.savedDuration(session.longestDiveDurationSeconds)
                )
            }
        }
        .diveScrollEdge()
    }
}

private struct SafetyStopSummarySection: View {
    let session: ScubaDiveSession

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DiveSectionEyebrow(title: String(localized: "Safety Stop Summary"))
            // The note sits first, so it is always on screen with the values (C12).
            DiveSectionNote(text: String(localized: "Recommended safety stop reminder · no safety calculation"))
            SafetyStopRecordStats(safetyStop: session.safetyStop)
                .padding(.top, 2)
        }
    }
}

/// A saved recommended stop's values (COPY C6), shared by the summary and the detail: the status
/// (grey when completed), what remained when it was not completed, the time in the stop zone, the
/// target depth and zone, and when it started and finished.
struct SafetyStopRecordStats: View {
    let safetyStop: SafetyStopRecord

    private struct Line: Identifiable {
        let id: Int
        let rows: [StopRecordRow]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(StopRecordLayout.rows(for: safetyStop).enumerated().map { Line(id: $0.offset, rows: $0.element) }) { line in
                DiveStatPair {
                    stat(line.rows[0])
                } trailing: {
                    if line.rows.count > 1 {
                        stat(line.rows[1])
                    }
                }
                .diveScrollEdge()
            }
        }
    }

    @ViewBuilder
    private func stat(_ row: StopRecordRow) -> some View {
        switch row {
        case .status:
            // The status appears once, as this row.
            SummaryRow(title: String(localized: "Status"), value: safetyStop.status.displayText, accent: statusColor,
                       wordRole: .footnoteEmphasis)
        case .remaining:
            SummaryRow(title: String(localized: "Remaining"), value: DiveFormatters.savedDuration(safetyStop.reviewRemainingSeconds))
        case .timeInZone:
            SummaryRow(title: String(localized: "Time in zone"), value: DiveFormatters.savedDuration(safetyStop.reviewTimeInZoneSeconds))
        case .targetZone:
            SummaryRow(title: String(localized: "Target / zone"), value: targetZoneText)
        case .started:
            SummaryRow(title: String(localized: "Started"), value: safetyStop.startedAt.map { DiveFormatters.timeOfDay($0) } ?? "--")
        case .completedAt:
            SummaryRow(title: String(localized: "Completed at"),
                       value: safetyStop.completedAt.map { DiveFormatters.timeOfDay($0) } ?? "--")
        }
    }

    /// "5.0 m · 3.0–6.0 m".
    private var targetZoneText: String {
        "\(DiveFormatters.depth(safetyStop.targetDepthMeters)) · \(DiveFormatters.depthValue(safetyStop.minDepthMeters))–\(DiveFormatters.depth(safetyStop.maxDepthMeters))"
    }

    private var statusColor: Color {
        safetyStop.status.reviewTint
    }
}
