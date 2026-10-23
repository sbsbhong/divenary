import SwiftUI

/// Presentation only. Each page asks for a range that follows the dive: 30 m, widening in 10 m steps
/// past the deepest point, or about 10 m around a recommended stop so the stop zone stands out. The
/// rail never extrapolates beyond the authorized sensor range, so that limit caps the range.
/// A one-meter minimum span avoids division by zero; ticks and values still respect a smaller limit.
struct RecordingGaugeScale {
    let upperBound: Double
    let displayLimit: Double

    init(maximumDepthMeters: Double?, rangeMeters: Double) {
        let range = rangeMeters.isFinite ? max(1, rangeMeters) : 30
        if let maximumDepthMeters, maximumDepthMeters.isFinite, maximumDepthMeters > 0 {
            displayLimit = min(maximumDepthMeters, DiveDepthSupport.supportedWatchDepthLimitMeters)
            upperBound = max(1, min(range, displayLimit))
        } else {
            displayLimit = range
            upperBound = range
        }
    }

    var ticks: [Double] {
        // At most four well-spaced labels, rounded to whole 1/2/5/10/20-meter steps.
        let step = [1.0, 2, 5, 10, 20, 50, 100].first { $0 >= upperBound / 3 } ?? upperBound
        return stride(from: 0.0, through: min(upperBound, displayLimit), by: step).map { $0 }
    }

    func displayedDepth(_ depth: Double?) -> Double? {
        guard let depth, depth.isFinite else { return nil }
        return min(max(depth, 0), displayLimit)
    }
}

/// One colour stop of the gauge water gradient, as a location over the visible range (0 = surface).
struct GaugeWaterStop: Equatable {
    let location: Double
    let rgb: DiveRGB
}

/// A finished freedive's maximum depth, drawn as a short tick in the gauge's notch lane.
struct GaugeTideMark: Equatable {
    let depthMeters: Double
    let opacity: Double
}

/// How strongly tide marks are drawn: quietly on live pages, stronger on freedive Details.
enum GaugeTideEmphasis {
    case live
    case details

    var newestOpacity: Double {
        switch self {
        case .live: return 0.8
        case .details: return 1.0
        }
    }

    var olderOpacity: Double {
        switch self {
        case .live: return 0.35
        case .details: return 0.5
        }
    }
}

/// Presentation geometry for the Plumb depth gauge (spec C8, DECISIONS D1), kept apart from the view
/// so it can be tested. The rail keeps a 7 pt inset at both ends, so 0 m and the bottom of the
/// visible range never sit under the capsule's rounded caps. Nothing here judges the dive.
struct RecordingGaugeGeometry {
    static let railInset: CGFloat = 7
    /// A tick label this close to the current-depth index steps back so the index stays readable.
    static let labelYieldDistance: CGFloat = 8
    static let yieldedLabelOpacity = 0.25
    static let minimumStopZoneHeight: CGFloat = 18
    static let tideMarkLimit = 5

    let scale: RecordingGaugeScale

    init(scale: RecordingGaugeScale) {
        self.scale = scale
    }

    /// The deepest depth the rail can show: the visible range, never past the authorized limit.
    private var visibleDepthLimit: Double {
        min(scale.upperBound, scale.displayLimit)
    }

    private func visibleDepth(_ depth: Double) -> Double {
        guard depth.isFinite else { return 0 }
        return min(max(depth, 0), visibleDepthLimit)
    }

    func y(forDepth depth: Double, height: CGFloat) -> CGFloat {
        let travel = max(0, height - 2 * Self.railInset)
        return Self.railInset + CGFloat(visibleDepth(depth) / scale.upperBound) * travel
    }

    /// 0.25 when the tick label sits within 8 pt of the current-depth index, otherwise 1.
    func labelOpacity(tick: Double, currentDepth: Double?, height: CGFloat) -> Double {
        guard let currentDepth = scale.displayedDepth(currentDepth) else { return 1 }
        let distance = abs(y(forDepth: tick, height: height) - y(forDepth: currentDepth, height: height))
        return distance <= Self.labelYieldDistance ? Self.yieldedLabelOpacity : 1
    }

    /// The recommended-stop band from its shallow to its deep edge. A band shorter than
    /// `minimumHeight` grows evenly around its centre and moves inside the gauge rather than
    /// shrinking at an end. `nil` when the zone is outside the visible range.
    func stopZoneFrame(
        zone: ClosedRange<Double>,
        height: CGFloat,
        minimumHeight: CGFloat = RecordingGaugeGeometry.minimumStopZoneHeight
    ) -> ClosedRange<CGFloat>? {
        let shallow = visibleDepth(zone.lowerBound)
        let deep = visibleDepth(zone.upperBound)
        guard shallow < deep else { return nil }

        var top = y(forDepth: shallow, height: height)
        var bottom = y(forDepth: deep, height: height)
        let missing = max(0, minimumHeight - (bottom - top))
        top -= missing / 2
        bottom += missing / 2
        if top < 0 {
            bottom = min(height, bottom - top)
            top = 0
        }
        if bottom > height {
            top = max(0, top - (bottom - height))
            bottom = height
        }
        return top...bottom
    }

