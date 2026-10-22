import SwiftUI

/// Copy only. Hardware handling and the 180-second / surface guard stay in the coordinator.
struct RecordingEndGuidance {
    let hasActionButton: Bool

    var text: String {
        hasActionButton
            ? String(localized: "Press Action Button\nEnd & save")
            : String(localized: "Water Lock off\nEnd & save")
    }

    var accessibilityText: String {
        hasActionButton
            ? String(localized: "Press the Action Button to end and save the log.")
            : String(localized: "Turning off Water Lock ends recording.")
    }

    var symbol: String { hasActionButton ? "button.programmable" : "lock.open" }
}

/// The one-line hint under a real recording. It says what the next Action Button press does, or, on a
/// watch without the button, what turning the crown does. There is no public API that says whether
/// Divenary is the app assigned to the Action Button, so `hasActionButton` is only a hint.
struct RecordingHint: Equatable {
    enum Input: Equatable {
        case actionButton
        case crown
    }

    enum Kind: Equatable {
        /// "Action ▸ Details 1/2" or "Crown ▸ Details 1/2": the page the next press or turn shows.
        /// Once ending is allowed, the press after Details shows the End page ("Action ▸ End page").
        case nextPage(RecordingPage, input: Input)
        /// At the surface, but the recording is shorter than the minimum for an Action Button end.
        case endAvailableIn(seconds: Int)
        /// The End page: the next press ends and saves.
        case pressToEnd
        case waterLockToEnd
        /// A press on the End page that could not end the recording. Shown briefly.
        case endRejected
        /// The switch page: the next press restarts the recording as `DiveMode`.
        case pressToSwitch(DiveMode)
        /// A switch press after the first descent. Shown briefly.
        case switchRejected
    }

    let kind: Kind
    let pageIndex: Int
    let pageCount: Int
    /// Turning off Water Lock ends a real recording, so the note shows at the surface only.
    let showsWaterLockNote: Bool

    static func make(
        page: RecordingPage,
        pages: [RecordingPage],
        endAvailability: RecordingEndAvailability,
        waterState: WaterSubmersionState,
        hasActionButton: Bool,
        showsRejection: Bool = false,
        rejection: DiveActionRejection? = nil,
        currentMode: DiveMode = .scuba
    ) -> RecordingHint {
        // Only the Action Button reaches the switch and End pages, so a watch that got there has it.
        let input: Input = hasActionButton || page == .end || page == .switchMode ? .actionButton : .crown
        // The crown never selects the switch or End page.
        let cycle = input == .actionButton ? pages : pages.filter { $0 == .live || $0 == .details }
        let index = cycle.firstIndex(of: page) ?? 0

        let kind: Kind
        if showsRejection {
            kind = rejection == .modeSwitchUnavailable ? .switchRejected : .endRejected
        } else if page == .switchMode, input == .actionButton {
            kind = .pressToSwitch(currentMode == .freedive ? .scuba : .freedive)
        } else if page == .end {
            kind = hasActionButton ? .pressToEnd : .waterLockToEnd
        } else if input == .crown {
            kind = .nextPage(cycle[(index + 1) % cycle.count], input: .crown)
        } else {
            switch endAvailability {
            case let .availableIn(seconds):
                kind = .endAvailableIn(seconds: seconds)
            case .notAtSurface, .available:
                // Live always goes to Details first; from Details the cycle reaches the End page
                // once ending is allowed.
                kind = .nextPage(cycle[(index + 1) % cycle.count], input: .actionButton)
            }
        }

        return RecordingHint(
            kind: kind,
            pageIndex: index,
            pageCount: cycle.count,
            showsWaterLockNote: waterState == .notSubmerged
        )
    }

    var text: String {
        let position = pageIndex + 1
        switch kind {
        case .nextPage(.details, .actionButton):
            return String(localized: "Action ▸ Details \(position)/\(pageCount)")
        case .nextPage(.end, _):
            return String(localized: "Action ▸ End page")
        case .nextPage(.switchMode, .actionButton):
            return String(localized: "Action ▸ Switch type \(position)/\(pageCount)")
        case .nextPage(_, .actionButton):
            return String(localized: "Action ▸ Live \(position)/\(pageCount)")
        case .nextPage(.details, .crown):
            return String(localized: "Crown forward ▸ Details")
        case .nextPage(_, .crown):
            return String(localized: "Crown back ▸ Live")
        case let .endAvailableIn(seconds):
            return String(localized: "End available in \(DiveFormatters.countdown(seconds: seconds))")
        case .pressToEnd:
            return String(localized: "Press to end & save")
        case .waterLockToEnd:
            return String(localized: "Water Lock off ends log")
        case .endRejected:
            return String(localized: "End not available")
        case let .pressToSwitch(mode):
            return mode == .scuba
                ? String(localized: "Action ▸ Switch to scuba")
                : String(localized: "Action ▸ Switch to freediving")
        case .switchRejected:
            return String(localized: "Already dived · no switch")
        }
    }
}

/// Real recording only. It shows the page the Action Button and crown select, reports Always-On to
/// the page model and flashes a short note after a rejected press. It plays no haptics: the runtime
/// confirms presses and page changes the diver made, and nothing else.
struct RealRecordingPager<Content: View>: View {
    static var rejectionNoteSeconds: Double { 2 }

