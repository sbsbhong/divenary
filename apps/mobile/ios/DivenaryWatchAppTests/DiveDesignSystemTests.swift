import SwiftUI
import XCTest
@testable import DivenaryWatchApp

/// The Plumb design system's pure logic: gauge geometry, depth-anchored water colours, label yield,
/// the stop zone, freedive tide marks, recommended-stop minute indices, the recording type scale,
/// the motion rules and the custom shapes.
final class DiveDesignSystemTests: XCTestCase {
    /// Recording instrument heights from spec C7: Ultra y 118–444 px, Series 42mm y 108–380 px.
    private let ultraHeight: CGFloat = 163
    private let seriesHeight: CGFloat = 136

    // MARK: - Depth-anchored water colours (DECISIONS D1)

    func testWaterAnchorsAreFixedToMetres() {
        XCTAssertEqual(DiveWatchTheme.waterStops.map(\.depthMeters), [0, 10, 40])
        XCTAssertEqual(DiveWatchTheme.waterStops.map(\.rgb),
                       [DiveRGB(hex: 0x2F7FD1), DiveRGB(hex: 0x1F5A99), DiveRGB(hex: 0x0B2547)])
        XCTAssertEqual(DiveRGB(hex: 0x2F7FD1), DiveRGB(red: 47.0 / 255, green: 127.0 / 255, blue: 209.0 / 255))
    }

    func testWaterAtThirtyMetresPutsTenMetresAtOneThird() {
        let stops = RecordingGaugeGeometry.waterColorStops(upperBound: 30)
        assertLocations(stops, [0, 1.0 / 3.0, 1])
        assertRGB(stops[0].rgb, 47, 127, 209)
        assertRGB(stops[1].rgb, 31, 90, 153)
        // 30 m is two thirds of the way from the 10 m anchor to the 40 m anchor.
        assertRGB(stops[2].rgb, 17.667, 54.667, 98.333)
        // The design canvas writes this end colour as about #11355F.
        assertRGB(stops[2].rgb, 0x11, 0x35, 0x5F, accuracy: 4)
    }

    func testWaterAtFortyMetresEndsOnTheDeepAnchor() {
        let stops = RecordingGaugeGeometry.waterColorStops(upperBound: 40)
        assertLocations(stops, [0, 0.25, 1])
        assertRGB(stops[0].rgb, 47, 127, 209)
        assertRGB(stops[1].rgb, 31, 90, 153)
        assertRGB(stops[2].rgb, 11, 37, 71)
    }

    func testWaterOnTheTenMetreStopRangeRunsBetweenTheTwoShallowAnchors() {
        let stops = RecordingGaugeGeometry.waterColorStops(upperBound: 10)
        assertLocations(stops, [0, 1])
        assertRGB(stops[0].rgb, 47, 127, 209)
        assertRGB(stops[1].rgb, 31, 90, 153)
    }

    func testWaterOnASixMetreLimitStopsPartWayToTheTenMetreAnchor() {
        let stops = RecordingGaugeGeometry.waterColorStops(upperBound: 6)
        assertLocations(stops, [0, 1])
        assertRGB(stops[1].rgb, 37.4, 104.8, 175.4)
        // The design canvas writes this end colour as about #2569AD.
        assertRGB(stops[1].rgb, 0x25, 0x69, 0xAD, accuracy: 4)
    }

    func testWaterBeyondFortyMetresStaysOnTheDeepAnchor() {
        let stops = RecordingGaugeGeometry.waterColorStops(upperBound: 50)
        assertLocations(stops, [0, 0.2, 0.8, 1])
        assertRGB(stops[2].rgb, 11, 37, 71)
        assertRGB(stops[3].rgb, 11, 37, 71)
        assertRGB(RecordingGaugeGeometry.waterColor(atDepth: 20), 24.333, 72.333, 125.667)
        assertRGB(RecordingGaugeGeometry.waterColor(atDepth: -3), 47, 127, 209)
    }

    func testWaterGradientStopsCarryTheSameLocations() {
        XCTAssertEqual(RecordingGaugeGeometry.waterGradientStops(upperBound: 30).map(\.location).count, 3)
        let locations = RecordingGaugeGeometry.waterGradientStops(upperBound: 30).map { Double($0.location) }
        for (location, expected) in zip(locations, [0, 1.0 / 3.0, 1]) {
            XCTAssertEqual(location, expected, accuracy: 0.0001)
        }
        // An unreadable range falls back to the 30 m default, like RecordingGaugeScale.
        assertLocations(RecordingGaugeGeometry.waterColorStops(upperBound: .nan), [0, 1.0 / 3.0, 1])
    }

    // MARK: - Vertical mapping (spec C8)

