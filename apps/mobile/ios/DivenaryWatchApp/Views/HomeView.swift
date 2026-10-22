import SwiftUI

struct HomeView: View {
    @ObservedObject var store: DiveSessionStore
    // Home only forwards these and reacts to submersion changes, so it does not observe them:
    // depth samples arrive every second and would rebuild this screen under the recording view.
    let water: WaterSubmersionCoordinator
    let realRecorder: DiveSessionRecorder
    @ObservedObject var realCoordinator: RealDiveSessionCoordinator
    let actionButtonBridge: DiveActionButtonBridge
    let actionButtonDonor: DiveActionButtonDonating
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var autoLaunchAuthorization = DepthAutoLaunchAuthorization()
    @State private var plan = PreDivePlan()
    /// `nil` while the first sensor check runs. The real start cards stay disabled until then, with
    /// no placeholder and no error card, because the check takes about one frame.
    @State private var sensorAvailability: DepthSensorAvailability?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let sensorAvailability, sensorAvailability.readiness != .ready {
                        HomeSensorNotice(sensorReadiness: sensorAvailability.readiness)
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
                    .buttonStyle(DivePressStyle())
                    .disabled(!canStartRealDive)

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
                    .buttonStyle(DivePressStyle())
                    .disabled(!canStartRealDive)

                    if !store.plannedDives.isEmpty {
                        NavigationLink {
                            DivePlansView(
                                plannedDives: store.plannedDives,
                                selectedPlanLocalId: plan.sourcePlanLocalId,
                                isSelectionEnabled: sensorAvailability?.canSelectPlannedDives ?? false,
                                onSelect: apply(plannedDive:),
                                onClearSelection: clearPlannedDive
                            )
                        } label: {
                            StartSessionCard(
                                title: "Dive Plans",
                                subtitle: selectedPlanSubtitle,
                                systemImage: "list.bullet.clipboard",
                                accent: DiveWatchTheme.primary,
                                trailingSystemImage: "chevron.right"
                            )
                        }
                        .buttonStyle(DivePressStyle())
                    }

                    if let latestSession = store.sessions.first {
                        LatestSessionCard(session: latestSession)
                    }

                    NavigationLink {
                        SessionListView(store: store)
                    } label: {
                        HomeRow(title: "Saved Sessions", systemImage: "list.bullet")
                    }
                    .buttonStyle(DivePressStyle())

                    NavigationLink {
                        UnderwaterControlsView(
                            autoLaunchStatus: autoLaunchAuthorization.status,
                            hasActionButton: ActionButtonHint.current.isLikelyUltra
                        )
                    } label: {
                        HomeRow(
                            title: "Underwater controls",
                            detail: autoLaunchAuthorization.statusText,
                            systemImage: "hand.tap"
                        )
                    }
                    .buttonStyle(DivePressStyle())

                    // A secondary row, so a demo log is never mistaken for a real start.
                    NavigationLink {
                        DeferredView {
                            SimulatedRecordingFlowView(
                                store: store,
                                plan: explicitStartPlan(for: .scuba).withoutPlannedDiveLink,
                                recordingMode: .demo,
                                actionButtonBridge: actionButtonBridge,
                                actionButtonDonor: actionButtonDonor
                            )
                        }
                    } label: {
                        HomeRow(
                            title: "Demo",
                            detail: String(localized: "Simulated depth"),
                            systemImage: "digitalcrown.arrow.clockwise"
                        )
                    }
                    .buttonStyle(DivePressStyle())

                    #if DEBUG
                    if showsDebugControls {
                        NavigationLink {
                            DeferredView {
                                SimulatedRecordingFlowView(
                                    store: store,
                                    plan: explicitStartPlan(for: .freedive).withoutPlannedDiveLink,
                                    recordingMode: .debugTest,
                                    actionButtonBridge: actionButtonBridge,
                                    actionButtonDonor: actionButtonDonor
                                )
                            }
                        } label: {
                            HomeRow(
                                title: "Test Freedive",
                                detail: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise"
                            )
                        }
                        .buttonStyle(DivePressStyle())

                        NavigationLink {
                            DeferredView {
                                SimulatedRecordingFlowView(
                                    store: store,
                                    plan: explicitStartPlan(for: .scuba).withoutPlannedDiveLink,
                                    recordingMode: .debugTest,
                                    actionButtonBridge: actionButtonBridge,
                                    actionButtonDonor: actionButtonDonor
                                )
                            }
                        } label: {
                            HomeRow(
                                title: "Test Scuba",
                                detail: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise"
                            )
                        }
                        .buttonStyle(DivePressStyle())

                        Button {
                            store.save(DiveSessionRecord.largeDebugFixture(sampleCount: 8_000))
                        } label: {
                            Label("Test Large Sync", systemImage: "arrow.up.doc")
                        }
                        .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                    }
                    #endif

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
                    coordinator: realCoordinator,
                    autoLaunchStatus: autoLaunchAuthorization.status
                )
            }
            .onAppear {
                applyPreferredDiveMode()
                loadInitialSensorAvailability()
                autoLaunchAuthorization.refresh()
                realCoordinator.receiveWaterState(water.latestState)
            }
            .onReceive(water.$latestState.removeDuplicates().dropFirst()) { nextState in
                realCoordinator.receiveWaterState(nextState)
            }
            .onChange(of: scenePhase) { _, nextPhase in
                if nextPhase == .active {
                    store.resumePendingDeletionsIfNeeded()
                }
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

    private var canStartRealDive: Bool {
        sensorAvailability?.canStartRealDive ?? false
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
        return preservesSelectedPlan ? next : next.withoutPlannedDiveLink
    }

    private func applyPreferredDiveMode() {
        plan.diveMode = store.preferredDiveMode
    }

    /// Runs after the first frame so launch does not wait on Core Motion.
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

    private func clearPlannedDive() {
        plan = PreDivePlan(diveMode: store.preferredDiveMode)
    }

    private var selectedPlanSubtitle: String {
        guard let selectedPlanLocalId = plan.sourcePlanLocalId else {
            return String(localized: "None selected")
        }
        return store.plannedDives.first { $0.localId == selectedPlanLocalId }?.displayTitle
            ?? String(localized: "Planned dive")
    }
}

