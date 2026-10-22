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

/// Status shown above live values when the depth number is not current, plus the demo/test marker.
struct LiveReadoutStatus: Equatable {
    var depthStatusText: String?
    var markerTitle: String?
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
            RealRecordingPager(pages: pages, waterState: waterState) { page, hint in
                instrumentStack(page: page, hint: hint)
            }
        } else {
            instrumentStack(page: .live, hint: nil)
        }
    }

    private func instrumentStack(page: RecordingPage, hint: RecordingHint?) -> some View {
        GeometryReader { proxy in
            VStack(spacing: 4) {
                pageInstrument(page)
                    .environment(
                        \.liveReadoutStatus,
                        LiveReadoutStatus(depthStatusText: depthStatusText, markerTitle: markerTitle)
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .layoutPriority(1)

                recordingErrorFooter

                Text(DiveWatchTheme.safetyDisclaimer)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.7))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)

                // The phase hint replaces a fixed end instruction. Demo ends from its toolbar and
                // debug recordings show no end hint.
                if endControl == .crownHint, let hint {
                    RecordingHintBar(hint: hint)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 3)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .toolbar(showsNavigationToolbar ? .visible : .hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var recordingErrorFooter: some View {
        if recorder.recordingPersistenceError != nil {
            Label("Storage retry pending", systemImage: "externaldrive.badge.exclamationmark")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.danger)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
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
            endControl: fixture.recordingMode.endControl
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
            StatusPill(title: String(localized: "Surface ready"), color: DiveWatchTheme.secondary)

            Spacer(minLength: 2)

            BigMetricText(
                value: DiveFormatters.duration(sessionTime),
                color: DiveWatchTheme.secondary,
                accessibilityTitle: String(localized: "Session time")
            )

            HStack(spacing: 7) {
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
            StatusPill(title: String(localized: "Dive active"), color: DiveWatchTheme.primary)

            DepthOrTimeMetric(depthMeters: currentDepthMeters, time: activeDiveTime)

            HStack(spacing: 7) {
                DepthOrTimeSecondary(depthMeters: currentDepthMeters, time: activeDiveTime)
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

            VStack(alignment: .leading, spacing: 6) {
                LiveReadoutStatusRow()

                UnsupportedDepthWarning(
                    currentDepthMeters: currentDepthMeters,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )

                content
            }
            .padding(.top, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// The depth status chip and the Demo/Test marker. Always-On never hides them.
private struct LiveReadoutStatusRow: View {
    @Environment(\.liveReadoutStatus) private var status

    var body: some View {
        if status.markerTitle != nil || status.depthStatusText != nil {
            HStack(spacing: 4) {
                if let markerTitle = status.markerTitle {
                    chip(markerTitle, color: DiveWatchTheme.secondary)
                }
                if let depthStatusText = status.depthStatusText {
                    chip(depthStatusText, color: DiveWatchTheme.mutedText)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func chip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.68)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
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
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.68)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
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
            StatusPill(title: String(localized: "Surface interval"), color: DiveWatchTheme.secondary)

            BigMetricText(
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
            StatusPill(title: String(localized: "Summary"), color: DiveWatchTheme.secondary)

            BigMetricText(
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

            HStack(spacing: 7) {
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

            StatusPill(title: String(localized: "Recommended stop"), color: statusColor)

            BigMetricText(
                value: DiveFormatters.duration(safetyStop.remainingSeconds),
                color: statusColor,
                accessibilityTitle: String(localized: "Recommended stop time remaining"),
                size: 48
            )

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Depth"),
                    value: DiveFormatters.depth(currentDepthMeters),
                    keepsInAlwaysOn: true
                )

                LiveInstrumentMetric(
                    title: String(localized: "Stop zone"),
                    value: "\(DiveFormatters.depthValue(safetyStop.minDepthMeters))-\(DiveFormatters.depth(safetyStop.maxDepthMeters))"
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(10, ceil((max(currentDepthMeters ?? 0, safetyStop.maxDepthMeters) + 2) / 2) * 2)
    }

    private var isTimerPaused: Bool {
        safetyStop.status == .pausedTooDeep || safetyStop.status == .pausedTooShallow
    }

    /// A recommended stop uses the supplementary caution tone when paused, never the danger tone
    /// reserved for future mandatory states.
    private var statusColor: Color {
        if isTimerPaused {
            return DiveWatchTheme.caution
        }

        return safetyStop.status == .completed ? DiveWatchTheme.secondary : DiveWatchTheme.primary
    }

    /// A paused timer is told apart by words as well as amber, so it still reads in Always-On.
    @ViewBuilder
    private var pausedBand: some View {
        if isTimerPaused {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(DiveWatchTheme.caution.opacity(0.7))
                    .frame(width: 3, height: 10)

                Text(String(localized: "Timer paused"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.caution)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
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

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        if keepsInAlwaysOn || !isLuminanceReduced {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                Text(value)
                    .font(DiveWatchTheme.metricFont(size: 18, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.48)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
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
    var size: CGFloat = 50

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let caption {
                Text(caption.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(DiveWatchTheme.metricFont(size: size, weight: .semibold))
                    .foregroundStyle(isLuminanceReduced ? DiveWatchTheme.text : color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let unit {
                    Text(unit)
                        .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
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
                value: DiveFormatters.duration(time),
                color: DiveWatchTheme.text,
                accessibilityTitle: String(localized: "Time")
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
        HStack(spacing: 7) {
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

            HStack(spacing: 7) {
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
                size: 40
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

/// The last page of the Action Button cycle, at the surface once ending is allowed. It has no tap
/// target: the next Action Button press ends through the coordinator's guarded path.
private struct EndPageInstrument: View {
    let currentDepthMeters: Double?
    let elapsedTime: TimeInterval
    let maxDepthMeters: Double?
    let scaleDepthMeters: Double
    let sensorDisplayLimitMeters: Double

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: max(30, ceil(max(currentDepthMeters ?? 0, scaleDepthMeters) / 10) * 10),
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            StatusPill(title: String(localized: "End & save"), color: DiveWatchTheme.secondary)

            BigMetricText(
                value: DiveFormatters.duration(elapsedTime),
                color: DiveWatchTheme.text,
                accessibilityTitle: String(localized: "Time")
            )

            LiveInstrumentMetric(
                title: String(localized: "Max"),
                value: DiveFormatters.depth(maxDepthMeters)
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
