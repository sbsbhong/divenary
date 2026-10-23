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
    /// The dive's place in the session, so a new dive never re-labels the marks already drawn.
    var diveIndex = 0
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
    /// Half the keylined index plus a point: a ghost this close to the index would sit under it.
    static let ghostIndexClearance: CGFloat = 3

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
        let readable = maxDepths.enumerated().filter { $0.element.isFinite && $0.element > 0 }
        let recent = Array(readable.suffix(tideMarkLimit))
        return recent.enumerated().map { position, dive in
            GaugeTideMark(
                depthMeters: dive.element,
                opacity: position == recent.count - 1 ? emphasis.newestOpacity : emphasis.olderOpacity,
                diveIndex: dive.offset
            )
        }
    }

    /// The max-depth ghost shows only inside the visible range and clear of the depth index; at the
    /// index it would hide under it, and past the range it would claim a depth the rail cannot show.
    func showsMaxDepthGhost(maxDepth: Double?, currentDepth: Double?, height: CGFloat) -> Bool {
        guard let maxDepth, maxDepth.isFinite, maxDepth > 0, maxDepth <= visibleDepthLimit else { return false }
        guard let current = scale.displayedDepth(currentDepth) else { return true }
        return abs(y(forDepth: maxDepth, height: height) - y(forDepth: current, height: height)) > Self.ghostIndexClearance
    }
}

/// The three minute indices beside "Recommended stop" (proposal P2, adopted). Each index is a third
/// of the stop, so one minute of the usual three-minute stop. A reminder only, never a requirement.
enum RecommendedStopProgress {
    static let indexCount = 3

    /// How many of the three indices are full: one per finished third of the stop.
    static func completedIndices(remaining: TimeInterval, total: TimeInterval) -> Int {
        guard remaining.isFinite, total.isFinite, total > 0 else { return 0 }
        let elapsed = min(max(total - remaining, 0), total)
        let perIndex = total / Double(indexCount)
        return min(indexCount, Int((elapsed / perIndex).rounded(.down)))
    }
}

private struct RecordingAuthorizedMaximumKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

/// What the recording chassis knows about the dive beyond a page's own range. Pages never set it.
struct RecordingGaugeContext: Equatable {
    /// The deepest reading so far, drawn as the max-depth ghost. `nil` draws none (freediving uses
    /// tide marks instead, and draws nothing during a descent).
    var maxDepthMeters: Double?
    /// Finished freedives' maximum depths, oldest first, drawn as tide marks. Empty while diving.
    var tideMarkDepths: [Double] = []
    /// Details pages draw the ghost and the tide marks brighter.
    var emphasis: GaugeTideEmphasis = .live
    /// The depth is past the authorized sensor range: the rail fills to the limit with no index.
    var isBeyondLimit = false
}

private struct RecordingGaugeContextKey: EnvironmentKey {
    static let defaultValue = RecordingGaugeContext()
}

/// 0 before a recording's first frame, 1 once the rail has grown in (spec RC-ENTER).
private struct RecordingGaugeGrowthKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
    var recordingAuthorizedMaximum: Double? {
        get { self[RecordingAuthorizedMaximumKey.self] }
        set { self[RecordingAuthorizedMaximumKey.self] = newValue }
    }

    var recordingGaugeContext: RecordingGaugeContext {
        get { self[RecordingGaugeContextKey.self] }
        set { self[RecordingGaugeContextKey.self] = newValue }
    }

    var recordingGaugeGrowth: CGFloat {
        get { self[RecordingGaugeGrowthKey.self] }
        set { self[RecordingGaugeGrowthKey.self] = newValue }
    }
}

/// The left depth gauge of every recording page (spec C8): tick labels, a capsule rail that water
/// fills from the surface down to the diver in a colour anchored to metres (DECISIONS D1), and a
/// white keylined index with a chevron that read as one watch hand. It is kept narrow so the value
/// beside it can stay large. Always-On draws it as an outline. Presentation only: it judges nothing.
struct DepthGaugeRail: View {
    static let layoutWidth: CGFloat = 46

    let depthMeters: Double?
    let maxScaleMeters: Double
    let stopZone: ClosedRange<Double>?
    let targetDepthMeters: Double?

