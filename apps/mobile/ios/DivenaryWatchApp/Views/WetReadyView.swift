import SwiftUI

struct WetReadyStartGuidance {
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool

    static var notRecordingText: String { String(localized: "Not recording yet") }

    var showsHomeButton: Bool { true }

    var text: String {
        if autoLaunchStatus == .active {
            return String(localized: "Recording starts when watchOS starts the dive session.")
        }
        if hasActionButton {
            return String(localized: "If you assigned Divenary to the Action Button, press it to start recording.")
        }
        return String(localized: "Start recording from Home.")
    }
}

/// Shown when the watch is submerged before a recording starts. Submersion alone never starts a
/// recording, so the screen says which start path this watch has: watchOS auto-launch, the Action
/// Button (only a hint, the assignment cannot be read), or a return to Home to start.
///
/// It can be underwater, so nothing on it bounces or overshoots (DECISIONS D13). The water tint sits
/// behind everything (P4); the status band holds the recording band's place, so the "Ready to record"
/// chip stays put when recording starts.
struct WetReadyView: View {
    let mode: DiveMode
    let currentDepthMeters: Double?
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool
    let onSelect: (DiveMode) -> Void
    let onHome: () -> Void

    @State private var crownValue: Double
    /// False until the first frame; the content then fades in (spec WR-ENTER).
    @State private var hasEntered = false
    @Namespace private var selectionSpace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private let sizeClass = DiveType.SizeClass.current

    init(
        mode: DiveMode,
        currentDepthMeters: Double?,
        autoLaunchStatus: DepthAutoLaunchStatus,
        hasActionButton: Bool,
        onSelect: @escaping (DiveMode) -> Void,
        onHome: @escaping () -> Void
    ) {
        self.mode = mode
        self.currentDepthMeters = currentDepthMeters
        self.autoLaunchStatus = autoLaunchStatus
        self.hasActionButton = hasActionButton
        self.onSelect = onSelect
        self.onHome = onHome
        _crownValue = State(initialValue: mode.crownValue)
    }

