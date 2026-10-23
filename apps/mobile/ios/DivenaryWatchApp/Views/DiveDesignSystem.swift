import SwiftUI

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
        case switchTitle
        case note
        case waterLock
        case stopState
    }

    /// Readouts at least this tall (Ultra 49mm class) use the regular sizes.
    static let regularReadoutMinimumHeight: CGFloat = 170
    static let regular = DiveType(sizeClass: .regular, isTight: false)

    let sizeClass: SizeClass
    let isTight: Bool

    init(sizeClass: SizeClass, isTight: Bool) {
        self.sizeClass = sizeClass
        self.isTight = isTight
    }

    init(readoutHeight: CGFloat, showsStorageError: Bool) {
        sizeClass = readoutHeight >= Self.regularReadoutMinimumHeight ? .regular : .compact
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
        case .heroUnit, .rowUnit, .stackedValue, .quietValue, .quietUnit, .switchTitle:
            return 0
        }
    }

    static func weight(_ role: Role) -> Font.Weight {
        switch role {
        case .rowLabel, .quietValue, .quietUnit, .note, .waterLock:
            return .regular
        case .heroDepth, .heroTime, .heroUnit, .caption, .rowValue, .rowUnit, .stackedValue, .chip, .hint,
             .tick, .endInstruction, .switchTitle, .stopState:
            return .semibold
        }
    }

    /// Numbers use rounded digits of equal width so live values never shift as they change.
    static func usesMetricDigits(_ role: Role) -> Bool {
        switch role {
        case .heroDepth, .heroTime, .heroUnit, .rowValue, .rowUnit, .stackedValue, .quietValue, .quietUnit, .tick:
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

// MARK: - Motion

/// Motion rules (spec D, DECISIONS D12–D14, D18). Underwater, automatic changes only cross-fade;
/// only a diver's own page change moves, plus the one adopted exception: the recommended-stop range
/// change interpolates once over 600 ms. Bounce and overshoot belong on land. Reduce Motion turns
/// every move into a 200 ms fade, and Always-On turns animation off.
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

        fileprivate var curve: Curve {
            switch self {
            case .press: return .snappy(duration: 0.25)
            case .diverPage: return .smooth(duration: 0.35)
            case .autoFade: return .easeInOut(duration: 0.45)
            case .chip: return .easeInOut(duration: 0.35)
            case .rangeChange: return .smooth(duration: 0.6)
            case .finale: return .smooth(duration: 0.5)
            }
        }

        fileprivate var moves: Bool {
            switch self {
            case .press, .diverPage, .rangeChange, .finale: return true
            case .autoFade, .chip: return false
            }
        }
    }

    enum Curve: Equatable {
        case snappy(duration: Double)
        case smooth(duration: Double)
        case easeInOut(duration: Double)

        var duration: Double {
            switch self {
            case let .snappy(duration), let .smooth(duration), let .easeInOut(duration):
                return duration
            }
        }

        var animation: Animation {
            switch self {
            case let .snappy(duration): return .snappy(duration: duration)
            case let .smooth(duration): return .smooth(duration: duration)
            case let .easeInOut(duration): return .easeInOut(duration: duration)
            }
        }
    }

    /// How far a page travels when the diver pages (spec 12 px).
    static let pageOffset: CGFloat = 6
    static let reducedMotionCurve = Curve.easeInOut(duration: 0.2)

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

    /// The diver's page change: the new page rises into place and the old one leaves upward; paging
    /// back reverses the direction. Under Reduce Motion it is a plain fade.
    static func pageTransition(forward: Bool = true, reduceMotion: Bool) -> AnyTransition {
        guard !reduceMotion else { return .opacity }
        let offset = forward ? pageOffset : -pageOffset
        return .asymmetric(
            insertion: .opacity.combined(with: .offset(y: offset)),
            removal: .opacity.combined(with: .offset(y: -offset))
        )
    }
}

