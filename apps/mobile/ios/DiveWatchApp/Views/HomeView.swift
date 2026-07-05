import SwiftUI

struct HomeView: View {
    @ObservedObject var store: DiveSessionStore
    @StateObject private var autoStartMonitor = DiveAutoStartMonitor(sensorProvider: RealDepthSensorProvider())
    @State private var plan = PreDivePlan()
    @State private var automaticDiveStartRequest: AutomaticDiveStartRequest?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HomeHeader(sessionCount: store.sessions.count)

                    NavigationLink {
                        RecordingView(store: store, plan: explicitStartPlan(for: .freedive))
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

                    NavigationLink {
                        RecordingView(store: store, plan: explicitStartPlan(for: .scuba))
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

                    NavigationLink {
                        DivePlanSetupView(store: store, plan: $plan)
                    } label: {
                        PlanSummaryCard(plan: plan)
                    }
                    .buttonStyle(.plain)

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
            .navigationTitle("Dive Watch")
            .navigationDestination(item: $automaticDiveStartRequest) { request in
                RecordingView(store: store, plan: request.plan)
            }
            .onAppear {
                applyPreferredDiveMode()
                autoStartMonitor.onAutoStart = {
                    startAutomaticDive()
                }
                autoStartMonitor.startMonitoring()
            }
            .onDisappear {
                autoStartMonitor.stopMonitoring()
            }
        }
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

    private func selectStartMode(_ diveMode: DiveMode) {
        plan.diveMode = diveMode
        store.updatePreferredDiveMode(diveMode)
    }

    private func startAutomaticDive() {
        store.updatePreferredDiveMode(plan.diveMode)
        automaticDiveStartRequest = AutomaticDiveStartRequest(plan: plan)
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

private struct DivePlanSetupView: View {
    @ObservedObject var store: DiveSessionStore
    @Binding var plan: PreDivePlan

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                InstrumentCard(accent: DiveWatchTheme.secondary) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("DIVE PLAN")
                            .font(DiveWatchTheme.labelFont())
                            .foregroundStyle(DiveWatchTheme.secondary)
                        Text(plan.siteName.isEmpty ? String(localized: "Set the plan, then start.") : plan.siteName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .lineLimit(2)
                            .minimumScaleFactor(0.68)
                    }
                }

                if !store.plannedDives.isEmpty {
                    PlannedDivesSection(
                        plannedDives: store.plannedDives,
                        selectedPlanLocalId: plan.sourcePlanLocalId,
                        onSelect: apply(plannedDive:)
                    )
                }

                PreDivePlanFields(
                    plan: $plan,
                    onDiveModeChanged: { nextMode in
                        store.updatePreferredDiveMode(nextMode)
                    }
                )

                NavigationLink {
                    RecordingView(store: store, plan: plan)
                } label: {
                    Label("Start Planned Dive", systemImage: "play.fill")
                }
                .buttonStyle(DiveActionButtonStyle(kind: .primary))

                DiveDisclaimer()
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .refreshable {
            await store.refreshFromCompanion()
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Dive Plan")
    }

    private func apply(plannedDive: WatchPlannedDive) {
        plan = plannedDive.preDivePlan
        store.updatePreferredDiveMode(plan.diveMode)
    }
}

@MainActor
private final class DiveAutoStartMonitor: ObservableObject {
    @Published private(set) var latestDepthMeters: Double = 0

    var onAutoStart: (() -> Void)?

    private let sensorProvider: DepthSensorProvider
    private let activationDepthMeters: Double
    private var isMonitoring = false
    private var didTrigger = false

    init(sensorProvider: DepthSensorProvider, activationDepthMeters: Double = 3) {
        self.sensorProvider = sensorProvider
        self.activationDepthMeters = activationDepthMeters
    }

    func startMonitoring() {
        guard !isMonitoring else {
            return
        }

        isMonitoring = true
        didTrigger = false
        sensorProvider.onSample = { [weak self] sample in
            Task { @MainActor in
                self?.handle(sample)
            }
        }
        sensorProvider.start()
    }

    func stopMonitoring() {
        guard isMonitoring else {
            return
        }

        sensorProvider.stop()
        sensorProvider.onSample = nil
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
                            onSelect(plannedDive)
                        } label: {
                            Label(
                                selectedPlanLocalId == plannedDive.localId ? String(localized: "Selected Plan") : String(localized: "Use Plan"),
                                systemImage: selectedPlanLocalId == plannedDive.localId ? "checkmark.circle.fill" : "checkmark.circle"
                            )
                        }
                        .buttonStyle(DiveActionButtonStyle(kind: selectedPlanLocalId == plannedDive.localId ? .primary : .secondary))
                    }

                    if plannedDive.id != plannedDives.last?.id {
                        Divider().opacity(0.35)
                    }
                }
            }
        }
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

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.primary) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center) {
                    StatusPill(title: String(localized: "Watch assistant"))
                    Spacer(minLength: 6)
                    Text("\(sessionCount)")
                        .font(DiveWatchTheme.metricFont(size: 18, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .monospacedDigit()
                    Text("logs")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                }

                Text("Dive Watch")
                    .font(DiveWatchTheme.metricFont(size: 25, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                Text("Supplemental log · no safety calculation")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)

                Text("Does not replace a certified dive computer.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
            }
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

private struct PlanSummaryCard: View {
    let plan: PreDivePlan

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Label("Dive Plan", systemImage: "list.clipboard")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)

                    Spacer(minLength: 4)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                }

                Text(plan.siteName.isEmpty ? String(localized: "Set the plan, then start.") : plan.siteName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)

                HStack(spacing: 8) {
                    PlannedDiveMetric(title: String(localized: "Mode"), value: plan.diveMode.label)
                    PlannedDiveMetric(title: String(localized: "Max"), value: DiveFormatters.depth(plan.plannedMaxDepthMeters))
                }
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

private struct PreDivePlanFields: View {
    @Binding var plan: PreDivePlan
    let onDiveModeChanged: (DiveMode) -> Void

    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.secondary) {
            VStack(alignment: .leading, spacing: 8) {
                Text("PLAN DETAILS")
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.secondary)

                Picker("Mode", selection: diveModeSelection) {
                    ForEach(DiveMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .labelsHidden()
                .frame(height: 58)

                if plan.diveMode == .scuba {
                    DiveTextField(title: String(localized: "Gas label"), text: $plan.gasLabel)
                }
                DiveTextField(title: String(localized: "Site"), text: $plan.siteName)
                DiveTextField(title: String(localized: "Buddy"), text: $plan.buddyName)
                DiveTextField(title: String(localized: "Quick note"), text: $plan.quickNote)

                Stepper(value: $plan.plannedMaxDepthMeters, in: 3...40, step: 1) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("PLANNED MAX")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.mutedText)
                        Text("\(Int(plan.plannedMaxDepthMeters)) m")
                            .font(DiveWatchTheme.metricFont(size: 16, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.text)
                            .monospacedDigit()
                    }
                }
            }
        }
    }

    private var diveModeSelection: Binding<DiveMode> {
        Binding(
            get: { plan.diveMode },
            set: { nextMode in
                plan.diveMode = nextMode
                onDiveModeChanged(nextMode)
            }
        )
    }
}

private struct DiveTextField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        TextField(title, text: $text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(DiveWatchTheme.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                    .fill(DiveWatchTheme.surfaceRaised.opacity(0.72))
            )
    }
}
