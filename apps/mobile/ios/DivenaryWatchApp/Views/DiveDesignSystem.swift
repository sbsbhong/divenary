import SwiftUI
import WatchKit

// The Plumb design system: the recording type scale, radii and spacing, motion rules, press
// feedback and the shared pieces the screens are built from. Colours live in `DiveWatchTheme`.
// Recording-page pieces here are display only: no tap targets, and no haptics (the five
// diver-action haptics stay in `WatchDiveHaptics`).

// MARK: - Recording type scale

/// Fixed recording type sizes (spec B2), not Dynamic Type: the instrument holds one layout on every
/// page. `regular` is the Ultra-class readout, `compact` the Series 42mm-class one, and `isTight`
/// is the smaller step taken while a storage error shares the column. Weights are 400 and 600 only.
struct DiveType: Equatable {
    enum SizeClass: Equatable {
        case regular
        case compact
    }

    enum Role: CaseIterable {
        /// Depth and the freedive count.
        case heroDepth
        /// Time, the stop countdown, surface rest and total time.
        case heroTime
        case heroUnit
        case caption
        case rowLabel
        case rowValue
        case rowUnit
        case stackedValue
        case quietValue
        case quietUnit
        case chip
        case hint
        case tick
        case endInstruction
        /// The End page's dive time, smaller than the instruction above it.
        case endValue
        case switchTitle
        case note
        case waterLock
        case stopState
    }

    /// Recording pages at least this wide use the regular sizes: Ultra (205/211 pt), Series 46 mm
    /// (208) and 45 mm (198). 44, 42, 41 and 40 mm pages are compact, whatever their height.
    static let regularPageMinimumWidth: CGFloat = 195
    static let regular = DiveType(sizeClass: .regular, isTight: false)

    let sizeClass: SizeClass
    let isTight: Bool

    init(sizeClass: SizeClass, isTight: Bool) {
        self.sizeClass = sizeClass
        self.isTight = isTight
    }

    /// `pageWidth` is the whole recording page, before the instrument's side padding.
    init(pageWidth: CGFloat, showsStorageError: Bool) {
        sizeClass = pageWidth >= Self.regularPageMinimumWidth ? .regular : .compact
        isTight = showsStorageError
    }

    /// Point size for a role. Never below the 11 pt recording floor.
    func size(_ role: Role) -> CGFloat {
        let regular = sizeClass == .regular
        switch role {
        case .heroDepth:
            return isTight ? (regular ? 48 : 42) : (regular ? 56 : 48)
        case .heroTime:
            return isTight ? (regular ? 44 : 38) : (regular ? 52 : 44)
        case .heroUnit, .switchTitle, .stackedValue:
            return regular ? 20 : 17
        case .caption, .note, .stopState:
            return regular ? 13 : 12
        case .rowLabel, .chip, .hint, .tick, .waterLock, .quietUnit:
            return regular ? 12 : 11
        case .rowValue:
            return isTight ? (regular ? 18 : 16) : (regular ? 22 : 18)
        case .rowUnit:
            return regular ? 15 : 13
        case .quietValue:
            return regular ? 15 : 14
        case .endInstruction:
            return regular ? 19 : 16
        case .endValue:
            return regular ? 17 : 15
        }
    }

    /// Letter spacing in points (spec B2 tracking column).
    func tracking(_ role: Role) -> CGFloat {
        let regular = sizeClass == .regular
        switch role {
        case .heroDepth:
            return regular ? -1.2 : -0.96
        case .heroTime:
            return regular ? -1.08 : -0.87
        case .caption:
            return regular ? 0.2 : 0.23
        case .rowValue:
            return regular ? -0.1 : -0.15
        case .endInstruction:
            return regular ? -0.22 : 0
        case .rowLabel, .chip, .hint, .tick, .waterLock:
            return 0.23
        case .note, .stopState:
            return 0.2
        case .heroUnit, .rowUnit, .stackedValue, .quietValue, .quietUnit, .switchTitle, .endValue:
            return 0
        }
    }

    static func weight(_ role: Role) -> Font.Weight {
        switch role {
        case .rowLabel, .quietValue, .quietUnit, .note, .waterLock:
            return .regular
        case .heroDepth, .heroTime, .heroUnit, .caption, .rowValue, .rowUnit, .stackedValue, .chip, .hint,
             .tick, .endInstruction, .endValue, .switchTitle, .stopState:
            return .semibold
        }
    }

    /// Numbers use rounded digits of equal width so live values never shift as they change.
    static func usesMetricDigits(_ role: Role) -> Bool {
        switch role {
        case .heroDepth, .heroTime, .heroUnit, .rowValue, .rowUnit, .stackedValue, .quietValue, .quietUnit, .tick,
             .endValue:
            return true
        case .caption, .rowLabel, .chip, .hint, .endInstruction, .switchTitle, .note, .waterLock, .stopState:
            return false
        }
    }

    func font(_ role: Role) -> Font {
        Self.usesMetricDigits(role)
            ? DiveWatchTheme.metricFont(size: size(role), weight: Self.weight(role))
            : .system(size: size(role), weight: Self.weight(role))
    }

    /// Space between the column's slots; 1 pt while a storage error is shown.
    var slotSpacing: CGFloat { isTight ? 1 : 3 }

    // Right-column slots (spec C7). The caption and hero slots are reserved on every page, so the
    // hero baseline sits on the same line whichever page shows.

    var captionSlotHeight: CGFloat { sizeClass == .regular ? 16 : 14 }

    /// The hero slot follows the hero: 4 pt (2 pt compact) of headroom over the depth hero.
    var heroSlotHeight: CGFloat { size(.heroDepth) + (sizeClass == .regular ? 4 : 2) }

    /// The hero baseline sits this far above the bottom of its slot.
    var heroBaselineInset: CGFloat { sizeClass == .regular ? 7 : 6 }

    /// The gap between the hero slot and the first row; the stop page's state slot takes its place.
    var heroRowGap: CGFloat { isTight ? 1 : (sizeClass == .regular ? 4 : 2) }

    /// The recommended stop's paused or completed line.
    var stateSlotHeight: CGFloat { sizeClass == .regular ? 16 : 12 }

    /// The slot anchored to the instrument bottom: the Water Lock line or the storage footer.
    var bottomSlotHeight: CGFloat { sizeClass == .regular ? 16 : 13 }

    /// One recommended-stop minute index (proposal P2, adopted).
    var stopIndexSize: CGSize {
        sizeClass == .regular ? CGSize(width: 12, height: 4) : CGSize(width: 10, height: 3)
    }

    static let stopIndexGap: CGFloat = 3

    /// The status band's top, just under the system clock (DECISIONS D10: Ultra 72 px, Series
    /// 62 px). The system's own top inset sits lower and would cost the instrument that height.
    var statusBandTop: CGFloat { sizeClass == .regular ? 36 : 31 }

    /// Where the status band's chips start when the demo's toolbar circle shares their line
    /// (D10: x 118 px Ultra, 104 px Series, inside the instrument's 4 pt side padding).
    var toolbarClearance: CGFloat { sizeClass == .regular ? 55 : 48 }
}

private struct DiveTypeKey: EnvironmentKey {
    static let defaultValue = DiveType.regular
}

