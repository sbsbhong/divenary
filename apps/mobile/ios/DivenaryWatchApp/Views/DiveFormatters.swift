import Foundation
import SwiftUI

enum DiveFormatters {
    static func freeDiveTimeCaption(depthMeters: Double?) -> String? {
        depthMeters == nil ? String(localized: "Session time") : nil
    }

    static func observedSurfaceInterval(_ seconds: TimeInterval, depthMeters: Double?) -> TimeInterval? {
        guard let depthMeters, depthMeters <= 0.8 else { return nil }
        return seconds
    }

    static let sessionDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    static func sessionAccessibilitySummary(_ session: DiveSessionRecord, summary: DiveSessionSummary) -> String {
        let date = sessionDate.string(from: session.startedAt)
        let depthText = depth(summary.maxDepthMeters)
        let time = duration(summary.durationSeconds)
        var parts = [session.diveMode.label, date,
                     String(localized: "Maximum depth: \(depthText)"),
                     String(localized: "Log time: \(time)"), session.syncStatus.label]
        if let marker = session.captureProvenanceLabel { parts.append(marker) }
        if let recovery = session.recoveryLabel { parts.append(recovery) }
        if session.exceedsSupportedDepth { parts.append(String(localized: "Outside watch support")) }
        return parts.joined(separator: ", ")
    }

    /// A date as a diver says it (spec C4, G2): "오늘 오전 10:02", "어제 오후 3:05", "내일 오전 9:00",
    /// otherwise "10월 19일 오전 9:30", with the year only when it is not this year.
    static func relativeDate(
        _ date: Date,
        now: Date = Date(),
        calendar: Calendar = .current,
        locale: Locale = .current
    ) -> String {
        let days = calendar.dateComponents(
            [.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)
        ).day ?? 0

        if (-1...1).contains(days) {
            let relative = DiveDateFormatterCache.relativeDayFormatter(calendar: calendar, locale: locale)
            let time = formatted(date, template: "jmm", calendar: calendar, locale: locale)
            return "\(relative.localizedString(from: DateComponents(day: days))) \(time)"
        }

        let sameYear = calendar.isDate(date, equalTo: now, toGranularity: .year)
        return formatted(date, template: sameYear ? "MMMdjmm" : "yMMMdjmm", calendar: calendar, locale: locale)
    }

    /// A dive's length at a glance on the Home card: whole hours and minutes ("48분", "1시간 5분"), or
    /// seconds under a minute ("40초").
    static func cardDuration(_ seconds: TimeInterval, locale: Locale = .current) -> String {
        let wholeSeconds = max(0, Int(seconds.isFinite ? seconds : 0))
        guard wholeSeconds >= 60 else {
            return Duration.seconds(wholeSeconds)
                .formatted(.units(allowed: [.seconds], width: .abbreviated).locale(locale))
        }
        return Duration.seconds(wholeSeconds / 60 * 60)
            .formatted(.units(allowed: [.hours, .minutes], width: .abbreviated).locale(locale))
    }

    /// A saved dive's length in whole units, as the summary and detail show it (spec G2): "42분 10초",
    /// "3분", "0초". An unknown length shows dashes.
    static func savedDuration(_ seconds: TimeInterval?, locale: Locale = .current) -> String {
        guard let seconds, seconds.isFinite else { return "--" }
        return Duration.seconds(max(0, Int(seconds.rounded())))
            .formatted(.units(allowed: [.hours, .minutes, .seconds], width: .abbreviated).locale(locale))
    }

    /// The saved detail's title (spec G2): "10월 22일", with the year only when it is not this year.
    static func dayTitle(
        _ date: Date,
        now: Date = Date(),
        calendar: Calendar = .current,
        locale: Locale = .current
    ) -> String {
        let sameYear = calendar.isDate(date, equalTo: now, toGranularity: .year)
        return formatted(date, template: sameYear ? "MMMd" : "yMMMd", calendar: calendar, locale: locale)
    }

    /// A clock time without the date: "오전 10:02".
    static func timeOfDay(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        formatted(date, template: "jmm", calendar: calendar, locale: locale)
    }

    /// How many of the five stars a rating fills; `nil` when the dive is not rated.
    static func filledStars(_ rating: Int?) -> Int? {
        rating.map { max(1, min(5, $0)) }
    }

