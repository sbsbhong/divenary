import Combine
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

    func sensorProvider() -> DepthSensorProvider {
        switch self {
        case .real:
            return RealDepthSensorProvider()
        case .demo, .debugTest:
            return DemoDepthSensorProvider()
        }
    }

    var usesCrownDepthControl: Bool {
        switch self {
        case .real:
            return false
        case .demo, .debugTest:
            return true
        }
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
}

struct SurfaceEndDiveGate {
    private(set) var isVisible = false
    private var surfaceStartedAt: Date?
    private let showDepthMeters = 1.0
    private let hideDepthMeters = 1.2
    private let stableSurfaceSeconds: TimeInterval = 3

    mutating func update(depthMeters: Double, at timestamp: Date) {
        let currentDepthMeters = depthMeters.isFinite ? max(0, depthMeters) : 0

        if currentDepthMeters >= hideDepthMeters {
            surfaceStartedAt = nil
            isVisible = false
            return
        }

        guard currentDepthMeters <= showDepthMeters else {
            if !isVisible {
                surfaceStartedAt = nil
            }
            return
        }

        if surfaceStartedAt == nil {
            surfaceStartedAt = timestamp
        }

        if let surfaceStartedAt,
           timestamp.timeIntervalSince(surfaceStartedAt) >= stableSurfaceSeconds {
            isVisible = true
        }
    }
}

