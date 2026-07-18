import Foundation
import XCTest
@testable import DivenaryWatchApp

final class DisplayAscentRateEstimatorTests: XCTestCase {
    func testFirstSampleReturnsZero() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
    }

    func testPositiveMovementBeforeMinimumWindowReturnsZero() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 2.9, depth: 10.5)), 0)
    }

    func testThreeSecondWindowReturnsRatePerMinute() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
    }

    func testDeadbandRequiresMoreThanPointFifteenMeters() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 0.15)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 0)), 0)

        estimator.reset()
        XCTAssertEqual(estimator.append(sample(at: 0, depth: 0.14)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 0)), 0)
    }

    func testMovementJustBeyondDeadbandReturnsFinitePositiveRate() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 0.1501)), 0)
        let rate = estimator.append(sample(at: 3, depth: 0))

        XCTAssertTrue(rate.isFinite)
        XCTAssertGreaterThan(rate, 0)
    }

    func testExactDeadbandAtNonZeroDepthReturnsZero() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12.15)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 12.0)), 0)
    }

    func testFlatAndDeeperNewestSamplesReturnZero() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 10)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: 11)), 0)
    }

    func testJitterDoesNotBecomeAnAscentRate() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 10.00)), 0)
        XCTAssertEqual(estimator.append(sample(at: 1, depth: 9.94)), 0)
        XCTAssertEqual(estimator.append(sample(at: 2, depth: 10.03)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 9.90)), 0)
    }

    func testOscillationWithoutNetAscentReturnsZero() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 10)), 0)
        XCTAssertEqual(estimator.append(sample(at: 1, depth: 9)), 0)
        XCTAssertEqual(estimator.append(sample(at: 2, depth: 10.2)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.2)), 0)
    }

    func testSamplesOlderThanFiveSecondsArePruned() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 1, depth: 11)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: 9)), 24, accuracy: 0.000001)
    }

    func testRejectsInvalidDepthWithoutMutatingValidWindow() {
        assertRejectedSamplePreservesWindow(sample(at: 6, depth: .nan))
    }

    func testRejectsInvalidPressureWithoutMutatingValidWindow() {
        assertRejectedSamplePreservesWindow(sample(at: 6, depth: 10, pressure: .nan))
    }

    func testRejectsInvalidTemperatureWithoutMutatingValidWindow() {
        assertRejectedSamplePreservesWindow(sample(at: 6, depth: 10, temperature: .infinity))
    }

    func testRejectsNonFiniteTimestampWithoutMutatingValidWindow() {
        let invalid = sample(
            timestamp: Date(timeIntervalSinceReferenceDate: .infinity),
            depth: 10
        )

        assertRejectedSamplePreservesWindow(invalid)
    }

    func testRejectsFiniteTimestampsWithNonFiniteIntervalWithoutMutatingHistory() {
        let lowerTimestamp = Date(timeIntervalSinceReferenceDate: -Double.greatestFiniteMagnitude)
        let upperTimestamp = Date(timeIntervalSinceReferenceDate: Double.greatestFiniteMagnitude)
        XCTAssertTrue(lowerTimestamp.timeIntervalSinceReferenceDate.isFinite)
        XCTAssertTrue(upperTimestamp.timeIntervalSinceReferenceDate.isFinite)
        XCTAssertFalse(upperTimestamp.timeIntervalSince(lowerTimestamp).isFinite)

        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(timestamp: lowerTimestamp, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(timestamp: upperTimestamp, depth: 0)), 0)
        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
    }

    func testRejectsDuplicateTimestampWithoutMutatingValidWindow() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 0)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: 9)), 30, accuracy: 0.000001)
    }

    func testRejectsOutOfOrderTimestampWithoutMutatingValidWindow() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
        XCTAssertEqual(estimator.append(sample(at: 2, depth: 0)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: 9)), 30, accuracy: 0.000001)
    }

    func testValidSequenceRecoversAfterRejectedInput() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: .nan)), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
    }

    func testResetRemovesAllRetainedHistory() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        estimator.reset()

        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 0)
        XCTAssertEqual(estimator.append(sample(at: 6, depth: 9)), 30, accuracy: 0.000001)
    }

    private func assertRejectedSamplePreservesWindow(_ rejected: DepthSample) {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 12)), 0)
        XCTAssertEqual(estimator.append(rejected), 0)
        XCTAssertEqual(estimator.append(sample(at: 3, depth: 10.5)), 30, accuracy: 0.000001)
    }

    private func sample(
        at seconds: TimeInterval,
        depth: Double,
        pressure: Double = 200,
        temperature: Double? = 24
    ) -> DepthSample {
        sample(timestamp: EngineTestFixtures.date(seconds), depth: depth, pressure: pressure, temperature: temperature)
    }

    private func sample(
        timestamp: Date,
        depth: Double,
        pressure: Double = 200,
        temperature: Double? = 24
    ) -> DepthSample {
        DepthSample(
            timestamp: timestamp,
            depthMeters: depth,
            pressureKPa: pressure,
            waterTemperatureCelsius: temperature
        )
    }
}
