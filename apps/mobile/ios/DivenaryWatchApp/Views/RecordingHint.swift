import SwiftUI

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
        /// A press on the End page that could not end the recording. Shown briefly.
        case endRejected
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
        showsRejection: Bool = false
    ) -> RecordingHint {
        // Only the Action Button reaches the End page, so a watch that got there has the button.
        let input: Input = hasActionButton || page == .end ? .actionButton : .crown
        // The crown moves between Live and Details only.
        let cycle = input == .actionButton ? pages : [.live, .details]
        let index = cycle.firstIndex(of: page) ?? 0

        let kind: Kind
        if showsRejection {
            kind = .endRejected
        } else if page == .end {
            kind = .pressToEnd
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
        case .endRejected:
            return String(localized: "End not available")
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
    @ViewBuilder let content: (RecordingPage, RecordingHint) -> Content

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var crownTicks: Double = 0
    @State private var flashedRejectionID: Int?
    @FocusState private var crownFocused: Bool

    var body: some View {
        content(displayedPage, hint)
            .focusable(true)
            .focused($crownFocused)
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
            .onChange(of: crownTicks) { oldTicks, newTicks in
                pages.stepFromCrown(by: Int((newTicks - oldTicks).rounded()))
            }
            .onAppear {
                crownFocused = true
                pages.setAlwaysOn(isLuminanceReduced)
            }
            .onChange(of: isLuminanceReduced) { _, isReduced in
                pages.setAlwaysOn(isReduced)
            }
            .onChange(of: pages.lastActionFeedback?.id) { _, _ in
                guard let feedback = pages.lastActionFeedback,
                      case .rejected = feedback.outcome
                else {
                    return
                }
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
            showsRejection: flashedRejectionID != nil
        )
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

                Text(hint.text)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(hint.kind == .pressToEnd ? DiveWatchTheme.text : DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(DiveWatchTheme.surfaceRaised)
            )

            if hint.showsWaterLockNote {
                Text(String(localized: "Turning off Water Lock ends recording."))
                    .font(.system(size: 9, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
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
                    .fill(dot == index ? DiveWatchTheme.text : DiveWatchTheme.mutedText.opacity(0.35))
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
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(DiveWatchTheme.surfaceRaised)
            )
            .frame(maxWidth: .infinity)
    }
}
