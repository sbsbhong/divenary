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
        XCTAssertEqual(RecordingGaugeGeometry.tideMarks(maxDepths: []), [])
        XCTAssertEqual(RecordingGaugeGeometry.tideMarks(maxDepths: [10]).map(\.opacity), [0.8])
    }

    // MARK: - Recommended-stop minute indices (P2)

    func testThreeMinuteStopFillsOneIndexPerFinishedMinute() {
        let remaining: [TimeInterval] = [180, 150, 121, 120, 61, 60, 1, 0]
        XCTAssertEqual(remaining.map { RecommendedStopProgress.completedMinutes(remaining: $0, total: 180) },
                       [0, 0, 0, 1, 1, 2, 2, 3])
        XCTAssertEqual(RecommendedStopProgress.indexCount, 3)
    }

    func testStopIndicesStayInsideZeroToThree() {
        XCTAssertEqual(RecommendedStopProgress.completedMinutes(remaining: 200, total: 180), 0)
        XCTAssertEqual(RecommendedStopProgress.completedMinutes(remaining: -5, total: 180), 3)
        XCTAssertEqual(RecommendedStopProgress.completedMinutes(remaining: .nan, total: 180), 0)
        XCTAssertEqual(RecommendedStopProgress.completedMinutes(remaining: 60, total: 0), 0)
        XCTAssertEqual(RecommendedStopProgress.completedMinutes(remaining: 60, total: .infinity), 0)
    }

    // MARK: - Recording type scale (spec B2)

    func testUltraReadoutUsesTheRegularRecordingSizes() {
        let type = DiveType(readoutHeight: 180, showsStorageError: false)
        XCTAssertEqual(type.sizeClass, .regular)
        XCTAssertFalse(type.isTight)
        let expected: [DiveType.Role: CGFloat] = [
            .heroDepth: 56, .heroTime: 52, .heroUnit: 20, .caption: 13, .rowLabel: 12, .rowValue: 22,
            .rowUnit: 15, .stackedValue: 20, .quietValue: 15, .quietUnit: 12, .chip: 12, .hint: 12,
            .tick: 12, .endInstruction: 19, .switchTitle: 20, .note: 13, .waterLock: 12, .stopState: 13,
        ]
        for (role, size) in expected {
            XCTAssertEqual(type.size(role), size, "\(role)")
        }
        XCTAssertEqual(type.slotSpacing, 3)
    }

    func testSeriesReadoutUsesTheCompactRecordingSizes() {
        let type = DiveType(readoutHeight: 150, showsStorageError: false)
        XCTAssertEqual(type.sizeClass, .compact)
        let expected: [DiveType.Role: CGFloat] = [
            .heroDepth: 48, .heroTime: 44, .heroUnit: 17, .caption: 12, .rowLabel: 11, .rowValue: 18,
            .rowUnit: 13, .stackedValue: 17, .quietValue: 14, .quietUnit: 11, .chip: 11, .hint: 11,
            .tick: 11, .endInstruction: 16, .switchTitle: 17, .note: 12, .waterLock: 11, .stopState: 12,
        ]
        for (role, size) in expected {
            XCTAssertEqual(type.size(role), size, "\(role)")
        }
    }

    func testReadoutHeightThresholdPicksTheSizeClass() {
        XCTAssertEqual(DiveType.regularReadoutMinimumHeight, 170)
        XCTAssertEqual(DiveType(readoutHeight: 170, showsStorageError: false).sizeClass, .regular)
        XCTAssertEqual(DiveType(readoutHeight: 169.5, showsStorageError: false).sizeClass, .compact)
        XCTAssertEqual(DiveType(readoutHeight: .nan, showsStorageError: false).sizeClass, .compact)
    }

    func testStorageErrorTightensHeroesRowValuesAndSlots() {
        let ultra = DiveType(readoutHeight: 180, showsStorageError: true)
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
        XCTAssertFalse(DiveMotion.allowsMovement(.autoFade, reduceMotion: false, alwaysOn: false))
        XCTAssertFalse(DiveMotion.allowsMovement(.chip, reduceMotion: false, alwaysOn: false))
        // Nothing that can run underwater lasts longer than 600 ms.
        for kind in [DiveMotion.Kind.diverPage, .autoFade, .chip, .rangeChange] {
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

    // MARK: - Helpers

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

    private func assertPoints(_ points: [CGPoint], _ expected: [(Double, Double)],
                              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(points.count, expected.count, file: file, line: line)
        for (point, pair) in zip(points, expected) {
            XCTAssertEqual(Double(point.x), pair.0, accuracy: 0.0001, file: file, line: line)
            XCTAssertEqual(Double(point.y), pair.1, accuracy: 0.0001, file: file, line: line)
        }
    }
}