struct DivePlansView: View {
    let plannedDives: [WatchPlannedDive]
    let selectedPlanLocalId: String?
    let isSelectionEnabled: Bool
    let onSelect: (WatchPlannedDive) -> Void
    let onClearSelection: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(plannedDives) { plannedDive in
                    let isSelected = selectedPlanLocalId == plannedDive.localId
                    Button {
                        if isSelected {
                            onClearSelection()
                        } else {
                            onSelect(plannedDive)
                        }
                        dismiss()
                    } label: {
                        PlannedDiveRow(plannedDive: plannedDive, isSelected: isSelected)
                    }
                    .buttonStyle(DivePressStyle())
                    .disabled(!isSelectionEnabled)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }

                Text(isSelectionEnabled
                    ? String(localized: "Tap a plan to use it for the next dive. Tap it again to clear.")
                    : String(localized: "Plans start real dives on a supported Apple Watch."))
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Dive Plans")
    }
}

private struct PlannedDiveRow: View {
    let plannedDive: WatchPlannedDive
    let isSelected: Bool

    var body: some View {
        InstrumentCard(accent: isSelected ? DiveWatchTheme.primary : nil) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(plannedDive.displayTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                    Spacer(minLength: 4)
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(DiveWatchTheme.primary)
                            .accessibilityHidden(true)
                    }
                }

                HStack(spacing: 8) {
                    PlannedDiveMetric(title: String(localized: "Mode"), value: (plannedDive.diveMode ?? .scuba).label)
                    PlannedDiveMetric(title: String(localized: "Max"), value: DiveFormatters.depth(plannedDive.plannedMaxDepthMeters))
                }

                if let plannedAt = plannedDive.plannedAt {
                    Text(DiveFormatters.sessionDate.string(from: Date(timeIntervalSince1970: plannedAt)))
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .combine)
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

/// Shown after the sensor check on a watch that cannot record real dives. It is a quiet notice,
/// not an alarm: nothing is wrong, and the demo still works.
private struct HomeSensorNotice: View {
    let sensorReadiness: DepthSensorReadiness

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(sensorReadiness.statusTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)

                Text(String(localized: "Real dives need a depth sensor. The demo still works."))
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(3)
                    .minimumScaleFactor(0.75)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct HomeSafetyFooter: View {
    var body: some View {
        Text(String(localized: "Recreational capture and review. Not a certified dive computer."))
            .font(.system(size: 8, weight: .regular))
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
            return String(localized: "Depth-capable Apple Watch required")
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
                            .font(.system(size: 10, weight: .regular))
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

/// A compact secondary row: saved sessions, the underwater controls guide and the demo. It stays
/// quieter than the real start cards above it.
private struct HomeRow: View {
    let title: LocalizedStringKey
    var detail: String?
    let systemImage: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                if let detail {
                    Text(detail)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }

            Spacer(minLength: 4)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                .fill(DiveWatchTheme.surfaceContainer)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct LatestSessionCard: View {
    let session: DiveSessionRecord
    /// The summary replays the depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary

    init(session: DiveSessionRecord) {
        self.session = session
        summary = session.summary
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

/// Builds its content only when shown. A `NavigationLink` destination is otherwise created on
/// every render of the list, and the demo flow creates its own recorder and storage when made.
private struct DeferredView<Content: View>: View {
    let content: () -> Content

    var body: some View {
        content()
    }
}
