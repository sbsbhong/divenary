import SwiftUI

/// The left depth rail of every recording page. It is kept narrow so the live value beside it can
/// stay large; tick labels sit inside the same width. Always-On draws it as an outline.
struct DepthGaugeRail: View {
    static let layoutWidth: CGFloat = 46

    let depthMeters: Double?
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private let railX: CGFloat = 26
    private let railWidth: CGFloat = 16

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { proxy in
                let height = proxy.size.height

                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isLuminanceReduced ? AnyShapeStyle(Color.clear) : AnyShapeStyle(deepBlueGradient))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(Color.white.opacity(isLuminanceReduced ? 0.5 : 0.18), lineWidth: 1)
                    )
                    .frame(width: railWidth, height: height)
                    .position(x: railX + railWidth / 2, y: height / 2)

                if let stopZone {
                    stopZoneBox(stopZone, height: height)
                }

                if let targetDepthMeters {
                    targetLine(at: targetDepthMeters, height: height)
                }

                ForEach(tickValues, id: \.self) { tick in
                    tickMark(for: tick, height: height)
                }

                if let depthMeters {
                    currentDepthMarker(depthMeters: depthMeters, height: height)
                }
            }
        }
        .frame(width: Self.layoutWidth)
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Depth gauge"))
        .accessibilityValue(Text(depthMeters.map(DiveFormatters.depth) ?? String(localized: "Depth unavailable")))
    }

    private var deepBlueGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.05, green: 0.48, blue: 0.86),
                Color(red: 0.02, green: 0.22, blue: 0.52),
                Color(red: 0.01, green: 0.06, blue: 0.19),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var scaleUpperBound: Double {
        guard maxScaleMeters.isFinite else { return 1 }
        return max(maxScaleMeters, 1)
    }

    private var tickValues: [Double] {
        let baseTicks: [Double]
        if scaleUpperBound <= 12 {
            baseTicks = [0, 3, 5, 6, scaleUpperBound]
        } else {
            baseTicks = [0, 10, 20, scaleUpperBound]
        }

        return Array(Set(baseTicks.map(sanitizedDepth))).sorted()
    }

    private func yPosition(for depth: Double, height: CGFloat) -> CGFloat {
        let clampedDepth = sanitizedDepth(depth)
        let position = CGFloat(clampedDepth / scaleUpperBound) * height
        return min(max(position, 6), height - 6)
    }

    private func tickMark(for depth: Double, height: CGFloat) -> some View {
        let y = yPosition(for: depth, height: height)

        return HStack(spacing: 2) {
            Text(tickLabel(for: depth))
                .font(DiveWatchTheme.metricFont(size: 9, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: 16, alignment: .trailing)

            Rectangle()
                .fill(Color.white.opacity(0.55))
                .frame(width: 5, height: 1.4)
        }
        .position(x: 11.5, y: y)
    }

    private func tickLabel(for depth: Double) -> String {
        "\(Int(sanitizedDepth(depth).rounded()))"
    }

    private func stopZoneBox(_ zone: ClosedRange<Double>, height: CGFloat) -> some View {
        let visibleRange = (
            lower: sanitizedDepth(zone.lowerBound),
            upper: sanitizedDepth(zone.upperBound)
        )
        let hasVisibleOverlap = visibleRange.lower < visibleRange.upper
        let shallowY = rawYPosition(for: visibleRange.lower, height: height)
        let deepY = rawYPosition(for: visibleRange.upper, height: height)
        let zoneHeight = max(0, deepY - shallowY)
        let centeredTop = shallowY - max(0, 18 - zoneHeight) / 2
        let centeredBottom = deepY + max(0, 18 - zoneHeight) / 2
        let clampedTop = min(max(centeredTop, 0), height)
        let clampedBottom = min(max(centeredBottom, 0), height)
        let boxHeight = hasVisibleOverlap ? max(0, clampedBottom - clampedTop) : 0

        return RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(Color(red: 0.38, green: 0.79, blue: 1.0).opacity(isLuminanceReduced ? 0 : 0.24))
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(Color(red: 0.64, green: 0.9, blue: 1.0).opacity(isLuminanceReduced ? 0.6 : 0.9), lineWidth: 1.4)
            )
            .frame(width: railWidth + 8, height: boxHeight)
            .position(x: railX + railWidth / 2, y: clampedTop + boxHeight / 2)
            .opacity(boxHeight > 0 ? 1 : 0)
    }

    private func targetLine(at depth: Double, height: CGFloat) -> some View {
        Rectangle()
            .fill(Color.white.opacity(0.92))
            .frame(width: railWidth + 8, height: 2)
            .position(x: railX + railWidth / 2, y: yPosition(for: depth, height: height))
    }

    private func currentDepthMarker(depthMeters: Double, height: CGFloat) -> some View {
        HStack(spacing: -1) {
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white)

            Circle()
                .fill(Color.white)
                .frame(width: 10, height: 10)
                .overlay(
                    Circle()
                        .stroke(isLuminanceReduced ? Color.white : DiveWatchTheme.primary, lineWidth: 2.2)
                )
        }
        .position(x: railX + 5, y: yPosition(for: depthMeters, height: height))
    }

    private func rawYPosition(for depth: Double, height: CGFloat) -> CGFloat {
        let clampedDepth = sanitizedDepth(depth)
        return CGFloat(clampedDepth / scaleUpperBound) * height
    }

    private func sanitizedDepth(_ depth: Double) -> Double {
        guard depth.isFinite else { return 0 }
        return min(max(depth, 0), scaleUpperBound)
    }
}

struct DepthGaugeRail_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            DepthGaugeRail(
                depthMeters: 18.4,
                maxScaleMeters: 30,
                stopZone: nil,
                targetDepthMeters: nil
            )

            DepthGaugeRail(
                depthMeters: 4.8,
                maxScaleMeters: 10,
                stopZone: 3...6,
                targetDepthMeters: 5
            )
        }
        .padding()
        .background(DiveWatchTheme.background)
        .previewLayout(.sizeThatFits)
    }
}
