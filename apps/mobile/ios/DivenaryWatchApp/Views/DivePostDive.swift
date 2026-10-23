import SwiftUI

// The screens after a dive and the saved logs: the ending, saving and result messages, the saved
// summary's finale, the profile chart, stacked stats, the failure banner and the scroll-edge
// treatment. Nothing here plays a haptic: the five diver-action haptics stay in `WatchDiveHaptics`.

// MARK: - Values split into numbers and units

/// A saved value split into its numbers and the words around them, so numbers draw large and white
/// and units small and grey (spec C20): "42분 10초", "22.4 m", "오전 10:39", "5.0 m · 3.0–6.0 m".
/// A value without digits ("공기", "권장 스탑 완료", "--") stays one word.
enum DiveValueParts {
    enum Part: Equatable {
        case number(String)
        case text(String)
    }

    /// Characters that stay inside a number when a digit follows them: "10:39", "2,530", "4/5",
    /// "3.0–6.0".
    private static let joiners: Set<Character> = [".", ",", ":", "/", "–"]

    static func split(_ value: String) -> [Part] {
        let characters = Array(value)
        var parts: [Part] = []
        var current = ""
        var currentIsNumber = false

        func flush() {
            if currentIsNumber {
                if !current.isEmpty { parts.append(.number(current)) }
            } else {
                let text = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { parts.append(.text(text)) }
            }
            current = ""
        }

        for (index, character) in characters.enumerated() {
            let continuesNumber = currentIsNumber
                && joiners.contains(character)
                && index + 1 < characters.count
                && isDigit(characters[index + 1])
            if isDigit(character) || continuesNumber {
                if !currentIsNumber {
                    flush()
                    currentIsNumber = true
                }
            } else if currentIsNumber {
                flush()
                currentIsNumber = false
            }
            current.append(character)
        }
        flush()
        return parts
    }

    static func hasNumber(_ parts: [Part]) -> Bool {
        parts.contains { part in
            if case .number = part { return true }
            return false
        }
    }

    private static func isDigit(_ character: Character) -> Bool {
        character.isASCII && character.isNumber
    }
}

// MARK: - Saved dive time label

extension DiveMode {
    /// The saved dive's time label on the summary and the detail (COPY C15): a scuba dive's time is
    /// "다이빙 시간"; a freediving session's whole length stays "총 기록 시간".
    var savedTimeTitle: String {
        self == .scuba ? String(localized: "Log time") : String(localized: "Duration")
    }
}

// MARK: - Failure notes

/// A failure note with its attempt counter set apart, so "(2)" can be drawn in grey (spec C18):
/// the flow reports "저장하지 못했습니다. 기록은 보관하고 있습니다. (2)" as one string.
struct DiveFailureMessage: Equatable {
    let text: String
    let counter: String?

    init(text: String, counter: String?) {
        self.text = text
        self.counter = counter
    }

    init(message: String) {
        guard message.hasSuffix(")"),
              let open = message.lastIndex(of: "(")
        else {
            self.init(text: message, counter: nil)
            return
        }
        let digits = message[message.index(after: open)..<message.index(before: message.endIndex)]
        guard !digits.isEmpty, digits.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            self.init(text: message, counter: nil)
            return
        }
        self.init(
            text: message[..<open].trimmingCharacters(in: .whitespaces),
            counter: String(message[open...])
        )
    }
}

// MARK: - Profile geometry

/// Where things sit on a saved profile (spec C15): the drawing tip the logo rides during the summary
/// finale, and the deepest point's depth label. `points` are the normalized points of
/// `MiniDepthProfile`.
enum DiveProfileGeometry {
    struct Tip: Equatable {
        let point: CGPoint
        /// The line's direction at the tip; down the screen is positive.
        let degrees: Double
    }

    /// The profile line mapped into a drawing once, so the finale's rider can find the drawing tip on
    /// every animation frame without building arrays.
    struct Track {
        fileprivate struct Segment {
            let start: CGPoint
            let end: CGPoint
            let length: CGFloat
        }

        private let first: CGPoint?
        /// The segments with a length; a repeated point has no direction.
        private let segments: [Segment]
        private let total: CGFloat

