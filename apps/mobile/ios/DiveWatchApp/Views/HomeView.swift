import SwiftUI

struct HomeView: View {
    @ObservedObject var store: DiveSessionStore
    @StateObject private var autoStartMonitor = DiveAutoStartMonitor()
    @StateObject private var autoLaunchAuthorization = DepthAutoLaunchAuthorization()
    @State private var plan = PreDivePlan()
    @State private var sensorAvailability = DepthSensorAvailability.launchPlaceholder
    @State private var automaticDiveStartRequest: AutomaticDiveStartRequest?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HomeHeader(
                        sessionCount: store.sessions.count,
                        sensorReadiness: sensorAvailability.readiness,
                        autoLaunchStatus: autoLaunchAuthorization.statusText
                    )

                    NavigationLink {
                        RecordingView(store: store, plan: explicitStartPlan(for: .freedive), recordingMode: .real)
                            .onAppear {
                                selectStartMode(.freedive)
                            }
                    } label: {
                        StartSessionCard(
                            title: "Free Session Start",
                            subtitle: String(localized: "Supplemental log · no safety calculation"),
                            systemImage: "figure.pool.swim",
                            accent: DiveWatchTheme.primary
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(!sensorAvailability.canStartRealDive)

                    NavigationLink {
                        RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .real)
                            .onAppear {
                                selectStartMode(.scuba)
                            }
                    } label: {
                        StartSessionCard(
                            title: "Scuba Start",
                            subtitle: scubaStartSubtitle,
                            footnote: String(localized: "Recommended safety stop reminder."),
                            systemImage: "drop.fill",
                            accent: DiveWatchTheme.secondary
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
                        RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .demo)
                    } label: {
                        StartSessionCard(
                            title: "Demo",
                            subtitle: String(localized: "Crown-controlled sample dive"),
                            systemImage: "digitalcrown.arrow.clockwise",
                            accent: DiveWatchTheme.secondary
                        )
                    }
                    .buttonStyle(.plain)

                    if showsDebugControls {
                        NavigationLink {
                            RecordingView(store: store, plan: explicitStartPlan(for: .freedive), recordingMode: .debugTest)
                        } label: {
                            StartSessionCard(
                                title: "Test Freedive",
                                subtitle: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise",
                                accent: DiveWatchTheme.primary
                            )
                        }
                        .buttonStyle(.plain)

                        NavigationLink {
                            RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .debugTest)
                        } label: {
                            StartSessionCard(
                                title: "Test Scuba",
                                subtitle: String(localized: "Debug depth control"),
                                systemImage: "digitalcrown.arrow.clockwise",
                                accent: DiveWatchTheme.secondary
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    if let latestSession = store.sessions.first {
                        LatestSessionCard(session: latestSession)
                    }

                    NavigationLink {
                        SessionListView(store: store)
                    } label: {
                        Label("Saved Sessions", systemImage: "list.bullet")
                    }
                    .buttonStyle(DiveActionButtonStyle(kind: .secondary))

                    DiveDisclaimer()
                }
                .padding(.horizontal, DiveWatchTheme.edgeMargin)
                .padding(.vertical, 10)
            }
            .refreshable {
                await store.refreshFromCompanion()
            }
            .background(DiveWatchTheme.background.ignoresSafeArea())
            .navigationTitle("Dive")
            .navigationDestination(item: $automaticDiveStartRequest) { request in
                RecordingView(store: store, plan: request.plan, recordingMode: .real)
            }
            .onAppear {
                applyPreferredDiveMode()
                loadInitialSensorAvailability()
                autoLaunchAuthorization.refresh()
                autoStartMonitor.onAutoStart = {
                    startAutomaticDive()
                }
            }
            .onDisappear {
                autoStartMonitor.stopMonitoring()
            }
        }
    }

    private var showsDebugControls: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    private var scubaStartSubtitle: String {
        let gasLabel = explicitStartPlan(for: .scuba).gasLabel
        guard gasLabel != "Air" else {
            return String(localized: "Air · Stop 5m/3:00")
        }
        return "\(gasLabel) · \(String(localized: "Stop 5m/3:00"))"
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
            let availability = DepthSensorAvailability.current
            sensorAvailability = availability
            if availability.canStartRealDive {
                autoStartMonitor.startMonitoringIfAvailable(sensorProvider: RealDepthSensorProvider())
            } else {
                autoStartMonitor.stopMonitoring()
            }
        }
    }

    private func selectStartMode(_ diveMode: DiveMode) {
        plan.diveMode = diveMode
        store.updatePreferredDiveMode(diveMode)
    }

    private func startAutomaticDive() {
        store.updatePreferredDiveMode(plan.diveMode)
        automaticDiveStartRequest = AutomaticDiveStartRequest(plan: plan)
    }

    private func apply(plannedDive: WatchPlannedDive) {
        plan = plannedDive.preDivePlan
        store.updatePreferredDiveMode(plan.diveMode)
    }
}