    private static func formatted(_ date: Date, template: String, calendar: Calendar, locale: Locale) -> String {
        DiveDateFormatterCache.dateFormatter(template: template, calendar: calendar, locale: locale).string(from: date)
    }

    static func profileAccessibilitySummary(samples: [DepthSample]) -> String {
        let depths = samples.map(\.depthMeters).filter { $0.isFinite && $0 >= 0 }
        guard let minimum = depths.min(), let maximum = depths.max() else {
            return String(localized: "Depth chart: --")
        }
        return String(localized: "Depth chart: \(depth(minimum)) to \(depth(maximum))")
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let totalSeconds = max(0, Int(seconds.rounded()))
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }

        return String(format: "%02d:%02d", minutes, seconds)
    }

    /// `nil` means the time is unknown, so no number is shown.
    static func duration(_ seconds: TimeInterval?) -> String {
        guard let seconds else { return "--:--" }
        return duration(seconds)
    }

    /// Minutes and seconds without a leading zero, for short countdowns such as "2:05".
    static func countdown(seconds: Int) -> String {
        let clamped = max(0, seconds)
        return String(format: "%d:%02d", clamped / 60, clamped % 60)
    }

    static func depth(_ meters: Double) -> String {
        String(format: "%.1f m", meters)
    }

    /// `nil` means the reading is not current, so no number is shown.
    static func depth(_ meters: Double?) -> String {
        guard let meters else { return "--.- m" }
        return depth(meters)
    }

    /// The number part of `depth(_:)`, for layouts that draw the unit as its own smaller text.
    static func depthValue(_ meters: Double?) -> String {
        guard let meters else { return "--.-" }
        return String(format: "%.1f", meters)
    }

    static func temperature(_ celsius: Double?) -> String {
        guard let celsius else { return "--.- °C" }
        return String(format: "%.1f °C", celsius)
    }

    static func ascentRate(_ metersPerMinute: Double) -> String {
        String(format: "%.1f m/min", max(0, metersPerMinute))
    }

    static func ascentRate(_ metersPerMinute: Double?) -> String {
        guard let metersPerMinute else { return "--.- m/min" }
        return ascentRate(metersPerMinute)
    }
}

/// Date formatters are costly to make, and the Home card, plan rows and saved list format a date on
/// every update, so each one is made once per pattern, language, calendar and time zone and then
/// reused. A change of language or time zone gets a new formatter. `NSCache` is safe to share.
private enum DiveDateFormatterCache {
    private static let dateFormatters = NSCache<NSString, DateFormatter>()
    private static let relativeDayFormatters = NSCache<NSString, RelativeDateTimeFormatter>()

    static func dateFormatter(template: String, calendar: Calendar, locale: Locale) -> DateFormatter {
        let key = cacheKey(template, calendar: calendar, locale: locale)
        if let formatter = dateFormatters.object(forKey: key) { return formatter }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        dateFormatters.setObject(formatter, forKey: key)
        return formatter
    }

    /// "오늘", "어제", "내일" at the start of a line.
    static func relativeDayFormatter(calendar: Calendar, locale: Locale) -> RelativeDateTimeFormatter {
        let key = cacheKey("relativeDay", calendar: calendar, locale: locale)
        if let formatter = relativeDayFormatters.object(forKey: key) { return formatter }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.dateTimeStyle = .named
        formatter.formattingContext = .beginningOfSentence
        relativeDayFormatters.setObject(formatter, forKey: key)
        return formatter
    }

    private static func cacheKey(_ pattern: String, calendar: Calendar, locale: Locale) -> NSString {
        "\(pattern)|\(locale.identifier)|\(calendar.identifier)|\(calendar.timeZone.identifier)" as NSString
    }
}

/// An sRGB colour as plain numbers (0...1), so colour arithmetic such as the depth-anchored water
/// gradient can be computed and tested without resolving a SwiftUI `Color`.
struct DiveRGB: Equatable {
    let red: Double
    let green: Double
    let blue: Double

    init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    /// `0x2F7FD1` style hex, as written in the design spec.
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    var color: Color {
        Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
    }