        init(points: [CGPoint], size: CGSize) {
            let mapped = points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
            first = mapped.first
            segments = zip(mapped, mapped.dropFirst())
                .map { start, end in Segment(start: start, end: end, length: hypot(end.x - start.x, end.y - start.y)) }
                .filter { $0.length > 0 }
            total = segments.reduce(0) { $0 + $1.length }
        }

        /// The point `fraction` of the way along the line by length, as `trim(from: 0, to: fraction)`
        /// draws it, so a rider placed here sits on the drawing tip.
        func tip(at fraction: Double) -> Tip? {
            guard let first else { return nil }
            guard total > 0, let last = segments.last else {
                return Tip(point: first, degrees: 0)
            }

            let clamped = fraction.isFinite ? min(max(fraction, 0), 1) : 0
            var remaining = CGFloat(clamped) * total
            for segment in segments {
                if remaining <= segment.length {
                    return DiveProfileGeometry.point(on: segment, at: remaining / segment.length)
                }
                remaining -= segment.length
            }
            return DiveProfileGeometry.point(on: last, at: 1)
        }
    }

    /// The point `fraction` of the way along the line by length, as `trim(from: 0, to: fraction)`
    /// draws it, so a rider placed here sits on the drawing tip.
    static func tip(of points: [CGPoint], in size: CGSize, fraction: Double) -> Tip? {
        Track(points: points, size: size).tip(at: fraction)
    }

    /// The deepest point's depth label: just above and to the right of the point, in the water, or
    /// to its left when it would run off the drawing. It never leaves the drawing.
    static func depthLabelOrigin(
        deepest: CGPoint,
        label: CGSize,
        bounds: CGSize,
        dotRadius: CGFloat = 2.5,
        gap: CGFloat = 4
    ) -> CGPoint {
        var x = deepest.x + dotRadius + gap
        if x + label.width > bounds.width {
            x = deepest.x - dotRadius - gap - label.width
        }
        return CGPoint(
            x: max(0, x),
            y: max(0, deepest.y - dotRadius - gap - label.height)
        )
    }

    fileprivate static func point(on segment: Track.Segment, at fraction: CGFloat) -> Tip {
        let t = min(max(fraction, 0), 1)
        let dx = segment.end.x - segment.start.x
        let dy = segment.end.y - segment.start.y
        return Tip(
            point: CGPoint(x: segment.start.x + dx * t, y: segment.start.y + dy * t),
            degrees: atan2(dy, dx) * 180 / .pi
        )
    }
}

// MARK: - Recommended-stop record

/// One value of a saved recommended-stop record (COPY C6).
enum StopRecordRow: Hashable {
    case status
    case remaining
    case timeInZone
    case targetZone
    case started
    case completedAt
}

/// The recommended-stop record as rows of one or two stats (COPY C6, DECISIONS D20): "상태" on its
/// own row, then "스탑 구간 시간" (beside "남은 시간" only when the stop was not completed), "목표 수심 /
/// 스탑 구간" on its own row, then "시작" | "완료 시각". The "권장 사항" and "완료 여부" rows are gone,
/// and a time shows only when it was recorded.
enum StopRecordLayout {
    static func rows(for record: SafetyStopRecord) -> [[StopRecordRow]] {
        var rows: [[StopRecordRow]] = record.status == .completed
            ? [[.status], [.timeInZone]]
            : [[.status], [.remaining, .timeInZone]]
        rows.append([.targetZone])

        var times: [StopRecordRow] = []
        if record.startedAt != nil { times.append(.started) }
        if record.completedAt != nil { times.append(.completedAt) }
        if !times.isEmpty { rows.append(times) }
        return rows
    }
}

// MARK: - Summary finale