struct RecordingView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    let recordingMode: WatchRecordingMode
    @StateObject private var recorder: DiveSessionRecorder
    @State private var completedSession: DiveSessionRecord?
    @State private var controlledDepthMeters: Double = 0
    @State private var surfaceEndGate = SurfaceEndDiveGate()
    @FocusState private var crownDepthControlFocused: Bool
    @Environment(\.dismiss) private var dismiss
    private let surfaceGateTimer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    init(store: DiveSessionStore, plan: PreDivePlan, recordingMode: WatchRecordingMode = .real) {
        self.store = store
        self.plan = plan
        self.recordingMode = recordingMode
        let sensorProvider = recordingMode.sensorProvider()
        _recorder = StateObject(
            wrappedValue: DiveSessionRecorder(
                sensorProvider: sensorProvider,
                captureMode: recordingMode.captureMode
            )
        )
    }

    var body: some View {
        Group {
            if let completedSession {
                SummaryView(
                    session: completedSession,
                    onSave: { session in
                        store.save(session)
                        dismiss()
                    },
                    onDiscard: {
                        dismiss()
                    }
                )
            } else {
                crownControlledRecordingContent
            }
        }
        .navigationBarBackButtonHidden(recorder.isRecording)
        .onAppear {
            recorder.startSession(plan: plan)
        }
        .onDisappear {
            if completedSession == nil {
                recorder.cancelSession()
            }
        }
        .onChange(of: recorder.currentDepth) { _, _ in
            updateSurfaceEndGate()
        }
        .onReceive(surfaceGateTimer) { timestamp in
            guard completedSession == nil else { return }
            updateSurfaceEndGate(at: timestamp)
        }
    }

    @ViewBuilder
    private var crownControlledRecordingContent: some View {
        if recordingMode.usesCrownDepthControl {
            recordingContent
                .focusable(recordingMode.usesCrownDepthControl)
                .focused($crownDepthControlFocused)
                .digitalCrownRotation(
                    $controlledDepthMeters,
                    from: 0,
                    through: 60,
                    by: 0.1,
                    sensitivity: .medium,
                    isContinuous: false,
                    isHapticFeedbackEnabled: true
                )
                .onAppear {
                    recorder.setDemoDepthMeters(controlledDepthMeters)
                    crownDepthControlFocused = true
                }
                .onChange(of: controlledDepthMeters) { _, nextDepthMeters in
                    recorder.setDemoDepthMeters(nextDepthMeters)
                }
        } else {
            recordingContent
        }
    }

    private var recordingContent: some View {
        GeometryReader { proxy in
            VStack(spacing: recordingVerticalSpacing) {
                liveInstrument
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .layoutPriority(1)

                recordingControls

                recordingDisclaimer
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .padding(.horizontal, recordingHorizontalPadding)
        .padding(.bottom, 5)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var recordingControls: some View {
        if surfaceEndGate.isVisible {
            Button(role: .destructive) {
                completedSession = recorder.stopSession()
            } label: {
                Label("End Dive", systemImage: "stop.fill")
            }
            .buttonStyle(CompactDiveEndButtonStyle())
            .padding(.top, 2)
        }
    }

    private var recordingDisclaimer: some View {
        DiveDisclaimer(text: String(localized: "ASSISTANT ONLY. FOLLOW TRAINING AND A CERTIFIED DIVE COMPUTER."))
            .padding(.top, surfaceEndGate.isVisible ? 4 : 0)
    }

    private var recordingVerticalSpacing: CGFloat {
        surfaceEndGate.isVisible ? 8 : 6
    }

    private var recordingHorizontalPadding: CGFloat {
        4
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
                    safetyStop: recorder.scubaSafetyStop
                )
            } else {
                ScubaLiveInstrument(
                    currentDepthMeters: recorder.currentDepth,
                    elapsedTime: recorder.elapsedTime,
                    displayedMaxDepthMeters: recorder.maxDepth,
                    ascentRateMetersPerMinute: recorder.latestAscentRateMetersPerMinute,
                    waterTemperatureCelsius: recorder.waterTemperatureCelsius
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
                diveCount: snapshot.diveCount
            )
        case .diveActive:
            FreeDiveActiveInstrument(
                currentDepthMeters: recorder.currentDepth,
                activeDiveTime: snapshot.activeSegment?.durationSeconds ?? 0,
                maxDepthMeters: snapshot.maxDepthMeters,
                ascentRateMetersPerMinute: recorder.latestAscentRateMetersPerMinute
            )
        case .surfaceInterval:
            FreeSurfaceIntervalInstrument(
                currentDepthMeters: recorder.currentDepth,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount
            )
        case .summary:
            FreeDiveSummaryInstrument(
                currentDepthMeters: recorder.currentDepth,
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount
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

    private func updateSurfaceEndGate(at timestamp: Date = Date()) {
        surfaceEndGate.update(depthMeters: recorder.currentDepth, at: timestamp)
    }
}

private struct FreeSurfaceReadyInstrument: View {
    let currentDepthMeters: Double
    let sessionTime: TimeInterval
    let maxDepthMeters: Double
    let diveCount: Int

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil
        ) {
            StatusPill(title: String(localized: "Surface ready"), color: DiveWatchTheme.secondary)

            Spacer(minLength: 2)

            Text(DiveFormatters.duration(sessionTime))
                .font(DiveWatchTheme.metricFont(size: 44, weight: .semibold))
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

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil
        ) {
            StatusPill(title: String(localized: "Dive active"), color: DiveWatchTheme.primary)

            Text(DiveFormatters.depth(currentDepthMeters))
                .font(DiveWatchTheme.metricFont(size: 38, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.38)

            Text(DiveFormatters.duration(activeDiveTime))
                .font(DiveWatchTheme.metricFont(size: 23, weight: .semibold))
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
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            DepthGaugeRail(
                depthMeters: currentDepthMeters,
                maxScaleMeters: maxScaleMeters,
                stopZone: stopZone,
                targetDepthMeters: targetDepthMeters
            )

            VStack(alignment: .leading, spacing: 8) {
                content
            }
            .padding(.top, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct FreeSurfaceIntervalInstrument: View {
    let currentDepthMeters: Double
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
    let maxDepthMeters: Double
    let diveCount: Int

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil
        ) {
            StatusPill(title: String(localized: "Surface interval"), color: DiveWatchTheme.secondary)

            Text(DiveFormatters.duration(surfaceRestTime))
                .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
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

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil
        ) {
            StatusPill(title: String(localized: "Summary"), color: DiveWatchTheme.secondary)

            Text(DiveFormatters.duration(surfaceRestTime))
                .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
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

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: nil,
            targetDepthMeters: nil
        ) {
            Text(DiveFormatters.depth(currentDepthMeters))
                .font(DiveWatchTheme.metricFont(size: 40, weight: .semibold))
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

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
            targetDepthMeters: safetyStop.targetDepthMeters
        ) {
            warningBand

            StatusPill(title: String(localized: "Safety stop"), color: statusColor)

            Text(DiveFormatters.duration(safetyStop.remainingSeconds))
                .font(DiveWatchTheme.metricFont(size: 38, weight: .semibold))
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
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }

            Text(value)
                .font(DiveWatchTheme.metricFont(size: 15, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.48)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactDiveEndButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .foregroundStyle(DiveWatchTheme.danger)
            .padding(.horizontal, 18)
            .frame(minWidth: 118, minHeight: 34)
            .background(
                Capsule()
                    .fill(DiveWatchTheme.danger.opacity(configuration.isPressed ? 0.28 : 0.18))
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
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