extension EnvironmentValues {
    /// The recording type step for the current readout. Recording screens set it from their size.
    var diveType: DiveType {
        get { self[DiveTypeKey.self] }
        set { self[DiveTypeKey.self] = newValue }
    }
}

// MARK: - Radii and spacing

/// Corner radii in points (spec B4), all continuous. A capsule or circle means pressable; a rounded
/// rectangle means information.
enum DiveRadius {
    static let chip: CGFloat = 6
    static let hintChip: CGFloat = 7
    static let row: CGFloat = 12
    static let banner: CGFloat = 12
    static let recentCard: CGFloat = 16
    static let tile: CGFloat = 16
    static let gaugeRail: CGFloat = 7
    static let stopZone: CGFloat = 3

    static func startCard(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 18 : 16
    }
}

/// Spacing in points (spec B3, C5, C6).
enum DiveSpacing {
    static let rowGap: CGFloat = 4
    static let chipGap: CGFloat = 4
    static let chipHeight: CGFloat = 20
    static let chipHorizontalPadding: CGFloat = 7
    static let pageDot: CGFloat = 4
    static let pageDotPitch: CGFloat = 6

    static func groupGap(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 12 : 10
    }

    /// Keeps the hint chip clear of the display's rounded corners.
    static func hintChipMaxWidth(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 184 : 168
    }

    static func hintChipHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 24 : 22
    }

    /// Gap between a row label and its value.
    static func valueColumnGap(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 6 : 5
    }
}

// MARK: - Off-recording type and layout

/// Type for the screens before and after a dive (spec B2, second table): Home, the plans, the
/// controls guide, Wet Ready and the saved logs. Unlike the recording type it follows the wearer's
/// text size. Base sizes are the Large text size, the 42 mm default; the Ultra's default xLarge
/// scales them up to the spec's Ultra column. Weights are 400 and 600 only.
enum DiveUIType {
    enum Role: CaseIterable {
        /// Card and plan titles.
        case headline
        /// Row titles.
        case body
        /// Row details, guide text, notices and the non-certified sentence.
        case footnote
        case footnoteEmphasis
        /// Section labels such as "Latest log".
        case eyebrow
        /// Guide page titles.
        case title3
        /// Wet Ready's dive-type tile labels.
        case wetMode
        /// Wet Ready's "Not recording yet".
        case wetTruth
        /// Wet Ready's start guidance.
        case wetGuide
        /// Wet Ready's Digital Crown line.
        case crownHint
        /// Summary maximum depth.
        case metricXL
        /// Detail maximum depth.
        case metricL
        /// Summary and detail dive time.
        case metricM
        /// Stacked stats.
        case statValue
        /// The Home card's maximum depth.
        case cardDepth
        /// A saved-list row's maximum depth.
        case listDepth
        /// Units beside `metricXL` and `metricL`.
        case unitL
        /// Units beside `metricM`, stats and list values.
        case unitM
        /// The Home card's date.
        case cardDate
        /// The Home card's dive time.
        case cardDetail
        /// The "m" beside the Home card's depth.
        case cardUnit
        /// The Home card's markers: "Outside watch support", "Recovered after interruption".
        case cardMarker
        /// A number inside footnote text, such as a plan's planned maximum depth.
        case footnoteMetric
    }

    /// Point size at the Large text size.
    static func baseSize(_ role: Role) -> CGFloat {
        switch role {
        case .headline, .body: return 16
        case .footnote, .footnoteEmphasis, .wetTruth, .wetGuide, .cardUnit, .footnoteMetric: return 13
        case .eyebrow, .crownHint, .unitM, .cardMarker: return 12
        case .title3, .statValue, .listDepth: return 19
        case .wetMode, .unitL: return 15
        case .metricXL: return 36
        case .metricL: return 30
        case .metricM: return 20
        case .cardDepth: return 22
        case .cardDate, .cardDetail: return 14
        }
    }

    static func weight(_ role: Role) -> Font.Weight {
        switch role {
        case .body, .footnote, .wetGuide, .crownHint, .cardDetail, .cardMarker:
            return .regular
        case .headline, .footnoteEmphasis, .eyebrow, .title3, .wetMode, .wetTruth, .metricXL, .metricL, .metricM,
             .statValue, .cardDepth, .listDepth, .unitL, .unitM, .cardDate, .cardUnit, .footnoteMetric:
            return .semibold
        }
    }

    /// Numbers and their units use rounded digits of equal width.
    static func usesMetricDigits(_ role: Role) -> Bool {
        switch role {
        case .metricXL, .metricL, .metricM, .statValue, .cardDepth, .listDepth, .unitL, .unitM, .cardUnit,
             .footnoteMetric:
            return true
        case .headline, .body, .footnote, .footnoteEmphasis, .eyebrow, .title3, .wetMode, .wetTruth, .wetGuide,
             .crownHint, .cardDate, .cardDetail, .cardMarker:
            return false
        }
    }

    /// The text style the size scales with.
    static func textStyle(_ role: Role) -> Font.TextStyle {
        switch role {
        case .headline: return .headline
        case .body, .wetMode, .cardDate, .cardDetail, .unitL: return .body
        case .title3, .statValue, .listDepth: return .title3
        case .metricXL, .metricL, .metricM, .cardDepth: return .title2
        case .footnote, .footnoteEmphasis, .eyebrow, .wetTruth, .wetGuide, .crownHint, .unitM, .cardUnit,
             .cardMarker, .footnoteMetric:
            return .footnote
        }
    }

    static func font(_ role: Role, size: CGFloat) -> Font {
        usesMetricDigits(role)
            ? DiveWatchTheme.metricFont(size: size, weight: weight(role))
            : .system(size: size, weight: weight(role))
    }
}

private struct DiveUIFont: ViewModifier {
    let role: DiveUIType.Role
    @ScaledMetric private var size: CGFloat

    init(_ role: DiveUIType.Role) {
        self.role = role
        _size = ScaledMetric(wrappedValue: DiveUIType.baseSize(role), relativeTo: DiveUIType.textStyle(role))
    }

    func body(content: Content) -> some View {
        content.font(DiveUIType.font(role, size: size))
    }
}

extension View {
    /// Off-recording type that follows the wearer's text size (spec B2, second table).
    func diveFont(_ role: DiveUIType.Role) -> some View {
        modifier(DiveUIFont(role))
    }
}

extension DiveType.SizeClass {
    /// Off-recording screens take their size class from the screen: Ultra and the larger Series
    /// watches are regular, 42 mm and smaller compact.
    init(screenWidth: CGFloat) {
        self = screenWidth >= DiveType.regularPageMinimumWidth ? .regular : .compact
    }

    static var current: DiveType.SizeClass {
        DiveType.SizeClass(screenWidth: WKInterfaceDevice.current().screenBounds.width)
    }
}

/// Geometry for the screens before and after a dive (spec B3, C2, C3, C4, C19), in points.
enum DiveLayout {
    /// The start card (spec C2). Its height never drops below the 64 pt minimum.
    struct StartCard: Equatable {
        let height: CGFloat
        let glyphDisc: CGFloat
        let glyph: CGFloat
        let playDisc: CGFloat
        let playGlyph: CGFloat
        let discToTitle: CGFloat
        let padding: CGFloat
        let radius: CGFloat