/// The saved summary's first appearance (spec PD-FINALE): the saved check bounces once, the values
/// rise into place, the profile draws itself while the Divenary logo rides its tip, and the deepest
/// point pops. Values never count up. Reduce Motion fades everything in with no logo and no bounce;
/// Always-On shows the finished summary at once.
struct DiveFinalePlan: Equatable {
    let animates: Bool
    /// The line draws from the surface; otherwise the whole profile fades in.
    let tracesLine: Bool
    let ridesLogo: Bool
    let bounces: Bool
    /// How far the maximum depth and the dive time rise (spec 12 px), and their stagger.
    let valueRise: CGFloat
    let valueStagger: Double
    let valueDuration: Double
    let lineDelay: Double
    let lineDuration: Double
    let riderFadeInDuration: Double
    let riderFadeOutDelay: Double
    let riderFadeOutDuration: Double
    let dotDelay: Double
    let dotDuration: Double
    /// How long the profile's water (or, under Reduce Motion, everything) fades in.
    let fadeDuration: Double

    init(reduceMotion: Bool, alwaysOn: Bool) {
        animates = !alwaysOn
        let moves = !alwaysOn && !reduceMotion
        tracesLine = moves
        ridesLogo = moves
        bounces = DiveMotion.allowsLandBounce(reduceMotion: reduceMotion, alwaysOn: alwaysOn)
        valueRise = moves ? DiveMotion.pageOffset : 0
        valueStagger = moves ? 0.08 : 0
        valueDuration = moves ? 0.3 : 0.2
        lineDelay = moves ? 0.15 : 0
        lineDuration = moves ? 0.9 : 0.2
        riderFadeInDuration = 0.06
        riderFadeOutDelay = lineDelay + lineDuration
        riderFadeOutDuration = 0.2
        dotDelay = moves ? 0.9 : 0
        dotDuration = moves ? 0.35 : 0.2
        fadeDuration = moves ? lineDuration : 0.2
    }
}

// MARK: - Sizes

/// Post-dive and saved-log sizes in points (spec C3, C12, C15, D16).
enum PostDiveLayout {
    /// The bottom room a flow message keeps for the failure banner that rises over the screen's
    /// bottom edge: its two lines, the 8 pt inset and a gap, so the last button scrolls clear of it.
    static let failureBannerReserve: CGFloat = 64

    /// Capsule buttons, full width.
    static func buttonHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 47 : 44
    }

    /// Free text sits this far in from the screen's sides.
    static func textGutter(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 18 : 15
    }

    /// The summary's profile; on smaller watches it gives way so the save status stays clear of the
    /// pinned chip (D11).
    static func summaryProfileHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 47 : 28
    }

    /// The detail's first page keeps the maximum depth and time on screen under the watchOS title
    /// (D10, D13), and gives room to the resend note and button when a send failed.
    static func detailProfileHeight(_ sizeClass: DiveType.SizeClass, sendFailed: Bool) -> CGFloat {
        switch (sizeClass, sendFailed) {
        case (.regular, false): return 44
        case (.compact, false): return 34
        case (.regular, true): return 48
        case (.compact, true): return 40
        }
    }

    static func listProfileHeight(_ sizeClass: DiveType.SizeClass) -> CGFloat {
        sizeClass == .regular ? 16 : 14
    }

    /// The white logo riding the summary profile (D16: 28 px).
    static let riderLogoWidth: CGFloat = 14
    /// The grey logo over the empty saved list (D16: 80 px).
    static let emptyListLogoWidth: CGFloat = 40
    /// The depth column over "물속 기록이 없습니다" (COPY C14).
    static let noSamplesGlyph: CGFloat = 32
}

// MARK: - Type

/// Post-dive text that has no role in `DiveUIType`: the ending and saving lines and the save-failure
/// title (spec F #27, #28, #31: 15 pt on Ultra), and the start-error explanation. Like the rest of
/// the off-recording type it follows the wearer's text size from a Large-size base.
private struct PostDiveFont: ViewModifier {
    let weight: Font.Weight
    @ScaledMetric private var size: CGFloat

    init(base: CGFloat, weight: Font.Weight) {
        self.weight = weight
        _size = ScaledMetric(wrappedValue: base, relativeTo: .body)
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight))
    }
}

extension View {
    /// "기록 저장 중", "기록을 종료하고 있습니다." and the save-failure title.
    func postDiveStatusFont() -> some View {
        modifier(PostDiveFont(base: 14, weight: .semibold))
    }

