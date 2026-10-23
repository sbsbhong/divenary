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

/// The one status line above the gauge: the freedive phase, the demo/test marker, and the depth
/// status when the depth number is not current. Always-On never hides it.
struct LiveReadoutStatus: Equatable {
    var depthStatusText: String?
    var markerTitle: String?
    var phaseTitle: String?
    /// The phase chip uses the primary colour only while a dive is under way.
    var phaseIsActive = false
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
    /// A hint chip without page dots for a recording that does not page: the demo's crown hint.
    var fixedHint: String?

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// False until the first frame: the rail then grows down from the top and the values fade in.
    @State private var hasEntered = false

    static let horizontalPadding: CGFloat = 4

    var body: some View {
        if let pages {
            RealRecordingPager(pages: pages, waterState: waterState, currentMode: plan.diveMode) { page, hint in
                instrumentStack(page: page, hint: hint)
            }
        } else {
            instrumentStack(page: .live, hint: nil)
        }
    }

    /// The fixed instrument (spec C7): the status band, the gauge and the hint chip hold their places
    /// on every page; only the value column beside the gauge pages.
    private func instrumentStack(page: RecordingPage, hint: RecordingHint?) -> some View {
        GeometryReader { proxy in
            let type = DiveType(
                pageWidth: proxy.size.width + 2 * Self.horizontalPadding,
                showsStorageError: recorder.recordingPersistenceError != nil
            )
            let key = RecordingContentKey(page: page, kind: instrumentKind(for: page))
            let bottomSlot = bottomSlot(hint: hint)

            VStack(spacing: 3) {
                // The status band is always reserved, so the instrument under it never moves.
                HStack(spacing: DiveSpacing.chipGap) {
                    LiveReadoutStatusRow()
                    UnsupportedDepthWarning(
                        currentDepthMeters: displayedDepthMeters,
                        sensorDisplayLimitMeters: sensorDisplayLimitMeters
                    )
                }
                // The demo's toolbar circle shares the band's line; its chips start beside it.
                .padding(.leading, showsNavigationToolbar ? type.toolbarClearance : 0)
                .frame(maxWidth: .infinity, minHeight: DiveSpacing.chipHeight, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .animation(DiveMotion.chip(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: readoutStatus(for: page))
                .opacity(hasEntered ? 1 : 0)

                RecordingPageTransition(key: key) {
                    pageInstrument(page)
                }
                .opacity(hasEntered ? 1 : 0)
                .environment(\.recordingBottomSlotOccupied, bottomSlot != .empty)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                // One gauge for every page: it takes the page's range and stop zone, and never pages.
                .overlayPreferenceValue(RecordingGaugeKey.self, alignment: .topLeading) { entries in
                    if let rail = (entries.last { $0.key == key } ?? entries.last)?.rail {
                        rail
                    }
                }
                // The bottom slot, anchored to the instrument: the storage footer, or out of the water
                // the Water Lock line, so the gauge never resizes when the diver surfaces.
                .overlay(alignment: .bottomLeading) {
                    Group {
                        if bottomSlot == .storageError {
                            recordingErrorFooter
                        } else if bottomSlot == .waterLock {
                            RecordingWaterLockNote()
                        }
                    }
                    .frame(minHeight: type.bottomSlotHeight, alignment: .bottomLeading)
                    .padding(.leading, RecordingColumn.leading)
                    .animation(DiveMotion.autoFade(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: bottomSlot)
                }
                .layoutPriority(1)

                // No fixed non-certified line during a dive (owner decision, 2026-10-22): Home, Wet
                // Ready and the saved summary and detail carry the full sentence, and the stop
                // readout already says "Recommended stop".

                // The phase hint says what the next press does, the End page included. Demo shows its
                // crown hint instead and ends from its toolbar; debug recordings show no hint.
                if endControl == .crownHint, let hint {
                    RecordingHintBar(hint: hint)
                        .fixedSize(horizontal: false, vertical: true)
                        // The hint text and current dot cross-fade with the page (spec RC-PAGE).
                        .animation(DiveMotion.chip(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: hint)
                        .opacity(hasEntered ? 1 : 0)
                } else if let fixedHint {
                    RecordingHintChip(text: fixedHint)
                        .frame(maxWidth: .infinity)
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(hasEntered ? 1 : 0)
                }
            }
            .environment(\.liveReadoutStatus, readoutStatus(for: page))
            .environment(\.recordingAuthorizedMaximum, maximumDepthMeters)
            .environment(\.diveType, type)
            .environment(\.recordingChassisDrawsGauge, true)
            .environment(\.recordingGaugeContext, gaugeContext(for: page))
            .environment(\.recordingGaugeGrowth, hasEntered ? 1 : 0)
            // RC-SIGNAL and RC-HERO: depth going stale or coming back only cross-fades.
            .animation(DiveMotion.animation(.signal, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: displayedDepthMeters == nil)
            // RC-AOD: Always-On keeps one motion, a 300 ms settle in which nothing moves.
            .animation(DiveMotion.alwaysOnSettle(reduceMotion: reduceMotion), value: isLuminanceReduced)
            // The band sits just under the clock (D10), above the system's own top inset.
            .padding(.top, type.statusBandTop)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .padding(.horizontal, Self.horizontalPadding)
        // The system bottom inset left a blank band on every watch size. The readout and gauge take
        // that height; this margin keeps the centred hint chip clear of the rounded corners.
        .padding(.bottom, 8)
        .ignoresSafeArea(.container, edges: .bottom)
        .ignoresSafeArea(.container, edges: .top)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .toolbar(showsNavigationToolbar ? .visible : .hidden, for: .navigationBar)
        .onAppear {
            guard !hasEntered else { return }
            withAnimation(DiveMotion.animation(.recordingStart, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced)) {
                hasEntered = true
            }
        }
    }

    /// What the page shows, so an automatic change of it (the stop replacing Live, a freedive phase)
    /// cross-fades without sliding.
    private func instrumentKind(for page: RecordingPage) -> RecordingInstrumentKind {
        switch page {
        case .switchMode:
            return .switchMode
        case .end:
            return .end
        case .details:
            return plan.diveMode == .freedive ? .freediveDetails : .scubaDetails
        case .live:
            switch plan.diveMode {
            case .scuba:
                return shouldShowSafetyStopInstrument ? .recommendedStop : .scubaLive
            case .freedive:
                switch currentFreeSnapshot.state {
                case .surfaceReady: return .freediveSurfaceReady
                case .diveActive: return .freediveDiving
                case .surfaceInterval: return .freediveSurfaceInterval
                case .summary: return .freediveSummary
                }
            }
        }
    }

    /// The deepest reading draws the scuba max-depth ghost. Freediving shows the finished dives as
    /// tide marks instead (P5), and nothing but the diver during a descent.
    private func gaugeContext(for page: RecordingPage) -> RecordingGaugeContext {
        var context = RecordingGaugeContext(isBeyondLimit: isBeyondSensorLimit)
        context.emphasis = page == .details ? .details : .live
        switch plan.diveMode {
        case .scuba:
            context.maxDepthMeters = capturedMaxDepthMeters
        case .freedive:
            if currentFreeSnapshot.state != .diveActive {
                context.tideMarkDepths = currentFreeSnapshot.segments.map(\.maxDepthMeters)
            }
        }
        return context
    }

    private func bottomSlot(hint: RecordingHint?) -> RecordingBottomSlot {
        if recorder.recordingPersistenceError != nil {
            return .storageError
        }
        return hint?.showsWaterLockNote == true ? .waterLock : .empty
    }

    private func readoutStatus(for page: RecordingPage) -> LiveReadoutStatus {
        var status = LiveReadoutStatus(depthStatusText: depthStatusText, markerTitle: markerTitle)
        // The End page states its own purpose in large type; scuba shows the recommended-stop label
        // inside the stop readout. Freedive names its phase here so it is never stacked separately.
        guard page != .end, plan.diveMode == .freedive else { return status }
        switch currentFreeSnapshot.state {
        case .surfaceReady:
            status.phaseTitle = String(localized: "Surface ready")
        case .diveActive:
            status.phaseTitle = String(localized: "Dive active")
            status.phaseIsActive = true
        case .surfaceInterval:
            // The big rest-time value is already captioned "Surface interval".
            break
        case .summary:
            status.phaseTitle = String(localized: "Summary")
        }
        return status
    }

    /// The storage footer in the bottom slot (P7): a quiet grey note. The log stays in memory and
    /// the save is retried, so nothing here asks the diver to act.
    @ViewBuilder
    private var recordingErrorFooter: some View {
        if recorder.recordingPersistenceError != nil {
            RecordingStorageFooter()
        }
    }

    private var isBeyondSensorLimit: Bool {
        recorder.liveDepthSignal == .beyondSensorRange
            || (displayedDepthMeters.map { $0 > sensorDisplayLimitMeters } ?? false)
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
        case .switchMode:
            SwitchModePageInstrument(
                currentMode: plan.diveMode,
                currentDepthMeters: displayedDepthMeters,
                sensorDisplayLimitMeters: sensorDisplayLimitMeters
            )
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
                    elapsedTime: recorder.elapsedTime,
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
                primaryTime: recorder.freeDivePrimaryTime,
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

/// What a recording page shows. A change of page slides or fades the column; a change of what the
/// same page shows only cross-fades.
private enum RecordingInstrumentKind: Hashable {
    case scubaLive
    case recommendedStop
    case scubaDetails
    case freediveSurfaceReady
    case freediveDiving
    case freediveSurfaceInterval
    case freediveSummary
    case freediveDetails
    case switchMode
    case end
}

private struct RecordingContentKey: Hashable {
    let page: RecordingPage
    let kind: RecordingInstrumentKind
}

/// What sits in the slot anchored to the instrument bottom (spec C7).
private enum RecordingBottomSlot: Equatable {
    case empty
    case storageError
    case waterLock
}

/// The value column's place beside the gauge (spec C7: column at 112 px, gauge 8–100 px).
private enum RecordingColumn {
    static let gaugeGap: CGFloat = 6
    static let leading: CGFloat = DepthGaugeRail.layoutWidth + gaugeGap
}

/// The gauge a page asks for, collected by the chassis so it draws one gauge that never pages.
private struct RecordingGaugeEntry {
    var key: RecordingContentKey?
    let rail: DepthGaugeRail
}

private struct RecordingGaugeKey: PreferenceKey {
    static let defaultValue: [RecordingGaugeEntry] = []

    static func reduce(value: inout [RecordingGaugeEntry], nextValue: () -> [RecordingGaugeEntry]) {
        value.append(contentsOf: nextValue())
    }
}

private struct RecordingChassisDrawsGaugeKey: EnvironmentKey {
    static let defaultValue = false
}

private struct RecordingBottomSlotOccupiedKey: EnvironmentKey {
    static let defaultValue = false
}

private extension EnvironmentValues {
    /// Inside the chassis, pages hand their gauge to it instead of drawing their own.
    var recordingChassisDrawsGauge: Bool {
        get { self[RecordingChassisDrawsGaugeKey.self] }
        set { self[RecordingChassisDrawsGaugeKey.self] = newValue }
    }

    /// The column keeps clear of the bottom slot while it holds a line.
    var recordingBottomSlotOccupied: Bool {
        get { self[RecordingBottomSlotOccupiedKey.self] }
        set { self[RecordingBottomSlotOccupiedKey.self] = newValue }
    }
}

/// Pages the value column only (spec RC-PAGE, RC-AUTO; DECISIONS D12–D14): the diver's own page
/// change slides it 6 pt with a fade, paging back reverses it, every automatic change cross-fades,
/// and Always-On swaps it at once. The gauge is drawn by the chassis, so it never moves.
private struct RecordingPageTransition<Content: View>: View {
    let key: RecordingContentKey
    @ViewBuilder let content: Content

    @Environment(\.recordingPageMotion) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        let userInitiated = motion.userInitiated && motion.page == key.page

        content
            .transformPreference(RecordingGaugeKey.self) { entries in
                for index in entries.indices {
                    entries[index].key = key
                }
            }
            .id(key.kind)
            .transition(DiveMotion.fadeTransition(alwaysOn: isLuminanceReduced))
            .id(key.page)
            .transition(DiveMotion.pageTransition(
                userInitiated: userInitiated,
                forward: motion.forward,
                reduceMotion: reduceMotion,
                alwaysOn: isLuminanceReduced
            ))
            .animation(
                DiveMotion.pageAnimation(userInitiated: userInitiated, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced),
                value: key.page
            )
            .animation(DiveMotion.autoFade(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: key.kind)
    }
}

/// "Save retry pending" in grey (P7): the recording continues and the save is retried.
private struct RecordingStorageFooter: View {
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        Label(String(localized: "Save retry pending"), systemImage: "externaldrive.badge.exclamationmark")
            .font(.system(size: 11, weight: .regular))
            .foregroundStyle(DiveWatchTheme.ink2)
            .lineLimit(1)
            .opacity(isLuminanceReduced ? 0.8 : 1)
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
            endControl: fixture.recordingMode.endControl,
            markerTitle: fixture.recordingMode.markerTitle
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
            BigMetricText(
                caption: String(localized: "Session time"),
                value: DiveFormatters.duration(sessionTime),
                accessibilityTitle: String(localized: "Session time")
            )

            RecordingSecondaryMetrics(metrics: [
                LiveInstrumentMetric(
                    title: String(localized: "Dive count"),
                    value: "\(max(0, diveCount))"
                ),
                LiveInstrumentMetric(
                    title: String(localized: "Depth"),
                    value: DiveFormatters.depth(currentDepthMeters),
                    keepsInAlwaysOn: true
                ),
            ])
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

private struct FreeDiveActiveInstrument: View {
    let currentDepthMeters: Double?
    let activeDiveTime: TimeInterval
    let primaryTime: TimeInterval
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
            DepthOrTimeMetric(depthMeters: currentDepthMeters, time: primaryTime,
                timeCaption: DiveFormatters.freeDiveTimeCaption(depthMeters: currentDepthMeters))

            RecordingSecondaryMetrics(metrics: [
                currentDepthMeters == nil
                    ? LiveInstrumentMetric(
                        title: String(localized: "Observed time"),
                        value: DiveFormatters.duration(activeDiveTime),
                        keepsInAlwaysOn: true
                    )
                    : DepthOrTimeSecondary(depthMeters: currentDepthMeters, time: activeDiveTime).metric,
                LiveInstrumentMetric(
                    title: String(localized: "Ascent"),
                    value: DiveFormatters.ascentRate(ascentRateMetersPerMinute),
                    style: .quiet,
                    valueColor: DiveWatchTheme.ink2
                ),
            ])
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)
    }
}

/// The gauge beside the value column. Inside the chassis the gauge goes to the chassis, which draws
/// one for every page; on its own (previews) the layout draws it in place.
private struct InstrumentDepthLayout<Content: View>: View {
    let currentDepthMeters: Double?
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?
    let sensorDisplayLimitMeters: Double
    @ViewBuilder let content: Content

    @Environment(\.recordingChassisDrawsGauge) private var chassisDrawsGauge
    @Environment(\.recordingBottomSlotOccupied) private var bottomSlotOccupied
    @Environment(\.diveType) private var type

    var body: some View {
        let rail = DepthGaugeRail(
            depthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: stopZone,
            targetDepthMeters: targetDepthMeters
        )

        HStack(alignment: .top, spacing: RecordingColumn.gaugeGap) {
            if chassisDrawsGauge {
                Color.clear
                    .frame(width: DepthGaugeRail.layoutWidth)
                    .preference(key: RecordingGaugeKey.self, value: [RecordingGaugeEntry(rail: rail)])
            } else {
                rail
            }

            // Slots in a fixed order (spec C9): caption, hero, the stop page's state, two rows.
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .padding(.bottom, bottomSlotOccupied ? type.bottomSlotHeight : 0)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// The status band's chips (spec C5): the freedive phase first, then the Demo/Test marker, then the
/// depth status when the depth number is not current. Only "Diving" colours its text. Always-On
/// never hides them.
private struct LiveReadoutStatusRow: View {
    @Environment(\.liveReadoutStatus) private var status

    var body: some View {
        if status.phaseTitle != nil || status.markerTitle != nil || status.depthStatusText != nil {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DiveSpacing.chipGap) { chips }
                VStack(alignment: .leading, spacing: 2) { chips }
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private var chips: some View {
        if let phaseTitle = status.phaseTitle {
            StatusChip(title: phaseTitle, style: status.phaseIsActive ? .diving : .status)
        }
        if let markerTitle = status.markerTitle {
            MarkerChip(title: markerTitle)
        }
        if let depthStatusText = status.depthStatusText {
            StatusChip(title: depthStatusText)
        }
    }
}

/// A live depth past the sensor-authorized range. The depth status chip says the same words when the
/// sensor itself reports it; then there is no live depth, so the chip is drawn once.
private struct UnsupportedDepthWarning: View {
    let currentDepthMeters: Double?
    let sensorDisplayLimitMeters: Double

    var body: some View {
        if let currentDepthMeters, currentDepthMeters > sensorDisplayLimitMeters {
            StatusChip(title: String(localized: "Outside sensor-authorized depth"))
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
            BigMetricText(
                caption: String(localized: "Surface interval"),
                value: observedInterval.map { DiveFormatters.duration($0) },
                accessibilityTitle: String(localized: "Surface interval")
            )

            FreeLastDiveMetrics(lastSegment: lastSegment)
        }
    }

    private var observedInterval: TimeInterval? {
        DiveFormatters.observedSurfaceInterval(surfaceRestTime, depthMeters: currentDepthMeters)
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
            BigMetricText(
                caption: String(localized: "Surface interval"),
                value: DiveFormatters.duration(surfaceRestTime),
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

            RecordingSecondaryMetrics(metrics: [
                DepthOrTimeSecondary(depthMeters: currentDepthMeters, time: elapsedTime).metric,
                LiveInstrumentMetric(
                    title: String(localized: "Ascent"),
                    value: DiveFormatters.ascentRate(ascentRateMetersPerMinute),
                    style: .quiet,
                    valueColor: DiveWatchTheme.ink2
                ),
            ])
        }
    }

    private var maxScaleMeters: Double {
        max(30, ceil(max(currentDepthMeters ?? 0, displayedMaxDepthMeters) / 10) * 10)
    }
}

/// The recommended stop (spec C11, P2): "Recommended stop" and three minute indices in the caption
/// slot, the remaining time as the hero, the paused or completed line in the state slot. It stays
/// the supplementary caution amber whether it counts, pauses or completes: never the action blue,
/// and never the danger tone reserved for future mandatory states. Words tell the states apart, so
/// they still read in Always-On.
private struct SafetyStopInstrument: View {
    let currentDepthMeters: Double?
    let safetyStop: SafetyStopRecord
    var elapsedTime: TimeInterval = 0
    var sensorDisplayLimitMeters = DiveDepthSupport.supportedWatchDepthLimitMeters

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: maxScaleMeters,
            stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters,
            targetDepthMeters: safetyStop.targetDepthMeters,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            RecordingCaptionSlot {
                Text(String(localized: "Recommended stop"))
                    .modifier(RecordingCaptionStyle(color: statusColor))
                RecommendedStopIndices(completed: completedIndices, isPaused: isTimerPaused)
            }

            BigMetricText(
                value: DiveFormatters.duration(safetyStop.remainingSeconds),
                color: statusColor,
                accessibilityTitle: String(localized: "Recommended stop time remaining"),
                drawsCaptionSlot: false
            )
            .opacity(isTimerPaused && safetyStop.status != .completed ? 0.6 : 1)

            pausedBand

            RecordingSecondaryMetrics(metrics: [
                LiveInstrumentMetric(
                    title: String(localized: "Depth"),
                    value: DiveFormatters.depth(currentDepthMeters),
                    keepsInAlwaysOn: true
                ),
                LiveInstrumentMetric(
                    title: String(localized: "Log time"),
                    value: DiveFormatters.duration(elapsedTime),
                    keepsInAlwaysOn: true,
                    style: .quiet
                ),
            ], followsStateSlot: true)
        }
        .modifier(RecordingStateFade(state: stopState))
    }

    private var maxScaleMeters: Double {
        max(10, ceil((max(currentDepthMeters ?? 0, safetyStop.maxDepthMeters) + 2) / 2) * 2)
    }

    private var isTimerPaused: Bool {
        safetyStop.isDisplayTimerPaused(depthMeters: currentDepthMeters)
    }

    private var completedIndices: Int {
        safetyStop.status == .completed
            ? RecommendedStopProgress.indexCount
            : RecommendedStopProgress.completedIndices(remaining: safetyStop.remainingSeconds, total: safetyStop.durationSeconds)
    }

    private var stopState: RecordingStopState {
        if safetyStop.status == .completed { return .completed }
        return isTimerPaused ? .paused : .running
    }

    private var statusColor: Color {
        DiveWatchTheme.caution
    }

    /// The state slot: a paused or completed stop says so in words beside its glyph; a running stop
    /// leaves the slot empty. Completion only fades in: no bounce underwater.
    private var pausedBand: some View {
        RecordingStateSlot {
            if safetyStop.status == .completed {
                Label(String(localized: "Stop complete"), systemImage: "checkmark")
                    .transition(.opacity)
            } else if isTimerPaused {
                Label(String(localized: "Timer paused"), systemImage: "pause.fill")
                    .transition(.opacity)
            }
        }
    }
}

/// One secondary value under the hero: a label and a formatted value such as "5.2 m", whose unit is
/// drawn smaller. Always-On keeps only the values read at a glance (depth and time).
private struct LiveInstrumentMetric {
    let title: String
    let value: String
    var keepsInAlwaysOn = false
    var style: ValueRow.Style = .inline
    var valueColor = DiveWatchTheme.ink

    var row: ValueRow {
        ValueRow(label: title, formattedValue: value, style: style, valueColor: valueColor, keepsInAlwaysOn: keepsInAlwaysOn)
    }
}

/// Up to two rows on one grid, so a value such as "2.1 m/min" never splits and both values share an
/// edge. They sit under the hero, or under the stop page's state slot.
private struct RecordingSecondaryMetrics: View {
    let metrics: [LiveInstrumentMetric]
    var followsStateSlot = false

    @Environment(\.diveType) private var type

    var body: some View {
        ValueRows(rows: metrics.map(\.row))
            .padding(.top, followsStateSlot ? 0 : type.heroRowGap)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The caption slot (spec C9): reserved on every page, empty or not, so the hero baseline never moves.
private struct RecordingCaptionSlot<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.diveType) private var type

    var body: some View {
        HStack(spacing: 6) {
            content
        }
        .frame(maxWidth: .infinity, minHeight: type.captionSlotHeight, maxHeight: type.captionSlotHeight, alignment: .leading)
    }
}

/// Caption type: grey, or amber for the recommended stop. Always-On keeps it at 80%.
private struct RecordingCaptionStyle: ViewModifier {
    var color = DiveWatchTheme.ink2

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    func body(content: Content) -> some View {
        content
            .font(type.font(.caption))
            .tracking(type.tracking(.caption))
            .foregroundStyle(color)
            .opacity(isLuminanceReduced ? 0.8 : 1)
            .lineLimit(1)
    }
}

/// The hero slot: the number's baseline sits on one line on every page, whatever the hero's size.
private struct RecordingHeroSlot<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.diveType) private var type

    var body: some View {
        let height = type.heroSlotHeight - type.heroBaselineInset
        content
            .alignmentGuide(.bottom) { dimensions in dimensions[.lastTextBaseline] }
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .bottomLeading)
            .padding(.bottom, type.heroBaselineInset)
    }
}

private enum RecordingStopState: Hashable {
    case running
    case paused
    case completed
}

/// The stop page's state slot, reserved whether or not it holds a line.
private struct RecordingStateSlot<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.diveType) private var type

    var body: some View {
        HStack(spacing: 4) {
            content
        }
        .font(type.font(.stopState))
        .tracking(type.tracking(.stopState))
        .foregroundStyle(DiveWatchTheme.caution)
        .lineLimit(1)
        .frame(maxWidth: .infinity, minHeight: type.stateSlotHeight, maxHeight: type.stateSlotHeight, alignment: .leading)
    }
}

/// The recommended stop pausing, resuming or completing is automatic, so it only cross-fades.
private struct RecordingStateFade: ViewModifier {
    let state: RecordingStopState

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    func body(content: Content) -> some View {
        content.animation(DiveMotion.autoFade(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: state)
    }
}

/// Three minute indices beside "Recommended stop" (P2): one fills for each finished third of the
/// stop. A reminder only. A paused timer dims them; Always-On keeps them static.
private struct RecommendedStopIndices: View {
    let completed: Int
    var isPaused = false

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: DiveType.stopIndexGap) {
            ForEach(0..<RecommendedStopProgress.indexCount, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(fill(isFinished: index < completed))
                    .frame(width: type.stopIndexSize.width, height: type.stopIndexSize.height)
            }
        }
        .opacity(isPaused ? 0.4 : 1)
        .animation(DiveMotion.animation(.quickFade, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: completed)
        .accessibilityHidden(true)
    }

    private func fill(isFinished: Bool) -> Color {
        if isLuminanceReduced {
            return DiveWatchTheme.caution.opacity(isFinished ? 0.6 : 0.2)
        }
        return isFinished ? DiveWatchTheme.caution : DiveWatchTheme.cautionDim
    }
}

/// The caption slot and the one large number of a recording page (spec C9). The number is white
/// (the stop countdown amber) and its unit a smaller separate text; Always-On draws it white.
private struct BigMetricText: View {
    var caption: String?
    let value: String?
    var unit: String?
    var kind: MetricHero.Kind = .time
    var color: Color = DiveWatchTheme.ink
    let accessibilityTitle: String
    /// The recommended stop draws its own caption (label and minute indices) in the reserved slot.
    var drawsCaptionSlot = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if drawsCaptionSlot {
                RecordingCaptionSlot {
                    if let caption {
                        Text(caption)
                            .modifier(RecordingCaptionStyle())
                    }
                }
            }

            RecordingHeroSlot {
                MetricHero(value: value, unit: unit, kind: kind, color: color, label: accessibilityTitle)
            }
        }
    }
}

/// The one large value: live depth while the reading is current, otherwise the elapsed time, so a
/// depth that is no longer current never stays on screen as the main number.
private struct DepthOrTimeMetric: View {
    let depthMeters: Double?
    let time: TimeInterval
    var timeCaption: String?

    var body: some View {
        if let depthMeters {
            BigMetricText(
                value: DiveFormatters.depthValue(depthMeters),
                unit: "m",
                kind: .depth,
                accessibilityTitle: String(localized: "Depth")
            )
        } else {
            BigMetricText(
                caption: timeCaption,
                value: DiveFormatters.duration(time),
                accessibilityTitle: timeCaption ?? String(localized: "Time")
            )
        }
    }
}

/// Whichever of depth and time is not the large value. Unknown depth reads `--.- m`.
private struct DepthOrTimeSecondary {
    let depthMeters: Double?
    let time: TimeInterval

    var metric: LiveInstrumentMetric {
        if depthMeters != nil {
            return LiveInstrumentMetric(
                title: String(localized: "Time"),
                value: DiveFormatters.duration(time),
                keepsInAlwaysOn: true
            )
        }
        return LiveInstrumentMetric(
            title: String(localized: "Depth"),
            value: DiveFormatters.depth(depthMeters),
            keepsInAlwaysOn: true
        )
    }
}

/// The last freedive of the session. Before the first dive both values are unknown.
private struct FreeLastDiveMetrics: View {
    let lastSegment: FreeDiveSegment?

    var body: some View {
        RecordingSecondaryMetrics(metrics: [
            LiveInstrumentMetric(
                title: String(localized: "Last duration"),
                value: DiveFormatters.duration(lastSegment?.durationSeconds),
                style: .stacked
            ),
            LiveInstrumentMetric(
                title: String(localized: "Last depth"),
                value: DiveFormatters.depth(lastSegment?.maxDepthMeters),
                style: .quiet
            ),
        ])
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

            RecordingSecondaryMetrics(metrics: [
                LiveInstrumentMetric(
                    title: String(localized: "Max"),
                    value: DiveFormatters.depth(maxDepthMeters)
                ),
                LiveInstrumentMetric(
                    title: String(localized: "Temp"),
                    value: DiveFormatters.temperature(waterTemperatureCelsius)
                ),
            ])
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
                kind: .depth,
                accessibilityTitle: String(localized: "Dive count")
            )

            RecordingSecondaryMetrics(metrics: [
                LiveInstrumentMetric(title: String(localized: "Last dive"), value: lastDiveText, style: .stacked),
                LiveInstrumentMetric(
                    title: String(localized: "Longest dive"),
                    value: DiveFormatters.duration(snapshot.segments.map(\.durationSeconds).max()),
                    style: .quiet
                ),
            ])
        }
    }