        init(_ sizeClass: DiveType.SizeClass) {
            let regular = sizeClass == .regular
            height = regular ? 72 : 64
            glyphDisc = regular ? 36 : 30
            glyph = regular ? 22 : 20
            playDisc = regular ? 32 : 30
            playGlyph = regular ? 13 : 12
            discToTitle = regular ? 10 : 8
            padding = regular ? 12 : 10
            radius = DiveRadius.startCard(sizeClass)
        }

        /// The arming ring's diameter: 3 pt outside the play disc.
        var armingRing: CGFloat { playDisc + 6 }
    }

    /// Platters sit this far in from the screen's sides.
    static func platterInset(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 6 : 5
    }

    /// Horizontal padding inside a platter.
    static func platterPadding(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 12 : 10
    }

    /// A row's height at the default text size; larger text grows it.
    static func rowHeight(_ sizeClass: DiveType.SizeClass, hasDetail: Bool) -> CGFloat {
        switch (sizeClass, hasDetail) {
        case (.regular, false): return 48
        case (.regular, true): return 54
        case (.compact, false): return 46
        case (.compact, true): return 52
        }
    }

    static func rowIcon(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 17 : 16
    }

    static let rowIconColumn: CGFloat = 24

    static func wetTileHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 64 : 58
    }

    /// Wet Ready's text sits this far in from the screen's sides.
    static func wetGutter(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 12 : 10
    }

    /// The Home card's profile.
    static func sparklineHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 30 : 26
    }

    /// The logo above Home's non-certified sentence (D16).
    static let footerLogoWidth: CGFloat = 32
}

// MARK: - Motion

/// Motion rules (spec D, DECISIONS D12–D14, D18). Underwater, automatic changes only cross-fade;
/// only a diver's own page change moves, plus the one adopted exception: the recommended-stop range
/// change interpolates once over 600 ms. Bounce and overshoot belong on land. Reduce Motion turns
/// every move into a 200 ms fade, and Always-On turns animation off apart from its own 300 ms settle.
enum DiveMotion {
    enum Kind: CaseIterable {
        /// A card, row, tile or button press (on land).
        case press
        /// The diver pages with the Action Button or the Digital Crown.
        case diverPage
        /// An automatic change of page or state.
        case autoFade
        /// A status chip appearing, leaving or changing.
        case chip
        /// The gauge range changing for the recommended stop (30 m to 10 m).
        case rangeChange
        /// The saved summary's first appearance.
        case finale
        /// A recording starts: the gauge rail grows down from the top and the values fade in.
        case recordingStart
        /// Live depth stops or resumes: the gauge fill and index fade.
        case signal
        /// A small element fades: a tick label stepping back from the depth index, a stop minute
        /// index filling.
        case quickFade

        // On land, before a dive.

        /// Home's first appearance in a launch: cards and rows rise into place one after another.
        case homeEnter
        /// The sensor check finishes: the start cards brighten and their play discs turn blue.
        case ready
        /// A start card's ring traces once around its play disc while the recording starts.
        case arm
        /// A saved profile draws itself the first time it is shown.
        case profileDraw
        /// A plan row's fill when it is chosen or cleared.
        case selection
        /// A screen fades in: Wet Ready.
        case screenEnter
        /// Wet Ready's selection fill slides to the other dive type. Wet Ready can be underwater, so
        /// it settles without overshooting.
        case modeSlide
        /// A controls guide illustration plays once when its page shows.
        case illustration

        fileprivate var curve: Curve {
            switch self {
            case .press: return .snappy(duration: 0.25)
            case .diverPage: return .smooth(duration: 0.35)
            case .autoFade: return .easeInOut(duration: 0.45)
            case .chip: return .easeInOut(duration: 0.35)
            case .rangeChange: return .smooth(duration: 0.6)
            case .finale: return .smooth(duration: 0.5)
            case .recordingStart: return .smooth(duration: 0.5)
            case .signal: return .easeOut(duration: 0.3)
            case .quickFade: return .easeInOut(duration: 0.2)
            case .homeEnter: return .smooth(duration: 0.5)
            case .ready: return .easeInOut(duration: 0.25)
            case .arm: return .easeInOut(duration: 0.6)
            case .profileDraw: return .smooth(duration: 0.6)
            case .selection: return .easeInOut(duration: 0.2)
            case .screenEnter: return .easeOut(duration: 0.3)
            case .modeSlide: return .smooth(duration: 0.3)
            case .illustration: return .smooth(duration: 0.6)
            }
        }

        fileprivate var moves: Bool {
            switch self {
            case .press, .diverPage, .rangeChange, .finale, .recordingStart, .homeEnter, .arm, .profileDraw,
                 .modeSlide, .illustration:
                return true
            case .autoFade, .chip, .signal, .quickFade, .ready, .selection, .screenEnter:
                return false
            }
        }
    }

    enum Curve: Equatable {
        case snappy(duration: Double)
        case smooth(duration: Double)
        case easeInOut(duration: Double)
        case easeOut(duration: Double)
        case linear(duration: Double)

        var duration: Double {
            switch self {
            case let .snappy(duration), let .smooth(duration), let .easeInOut(duration), let .easeOut(duration),
                 let .linear(duration):
                return duration
            }
        }

        var animation: Animation {
            switch self {
            case let .snappy(duration): return .snappy(duration: duration)
            case let .smooth(duration): return .smooth(duration: duration)
            case let .easeInOut(duration): return .easeInOut(duration: duration)
            case let .easeOut(duration): return .easeOut(duration: duration)
            case let .linear(duration): return .linear(duration: duration)
            }
        }
    }

    /// How a recording page changes (spec RC-PAGE, RC-AUTO).
    enum PageMove: Equatable {
        /// Always-On: the page swaps at once.
        case none
        /// Automatic changes and Reduce Motion: a cross-fade.
        case fade
        /// The diver's own page change: the column rises (or, paging back, drops) by `offset`.
        case slide(offset: CGFloat)
    }

    /// How far a page travels when the diver pages (spec 12 px).
    static let pageOffset: CGFloat = 6
    /// How far Home's cards and rows rise on its first appearance (spec 16 px), and the stagger
    /// between them.
    static let homeEnterOffset: CGFloat = 8
    static let homeEnterStagger = 0.04
    static let reducedMotionCurve = Curve.easeInOut(duration: 0.2)
    /// Always-On entering or leaving: opacity and colour settle together, nothing moves.
    static let alwaysOnSettle = Curve.easeInOut(duration: 0.3)
    /// A new depth sample: the gauge fill and index glide while the digits change at once.
    static let depthGlide = Curve.linear(duration: 0.3)

    static func curve(_ kind: Kind, reduceMotion: Bool, alwaysOn: Bool) -> Curve? {
        guard !alwaysOn else { return nil }
        return reduceMotion ? reducedMotionCurve : kind.curve
    }

    static func animation(_ kind: Kind, reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        curve(kind, reduceMotion: reduceMotion, alwaysOn: alwaysOn)?.animation
    }

    /// Whether this change may move or scale. When false, show it with opacity only.
    static func allowsMovement(_ kind: Kind, reduceMotion: Bool, alwaysOn: Bool) -> Bool {
        !alwaysOn && !reduceMotion && kind.moves
    }