/// Press feedback for cards, rows and tiles that are not drawn as capsule buttons: scale 0.95 with a
/// snappy settle, or a dim to 70% under Reduce Motion. Land surfaces only; recording pages have no
/// touch targets. A disabled card, such as a real start card while the sensor check runs, is dimmed.
struct DivePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PressableLabel(configuration: configuration)
    }

    private struct PressableLabel: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.isLuminanceReduced) private var isLuminanceReduced

        var body: some View {
            configuration.label
                .opacity((isEnabled ? 1 : 0.7) * (reduceMotion && configuration.isPressed ? 0.7 : 1))
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

/// The hint chip at the bottom of a real recording (spec C6): vertical page dots at the leading edge,
/// matching watchOS vertical paging, then one hint line. `pageCount` 0 draws no dots (demo, summary);
/// a `nil` text draws dots only. It has no tap target. Always-On hides the dots and dims the text.
struct RecordingHintChip: View {
    var text: String?
    var pageIndex = 0
    var pageCount = 0
    /// A rejected press shows its note in white for a moment.
    var isEmphasized = false

    @Environment(\.diveType) private var type
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private var showsDots: Bool { pageCount > 0 && !isLuminanceReduced }
    private var isRegular: Bool { type.sizeClass == .regular }

    var body: some View {
        HStack(spacing: isRegular ? 6 : 5) {
            if showsDots {
                HintPageDots(index: pageIndex, count: pageCount)
            }

            if let text {
                Text(text)
                    .font(type.font(.hint))
                    .tracking(type.tracking(.hint))
                    .foregroundStyle(isEmphasized ? DiveWatchTheme.ink : DiveWatchTheme.ink2)
                    .opacity(isLuminanceReduced ? 0.75 : 1)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(.leading, isRegular ? 8 : 7)
        .padding(.trailing, text == nil ? (isRegular ? 8 : 7) : (isRegular ? 9 : 8))
        .frame(minHeight: DiveSpacing.hintChipHeight(type.sizeClass))
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.hintChip, style: .continuous)
                .fill(DiveWatchTheme.chip)
        )
        .frame(maxWidth: DiveSpacing.hintChipMaxWidth(type.sizeClass))
        .accessibilityElement(children: .combine)
    }
}

/// 4 pt dots on a 6 pt pitch, stacked vertically; the current page is white. The hint text carries
/// the same position for VoiceOver.
private struct HintPageDots: View {
    let index: Int
    let count: Int

    var body: some View {
        VStack(spacing: DiveSpacing.pageDotPitch - DiveSpacing.pageDot) {
            ForEach(0..<max(count, 1), id: \.self) { dot in
                Circle()
                    .fill(dot == index ? DiveWatchTheme.ink : DiveWatchTheme.dotOff)
                    .frame(width: DiveSpacing.pageDot, height: DiveSpacing.pageDot)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Values

/// The one large white number of a recording page (spec C9): the value and its unit as separate
/// texts on a shared baseline. An unknown value draws grey dashes, never a stale number, and digits
/// change in place without rolling. Always-On keeps the number white and greys the unit.
struct MetricHero: View {
    enum Kind {
        case depth
        case time
    }

    let value: String?
    let unit: String
    var kind: Kind = .depth
    var color: Color = DiveWatchTheme.ink

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

            Text(unit)
                .font(type.font(.heroUnit))
                .foregroundStyle(value == nil || isLuminanceReduced ? DiveWatchTheme.ink3 : DiveWatchTheme.ink2)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    private var numberColor: Color {
        if value == nil { return DiveWatchTheme.ink3 }
        return isLuminanceReduced ? DiveWatchTheme.ink : color
    }
}

/// One secondary value row under the hero (spec C10).
struct ValueRow: Identifiable {
    enum Style {
        /// Label, then the value and unit on the same line.
        case inline
        /// A smaller regular-weight value: ascent, the stop page's dive time, previous depth.
        case quiet
        /// Label on its own line above the value, for labels too long to share a line.
        case stacked
    }

    let label: String
    let value: String?
    var unit: String?
    var style: Style = .inline
    var valueColor: Color = DiveWatchTheme.ink
    var placeholder = "--.-"

    var id: String { label }
}

/// Up to two secondary rows. Inline and quiet rows share one grid, so their values start on the same
/// edge; a stacked row spans the grid.
struct ValueRows: View {
    let rows: [ValueRow]

    @Environment(\.diveType) private var type

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline,
             horizontalSpacing: DiveSpacing.valueColumnGap(type.sizeClass),
             verticalSpacing: DiveSpacing.rowGap) {
            ForEach(rows) { row in
                switch row.style {
                case .inline, .quiet:
                    GridRow {
                        label(row)
                        value(row)
                    }
                case .stacked:
                    VStack(alignment: .leading, spacing: 0) {
                        label(row)
                        value(row)
                    }
                }
            }
        }
    }

    private func label(_ row: ValueRow) -> some View {
        Text(row.label)
            .font(type.font(.rowLabel))
            .tracking(type.tracking(.rowLabel))
            .foregroundStyle(DiveWatchTheme.ink2)
            .lineLimit(1)
    }

    private func value(_ row: ValueRow) -> some View {
        let roles: (value: DiveType.Role, unit: DiveType.Role) = switch row.style {
        case .inline: (.rowValue, .rowUnit)
        case .quiet: (.quietValue, .quietUnit)
        case .stacked: (.stackedValue, .rowUnit)
        }

        return HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(row.value ?? row.placeholder)
                .font(type.font(roles.value))
                .tracking(type.tracking(roles.value))
                .foregroundStyle(row.value == nil ? DiveWatchTheme.ink3 : row.valueColor)
                .contentTransition(.identity)

            if let unit = row.unit {
                Text(unit)
                    .font(type.font(roles.unit))
                    .foregroundStyle(row.value == nil ? DiveWatchTheme.ink3 : DiveWatchTheme.ink2)
            }
        }
        .lineLimit(1)
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
        MetricHero(value: "02:41", unit: "", kind: .time, color: DiveWatchTheme.caution)
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
