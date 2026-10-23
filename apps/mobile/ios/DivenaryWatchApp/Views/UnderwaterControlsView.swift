import SwiftUI

/// How to control Divenary once the touchscreen is locked underwater, one vertical page per control
/// (spec F8–F10): Auto-Launch, the Digital Crown and the Action Button. watchOS reports the
/// auto-launch status; no public API says whether Divenary is assigned to the Action Button, so that
/// page is a how-to with conditional wording.
struct UnderwaterControlsView: View {
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool

    @State private var page = GuidePage.autoLaunch

    var body: some View {
        TabView(selection: $page) {
            GuidePageLayout(illustration: .autoLaunch, isCurrent: page == .autoLaunch) {
                GuideTitle(String(localized: "Auto-Launch"))
                AutoLaunchStatusLine(autoLaunchStatus: autoLaunchStatus)
                GuideText(String(localized: "In Settings > General > Auto-Launch, choose Divenary for When Submerged. Recording then starts when watchOS starts the dive session."))
            }
            .tag(GuidePage.autoLaunch)

            GuidePageLayout(illustration: .crown, isCurrent: page == .crown) {
                GuideTitle(String(localized: "Digital Crown"))
                if hasActionButton {
                    GuideText(String(localized: "While recording, turn the Digital Crown to move between pages. Switching type and ending still take an Action Button press."))
                } else {
                    GuideText(String(localized: "While recording, turn the Digital Crown to switch between Live and Details."))
                }
                GuideText(String(localized: "Turning off Water Lock at the surface ends recording."))
                    .padding(.top, GuideText.paragraphGap)
            }
            .tag(GuidePage.crown)

            GuidePageLayout(illustration: .actionButton, isCurrent: page == .actionButton) {
                GuideTitle(String(localized: "Action Button"))
                if hasActionButton {
                    GuideText(String(localized: "In Settings > Action Button, choose Dive, then Divenary."))
                    GuideText(String(localized: "If you assigned Divenary to the Action Button, the first press starts a dive and later presses switch pages. At the surface after 3 minutes, a press on the last page ends and saves."))
                        .padding(.top, GuideText.paragraphGap)
                    GuideText(String(localized: "Before you dive, press the Action Button on the Switch type page to change between scuba and freediving."))
                        .padding(.top, GuideText.paragraphGap)
                } else {
                    GuideText(String(localized: "This watch may not have an Action Button. Start from Home before entering the water."))
                }
                // The last page carries the non-certified sentence (COPY C3).
                DiveDisclaimer()
                    .padding(.top, GuideText.paragraphGap)
            }
            .tag(GuidePage.actionButton)
        }
        // System vertical pages with their own page indicator (spec C13, GD-PAGE).
        .tabViewStyle(.verticalPage(transitionStyle: .blur))
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Underwater controls")
    }
}

private enum GuidePage: Hashable {
    case autoLaunch
    case crown
    case actionButton
}

/// One guide page: the hardware drawing in a 32 pt band, then the title and text, which scroll inside
/// the page when they run past the screen.
private struct GuidePageLayout<Content: View>: View {
    let illustration: GuideIllustration.Kind
    let isCurrent: Bool
    @ViewBuilder let content: Content

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                GuideIllustration(kind: illustration, isCurrent: isCurrent)
                    .frame(maxWidth: .infinity)

                VStack(alignment: .leading, spacing: 0) {
                    content
                }
                .padding(.top, 5)
                .padding(.horizontal, sizeClass == .regular ? 18 : 15)
            }
            .padding(.bottom, 8)
        }
        // The text gutter is measured from the screen's edges.
        .ignoresSafeArea(.container, edges: .horizontal)
    }
}

private struct GuideTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .diveFont(.title3)
            .foregroundStyle(DiveWatchTheme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .accessibilityAddTraits(.isHeader)
            .padding(.bottom, 2)
    }
}

/// Whether watchOS launches Divenary when the watch is submerged: a hollow dot when it does not or
/// cannot say, a filled one when it does.
private struct AutoLaunchStatusLine: View {
    let autoLaunchStatus: DepthAutoLaunchStatus

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .strokeBorder(DiveWatchTheme.ink2, lineWidth: 1)
                .background(Circle().fill(autoLaunchStatus == .active ? DiveWatchTheme.ink2 : .clear))
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(autoLaunchStatus.displayText)
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 5)
    }
}