    /// Straight sRGB mix: 0 keeps this colour, 1 gives `other`.
    func mixed(with other: DiveRGB, fraction: Double) -> DiveRGB {
        let t = fraction.isFinite ? min(max(fraction, 0), 1) : 0
        return DiveRGB(
            red: red + (other.red - red) * t,
            green: green + (other.green - green) * t,
            blue: blue + (other.blue - blue) * t
        )
    }
}

/// A gauge water colour pinned to an absolute depth, so the fill's colour tells depth (DECISIONS D1).
struct WaterColorAnchor: Equatable {
    let depthMeters: Double
    let rgb: DiveRGB
}

/// The Plumb palette (spec B1): black water, white data, grey labels, navy water column, blue for
/// press and selection, amber for the recommended stop. Red only for real failures; never green.
enum DiveWatchTheme {
    static let canvas = Color(red: 0.0, green: 0.0, blue: 0.0)
    /// Pressable surfaces: start cards, rows, the recent card, secondary buttons, banners.
    static let platter = DiveRGB(hex: 0x262628).color
    /// Status and hint chips and the empty gauge track; darker than a platter so it never looks pressable.
    static let chip = DiveRGB(hex: 0x1C1C1E).color
    /// Demo/Test marker chip, start-card glyph disc, disabled play disc.
    static let marker = DiveRGB(hex: 0x3A3A3C).color
    static let ink = Color.white
    /// Labels, units, chip and hint text, tick labels.
    static let ink2 = DiveRGB(hex: 0xAEAEB2).color
    /// Fine print, the non-certified sentence, "--" placeholders, "(n)" counters.
    static let ink3 = DiveRGB(hex: 0x8E8E93).color
    /// Inactive page dots, empty stars, the unselected plan circle.
    static let dotOff = DiveRGB(hex: 0x5A5A5E).color
    /// Gauge tick hairlines only.
    static let hairline = Color.white.opacity(0.18)
    /// Only for press or selection, and the "Diving" chip text.
    static let action = DiveRGB(hex: 0x2997FF).color
    /// Selected plan row fill.
    static let actionFill = action.opacity(0.30)
    /// Depth fills only, never text or controls.
    static let water = DiveRGB(hex: 0x1F5A99).color
    /// Profile and sparkline area.
    static let waterArea = water.opacity(0.60)
    /// Gauge water colour by absolute depth: 0 m, 10 m, 40 m (DECISIONS D1).
    static let waterStops: [WaterColorAnchor] = [
        WaterColorAnchor(depthMeters: 0, rgb: DiveRGB(hex: 0x2F7FD1)),
        WaterColorAnchor(depthMeters: 10, rgb: DiveRGB(hex: 0x1F5A99)),
        WaterColorAnchor(depthMeters: 40, rgb: DiveRGB(hex: 0x0B2547)),
    ]
    /// Supplementary tone for recommended reminders; never used for mandatory states.
    static let caution = DiveRGB(hex: 0xFFC74D).color
    /// Stop-zone band fill.
    static let cautionFill = caution.opacity(0.18)
    /// Stop-zone top and bottom edge lines.
    static let cautionLine = caution.opacity(0.60)
    /// A recommended-stop minute index that has not finished yet.
    static let cautionDim = caution.opacity(0.25)
    /// Real failures: save, send, read and start errors, and the pinned storage footer.
    static let danger = DiveRGB(hex: 0xFF6B61).color
    /// Outline around the white depth index.
    static let keyline = Color.black
    /// Toolbar circles only (emulates Liquid Glass; flat platter on older watchOS).
    static let glass = Color.white.opacity(0.14)
    /// Always-On gauge outline.
    static let aodStroke = Color.white.opacity(0.50)

    // Earlier names, kept so every screen compiles until it moves to the Plumb names.
    static let background = canvas
    static let surfaceContainer = platter
    static let surfaceRaised = chip
    static let primary = action
    static let secondary = ink2
    static let text = ink
    static let mutedText = ink2

    static let edgeMargin: CGFloat = 8
    static let cardRadius: CGFloat = 8

    static var safetyDisclaimer: String {
        String(localized: "RECREATIONAL USE ONLY. NON-CERTIFIED ASSISTANT.")
    }