    /// A flow screen's explanation under its title.
    func postDiveBodyFont() -> some View {
        modifier(PostDiveFont(base: 14, weight: .regular))
    }
}

// MARK: - Values

/// A saved value drawn the Plumb way (spec C20): numbers in `numberRole` white, the units and words
/// between them in `unitRole` grey, on one baseline. A value without digits draws whole in
/// `wordRole`; dashes for an unknown value draw grey.
struct DiveValueText: View {
    let value: String
    var numberRole: DiveUIType.Role = .statValue
    var unitRole: DiveUIType.Role = .unitM
    var wordRole: DiveUIType.Role?
    var color: Color = DiveWatchTheme.ink

    private struct Item: Identifiable {
        let id: Int
        let part: DiveValueParts.Part
    }

    var body: some View {
        let parts = DiveValueParts.split(value)
        if DiveValueParts.hasNumber(parts) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                ForEach(parts.enumerated().map { Item(id: $0.offset, part: $0.element) }) { item in
                    switch item.part {
                    case let .number(number):
                        Text(verbatim: number)
                            .diveFont(numberRole)
                            .foregroundStyle(color)
                            .padding(.leading, item.id == 0 ? 0 : 4)
                    case let .text(text):
                        Text(verbatim: text)
                            .diveFont(unitRole)
                            .foregroundStyle(DiveWatchTheme.ink2)
                            .padding(.leading, item.id == 0 ? 0 : 2)
                    }
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        } else {
            Text(verbatim: value)
                .diveFont(wordRole ?? numberRole)
                .foregroundStyle(value.contains("--") ? DiveWatchTheme.ink3 : color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Two stacked stats side by side, each taking half the width so the columns line up down the
/// screen (spec C20). A trailing side with nothing in it lets the leading stat run the full width.
struct DiveStatPair<Leading: View, Trailing: View>: View {
    let leading: Leading
    let trailing: Trailing

    init(@ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            leading
                .frame(maxWidth: .infinity, alignment: .leading)
            trailing
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A section's grey label, such as "권장 스탑 요약" (spec C20 eyebrow).
struct DiveSectionEyebrow: View {
    let title: String

    var body: some View {
        Text(title)
            .diveFont(.eyebrow)
            .foregroundStyle(DiveWatchTheme.ink2)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Fine print in grey under a section label, such as the recommended-stop note (COPY C12).
struct DiveSectionNote: View {
    let text: String

    var body: some View {
        Text(text)
            .diveFont(.footnote)
            .foregroundStyle(DiveWatchTheme.ink3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Where a saved log is on its way to iPhone, in full words (DECISIONS D3): "iPhone 전송 대기",
/// "iPhone에 저장됨" or "iPhone 전송 실패", after the same glyph the saved list shows.
struct DiveSyncStatusLine: View {
    let status: DiveSyncStatus

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: status.symbol)
                .foregroundStyle(status.tint)
                .contentTransition(.symbolEffect(.replace))
            Text(status.label)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .diveFont(.footnote)
        .accessibilityElement(children: .combine)
    }
}

/// A saved rating as five stars, read as one value: "5점 중 4점" (DECISIONS D13).
struct DiveStarRating: View {
    let rating: Int?

    @ScaledMetric(relativeTo: .title3) private var starSize: CGFloat = 14

    var body: some View {
        if let filled = DiveFormatters.filledStars(rating) {
            HStack(spacing: 3) {
                ForEach(0..<5, id: \.self) { index in
                    Image(systemName: "star.fill")
                        .foregroundStyle(index < filled ? DiveWatchTheme.ink : DiveWatchTheme.dotOff)
                }
            }
            .font(.system(size: starSize, weight: .semibold))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(String(localized: "Rated \(filled) out of 5")))
        } else {
            DiveValueText(value: String(localized: "Not rated"))
        }
    }
}

// MARK: - Failure notes

/// A failure note with its "(n)" counter in grey (spec C18). `isBanner` draws it on a platter with
/// the danger glyph; otherwise it is a line of danger text, as on the detail's send failure (C5).
struct DiveFailureNote: View {
    let message: DiveFailureMessage
    var isBanner = true

    var body: some View {
        if isBanner {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(DiveWatchTheme.danger)
                text(color: DiveWatchTheme.ink)
            }
            .diveFont(.footnote)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DiveRadius.banner, style: .continuous)
                    .fill(DiveWatchTheme.platter)
            )
            .accessibilityElement(children: .combine)
        } else {
            text(color: DiveWatchTheme.danger)
                .diveFont(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func text(color: Color) -> some View {
        var line = Text(message.text).foregroundStyle(color)
        if let counter = message.counter {
            line = line + Text(verbatim: " \(counter)").foregroundStyle(DiveWatchTheme.ink3)
        }
        return line
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Flow screens

/// The ending and saving screens (spec F #27, #28, PD-SPIN): a white spinner and one line, shown at
/// once. Saving holds the main thread, so a delay timer could not fire. Over the ending recording it
/// draws no background of its own, so the dimmed instrument stays visible behind it (RC-END).
struct DiveFlowProgress<Footer: View>: View {
    let title: String
    let coversContent: Bool
    let footer: Footer

    init(title: String, coversContent: Bool = true, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.coversContent = coversContent
        self.footer = footer()
    }

    var body: some View {
        VStack(spacing: 10) {
            DiveFlowSpinner()
            Text(title)
                .postDiveStatusFont()
                .foregroundStyle(DiveWatchTheme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            footer
        }
        .padding(.horizontal, PostDiveLayout.textGutter(.current))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if coversContent {
                DiveWatchTheme.canvas.ignoresSafeArea()
            }
        }
    }
}

extension DiveFlowProgress where Footer == EmptyView {
    init(title: String, coversContent: Bool = true) {
        self.init(title: title, coversContent: coversContent) { EmptyView() }
    }
}

/// The system spinner at the spec's 24 pt (PD-SPIN). On watchOS a bare `ProgressView` takes all
/// the height it is offered.
struct DiveFlowSpinner: View {
    var body: some View {
        ProgressView()
            .tint(DiveWatchTheme.ink)
            .frame(width: 28, height: 28)
    }
}

/// A flow result with a glyph, a title, an optional explanation and its buttons (spec F #29, #30):
/// no samples, a start error, a demo cleanup error. It scrolls when a failure banner or a small
/// screen leaves too little room.
struct DiveFlowMessage<Glyph: View, Actions: View>: View {
    let title: String
    var detail: String?
    let glyph: Glyph
    let actions: Actions
    /// Whether the flow draws a failure banner over the bottom edge, so the buttons keep clear of it.
    private(set) var reservesFailureBanner = false

    init(
        title: String,
        detail: String? = nil,
        @ViewBuilder glyph: () -> Glyph,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.detail = detail
        self.glyph = glyph()
        self.actions = actions()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                glyph
                    .accessibilityHidden(true)
                    // With the banner up, the glyph and gaps tighten so the button ends above it (40 mm).
                    .frame(height: reservesFailureBanner ? 22 : nil)
                    .padding(.bottom, reservesFailureBanner ? 0 : 8)
                Text(title)
                    .diveFont(.headline)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let detail {
                    Text(detail)
                        .postDiveBodyFont()
                        .foregroundStyle(DiveWatchTheme.ink2)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, reservesFailureBanner ? 0 : 2)
                }
                VStack(spacing: 6) {
                    actions
                }
                .padding(.top, reservesFailureBanner ? 4 : 14)
            }
            .padding(.top, reservesFailureBanner ? 0 : 6)
            .padding(.horizontal, DiveLayout.platterInset(.current))
            .frame(maxWidth: .infinity)
            .padding(.bottom, reservesFailureBanner ? PostDiveLayout.failureBannerReserve : 0)
        }
        .ignoresSafeArea(.container, edges: .horizontal)
        .background(DiveWatchTheme.canvas.ignoresSafeArea())
    }

    /// The same message with room kept at the bottom for the failure banner, when one is showing.
    func reservingFailureBanner(_ reserves: Bool) -> DiveFlowMessage {
        var message = self
        message.reservesFailureBanner = reserves
        return message
    }
}

/// The save failed but the log is kept (spec F #31): the shipped title, the note with its "(n)"
/// counter, "다시 저장" and "홈 화면으로", then what happens next below the fold. Shared by real and
/// demo recordings, which differ only in what the Action Button does.
struct DiveSaveFailureView: View {
    let failureFeedback: String?
    let actionButtonNote: String
    let onRetry: () -> Void
    let onHome: () -> Void

    private let sizeClass = DiveType.SizeClass.current
    @ScaledMetric(relativeTo: .title3) private var glyphSize: CGFloat = 19

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: glyphSize, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.danger)
                        .accessibilityHidden(true)
                    Text("Keeping your captured log.")
                        .postDiveStatusFont()
                        .foregroundStyle(DiveWatchTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                .padding(.horizontal, DiveLayout.platterInset(sizeClass))

                if let failureFeedback {
                    WatchFlowFailureNote(message: failureFeedback, dismissesAutomatically: false)
                }

                Button(String(localized: "Retry Save"), action: onRetry)
                    .buttonStyle(DiveActionButtonStyle(kind: .primary))

                Button(String(localized: "Back to Home"), action: onHome)
                    .buttonStyle(DiveActionButtonStyle(kind: .secondary))

                VStack(alignment: .leading, spacing: 6) {
                    Text(String(localized: "Kept for automatic save retry from Home."))
                    Text(actionButtonNote)
                }
                .diveFont(.footnote)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, PostDiveLayout.textGutter(sizeClass) - DiveLayout.platterInset(sizeClass))
                .padding(.top, 6)
            }
            .padding(.horizontal, DiveLayout.platterInset(sizeClass))
            .padding(.bottom, 12)
        }
        .ignoresSafeArea(.container, edges: .horizontal)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
    }
}

/// The danger glyph over a flow error (spec F #30).
struct DiveFlowErrorGlyph: View {
    @ScaledMetric(relativeTo: .title2) private var size: CGFloat = 26

    var body: some View {
        Image(systemName: "exclamationmark.circle.fill")
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(DiveWatchTheme.danger)
    }
}

/// Reads the system's bottom safe-area inset where it is attached, for a banner that sits in the
/// band the system leaves at the bottom of the screen, as the recording hint chip does.
struct SystemBottomInsetReader: View {
    @Binding var inset: CGFloat

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onAppear { inset = proxy.safeAreaInsets.bottom }
                .onChange(of: proxy.safeAreaInsets.bottom) { _, bottom in
                    inset = bottom
                }
        }
    }
}

// MARK: - Profile chart

/// A saved dive's profile at summary and detail size (spec C15): the water above the diver, a white
/// line, the deepest point and, on the summary, its depth label. `progress` trims the line from the
/// surface; `riderOpacity` shows the Divenary logo riding the drawing tip (PD-FINALE, D16). VoiceOver
/// reads the depth range only. Always-On draws the line at half strength without water.
struct DiveProfileChart: View {
    let points: [CGPoint]
    let accessibilityText: String
    var progress: CGFloat = 1
    var waterOpacity: Double = 1
    var showsDeepest = true
    var depthLabel: String?
    var riderOpacity: Double = 0
    var ridesLogo = false
    var dotDiameter: CGFloat = 5

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack(alignment: .topLeading) {
                MiniDepthProfile(points: points, style: .area)
                    .fill(DiveWatchTheme.waterArea)
                    .opacity(isLuminanceReduced ? 0 : waterOpacity)
                MiniDepthProfile(points: points)
                    .trim(from: 0, to: progress)
                    .stroke(Color.white.opacity(isLuminanceReduced ? 0.5 : 0.85),
                            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                if let deepest = MiniDepthProfile.deepestPoint(in: points) {
                    let dot = CGPoint(x: deepest.x * size.width, y: deepest.y * size.height)
                    if let depthLabel {
                        Text(verbatim: depthLabel)
                            .font(DiveWatchTheme.metricFont(size: 12))
                            .foregroundStyle(DiveWatchTheme.ink2)
                            .fixedSize()
                            .alignmentGuide(.leading) { label in
                                -DiveProfileGeometry.depthLabelOrigin(
                                    deepest: dot, label: CGSize(width: label.width, height: label.height), bounds: size
                                ).x
                            }
                            .alignmentGuide(.top) { label in
                                -DiveProfileGeometry.depthLabelOrigin(
                                    deepest: dot, label: CGSize(width: label.width, height: label.height), bounds: size
                                ).y
                            }
                            .opacity(showsDeepest ? 1 : 0)
                    }
                    Circle()
                        .fill(DiveWatchTheme.ink)
                        .frame(width: dotDiameter, height: dotDiameter)
                        .scaleEffect(showsDeepest ? 1 : 0.6)
                        .opacity(showsDeepest ? 1 : 0)
                        .position(dot)
                }
                // Always in place while it may ride, so it follows the same animated progress as the line.
                if ridesLogo {
                    ProfileLogoRider(progress: progress, track: DiveProfileGeometry.Track(points: points, size: size))
                        .opacity(riderOpacity)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

/// The white Divenary logo on the profile's drawing tip, turned to follow the line (LOGO.md: the
/// mark heads up and to the right, so it turns 20° further than the line). Its body runs on every
/// animation frame, so the line comes in already mapped.
private struct ProfileLogoRider: View, Animatable {
    var progress: CGFloat
    let track: DiveProfileGeometry.Track

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        if let tip = track.tip(at: Double(progress)) {
            LogoMark()
                .fill(DiveWatchTheme.ink, style: LogoMark.fillStyle)
                .frame(width: PostDiveLayout.riderLogoWidth,
                       height: PostDiveLayout.riderLogoWidth / LogoMark.aspectRatio)
                .rotationEffect(.degrees(tip.degrees + 20))
                .position(tip.point)
                .accessibilityHidden(true)
        }
    }
}

/// The detail's profile, drawn from the surface the first time the page shows (spec DT-PROFILE):
/// the line traces in, the water fades in and the deepest point lands. Reduce Motion fades the
/// finished drawing in; Always-On shows it at once.
struct DiveDrawnProfile: View {
    let points: [CGPoint]
    let accessibilityText: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var progress: CGFloat = 0
    @State private var waterOpacity: Double = 0
    @State private var showsDeepest = false
    @State private var hasDrawn = false

    var body: some View {
        DiveProfileChart(
            points: points,
            accessibilityText: accessibilityText,
            progress: reduceMotion ? 1 : progress,
            waterOpacity: waterOpacity,
            showsDeepest: showsDeepest
        )
        .opacity(reduceMotion ? waterOpacity : 1)
        .onAppear(perform: draw)
    }

    private func draw() {
        guard !hasDrawn else { return }
        hasDrawn = true
        guard !isLuminanceReduced else {
            progress = 1
            waterOpacity = 1
            showsDeepest = true
            return
        }
        if reduceMotion {
            withAnimation(DiveMotion.reducedMotionCurve.animation) {
                waterOpacity = 1
                showsDeepest = true
            }
            return
        }
        withAnimation(.smooth(duration: 0.8)) {
            progress = 1
            waterOpacity = 1
        }
        withAnimation(.snappy(duration: 0.3).delay(0.6)) {
            showsDeepest = true
        }
    }
}

// MARK: - Scrolling

/// Rows shrink a little and dim at the scroll edges (spec LS-EDGE); Reduce Motion keeps the dim only.
private struct DiveScrollEdge: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let scales = !reduceMotion
        return content.scrollTransition { view, phase in
            view
                .scaleEffect(scales && !phase.isIdentity ? 0.94 : 1)
                .opacity(phase.isIdentity ? 1 : 0.75)
        }
    }
}

extension View {
    func diveScrollEdge() -> some View {
        modifier(DiveScrollEdge())
    }
}

extension DiveType.SizeClass {
    /// The recording type step the post-dive chips and hint chip use at this size.
    var postDiveType: DiveType {
        DiveType(sizeClass: self, isTight: false)
    }
}