    static func press(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.press, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func diverPage(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.diverPage, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func autoFade(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.autoFade, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func chip(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.chip, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func rangeChange(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.rangeChange, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func finale(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        animation(.finale, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    /// The Always-On settle is a fade, so Reduce Motion keeps it unchanged: `reduceMotion` is taken
    /// only so the call reads like every other motion. Use it at the parent, keyed on
    /// `isLuminanceReduced`.
    static func alwaysOnSettle(reduceMotion _: Bool) -> Animation {
        alwaysOnSettle.animation
    }

    /// When item `index` (0 first) starts rising on Home's first appearance.
    static func homeEnterDelay(index: Int) -> Double {
        Double(max(0, index)) * homeEnterStagger
    }

    /// How long a chosen plan shows its check before the plans screen closes.
    static func planDismissDelay(reduceMotion: Bool) -> Double {
        reduceMotion ? 0.2 : 0.35
    }

    /// Whether a symbol may bounce: only on land screens that are never underwater (the plan check),
    /// and never under Reduce Motion or Always-On. Wet Ready never bounces.
    static func allowsLandBounce(reduceMotion: Bool, alwaysOn: Bool) -> Bool {
        !reduceMotion && !alwaysOn
    }

    /// The gauge follows each depth sample linearly; under Reduce Motion or Always-On it jumps.
    static func depthGlideCurve(reduceMotion: Bool, alwaysOn: Bool) -> Curve? {
        reduceMotion || alwaysOn ? nil : depthGlide
    }

    static func depthGlide(reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        depthGlideCurve(reduceMotion: reduceMotion, alwaysOn: alwaysOn)?.animation
    }

    static func pageMove(userInitiated: Bool, forward: Bool, reduceMotion: Bool, alwaysOn: Bool) -> PageMove {
        guard !alwaysOn else { return .none }
        guard userInitiated, !reduceMotion else { return .fade }
        return .slide(offset: forward ? pageOffset : -pageOffset)
    }

    /// The diver's page change uses the smooth page curve; anything automatic cross-fades.
    static func pageCurve(userInitiated: Bool, reduceMotion: Bool, alwaysOn: Bool) -> Curve? {
        curve(userInitiated ? .diverPage : .autoFade, reduceMotion: reduceMotion, alwaysOn: alwaysOn)
    }

    static func pageAnimation(userInitiated: Bool, reduceMotion: Bool, alwaysOn: Bool) -> Animation? {
        pageCurve(userInitiated: userInitiated, reduceMotion: reduceMotion, alwaysOn: alwaysOn)?.animation
    }

    /// The new page rises into place and the old one leaves upward; paging back reverses it.
    static func pageTransition(userInitiated: Bool, forward: Bool, reduceMotion: Bool, alwaysOn: Bool) -> AnyTransition {
        switch pageMove(userInitiated: userInitiated, forward: forward, reduceMotion: reduceMotion, alwaysOn: alwaysOn) {
        case .none:
            return .identity
        case .fade:
            return .opacity
        case let .slide(offset):
            return .asymmetric(
                insertion: .opacity.combined(with: .offset(y: offset)),
                removal: .opacity.combined(with: .offset(y: -offset))
            )
        }
    }

    /// An automatic change of what a page shows: a cross-fade, or nothing under Always-On.
    static func fadeTransition(alwaysOn: Bool) -> AnyTransition {
        alwaysOn ? .identity : .opacity
    }
}

/// Press feedback for cards, rows and tiles that are not drawn as capsule buttons: scale 0.95 with a
/// snappy settle, or a dim to 70% under Reduce Motion. Land surfaces only; recording pages have no
/// touch targets. A disabled card, such as a real start card while the sensor check runs, is dimmed.
struct DivePressStyle: ButtonStyle {
    /// A start card draws its own disabled look (dimmed glyph and title, grey play disc), so it turns
    /// this off.
    var dimsWhenDisabled = true

    func makeBody(configuration: Configuration) -> some View {
        PressableLabel(configuration: configuration, dimsWhenDisabled: dimsWhenDisabled)
    }

    private struct PressableLabel: View {
        let configuration: Configuration
        let dimsWhenDisabled: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.isLuminanceReduced) private var isLuminanceReduced

        var body: some View {
            configuration.label
                .opacity((isEnabled || !dimsWhenDisabled ? 1 : 0.7) * (reduceMotion && configuration.isPressed ? 0.7 : 1))
                .scaleEffect(!reduceMotion && configuration.isPressed ? 0.95 : 1)
                .animation(
                    DiveMotion.press(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced),
                    value: configuration.isPressed
                )
        }
    }
}

// MARK: - Chips

/// A status or phase chip in the recording status band (spec C5): a 20 pt rounded rectangle, never a
/// capsule and never a coloured fill. Only the "Diving" phase colours its text blue.
struct StatusChip: View {
    enum Style {
        case status
        case diving
    }

    let title: String
    var style: Style = .status

    var body: some View {
        DiveChipLabel(
            title: title,
            textColor: style == .diving ? DiveWatchTheme.action : DiveWatchTheme.ink2,
            fill: DiveWatchTheme.chip
        )
    }
}

/// The Demo/Test marker chip: brighter than a status chip so a practice log is never mistaken for a
/// real one, but still a rounded rectangle, so it never looks pressable.
struct MarkerChip: View {
    let title: String

    var body: some View {
        DiveChipLabel(title: title, textColor: DiveWatchTheme.ink, fill: DiveWatchTheme.marker)
    }
}

private struct DiveChipLabel: View {
    let title: String
    let textColor: Color
    let fill: Color

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        Text(title)
            .font(type.font(.chip))
            .tracking(type.tracking(.chip))
            .foregroundStyle(textColor)
            .lineLimit(1)
            .padding(.horizontal, DiveSpacing.chipHorizontalPadding)
            .frame(height: DiveSpacing.chipHeight)
            .background(
                RoundedRectangle(cornerRadius: DiveRadius.chip, style: .continuous)
                    .fill(fill)
            )
            .opacity(isLuminanceReduced ? 0.8 : 1)
    }
}

/// The hint chip at the bottom of a recording (spec C6): vertical page dots at the leading edge,
/// matching watchOS vertical paging, then one hint line that says what the next press does.
/// `pageCount` 0 draws no dots (demo, summary); a `nil` text draws dots only. It has no tap target.
/// Always-On hides the dots without moving the text and dims the text.
struct RecordingHintChip: View {
    var text: String?
    var pageIndex = 0
    var pageCount = 0
    /// A refused press shows its note in white for a moment.
    var isEmphasized = false

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isRegular: Bool { type.sizeClass == .regular }

    var body: some View {
        HStack(spacing: isRegular ? 6 : 5) {
            if pageCount > 0 {
                RecordingPageDots(index: pageIndex, count: pageCount)
                    .opacity(isLuminanceReduced ? 0 : 1)
            }

            if let text {
                Text(text)
                    .font(type.font(.hint))
                    .tracking(type.tracking(.hint))
                    .foregroundStyle(isEmphasized ? DiveWatchTheme.ink : DiveWatchTheme.ink2)
                    .opacity(isLuminanceReduced ? 0.75 : 1)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, isRegular ? 8 : 7)
        .padding(.trailing, text == nil ? (isRegular ? 8 : 7) : (isRegular ? 9 : 8))
        .padding(.vertical, 2)
        .frame(minHeight: DiveSpacing.hintChipHeight(type.sizeClass))
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.hintChip, style: .continuous)
                .fill(DiveWatchTheme.chip)
        )
        .frame(maxWidth: DiveSpacing.hintChipMaxWidth(type.sizeClass))
        .animation(DiveMotion.chip(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: isEmphasized)
        .accessibilityElement(children: .combine)
        // Dots alone say nothing to VoiceOver; the page's own text already reads.
        .accessibilityHidden(text == nil)
    }
}

// MARK: - Values

/// The one large white number of a recording page (spec C9): the value and its unit as separate
/// texts on a shared baseline. An unknown value draws grey dashes, never a stale number, and digits
/// change in place without rolling. Always-On keeps the number white and greys the unit.
struct MetricHero: View {
    enum Kind {
        /// Depth and the freedive count, drawn at the depth size.
        case depth
        /// Time, the stop countdown and surface rest.
        case time
    }

    let value: String?
    var unit: String?
    var kind: Kind = .depth
    var color: Color = DiveWatchTheme.ink
    /// What the number is, for VoiceOver.
    var label: String = ""

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private var role: DiveType.Role { kind == .depth ? .heroDepth : .heroTime }
    private var placeholder: String { kind == .depth ? "--.-" : "--:--" }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(value ?? placeholder)
                .font(type.font(role))
                .tracking(type.tracking(role))
                .foregroundStyle(numberColor)
                .contentTransition(.identity)
                .minimumScaleFactor(0.75)

            if let unit {
                Text(unit)
                    .font(type.font(.heroUnit))
                    .foregroundStyle(value == nil || isLuminanceReduced ? DiveWatchTheme.ink3 : DiveWatchTheme.ink2)
            }
        }
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(Self.accessibilityValue(value: value, unit: unit, kind: kind)))
    }

    private var numberColor: Color {
        if value == nil { return DiveWatchTheme.ink3 }
        return isLuminanceReduced ? DiveWatchTheme.ink : color
    }

    /// The value as VoiceOver reads it. Grey dashes are never read out: an unknown depth says the
    /// depth is unavailable, and any other unknown value says it is not available.
    static func accessibilityValue(value: String?, unit: String?, kind: Kind) -> String {
        guard let value else {
            return kind == .depth ? String(localized: "Depth unavailable") : String(localized: "Not available")
        }
        guard let unit, !unit.isEmpty else { return value }
        return "\(value) \(unit)"
    }
}

/// One secondary value row under the hero (spec C10).
struct ValueRow {
    enum Style {
        /// Label, then the value and unit on the same line.
        case inline
        /// A smaller regular-weight value: ascent, the stop page's dive time, previous depth.
        case quiet
        /// Label on its own line above the value, for labels too long to share a line.
        case stacked
        /// A smaller semibold value under a larger instruction: the End page's dive time.
        case small
    }

    let label: String
    let value: String?
    var unit: String?
    var style: Style = .inline
    var valueColor: Color = DiveWatchTheme.ink
    var placeholder = "--.-"
    /// Always-On keeps only the values read at a glance; the others go transparent in place.
    var keepsInAlwaysOn = true
}

extension ValueRow {
    /// A row from a formatted value such as "5.2 m" or "21:40": the text after the last space is the
    /// unit, drawn smaller. A value holding dashes is unknown and draws in grey.
    init(
        label: String,
        formattedValue: String,
        style: Style = .inline,
        valueColor: Color = DiveWatchTheme.ink,
        keepsInAlwaysOn: Bool = true
    ) {
        let parts = Self.split(formattedValue)
        let isUnknown = parts.number.contains("--")
        self.init(
            label: label,
            value: isUnknown ? nil : parts.number,
            unit: parts.unit,
            style: style,
            valueColor: valueColor,
            placeholder: parts.number,
            keepsInAlwaysOn: keepsInAlwaysOn
        )
    }

    private static func split(_ formatted: String) -> (number: String, unit: String?) {
        guard let space = formatted.lastIndex(of: " ") else { return (formatted, nil) }
        let unit = formatted[formatted.index(after: space)...]
        // A trailing unit is letters, "/" or "°" only; anything else stays with the number.
        guard !unit.isEmpty, unit.allSatisfy({ $0.isLetter || $0 == "/" || $0 == "°" }) else {
            return (formatted, nil)
        }
        return (String(formatted[..<space]), String(unit))
    }

    /// The value as VoiceOver reads it after the label. Grey dashes are never read out: an unknown
    /// value says it is not available.
    var accessibilityValue: String {
        guard let value else { return String(localized: "Not available") }
        guard let unit, !unit.isEmpty else { return value }
        return "\(value) \(unit)"
    }
}

/// Up to two secondary rows. Inline and quiet rows share one grid, so their values start on the same
/// edge; a stacked row spans the grid. Always-On keeps the rows it is told to keep at 80% and makes
/// the rest transparent without moving anything. VoiceOver reads each row once, "label, value".
struct ValueRows: View {
    /// One row in its place. The id is the row's position, so two rows never share one.
    struct Slot: Identifiable {
        let id: Int
        let row: ValueRow
    }

    let rows: [ValueRow]

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    static func slots(_ rows: [ValueRow]) -> [Slot] {
        rows.enumerated().map { Slot(id: $0.offset, row: $0.element) }
    }

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline,
             horizontalSpacing: DiveSpacing.valueColumnGap(type.sizeClass),
             verticalSpacing: DiveSpacing.rowGap) {
            ForEach(Self.slots(rows)) { slot in
                let row = slot.row
                switch row.style {
                case .inline, .quiet, .small:
                    // A grid row cannot become one element without leaving the grid, so the value
                    // cell carries the whole row and the label cell stays silent.
                    GridRow {
                        label(row)
                            .accessibilityHidden(true)
                        value(row)
                            .modifier(ValueRowAccessibility(row: row))
                    }
                case .stacked:
                    VStack(alignment: .leading, spacing: 0) {
                        label(row)
                        value(row)
                    }
                    .modifier(ValueRowAccessibility(row: row))
                }
            }
        }
    }

