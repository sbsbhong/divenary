import SwiftUI

enum HomePlanSelection {
    static var instructions: String {
        String(localized: "Select a plan for starts from Home. Tap again to clear.")
    }

    static func validated(_ selection: PreDivePlan, plannedDives: [WatchPlannedDive]) -> PreDivePlan {
        guard let id = selection.sourcePlanLocalId else { return selection }
        return plannedDives.first { $0.localId == id }?.preDivePlan
            ?? PreDivePlan(diveMode: selection.diveMode)
    }

    static func startPlan(_ selection: PreDivePlan, mode: DiveMode, plannedDives: [WatchPlannedDive]) -> PreDivePlan {
        var next = validated(selection, plannedDives: plannedDives)
        if next.sourcePlanLocalId != nil, next.diveMode != mode {
            next = PreDivePlan(diveMode: mode)
        }
        next.diveMode = mode
        if mode == .scuba, next.gasLabel.isEmpty {
            next.gasLabel = String(localized: "Air")
        }
        return next
    }
}

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
    /// False until Home first appears in this launch. The cards and rows then rise into place once;
    /// coming back from another screen does not replay it (spec HM-ENTER).
    @State private var hasEntered = false
    /// The dive type whose start card was just pressed: its ring traces while the recording starts.
    @State private var armingMode: DiveMode?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Space between Home's groups: the plan row, the latest log, the rows and the footer.
    private static let groupGap: CGFloat = 6
    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(spacing: DiveSpacing.rowGap) {
                        Button {
                            startRealDive(mode: .freedive)
                        } label: {
                            StartSessionCard(
                                title: "Freediving",
                                systemImage: "divenary.freedive",
                                accent: DiveWatchTheme.action,
                                trailingSystemImage: "play.fill",
                                isArming: armingMode == .freedive
                            )
                        }
                        .buttonStyle(DivePressStyle(dimsWhenDisabled: false))
                        .disabled(!canStartRealDive)
                        .homeEntrance(0, hasEntered: hasEntered)

                        Button {
                            startRealDive(mode: .scuba)
                        } label: {
                            StartSessionCard(
                                title: "Scuba Diving",
                                systemImage: "divenary.scuba",
                                accent: DiveWatchTheme.action,
                                trailingSystemImage: "play.fill",
                                isArming: armingMode == .scuba
                            )
                        }
                        .buttonStyle(DivePressStyle(dimsWhenDisabled: false))
                        .disabled(!canStartRealDive)
                        .homeEntrance(1, hasEntered: hasEntered)
                    }

                    // A watch that cannot record real dives says so under the start cards (P13).
                    if let sensorAvailability, sensorAvailability.readiness != .ready {
                        HomeSensorNotice(sensorReadiness: sensorAvailability.readiness)
                            .padding(.top, 10)
                            .padding(.bottom, 6)
                            .transition(.opacity)
                    }

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
                            HomeRow(
                                title: "Dive Plans",
                                detail: selectedPlanSubtitle,
                                systemImage: "list.bullet.clipboard"
                            )
                        }
                        .buttonStyle(DivePressStyle())
                        .padding(.top, DiveSpacing.rowGap)
                        .homeEntrance(2, hasEntered: hasEntered)
                    }

                    if let latestSession = store.sessions.first {
                        LatestSessionCard(session: latestSession)
                            .padding(.top, Self.groupGap)
                            .homeEntrance(3, hasEntered: hasEntered)
                    }

                    VStack(spacing: DiveSpacing.rowGap) {
                        NavigationLink {
                            SessionListView(store: store)
                        } label: {
                            HomeRow(title: "Saved Sessions", systemImage: "list.bullet")
                        }
                        .buttonStyle(DivePressStyle())
                        .homeEntrance(4, hasEntered: hasEntered)

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
                        .homeEntrance(5, hasEntered: hasEntered)

                        // A secondary row, so a demo log is never mistaken for a real start.
                        NavigationLink {
                            DeferredView {
                                SimulatedRecordingFlowView(
                                    store: store,
                                    plan: explicitStartPlan(for: .scuba).withoutPlannedDiveLink,
                                    recordingMode: .demo,
                                    actionButtonBridge: actionButtonBridge,
                                    actionButtonDonor: actionButtonDonor,
                                    keepPendingRecord: realCoordinator.keepPendingRecordForRetry
                                )
                            }
                        } label: {
                            HomeRow(
                                title: "Demo",
                                detail: String(localized: "Simulated depth"),
                                systemImage: "divenary.column.half"
                            )
                        }
                        .buttonStyle(DivePressStyle())
                        .homeEntrance(6, hasEntered: hasEntered)

                        #if DEBUG
                        if showsDebugControls {
                            NavigationLink {
                                DeferredView {
                                    SimulatedRecordingFlowView(
                                        store: store,
                                        plan: explicitStartPlan(for: .freedive).withoutPlannedDiveLink,
                                        recordingMode: .debugTest,
                                        actionButtonBridge: actionButtonBridge,
                                        actionButtonDonor: actionButtonDonor,
                                        keepPendingRecord: realCoordinator.keepPendingRecordForRetry
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
                                        actionButtonDonor: actionButtonDonor,
                                        keepPendingRecord: realCoordinator.keepPendingRecordForRetry
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
                    }
                    .padding(.top, Self.groupGap)

                    HomeSafetyFooter()
                        .padding(.top, Self.groupGap)
                        .homeEntrance(7, hasEntered: hasEntered)
                }
                .padding(.horizontal, DiveLayout.platterInset(sizeClass))
                .padding(.bottom, 4)
                .animation(DiveMotion.animation(.ready, reduceMotion: reduceMotion, alwaysOn: false),
                           value: sensorAvailability?.readiness)
            }
            // Platter insets are measured from the screen's edges (spec B3).
            .ignoresSafeArea(.container, edges: .horizontal)
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
                plan = HomePlanSelection.validated(plan, plannedDives: store.plannedDives)
                realCoordinator.retryPendingRecords()
                autoLaunchAuthorization.refresh()
                realCoordinator.receiveWaterState(water.latestState)
                if !hasEntered {
                    hasEntered = true
                }
            }
            .onReceive(water.$latestState.removeDuplicates().dropFirst()) { nextState in
                realCoordinator.receiveWaterState(nextState)
            }
            .onChange(of: store.plannedDives) { _, plannedDives in
                plan = HomePlanSelection.validated(plan, plannedDives: plannedDives)
            }
            .onChange(of: realCoordinator.phase.presentsRecordingFlow) { _, isPresented in
                // The ring keeps tracing while the recording slides in; back on Home it is gone.
                if !isPresented {
                    armingMode = nil
                }
            }
            .onChange(of: scenePhase) { _, nextPhase in
                if nextPhase == .active {
                    store.resumePendingDeletionsIfNeeded()
                    realCoordinator.retryPendingRecords()
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
        HomePlanSelection.startPlan(plan, mode: diveMode, plannedDives: store.plannedDives)
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

    /// Starts at once; the card's ring traces alongside, never before it (spec HM-ARM).
    private func startRealDive(mode diveMode: DiveMode) {
        let startPlan = explicitStartPlan(for: diveMode)
        plan = startPlan
        store.updatePreferredDiveMode(diveMode)
        armingMode = diveMode
        realCoordinator.startManual(plan: startPlan)
        if !realCoordinator.phase.presentsRecordingFlow {
            armingMode = nil
        }
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

private extension View {
    /// Home's first appearance (spec HM-ENTER): item `index` fades in and rises 8 pt, 40 ms after the
    /// one before it. Reduce Motion fades it in without the rise.
    func homeEntrance(_ index: Int, hasEntered: Bool) -> some View {
        modifier(HomeEntrance(index: index, hasEntered: hasEntered))
    }
}

private struct HomeEntrance: ViewModifier {
    let index: Int
    let hasEntered: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let rises = DiveMotion.allowsMovement(.homeEnter, reduceMotion: reduceMotion, alwaysOn: false)
        content
            .opacity(hasEntered ? 1 : 0)
            .offset(y: hasEntered || !rises ? 0 : DiveMotion.homeEnterOffset)
            .animation(
                DiveMotion.animation(.homeEnter, reduceMotion: reduceMotion, alwaysOn: false)?
                    .delay(DiveMotion.homeEnterDelay(index: index)),
                value: hasEntered
            )
    }
}

struct DivePlansView: View {
    let plannedDives: [WatchPlannedDive]
    let selectedPlanLocalId: String?
    let isSelectionEnabled: Bool
    let onSelect: (WatchPlannedDive) -> Void
    let onClearSelection: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The row drawn as chosen. It changes at the tap, so the check shows before the screen closes.
    @State private var shownSelection: String?
    @State private var isClosing = false

    private let sizeClass = DiveType.SizeClass.current

    init(
        plannedDives: [WatchPlannedDive],
        selectedPlanLocalId: String?,
        isSelectionEnabled: Bool,
        onSelect: @escaping (WatchPlannedDive) -> Void,
        onClearSelection: @escaping () -> Void
    ) {
        self.plannedDives = plannedDives
        self.selectedPlanLocalId = selectedPlanLocalId
        self.isSelectionEnabled = isSelectionEnabled
        self.onSelect = onSelect
        self.onClearSelection = onClearSelection
        _shownSelection = State(initialValue: selectedPlanLocalId)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(isSelectionEnabled
                    ? HomePlanSelection.instructions
                    : String(localized: "Plans start real dives on a supported Apple Watch."))
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, DiveLayout.platterPadding(sizeClass))

                VStack(spacing: DiveSpacing.groupGap(sizeClass) / 2) {
                    ForEach(plannedDives) { plannedDive in
                        let isSelected = shownSelection == plannedDive.localId
                        Button {
                            choose(plannedDive, isSelected: isSelected)
                        } label: {
                            PlannedDiveRow(plannedDive: plannedDive, isSelected: isSelected)
                        }
                        .buttonStyle(DivePressStyle())
                        .disabled(!isSelectionEnabled)
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
                .padding(.top, 15)
            }
            .padding(.horizontal, DiveLayout.platterInset(sizeClass))
            .padding(.bottom, 4)
        }
        // The insets above are measured from the screen's edges.
        .ignoresSafeArea(.container, edges: .horizontal)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Dive Plans")
    }

    /// Shows the check (or clears it), then closes after a moment (spec PL-SELECT).
    private func choose(_ plannedDive: WatchPlannedDive, isSelected: Bool) {
        guard !isClosing else { return }
        isClosing = true
        withAnimation(DiveMotion.animation(.selection, reduceMotion: reduceMotion, alwaysOn: false)) {
            shownSelection = isSelected ? nil : plannedDive.localId
        }
        if isSelected {
            onClearSelection()
        } else {
            onSelect(plannedDive)
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(DiveMotion.planDismissDelay(reduceMotion: reduceMotion)))
            dismiss()
        }
    }
}

/// One plan (COPY C11): the title, the dive type, the planned maximum depth and the date, each on its
/// own line so nothing wraps. A chosen plan has the blue fill and a check that bounces once.
private struct PlannedDiveRow: View {
    let plannedDive: WatchPlannedDive
    let isSelected: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    /// Counts this row's own selections, so only the newly chosen check bounces.
    @State private var bounces = 0

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        let mode = plannedDive.diveMode ?? .scuba
        let depth = ValueRow(
            label: String(localized: "PLANNED MAX"),
            formattedValue: DiveFormatters.depth(plannedDive.plannedMaxDepthMeters)
        )

        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top, spacing: 6) {
                Text(plannedDive.displayTitle)
                    .diveFont(.headline)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .regular))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(
                        isSelected ? Self.checkCutout : DiveWatchTheme.dotOff,
                        isSelected ? DiveWatchTheme.action : DiveWatchTheme.dotOff
                    )
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: bounces)
                    .accessibilityHidden(true)
            }

            HStack(spacing: 4) {
                DiveSymbol(name: mode == .freedive ? "divenary.freedive" : "divenary.scuba", size: 12)
                    .foregroundStyle(DiveWatchTheme.ink2)
                Text(mode.label)
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(depth.label)
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
                Text(depth.value ?? depth.placeholder)
                    .diveFont(.footnoteMetric)
                    .foregroundStyle(depth.value == nil ? DiveWatchTheme.ink3 : DiveWatchTheme.ink)
                if let unit = depth.unit {
                    Text(unit)
                        .diveFont(.footnote)
                        .foregroundStyle(DiveWatchTheme.ink2)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)

            if let plannedAt = plannedDive.plannedAt {
                Text(DiveFormatters.relativeDate(Date(timeIntervalSince1970: plannedAt)))
                    .diveFont(.footnote)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(DiveLayout.platterPadding(sizeClass))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous)
                .fill(isSelected ? DiveWatchTheme.actionFill : DiveWatchTheme.platter)
        )
        .contentShape(RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous))
        .accessibilityElement(children: .combine)
        .onChange(of: isSelected) { _, nowSelected in
            // The check bounces once on land; never under Reduce Motion or Always-On.
            if nowSelected, DiveMotion.allowsLandBounce(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced) {
                bounces += 1
            }
        }
    }

    /// The check drawn in the selected fill's colour, as a cut-out of the blue circle (spec C3).
    private static let checkCutout = DiveRGB(hex: 0x0C2D4D).color
}

