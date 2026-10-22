import SwiftUI

enum WatchRecordingMode: Equatable {
    case real
    case demo
    case debugTest

    var captureMode: DiveCaptureMode {
        switch self {
        case .real:
            return .real
        case .demo, .debugTest:
            return .demo
        }
    }

    var controlPolicy: RecordingControlPolicy {
        switch self {
        case .real:
            return .real
        case .demo, .debugTest:
            return .simulated
        }
    }

    @MainActor
    func makeSimulatedSensorProvider() -> DepthSensorProvider? {
        guard self != .real else {
            return nil
        }
        return DemoDepthSensorProvider()
    }

    var markerTitle: String? {
        switch self {
        case .real:
            return nil
        case .demo:
            return String(localized: "Demo")
        case .debugTest:
            return String(localized: "Test")
        }
    }

    var endControl: RecordingEndControl {
        switch self {
        case .real:
            return .crownHint
        case .demo:
            return .toolbarEnd
        case .debugTest:
            return .hidden
        }
    }

    func prepare(plan: PreDivePlan) -> PreDivePlan {
        guard self == .debugTest, !plan.userTags.contains(DiveSessionRecord.debugTestTag) else {
            return plan
        }

        var taggedPlan = plan
        taggedPlan.userTags.append(DiveSessionRecord.debugTestTag)
        return taggedPlan
    }
}

enum RecordingEndControl: Equatable {
    /// Real recording: the phase hint chip under the instrument. It names the next Action Button
    /// press, or the crown turn on a watch that probably has no Action Button.
    case crownHint
    case toolbarEnd
    case hidden
}

enum RecordingControlPolicy: Equatable {
    case real
    case simulated

    var usesCrownDepthControl: Bool {
        self == .simulated
    }
}

enum RecordingDepthPolicy {
    static func sensorDisplayLimit(maximumDepthMeters: Double?) -> Double {
        min(
            maximumDepthMeters ?? DiveDepthSupport.supportedWatchDepthLimitMeters,
            DiveDepthSupport.supportedWatchDepthLimitMeters
        )
    }
}

/// The one status line above the gauge: the freedive phase, the demo/test marker, and the depth
/// status when the depth number is not current. Always-On never hides it.
struct LiveReadoutStatus: Equatable {
    var depthStatusText: String?
    var markerTitle: String?
    var phaseTitle: String?
    /// The phase chip uses the primary colour only while a dive is under way.
    var phaseIsActive = false
}

private struct LiveReadoutStatusKey: EnvironmentKey {
    static let defaultValue = LiveReadoutStatus()
}

extension EnvironmentValues {
    var liveReadoutStatus: LiveReadoutStatus {
        get { self[LiveReadoutStatusKey.self] }
        set { self[LiveReadoutStatusKey.self] = newValue }
    }
}

private struct CompactRecordingReadoutKey: EnvironmentKey {
    static let defaultValue = false
}

private extension EnvironmentValues {
    var compactRecordingReadout: Bool {
        get { self[CompactRecordingReadoutKey.self] }
        set { self[CompactRecordingReadoutKey.self] = newValue }
    }
}

/// Secondary values stack one per row, so a value such as "2.1 m/min" never splits across lines in a
/// narrow column. Compact readouts only tighten the spacing and type.
private struct RecordingSecondaryMetrics<Content: View>: View {
    @Environment(\.compactRecordingReadout) private var compact
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 1 : 3) { content }
    }
}

struct RecordingInstrumentView: View {
    @ObservedObject var recorder: DiveSessionRecorder
    let plan: PreDivePlan
    let maximumDepthMeters: Double?
    let endControl: RecordingEndControl
    var showsNavigationToolbar = false
    var waterState: WaterSubmersionState = .unknown
    var markerTitle: String?
    /// Real recording only: the readout pages the Action Button and crown move. Demo and debug
    /// recordings pass `nil`, stay on Live and keep the crown for simulated depth.
    var pages: RecordingPageModel?

    var body: some View {
        if let pages {
            RealRecordingPager(pages: pages, waterState: waterState, currentMode: plan.diveMode) { page, hint in
                instrumentStack(page: page, hint: hint)
            }
        } else {
            instrumentStack(page: .live, hint: nil)
        }
    }