    private var lastDiveText: String {
        let lastSegment = snapshot.segments.last
        return "\(DiveFormatters.duration(lastSegment?.durationSeconds)) · \(DiveFormatters.depth(lastSegment?.maxDepthMeters))"
    }
}

/// Switch page, before the first descent: the next Action Button press restarts the recording as the
/// other dive type, shown by its glyph. Like the End page it has no tap target.
private struct SwitchModePageInstrument: View {
    let currentMode: DiveMode
    let currentDepthMeters: Double?
    let sensorDisplayLimitMeters: Double

    @Environment(\.diveType) private var type

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: 30,
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            DiveModeGlyph(mode: targetMode)
                .fill(DiveWatchTheme.ink)
                .frame(width: glyphSize, height: glyphSize)
                .padding(.top, 4)
                .accessibilityHidden(true)
            Text(switchTitle)
                .font(type.font(.switchTitle))
                .tracking(type.tracking(.switchTitle))
                .foregroundStyle(DiveWatchTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
            Text(String(localized: "No dive yet, so recording starts over."))
                .font(type.font(.note))
                .tracking(type.tracking(.note))
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
    }

    private var targetMode: DiveMode {
        currentMode == .freedive ? .scuba : .freedive
    }

    private var glyphSize: CGFloat {
        type.sizeClass == .regular ? 30 : 24
    }

