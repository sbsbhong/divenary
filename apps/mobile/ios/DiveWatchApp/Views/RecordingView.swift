import SwiftUI

enum WatchRecordingMode: Equatable {
    case real
    case demo

    var captureMode: DiveCaptureMode {
        switch self {
        case .real:
            return .real
        case .demo:
            return .demo
        }
    }

    func sensorProvider() -> DepthSensorProvider {
        switch self {
        case .real:
            return RealDepthSensorProvider()
        case .demo:
            return DemoDepthSensorProvider()
        }
    }
}

struct RecordingView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    let recordingMode: WatchRecordingMode
    @StateObject private var recorder: DiveSessionRecorder
    @State private var completedSession: DiveSessionRecord?
    @Environment(\.dismiss) private var dismiss

    init(store: DiveSessionStore, plan: PreDivePlan, recordingMode: WatchRecordingMode = .real) {
        self.store = store
        self.plan = plan
        self.recordingMode = recordingMode
        _recorder = StateObject(
            wrappedValue: DiveSessionRecorder(
                sensorProvider: recordingMode.sensorProvider(),
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
                recordingContent
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
    }

    private var recordingContent: some View {
        VStack(spacing: 5) {
            if recordingMode == .demo {
                HStack {
                    StatusPill(title: String(localized: "Demo"), color: DiveWatchTheme.secondary)
                    Spacer(minLength: 0)
                }
            }

            liveInstrument
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .padding(.top, 16)
                .layoutPriority(1)

            Button(role: .destructive) {
                completedSession = recorder.stopSession()
            } label: {
                Label("End Dive", systemImage: "stop.fill")
            }
            .buttonStyle(CompactDiveEndButtonStyle())

            DiveDisclaimer(text: String(localized: "ASSISTANT ONLY. FOLLOW TRAINING AND A CERTIFIED DIVE COMPUTER."))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .background(DiveWatchTheme.background.ignoresSafeArea())
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
                sessionTime: recorder.elapsedTime,
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
                surfaceRestTime: surfaceRestTime(for: snapshot),
                lastSegment: snapshot.segments.last,
                maxDepthMeters: snapshot.maxDepthMeters,
                diveCount: snapshot.diveCount
            )
        case .summary:
            FreeSurfaceIntervalInstrument(
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
        case .active, .pausedTooDeep, .pausedTooShallow, .completed:
            return true
        case .armed, .unknown, .notRequired, .skippedOrIncomplete:
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

private struct FreeSurfaceReadyInstrument: View {
    let sessionTime: TimeInterval
    let diveCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct FreeDiveActiveInstrument: View {
    let currentDepthMeters: Double
    let activeDiveTime: TimeInterval
    let maxDepthMeters: Double
    let ascentRateMetersPerMinute: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StatusPill(title: String(localized: "Dive active"), color: DiveWatchTheme.primary)

            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(DiveFormatters.depth(currentDepthMeters))
                        .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.38)

                    Text(DiveFormatters.duration(activeDiveTime))
                        .font(DiveWatchTheme.metricFont(size: 25, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                DepthGaugeRail(
                    depthMeters: currentDepthMeters,
                    maxScaleMeters: maxScaleMeters,
                    stopZone: nil,
                    targetDepthMeters: nil
                )
            }

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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)
    }
}

private struct FreeSurfaceIntervalInstrument: View {
    let surfaceRestTime: TimeInterval
    let lastSegment: FreeDiveSegment?
    let maxDepthMeters: Double
    let diveCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct ScubaLiveInstrument: View {
    let currentDepthMeters: Double
    let elapsedTime: TimeInterval
    let displayedMaxDepthMeters: Double
    let ascentRateMetersPerMinute: Double
    let waterTemperatureCelsius: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(DiveFormatters.depth(currentDepthMeters))
                        .font(DiveWatchTheme.metricFont(size: 43, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.38)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                DepthGaugeRail(
                    depthMeters: currentDepthMeters,
                    maxScaleMeters: maxScaleMeters,
                    stopZone: nil,
                    targetDepthMeters: nil
                )
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(title: String(localized: "Time"), value: DiveFormatters.duration(elapsedTime))
                LiveInstrumentMetric(title: String(localized: "Max"), value: DiveFormatters.depth(displayedMaxDepthMeters))
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(title: String(localized: "Ascent"), value: DiveFormatters.ascentRate(ascentRateMetersPerMinute))
                LiveInstrumentMetric(title: String(localized: "Temp"), value: DiveFormatters.temperature(waterTemperatureCelsius))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters, displayedMaxDepthMeters) / 10) * 10)
    }
}

private struct SafetyStopInstrument: View {
    let currentDepthMeters: Double
    let safetyStop: SafetyStopRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            warningBand

            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 8) {
                    StatusPill(title: String(localized: "Safety stop"), color: statusColor)

                    Text(DiveFormatters.duration(safetyStop.remainingSeconds))
                        .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
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
                .frame(maxWidth: .infinity, alignment: .leading)

                DepthGaugeRail(
                    depthMeters: currentDepthMeters,
                    maxScaleMeters: maxScaleMeters,
                    stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
                    targetDepthMeters: safetyStop.targetDepthMeters
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
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
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                .fill(DiveWatchTheme.surfaceContainer)
        )
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
        sessionTime: 0,
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