    private func instrumentStack(page: RecordingPage, hint: RecordingHint?) -> some View {
        GeometryReader { proxy in
            VStack(spacing: 3) {
                LiveReadoutStatusRow()
                    .fixedSize(horizontal: false, vertical: true)
                UnsupportedDepthWarning(
                    currentDepthMeters: displayedDepthMeters,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )
                pageInstrument(page)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .layoutPriority(1)

                recordingErrorFooter
                    .fixedSize(horizontal: false, vertical: true)

                // No fixed non-certified line during a dive (owner decision, 2026-10-22): Home, Wet
                // Ready and the saved summary and detail carry the full sentence, and the stop
                // readout already says "Recommended stop".

                // The phase hint replaces a fixed end instruction. Demo ends from its toolbar and
                // debug recordings show no end hint.
                if endControl == .crownHint, let hint {
                    RecordingHintBar(hint: hint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .environment(\.liveReadoutStatus, readoutStatus(for: page))
            .environment(\.recordingAuthorizedMaximum, maximumDepthMeters)
            .environment(\.compactRecordingReadout, proxy.size.height < Self.compactReadoutHeight || recorder.recordingPersistenceError != nil)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .padding(.horizontal, 4)
        // The system bottom inset left a blank band on every watch size. The readout and gauge take
        // that height; this margin keeps the centred hint chip clear of the rounded corners.
        .padding(.bottom, 8)
        .ignoresSafeArea(.container, edges: .bottom)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .toolbar(showsNavigationToolbar ? .visible : .hidden, for: .navigationBar)
    }

    /// Below this the secondary values stack inline; 41/42 mm recording viewports fall under it.
    static let compactReadoutHeight: CGFloat = 190

    private func readoutStatus(for page: RecordingPage) -> LiveReadoutStatus {
        var status = LiveReadoutStatus(depthStatusText: depthStatusText, markerTitle: markerTitle)
        // The End page states its own purpose in large type; scuba shows the recommended-stop label
        // inside the stop readout. Freedive names its phase here so it is never stacked separately.
        guard page != .end, plan.diveMode == .freedive else { return status }
        switch currentFreeSnapshot.state {
        case .surfaceReady:
            status.phaseTitle = String(localized: "Surface ready")
        case .diveActive:
            status.phaseTitle = String(localized: "Dive active")
            status.phaseIsActive = true
        case .surfaceInterval:
            // The big rest-time value is already captioned "Surface interval".
            break
        case .summary:
            status.phaseTitle = String(localized: "Summary")
        }
        return status
    }

    @ViewBuilder
    private var recordingErrorFooter: some View {
        if recorder.recordingPersistenceError != nil {
            Label(String(localized: "Save retry pending"), systemImage: "externaldrive.badge.exclamationmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)
                .lineLimit(1)
                .minimumScaleFactor(1)
                .frame(maxWidth: .infinity)
        }
    }

    private var sensorDisplayLimitMeters: Double {
        RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: maximumDepthMeters)
    }

    private var displayedDepthMeters: Double? {
        recorder.liveDepthSignal == .live ? recorder.currentDepth : nil
    }

    private var displayedAscentRate: Double? {
        recorder.liveDepthSignal == .live ? recorder.latestAscentRateMetersPerMinute : nil
    }

    /// The deepest sample so far, or `nil` before the first one, so an unknown maximum never reads 0.
    private var capturedMaxDepthMeters: Double? {
        recorder.hasCapturedDepthSample ? recorder.maxDepth : nil
    }

    private var depthStatusText: String? {
        switch recorder.liveDepthSignal {
        case .live:
            return nil
        case .awaitingFirstSample:
            return waterState == .notSubmerged
                ? String(localized: "At surface")
                : String(localized: "Waiting for depth")
        case .stale:
            return waterState == .notSubmerged
                ? String(localized: "At surface")
                : String(localized: "Depth unavailable")
        case .sensorError:
            return String(localized: "Depth sensor error")
        case .beyondSensorRange:
            return String(localized: "Outside sensor-authorized depth")
        }
    }

    /// Every page keeps the depth gauge, the status row and the unsupported-depth marker.
    @ViewBuilder
    private func pageInstrument(_ page: RecordingPage) -> some View {
        switch page {
        case .live:
            liveInstrument
        case .details:
            detailsInstrument
        case .switchMode:
            SwitchModePageInstrument(
                currentMode: plan.diveMode,
                currentDepthMeters: displayedDepthMeters,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .end:
            EndPageInstrument(
                currentDepthMeters: displayedDepthMeters,
                elapsedTime: recorder.elapsedTime,
                maxDepthMeters: capturedMaxDepthMeters,
                scaleDepthMeters: recorder.maxDepth,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        }
    }

    @ViewBuilder
    private var liveInstrument: some View {
        switch plan.diveMode {
        case .freedive:
            freediveInstrument(snapshot: currentFreeSnapshot)
        case .scuba:
            if shouldShowSafetyStopInstrument {
                SafetyStopInstrument(
                    currentDepthMeters: displayedDepthMeters,
                    safetyStop: recorder.scubaSafetyStop,
                    elapsedTime: recorder.elapsedTime,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )
            } else {
                ScubaLiveInstrument(
                    currentDepthMeters: displayedDepthMeters,
                    elapsedTime: recorder.elapsedTime,
                    displayedMaxDepthMeters: recorder.maxDepth,
                    ascentRateMetersPerMinute: displayedAscentRate,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )
            }
        }
    }

    /// Values the recorder already publishes, two secondary values at most.
    @ViewBuilder
    private var detailsInstrument: some View {
        switch plan.diveMode {
        case .freedive:
            FreeSessionDetailsInstrument(
                currentDepthMeters: displayedDepthMeters,
                snapshot: currentFreeSnapshot,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .scuba:
            ScubaDetailsInstrument(
                currentDepthMeters: displayedDepthMeters,
                elapsedTime: recorder.elapsedTime,
                maxDepthMeters: capturedMaxDepthMeters,
                scaleDepthMeters: recorder.maxDepth,
                waterTemperatureCelsius: recorder.waterTemperatureCelsius,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        }
    }

    @ViewBuilder
    private func freediveInstrument(snapshot: FreeDiveSessionSnapshot) -> some View {
        switch snapshot.state {
        case .surfaceReady:
            FreeSurfaceReadyInstrument(
                currentDepthMeters: displayedDepthMeters,
                sessionTime: recorder.elapsedTime,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .diveActive:
            FreeDiveActiveInstrument(
                currentDepthMeters: displayedDepthMeters,
                activeDiveTime: snapshot.activeSegment?.durationSeconds ?? 0,
                primaryTime: recorder.freeDivePrimaryTime,
                maxDepthMeters: snapshot.maxDepthMeters,
                ascentRateMetersPerMinute: displayedAscentRate,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .surfaceInterval:
            FreeSurfaceIntervalInstrument(
                currentDepthMeters: displayedDepthMeters,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .summary:
            FreeDiveSummaryInstrument(
                currentDepthMeters: displayedDepthMeters,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        }
    }

    private var currentFreeSnapshot: FreeDiveSessionSnapshot {
        recorder.freeSnapshot ?? FreeDiveSessionSnapshot(
            state: .surfaceReady,
            segments: [],
            activeSegment: nil,
            diveCount: 0,
            maxDepthMeters: recorder.maxDepth,
            currentDepthMeters: recorder.currentDepth
        )
    }

    private var shouldShowSafetyStopInstrument: Bool {
        switch recorder.scubaSafetyStop.status {
        case .active, .pausedTooShallow, .completed:
            return true
        case .pausedTooDeep, .armed, .unknown, .notRequired, .skippedOrIncomplete:
            return false
        }
    }

    private func surfaceRestTime(for snapshot: FreeDiveSessionSnapshot) -> TimeInterval {
        guard let lastEndTime = snapshot.segments.last?.endTime else {
            return 0
        }

        return max(0, Date().timeIntervalSince(lastEndTime))
    }
}

#if DEBUG
enum RecordingLayoutFixture: String {
    case real
    case demo
    case debug

    var recordingMode: WatchRecordingMode {
        switch self {
        case .real:
            return .real
        case .demo:
            return .demo
        case .debug:
            return .debugTest
        }
    }

    var diveMode: DiveMode {
        self == .debug ? .freedive : .scuba
    }
}

struct RecordingLayoutFixtureView: View {
    let fixture: RecordingLayoutFixture

    @StateObject private var recorder: DiveSessionRecorder

    init(fixture: RecordingLayoutFixture) {
        self.fixture = fixture
        _recorder = StateObject(
            wrappedValue: DiveSessionRecorder(
                sensorProvider: DemoDepthSensorProvider(),
                captureMode: .demo
            )
        )
    }

    var body: some View {
        RecordingInstrumentView(
            recorder: recorder,
            plan: plan,
            maximumDepthMeters: fixture == .real ? 6 : nil,
            endControl: fixture.recordingMode.endControl,
            markerTitle: fixture.recordingMode.markerTitle
        )
        .onAppear {
            recorder.startSession(plan: plan)
            recorder.setDemoDepthMeters(fixture == .real ? 8 : 0)
        }
        .onDisappear {
            _ = recorder.cancelSession()
        }
    }

    private var plan: PreDivePlan {
        var plan = PreDivePlan()
        plan.diveMode = fixture.diveMode
        return fixture.recordingMode.prepare(plan: plan)
    }
}
#endif

private struct FreeSurfaceReadyInstrument: View {
    let currentDepthMeters: Double?
    let sessionTime: TimeInterval
    let maxDepthMeters: Double
    let diveCount: Int
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            Spacer(minLength: 2)

            BigMetricText(
                caption: String(localized: "Session time"),
                value: DiveFormatters.duration(sessionTime),
                color: DiveWatchTheme.secondary,
                accessibilityTitle: String(localized: "Session time")
            )

            RecordingSecondaryMetrics {
                LiveInstrumentMetric(
                    title: String(localized: "Dive count"),
                    value: "\(max(0, diveCount))"
                )
                LiveInstrumentMetric(
                    title: String(localized: "Depth"),
                    value: DiveFormatters.depth(currentDepthMeters),
                    keepsInAlwaysOn: true
                )
            }

            Spacer(minLength: 2)
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

private struct FreeDiveActiveInstrument: View {
    let currentDepthMeters: Double?
    let activeDiveTime: TimeInterval
    let primaryTime: TimeInterval
    let maxDepthMeters: Double
    let ascentRateMetersPerMinute: Double?
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            DepthOrTimeMetric(depthMeters: currentDepthMeters, time: primaryTime,
                timeCaption: DiveFormatters.freeDiveTimeCaption(depthMeters: currentDepthMeters))

            RecordingSecondaryMetrics {
                if currentDepthMeters == nil {
                    LiveInstrumentMetric(
                        title: String(localized: "Observed time"),
                        value: DiveFormatters.duration(activeDiveTime),
                        keepsInAlwaysOn: true
                    )
                } else {
                    DepthOrTimeSecondary(depthMeters: currentDepthMeters, time: activeDiveTime)
                }
                LiveInstrumentMetric(
                    title: String(localized: "Ascent"),
                    value: DiveFormatters.ascentRate(ascentRateMetersPerMinute)
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

private struct InstrumentDepthLayout<Content: View>: View {
    let currentDepthMeters: Double?
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?
    let sensorDisplayLimitMeters: Double
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            DepthGaugeRail(
                depthMeters: currentDepthMeters,
                maxScaleMeters: maxScaleMeters,
                stopZone: stopZone,
                targetDepthMeters: targetDepthMeters
            )

            VStack(alignment: .leading, spacing: 3) {
                content
            }
            .padding(.top, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// The depth status chip and the Demo/Test marker. Always-On never hides them.
private struct LiveReadoutStatusRow: View {
    @Environment(\.liveReadoutStatus) private var status

    var body: some View {
        if status.phaseTitle != nil || status.markerTitle != nil || status.depthStatusText != nil {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) { chips }
                VStack(alignment: .leading, spacing: 2) { chips }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private var chips: some View {
        if let phaseTitle = status.phaseTitle {
            chip(phaseTitle, color: status.phaseIsActive ? DiveWatchTheme.primary : DiveWatchTheme.secondary)
        }
        if let markerTitle = status.markerTitle {
            chip(markerTitle, color: DiveWatchTheme.secondary)
        }
        if let depthStatusText = status.depthStatusText {
            chip(depthStatusText, color: DiveWatchTheme.mutedText)
        }
    }

    private func chip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .lineLimit(2)
            .minimumScaleFactor(1)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
            )
    }
}

private struct UnsupportedDepthWarning: View {
    let currentDepthMeters: Double?
    let sensorDisplayLimitMeters: Double

    var body: some View {
        if let currentDepthMeters, currentDepthMeters > sensorDisplayLimitMeters {
            Text(String(localized: "Outside sensor-authorized depth"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(2)
                .minimumScaleFactor(1)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
                )
        }
    }
}

private struct FreeSurfaceIntervalInstrument: View {
    let currentDepthMeters: Double?
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
    let maxDepthMeters: Double
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            BigMetricText(
                caption: String(localized: "Surface interval"),
                value: DiveFormatters.duration(observedInterval),
                color: DiveWatchTheme.secondary,
                accessibilityTitle: observedInterval == nil
                    ? String(localized: "Depth unavailable") : String(localized: "Surface interval")
            )

            FreeLastDiveMetrics(lastSegment: lastSegment)
        }
    }

    private var observedInterval: TimeInterval? {
        DiveFormatters.observedSurfaceInterval(surfaceRestTime, depthMeters: currentDepthMeters)
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

/// The freedive session after the engine stops counting dives. It reads like the surface interval.
private struct FreeDiveSummaryInstrument: View {
    let currentDepthMeters: Double?
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
    let maxDepthMeters: Double
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            BigMetricText(
                caption: String(localized: "Surface interval"),
                value: DiveFormatters.duration(surfaceRestTime),
                color: DiveWatchTheme.secondary,
                accessibilityTitle: String(localized: "Surface interval")
            )

            FreeLastDiveMetrics(lastSegment: lastSegment)
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

private struct ScubaLiveInstrument: View {
    let currentDepthMeters: Double?
    let elapsedTime: TimeInterval
    let displayedMaxDepthMeters: Double
    let ascentRateMetersPerMinute: Double?
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            DepthOrTimeMetric(depthMeters: currentDepthMeters, time: elapsedTime)

            RecordingSecondaryMetrics {
                DepthOrTimeSecondary(depthMeters: currentDepthMeters, time: elapsedTime)
                LiveInstrumentMetric(
                    title: String(localized: "Ascent"),
                    value: DiveFormatters.ascentRate(ascentRateMetersPerMinute)
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, displayedMaxDepthMeters) / 10) * 10)
    }
}

private struct SafetyStopInstrument: View {
    let currentDepthMeters: Double?
    let safetyStop: SafetyStopRecord
    var elapsedTime: TimeInterval = 0
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
            targetDepthMeters: safetyStop.targetDepthMeters,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            pausedBand

            Text(String(localized: "Recommended stop"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(statusColor)
                .fixedSize(horizontal: false, vertical: true)

            BigMetricText(
                value: DiveFormatters.duration(safetyStop.remainingSeconds),
                color: statusColor,
                accessibilityTitle: String(localized: "Recommended stop time remaining"),
                size: 34
            )

            RecordingSecondaryMetrics {
                LiveInstrumentMetric(
                    title: String(localized: "Depth"),
                    value: DiveFormatters.depth(currentDepthMeters),
                    keepsInAlwaysOn: true
                )

                LiveInstrumentMetric(
                    title: String(localized: "Log time"),
                    value: DiveFormatters.duration(elapsedTime),
                    keepsInAlwaysOn: true
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(10, ceil((max(currentDepthMeters ?? 0, safetyStop.maxDepthMeters) + 2) / 2) * 2)
    }

    private var isTimerPaused: Bool {
        safetyStop.isDisplayTimerPaused(depthMeters: currentDepthMeters)
    }

    /// A recommended stop is the supplementary caution amber while it counts and while it pauses:
    /// never the action blue, and never the danger tone reserved for future mandatory states. The
    /// paused/completed wording tells states apart without relying on color.
    private var statusColor: Color {
        DiveWatchTheme.caution
    }

    /// A paused timer is told apart by words as well as amber, so it still reads in Always-On.
    @ViewBuilder
    private var pausedBand: some View {
        if safetyStop.status == .completed {
            Label(String(localized: "Stop complete"), systemImage: "checkmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(statusColor)
        } else if isTimerPaused {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(DiveWatchTheme.caution.opacity(0.7))
                    .frame(width: 3, height: 10)

                Text(String(localized: "Timer paused"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.caution)
                    .lineLimit(1)
                    .minimumScaleFactor(1)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

private struct LiveInstrumentMetric: View {
    let title: String
    let value: String
    /// Always-On keeps only the values read at a glance (depth and time); the rest are hidden.
    var keepsInAlwaysOn = false

    @Environment(\.compactRecordingReadout) private var compact
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        if keepsInAlwaysOn || !isLuminanceReduced {
            // Label and value on one row when both fit at full size; otherwise the label goes above.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    metricLabel.fixedSize()
                    metricValue.fixedSize()
                }
                VStack(alignment: .leading, spacing: 2) {
                    metricLabel
                    metricValue
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    private var metricLabel: some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.mutedText)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var metricValue: some View {
        Text(value)
            .font(DiveWatchTheme.metricFont(size: compact ? 14 : 18, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.text)
            .lineLimit(2)
            .minimumScaleFactor(compact ? 11.0 / 14.0 : 11.0 / 18.0)
    }
}

/// The large number on a recording page. Digits are rounded and equal width, and the unit is a
/// smaller separate text so the number keeps its size. Always-On draws the number white.
private struct BigMetricText: View {
    var caption: String?
    let value: String
    var unit: String?
    let color: Color
    let accessibilityTitle: String
    var size: CGFloat = 38

    @Environment(\.compactRecordingReadout) private var compact
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let caption {
                Text(caption)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(1)
            }

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(DiveWatchTheme.metricFont(size: compact ? min(size, 30) : size, weight: .semibold))
                    .foregroundStyle(isLuminanceReduced ? DiveWatchTheme.text : color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                if let unit {
                    Text(unit)
                        .font(.system(size: max(11, size * 0.36), weight: .semibold, design: .rounded))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityTitle))
        .accessibilityValue(Text(unit.map { "\(value) \($0)" } ?? value))
    }
}

/// The one large value: live depth while the reading is current, otherwise the elapsed time, so a
/// depth that is no longer current never stays on screen as the main number.
private struct DepthOrTimeMetric: View {
    let depthMeters: Double?
    let time: TimeInterval
    var timeCaption: String?

    var body: some View {
        if let depthMeters {
            BigMetricText(
                value: DiveFormatters.depthValue(depthMeters),
                unit: "m",
                color: DiveWatchTheme.primary,
                accessibilityTitle: String(localized: "Depth")
            )
        } else {
            BigMetricText(
                caption: timeCaption,
                value: DiveFormatters.duration(time),
                color: DiveWatchTheme.text,
                accessibilityTitle: timeCaption ?? String(localized: "Time")
            )
        }
    }
}

/// Whichever of depth and time is not the large value. Unknown depth reads `--.- m`.
private struct DepthOrTimeSecondary: View {
    let depthMeters: Double?
    let time: TimeInterval

    var body: some View {
        if depthMeters != nil {
            LiveInstrumentMetric(
                title: String(localized: "Time"),
                value: DiveFormatters.duration(time),
                keepsInAlwaysOn: true
            )
        } else {
            LiveInstrumentMetric(
                title: String(localized: "Depth"),
                value: DiveFormatters.depth(depthMeters),
                keepsInAlwaysOn: true
            )
        }
    }
}

/// The last freedive of the session. Before the first dive both values are unknown.
private struct FreeLastDiveMetrics: View {
    let lastSegment: FreeDiveSegment?

    var body: some View {
        RecordingSecondaryMetrics {
            LiveInstrumentMetric(
                title: String(localized: "Last duration"),
                value: DiveFormatters.duration(lastSegment?.durationSeconds)
            )
            LiveInstrumentMetric(
                title: String(localized: "Last depth"),
                value: DiveFormatters.depth(lastSegment?.maxDepthMeters)
            )
        }
    }
}

/// Details page, scuba: maximum depth and water temperature beside the one large value.
private struct ScubaDetailsInstrument: View {
    let currentDepthMeters: Double?
    let elapsedTime: TimeInterval
    let maxDepthMeters: Double?
    let scaleDepthMeters: Double
    let waterTemperatureCelsius: Double?
    let sensorDisplayLimitMeters: Double

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: max(30, ceil(max(currentDepthMeters ?? 0, scaleDepthMeters) / 10) * 10),
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            DepthOrTimeMetric(depthMeters: currentDepthMeters, time: elapsedTime)

            RecordingSecondaryMetrics {
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Temp"),
                    value: DiveFormatters.temperature(waterTemperatureCelsius)
                )
            }
        }
    }
}

/// Details page, freedive session: the dive count, then the last and the longest dive.
private struct FreeSessionDetailsInstrument: View {
    let currentDepthMeters: Double?
    let snapshot: FreeDiveSessionSnapshot
    let sensorDisplayLimitMeters: Double

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: max(30, ceil(max(currentDepthMeters ?? 0, snapshot.maxDepthMeters) / 10) * 10),
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            BigMetricText(
                caption: String(localized: "Dive count"),
                value: "\(max(0, snapshot.diveCount))",
                color: DiveWatchTheme.text,
                accessibilityTitle: String(localized: "Dive count"),
                size: 34
            )

            LiveInstrumentMetric(title: String(localized: "Last dive"), value: lastDiveText)

            LiveInstrumentMetric(
                title: String(localized: "Longest dive"),
                value: DiveFormatters.duration(snapshot.segments.map(\.durationSeconds).max())
            )
        }
    }

    private var lastDiveText: String {
        let lastSegment = snapshot.segments.last
        return "\(DiveFormatters.duration(lastSegment?.durationSeconds)) · \(DiveFormatters.depth(lastSegment?.maxDepthMeters))"
    }
}

/// Switch page, before the first descent: the next Action Button press restarts the recording as the
/// other dive type. Like the End page it has no tap target.
private struct SwitchModePageInstrument: View {
    let currentMode: DiveMode
    let currentDepthMeters: Double?
    let sensorDisplayLimitMeters: Double

    @Environment(\.compactRecordingReadout) private var compact

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: 30,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            if !compact {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .accessibilityHidden(true)
            }
            Text(switchTitle)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
            Text(String(localized: "No dive yet, so recording starts over."))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var switchTitle: String {
        currentMode == .freedive
            ? String(localized: "Switch to scuba")
            : String(localized: "Switch to freediving")
    }
}

/// The last page of the Action Button cycle, at the surface once ending is allowed. It has no tap
/// target: the next Action Button press ends through the coordinator's guarded path.
private struct EndPageInstrument: View {
    let currentDepthMeters: Double?
    let elapsedTime: TimeInterval
    let maxDepthMeters: Double?
    let scaleDepthMeters: Double
    let sensorDisplayLimitMeters: Double

    @Environment(\.compactRecordingReadout) private var compact

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: max(30, ceil(max(currentDepthMeters ?? 0, scaleDepthMeters) / 10) * 10),
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            let guidance = RecordingEndGuidance(hasActionButton: ActionButtonHint.current.isLikelyUltra)
            if !compact {
                Image(systemName: guidance.symbol)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .accessibilityHidden(true)
            }
            Text(guidance.text)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(guidance.accessibilityText)
            LiveInstrumentMetric(
                title: String(localized: "Log time"),
                value: DiveFormatters.duration(elapsedTime),
                keepsInAlwaysOn: true
            )
        }
    }
}

#if DEBUG
#Preview("Free Surface Ready") {
    FreeSurfaceReadyInstrument(
        currentDepthMeters: 0,
        sessionTime: 0,
        maxDepthMeters: 0,
        diveCount: 0
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Free Dive Active") {
    FreeDiveActiveInstrument(
        currentDepthMeters: 18.4,
        activeDiveTime: 46,
        primaryTime: 46,
        maxDepthMeters: 22.1,
        ascentRateMetersPerMinute: 3.6
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Free Surface Interval") {
    FreeSurfaceIntervalInstrument(
        currentDepthMeters: 0.6,
        surfaceRestTime: 135,
        lastSegment: previewFreeSegment(id: "00000000-0000-0000-0000-000000000301"),
        maxDepthMeters: 22.1
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Free Summary") {
    FreeDiveSummaryInstrument(
        currentDepthMeters: 0.4,
        surfaceRestTime: 135,
        lastSegment: previewFreeSegment(id: "00000000-0000-0000-0000-000000000302"),
        maxDepthMeters: 22.1
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Free Session Details") {
    FreeSessionDetailsInstrument(
        currentDepthMeters: nil,
        snapshot: FreeDiveSessionSnapshot(
            state: .surfaceInterval,
            segments: [previewFreeSegment(id: "00000000-0000-0000-0000-000000000303")],
            activeSegment: nil,
            diveCount: 1,
            maxDepthMeters: 22.1,
            currentDepthMeters: 0.4
        ),
        sensorDisplayLimitMeters: DiveDepthSupport.supportedWatchDepthLimitMeters
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Scuba Active") {
    ScubaLiveInstrument(
        currentDepthMeters: 18.6,
        elapsedTime: 18 * 60,
        displayedMaxDepthMeters: 21.2,
        ascentRateMetersPerMinute: 4.2
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Scuba Details") {
    ScubaDetailsInstrument(
        currentDepthMeters: 18.6,
        elapsedTime: 18 * 60,
        maxDepthMeters: 21.2,
        scaleDepthMeters: 21.2,
        waterTemperatureCelsius: 24,
        sensorDisplayLimitMeters: DiveDepthSupport.supportedWatchDepthLimitMeters
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("End Page") {
    EndPageInstrument(
        currentDepthMeters: nil,
        elapsedTime: 34 * 60,
        maxDepthMeters: 21.2,
        scaleDepthMeters: 21.2,
        sensorDisplayLimitMeters: DiveDepthSupport.supportedWatchDepthLimitMeters
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Safety Stop Inside") {
    SafetyStopInstrument(
        currentDepthMeters: 4.8,
        safetyStop: previewSafetyStop(status: .active, remainingSeconds: 134, timeInZoneSeconds: 46)
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Safety Stop Too Deep") {
    SafetyStopInstrument(
        currentDepthMeters: 6.8,
        safetyStop: previewSafetyStop(status: .pausedTooDeep, remainingSeconds: 168, timeInZoneSeconds: 12)
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Safety Stop Too Shallow") {
    SafetyStopInstrument(
        currentDepthMeters: 2.1,
        safetyStop: previewSafetyStop(status: .pausedTooShallow, remainingSeconds: 92, timeInZoneSeconds: 88)
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Stop Complete") {
    SafetyStopInstrument(
        currentDepthMeters: 4.7,
        safetyStop: previewSafetyStop(
            status: .completed,
            completed: true,
            remainingSeconds: 0,
            timeInZoneSeconds: 180,
            completedAt: Date(timeIntervalSince1970: 1_783_225_705)
        )
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

private func previewFreeSegment(id: String) -> FreeDiveSegment {
    FreeDiveSegment(
        id: UUID(uuidString: id)!,
        index: 3,
        startTime: Date(timeIntervalSince1970: 1_783_225_525),
        endTime: Date(timeIntervalSince1970: 1_783_225_571),
        durationSeconds: 46,
        maxDepthMeters: 22.1,
        minDepthMeters: 0.4,
        sampleStartIndex: 20,
        sampleEndIndex: 42,
        descentRateMetersPerSecond: nil,
        ascentRateMetersPerSecond: nil
    )
}

private func previewSafetyStop(
    status: SafetyStopStatus,
    completed: Bool = false,
    remainingSeconds: TimeInterval,
    timeInZoneSeconds: TimeInterval,
    completedAt: Date? = nil
) -> SafetyStopRecord {
    SafetyStopRecord(
        status: status,
        required: true,
        completed: completed,
        targetDepthMeters: 5,
        minDepthMeters: 3,
        maxDepthMeters: 6,
        durationSeconds: 180,
        startedAt: Date(timeIntervalSince1970: 1_783_225_525),
        completedAt: completedAt,
        remainingSeconds: remainingSeconds,
        timeInZoneSeconds: timeInZoneSeconds
    )
}
#endif
