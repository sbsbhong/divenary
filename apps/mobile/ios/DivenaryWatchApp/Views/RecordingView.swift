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

struct RecordingInstrumentView: View {
    @ObservedObject var recorder: DiveSessionRecorder
    let plan: PreDivePlan
    let maximumDepthMeters: Double?
    let endControl: RecordingEndControl
    var showsNavigationToolbar = false

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 4) {
                liveInstrument
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .layoutPriority(1)

                recordingErrorFooter

                if endControl == .crownHint {
                    RecordingEndControlFooter(
                        endControl: endControl
                    )
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

    @ViewBuilder
    private var liveInstrument: some View {
        switch plan.diveMode {
        case .freedive:
            freediveInstrument(snapshot: currentFreeSnapshot)
        case .scuba:
            if shouldShowSafetyStopInstrument {
                SafetyStopInstrument(
                    currentDepthMeters: recorder.currentDepth,
                    safetyStop: recorder.scubaSafetyStop,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )
            } else {
                ScubaLiveInstrument(
                    currentDepthMeters: recorder.currentDepth,
                    elapsedTime: recorder.elapsedTime,
                    displayedMaxDepthMeters: recorder.maxDepth,
                    ascentRateMetersPerMinute: recorder.latestAscentRateMetersPerMinute,
                    waterTemperatureCelsius: recorder.waterTemperatureCelsius,
                    sensorDisplayLimitMeters: sensorDisplayLimitMeters
                )
            }
        }
    }

    @ViewBuilder
    private func freediveInstrument(snapshot: FreeDiveSessionSnapshot) -> some View {
        switch snapshot.state {
        case .surfaceReady:
            FreeSurfaceReadyInstrument(
                currentDepthMeters: recorder.currentDepth,
                sessionTime: recorder.elapsedTime,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .diveActive:
            FreeDiveActiveInstrument(
                currentDepthMeters: recorder.currentDepth,
                activeDiveTime: snapshot.activeSegment?.durationSeconds ?? 0,
                maxDepthMeters: snapshot.maxDepthMeters,
                ascentRateMetersPerMinute: recorder.latestAscentRateMetersPerMinute,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .surfaceInterval:
            FreeSurfaceIntervalInstrument(
                currentDepthMeters: recorder.currentDepth,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
        case .summary:
            FreeDiveSummaryInstrument(
                currentDepthMeters: recorder.currentDepth,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount,
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

private struct RecordingEndControlFooter: View {
    let endControl: RecordingEndControl

    var body: some View {
        switch endControl {
        case .crownHint:
            footerHint(
                String(localized: "End with the configured Action Button or by turning off Water Lock.")
            )
        case .toolbarEnd, .hidden:
            EmptyView()
        }
    }

    private func footerHint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: .infinity)
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
    let currentDepthMeters: Double
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

            Text(DiveFormatters.duration(sessionTime))
                .font(DiveWatchTheme.metricFont(size: 48, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.secondary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Count"),
                    value: "\(max(0, diveCount))/#"
                )
                LiveInstrumentMetric(
                    title: String(localized: "Mode"),
                    value: String(localized: "Freedive")
                )
            }

            Spacer(minLength: 2)
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)
    }
}

private struct FreeDiveActiveInstrument: View {
    let currentDepthMeters: Double
    let activeDiveTime: TimeInterval
    let maxDepthMeters: Double
    let ascentRateMetersPerMinute: Double
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

            Text(DiveFormatters.depth(currentDepthMeters))
                .font(DiveWatchTheme.metricFont(size: 48, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.38)

            Text(DiveFormatters.duration(activeDiveTime))
                .font(DiveWatchTheme.metricFont(size: 27, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.55)

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Ascent"),
                    value: DiveFormatters.ascentRate(ascentRateMetersPerMinute)
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)
    }
}

private struct InstrumentDepthLayout<Content: View>: View {
    let currentDepthMeters: Double
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?
    let sensorDisplayLimitMeters: Double
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            DepthGaugeRail(
                depthMeters: currentDepthMeters,
                maxScaleMeters: maxScaleMeters,
                stopZone: stopZone,
                targetDepthMeters: targetDepthMeters
            )

            VStack(alignment: .leading, spacing: 9) {
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

private struct UnsupportedDepthWarning: View {
    let currentDepthMeters: Double
    let sensorDisplayLimitMeters: Double

    var body: some View {
        if currentDepthMeters > sensorDisplayLimitMeters {
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
    let currentDepthMeters: Double
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
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
            StatusPill(title: String(localized: "Surface interval"), color: DiveWatchTheme.secondary)

            Text(DiveFormatters.duration(surfaceRestTime))
                .font(DiveWatchTheme.metricFont(size: 46, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.secondary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Last duration"),
                    value: DiveFormatters.duration(lastSegment?.durationSeconds ?? 0)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Last depth"),
                    value: DiveFormatters.depth(lastSegment?.maxDepthMeters ?? 0)
                )
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Count"),
                    value: "\(max(0, diveCount))"
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)
    }
}

private struct FreeDiveSummaryInstrument: View {
    let currentDepthMeters: Double
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
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
            StatusPill(title: String(localized: "Summary"), color: DiveWatchTheme.secondary)

            Text(DiveFormatters.duration(surfaceRestTime))
                .font(DiveWatchTheme.metricFont(size: 46, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.secondary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Last duration"),
                    value: DiveFormatters.duration(lastSegment?.durationSeconds ?? 0)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Last depth"),
                    value: DiveFormatters.depth(lastSegment?.maxDepthMeters ?? 0)
                )
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Count"),
                    value: "\(max(0, diveCount))"
                )
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)
    }
}

private struct ScubaLiveInstrument: View {
    let currentDepthMeters: Double
    let elapsedTime: TimeInterval
    let displayedMaxDepthMeters: Double
    let ascentRateMetersPerMinute: Double
    let waterTemperatureCelsius: Double?
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            Text(DiveFormatters.depth(currentDepthMeters))
                .font(DiveWatchTheme.metricFont(size: 50, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.38)

            HStack(spacing: 7) {
                LiveInstrumentMetric(title: String(localized: "Time"), value: DiveFormatters.duration(elapsedTime))
                LiveInstrumentMetric(title: String(localized: "Max"), value: DiveFormatters.depth(displayedMaxDepthMeters))
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(title: String(localized: "Ascent"), value: DiveFormatters.ascentRate(ascentRateMetersPerMinute))
                LiveInstrumentMetric(title: String(localized: "Temp"), value: DiveFormatters.temperature(waterTemperatureCelsius))
            }
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, displayedMaxDepthMeters) / 10) * 10)
    }
}

private struct SafetyStopInstrument: View {
    let currentDepthMeters: Double
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
            warningBand

            StatusPill(title: String(localized: "Safety stop"), color: statusColor)

            Text(DiveFormatters.duration(safetyStop.remainingSeconds))
                .font(DiveWatchTheme.metricFont(size: 48, weight: .semibold))
                .foregroundStyle(statusColor)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)

            LiveInstrumentMetric(
                title: "",
                value: DiveFormatters.depth(currentDepthMeters)
            )

            LiveInstrumentMetric(
                title: String(localized: "Stop zone"),
                value: "\(DiveFormatters.depth(safetyStop.minDepthMeters))-\(DiveFormatters.depth(safetyStop.maxDepthMeters))"
            )
        }
    }

    private var maxScaleMeters: Double {
        max(10, ceil((max(currentDepthMeters, safetyStop.maxDepthMeters) + 2) / 2) * 2)
    }

    private var isTimerPaused: Bool {
        safetyStop.status == .pausedTooDeep || safetyStop.status == .pausedTooShallow
    }

    private var statusColor: Color {
        if isTimerPaused {
            return DiveWatchTheme.danger
        }

        return safetyStop.status == .completed ? DiveWatchTheme.secondary : DiveWatchTheme.primary
    }

    @ViewBuilder
    private var warningBand: some View {
        if isTimerPaused {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(DiveWatchTheme.danger)
                .frame(height: 5)
        }
    }
}

private struct LiveInstrumentMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if !title.isEmpty {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }

            Text(value)
                .font(DiveWatchTheme.metricFont(size: 18, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.48)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        lastSegment: FreeDiveSegment(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000301")!,
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
        ),
        maxDepthMeters: 22.1,
        diveCount: 3
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Free Summary") {
    FreeDiveSummaryInstrument(
        currentDepthMeters: 0.4,
        surfaceRestTime: 135,
        lastSegment: FreeDiveSegment(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000302")!,
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
        ),
        maxDepthMeters: 22.1,
        diveCount: 3
    )
    .padding(DiveWatchTheme.edgeMargin)
    .background(DiveWatchTheme.background)
}

#Preview("Scuba Active") {
    ScubaLiveInstrument(
        currentDepthMeters: 18.6,
        elapsedTime: 18 * 60,
        displayedMaxDepthMeters: 21.2,
        ascentRateMetersPerMinute: 4.2,
        waterTemperatureCelsius: 24
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
