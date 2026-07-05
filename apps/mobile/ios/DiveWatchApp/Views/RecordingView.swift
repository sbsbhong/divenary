import SwiftUI

struct RecordingView: View {
    @ObservedObject var store: DiveSessionStore
    let plan: PreDivePlan
    @StateObject private var recorder = DiveSessionRecorder(sensorProvider: MockDepthSensorProvider())
    @State private var completedSession: DiveSessionRecord?
    @Environment(\.dismiss) private var dismiss

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
        VStack(spacing: 7) {
            liveInstrument
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .layoutPriority(1)

            Button(role: .destructive) {
                completedSession = recorder.stopSession()
            } label: {
                Label("End Dive", systemImage: "stop.fill")
            }
            .buttonStyle(DiveActionButtonStyle(kind: .destructive))

            DiveDisclaimer(text: String(localized: "ASSISTANT ONLY. FOLLOW TRAINING AND A CERTIFIED DIVE COMPUTER."))
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
        .padding(.vertical, 8)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Live Log")
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
                verticalRateMetersPerMinute: recorder.latestAscentRateMetersPerMinute
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
        case .unknown, .notRequired, .armed, .skippedOrIncomplete:
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

            Text(String(localized: "Session time"))
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.mutedText)

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

            Text(String(localized: "Freedive training reference only."))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct FreeDiveActiveInstrument: View {
    let currentDepthMeters: Double
    let activeDiveTime: TimeInterval
    let maxDepthMeters: Double
    let verticalRateMetersPerMinute: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StatusPill(title: String(localized: "Dive active"), color: DiveWatchTheme.primary)

            Text(DiveFormatters.depth(currentDepthMeters))
                .font(DiveWatchTheme.metricFont(size: 45, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.primary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.38)

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(DiveFormatters.duration(activeDiveTime))
                    .font(DiveWatchTheme.metricFont(size: 25, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)

                Text(String(localized: "Current dive"))
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }

            HStack(spacing: 7) {
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                )
                LiveInstrumentMetric(
                    title: String(localized: "Ascent/descent"),
                    value: DiveFormatters.verticalRate(verticalRateMetersPerMinute)
                )
            }

            Text(String(localized: "Freedive training reference only."))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
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

            Text(String(localized: "Surface rest"))
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.mutedText)

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

            Text(String(localized: "End to save session."))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
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
                    Text(String(localized: "CURRENT DEPTH"))
                        .font(DiveWatchTheme.labelFont())
                        .foregroundStyle(DiveWatchTheme.mutedText)

                    Text(DiveFormatters.depth(currentDepthMeters))
                        .font(DiveWatchTheme.metricFont(size: 43, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.38)

                    Text(String(localized: "Supplemental log · no safety calculation"))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
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
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                StatusPill(title: String(localized: "Safety stop"), color: statusColor)

                Text(DiveFormatters.duration(safetyStop.remainingSeconds))
                    .font(DiveWatchTheme.metricFont(size: 42, weight: .semibold))
                    .foregroundStyle(statusColor)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.45)

                Text(statusText)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.68)

                if isTimerPaused {
                    Text(String(localized: "Timer paused"))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }

                LiveInstrumentMetric(
                    title: String(localized: "Stop zone"),
                    value: "\(DiveFormatters.depth(safetyStop.minDepthMeters))-\(DiveFormatters.depth(safetyStop.maxDepthMeters))"
                )

                Text(String(localized: "Recommended safety stop reminder."))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            DepthGaugeRail(
                depthMeters: currentDepthMeters,
                maxScaleMeters: max(10, safetyStop.maxDepthMeters + 2),
                stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
                targetDepthMeters: safetyStop.targetDepthMeters
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private var statusText: String {
        switch safetyStop.status {
        case .active:
            return String(localized: "Within stop zone")
        case .pausedTooDeep:
            return String(localized: "Deeper than stop zone")
        case .pausedTooShallow:
            return String(localized: "Shallower than stop zone")
        case .completed:
            return String(localized: "Recommended stop complete")
        case .unknown:
            return String(localized: "Stop status unavailable")
        case .notRequired:
            return String(localized: "Stop not required")
        case .armed:
            return String(localized: "Stop reminder armed")
        case .skippedOrIncomplete:
            return String(localized: "Stop incomplete")
        }
    }

    private var isTimerPaused: Bool {
        safetyStop.status == .pausedTooDeep || safetyStop.status == .pausedTooShallow
    }

    private var statusColor: Color {
        safetyStop.status == .completed ? DiveWatchTheme.secondary : DiveWatchTheme.primary
    }
}

private struct LiveInstrumentMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.65)

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