/// Shown after the sensor check on a watch that cannot record real dives, under the start cards
/// (P13). It is a quiet notice, not an alarm: nothing is wrong, and the demo still works.
private struct HomeSensorNotice: View {
    let sensorReadiness: DepthSensorReadiness

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: "info.circle")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.ink2)
                Text(sensorReadiness.statusTitle)
                    .diveFont(.footnoteEmphasis)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(String(localized: "Real dives need a depth sensor. The demo still works."))
                .diveFont(.footnote)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The real Divenary mark over the non-certified sentence (spec C17, DECISIONS D16).
private struct HomeSafetyFooter: View {
    var body: some View {
        VStack(spacing: 6) {
            LogoMark()
                .fill(DiveWatchTheme.ink3, style: LogoMark.fillStyle)
                .aspectRatio(LogoMark.aspectRatio, contentMode: .fit)
                .frame(width: DiveLayout.footerLogoWidth)
                .accessibilityHidden(true)

            Text(String(localized: "Recreational capture and review. Not a certified dive computer."))
                .diveFont(.footnote)
                .foregroundStyle(DiveWatchTheme.ink3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 4)
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

/// A real start (spec C2): the dive-type glyph on a grey disc, the title, and a blue play disc. While
/// the sensor check runs, and on a watch without depth sensing, the glyph and title dim and the play
/// disc turns grey; the check finishing brightens them (HM-READY). A press traces a ring around the
/// play disc while the recording starts (HM-ARM).
private struct StartSessionCard: View {
    static let minimumHeight: CGFloat = 64

    let title: LocalizedStringKey
    /// An SF Symbol or a Divenary glyph name such as `divenary.freedive`.
    let systemImage: String
    let accent: Color
    let trailingSystemImage: String
    var isArming = false

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ringProgress: CGFloat = 0
    @State private var isWaiting = false

    private let metrics = DiveLayout.StartCard(.current)

    var body: some View {
        content
            .padding(.horizontal, metrics.padding)
            .padding(.vertical, (metrics.height - metrics.glyphDisc) / 2)
            .frame(maxWidth: .infinity)
            .frame(minHeight: Self.minimumHeight)
            .background(
                RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
                    .fill(DiveWatchTheme.platter)
            )
            .contentShape(RoundedRectangle(cornerRadius: metrics.radius, style: .continuous))
            .animation(DiveMotion.animation(.ready, reduceMotion: reduceMotion, alwaysOn: false), value: isEnabled)
            .accessibilityElement(children: .combine)
            .task(id: isArming) {
                guard isArming else {
                    ringProgress = 0
                    isWaiting = false
                    return
                }
                withAnimation(DiveMotion.animation(.arm, reduceMotion: reduceMotion, alwaysOn: false)) {
                    ringProgress = 1
                }
                // A start that has not shown after a second gets a spinner instead of the ring.
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                isWaiting = true
            }
    }

    private var content: some View {
        HStack(spacing: metrics.discToTitle) {
            GlyphDisc(diameter: metrics.glyphDisc) {
                DiveSymbol(name: systemImage, size: metrics.glyph)
            }
            .opacity(isEnabled ? 1 : 0.45)

            Text(title)
                .diveFont(.headline)
                .foregroundStyle(DiveWatchTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .opacity(isEnabled ? 1 : 0.45)

            Spacer(minLength: 4)

            GlyphDisc(diameter: metrics.playDisc, fill: isEnabled ? accent : DiveWatchTheme.marker) {
                Image(systemName: trailingSystemImage)
                    .font(.system(size: metrics.playGlyph, weight: .semibold))
                    .foregroundStyle(isEnabled ? DiveWatchTheme.ink : DiveWatchTheme.ink3)
                    .offset(x: 1)
            }
            .overlay { armingIndicator }
        }
    }

    @ViewBuilder
    private var armingIndicator: some View {
        if isArming {
            if isWaiting {
                ProgressView()
                    .tint(DiveWatchTheme.ink)
                    .frame(width: metrics.armingRing, height: metrics.armingRing)
            } else if DiveMotion.allowsMovement(.arm, reduceMotion: reduceMotion, alwaysOn: false) {
                Circle()
                    .trim(from: 0, to: ringProgress)
                    .stroke(DiveWatchTheme.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: metrics.armingRing, height: metrics.armingRing)
            }
        }
    }
}

/// A row (spec C3): a grey glyph, the title and an optional detail on a platter. No chevron and no
/// border, as watchOS rows have none.
private struct HomeRow: View {
    let title: LocalizedStringKey
    var detail: String?
    /// An SF Symbol or a Divenary glyph name such as `divenary.column.half`.
    let systemImage: String

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        HStack(spacing: 0) {
            DiveSymbol(name: systemImage, size: DiveLayout.rowIcon(sizeClass))
                .foregroundStyle(DiveWatchTheme.ink2)
                .frame(width: DiveLayout.rowIconColumn, alignment: .leading)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .diveFont(.body)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let detail {
                    // A plan picked on the plans screen cross-fades in (spec HM-SUB).
                    Text(detail)
                        .diveFont(.footnote)
                        .foregroundStyle(DiveWatchTheme.ink2)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .contentTransition(.opacity)
                        .animation(DiveMotion.animation(.selection, reduceMotion: false, alwaysOn: false), value: detail)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: DiveLayout.rowHeight(sizeClass, hasDetail: detail != nil), alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous)
                .fill(DiveWatchTheme.platter)
        )
        .contentShape(RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The latest log (spec C4, DECISIONS D3, D4): the date, maximum depth and dive time, a small
/// profile, and markers only when one applies. Sync is a glyph only; VoiceOver reads one summary
/// with the full sync status. No dive type. Not tappable.
private struct LatestSessionCard: View {
    let session: DiveSessionRecord
    /// The summary replays the depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary
    private let profilePoints: [CGPoint]

    private let sizeClass = DiveType.SizeClass.current

    init(session: DiveSessionRecord) {
        self.session = session
        summary = session.summary
        profilePoints = MiniDepthProfile.normalizedPoints(
            depths: MiniDepthProfile.thinnedDepths(session.samples.map(\.depthMeters), maximumCount: 120)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .center, spacing: 4) {
                Text("LAST DIVE")
                    .diveFont(.eyebrow)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: session.syncStatus.symbol)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(session.syncStatus.tint)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityLabel(session.syncStatus.label)
            }

            Text(DiveFormatters.relativeDate(session.startedAt))
                .diveFont(.cardDate)
                .foregroundStyle(DiveWatchTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            LatestMetric(maxDepthMeters: summary.maxDepthMeters, durationSeconds: summary.durationSeconds)

            if !profilePoints.isEmpty {
                DepthSparkline(id: session.id, points: profilePoints)
                    .frame(height: DiveLayout.sparklineHeight(sizeClass))
                    .padding(.top, 4)
            }

            if hasMarkers {
                // The markers get their own row: squeezed together, "Test" split across two lines.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { markers(keepsOneLine: true) }
                    VStack(alignment: .leading, spacing: 4) { markers(keepsOneLine: false) }
                }
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
        .padding(.top, 9)
        .padding(.bottom, DiveLayout.platterPadding(sizeClass))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.recentCard, style: .continuous)
                .fill(DiveWatchTheme.platter)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DiveFormatters.sessionAccessibilitySummary(session, summary: summary))
    }

    private var hasMarkers: Bool {
        session.captureProvenanceLabel != nil || session.exceedsSupportedDepth || session.recoveryLabel != nil
    }

    @ViewBuilder
    private func markers(keepsOneLine: Bool) -> some View {
        // A demo or test log never reads as a real dive on Home.
        if let captureProvenanceLabel = session.captureProvenanceLabel {
            StatusPill(title: captureProvenanceLabel, style: .marker)
                .fixedSize(horizontal: keepsOneLine, vertical: true)
        }
        if session.exceedsSupportedDepth {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.caution)
                Text(String(localized: "Outside watch support"))
                    .diveFont(.cardMarker)
                    .foregroundStyle(DiveWatchTheme.ink2)
            }
            .fixedSize(horizontal: keepsOneLine, vertical: true)
        }
        if let recoveryLabel = session.recoveryLabel {
            Text(recoveryLabel)
                .diveFont(.cardMarker)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: keepsOneLine, vertical: true)
        }
    }
}

/// The latest log's values: the maximum depth with its unit, then the dive time in grey.
private struct LatestMetric: View {
    let maxDepthMeters: Double
    let durationSeconds: TimeInterval

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(DiveFormatters.depthValue(maxDepthMeters))
                .diveFont(.cardDepth)
                .foregroundStyle(DiveWatchTheme.ink)
            Text(verbatim: "m")
                .diveFont(.cardUnit)
                .foregroundStyle(DiveWatchTheme.ink2)
                .padding(.leading, 2)
            Text(DiveFormatters.cardDuration(durationSeconds))
                .diveFont(.cardDetail)
                .foregroundStyle(DiveWatchTheme.ink2)
                .padding(.leading, 8)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
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