    @Environment(\.recordingAuthorizedMaximum) private var authorizedMaximum
    @Environment(\.recordingGaugeContext) private var context
    @Environment(\.recordingGaugeGrowth) private var growth
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.diveType) private var type

    /// The last live reading, so the hand fades out where it was instead of jumping to the surface.
    @State private var lastLiveDepth: Double?

    /// Horizontal anatomy in points from the gauge's leading edge (spec C8 px ÷ 2, gauge at x 8 px).
    private enum Lane {
        static let labelWidth: CGFloat = 19
        static let pointerCenter: CGFloat = 23.5
        static let railX: CGFloat = 28
        static let railWidth: CGFloat = 14
        /// The rail sits 1 pt inside the gauge frame at both ends.
        static let railInset: CGFloat = 1
        static let indexX: CGFloat = 25
        static let indexWidth: CGFloat = 20
        static let notchX: CGFloat = 43
        static let tideX: CGFloat = 41
        static let tideWidth: CGFloat = 5
    }

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height

            railLayer(height: height)
                .scaleEffect(x: 1, y: allowsGrowth ? max(growth, 0.001) : 1, anchor: .top)
                .opacity(allowsGrowth ? 1 : growth)

            Group {
                if let stopZone {
                    stopZoneBand(stopZone, height: height)
                }
                notchLane(height: height)
                ForEach(tickValues, id: \.self) { tick in
                    tickLabel(for: tick, height: height)
                }
                depthHand(height: height)
            }
            .opacity(growth)
        }
        .frame(width: Self.layoutWidth)
        .frame(maxHeight: .infinity)
        // P3: a range change (30 → 40 m, Live 30 ↔ stop 10 m) slides the scale once, smoothly.
        .animation(DiveMotion.rangeChange(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: scale.upperBound)
        .onAppear { rememberLiveDepth(scale.displayedDepth(depthMeters)) }
        .onChange(of: scale.displayedDepth(depthMeters)) { _, depth in rememberLiveDepth(depth) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Depth gauge"))
        .accessibilityValue(Text(scale.displayedDepth(depthMeters).map(DiveFormatters.depth) ?? String(localized: "Depth unavailable")))
    }

    // MARK: Layers

    /// The track, the water, the hairlines and the max-depth line, clipped to the capsule.
    private func railLayer(height: CGFloat) -> some View {
        let railHeight = max(0, height - 2 * Lane.railInset)
        return ZStack(alignment: .top) {
            if isLuminanceReduced {
                Capsule(style: .continuous)
                    .strokeBorder(DiveWatchTheme.aodStroke, lineWidth: 1)
            } else {
                Capsule(style: .continuous)
                    .fill(DiveWatchTheme.chip)
                waterFill(height: height)
                ForEach(tickValues, id: \.self) { tick in
                    Rectangle()
                        .fill(DiveWatchTheme.hairline)
                        .frame(width: Lane.railWidth, height: 1)
                        .offset(y: railY(tick, height: height) - 0.5)
                }
                if showsGhost(height: height), let maxDepth = context.maxDepthMeters {
                    Rectangle()
                        .fill(Color.white.opacity(ghostOpacity))
                        .frame(width: Lane.railWidth, height: 1.5)
                        .offset(y: railY(maxDepth, height: height) - 0.75)
                }
            }
        }
        .frame(width: Lane.railWidth, height: railHeight, alignment: .top)
        .clipShape(Capsule(style: .continuous))
        .position(x: Lane.railX + Lane.railWidth / 2, y: height / 2)
    }

    /// Water from 0 m down to the diver. The gradient spans the whole visible range so a colour
    /// always means the same depth; the fill only reveals it down to the current reading.
    private func waterFill(height: CGFloat) -> some View {
        let surface = geometry.y(forDepth: 0, height: height)
        let span = max(0, geometry.y(forDepth: scale.upperBound, height: height) - surface)
        let fillHeight = isBeyondLimit ? span : max(0, geometry.y(forDepth: drawnDepth, height: height) - surface)
        return deepBlueGradient
            .frame(width: Lane.railWidth, height: span)
            .frame(width: Lane.railWidth, height: fillHeight, alignment: .top)
            .clipped()
            .offset(y: surface - Lane.railInset)
            // The recommended-stop page lets the stop zone lead (spec C8).
            .opacity(showsWater ? (stopZone == nil ? 1 : 0.5) : 0)
            .animation(DiveMotion.depthGlide(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: drawnDepth)
            .animation(DiveMotion.animation(.signal, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: showsWater)
    }

    private var deepBlueGradient: LinearGradient {
        LinearGradient(
            stops: RecordingGaugeGeometry.waterGradientStops(upperBound: scale.upperBound),
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// The amber recommended-stop band with its two edge lines (spec C8). Always-On keeps the edges.
    private func stopZoneBand(_ zone: ClosedRange<Double>, height: CGFloat) -> some View {
        // Only the part of the zone the rail can show, never shorter than 18 pt.
        let visibleRange = geometry.stopZoneFrame(zone: zone, height: height)
        let clampedTop = visibleRange?.lowerBound ?? 0
        let bandHeight = visibleRange.map { $0.upperBound - $0.lowerBound } ?? 0

        return ZStack {
            RoundedRectangle(cornerRadius: DiveRadius.stopZone, style: .continuous)
                .fill(isLuminanceReduced ? Color.clear : DiveWatchTheme.cautionFill)
            VStack(spacing: 0) {
                Rectangle().fill(DiveWatchTheme.cautionLine).frame(height: 1)
                Spacer(minLength: 0)
                Rectangle().fill(DiveWatchTheme.cautionLine).frame(height: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: DiveRadius.stopZone, style: .continuous))
        }
        .frame(width: Lane.indexWidth, height: bandHeight)
        .position(x: Lane.indexX + Lane.indexWidth / 2, y: clampedTop + bandHeight / 2)
        .opacity(bandHeight > 0 ? 1 : 0)
    }

    /// The narrow lane right of the rail: the max-depth notch, freedive tide marks, the stop target
    /// pip, and the cap line where the authorized sensor range ends.
    @ViewBuilder
    private func notchLane(height: CGFloat) -> some View {
        if showsGhost(height: height), let maxDepth = context.maxDepthMeters {
            let size = context.emphasis == .details ? CGSize(width: 4, height: 3) : CGSize(width: 3, height: 2)
            Rectangle()
                .fill(Color.white.opacity(ghostOpacity))
                .frame(width: size.width, height: size.height)
                .position(x: Lane.notchX + size.width / 2, y: geometry.y(forDepth: maxDepth, height: height))
        }

        ForEach(tideMarks, id: \.diveIndex) { mark in
            Rectangle()
                .fill(Color.white.opacity(mark.opacity))
                .frame(width: Lane.tideWidth, height: 1.5)
                .position(x: Lane.tideX + Lane.tideWidth / 2, y: geometry.y(forDepth: mark.depthMeters, height: height))
                .transition(.opacity)
        }
        .animation(DiveMotion.autoFade(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: tideMarks)

        if let targetDepthMeters, stopZone != nil, targetDepthMeters <= scale.displayLimit {
            Rectangle()
                .fill(DiveWatchTheme.caution)
                .frame(width: 3, height: 4)
                .position(x: Lane.notchX + 1.5, y: geometry.y(forDepth: targetDepthMeters, height: height))
        }

        if isRangeCappedBySensor {
            Rectangle()
                .fill(DiveWatchTheme.ink2)
                .frame(width: Self.layoutWidth - Lane.indexX, height: 1)
                .position(x: (Lane.indexX + Self.layoutWidth) / 2, y: geometry.y(forDepth: scale.upperBound, height: height))
        }
    }

    private func tickLabel(for depth: Double, height: CGFloat) -> some View {
        let opacity = geometry.labelOpacity(tick: depth, currentDepth: handVisible ? drawnDepth : nil, height: height)
        return Text(tickLabel(for: depth))
            .font(type.font(.tick))
            .tracking(type.tracking(.tick))
            .foregroundStyle(isLuminanceReduced ? Color.white.opacity(0.6) : DiveWatchTheme.ink2)
            .lineLimit(1)
            .frame(width: Lane.labelWidth, alignment: .trailing)
            .opacity(opacity)
            .animation(DiveMotion.animation(.quickFade, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: opacity)
            .position(x: Lane.labelWidth / 2, y: geometry.y(forDepth: sanitizedDepth(depth), height: height))
    }

    private func tickLabel(for depth: Double) -> String {
        "\(Int(sanitizedDepth(depth).rounded()))"
    }

    /// The chevron pointer under the keylined white index; one 85% white layer in Always-On.
    private func depthHand(height: CGFloat) -> some View {
        let y = geometry.y(forDepth: drawnDepth, height: height)
        let handColor = isLuminanceReduced ? Color.white.opacity(0.85) : Color.white

        return ZStack {
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(handColor)
                .position(x: Lane.pointerCenter, y: y)

            Group {
                if isLuminanceReduced {
                    RoundedRectangle(cornerRadius: 1, style: .continuous)
                        .fill(handColor)
                        .frame(width: Lane.indexWidth - 2, height: 2)
                } else {
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(Color.white)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .strokeBorder(DiveWatchTheme.keyline, lineWidth: 1)
                        )
                        .frame(width: Lane.indexWidth, height: 5)
                }
            }
            .position(x: Lane.indexX + Lane.indexWidth / 2, y: y)
        }
        .opacity(handVisible ? 1 : 0)
        .animation(DiveMotion.depthGlide(reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: drawnDepth)
        .animation(DiveMotion.animation(.signal, reduceMotion: reduceMotion, alwaysOn: isLuminanceReduced), value: handVisible)
    }

    // MARK: State

    private var scale: RecordingGaugeScale {
        RecordingGaugeScale(maximumDepthMeters: authorizedMaximum, rangeMeters: maxScaleMeters)
    }

    private var geometry: RecordingGaugeGeometry {
        RecordingGaugeGeometry(scale: scale)
    }

    private var tickValues: [Double] { scale.ticks }

    private var liveDepth: Double? { scale.displayedDepth(depthMeters) }

    private var isBeyondLimit: Bool { context.isBeyondLimit }

    /// Where the fill ends and the hand points: the live reading, or the last one while it fades.
    private var drawnDepth: Double { liveDepth ?? lastLiveDepth ?? 0 }

    /// Water shows while the depth is live, and fills to the limit once it is past the sensor range.
    private var showsWater: Bool { !isLuminanceReduced && (liveDepth != nil || isBeyondLimit) }

    /// No index past the sensor range: nothing is drawn at a depth the watch cannot read.
    private var handVisible: Bool { liveDepth != nil && !isBeyondLimit }

    private var isRangeCappedBySensor: Bool {
        scale.displayLimit < max(1, maxScaleMeters) && scale.upperBound >= scale.displayLimit
    }

    private var tideMarks: [GaugeTideMark] {
        guard !isLuminanceReduced else { return [] }
        return RecordingGaugeGeometry.tideMarks(maxDepths: context.tideMarkDepths, emphasis: context.emphasis)
    }

    private var ghostOpacity: Double { context.emphasis == .details ? 1 : 0.5 }

    private func showsGhost(height: CGFloat) -> Bool {
        !isLuminanceReduced
            && geometry.showsMaxDepthGhost(maxDepth: context.maxDepthMeters, currentDepth: handVisible ? drawnDepth : nil, height: height)
    }

    /// The rail grows down from the top when a recording starts, unless Reduce Motion asks for a fade.
    private var allowsGrowth: Bool { !reduceMotion }

    /// A gauge y in the rail's own coordinates.
    private func railY(_ depth: Double, height: CGFloat) -> CGFloat {
        geometry.y(forDepth: depth, height: height) - Lane.railInset
    }

    private func rememberLiveDepth(_ depth: Double?) {
        if let depth { lastLiveDepth = depth }
    }

    private func sanitizedDepth(_ depth: Double) -> Double {
        guard depth.isFinite else { return 0 }
        return min(max(depth, 0), scale.displayLimit)
    }
}

#if DEBUG
#Preview("Gauge · live and stop") {
    HStack(spacing: 12) {
        DepthGaugeRail(depthMeters: 18.6, maxScaleMeters: 30, stopZone: nil, targetDepthMeters: nil)
            .environment(\.recordingGaugeContext, RecordingGaugeContext(maxDepthMeters: 22.4))
        DepthGaugeRail(depthMeters: 5.2, maxScaleMeters: 10, stopZone: 3...6, targetDepthMeters: 5)
            .environment(\.recordingGaugeContext, RecordingGaugeContext(maxDepthMeters: 22.4))
        DepthGaugeRail(depthMeters: 0.4, maxScaleMeters: 30, stopZone: nil, targetDepthMeters: nil)
            .environment(\.recordingGaugeContext, RecordingGaugeContext(tideMarkDepths: [10.4, 12, 13.5, 9.8, 14.2]))
        DepthGaugeRail(depthMeters: nil, maxScaleMeters: 30, stopZone: nil, targetDepthMeters: nil)
            .environment(\.recordingAuthorizedMaximum, 6)
            .environment(\.recordingGaugeContext, RecordingGaugeContext(isBeyondLimit: true))
    }
    .frame(height: 163)
    .padding()
    .background(DiveWatchTheme.canvas)
}
#endif