private struct AutomaticDiveStartRequest: Identifiable, Hashable {
    let id = UUID()
    let plan: PreDivePlan

    static func == (lhs: AutomaticDiveStartRequest, rhs: AutomaticDiveStartRequest) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

@MainActor
private final class DiveAutoStartMonitor: ObservableObject {
    @Published private(set) var latestDepthMeters: Double = 0

    var onAutoStart: (() -> Void)?

    private var sensorProvider: DepthSensorProvider?
    private let activationDepthMeters: Double
    private var isMonitoring = false
    private var didTrigger = false

    init(activationDepthMeters: Double = 3) {
        self.activationDepthMeters = activationDepthMeters
    }

    func startMonitoringIfAvailable(sensorProvider nextSensorProvider: DepthSensorProvider) {
        guard !isMonitoring else {
            return
        }

        sensorProvider = nextSensorProvider
        isMonitoring = true
        didTrigger = false
        nextSensorProvider.onSample = { [weak self] sample in
            Task { @MainActor in
                self?.handle(sample)
            }
        }
        nextSensorProvider.start()
    }

    func stopMonitoring() {
        guard isMonitoring else {
            sensorProvider = nil
            return
        }

        sensorProvider?.stop()
        sensorProvider?.onSample = nil
        sensorProvider = nil
        isMonitoring = false
    }

    private func handle(_ sample: DepthSample) {
        latestDepthMeters = sample.depthMeters

        guard !didTrigger, sample.depthMeters >= activationDepthMeters else {
            return
        }

        didTrigger = true
        stopMonitoring()
        onAutoStart?()
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

private struct HomeHeader: View {
    let sessionCount: Int
    let sensorReadiness: DepthSensorReadiness
    let autoLaunchStatus: String

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    StatusPill(
                        title: sensorReadiness.statusTitle,
                        color: sensorReadiness == .ready ? DiveWatchTheme.secondary : DiveWatchTheme.danger
                    )
                    StatusPill(title: "\(sessionCount)", color: DiveWatchTheme.primary)
                }

                if sensorReadiness == .ready {
                    Text(autoLaunchStatus)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(2)
                        .minimumScaleFactor(0.68)
                }
            }
        }
    }
}

private extension DepthSensorReadiness {
    var statusTitle: String {
        switch self {
        case .ready:
            return String(localized: "Sensor ready")
        case .simulatorRequiresRealWatch:
            return String(localized: "Real Watch required")
        case .unsupportedDevice:
            return String(localized: "Ultra required")
        }
    }
}

private struct StartSessionCard: View {
    let title: LocalizedStringKey
    let subtitle: String
    var footnote: String?
    let systemImage: String
    let accent: Color

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

                    Text(subtitle)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)

                    if let footnote {
                        Text(footnote)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.82))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                    }
                }

                Spacer(minLength: 4)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
            }
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
