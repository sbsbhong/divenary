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

enum DiveWatchTheme {
    static let background = Color(red: 0.0, green: 0.0, blue: 0.0)
    static let surfaceContainer = Color(red: 0.165, green: 0.165, blue: 0.173)
    static let surfaceRaised = Color(red: 0.145, green: 0.145, blue: 0.153)
    static let primary = Color(red: 0.161, green: 0.592, blue: 1.0)
    static let secondary = Color(red: 0.8, green: 0.8, blue: 0.8)
    static let danger = Color(red: 1.0, green: 0.42, blue: 0.38)
    /// Supplementary tone for recommended reminders; never used for mandatory states.
    static let caution = Color(red: 1.0, green: 0.78, blue: 0.3)
    static let text = Color.white
    static let mutedText = Color(red: 0.8, green: 0.8, blue: 0.8)

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

/// Press feedback for cards and rows that are not drawn as capsule buttons. A disabled card, such
/// as a real start card while the sensor check runs, is drawn dimmed.
struct DivePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PressableLabel(configuration: configuration)
    }

    private struct PressableLabel: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .opacity(isEnabled ? 1 : 0.7)
                .scaleEffect(configuration.isPressed ? 0.95 : 1)
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
