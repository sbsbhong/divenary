import SwiftUI
import XCTest
@testable import DivenaryWatchApp

/// The post-dive screens' pure logic: values split into numbers and units, saved durations and
/// dates, the "(n)" attempt counter, the profile's drawing tip and depth label, the recommended-stop
/// record rows (COPY C6), the summary finale plan (spec PD-FINALE) and the post-dive sizes.
final class DivePostDiveTests: XCTestCase {
    private let korean = Locale(identifier: "ko_KR")
    private let english = Locale(identifier: "en_US")

    // MARK: - Values split into numbers and units

    func testValuePartsSplitNumbersFromTheirUnits() {
        XCTAssertEqual(DiveValueParts.split("42분 10초"), [.number("42"), .text("분"), .number("10"), .text("초")])
        XCTAssertEqual(DiveValueParts.split("22.4 m"), [.number("22.4"), .text("m")])
        XCTAssertEqual(DiveValueParts.split("8.6 m/min"), [.number("8.6"), .text("m/min")])
        XCTAssertEqual(DiveValueParts.split("21.6 °C"), [.number("21.6"), .text("°C")])
        XCTAssertEqual(DiveValueParts.split("42 min, 10 sec"),
                       [.number("42"), .text("min,"), .number("10"), .text("sec")])
    }

    func testValuePartsKeepSeparatorsInsideOneNumber() {
        XCTAssertEqual(DiveValueParts.split("오전 10:39"), [.text("오전"), .number("10:39")])
        XCTAssertEqual(DiveValueParts.split("10:39\u{202F}AM"), [.number("10:39"), .text("AM")])
        XCTAssertEqual(DiveValueParts.split("2,530"), [.number("2,530")])
        XCTAssertEqual(DiveValueParts.split("4/5"), [.number("4/5")])
        XCTAssertEqual(DiveValueParts.split("5.0 m · 3.0–6.0 m"),
                       [.number("5.0"), .text("m ·"), .number("3.0–6.0"), .text("m")])
        // A separator that does not sit between two digits belongs to the text.
        XCTAssertEqual(DiveValueParts.split("5. m"), [.number("5"), .text(". m")])
    }

    func testValuesWithoutDigitsStayOneWord() {
        XCTAssertEqual(DiveValueParts.split("공기"), [.text("공기")])
        XCTAssertEqual(DiveValueParts.split("권장 스탑 완료"), [.text("권장 스탑 완료")])
        XCTAssertEqual(DiveValueParts.split("--"), [.text("--")])
        XCTAssertEqual(DiveValueParts.split("  "), [])
        XCTAssertFalse(DiveValueParts.hasNumber(DiveValueParts.split("약한 물결")))
        XCTAssertTrue(DiveValueParts.hasNumber(DiveValueParts.split("3분")))
    }

    // MARK: - Saved durations, dates and ratings (spec G2)

    func testSavedDurationsReadInWholeUnits() {
        XCTAssertEqual(DiveFormatters.savedDuration(42 * 60 + 10, locale: korean), "42분 10초")
        XCTAssertEqual(DiveFormatters.savedDuration(180, locale: korean), "3분")
        XCTAssertEqual(DiveFormatters.savedDuration(0, locale: korean), "0초")
        XCTAssertEqual(DiveFormatters.savedDuration(-4, locale: korean), "0초")
        XCTAssertEqual(DiveFormatters.savedDuration(42 * 60 + 9.6, locale: korean), "42분 10초")
        XCTAssertEqual(DiveFormatters.savedDuration(3725, locale: korean), "1시간 2분 5초")
        XCTAssertEqual(DiveFormatters.savedDuration(42 * 60 + 10, locale: english), "42 min, 10 sec")
    }

    func testUnknownSavedDurationsShowDashes() {
        XCTAssertEqual(DiveFormatters.savedDuration(nil, locale: korean), "--")
        XCTAssertEqual(DiveFormatters.savedDuration(.nan, locale: korean), "--")
        XCTAssertEqual(DiveFormatters.savedDuration(.infinity, locale: korean), "--")
    }