    /// Straight sRGB interpolation between the metre anchors; past 40 m it stays on the deepest colour.
    static func waterColor(atDepth depth: Double) -> DiveRGB {
        let anchors = DiveWatchTheme.waterStops
        guard let first = anchors.first, let last = anchors.last else { return DiveRGB(hex: 0x1F5A99) }
        guard depth.isFinite, depth > first.depthMeters else { return first.rgb }
        guard depth < last.depthMeters else { return last.rgb }
        for (shallow, deep) in zip(anchors, anchors.dropFirst()) where depth <= deep.depthMeters {
            let fraction = (depth - shallow.depthMeters) / (deep.depthMeters - shallow.depthMeters)
            return shallow.rgb.mixed(with: deep.rgb, fraction: fraction)
        }
        return last.rgb
    }

    /// The water colours for a visible range of `upperBound` metres: the surface colour at 0, each
    /// metre anchor inside the range at its own location, and the colour of the range's bottom at 1.
    static func waterColorStops(upperBound: Double) -> [GaugeWaterStop] {
        let range = upperBound.isFinite ? max(1, upperBound) : 30
        let inside = DiveWatchTheme.waterStops
            .filter { $0.depthMeters > 0 && $0.depthMeters < range }
            .map { GaugeWaterStop(location: $0.depthMeters / range, rgb: $0.rgb) }
        return [GaugeWaterStop(location: 0, rgb: waterColor(atDepth: 0))]
            + inside
            + [GaugeWaterStop(location: 1, rgb: waterColor(atDepth: range))]
    }

    static func waterGradientStops(upperBound: Double) -> [Gradient.Stop] {
        waterColorStops(upperBound: upperBound).map {
            Gradient.Stop(color: $0.rgb.color, location: CGFloat($0.location))
        }
    }

    /// The last five finished dives, oldest first; the newest is the brightest.
    static func tideMarks(maxDepths: [Double], emphasis: GaugeTideEmphasis = .live) -> [GaugeTideMark] {
        let recent = Array(maxDepths.filter { $0.isFinite && $0 > 0 }.suffix(tideMarkLimit))
        return recent.enumerated().map { index, depth in
            GaugeTideMark(
                depthMeters: depth,
                opacity: index == recent.count - 1 ? emphasis.newestOpacity : emphasis.olderOpacity
            )
        }
    }
}

/// The three minute indices beside "Recommended stop" (proposal P2, adopted). Each index is a third
/// of the stop, so one minute of the usual three-minute stop. A reminder only, never a requirement.
enum RecommendedStopProgress {
    static let indexCount = 3

    static func completedMinutes(remaining: TimeInterval, total: TimeInterval) -> Int {
        guard remaining.isFinite, total.isFinite, total > 0 else { return 0 }
        let elapsed = min(max(total - remaining, 0), total)
        let perIndex = total / Double(indexCount)
        return min(indexCount, Int((elapsed / perIndex).rounded(.down)))
    }
}

private struct RecordingAuthorizedMaximumKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

extension EnvironmentValues {
    var recordingAuthorizedMaximum: Double? {
        get { self[RecordingAuthorizedMaximumKey.self] }
        set { self[RecordingAuthorizedMaximumKey.self] = newValue }
    }
}

/// The left depth rail of every recording page. It is kept narrow so the live value beside it can
/// stay large; tick labels sit inside the same width. Always-On draws it as an outline.
struct DepthGaugeRail: View {
    static let layoutWidth: CGFloat = 46

    let depthMeters: Double?
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?

    @Environment(\.recordingAuthorizedMaximum) private var authorizedMaximum
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

                if let targetDepthMeters, targetDepthMeters <= scale.displayLimit {
                    targetLine(at: targetDepthMeters, height: height)
                }

                ForEach(tickValues, id: \.self) { tick in
                    tickMark(for: tick, height: height)
                }

                if let depthMeters = scale.displayedDepth(depthMeters) {
                    currentDepthMarker(depthMeters: depthMeters, height: height)
                }
            }
        }
        .frame(width: Self.layoutWidth)
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Depth gauge"))
        .accessibilityValue(Text(scale.displayedDepth(depthMeters).map(DiveFormatters.depth) ?? String(localized: "Depth unavailable")))
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

    private var scale: RecordingGaugeScale {
        RecordingGaugeScale(maximumDepthMeters: authorizedMaximum, rangeMeters: maxScaleMeters)
    }

    private var scaleUpperBound: Double { scale.upperBound }
    private var tickValues: [Double] { scale.ticks }

    private func yPosition(for depth: Double, height: CGFloat) -> CGFloat {
        let clampedDepth = sanitizedDepth(depth)
        let position = CGFloat(clampedDepth / scaleUpperBound) * height
        return min(max(position, 6), height - 6)
    }

    private func tickMark(for depth: Double, height: CGFloat) -> some View {
        let y = yPosition(for: depth, height: height)

        return HStack(spacing: 2) {
            Text(tickLabel(for: depth))
                .font(DiveWatchTheme.metricFont(size: 11, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(1)
                .frame(width: 21, alignment: .trailing)

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
        return min(max(depth, 0), scale.displayLimit)
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
