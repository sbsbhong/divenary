import SwiftUI

struct HomeView: View {
    @ObservedObject var store: DiveSessionStore
    @ObservedObject var water: WaterSubmersionCoordinator
    @ObservedObject var realRecorder: DiveSessionRecorder
    @ObservedObject var realCoordinator: RealDiveSessionCoordinator
    let actionButtonBridge: DiveActionButtonBridge
    let actionButtonDonor: DiveActionButtonDonating
    @StateObject private var autoLaunchAuthorization = DepthAutoLaunchAuthorization()
    @State private var plan = PreDivePlan()
    @State private var sensorAvailability = DepthSensorAvailability.launchPlaceholder

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if sensorAvailability.readiness != .ready {
                        HomeSensorError(
                            sensorReadiness: sensorAvailability.readiness,
                            autoLaunchStatus: autoLaunchAuthorization.statusText
                        )
                    }

                    Button {
                        startRealDive(mode: .freedive)
                    } label: {
                        StartSessionCard(
                            title: "Freediving",
                            systemImage: "figure.pool.swim",
                            accent: DiveWatchTheme.primary,
                            trailingSystemImage: "play.fill"
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(!sensorAvailability.canStartRealDive)

                    Button {
                        startRealDive(mode: .scuba)
                    } label: {
                        StartSessionCard(
                            title: "Scuba Diving",
                            systemImage: "drop.fill",
                            accent: DiveWatchTheme.secondary,
                            trailingSystemImage: "play.fill"
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(!sensorAvailability.canStartRealDive)

                    if !store.plannedDives.isEmpty {
                        PlannedDivesSection(
                            plannedDives: store.plannedDives,
                            selectedPlanLocalId: plan.sourcePlanLocalId,
                            isSelectionEnabled: sensorAvailability.canSelectPlannedDives,
                            onSelect: apply(plannedDive:)
                        )
                    }

                    NavigationLink {
                        SimulatedRecordingFlowView(
                            store: store,
                            plan: explicitStartPlan(for: .scuba),
                            recordingMode: .demo,
                            actionButtonBridge: actionButtonBridge,
                            actionButtonDonor: actionButtonDonor
                        )
                    } label: {
                        StartSessionCard(
                            title: "Demo",
                            systemImage: "digitalcrown.arrow.clockwise",
                            accent: DiveWatchTheme.secondary,
                            trailingSystemImage: "play.fill"
                        )
                    }
                    .buttonStyle(.plain)

                    #if DEBUG
                    if showsDebugControls {
                        NavigationLink {
                            SimulatedRecordingFlowView(
                                store: store,
                                plan: explicitStartPlan(for: .freedive),
                                recordingMode: .debugTest,
                                actionButtonBridge: actionButtonBridge,
                                actionButtonDonor: actionButtonDonor
                            )
                        } label: {
                            StartSessionCard(
                                title: "Test Freedive",
                                subtitle: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise",
                                accent: DiveWatchTheme.primary,
                                trailingSystemImage: "chevron.right"
                            )
                        }
                        .buttonStyle(.plain)

                        NavigationLink {
                            SimulatedRecordingFlowView(
                                store: store,
                                plan: explicitStartPlan(for: .scuba),
                                recordingMode: .debugTest,
                                actionButtonBridge: actionButtonBridge,
                                actionButtonDonor: actionButtonDonor
                            )
                        } label: {
                            StartSessionCard(
                                title: "Test Scuba",
                                subtitle: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise",
                                accent: DiveWatchTheme.secondary,
                                trailingSystemImage: "chevron.right"
                            )
                        }
                        .buttonStyle(.plain)

                        Button {
                            store.save(DiveSessionRecord.largeDebugFixture(sampleCount: 8_000))
                        } label: {
                            Label("Test Large Sync", systemImage: "arrow.up.doc")
                        }
                        .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                    }
                    #endif

                    if let latestSession = store.sessions.first {
                        LatestSessionCard(session: latestSession)
                    }

                    NavigationLink {
                        SessionListView(store: store)
                    } label: {
                        Label("Saved Sessions", systemImage: "list.bullet")
                    }
                    .buttonStyle(DiveActionButtonStyle(kind: .secondary))

                    HomeSafetyFooter()
                }
                .padding(.horizontal, DiveWatchTheme.edgeMargin)
                .padding(.vertical, 10)
            }
            .refreshable {
                await store.refreshFromCompanion()
            }
            .background(DiveWatchTheme.background.ignoresSafeArea())
            .navigationTitle("Dive")
            .navigationDestination(isPresented: realRecordingFlowIsPresented) {
                RealRecordingFlowView(
                    water: water,
                    recorder: realRecorder,
                    coordinator: realCoordinator
                )
            }
            .onAppear {
                applyPreferredDiveMode()
                loadInitialSensorAvailability()
                autoLaunchAuthorization.refresh()
                realCoordinator.receiveWaterState(water.latestState)
            }
            .onChange(of: water.latestState) { _, nextState in
                realCoordinator.receiveWaterState(nextState)
            }
        }
    }

