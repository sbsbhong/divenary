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

    static func rating(_ value: Int?) -> String {
        guard let value else { return String(localized: "Not rated") }
        return String(repeating: "★", count: max(1, min(5, value)))
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

struct InstrumentCard<Content: View>: View {
    var accent: Color?
    var content: Content

    init(accent: Color? = nil, @ViewBuilder content: () -> Content) {
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                    .fill(DiveWatchTheme.surfaceContainer)
            )
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    var footnote: String?
    var accent: Color = DiveWatchTheme.primary
    var prominent = false
    var compact = false

    @ScaledMetric(relativeTo: .title2) private var reviewMetricSize: CGFloat = 24

    var body: some View {
        InstrumentCard(accent: prominent ? accent : nil) {
            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                Text(title.uppercased())
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)

                Text(value)
                    .font(DiveWatchTheme.metricFont(size: reviewMetricSize, weight: .semibold))
                    .foregroundStyle(prominent ? accent : DiveWatchTheme.text)
                    .monospacedDigit()
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)

                if let footnote {
                    Text(footnote)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct SummaryRow: View {
    let title: String
    let value: String
    var accent: Color?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.mutedText)
                .fixedSize(horizontal: false, vertical: true)
                .minimumScaleFactor(1)

            Text(value)
                .font(.system(.body, design: .rounded, weight: .semibold).monospacedDigit())
                .foregroundStyle(accent ?? DiveWatchTheme.text)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .minimumScaleFactor(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Marks a saved dive that went deeper than the app supports on Apple Watch.
struct UnsupportedDepthNotice: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Outside watch support", systemImage: "exclamationmark.triangle.fill")
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.caution)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text("Deeper than this app supports on Apple Watch. Kept for review only.")
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(3)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct StatusPill: View {
    let title: String
    var color: Color = DiveWatchTheme.primary

    var body: some View {
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

struct DiveDisclaimer: View {
    var text = DiveWatchTheme.safetyDisclaimer

    var body: some View {
        Text(text)
            .font(.system(.caption2, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.mutedText)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .minimumScaleFactor(1)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 4)
    }
}

enum DiveActionButtonKind {
    case primary
    case secondary
    case destructive
}

struct DiveActionButtonStyle: ButtonStyle {
    var kind: DiveActionButtonKind = .primary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .regular))
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(foregroundColor)
            .background(
                Capsule()
                    .fill(fillColor)
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }

    private var fillColor: Color {
        switch kind {
        case .primary:
            return DiveWatchTheme.primary
        case .secondary:
            return DiveWatchTheme.surfaceContainer
        case .destructive:
            return DiveWatchTheme.danger.opacity(0.18)
        }
    }

    private var foregroundColor: Color {
        switch kind {
        case .primary:
            return Color.white
        case .secondary:
            return DiveWatchTheme.primary
        case .destructive:
            return DiveWatchTheme.danger
        }
    }
}

struct DepthProfileSparkline: View {
    let samples: [DepthSample]
    var color: Color = DiveWatchTheme.primary

    var body: some View {
        GeometryReader { proxy in
            let points = profilePoints(in: proxy.size)

            ZStack {
                RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                    .fill(DiveWatchTheme.surfaceRaised.opacity(0.76))

                Path { path in
                    guard let first = points.first else { return }
                    path.move(to: first)
                    for point in points.dropFirst() {
                        path.addLine(to: point)
                    }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                Path { path in
                    guard let first = points.first, let last = points.last else { return }
                    path.move(to: CGPoint(x: first.x, y: proxy.size.height))
                    for point in points {
                        path.addLine(to: point)
                    }
                    path.addLine(to: CGPoint(x: last.x, y: proxy.size.height))
                    path.closeSubpath()
                }
                .fill(color.opacity(0.14))
            }
        }
        .frame(minHeight: 34)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DiveFormatters.profileAccessibilitySummary(samples: samples))
    }

    private func profilePoints(in size: CGSize) -> [CGPoint] {
        let depths = samples.map(\.depthMeters)
        guard !depths.isEmpty else {
            return [
                CGPoint(x: 0, y: size.height * 0.68),
                CGPoint(x: size.width, y: size.height * 0.68),
            ]
        }

        let maxDepth = max(depths.max() ?? 1, 1)
        let denominator = max(depths.count - 1, 1)

        return depths.enumerated().map { index, depth in
            let x = size.width * CGFloat(index) / CGFloat(denominator)
            let y = size.height * CGFloat(depth / maxDepth)
            return CGPoint(x: x, y: max(2, min(size.height - 2, y)))
        }
    }
}