    @ObservedObject var pages: RecordingPageModel
    let waterState: WaterSubmersionState
    /// The recording's dive type, for the switch page's "switch to …" wording.
    var currentMode: DiveMode = .scuba
    @ViewBuilder let content: (RecordingPage, RecordingHint) -> Content

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var crownTicks: Double = 0
    @State private var crownDetents = CrownDetentCounter()
    @State private var flashedRejectionID: Int?
    @State private var flashedRejection: DiveActionRejection?

    var body: some View {
        content(displayedPage, hint)
            .modifier(CrownFocusKeeper())
            // The page model plays one haptic per real page change, so the crown detents stay silent.
            .digitalCrownRotation(
                $crownTicks,
                from: -1000,
                through: 1000,
                by: 1,
                sensitivity: .low,
                isContinuous: false,
                isHapticFeedbackEnabled: false
            )
            // The page change and its haptic show the turn; the system scroll indicator would only
            // say the crown moved.
            .digitalCrownAccessory(.hidden)
            // The bound value moves in fractions while the crown turns, so pages follow the running
            // total rather than each small change.
            .onChange(of: crownTicks) { _, newTicks in
                let detents = crownDetents.consume(newTicks)
                if detents != 0 {
                    pages.stepFromCrown(by: detents)
                }
            }
            .onAppear {
                pages.setAlwaysOn(isLuminanceReduced)
            }
            .onChange(of: isLuminanceReduced) { _, isReduced in
                pages.setAlwaysOn(isReduced)
            }
            .onChange(of: pages.lastActionFeedback?.id) { _, _ in
                guard let feedback = pages.lastActionFeedback,
                      case let .rejected(reason) = feedback.outcome
                else {
                    return
                }
                flashedRejection = reason
                flashedRejectionID = feedback.id
            }
            .task(id: flashedRejectionID) {
                guard flashedRejectionID != nil else { return }
                try? await Task.sleep(for: .seconds(Self.rejectionNoteSeconds))
                guard !Task.isCancelled else { return }
                flashedRejectionID = nil
            }
    }

    /// The same page is drawn and acted on. Always-On keeps the model on Live.
    private var displayedPage: RecordingPage {
        pages.page
    }

    private var hint: RecordingHint {
        RecordingHint.make(
            page: displayedPage,
            pages: pages.pages,
            endAvailability: pages.endAvailability,
            waterState: waterState,
            hasActionButton: ActionButtonHint.current.isLikelyUltra,
            showsRejection: flashedRejectionID != nil,
            rejection: flashedRejection,
            currentMode: currentMode
        )
    }
}

/// Whole crown steps from the rotation value. watchOS updates the value in fractions while the crown
/// turns and snaps it to the stride only when the crown rests, so each change alone is under one step;
/// counting against the last whole step keeps every turn.
struct CrownDetentCounter: Equatable {
    private(set) var appliedStep = 0

    /// The whole steps since the last call that returned a step. Zero while the turn is still between steps.
    mutating func consume(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        let step = Int(value.rounded())
        let detents = step - appliedStep
        appliedStep = step
        return detents
    }
}

/// Keeps the Digital Crown on a view that has no scroll view of its own. A focus request made only in
/// `onAppear` can be lost while the navigation push or the system's Water Lock overlay is still on
/// screen, so the request repeats shortly after appearing, on return to the active scene and
/// whenever focus drops.
struct CrownFocusKeeper: ViewModifier {
    static var retryDelay: Duration { .milliseconds(300) }

    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focused: Bool
    @State private var requestCount = 0

    func body(content: Content) -> some View {
        content
            .focusable(true)
            .focused($focused)
            .onAppear { focused = true }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { requestCount += 1 }
            }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { requestCount += 1 }
            }
            // Runs on appear and after each request; a delayed retry cannot spin if focus is refused.
            .task(id: requestCount) {
                try? await Task.sleep(for: Self.retryDelay)
                guard !Task.isCancelled else { return }
                focused = true
            }
    }
}

/// Page dots, the hint chip and, at the surface, the Water Lock note. It has no tap target: the
/// touchscreen is locked while recording, and ending never happens by touch.
struct RecordingHintBar: View {
    let hint: RecordingHint

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 5) {
                RecordingPageDots(index: hint.pageIndex, count: hint.pageCount)

                // The End page already presents this instruction prominently; keep its dots
                // and Water Lock note without repeating a second end-and-save label.
                if hint.kind != .pressToEnd && hint.kind != .waterLockToEnd {
                    Text(hint.text)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(hint.kind == .pressToEnd ? DiveWatchTheme.text : DiveWatchTheme.mutedText)
                        .lineLimit(2)
                        .minimumScaleFactor(1)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(DiveWatchTheme.surfaceRaised)
            )

            if hint.showsWaterLockNote {
                Text(String(localized: "Water Lock off ends log"))
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(1)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Which readout page is showing. The hint text carries the same position for VoiceOver.
struct RecordingPageDots: View {
    let index: Int
    let count: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(count, 1), id: \.self) { dot in
                Circle()
                    .fill(dot == index ? DiveWatchTheme.text : DiveWatchTheme.mutedText.opacity(0.75))
                    .frame(width: 4, height: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

/// "Action ▸ Start next dive" on a saved summary, when this watch probably has an Action Button.
/// Underwater the diver cannot close the summary, and the next press starts a new dive.
struct NextDiveActionHint: View {
    var body: some View {
        Text(String(localized: "Action ▸ Start next dive"))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.mutedText)
            .lineLimit(2)
            .minimumScaleFactor(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(DiveWatchTheme.surfaceRaised)
            )
            .frame(maxWidth: .infinity)
    }
}