    /// Always-On keeps only the rows read at a glance, at 80%; the rest go transparent in place.
    private func opacity(_ row: ValueRow) -> Double {
        guard row.keepsInAlwaysOn || !isLuminanceReduced else { return 0 }
        return isLuminanceReduced ? 0.8 : 1
    }

    private func label(_ row: ValueRow) -> some View {
        Text(row.label)
            .font(type.font(.rowLabel))
            .tracking(type.tracking(.rowLabel))
            .foregroundStyle(DiveWatchTheme.ink2)
            .lineLimit(1)
            .opacity(opacity(row))
    }

    private func value(_ row: ValueRow) -> some View {
        let roles: (value: DiveType.Role, unit: DiveType.Role) = switch row.style {
        case .inline: (.rowValue, .rowUnit)
        case .quiet: (.quietValue, .quietUnit)
        case .stacked: (.stackedValue, .rowUnit)
        case .small: (.endValue, .rowUnit)
        }
        let isUnknown = row.value == nil

        return HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(row.value ?? row.placeholder)
                .font(type.font(roles.value))
                .tracking(type.tracking(roles.value))
                .foregroundStyle(isUnknown ? DiveWatchTheme.ink3 : row.valueColor)
                .contentTransition(.identity)

            if let unit = row.unit {
                Text(unit)
                    .font(type.font(roles.unit))
                    .foregroundStyle(isUnknown || isLuminanceReduced ? DiveWatchTheme.ink3 : DiveWatchTheme.ink2)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .opacity(opacity(row))
    }
}

/// One VoiceOver element for a value row: the label, then the value or "Not available".
private struct ValueRowAccessibility: ViewModifier {
    let row: ValueRow

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(row.label))
            .accessibilityValue(Text(row.accessibilityValue))
    }
}