    func testDayTitleIsTheDateWithTheYearOnlyWhenItIsNotThisYear() {
        let now = date(2026, 10, 23, 1, 21)
        XCTAssertEqual(DiveFormatters.dayTitle(date(2026, 10, 22, 10, 2), now: now, calendar: seoulCalendar, locale: korean),
                       "10월 22일")
        XCTAssertEqual(DiveFormatters.dayTitle(date(2025, 10, 19, 9, 30), now: now, calendar: seoulCalendar, locale: korean),
                       "2025년 10월 19일")
        XCTAssertEqual(DiveFormatters.dayTitle(date(2026, 10, 22, 10, 2), now: now, calendar: seoulCalendar, locale: english),
                       "Oct 22")
    }

    func testTimeOfDayKeepsTheClockOnly() {
        XCTAssertEqual(DiveFormatters.timeOfDay(date(2026, 10, 22, 10, 2), calendar: seoulCalendar, locale: korean),
                       "오전 10:02")
        XCTAssertEqual(DiveFormatters.timeOfDay(date(2026, 10, 22, 15, 5), calendar: seoulCalendar, locale: korean),
                       "오후 3:05")
    }

    func testRatingFillsOneToFiveStars() {
        XCTAssertEqual(DiveFormatters.filledStars(4), 4)
        XCTAssertEqual(DiveFormatters.filledStars(9), 5)
        XCTAssertEqual(DiveFormatters.filledStars(0), 1)
        XCTAssertNil(DiveFormatters.filledStars(nil))
    }

    // MARK: - Failure notes keep their "(n)" counter apart (spec C18)

    func testFailureMessagesSetTheirAttemptCounterApart() {
        XCTAssertEqual(DiveFailureMessage(message: "저장하지 못했습니다. 기록은 보관하고 있습니다. (2)"),
                       DiveFailureMessage(text: "저장하지 못했습니다. 기록은 보관하고 있습니다.", counter: "(2)"))
        XCTAssertEqual(DiveFailureMessage(message: "Couldn’t send. (12)"),
                       DiveFailureMessage(text: "Couldn’t send.", counter: "(12)"))
    }

    func testFailureMessagesWithoutACounterStayWhole() {
        XCTAssertEqual(DiveFailureMessage(message: "기록을 시작하지 못했습니다."),
                       DiveFailureMessage(text: "기록을 시작하지 못했습니다.", counter: nil))
        XCTAssertEqual(DiveFailureMessage(message: "Mode (beta)"), DiveFailureMessage(text: "Mode (beta)", counter: nil))
        XCTAssertEqual(DiveFailureMessage(message: "Try again (2) later"),
                       DiveFailureMessage(text: "Try again (2) later", counter: nil))
    }

    // MARK: - Profile drawing tip and depth label (spec C15, PD-FINALE)