    /// Rounded digits of equal width, so live values do not shift as they change.
    static func metricFont(size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }

    static func labelFont() -> Font {
        .system(.caption2, design: .default, weight: .semibold)
    }
}

extension SafetyStopStatus {
    /// Saved-log tint. A recommended stop that paused or was not finished is caution amber, never
    /// the danger red; a finished one is quiet grey. Blue stays for actions and selection.
    var reviewTint: Color {
        switch self {
        case .pausedTooDeep, .pausedTooShallow, .skippedOrIncomplete:
            return DiveWatchTheme.caution
        case .completed:
            return DiveWatchTheme.secondary
        case .unknown, .notRequired, .armed, .active:
            return DiveWatchTheme.mutedText
        }
    }
}

/// One stacked stat (spec C20): a grey label over a white value whose units draw small and grey.
/// No platter; stats sit in a two-column flow on the summary and detail. A value of words, such as a
/// status or a dive site, draws in `wordRole`. Label and value read as one element.
struct SummaryRow: View {
    let title: String
    let value: String
    var accent: Color?
    var wordRole: DiveUIType.Role = .statValue

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            DiveValueText(value: value, wordRole: wordRole, color: accent ?? DiveWatchTheme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Marks a saved dive that went deeper than the app supports on Apple Watch (spec C16): the caution
/// triangle with "지원 수심 밖", then what it means, without a platter.
struct UnsupportedDepthNotice: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(DiveWatchTheme.caution)
                Text(String(localized: "Outside watch support"))
                    .foregroundStyle(DiveWatchTheme.ink)
            }
            .diveFont(.footnoteEmphasis)

            Text(String(localized: "Deeper than this app supports on Apple Watch. Kept for review only."))
                .diveFont(.footnote)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct StatusPill: View {
    enum Style {
        case tinted
        /// The Demo/Test marker (spec C5): the brighter `MarkerChip`, so a practice log never reads
        /// as a real one.
        case marker
    }

    let title: String
    var color: Color = DiveWatchTheme.primary
    var style: Style = .tinted

    var body: some View {
        switch style {
        case .marker:
            MarkerChip(title: title)
        case .tinted:
            tintedPill
        }
    }

    private var tintedPill: some View {
        Text(title)
            .font(DiveWatchTheme.labelFont())
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .minimumScaleFactor(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(color.opacity(0.16))
            )
    }
}

/// The non-certified sentence (spec C17): fine print in the flow, leading-aligned, never white and
/// never larger than the instructions around it.
struct DiveDisclaimer: View {
    var text = DiveWatchTheme.safetyDisclaimer

    var body: some View {
        Text(text)
            .diveFont(.footnote)
            .foregroundStyle(DiveWatchTheme.ink3)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum DiveActionButtonKind {
    case primary
    case secondary
}

/// Capsule buttons (spec C12): full width, 47 pt tall on Ultra and 44 pt on smaller watches, a
/// white 600 label. Primary is the action blue; secondary is a platter with a white label, since a
/// blue label would read as a link. There is no destructive style on the watch. Pressed: scale 0.95,
/// or a dim under Reduce Motion; disabled: 45%.
struct DiveActionButtonStyle: ButtonStyle {
    var kind: DiveActionButtonKind = .primary

    func makeBody(configuration: Configuration) -> some View {
        DiveActionButtonLabel(configuration: configuration, kind: kind)
    }
}

private struct DiveActionButtonLabel: View {
    let configuration: ButtonStyleConfiguration
    let kind: DiveActionButtonKind

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @ScaledMetric(relativeTo: .headline) private var labelSize: CGFloat = 16
    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        configuration.label
            .font(.system(size: labelSize, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(DiveWatchTheme.ink)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: PostDiveLayout.buttonHeight(sizeClass))
            .background(
                Capsule()
                    .fill(kind == .primary ? DiveWatchTheme.action : DiveWatchTheme.platter)
            )
            .contentShape(Capsule())
            .opacity((isEnabled ? 1 : 0.45) * (reduceMotion && configuration.isPressed ? 0.7 : 1))
            .scaleEffect(!reduceMotion && configuration.isPressed ? 0.95 : 1)
            .animation(DiveMotion.press(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced),
                       value: configuration.isPressed)
    }
}