private struct GuideText: View {
    static let paragraphGap: CGFloat = 12

    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .diveFont(.footnote)
            .foregroundStyle(DiveWatchTheme.ink2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The guide's hardware drawings (spec F8–F10, DECISIONS D17), all at one scale so the watch reads
/// as one object across pages: the watch with a waterline rising in its lower half, the Digital
/// Crown with an arc that turns a quarter, and the Action Button pressing in. Each plays once when
/// its page shows (GD-ILLUS); Reduce Motion and Always-On show the finished drawing.
private struct GuideIllustration: View {
    enum Kind {
        case autoLaunch
        case crown
        case actionButton
    }

    /// The drawing's steps. `rest` is the finished drawing and comes first, so the drawing rests
    /// there until its page shows.
    enum Phase: CaseIterable {
        case rest
        case hidden
        case highlight
        case action
    }

    let kind: Kind
    let isCurrent: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var plays = 0

    static let size = CGSize(width: 64, height: 32)

    var body: some View {
        PhaseAnimator(Phase.allCases, trigger: plays) { phase in
            drawing(phase)
        } animation: { phase in
            animation(to: phase)
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .accessibilityHidden(true)
        .onAppear(perform: playIfCurrent)
        .onChange(of: isCurrent) { _, _ in playIfCurrent() }
    }

    private func playIfCurrent() {
        guard isCurrent,
              DiveMotion.allowsMovement(.illustration, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced)
        else { return }
        plays += 1
    }

    private func animation(to phase: Phase) -> Animation? {
        switch phase {
        case .hidden:
            return nil
        case .highlight:
            return .smooth(duration: 0.3)
        case .action:
            // The button presses in for half of its 400 ms; the crown and the water take 600 ms.
            return kind == .actionButton
                ? .smooth(duration: 0.2)
                : DiveMotion.animation(.illustration, reduceMotion: false, alwaysOn: false)
        case .rest:
            return .smooth(duration: 0.2)
        }
    }

    @ViewBuilder
    private func drawing(_ phase: Phase) -> some View {
        let highlight: Double = phase == .hidden ? 0 : 1
        switch kind {
        case .autoLaunch:
            AutoLaunchDrawing(highlight: highlight, waterRise: phase == .rest || phase == .action ? 1 : 0)
        case .crown:
            CrownDrawing(highlight: highlight, turn: phase == .rest || phase == .action ? 1 : 0)
        case .actionButton:
            ActionButtonDrawing(highlight: highlight, pressed: phase == .action)
        }
    }
}

/// A shape drawn in the illustration's 64 × 32 pt space, wherever it is placed.
private struct GuidePath: Shape {
    let build: (inout Path) -> Void

    func path(in rect: CGRect) -> Path {
        var path = Path()
        build(&path)
        let scale = min(rect.width / GuideIllustration.size.width, rect.height / GuideIllustration.size.height)
        return path.applying(CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: scale, y: scale))
    }
}

/// The watch from the front with water rising in its lower half: one gentle wave line and the water
/// under it, clipped to the case.
private struct AutoLaunchDrawing: View {
    let highlight: Double
    /// 0 with the water low in the case, 1 at its resting line.
    let waterRise: Double

    private static let caseRect = CGRect(x: 22.25, y: 4, width: 19.5, height: 24)

    var body: some View {
        ZStack {
            ZStack {
                GuidePath { path in
                    Self.wave(into: &path)
                    path.addLine(to: CGPoint(x: 47, y: 33))
                    path.addLine(to: CGPoint(x: 17, y: 33))
                    path.closeSubpath()
                }
                .fill(DiveWatchTheme.waterArea)
                GuidePath { path in Self.wave(into: &path) }
                    .stroke(DiveWatchTheme.ink, style: StrokeStyle(lineWidth: 1.25, lineCap: .round, lineJoin: .round))
            }
            .offset(y: (1 - waterRise) * 9)
            .opacity(highlight)
            .mask {
                GuidePath { path in
                    path.addRoundedRect(in: Self.caseRect, cornerSize: CGSize(width: 6, height: 6), style: .continuous)
                }
            }

            GuidePath { path in
                path.addRoundedRect(in: Self.caseRect, cornerSize: CGSize(width: 6, height: 6), style: .continuous)
            }
            .stroke(DiveWatchTheme.ink3, lineWidth: 1.5)

            GuidePath { path in
                path.addRoundedRect(in: CGRect(x: 43, y: 8.5, width: 3, height: 6), cornerSize: CGSize(width: 1, height: 1))
            }
            .fill(DiveWatchTheme.ink3)
        }
    }

    /// A wave resting at y 17.5 with a 12 pt period, crest on the case's centre line.
    private static func wave(into path: inout Path) {
        path.move(to: CGPoint(x: 17, y: 17.5))
        var x: CGFloat = 17
        var up = true
        while x < 47 {
            path.addQuadCurve(to: CGPoint(x: x + 6, y: 17.5), control: CGPoint(x: x + 3, y: up ? 15 : 20))
            x += 6
            up.toggle()
        }
    }
}

/// The case's right side with the Digital Crown in white and an arc around it that turns a quarter.
private struct CrownDrawing: View {
    let highlight: Double
    /// 0 with the arc over the crown, 1 turned a quarter to rest on its outer side.
    let turn: Double

    private static let crownCentre = CGPoint(x: 41.75, y: 14.5)

    var body: some View {
        ZStack {
            GuidePath { path in
                path.move(to: CGPoint(x: 11, y: 1.75))
                path.addLine(to: CGPoint(x: 30.5, y: 1.75))
                path.addArc(center: CGPoint(x: 30.5, y: 9.25), radius: 7.5,
                            startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
                path.addLine(to: CGPoint(x: 38, y: 22.75))
                path.addArc(center: CGPoint(x: 30.5, y: 22.75), radius: 7.5,
                            startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
                path.addLine(to: CGPoint(x: 11, y: 30.25))
            }
            .stroke(
                LinearGradient(colors: [DiveWatchTheme.ink3.opacity(0), DiveWatchTheme.ink3],
                               startPoint: UnitPoint(x: 11.0 / 64, y: 0.5),
                               endPoint: UnitPoint(x: 27.875 / 64, y: 0.5)),
                style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
            )

            GuidePath { path in
                path.addRoundedRect(in: CGRect(x: 39.25, y: 22.25, width: 2, height: 6.5), cornerSize: CGSize(width: 0.75, height: 0.75))
            }
            .fill(DiveWatchTheme.ink3)

            ZStack {
                GuidePath { path in
                    path.addRoundedRect(in: CGRect(x: 39.125, y: 9.25, width: 5.25, height: 10.5), cornerSize: CGSize(width: 1.5, height: 1.5))
                }
                .fill(DiveWatchTheme.ink)
                GuidePath { path in
                    for y: CGFloat in [12.05, 14.5, 16.95] {
                        path.move(to: CGPoint(x: 40.45, y: y))
                        path.addLine(to: CGPoint(x: 43.05, y: y))
                    }
                }
                .stroke(Color.black, style: StrokeStyle(lineWidth: 0.65, lineCap: .round))
            }
            .opacity(highlight)

            // A black keyline keeps the arc readable where it crosses the case line.
            ZStack {
                GuidePath(build: Self.arc).stroke(Color.black, style: StrokeStyle(lineWidth: 4.5, lineCap: .round, lineJoin: .round))
                GuidePath(build: Self.arc).stroke(DiveWatchTheme.ink, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            }
            .rotationEffect(.degrees(90 * turn),
                            anchor: UnitPoint(x: Self.crownCentre.x / 64, y: Self.crownCentre.y / 32))
            .opacity(highlight)
        }
    }

    /// An arc over the crown (radius 11.25) ending in an arrowhead, turning clockwise.
    private static func arc(into path: inout Path) {
        path.addArc(center: crownCentre, radius: 11.25,
                    startAngle: .degrees(200), endAngle: .degrees(340), clockwise: false)
        path.move(to: CGPoint(x: 53.52, y: 7.365))
        path.addLine(to: CGPoint(x: 52.32, y: 10.655))
        path.addLine(to: CGPoint(x: 49.29, y: 8.905))
    }
}

/// The Ultra's left side with the Action Button in white, pressing in once.
private struct ActionButtonDrawing: View {
    let highlight: Double
    let pressed: Bool

    var body: some View {
        ZStack {
            GuidePath { path in
                path.move(to: CGPoint(x: 51.125, y: 1.75))
                path.addLine(to: CGPoint(x: 30.875, y: 1.75))
                path.addArc(center: CGPoint(x: 30.875, y: 9.25), radius: 7.5,
                            startAngle: .degrees(-90), endAngle: .degrees(180), clockwise: true)
                path.addLine(to: CGPoint(x: 23.375, y: 22.75))
                path.addArc(center: CGPoint(x: 30.875, y: 22.75), radius: 7.5,
                            startAngle: .degrees(180), endAngle: .degrees(90), clockwise: true)
                path.addLine(to: CGPoint(x: 51.125, y: 30.25))
            }
            .stroke(
                LinearGradient(colors: [DiveWatchTheme.ink3.opacity(0), DiveWatchTheme.ink3],
                               startPoint: UnitPoint(x: 51.125 / 64, y: 0.5),
                               endPoint: UnitPoint(x: 34.625 / 64, y: 0.5)),
                style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
            )

            GuidePath { path in
                path.addRoundedRect(in: CGRect(x: 17.75, y: 6.25, width: 4.125, height: 13.5), cornerSize: CGSize(width: 1.5, height: 1.5))
            }
            .fill(DiveWatchTheme.ink)
            // Presses toward the case, from its outer edge.
            .scaleEffect(pressed ? 0.88 : 1, anchor: UnitPoint(x: 21.875 / 64, y: 13.0 / 32))
            .opacity(highlight)
        }
    }
}

#if DEBUG
#Preview("Underwater Controls") {
    NavigationStack {
        UnderwaterControlsView(autoLaunchStatus: .inactive, hasActionButton: true)
    }
}
#endif
