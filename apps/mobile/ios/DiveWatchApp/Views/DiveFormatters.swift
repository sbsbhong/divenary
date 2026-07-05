import Foundation
import SwiftUI

enum DiveFormatters {
    static let sessionDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

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

    static func depth(_ meters: Double) -> String {
        String(format: "%.1f m", meters)
    }

    static func temperature(_ celsius: Double?) -> String {
        guard let celsius else { return "--.- °C" }
        return String(format: "%.1f °C", celsius)
    }

    static func ascentRate(_ metersPerMinute: Double) -> String {
        String(format: "%.1f m/min", max(0, metersPerMinute))
    }

    static func rating(_ value: Int?) -> String {
        guard let value else { return String(localized: "Not rated") }
        return String(repeating: "★", count: max(1, min(5, value)))
    }
}

enum DiveWatchTheme {
    static let background = Color(red: 0.0, green: 0.0, blue: 0.0)
    static let surface = Color(red: 0.153, green: 0.153, blue: 0.161)
    static let surfaceContainer = Color(red: 0.165, green: 0.165, blue: 0.173)
    static let surfaceRaised = Color(red: 0.145, green: 0.145, blue: 0.153)
    static let primary = Color(red: 0.161, green: 0.592, blue: 1.0)
    static let secondary = Color(red: 0.8, green: 0.8, blue: 0.8)
    static let danger = Color(red: 1.0, green: 0.42, blue: 0.38)
    static let text = Color.white
    static let mutedText = Color(red: 0.8, green: 0.8, blue: 0.8)

    static let edgeMargin: CGFloat = 8
    static let cardRadius: CGFloat = 8

    static var safetyDisclaimer: String {
        String(localized: "RECREATIONAL USE ONLY. NON-CERTIFIED ASSISTANT.")
    }

    static func metricFont(size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func labelFont() -> Font {
        .system(size: 11, weight: .semibold, design: .default)
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

    var body: some View {
        InstrumentCard(accent: prominent ? accent : nil) {
            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                Text(title.uppercased())
                    .font(DiveWatchTheme.labelFont())
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Text(value)
                    .font(DiveWatchTheme.metricFont(size: metricSize, weight: .semibold))
                    .foregroundStyle(prominent ? accent : DiveWatchTheme.text)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.45)

                if let footnote {
                    Text(footnote)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                }
            }
        }
    }

    private var metricSize: CGFloat {
        if prominent { return 34 }
        if compact { return 18 }
        return 23
    }
}

struct SummaryRow: View {
    let title: String
    let value: String
    var accent: Color?

    var body: some View {
        HStack(spacing: 8) {
            Text(title.uppercased())
                .font(DiveWatchTheme.labelFont())
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Spacer(minLength: 4)

            Text(value)
                .font(DiveWatchTheme.metricFont(size: 14, weight: .semibold))
                .foregroundStyle(accent ?? DiveWatchTheme.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }
}

struct StatusPill: View {
    let title: String
    var color: Color = DiveWatchTheme.primary

    var body: some View {
        Text(title.uppercased())
            .font(DiveWatchTheme.labelFont())
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(color.opacity(0.16))
            )
    }
}

struct DiveDisclaimer: View {
    var text = DiveWatchTheme.safetyDisclaimer

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.82))
            .multilineTextAlignment(.center)
            .lineLimit(3)
            .minimumScaleFactor(0.72)
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

struct SafetyStopRing: View {
    let remainingSeconds: TimeInterval
    let progress: Double
    let active: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(DiveWatchTheme.surfaceRaised, lineWidth: 7)

            Circle()
                .trim(from: 0, to: clampedProgress)
                .stroke(
                    active ? DiveWatchTheme.primary : DiveWatchTheme.primary.opacity(0.55),
                    style: StrokeStyle(lineWidth: 7, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))

            VStack(spacing: 1) {
                Text(ringValue)
                    .font(DiveWatchTheme.metricFont(size: 20, weight: .semibold))
                    .foregroundStyle(active ? DiveWatchTheme.primary : DiveWatchTheme.text)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)

                Text(ringLabel)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .lineLimit(1)
            }
        }
        .frame(width: 74, height: 74)
        .accessibilityLabel(Text("Safety stop planning reminder"))
    }

    private var clampedProgress: Double {
        min(1, max(0, progress))
    }

    private var ringValue: String {
        if remainingSeconds <= 0 { return String(localized: "DONE") }
        return DiveFormatters.duration(remainingSeconds)
    }

    private var ringLabel: String {
        active ? String(localized: "STOP") : String(localized: "ASSIST")
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