    func testDepthMapsInsideTheRailInsetOnUltra() {
        let geometry = geometry(range: 30)
        XCTAssertEqual(geometry.y(forDepth: 0, height: ultraHeight), 7, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: 30, height: ultraHeight), 156, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: 18.6, height: ultraHeight), 99.38, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: 22.4, height: ultraHeight), 118.2533, accuracy: 0.001)

        let stop = self.geometry(range: 10)
        XCTAssertEqual(stop.y(forDepth: 3, height: ultraHeight), 51.7, accuracy: 0.001)
        XCTAssertEqual(stop.y(forDepth: 5, height: ultraHeight), 81.5, accuracy: 0.001)
        XCTAssertEqual(stop.y(forDepth: 6, height: ultraHeight), 96.4, accuracy: 0.001)
    }

    func testDepthMappingOnSeriesAndOutOfRangeValues() {
        let geometry = geometry(range: 30)
        XCTAssertEqual(geometry.y(forDepth: 0, height: seriesHeight), 7, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: 15, height: seriesHeight), 68, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: 30, height: seriesHeight), 129, accuracy: 0.001)
        // Nothing is drawn below the visible range or above the surface.
        XCTAssertEqual(geometry.y(forDepth: 35, height: ultraHeight), 156, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: -2, height: ultraHeight), 7, accuracy: 0.001)
        XCTAssertEqual(geometry.y(forDepth: .nan, height: ultraHeight), 7, accuracy: 0.001)
        // A 6 m watch caps the rail at its limit.
        let limited = RecordingGaugeGeometry(scale: RecordingGaugeScale(maximumDepthMeters: 6, rangeMeters: 30))
        XCTAssertEqual(limited.y(forDepth: 6, height: ultraHeight), 156, accuracy: 0.001)
        XCTAssertEqual(limited.y(forDepth: 9, height: ultraHeight), 156, accuracy: 0.001)
    }

    // MARK: - Label yield

    func testTickLabelYieldsWithinEightPointsOfTheCurrentDepth() {
        let geometry = geometry(range: 30)
        // 10 m sits at 56.67 pt; 11.5 m is 7.45 pt below it, 11.7 m is 8.44 pt below it.
        XCTAssertEqual(geometry.labelOpacity(tick: 10, currentDepth: 11.5, height: ultraHeight), 0.25)
        XCTAssertEqual(geometry.labelOpacity(tick: 10, currentDepth: 8.5, height: ultraHeight), 0.25)
        XCTAssertEqual(geometry.labelOpacity(tick: 10, currentDepth: 11.7, height: ultraHeight), 1)
        XCTAssertEqual(geometry.labelOpacity(tick: 0, currentDepth: 0.5, height: ultraHeight), 0.25)
        XCTAssertEqual(geometry.labelOpacity(tick: 20, currentDepth: 11.5, height: ultraHeight), 1)
        // No current depth, no yield.
        XCTAssertEqual(geometry.labelOpacity(tick: 10, currentDepth: nil, height: ultraHeight), 1)
        XCTAssertEqual(geometry.labelOpacity(tick: 10, currentDepth: .nan, height: ultraHeight), 1)
    }

    // MARK: - Stop zone

    func testStopZoneSpansThreeToSixMetresOnTheTenMetreRange() throws {
        let zone = try XCTUnwrap(geometry(range: 10).stopZoneFrame(zone: 3...6, height: ultraHeight))
        XCTAssertEqual(zone.lowerBound, 51.7, accuracy: 0.001)
        XCTAssertEqual(zone.upperBound, 96.4, accuracy: 0.001)
    }

    func testStopZoneNeverDrawsShorterThanEighteenPoints() throws {
        let zone = try XCTUnwrap(geometry(range: 40).stopZoneFrame(zone: 3...6, height: ultraHeight))
        XCTAssertEqual(zone.upperBound - zone.lowerBound, 18, accuracy: 0.001)
        XCTAssertEqual(zone.lowerBound, 14.7625, accuracy: 0.001)
        XCTAssertEqual(zone.upperBound, 32.7625, accuracy: 0.001)
        XCTAssertEqual(RecordingGaugeGeometry.minimumStopZoneHeight, 18)
    }

    func testStopZoneShiftsInsideTheGaugeInsteadOfShrinking() throws {
        let geometry = geometry(range: 10)
        let top = try XCTUnwrap(geometry.stopZoneFrame(zone: 0...0.5, height: 40))
        XCTAssertEqual(top.lowerBound, 0, accuracy: 0.001)
        XCTAssertEqual(top.upperBound, 18, accuracy: 0.001)
        let bottom = try XCTUnwrap(geometry.stopZoneFrame(zone: 9.5...10, height: 40))
        XCTAssertEqual(bottom.lowerBound, 22, accuracy: 0.001)
        XCTAssertEqual(bottom.upperBound, 40, accuracy: 0.001)
    }

    func testStopZoneOutsideTheSupportedLimitIsClippedOrHidden() throws {
        let limited = RecordingGaugeGeometry(scale: RecordingGaugeScale(maximumDepthMeters: 6, rangeMeters: 10))
        XCTAssertNil(limited.stopZoneFrame(zone: 7...9, height: ultraHeight))
        let clipped = try XCTUnwrap(limited.stopZoneFrame(zone: 3...8, height: ultraHeight))
        XCTAssertEqual(clipped.lowerBound, 81.5, accuracy: 0.001)
        XCTAssertEqual(clipped.upperBound, 156, accuracy: 0.001)
    }

    // MARK: - Freedive tide marks (P5)

    func testTideMarksKeepTheLastFiveDivesWithTheNewestBrightest() {
        let marks = RecordingGaugeGeometry.tideMarks(maxDepths: [8, 12, 15, 11, 18, 21, 16])
        XCTAssertEqual(marks.map(\.depthMeters), [15, 11, 18, 21, 16])
        XCTAssertEqual(marks.map(\.opacity), [0.35, 0.35, 0.35, 0.35, 0.8])
        // Each mark keeps its dive's place in the session, so a new dive never re-labels the others.
        XCTAssertEqual(marks.map(\.diveIndex), [2, 3, 4, 5, 6])
        XCTAssertEqual(RecordingGaugeGeometry.tideMarkLimit, 5)
    }

    func testTideMarksOnTheDetailsPageAreStronger() {
        let marks = RecordingGaugeGeometry.tideMarks(maxDepths: [8, 12, 15], emphasis: .details)
        XCTAssertEqual(marks.map(\.depthMeters), [8, 12, 15])
        XCTAssertEqual(marks.map(\.opacity), [0.5, 0.5, 1.0])
    }

    func testTideMarksSkipUnreadableDives() {
        let marks = RecordingGaugeGeometry.tideMarks(maxDepths: [.nan, 9, .infinity, 0, -1, 7])
        XCTAssertEqual(marks.map(\.depthMeters), [9, 7])
        XCTAssertEqual(marks.map(\.opacity), [0.35, 0.8])
        XCTAssertEqual(marks.map(\.diveIndex), [1, 5])
        XCTAssertEqual(RecordingGaugeGeometry.tideMarks(maxDepths: []), [])
        XCTAssertEqual(RecordingGaugeGeometry.tideMarks(maxDepths: [10]).map(\.opacity), [0.8])
    }

    // MARK: - Recommended-stop minute indices (P2)

    func testThreeMinuteStopFillsOneIndexPerFinishedMinute() {
        let remaining: [TimeInterval] = [180, 150, 121, 120, 61, 60, 1, 0]
        XCTAssertEqual(remaining.map { RecommendedStopProgress.completedIndices(remaining: $0, total: 180) },
                       [0, 0, 0, 1, 1, 2, 2, 3])
        XCTAssertEqual(RecommendedStopProgress.indexCount, 3)
    }

    func testStopIndicesStayInsideZeroToThree() {
        XCTAssertEqual(RecommendedStopProgress.completedIndices(remaining: 200, total: 180), 0)
        XCTAssertEqual(RecommendedStopProgress.completedIndices(remaining: -5, total: 180), 3)
        XCTAssertEqual(RecommendedStopProgress.completedIndices(remaining: .nan, total: 180), 0)
        XCTAssertEqual(RecommendedStopProgress.completedIndices(remaining: 60, total: 0), 0)
        XCTAssertEqual(RecommendedStopProgress.completedIndices(remaining: 60, total: .infinity), 0)
    }

    // MARK: - Recording type scale (spec B2)

    func testUltraPageUsesTheRegularRecordingSizes() {
        let type = DiveType(pageWidth: 205, showsStorageError: false)
        XCTAssertEqual(type.sizeClass, .regular)
        XCTAssertFalse(type.isTight)
        let expected: [DiveType.Role: CGFloat] = [
            .heroDepth: 56, .heroTime: 52, .heroUnit: 20, .caption: 13, .rowLabel: 12, .rowValue: 22,
            .rowUnit: 15, .stackedValue: 20, .quietValue: 15, .quietUnit: 12, .chip: 12, .hint: 12,
            .tick: 12, .endInstruction: 19, .endValue: 17, .switchTitle: 20, .note: 13, .waterLock: 12,
            .stopState: 13,
        ]
        for (role, size) in expected {
            XCTAssertEqual(type.size(role), size, "\(role)")
        }
        XCTAssertEqual(type.slotSpacing, 3)
    }

    func testSeriesPageUsesTheCompactRecordingSizes() {
        let type = DiveType(pageWidth: 187, showsStorageError: false)
        XCTAssertEqual(type.sizeClass, .compact)
        let expected: [DiveType.Role: CGFloat] = [
            .heroDepth: 48, .heroTime: 44, .heroUnit: 17, .caption: 12, .rowLabel: 11, .rowValue: 18,
            .rowUnit: 13, .stackedValue: 17, .quietValue: 14, .quietUnit: 11, .chip: 11, .hint: 11,
            .tick: 11, .endInstruction: 16, .endValue: 15, .switchTitle: 17, .note: 12, .waterLock: 11,
            .stopState: 12,
        ]
        for (role, size) in expected {
            XCTAssertEqual(type.size(role), size, "\(role)")
        }
    }

    /// Ultra 205/211 pt, Series 46 mm 208 and 45 mm 198 are regular; 44, 42, 41 and 40 mm are compact.
    func testPageWidthPicksTheSizeClass() {
        XCTAssertEqual(DiveType.regularPageMinimumWidth, 195)
        for width: CGFloat in [211, 205, 208, 198, 195] {
            XCTAssertEqual(DiveType(pageWidth: width, showsStorageError: false).sizeClass, .regular, "\(width)")
        }
        for width: CGFloat in [194.5, 184, 187, 176, 162, 0, .nan] {
            XCTAssertEqual(DiveType(pageWidth: width, showsStorageError: false).sizeClass, .compact, "\(width)")
        }
    }

    func testOnlyAStorageErrorTakesTheTightStep() {
        XCTAssertFalse(DiveType(pageWidth: 162, showsStorageError: false).isTight)
        XCTAssertFalse(DiveType(pageWidth: 211, showsStorageError: false).isTight)
        XCTAssertTrue(DiveType(pageWidth: 211, showsStorageError: true).isTight)
        XCTAssertTrue(DiveType(pageWidth: 187, showsStorageError: true).isTight)
    }

    /// Spec C7: every page reserves the caption slot, so the hero baseline sits on one line
    /// (Ultra column top 118 px → baseline 256 px; Series 108 px → 224 px).
    func testColumnSlotsPutTheHeroBaselineOnOneLine() {
        let ultra = DiveType(sizeClass: .regular, isTight: false)
        XCTAssertEqual(ultra.captionSlotHeight, 16)
        XCTAssertEqual(ultra.heroSlotHeight, 60)
        XCTAssertEqual(ultra.heroBaselineInset, 7)
        XCTAssertEqual(ultra.heroRowGap, 4)
        XCTAssertEqual(ultra.stateSlotHeight, 16)
        XCTAssertEqual(ultra.bottomSlotHeight, 16)
        XCTAssertEqual((ultra.captionSlotHeight + ultra.heroSlotHeight - ultra.heroBaselineInset) * 2, 256 - 118)

        let series = DiveType(sizeClass: .compact, isTight: false)
        XCTAssertEqual(series.captionSlotHeight, 14)
        XCTAssertEqual(series.heroSlotHeight, 50)
        XCTAssertEqual(series.heroBaselineInset, 6)
        XCTAssertEqual(series.heroRowGap, 2)
        XCTAssertEqual(series.stateSlotHeight, 12)
        XCTAssertEqual(series.bottomSlotHeight, 13)
        XCTAssertEqual((series.captionSlotHeight + series.heroSlotHeight - series.heroBaselineInset) * 2, 224 - 108)

        // The tight step shrinks the hero slot with the hero, never the caption slot.
        XCTAssertEqual(DiveType(sizeClass: .regular, isTight: true).heroSlotHeight, 52)
        XCTAssertEqual(DiveType(sizeClass: .compact, isTight: true).heroSlotHeight, 44)
        XCTAssertEqual(DiveType(sizeClass: .regular, isTight: true).captionSlotHeight, 16)
    }

    func testStatusBandSitsUnderTheClockAndClearsTheDemoToolbar() {
        let ultra = DiveType(sizeClass: .regular, isTight: false)
        let series = DiveType(sizeClass: .compact, isTight: false)
        XCTAssertEqual(ultra.statusBandTop * 2, 72)
        XCTAssertEqual(series.statusBandTop * 2, 62)
        // Chips start right of the xmark circle: 4 pt side padding + clearance = D10's x.
        XCTAssertEqual((4 + ultra.toolbarClearance) * 2, 118)
        XCTAssertEqual((4 + series.toolbarClearance) * 2, 104)
    }

    func testStopMinuteIndicesFollowTheSizeClass() {
        XCTAssertEqual(DiveType(sizeClass: .regular, isTight: false).stopIndexSize, CGSize(width: 12, height: 4))
        XCTAssertEqual(DiveType(sizeClass: .compact, isTight: false).stopIndexSize, CGSize(width: 10, height: 3))
        XCTAssertEqual(DiveType.stopIndexGap, 3)
    }

    func testStorageErrorTightensHeroesRowValuesAndSlots() {
        let ultra = DiveType(pageWidth: 205, showsStorageError: true)
        XCTAssertTrue(ultra.isTight)
        XCTAssertEqual(ultra.size(.heroDepth), 48)
        XCTAssertEqual(ultra.size(.heroTime), 44)
        XCTAssertEqual(ultra.size(.rowValue), 18)
        XCTAssertEqual(ultra.size(.caption), 13)
        XCTAssertEqual(ultra.slotSpacing, 1)

        let series = DiveType(sizeClass: .compact, isTight: true)
        XCTAssertEqual(series.size(.heroDepth), 42)
        XCTAssertEqual(series.size(.heroTime), 38)
        XCTAssertEqual(series.size(.rowValue), 16)
        XCTAssertEqual(series.size(.hint), 11)
    }

    func testRecordingTypeKeepsTheElevenPointFloorAndTheWeightLadder() {
        let variants = [DiveType(sizeClass: .regular, isTight: false), DiveType(sizeClass: .regular, isTight: true),
                        DiveType(sizeClass: .compact, isTight: false), DiveType(sizeClass: .compact, isTight: true)]
        for type in variants {
            for role in DiveType.Role.allCases {
                XCTAssertGreaterThanOrEqual(type.size(role), 11, "\(role)")
            }
        }
        let allowed: [Font.Weight] = [.regular, .semibold, .bold]
        for role in DiveType.Role.allCases {
            XCTAssertTrue(allowed.contains(DiveType.weight(role)), "\(role)")
            XCTAssertNotEqual(DiveType.weight(role), .medium, "\(role)")
        }
        XCTAssertEqual(DiveType.weight(.rowLabel), .regular)
        XCTAssertEqual(DiveType.weight(.heroDepth), .semibold)
        XCTAssertTrue(DiveType.usesMetricDigits(.heroDepth))
        XCTAssertFalse(DiveType.usesMetricDigits(.hint))
    }

    // MARK: - Motion (spec D, DECISIONS D12–D14, D18)

    func testMotionCurvesFollowTheSpec() {
        XCTAssertEqual(DiveMotion.curve(.press, reduceMotion: false, alwaysOn: false), .snappy(duration: 0.25))
        XCTAssertEqual(DiveMotion.curve(.diverPage, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.35))
        XCTAssertEqual(DiveMotion.curve(.autoFade, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.45))
        XCTAssertEqual(DiveMotion.curve(.chip, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.35))
        XCTAssertEqual(DiveMotion.curve(.rangeChange, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.6))
        XCTAssertEqual(DiveMotion.curve(.finale, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.5))
        XCTAssertEqual(DiveMotion.curve(.recordingStart, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.5))
        XCTAssertEqual(DiveMotion.curve(.signal, reduceMotion: false, alwaysOn: false), .easeOut(duration: 0.3))
        XCTAssertNotNil(DiveMotion.press(reduceMotion: false, alwaysOn: false))
        XCTAssertNotNil(DiveMotion.diverPage(reduceMotion: false, alwaysOn: false))
        XCTAssertNotNil(DiveMotion.autoFade(reduceMotion: false, alwaysOn: false))
        XCTAssertNotNil(DiveMotion.chip(reduceMotion: false, alwaysOn: false))
        XCTAssertNotNil(DiveMotion.rangeChange(reduceMotion: false, alwaysOn: false))
        XCTAssertNotNil(DiveMotion.finale(reduceMotion: false, alwaysOn: false))
        XCTAssertEqual(DiveMotion.pageOffset, 6)
    }

    func testOnlyDiverActionsAndTheStopRangeMove() {
        XCTAssertTrue(DiveMotion.allowsMovement(.press, reduceMotion: false, alwaysOn: false))
        XCTAssertTrue(DiveMotion.allowsMovement(.diverPage, reduceMotion: false, alwaysOn: false))
        XCTAssertTrue(DiveMotion.allowsMovement(.rangeChange, reduceMotion: false, alwaysOn: false))
        XCTAssertTrue(DiveMotion.allowsMovement(.finale, reduceMotion: false, alwaysOn: false))
        // Starting a recording is the diver's own act: the rail grows down from the top.
        XCTAssertTrue(DiveMotion.allowsMovement(.recordingStart, reduceMotion: false, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsMovement(.autoFade, reduceMotion: false, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsMovement(.chip, reduceMotion: false, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsMovement(.signal, reduceMotion: false, alwaysOn: false))
        // Nothing that can run underwater lasts longer than 600 ms.
        for kind in [DiveMotion.Kind.diverPage, .autoFade, .chip, .rangeChange, .recordingStart, .signal] {
            XCTAssertLessThanOrEqual(DiveMotion.curve(kind, reduceMotion: false, alwaysOn: false)?.duration ?? 0, 0.6)
        }
    }

    func testReduceMotionTurnsEveryMoveIntoAShortFade() {
        for kind in DiveMotion.Kind.allCases {
            XCTAssertEqual(DiveMotion.curve(kind, reduceMotion: true, alwaysOn: false), .easeInOut(duration: 0.2), "\(kind)")
            XCTAssertFalse(DiveMotion.allowsMovement(kind, reduceMotion: true, alwaysOn: false), "\(kind)")
        }
    }

    func testAlwaysOnTurnsEveryAnimationOff() {
        for kind in DiveMotion.Kind.allCases {
            for reduceMotion in [false, true] {
                XCTAssertNil(DiveMotion.curve(kind, reduceMotion: reduceMotion, alwaysOn: true), "\(kind)")
                XCTAssertNil(DiveMotion.animation(kind, reduceMotion: reduceMotion, alwaysOn: true), "\(kind)")
                XCTAssertFalse(DiveMotion.allowsMovement(kind, reduceMotion: reduceMotion, alwaysOn: true), "\(kind)")
            }
        }
        XCTAssertNil(DiveMotion.press(reduceMotion: false, alwaysOn: true))
        XCTAssertNil(DiveMotion.diverPage(reduceMotion: false, alwaysOn: true))
        XCTAssertNil(DiveMotion.autoFade(reduceMotion: false, alwaysOn: true))
        XCTAssertNil(DiveMotion.chip(reduceMotion: false, alwaysOn: true))
        XCTAssertNil(DiveMotion.rangeChange(reduceMotion: false, alwaysOn: true))
        XCTAssertNil(DiveMotion.finale(reduceMotion: false, alwaysOn: true))
    }

    func testAlwaysOnSettlesForThreeHundredMillisecondsWithoutMoving() {
        XCTAssertEqual(DiveMotion.alwaysOnSettle, .easeInOut(duration: 0.3))
        // The settle is the only motion Always-On keeps, and Reduce Motion keeps it too: it only fades.
        XCTAssertEqual(DiveMotion.alwaysOnSettleCurve(reduceMotion: false), .easeInOut(duration: 0.3))
        XCTAssertEqual(DiveMotion.alwaysOnSettleCurve(reduceMotion: true), .easeInOut(duration: 0.3))
    }

    func testOnlyTheDiversOwnPageChangeSlides() {
        XCTAssertEqual(DiveMotion.pageMove(userInitiated: true, forward: true, reduceMotion: false, alwaysOn: false),
                       .slide(offset: 6))
        // Turning the crown back reverses the direction.
        XCTAssertEqual(DiveMotion.pageMove(userInitiated: true, forward: false, reduceMotion: false, alwaysOn: false),
                       .slide(offset: -6))
        // Automatic returns and Reduce Motion only cross-fade.
        XCTAssertEqual(DiveMotion.pageMove(userInitiated: false, forward: true, reduceMotion: false, alwaysOn: false), .fade)
        XCTAssertEqual(DiveMotion.pageMove(userInitiated: true, forward: true, reduceMotion: true, alwaysOn: false), .fade)
        // Always-On changes the page with no transition at all.
        for userInitiated in [false, true] {
            for reduceMotion in [false, true] {
                XCTAssertEqual(DiveMotion.pageMove(userInitiated: userInitiated, forward: true,
                                                   reduceMotion: reduceMotion, alwaysOn: true), DiveMotion.PageMove.none)
                XCTAssertNil(DiveMotion.pageCurve(userInitiated: userInitiated, reduceMotion: reduceMotion, alwaysOn: true))
            }
        }
        XCTAssertEqual(DiveMotion.pageCurve(userInitiated: true, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.35))
        XCTAssertEqual(DiveMotion.pageCurve(userInitiated: false, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.45))
        XCTAssertEqual(DiveMotion.pageCurve(userInitiated: true, reduceMotion: true, alwaysOn: false), .easeInOut(duration: 0.2))
    }

    func testLandMotionFollowsTheSpec() {
        XCTAssertEqual(DiveMotion.curve(.homeEnter, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.5))
        XCTAssertEqual(DiveMotion.curve(.ready, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.25))
        XCTAssertEqual(DiveMotion.curve(.arm, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.6))
        XCTAssertEqual(DiveMotion.curve(.profileDraw, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.6))
        XCTAssertEqual(DiveMotion.curve(.selection, reduceMotion: false, alwaysOn: false), .easeInOut(duration: 0.2))
        XCTAssertEqual(DiveMotion.curve(.screenEnter, reduceMotion: false, alwaysOn: false), .easeOut(duration: 0.3))
        XCTAssertEqual(DiveMotion.curve(.illustration, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.6))
        // Wet Ready can be underwater: the mode fill slides smoothly and never overshoots (D13).
        XCTAssertEqual(DiveMotion.curve(.modeSlide, reduceMotion: false, alwaysOn: false), .smooth(duration: 0.3))
        // Home rises 8 pt into place, one item every 40 ms.
        XCTAssertEqual(DiveMotion.homeEnterOffset, 8)
        XCTAssertEqual(DiveMotion.homeEnterDelay(index: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(DiveMotion.homeEnterDelay(index: 3), 0.12, accuracy: 0.0001)
        XCTAssertEqual(DiveMotion.homeEnterDelay(index: -2), 0, accuracy: 0.0001)
        // A chosen plan shows its check, then the screen pops back.
        XCTAssertEqual(DiveMotion.planDismissDelay(reduceMotion: false), 0.35, accuracy: 0.0001)
        XCTAssertEqual(DiveMotion.planDismissDelay(reduceMotion: true), 0.2, accuracy: 0.0001)
    }

    func testOnlyLandMotionMovesOrBounces() {
        for kind in [DiveMotion.Kind.homeEnter, .arm, .profileDraw, .modeSlide, .illustration] {
            XCTAssertTrue(DiveMotion.allowsMovement(kind, reduceMotion: false, alwaysOn: false), "\(kind)")
        }
        for kind in [DiveMotion.Kind.ready, .selection, .screenEnter] {
            XCTAssertFalse(DiveMotion.allowsMovement(kind, reduceMotion: false, alwaysOn: false), "\(kind)")
        }
        // The plan check bounces once on land; Reduce Motion and Always-On drop it.
        XCTAssertTrue(DiveMotion.allowsLandBounce(reduceMotion: false, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsLandBounce(reduceMotion: true, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsLandBounce(reduceMotion: false, alwaysOn: true))
    }

    func testDepthSamplesGlideLinearlyAndJumpUnderReduceMotionOrAlwaysOn() {
        XCTAssertEqual(DiveMotion.depthGlideCurve(reduceMotion: false, alwaysOn: false), .linear(duration: 0.3))
        XCTAssertNil(DiveMotion.depthGlideCurve(reduceMotion: true, alwaysOn: false))
        XCTAssertNil(DiveMotion.depthGlideCurve(reduceMotion: false, alwaysOn: true))
    }

    // MARK: - Max-depth ghost (spec C8)

    func testMaxDepthGhostHidesOffScaleAndUnderTheIndex() {
        let live = geometry(range: 30)
        XCTAssertTrue(live.showsMaxDepthGhost(maxDepth: 22.4, currentDepth: 18.6, height: ultraHeight))
        XCTAssertTrue(live.showsMaxDepthGhost(maxDepth: 22.4, currentDepth: nil, height: ultraHeight))
        // 19 m sits 2.1 pt below the 18.6 m index, so the index already covers it.
        XCTAssertFalse(live.showsMaxDepthGhost(maxDepth: 19, currentDepth: 18.6, height: ultraHeight))
        XCTAssertFalse(live.showsMaxDepthGhost(maxDepth: 0.4, currentDepth: 0.4, height: ultraHeight))
        // 22.4 m is off the 0–10 m stop range.
        XCTAssertFalse(geometry(range: 10).showsMaxDepthGhost(maxDepth: 22.4, currentDepth: 5.2, height: ultraHeight))
        XCTAssertTrue(geometry(range: 10).showsMaxDepthGhost(maxDepth: 8, currentDepth: 5.2, height: ultraHeight))
        // No reading yet, or an unreadable one, draws no ghost.
        XCTAssertFalse(live.showsMaxDepthGhost(maxDepth: nil, currentDepth: 3, height: ultraHeight))
        XCTAssertFalse(live.showsMaxDepthGhost(maxDepth: 0, currentDepth: nil, height: ultraHeight))
        XCTAssertFalse(live.showsMaxDepthGhost(maxDepth: .nan, currentDepth: nil, height: ultraHeight))
    }

    // MARK: - Value rows and hero (spec C9, C10)

    func testValueRowDrawsTheUnitOfAFormattedValueSmaller() {
        assertRow(ValueRow(label: "수심", formattedValue: "5.2 m"), value: "5.2", unit: "m")
        assertRow(ValueRow(label: "다이빙 시간", formattedValue: "21:40"), value: "21:40", unit: nil)
        assertRow(ValueRow(label: "상승", formattedValue: "0.4 m/min"), value: "0.4", unit: "m/min")
        assertRow(ValueRow(label: "수온", formattedValue: "21.3 °C"), value: "21.3", unit: "°C")
        assertRow(ValueRow(label: "직전 다이빙", formattedValue: "01:06 · 14.2 m"), value: "01:06 · 14.2", unit: "m")
    }

    func testValueRowKeepsAnUnknownReadingAsGreyDashes() {
        let depth = ValueRow(label: "수심", formattedValue: "--.- m")
        XCTAssertNil(depth.value)
        XCTAssertEqual(depth.placeholder, "--.-")
        XCTAssertEqual(depth.unit, "m")
        let time = ValueRow(label: "다이빙 시간", formattedValue: "--:--")
        XCTAssertNil(time.value)
        XCTAssertEqual(time.placeholder, "--:--")
        XCTAssertNil(time.unit)
        let lastDive = ValueRow(label: "직전 다이빙", formattedValue: "--:-- · --.- m")
        XCTAssertNil(lastDive.value)
        XCTAssertEqual(lastDive.placeholder, "--:-- · --.-")
    }

    func testValueRowSlotsNeverCollideWhenLabelsRepeat() {
        let slots = ValueRows.slots([ValueRow(label: "수심", value: "1"), ValueRow(label: "수심", value: "2")])
        XCTAssertEqual(Set(slots.map(\.id)).count, 2)
        XCTAssertEqual(slots.map(\.row.value), ["1", "2"])
    }

    func testMetricHeroReadsAnUnknownValueAsUnavailable() {
        XCTAssertEqual(MetricHero.accessibilityValue(value: "18.6", unit: "m", kind: .depth), "18.6 m")
        XCTAssertEqual(MetricHero.accessibilityValue(value: "02:14", unit: nil, kind: .time), "02:14")
        XCTAssertEqual(MetricHero.accessibilityValue(value: nil, unit: "m", kind: .depth),
                       String(localized: "Depth unavailable"))
        XCTAssertEqual(MetricHero.accessibilityValue(value: nil, unit: nil, kind: .time),
                       String(localized: "Not available"))
    }

    // MARK: - Mini depth profile (spec C15)

    func testProfilePointsPutTheSurfaceOnTopWithHeadroomBelowTheDeepestPoint() {
        let points = MiniDepthProfile.normalizedPoints(depths: [0, 10, 20, 10, 0])
        assertPoints(points, [(0, 0), (0.25, 10.0 / 22), (0.5, 20.0 / 22), (0.75, 10.0 / 22), (1, 0)])
        let deepest = MiniDepthProfile.deepestPoint(in: points)
        XCTAssertEqual(deepest?.x ?? -1, 0.5, accuracy: 0.0001)
        XCTAssertEqual(deepest?.y ?? -1, 20.0 / 22, accuracy: 0.0001)
    }

    func testProfilePointsSkipUnreadableDepthsAndNeverDivideByZero() {
        assertPoints(MiniDepthProfile.normalizedPoints(depths: [.nan, 5, -1, .infinity, 10]),
                     [(0, 5.0 / 11), (0.5, 0), (1, 10.0 / 11)])
        XCTAssertEqual(MiniDepthProfile.normalizedPoints(depths: []), [])
        assertPoints(MiniDepthProfile.normalizedPoints(depths: [0, 0]), [(0, 0), (1, 0)])
        assertPoints(MiniDepthProfile.normalizedPoints(depths: [7]), [(0, 1 / 1.1)])
        XCTAssertNil(MiniDepthProfile.deepestPoint(in: []))
    }

    func testLongProfilesAreThinnedWithoutLosingTheDeepestPoint() {
        var depths = (0..<1_000).map { Double($0 % 50) / 10 }
        depths[437] = 22.4
        let thinned = MiniDepthProfile.thinnedDepths(depths, maximumCount: 100)
        XCTAssertEqual(thinned.count, 100)
        XCTAssertEqual(thinned.max(), 22.4)
        XCTAssertEqual(thinned.first, 0.9)  // the deepest of the first ten readings
        // Short profiles stay as they are.
        XCTAssertEqual(MiniDepthProfile.thinnedDepths([0, 4, 9, 4, 0], maximumCount: 100), [0, 4, 9, 4, 0])
        XCTAssertEqual(MiniDepthProfile.thinnedDepths([], maximumCount: 100), [])
        XCTAssertEqual(MiniDepthProfile.thinnedDepths([1, 2, 3], maximumCount: 0), [])
    }

    @MainActor
    func testAProfileDrawsItselfOnlyTheFirstTimeItIsShown() {
        let log = DiveProfileDrawLog()
        let first = UUID()
        XCTAssertFalse(log.hasDrawn(first))
        XCTAssertTrue(log.claimFirstDraw(first))
        XCTAssertTrue(log.hasDrawn(first))
        XCTAssertFalse(log.claimFirstDraw(first))
        XCTAssertTrue(log.claimFirstDraw(UUID()))
    }

    func testProfileLineAndAreaShapes() {
        let points = MiniDepthProfile.normalizedPoints(depths: [0, 10, 20, 10, 0])
        let rect = CGRect(x: 0, y: 0, width: 100, height: 22)
        let line = MiniDepthProfile(points: points).path(in: rect).boundingRect
        XCTAssertEqual(line.minX, 0, accuracy: 0.001)
        XCTAssertEqual(line.minY, 0, accuracy: 0.001)
        XCTAssertEqual(line.width, 100, accuracy: 0.001)
        XCTAssertEqual(line.height, 20, accuracy: 0.001)
        // The area is the water above the diver: from the surface down to the line.
        let area = MiniDepthProfile(points: points, style: .area).path(in: rect)
        XCTAssertTrue(area.contains(CGPoint(x: 50, y: 5)))
        XCTAssertTrue(area.contains(CGPoint(x: 10, y: 1)))
        XCTAssertFalse(area.contains(CGPoint(x: 50, y: 21)))
        XCTAssertFalse(area.contains(CGPoint(x: 10, y: 8)))
    }

    // MARK: - Logo and glyphs (LOGO.md, DECISIONS D16–D17)

    func testLogoMarkTracesTheRealLogoWithItsEyeHole() {
        let rect = CGRect(x: 0, y: 0, width: 81, height: 64)
        let path = LogoMark().path(in: rect)
        let bounds = path.boundingRect
        XCTAssertEqual(bounds.minX, 0.8, accuracy: 0.01)
        XCTAssertEqual(bounds.minY, 0.7, accuracy: 0.01)
        XCTAssertEqual(bounds.maxX, 79.9, accuracy: 0.01)
        XCTAssertEqual(bounds.maxY, 63, accuracy: 0.01)
        // Core Graphics answers the way the fill renders; SwiftUI's `contains(_:eoFill:)` misreads
        // this outline at some interior points.
        XCTAssertTrue(path.cgPath.contains(CGPoint(x: 41, y: 26), using: .evenOdd))
        XCTAssertTrue(path.cgPath.contains(CGPoint(x: 21, y: 36), using: .evenOdd))
        XCTAssertFalse(path.cgPath.contains(CGPoint(x: 61, y: 51), using: .evenOdd))
        // The eye is a hole under both fill rules.
        XCTAssertFalse(path.cgPath.contains(CGPoint(x: 36.2, y: 9.4), using: .evenOdd))
        XCTAssertFalse(path.cgPath.contains(CGPoint(x: 36.2, y: 9.4), using: .winding))
        XCTAssertTrue(path.cgPath.contains(CGPoint(x: 41, y: 26), using: .winding))
        XCTAssertEqual(LogoMark.aspectRatio, 81.0 / 64.0, accuracy: 0.0001)
    }

    func testLogoMarkKeepsItsProportionsInAWideFrame() {
        let bounds = LogoMark().path(in: CGRect(x: 0, y: 0, width: 162, height: 64)).boundingRect
        // Fitted to the height and centred: the 81-wide mark sits 40.5 pt from the left.
        XCTAssertEqual(bounds.minX, 40.5 + 0.8, accuracy: 0.01)
        XCTAssertEqual(bounds.maxX, 40.5 + 79.9, accuracy: 0.01)
        XCTAssertEqual(bounds.maxY, 63, accuracy: 0.01)
    }

    func testDepthColumnGlyphDrawsTheEmptyAndHalfColumns() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let empty = DepthColumnGlyph(variant: .empty).path(in: rect)
        let half = DepthColumnGlyph(variant: .half).path(in: rect)
        for path in [empty, half] {
            XCTAssertTrue(path.contains(CGPoint(x: 9, y: 12)))   // column outline
            XCTAssertTrue(path.contains(CGPoint(x: 5, y: 7)))    // tick
            XCTAssertFalse(path.contains(CGPoint(x: 12.5, y: 6)))  // open column above the water
        }
        XCTAssertFalse(empty.contains(CGPoint(x: 12.5, y: 15)))
        XCTAssertTrue(half.contains(CGPoint(x: 12.5, y: 15)))
        XCTAssertTrue(DepthColumnGlyph(variant: .half).path(in: CGRect(x: 0, y: 0, width: 48, height: 48))
            .contains(CGPoint(x: 25, y: 30)))
    }

    func testDiveModeGlyphsDrawTheMonofinAndTheTank() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let monofin = DiveModeGlyph(mode: .freedive).path(in: rect)
        XCTAssertTrue(monofin.contains(CGPoint(x: 12, y: 8)))     // the stem
        XCTAssertTrue(monofin.contains(CGPoint(x: 6, y: 19.5)))   // the blade
        XCTAssertFalse(monofin.contains(CGPoint(x: 4, y: 6)))
        let tank = DiveModeGlyph(mode: .scuba).path(in: rect)
        XCTAssertTrue(tank.contains(CGPoint(x: 12, y: 14)))       // the cylinder
        XCTAssertTrue(tank.contains(CGPoint(x: 12, y: 4)))        // the valve
        XCTAssertTrue(tank.contains(CGPoint(x: 18.8, y: 8.5)))    // the hose
        XCTAssertFalse(tank.contains(CGPoint(x: 4, y: 4)))
        // The 24-unit grid is fitted and centred in a wider frame; the monofin is symmetric on it.
        let wide = DiveModeGlyph(mode: .freedive).path(in: CGRect(x: 0, y: 0, width: 48, height: 24)).boundingRect
        XCTAssertEqual(wide.midX, 24, accuracy: 0.2)
        XCTAssertEqual(wide.height, 18, accuracy: 0.5)
    }

    func testDivenarySymbolNamesDrawTheCustomGlyphs() {
        XCTAssertEqual(DiveSymbol.Kind(name: "divenary.freedive"), .mode(.freedive))
        XCTAssertEqual(DiveSymbol.Kind(name: "divenary.scuba"), .mode(.scuba))
        XCTAssertEqual(DiveSymbol.Kind(name: "divenary.column"), .column(.empty))
        XCTAssertEqual(DiveSymbol.Kind(name: "divenary.column.half"), .column(.half))
        XCTAssertEqual(DiveSymbol.Kind(name: "list.bullet"), .system("list.bullet"))
        // Never Apple's water symbol (D17): the depth column stands in for it.
        XCTAssertNotEqual(DiveSymbol.Kind(name: "divenary.column.half"), .system("water.waves"))
    }

    // MARK: - Off-recording type and layout (spec B2 second table, B3, C2, C3, C19)

    func testOffRecordingTypeStartsFromTheLargeTextSize() {
        // Base sizes are the Large text size (the 42 mm default); xLarge (the Ultra default) scales up.
        let expected: [(DiveUIType.Role, CGFloat, Font.Weight, Bool)] = [
            (.headline, 16, .semibold, false), (.body, 16, .regular, false),
            (.footnote, 13, .regular, false), (.footnoteEmphasis, 13, .semibold, false),
            (.eyebrow, 12, .semibold, false), (.title3, 19, .semibold, false),
            // White on the selected blue tile needs 15 pt / 600 on every watch (D13).
            (.wetMode, 15, .semibold, false), (.wetTruth, 13, .semibold, false),
            (.wetGuide, 13, .regular, false), (.crownHint, 12, .regular, false),
            (.metricXL, 36, .semibold, true), (.metricL, 30, .semibold, true),
            (.metricM, 20, .semibold, true), (.statValue, 19, .semibold, true),
            (.cardDepth, 22, .semibold, true), (.listDepth, 19, .semibold, true),
            (.unitL, 15, .semibold, true), (.unitM, 12, .semibold, true),
            (.cardDate, 14, .semibold, false), (.cardDetail, 14, .regular, false),
            (.cardUnit, 13, .semibold, true), (.cardMarker, 12, .regular, false),
            (.footnoteMetric, 13, .semibold, true),
        ]
        XCTAssertEqual(expected.count, DiveUIType.Role.allCases.count)
        for (role, size, weight, metric) in expected {
            XCTAssertEqual(DiveUIType.baseSize(role), size, "\(role)")
            XCTAssertEqual(DiveUIType.weight(role), weight, "\(role)")
            XCTAssertEqual(DiveUIType.usesMetricDigits(role), metric, "\(role)")
        }
    }

    func testScreenWidthPicksTheOffRecordingSizeClass() {
        XCTAssertEqual(DiveType.SizeClass(screenWidth: 205), .regular)  // Ultra 49 mm
        XCTAssertEqual(DiveType.SizeClass(screenWidth: 198), .regular)  // Series 45 mm
        XCTAssertEqual(DiveType.SizeClass(screenWidth: 187), .compact)  // Series 42 mm
        XCTAssertEqual(DiveType.SizeClass(screenWidth: 162), .compact)
    }

    func testStartCardKeepsTheSixtyFourPointFloor() {
        let ultra = DiveLayout.StartCard(.regular)
        XCTAssertEqual(ultra.height, 72)
        XCTAssertEqual(ultra.glyphDisc, 36)
        XCTAssertEqual(ultra.glyph, 22)
        XCTAssertEqual(ultra.playDisc, 32)
        XCTAssertEqual(ultra.playGlyph, 13)
        XCTAssertEqual(ultra.discToTitle, 10)
        XCTAssertEqual(ultra.padding, 12)
        XCTAssertEqual(ultra.radius, 18)
        let series = DiveLayout.StartCard(.compact)
        XCTAssertEqual(series.height, 64)
        XCTAssertEqual(series.glyphDisc, 30)
        XCTAssertEqual(series.glyph, 20)
        XCTAssertEqual(series.playDisc, 30)
        XCTAssertEqual(series.playGlyph, 12)
        XCTAssertEqual(series.discToTitle, 8)
        XCTAssertEqual(series.padding, 10)
        XCTAssertEqual(series.radius, 16)
        for card in [ultra, series] {
            XCTAssertGreaterThanOrEqual(card.height, 64)
            // The arming ring sits 3 pt outside the play disc.
            XCTAssertEqual(card.armingRing, card.playDisc + 6)
        }
    }

    func testOffRecordingRowsTilesAndGutters() {
        XCTAssertEqual(DiveLayout.platterInset(.regular), 6)
        XCTAssertEqual(DiveLayout.platterInset(.compact), 5)
        XCTAssertEqual(DiveLayout.platterPadding(.regular), 12)
        XCTAssertEqual(DiveLayout.platterPadding(.compact), 10)
        XCTAssertEqual(DiveLayout.rowHeight(.regular, hasDetail: false), 48)
        XCTAssertEqual(DiveLayout.rowHeight(.regular, hasDetail: true), 54)
        XCTAssertEqual(DiveLayout.rowHeight(.compact, hasDetail: false), 46)
        XCTAssertEqual(DiveLayout.rowHeight(.compact, hasDetail: true), 52)
        XCTAssertEqual(DiveLayout.rowIcon(.regular), 17)
        XCTAssertEqual(DiveLayout.rowIcon(.compact), 16)
        XCTAssertEqual(DiveLayout.rowIconColumn, 24)
        XCTAssertEqual(DiveLayout.wetTileHeight(.regular), 64)
        XCTAssertEqual(DiveLayout.wetTileHeight(.compact), 58)
        XCTAssertEqual(DiveLayout.wetGutter(.regular), 12)
        XCTAssertEqual(DiveLayout.wetGutter(.compact), 10)
        XCTAssertEqual(DiveLayout.sparklineHeight(.regular), 30)
        XCTAssertEqual(DiveLayout.sparklineHeight(.compact), 26)
        // The Home footer's logo is 64 px wide (D16).
        XCTAssertEqual(DiveLayout.footerLogoWidth, 32)
    }

    // MARK: - Off-recording formats (spec C4, C11, G2)

    func testRelativeDatesSayTodayYesterdayAndTomorrow() {
        let calendar = seoulCalendar
        let now = date(2026, 10, 22, 10, 46)
        let korean = Locale(identifier: "ko_KR")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2026, 10, 22, 10, 2), now: now, calendar: calendar, locale: korean),
                       "오늘 오전 10:02")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2026, 10, 21, 15, 5), now: now, calendar: calendar, locale: korean),
                       "어제 오후 3:05")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2026, 10, 23, 9, 0), now: now, calendar: calendar, locale: korean),
                       "내일 오전 9:00")
        // Newer English time formats put a narrow no-break space before AM/PM.
        let english = DiveFormatters.relativeDate(date(2026, 10, 21, 15, 5), now: now, calendar: calendar,
                                                  locale: Locale(identifier: "en_US"))
        XCTAssertEqual(english.replacingOccurrences(of: "\u{202F}", with: " "), "Yesterday 3:05 PM")
    }

    func testOtherDatesShowTheYearOnlyWhenItIsNotThisYear() {
        let calendar = seoulCalendar
        let now = date(2026, 10, 22, 10, 46)
        let korean = Locale(identifier: "ko_KR")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2026, 10, 19, 9, 30), now: now, calendar: calendar, locale: korean),
                       "10월 19일 오전 9:30")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2026, 10, 24, 9, 30), now: now, calendar: calendar, locale: korean),
                       "10월 24일 오전 9:30")
        XCTAssertEqual(DiveFormatters.relativeDate(date(2025, 10, 19, 9, 30), now: now, calendar: calendar, locale: korean),
                       "2025년 10월 19일 오전 9:30")
    }

    func testCardDurationShowsWholeMinutesOrSecondsUnderAMinute() {
        let korean = Locale(identifier: "ko_KR")
        XCTAssertEqual(DiveFormatters.cardDuration(48 * 60, locale: korean), "48분")
        XCTAssertEqual(DiveFormatters.cardDuration(42 * 60 + 50, locale: korean), "42분")
        XCTAssertEqual(DiveFormatters.cardDuration(65 * 60, locale: korean), "1시간 5분")
        XCTAssertEqual(DiveFormatters.cardDuration(40, locale: korean), "40초")
        XCTAssertEqual(DiveFormatters.cardDuration(-5, locale: korean), "0초")
        XCTAssertEqual(DiveFormatters.cardDuration(48 * 60, locale: Locale(identifier: "en_US")), "48 min")
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

    private func geometry(range: Double) -> RecordingGaugeGeometry {
        RecordingGaugeGeometry(scale: RecordingGaugeScale(maximumDepthMeters: 40, rangeMeters: range))
    }

    private func assertLocations(_ stops: [GaugeWaterStop], _ expected: [Double],
                                 file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(stops.count, expected.count, file: file, line: line)
        for (stop, location) in zip(stops, expected) {
            XCTAssertEqual(stop.location, location, accuracy: 0.0001, file: file, line: line)
        }
    }

    private func assertRGB(_ rgb: DiveRGB, _ red: Double, _ green: Double, _ blue: Double, accuracy: Double = 0.01,
                           file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(rgb.red * 255, red, accuracy: accuracy, "red", file: file, line: line)
        XCTAssertEqual(rgb.green * 255, green, accuracy: accuracy, "green", file: file, line: line)
        XCTAssertEqual(rgb.blue * 255, blue, accuracy: accuracy, "blue", file: file, line: line)
    }

    private func assertRow(_ row: ValueRow, value: String, unit: String?,
                           file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(row.value, value, file: file, line: line)
        XCTAssertEqual(row.unit, unit, file: file, line: line)
    }

    private func assertPoints(_ points: [CGPoint], _ expected: [(Double, Double)],
                              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(points.count, expected.count, file: file, line: line)
        for (point, pair) in zip(points, expected) {
            XCTAssertEqual(Double(point.x), pair.0, accuracy: 0.0001, file: file, line: line)
            XCTAssertEqual(Double(point.y), pair.1, accuracy: 0.0001, file: file, line: line)
        }
    }
}