    private var showsDebugControls: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["DIVE_WATCH_DEBUG_CONTROLS"] == "1"
        #else
        false
        #endif
    }

    private var realRecordingFlowIsPresented: Binding<Bool> {
        Binding(
            get: { realCoordinator.phase.presentsRecordingFlow },
            set: { _ in }
        )
    }

    private func explicitStartPlan(for diveMode: DiveMode) -> PreDivePlan {
        var next = plan
        let preservesSelectedPlan = plan.sourcePlanLocalId == nil || plan.diveMode == diveMode
        next.diveMode = diveMode
        if diveMode == .scuba {
            next.gasLabel = next.gasLabel.isEmpty ? "Air" : next.gasLabel
        }
        if !preservesSelectedPlan {
            next.sourcePlanLocalId = nil
            next.title = ""
            next.userTags = next.userTags.filter { !$0.hasPrefix("plan-") }
        }
        return next
    }

    private func applyPreferredDiveMode() {
        plan.diveMode = store.preferredDiveMode
    }

    private func loadInitialSensorAvailability() {
        Task { @MainActor in
            await Task.yield()
            sensorAvailability = DepthSensorAvailability.current
        }
    }

    private func startRealDive(mode diveMode: DiveMode) {
        let startPlan = explicitStartPlan(for: diveMode)
        plan = startPlan
        store.updatePreferredDiveMode(diveMode)
        realCoordinator.startManual(plan: startPlan)
    }

    private func apply(plannedDive: WatchPlannedDive) {
        plan = plannedDive.preDivePlan
        store.updatePreferredDiveMode(plan.diveMode)
    }
}

private struct PlannedDivesSection: View {
    let plannedDives: [WatchPlannedDive]
    let selectedPlanLocalId: String?
    let isSelectionEnabled: Bool
    let onSelect: (WatchPlannedDive) -> Void

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 8) {
                Text("UNEXECUTED PLANS")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.primary)

                ForEach(plannedDives) { plannedDive in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(plannedDive.displayTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(2)
                            .minimumScaleFactor(0.72)

                        HStack(spacing: 8) {
                            PlannedDiveMetric(title: String(localized: "Mode"), value: (plannedDive.diveMode ?? .scuba).label)
                            PlannedDiveMetric(title: String(localized: "Max"), value: DiveFormatters.depth(plannedDive.plannedMaxDepthMeters ?? 0))
                        }

                        if let plannedAt = plannedDive.plannedAt {
                            Text(DiveFormatters.sessionDate.string(from: Date(timeIntervalSince1970: plannedAt)))
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(DiveWatchTheme.mutedText)
                                .lineLimit(1)
                        }

                        Button {
                            guard isSelectionEnabled else {
                                return
                            }
                            onSelect(plannedDive)
                        } label: {
                            Label(
                                selectedPlanLocalId == plannedDive.localId ? String(localized: "Selected Plan") : String(localized: "Use Plan"),
                                systemImage: selectedPlanLocalId == plannedDive.localId ? "checkmark.circle.fill" : "checkmark.circle"
                            )
                        }
                        .buttonStyle(DiveActionButtonStyle(kind: selectedPlanLocalId == plannedDive.localId ? .primary : .secondary))
                        .disabled(!isSelectionEnabled)
                    }

                    if plannedDive.id != plannedDives.last?.id {
                        Divider().opacity(0.35)
                    }
                }
            }
        }
        .opacity(isSelectionEnabled ? 1 : 0.48)
    }
}

private struct PlannedDiveMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
            Text(value)
                .font(DiveWatchTheme.metricFont(size: 14, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.58)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct HomeSensorError: View {
    let sensorReadiness: DepthSensorReadiness
    let autoLaunchStatus: String

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.danger) {
            VStack(alignment: .leading, spacing: 6) {
                StatusPill(
                    title: sensorReadiness.statusTitle,
                    color: DiveWatchTheme.danger
                )

                Text(autoLaunchStatus)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.68)
            }
        }
    }
}

private struct HomeSafetyFooter: View {
    var body: some View {
        Text(String(localized: "Recreational capture and review. Not a certified dive computer."))
            .font(.system(size: 8, weight: .medium))
            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.72))
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: .infinity)
            .padding(.top, 2)
            .padding(.horizontal, 8)
    }
}

private extension DepthSensorReadiness {
    var statusTitle: String {
        switch self {
        case .ready:
            return ""
        case .simulatorRequiresRealWatch:
            return String(localized: "Real Watch required")
        case .unsupportedDevice:
            return String(localized: "Ultra required")
        }
    }
}

private struct StartSessionCard: View {
    static let minimumHeight: CGFloat = 64

    let title: LocalizedStringKey
    var subtitle: String?
    var footnote: String?
    let systemImage: String
    let accent: Color
    let trailingSystemImage: String

    var body: some View {
        InstrumentCard(accent: accent) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)

                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.mutedText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }

                    if let footnote {
                        Text(footnote)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.82))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                    }
                }

                Spacer(minLength: 4)

                Image(systemName: trailingSystemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
            }
            .frame(minHeight: Self.minimumHeight)
        }
    }
}

private struct LatestSessionCard: View {
    let session: DiveSessionRecord

    private var summary: DiveSessionSummary {
        session.summary
    }

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("LAST DIVE")
                            .font(DiveWatchTheme.labelFont())
                            .foregroundStyle(DiveWatchTheme.mutedText)
                        Text(DiveFormatters.sessionDate.string(from: session.startedAt))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                    }

                    Spacer(minLength: 6)

                    StatusPill(title: session.syncStatus.label, color: DiveWatchTheme.secondary)
                }

                HStack(spacing: 8) {
                    LatestMetric(title: String(localized: "Max"), value: DiveFormatters.depth(summary.maxDepthMeters))
                    LatestMetric(title: String(localized: "Time"), value: DiveFormatters.duration(summary.durationSeconds))
                }
            }
        }
    }
}

private struct LatestMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
            Text(value)
                .font(DiveWatchTheme.metricFont(size: 17, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }
}