    func testProfileTipFollowsTheLineByLength() {
        let points = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1)]
        let size = CGSize(width: 100, height: 100)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: 0), x: 0, y: 0, degrees: 0)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: 0.25), x: 50, y: 0, degrees: 0)
        // Down the screen is a positive angle: the line descends.
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: 0.75), x: 100, y: 50, degrees: 90)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: 1), x: 100, y: 100, degrees: 90)
    }

    func testProfileTipStaysOnTheLine() {
        let points = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 1)]
        let size = CGSize(width: 30, height: 40)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: -1), x: 0, y: 0, degrees: 53.13)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: 2), x: 30, y: 40, degrees: 53.13)
        assertTip(DiveProfileGeometry.tip(of: points, in: size, fraction: .nan), x: 0, y: 0, degrees: 53.13)
    }

    func testProfileTipOfAShortProfile() {
        XCTAssertNil(DiveProfileGeometry.tip(of: [], in: CGSize(width: 10, height: 10), fraction: 0.5))
        assertTip(DiveProfileGeometry.tip(of: [CGPoint(x: 0.5, y: 0.5)], in: CGSize(width: 10, height: 10), fraction: 0.5),
                  x: 5, y: 5, degrees: 0)
        // A repeated point has no direction; the tip takes the next segment's.
        let repeated = [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0)]
        assertTip(DiveProfileGeometry.tip(of: repeated, in: CGSize(width: 10, height: 10), fraction: 0), x: 0, y: 0, degrees: 0)
    }

    func testDepthLabelSitsAboveAndRightOfTheDeepestPoint() {
        let origin = DiveProfileGeometry.depthLabelOrigin(
            deepest: CGPoint(x: 45.5, y: 42.7), label: CGSize(width: 30, height: 12), bounds: CGSize(width: 175, height: 47)
        )
        XCTAssertEqual(origin.x, 52, accuracy: 0.001)
        XCTAssertEqual(origin.y, 24.2, accuracy: 0.001)
    }

    func testDepthLabelStaysInsideTheProfile() {
        let bounds = CGSize(width: 175, height: 47)
        let label = CGSize(width: 30, height: 12)
        // At the right edge it moves to the left of the point.
        let right = DiveProfileGeometry.depthLabelOrigin(deepest: CGPoint(x: 170, y: 40), label: label, bounds: bounds)
        XCTAssertEqual(right.x, 133.5, accuracy: 0.001)
        // Near the top it never leaves the drawing.
        let shallow = DiveProfileGeometry.depthLabelOrigin(deepest: CGPoint(x: 10, y: 5), label: label, bounds: bounds)
        XCTAssertEqual(shallow.y, 0, accuracy: 0.001)
        // A label wider than the drawing starts at its left edge.
        let wide = DiveProfileGeometry.depthLabelOrigin(deepest: CGPoint(x: 20, y: 40), label: CGSize(width: 200, height: 12),
                                                        bounds: bounds)
        XCTAssertEqual(wide.x, 0, accuracy: 0.001)
    }

    // MARK: - Recommended-stop record rows (COPY C6)

    func testCompletedStopRecordDropsRemainingAndPairsStatusWithTimeInZone() {
        let record = stopRecord(status: .completed, completed: true,
                                startedAt: date(2026, 10, 22, 10, 39), completedAt: date(2026, 10, 22, 10, 42))
        XCTAssertEqual(StopRecordLayout.rows(for: record),
                       [[.status, .timeInZone], [.targetZone], [.started, .completedAt]])
    }

    func testUnfinishedStopRecordShowsWhatRemained() {
        let record = stopRecord(status: .skippedOrIncomplete, completed: false,
                                startedAt: date(2026, 10, 22, 10, 39), completedAt: nil)
        XCTAssertEqual(StopRecordLayout.rows(for: record),
                       [[.status], [.remaining, .timeInZone], [.targetZone], [.started]])
    }

    func testStopRecordWithoutTimesHasNoTimeRow() {
        let record = stopRecord(status: .notRequired, completed: false, startedAt: nil, completedAt: nil)
        XCTAssertEqual(StopRecordLayout.rows(for: record), [[.status], [.remaining, .timeInZone], [.targetZone]])
    }

    // MARK: - Summary finale (spec PD-FINALE)

    func testFinaleDrawsTheProfileAndRidesTheLogoOnLand() {
        let plan = DiveFinalePlan(reduceMotion: false, alwaysOn: false)
        XCTAssertTrue(plan.animates)
        XCTAssertTrue(plan.tracesLine)
        XCTAssertTrue(plan.ridesLogo)
        XCTAssertTrue(plan.bounces)
        // Values rise 6 pt (12 px) and fade in 80 ms apart; they never count up.
        XCTAssertEqual(plan.valueRise, 6)
        XCTAssertEqual(plan.valueStagger, 0.08, accuracy: 0.0001)
        XCTAssertEqual(plan.valueDuration, 0.3, accuracy: 0.0001)
        // The line draws from 150 ms for 900 ms; the logo leaves over 200 ms once it ends.
        XCTAssertEqual(plan.lineDelay, 0.15, accuracy: 0.0001)
        XCTAssertEqual(plan.lineDuration, 0.9, accuracy: 0.0001)
        XCTAssertEqual(plan.riderFadeOutDelay, 1.05, accuracy: 0.0001)
        XCTAssertEqual(plan.riderFadeOutDuration, 0.2, accuracy: 0.0001)
        // The deepest point pops at 900 ms.
        XCTAssertEqual(plan.dotDelay, 0.9, accuracy: 0.0001)
    }

    func testReduceMotionFadesTheFinaleWithoutTheLogo() {
        let plan = DiveFinalePlan(reduceMotion: true, alwaysOn: false)
        XCTAssertTrue(plan.animates)
        XCTAssertFalse(plan.tracesLine)
        XCTAssertFalse(plan.ridesLogo)
        XCTAssertFalse(plan.bounces)
        XCTAssertEqual(plan.valueRise, 0)
        XCTAssertEqual(plan.valueStagger, 0)
        XCTAssertEqual(plan.lineDelay, 0)
        XCTAssertEqual(plan.dotDelay, 0)
        XCTAssertEqual(plan.fadeDuration, 0.2, accuracy: 0.0001)
    }

    func testAlwaysOnShowsTheFinishedSummary() {
        for reduceMotion in [false, true] {
            let plan = DiveFinalePlan(reduceMotion: reduceMotion, alwaysOn: true)
            XCTAssertFalse(plan.animates)
            XCTAssertFalse(plan.ridesLogo)
            XCTAssertFalse(plan.bounces)
        }
    }

    // MARK: - Post-dive sizes (spec C3, C12, C15, D16)

    func testPostDiveSizesFollowTheSpec() {
        XCTAssertEqual(PostDiveLayout.buttonHeight(.regular), 47)
        XCTAssertEqual(PostDiveLayout.buttonHeight(.compact), 44)
        XCTAssertEqual(PostDiveLayout.textGutter(.regular), 18)
        XCTAssertEqual(PostDiveLayout.textGutter(.compact), 15)
        XCTAssertEqual(PostDiveLayout.summaryProfileHeight(.regular), 47)
        // On 42 mm the save status stays clear of the pinned chip (D11).
        XCTAssertEqual(PostDiveLayout.summaryProfileHeight(.compact), 28)
        // The detail's first page fits under the measured watchOS title (D10, D13), so its profile is
        // shorter than the spec's 128 px; after a failed send the depth values start below the fold.
        XCTAssertEqual(PostDiveLayout.detailProfileHeight(.regular, sendFailed: false), 44)
        XCTAssertEqual(PostDiveLayout.detailProfileHeight(.compact, sendFailed: false), 34)
        XCTAssertEqual(PostDiveLayout.detailProfileHeight(.regular, sendFailed: true), 48)
        XCTAssertEqual(PostDiveLayout.detailProfileHeight(.compact, sendFailed: true), 40)
        XCTAssertEqual(PostDiveLayout.listProfileHeight(.regular), 16)
        XCTAssertEqual(PostDiveLayout.listProfileHeight(.compact), 14)
        // The real logo: 28 px riding the profile, 80 px over the empty list (D16).
        XCTAssertEqual(PostDiveLayout.riderLogoWidth, 14)
        XCTAssertEqual(PostDiveLayout.emptyListLogoWidth, 40)
        // The no-samples screen's depth column glyph (COPY C14).
        XCTAssertEqual(PostDiveLayout.noSamplesGlyph, 32)
    }

    // MARK: - Helpers

    private var seoulCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        seoulCalendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func stopRecord(status: SafetyStopStatus, completed: Bool, startedAt: Date?, completedAt: Date?) -> SafetyStopRecord {
        SafetyStopRecord(
            status: status,
            required: false,
            completed: completed,
            targetDepthMeters: 5,
            minDepthMeters: 3,
            maxDepthMeters: 6,
            durationSeconds: 180,
            startedAt: startedAt,
            completedAt: completedAt,
            remainingSeconds: completed ? 0 : 75,
            timeInZoneSeconds: completed ? 180 : 105
        )
    }

    private func assertTip(_ tip: DiveProfileGeometry.Tip?, x: CGFloat, y: CGFloat, degrees: Double,
                           file: StaticString = #filePath, line: UInt = #line) {
        guard let tip else {
            XCTFail("no tip", file: file, line: line)
            return
        }
        XCTAssertEqual(tip.point.x, x, accuracy: 0.001, "x", file: file, line: line)
        XCTAssertEqual(tip.point.y, y, accuracy: 0.001, "y", file: file, line: line)
        XCTAssertEqual(tip.degrees, degrees, accuracy: 0.01, "angle", file: file, line: line)
    }
}
