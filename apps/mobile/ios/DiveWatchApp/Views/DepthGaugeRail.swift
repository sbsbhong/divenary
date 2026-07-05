import SwiftUI

struct DepthGaugeRail: View {
    let depthMeters: Double
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?

    private let gaugeWidth: CGFloat = 62
    private let gaugeHeight: CGFloat = 118
    private let railX: CGFloat = 32
    private let railWidth: CGFloat = 20

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { proxy in
                let height = proxy.size.height

                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(deepBlueGradient)
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(Color.white.opacity(0.18), lineWidth: 1)
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

                currentDepthMarker(height: height)
            }
        }
        .frame(width: gaugeWidth, height: gaugeHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Depth gauge"))
        .accessibilityValue(Text(DiveFormatters.depth(depthMeters)))
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

        return HStack(spacing: 3) {
            Text(tickLabel(for: depth))
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: 20, alignment: .trailing)

            Rectangle()
                .fill(Color.white.opacity(0.55))
                .frame(width: 6, height: 1)
        }
        .position(x: 14, y: y)
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

        return RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color(red: 0.38, green: 0.79, blue: 1.0).opacity(0.24))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Color(red: 0.64, green: 0.9, blue: 1.0).opacity(0.9), lineWidth: 1.4)
            )
            .frame(width: railWidth + 10, height: boxHeight)
            .position(x: railX + railWidth / 2, y: clampedTop + boxHeight / 2)
            .opacity(boxHeight > 0 ? 1 : 0)
    }

    private func targetLine(at depth: Double, height: CGFloat) -> some View {
        Rectangle()
            .fill(Color.white.opacity(0.92))
            .frame(width: railWidth + 14, height: 2)
            .position(x: railX + railWidth / 2, y: yPosition(for: depth, height: height))
    }

    private func currentDepthMarker(height: CGFloat) -> some View {
        HStack(spacing: -1) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.white)

            Circle()
                .fill(Color.white)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .stroke(DiveWatchTheme.primary, lineWidth: 2)
                )
        }
        .shadow(color: Color.black.opacity(0.35), radius: 2, x: 0, y: 1)
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