// MARK: - Glyphs and shapes

/// A filled circle holding one glyph: the start card's dive-type disc (marker grey) or its play disc
/// (action blue). Circles mean pressable, so it belongs on pressable cards only.
struct GlyphDisc<Glyph: View>: View {
    var diameter: CGFloat
    var fill: Color
    let glyph: Glyph

    init(diameter: CGFloat = 36, fill: Color = DiveWatchTheme.marker, @ViewBuilder glyph: () -> Glyph) {
        self.diameter = diameter
        self.fill = fill
        self.glyph = glyph()
    }

    var body: some View {
        Circle()
            .fill(fill)
            .frame(width: diameter, height: diameter)
            .overlay {
                glyph.foregroundStyle(DiveWatchTheme.ink)
            }
    }
}

/// The Divenary manta, traced from the real app logo (LOGO.md, viewBox 9 19 81 64). It is the only
/// manta the app draws; never a hand-drawn one. The eye is its own contour wound the other way, so it
/// stays a hole under the logo's even-odd rule and under the default fill. Fitted without stretching
/// (81:64) and centred in the rect.
struct LogoMark: Shape {
    static let viewBox = CGRect(x: 9, y: 19, width: 81, height: 64)
    static let aspectRatio: CGFloat = 81.0 / 64.0
    static let fillStyle = FillStyle(eoFill: true)

    func path(in rect: CGRect) -> Path {
        let box = Self.viewBox
        let scale = min(rect.width / box.width, rect.height / box.height)
        guard scale.isFinite, scale > 0 else { return Path() }
        let originX = rect.midX - box.width * scale / 2
        let originY = rect.midY - box.height * scale / 2

        var path = Path()
        for contour in [Self.bodyContour, Self.eyeContour] {
            let points = stride(from: 0, to: contour.count - 1, by: 2).map { index in
                CGPoint(x: originX + (contour[index] - box.minX) * scale,
                        y: originY + (contour[index + 1] - box.minY) * scale)
            }
            path.addLines(points)
            path.closeSubpath()
        }
        return path
    }

    /// Outer outline as x, y pairs in logo units.
    private static let bodyContour: [CGFloat] = [
        75.2, 82.0, 75.9, 81.3, 75.9, 80.8, 75.6, 80.5, 70.4, 78.3, 67.7, 77.0, 65.3, 75.2, 63.4, 73.1,
        62.1, 71.1, 61.1, 68.5, 60.9, 66.0, 61.2, 63.4, 62.1, 61.5, 62.9, 60.4, 68.5, 56.7, 72.9, 53.2,
        76.3, 49.9, 80.2, 45.0, 84.6, 38.1, 86.7, 34.0, 88.5, 28.8, 88.9, 26.1, 88.9, 23.9, 88.5, 23.6,
        88.0, 23.6, 85.8, 26.1, 83.7, 27.9, 81.8, 29.2, 78.2, 30.9, 72.3, 32.3, 69.6, 32.6, 66.3, 32.6,
        61.0, 31.8, 57.9, 30.9, 54.9, 29.6, 52.2, 27.9, 50.0, 26.1, 46.6, 21.7, 45.5, 20.5, 44.2, 19.8,
        42.5, 19.7, 41.8, 20.1, 41.3, 20.8, 41.4, 24.4, 40.5, 26.1, 39.2, 27.1, 34.6, 29.3, 31.3, 31.2,
        29.8, 31.4, 28.6, 30.9, 27.8, 29.7, 27.2, 27.7, 26.6, 27.1, 25.6, 27.0, 24.9, 27.6, 24.3, 29.0,
        24.1, 30.7, 24.3, 33.2, 25.2, 37.1, 25.1, 39.4, 24.7, 40.9, 23.9, 42.5, 22.6, 44.2, 15.9, 50.2,
        13.6, 52.7, 12.0, 55.0, 10.7, 57.6, 10.1, 59.5, 9.8, 62.2, 10.0, 64.2, 10.9, 64.3, 13.0, 63.4,
        15.7, 62.6, 20.0, 62.0, 26.1, 62.1, 32.7, 63.4, 37.1, 64.7, 44.2, 67.8, 60.8, 76.3, 66.6, 79.0,
        70.8, 80.7, 75.0, 82.0,
    ]

    /// The eye hole as x, y pairs in logo units.
    private static let eyeContour: [CGFloat] = [
        45.5, 29.9, 44.4, 29.7, 43.7, 28.8, 43.8, 27.7, 45.0, 26.8, 46.0, 27.0, 46.5, 27.4, 46.8, 28.1,
        46.6, 29.2, 45.6, 29.9,
    ]
}

/// Divenary's own instrument motif, the depth column (DECISIONS D17), used where a water symbol
/// would echo another app: an open column with three depth ticks, or half filled for the demo.
/// Drawn on a 24-unit grid with 1.8-unit round strokes, fitted to the rect and centred. Fill it
/// with the foreground colour.
struct DepthColumnGlyph: Shape {
    enum Variant {
        case empty
        case half
    }

    var variant: Variant = .empty

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        guard scale.isFinite, scale > 0 else { return Path() }

        var strokes = Path(roundedRect: CGRect(x: 9, y: 2.5, width: 7, height: 19), cornerRadius: 3.5)
        for y in [7.0, 12.0, 17.0] {
            strokes.move(to: CGPoint(x: 4, y: y))
            strokes.addLine(to: CGPoint(x: 6.6, y: y))
        }
        var glyph = strokes.strokedPath(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
        if variant == .half {
            glyph.addPath(Path(roundedRect: CGRect(x: 10.8, y: 11, width: 3.4, height: 8.7), cornerRadius: 1.7))
        }

        let placement = CGAffineTransform(translationX: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
            .scaledBy(x: scale, y: scale)
        return glyph.applying(placement)
    }
}

/// The dive-type glyphs (spec C21, DECISIONS D19, D20): the monofin for freediving and the tank for
/// scuba, the exact SVG paths of the approved canvas on its 24-unit grid, written out in absolute
/// points. Fitted to the rect without stretching and centred. Fill it with the foreground colour.
struct DiveModeGlyph: Shape {
    let mode: DiveMode

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        guard scale.isFinite, scale > 0 else { return Path() }
        let glyph = mode == .freedive ? Self.monofin : Self.tank
        let placement = CGAffineTransform(translationX: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
            .scaledBy(x: scale, y: scale)
        return glyph.applying(placement)
    }