    var body: some View {
        VStack(spacing: 0) {
            // The band stays put while the rest scrolls, as it will on the recording.
            statusBand

            GeometryReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        startContent
                            // The non-certified sentence waits wholly below the fold, so the display's
                            // corner never cuts it in half (DECISIONS D13).
                            .frame(minHeight: proxy.size.height, alignment: .top)

                        DiveDisclaimer()
                            .padding(.horizontal, DiveLayout.wetGutter(sizeClass))
                            // Scrolled to the end, it rests clear of the display's bottom corners.
                            .padding(.bottom, 24)
                    }
                }
                .modifier(NoTopScrollEdgeEffect())
            }
        }
        .padding(.top, type.statusBandTop)
        .opacity(hasEntered ? 1 : 0)
        // The band sits just under the clock (D10), and every inset is measured from the screen's edges.
        .ignoresSafeArea(.container, edges: .all)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // P4: the water tint fills the whole screen under the content, the clock included.
        .containerBackground(Self.waterTint, for: .navigation)
        .modifier(CrownFocusKeeper())
        .digitalCrownRotation(
            $crownValue,
            from: 0,
            through: 1,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onChange(of: crownValue) { _, nextValue in
            let nextMode: DiveMode = nextValue < 0.5 ? .freedive : .scuba
            guard nextMode != mode else { return }
            onSelect(nextMode)
        }
        .onChange(of: mode) { _, nextMode in
            crownValue = nextMode.crownValue
        }
        // P12: the way back to Home is the toolbar circle where the back button sits, not a capsule
        // under the text, so it never covers the start guidance.
        .toolbar {
            if startGuidance.showsHomeButton {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onHome) {
                        Image(systemName: "chevron.backward")
                    }
                    .buttonStyle(DivePressStyle(motion: .waterPress))
                    .accessibilityLabel(Text(String(localized: "Back to Home")))
                }
            }
        }
        .onAppear {
            guard !hasEntered else { return }
            withAnimation(DiveMotion.animation(.screenEnter, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced)) {
                hasEntered = true
            }
        }
    }

    /// The dive-type tiles, "Not recording yet", the start guidance and the Digital Crown line.
    private var startContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                modeButton(.freedive)
                modeButton(.scuba)
            }
            .padding(.top, sizeClass == .regular ? 6 : 5)
            .padding(.horizontal, DiveLayout.platterInset(sizeClass))
            .animation(DiveMotion.animation(.modeSlide, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced),
                       value: mode)

            VStack(alignment: .leading, spacing: 2) {
                Text(WetReadyStartGuidance.notRecordingText)
                    .diveFont(.wetTruth)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text(startGuidance.text)
                    .diveFont(.wetGuide)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "digitalcrown.arrow.clockwise")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(DiveWatchTheme.ink2)
                        .accessibilityHidden(true)
                    Text("Rotate the Digital Crown to choose a mode.")
                        .diveFont(.crownHint)
                        .foregroundStyle(DiveWatchTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 6)
            }
            .padding(.top, 3)
            .padding(.bottom, 8)
            .padding(.horizontal, DiveLayout.wetGutter(sizeClass))
        }
    }

    private var startGuidance: WetReadyStartGuidance {
        WetReadyStartGuidance(autoLaunchStatus: autoLaunchStatus, hasActionButton: hasActionButton)
    }

    private var type: DiveType {
        DiveType(sizeClass: sizeClass, isTight: false)
    }

    /// "Ready to record" beside the toolbar circle, and the live depth under the clock, on the
    /// recording status band's line (DECISIONS D10).
    private var statusBand: some View {
        // The row keeps the label beside the depth when both fit; on the narrowest watch (40 mm) the
        // label goes first, and then the depth moves under the chip rather than being cut short.
        ViewThatFits(in: .horizontal) {
            bandRow(showsLabel: true)
            bandRow(showsLabel: false)
            bandColumn
        }
        .environment(\.diveType, type)
        .frame(minHeight: DiveSpacing.chipHeight)
        // The chip starts beside the toolbar circle, as the recording band's chips do; the depth
        // ends under the clock.
        .padding(.leading, type.toolbarClearance + RecordingInstrumentView.horizontalPadding)
        .padding(.trailing, sizeClass == .regular ? 17 : 14)
    }

    private func bandRow(showsLabel: Bool) -> some View {
        HStack(alignment: .center, spacing: 4) {
            StatusChip(title: String(localized: "Ready"))

            Spacer(minLength: 4)

            if let currentDepthMeters {
                depthReadout(currentDepthMeters, showsLabel: showsLabel)
            }
        }
    }

    private var bandColumn: some View {
        VStack(alignment: .leading, spacing: 4) {
            StatusChip(title: String(localized: "Ready"))

            if let currentDepthMeters {
                HStack {
                    Spacer(minLength: 0)
                    depthReadout(currentDepthMeters, showsLabel: true)
                }
            }
        }
    }

    private func depthReadout(_ depthMeters: Double, showsLabel: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            if showsLabel {
                Text(String(localized: "Depth"))
                    .font(type.font(.rowLabel))
                    .foregroundStyle(DiveWatchTheme.ink2)
            }
            Text(DiveFormatters.depthValue(depthMeters))
                .font(DiveWatchTheme.metricFont(size: sizeClass == .regular ? 15 : 14))
                .foregroundStyle(DiveWatchTheme.ink)
                .contentTransition(.identity)
                .padding(.leading, showsLabel ? 4 : 0)
            Text(verbatim: "m")
                .font(DiveWatchTheme.metricFont(size: type.size(.rowLabel)))
                .foregroundStyle(DiveWatchTheme.ink2)
                .padding(.leading, 2)
        }
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(localized: "Depth")))
        .accessibilityValue(Text(DiveFormatters.depth(depthMeters)))
    }

    /// Touch works only before Water Lock is on, so the crown is the main way to choose. The blue
    /// selection fill slides between the tiles and settles without overshooting (WR-MODE).
    private func modeButton(_ candidate: DiveMode) -> some View {
        let isSelected = candidate == mode
        let slides = DiveMotion.allowsMovement(.modeSlide, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced)
        let tile = RoundedRectangle(cornerRadius: DiveRadius.tile, style: .continuous)

        return Button {
            onSelect(candidate)
        } label: {
            ZStack {
                tile.fill(DiveWatchTheme.platter)

                if isSelected {
                    if isLuminanceReduced {
                        // Always-On: the chosen tile is an outline, with no fill.
                        tile.strokeBorder(DiveWatchTheme.action, lineWidth: 1.5)
                    } else if slides {
                        tile.fill(DiveWatchTheme.action)
                            .matchedGeometryEffect(id: "selection", in: selectionSpace)
                    } else {
                        tile.fill(DiveWatchTheme.action)
                    }
                }

                VStack(spacing: 0) {
                    DiveSymbol(name: candidate == .freedive ? "divenary.freedive" : "divenary.scuba",
                               size: sizeClass == .regular ? 22 : 20)
                    Spacer(minLength: 2)
                    Text(candidate.label)
                        .diveFont(.wetMode)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .padding(.top, sizeClass == .regular ? 10 : 9)
                .padding(.bottom, sizeClass == .regular ? 9 : 8)
                .padding(.horizontal, 4)
                // The glyph and label cross-fade to white; nothing bounces underwater.
                .foregroundStyle(isSelected ? DiveWatchTheme.ink : DiveWatchTheme.ink2)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .frame(height: DiveLayout.wetTileHeight(sizeClass))
            // Each tile clips the sliding fill, so it leaves one tile and enters the other.
            .clipShape(tile)
            .contentShape(tile)
        }
        // The press settles without overshooting: Wet Ready can be underwater.
        .buttonStyle(DivePressStyle(motion: .waterPress))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// P4: the water tint, strongest at the top and gone by the bottom.
    private static let waterTint = LinearGradient(
        stops: [
            Gradient.Stop(color: DiveWatchTheme.water.opacity(0.6), location: 0),
            Gradient.Stop(color: DiveWatchTheme.water.opacity(0.22), location: 0.5),
            Gradient.Stop(color: DiveWatchTheme.water.opacity(0), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )
}

/// watchOS 26 softens whatever sits under the toolbar's row; the status band lives there and must
/// stay crisp.
private struct NoTopScrollEdgeEffect: ViewModifier {
    func body(content: Content) -> some View {
        if #available(watchOS 26.0, *) {
            content.scrollEdgeEffectHidden(true, for: .top)
        } else {
            content
        }
    }
}

private extension DiveMode {
    var crownValue: Double {
        self == .freedive ? 0 : 1
    }
}