    private var switchTitle: String {
        currentMode == .freedive
            ? String(localized: "Switch to scuba")
            : String(localized: "Switch to freediving")
    }
}

/// The last page of the Action Button cycle, at the surface once ending is allowed. Its instruction
/// is the largest text on the page. It has no tap target: the next Action Button press ends through
/// the coordinator's guarded path.
private struct EndPageInstrument: View {
    let currentDepthMeters: Double?
    let elapsedTime: TimeInterval
    let maxDepthMeters: Double?
    let scaleDepthMeters: Double
    let sensorDisplayLimitMeters: Double

    @Environment(\.diveType) private var type

    var body: some View {
        InstrumentDepthLayout(
            currentDepthMeters: currentDepthMeters,
            maxScaleMeters: max(30, ceil(max(currentDepthMeters ?? 0, scaleDepthMeters) / 10) * 10),
            stopZone: nil,
            targetDepthMeters: nil,
            sensorDisplayLimitMeters: sensorDisplayLimitMeters
        ) {
            let guidance = RecordingEndGuidance(hasActionButton: ActionButtonHint.current.isLikelyUltra)
            Image(systemName: guidance.symbol)
                .font(.system(size: type.sizeClass == .regular ? 24 : 21, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.ink)
                .frame(height: type.sizeClass == .regular ? 28 : 24, alignment: .leading)
                .padding(.top, 2)
                .accessibilityHidden(true)
            Text(guidance.text)
                .font(type.font(.endInstruction))
                .tracking(type.tracking(.endInstruction))
                .foregroundStyle(DiveWatchTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .accessibilityLabel(guidance.accessibilityText)
            RecordingSecondaryMetrics(metrics: [
                LiveInstrumentMetric(
                    title: String(localized: "Log time"),
                    value: DiveFormatters.duration(elapsedTime),
                    keepsInAlwaysOn: true,
                    style: .small
                ),
            ])
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
        primaryTime: 46,
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