    /// `M12 2.5c-1.5 0-2.4 1.2-2.4 2.8v6.6c0 1.1-.4 2.1-1.2 2.9L4.6 18.6c-.7.7-.2 1.9.8 1.9h13.2
    /// c1 0 1.5-1.2.8-1.9l-3.8-3.8c-.8-.8-1.2-1.8-1.2-2.9V5.3c0-1.6-.9-2.8-2.4-2.8z`
    private static let monofin: Path = {
        var path = Path()
        path.move(to: CGPoint(x: 12, y: 2.5))                                       // M12 2.5
        path.addCurve(to: CGPoint(x: 9.6, y: 5.3),                                  // c-1.5 0-2.4 1.2-2.4 2.8
                      control1: CGPoint(x: 10.5, y: 2.5), control2: CGPoint(x: 9.6, y: 3.7))
        path.addLine(to: CGPoint(x: 9.6, y: 11.9))                                  // v6.6
        path.addCurve(to: CGPoint(x: 8.4, y: 14.8),                                 // c0 1.1-.4 2.1-1.2 2.9
                      control1: CGPoint(x: 9.6, y: 13), control2: CGPoint(x: 9.2, y: 14))
        path.addLine(to: CGPoint(x: 4.6, y: 18.6))                                  // L4.6 18.6
        path.addCurve(to: CGPoint(x: 5.4, y: 20.5),                                 // c-.7.7-.2 1.9.8 1.9
                      control1: CGPoint(x: 3.9, y: 19.3), control2: CGPoint(x: 4.4, y: 20.5))
        path.addLine(to: CGPoint(x: 18.6, y: 20.5))                                 // h13.2
        path.addCurve(to: CGPoint(x: 19.4, y: 18.6),                                // c1 0 1.5-1.2.8-1.9
                      control1: CGPoint(x: 19.6, y: 20.5), control2: CGPoint(x: 20.1, y: 19.3))
        path.addLine(to: CGPoint(x: 15.6, y: 14.8))                                 // l-3.8-3.8
        path.addCurve(to: CGPoint(x: 14.4, y: 11.9),                                // c-.8-.8-1.2-1.8-1.2-2.9
                      control1: CGPoint(x: 14.8, y: 14), control2: CGPoint(x: 14.4, y: 13))
        path.addLine(to: CGPoint(x: 14.4, y: 5.3))                                  // V5.3
        path.addCurve(to: CGPoint(x: 12, y: 2.5),                                   // c0-1.6-.9-2.8-2.4-2.8
                      control1: CGPoint(x: 14.4, y: 3.7), control2: CGPoint(x: 13.5, y: 2.5))
        path.closeSubpath()                                                         // z
        return path
    }()

    /// `<rect x="7.5" y="6.5" width="9" height="15.5" rx="4.5"/>`,
    /// `<rect x="10.3" y="2.5" width="3.4" height="4.6" rx="1"/>` and the hose
    /// `<path d="M13.7 4.2h2.8a2.3 2.3 0 0 1 2.3 2.3V10" stroke-width="1.7"/>` with round ends.
    private static let tank: Path = {
        // SVG `rx` corners are circular arcs, not SwiftUI's default continuous corners.
        let cylinder = Path(roundedRect: CGRect(x: 7.5, y: 6.5, width: 9, height: 15.5), cornerRadius: 4.5, style: .circular)
        let valve = Path(roundedRect: CGRect(x: 10.3, y: 2.5, width: 3.4, height: 4.6), cornerRadius: 1, style: .circular)

        var hose = Path()
        hose.move(to: CGPoint(x: 13.7, y: 4.2))                                     // M13.7 4.2
        hose.addLine(to: CGPoint(x: 16.5, y: 4.2))                                  // h2.8
        // a2.3 2.3 0 0 1 2.3 2.3: the quarter circle about (16.5, 6.5) from its top to its right.
        // Angles grow clockwise on screen, so SwiftUI's `clockwise: false` draws this short way round.
        hose.addArc(center: CGPoint(x: 16.5, y: 6.5), radius: 2.3,
                    startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        hose.addLine(to: CGPoint(x: 18.8, y: 10))                                   // V10
        let hoseOutline = hose.strokedPath(StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))

        // The SVG fills each element on its own. As one path the hose's round end over the valve
        // winds the other way and would cut a notch there, so the parts are joined as a union.
        return cylinder.union(valve).union(hoseOutline)
    }()
}

/// A dive profile drawn small, with the surface at the top (spec C15). `points` are normalized:
/// x runs 0...1 across the dive and y 0...1 down a depth axis that reaches 1.1 × the deepest reading,
/// so the line never touches the bottom. `.line` is the profile; `.area` is the water above the
/// diver, from the surface down to the line. No axes or ticks.
struct MiniDepthProfile: Shape {
    enum Style {
        case line
        case area
    }

    var points: [CGPoint]
    var style: Style = .line

    static let depthHeadroom = 1.1

    /// Unreadable depths are skipped; a reading above the surface counts as the surface.
    static func normalizedPoints(depths: [Double]) -> [CGPoint] {
        let readable = depths.filter(\.isFinite).map { max(0, $0) }
        guard let deepest = readable.max() else { return [] }
        let axis = deepest > 0 ? deepest * depthHeadroom : 1
        let lastIndex = Double(max(readable.count - 1, 1))
        return readable.enumerated().map { index, depth in
            CGPoint(x: Double(index) / lastIndex, y: depth / axis)
        }
    }

    /// Where the deepest-point dot goes.
    static func deepestPoint(in points: [CGPoint]) -> CGPoint? {
        points.max { $0.y < $1.y }
    }

    /// A long profile cut into at most `maximumCount` stretches, each kept as its deepest readable
    /// depth, so a small drawing stays cheap and never loses a dive's bottom.
    static func thinnedDepths(_ depths: [Double], maximumCount: Int) -> [Double] {
        guard maximumCount > 0 else { return [] }
        guard depths.count > maximumCount else { return depths }
        return (0..<maximumCount).map { stretch in
            let start = stretch * depths.count / maximumCount
            let end = max((stretch + 1) * depths.count / maximumCount, start + 1)
            return depths[start..<end].filter(\.isFinite).max() ?? .nan
        }
    }

    func path(in rect: CGRect) -> Path {
        let mapped = points.map { point in
            CGPoint(x: rect.minX + point.x * rect.width, y: rect.minY + point.y * rect.height)
        }
        var path = Path()
        guard let first = mapped.first, let last = mapped.last else { return path }

        switch style {
        case .line:
            path.addLines(mapped)
        case .area:
            path.move(to: CGPoint(x: first.x, y: rect.minY))
            for point in mapped {
                path.addLine(to: point)
            }
            path.addLine(to: CGPoint(x: last.x, y: rect.minY))
            path.closeSubpath()
        }
        return path
    }
}

/// Remembers which saved logs have already drawn their profile in this launch, so a profile draws
/// itself only the first time it is shown (spec HM-SPARK).
@MainActor
final class DiveProfileDrawLog {
    static let shared = DiveProfileDrawLog()

    private var drawnIDs: Set<UUID> = []

    func hasDrawn(_ id: UUID) -> Bool {
        drawnIDs.contains(id)
    }

    /// True the first time it is asked for `id`; it then counts as drawn.
    func claimFirstDraw(_ id: UUID) -> Bool {
        drawnIDs.insert(id).inserted
    }
}

/// A saved dive's profile drawn small (spec C15): the water above the diver, the line and the
/// deepest point, with no axes. The first time a log's profile shows, the line draws itself, the
/// water fades in and the deepest point pops in (HM-SPARK); after that it is drawn at once. Reduce
/// Motion fades it in instead, and Always-On draws the line at half strength with no water.
struct DepthSparkline: View {
    let id: UUID
    let points: [CGPoint]
    var dotDiameter: CGFloat = 4

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var drawn: CGFloat
    @State private var showsDot: Bool

    init(id: UUID, points: [CGPoint], dotDiameter: CGFloat = 4) {
        self.id = id
        self.points = points
        self.dotDiameter = dotDiameter
        let alreadyDrawn = DiveProfileDrawLog.shared.hasDrawn(id)
        _drawn = State(initialValue: alreadyDrawn ? 1 : 0)
        _showsDot = State(initialValue: alreadyDrawn)
    }

    var body: some View {
        GeometryReader { proxy in
            // Reduce Motion fades the finished drawing in instead of tracing the line.
            let traced = reduceMotion ? 1 : drawn
            ZStack(alignment: .topLeading) {
                MiniDepthProfile(points: points, style: .area)
                    .fill(DiveWatchTheme.waterArea)
                    .opacity(isLuminanceReduced ? 0 : drawn)
                MiniDepthProfile(points: points)
                    .trim(from: 0, to: traced)
                    .stroke(Color.white.opacity(isLuminanceReduced ? 0.5 : 0.85),
                            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .opacity(reduceMotion ? drawn : 1)
                if let deepest = MiniDepthProfile.deepestPoint(in: points) {
                    Circle()
                        .fill(DiveWatchTheme.ink)
                        .frame(width: dotDiameter, height: dotDiameter)
                        .scaleEffect(showsDot || reduceMotion ? 1 : 0.6)
                        .opacity(showsDot ? 1 : 0)
                        .position(x: deepest.x * proxy.size.width, y: deepest.y * proxy.size.height)
                }
            }
        }
        .accessibilityHidden(true)
        .onAppear(perform: drawIfFirst)
    }

    private func drawIfFirst() {
        guard DiveProfileDrawLog.shared.claimFirstDraw(id) else { return }
        guard !isLuminanceReduced else {
            drawn = 1
            showsDot = true
            return
        }
        withAnimation(DiveMotion.animation(.profileDraw, reduceMotion: reduceMotion, alwaysOn: false)) {
            drawn = 1
        }
        // The deepest point lands once the line reaches it (spec: 300 ms snappy from 600 ms).
        let dot = reduceMotion
            ? DiveMotion.reducedMotionCurve.animation
            : Animation.snappy(duration: 0.3).delay(0.6)
        withAnimation(dot) {
            showsDot = true
        }
    }
}

// MARK: - Symbols

/// One icon by name: Divenary's own glyphs (spec C21: `divenary.freedive`, `divenary.scuba`,
/// `divenary.column`, `divenary.column.half`) or any SF Symbol, fitted to a square of `size`.
struct DiveSymbol: View {
    enum Kind: Equatable {
        case mode(DiveMode)
        case column(DepthColumnGlyph.Variant)
        case system(String)

        init(name: String) {
            switch name {
            case "divenary.freedive": self = .mode(.freedive)
            case "divenary.scuba": self = .mode(.scuba)
            case "divenary.column": self = .column(.empty)
            case "divenary.column.half": self = .column(.half)
            default: self = .system(name)
            }
        }
    }

    let name: String
    let size: CGFloat

    var body: some View {
        Group {
            switch Kind(name: name) {
            case let .mode(mode):
                DiveModeGlyph(mode: mode)
            case let .column(variant):
                DepthColumnGlyph(variant: variant)
            case let .system(systemName):
                Image(systemName: systemName)
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Previews

#if DEBUG
#Preview("Chips") {
    VStack(alignment: .leading, spacing: DiveSpacing.chipGap) {
        HStack(spacing: DiveSpacing.chipGap) {
            StatusChip(title: "다이빙 중", style: .diving)
            MarkerChip(title: "데모")
        }
        StatusChip(title: "수면 대기")
    }
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Hint chips") {
    VStack(spacing: 8) {
        RecordingHintChip(text: "동작 버튼 ▸ 상세 2/3", pageIndex: 0, pageCount: 3)
        RecordingHintChip(text: "동작 버튼 ▸ 기록 종료·저장", pageIndex: 2, pageCount: 3)
        RecordingHintChip(text: nil, pageIndex: 1, pageCount: 3)
        RecordingHintChip(text: "크라운 ▸ 수심 바꾸기")
    }
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Metric hero and rows") {
    VStack(alignment: .leading, spacing: DiveType.regular.slotSpacing) {
        MetricHero(value: "18.6", unit: "m")
        MetricHero(value: nil, unit: "m")
        MetricHero(value: "02:41", kind: .time, color: DiveWatchTheme.caution)
        ValueRows(rows: [
            ValueRow(label: "다이빙 시간", value: "24:18"),
            ValueRow(label: "상승", value: "6.0", unit: "m/min", style: .quiet, valueColor: DiveWatchTheme.ink2),
        ])
        ValueRows(rows: [
            ValueRow(label: "직전 다이빙 시간", value: "1:12", style: .stacked),
        ])
    }
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Compact type") {
    VStack(alignment: .leading) {
        MetricHero(value: "18.6", unit: "m")
        ValueRows(rows: [ValueRow(label: "최대", value: "22.4", unit: "m")])
        RecordingHintChip(text: "동작 버튼 ▸ 상세 2/3", pageIndex: 0, pageCount: 3)
    }
    .environment(\.diveType, DiveType(sizeClass: .compact, isTight: false))
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Glyphs") {
    HStack(spacing: 12) {
        GlyphDisc {
            DepthColumnGlyph(variant: .half)
                .frame(width: 22, height: 22)
        }
        GlyphDisc(diameter: 32, fill: DiveWatchTheme.action) {
            Image(systemName: "play.fill")
                .font(.system(size: 13, weight: .semibold))
        }
        DepthColumnGlyph()
            .foregroundStyle(DiveWatchTheme.ink2)
            .frame(width: 24, height: 24)
    }
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Logo mark") {
    VStack(spacing: 12) {
        LogoMark()
            .fill(DiveWatchTheme.ink3, style: LogoMark.fillStyle)
            .aspectRatio(LogoMark.aspectRatio, contentMode: .fit)
            .frame(width: 32)
        LogoMark()
            .fill(DiveWatchTheme.ink, style: LogoMark.fillStyle)
            .aspectRatio(LogoMark.aspectRatio, contentMode: .fit)
            .frame(width: 80)
    }
    .padding()
    .background(DiveWatchTheme.canvas)
}

#Preview("Mini depth profile") {
    let points = MiniDepthProfile.normalizedPoints(depths: [0, 4, 9, 14, 18.6, 17, 12, 6, 5, 5, 0])
    return GeometryReader { proxy in
        ZStack(alignment: .topLeading) {
            MiniDepthProfile(points: points, style: .area)
                .fill(DiveWatchTheme.waterArea)
            MiniDepthProfile(points: points)
                .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            if let deepest = MiniDepthProfile.deepestPoint(in: points) {
                Circle()
                    .fill(DiveWatchTheme.ink)
                    .frame(width: 4, height: 4)
                    .position(x: deepest.x * proxy.size.width, y: deepest.y * proxy.size.height)
            }
        }
    }
    .frame(height: 30)
    .padding()
    .background(DiveWatchTheme.canvas)
}
#endif
