import Foundation
import XCTest
@testable import DivenaryWatchApp

final class DisplayAscentRateEstimatorTests: XCTestCase {
    func testReplayingSamplesReportsLatestAndMaximumLiveEstimates() {
        let samples = [
            sample(at: 0, depth: 12.0),
            sample(at: 1, depth: 11.9),
            sample(at: 2, depth: 11.4),
            sample(at: 3, depth: 11.4),
            sample(at: 4, depth: 11.4),
            sample(at: 5, depth: 11.4),
            sample(at: 6, depth: 11.4),
            sample(at: 7, depth: 11.4),
        ]

        let rates = DisplayAscentRateEstimator.rates(for: samples)

        XCTAssertEqual(rates.maximum, 12, accuracy: 0.000001)
        XCTAssertEqual(rates.latest, 0, accuracy: 0.000001)
    }

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

    func testOneRepresentableStepAboveDeadbandAtZeroOffsetIsPositive() {
        var estimator = DisplayAscentRateEstimator()

        XCTAssertEqual(estimator.append(sample(at: 0, depth: 0.15.nextUp)), 0)
        XCTAssertGreaterThan(estimator.append(sample(at: 3, depth: 0)), 0)
    }

    func testOneRepresentableStepAboveDeadbandAtNonZeroDepthIsPositive() {
        var estimator = DisplayAscentRateEstimator()
        let oldestDepth = (12.0 + 0.15).nextUp

        XCTAssertEqual(estimator.append(sample(at: 0, depth: oldestDepth)), 0)
        XCTAssertGreaterThan(estimator.append(sample(at: 3, depth: 12.0)), 0)
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
        let maximumWindowDuration = Double.greatestFiniteMagnitude
        let retainedReferenceInterval = -maximumWindowDuration / 2
        let candidateReferenceInterval = maximumWindowDuration
        let recoveryReferenceInterval = maximumWindowDuration / 2
        let retainedTimestamp = Date(timeIntervalSinceReferenceDate: retainedReferenceInterval)
        let candidateTimestamp = Date(timeIntervalSinceReferenceDate: candidateReferenceInterval)
        let recoveryTimestamp = Date(timeIntervalSinceReferenceDate: recoveryReferenceInterval)
        let retainedToCandidate = candidateTimestamp.timeIntervalSince(retainedTimestamp)
        let retainedToRecovery = recoveryTimestamp.timeIntervalSince(retainedTimestamp)

        XCTAssertTrue(retainedTimestamp.timeIntervalSinceReferenceDate.isFinite)
        XCTAssertTrue(candidateTimestamp.timeIntervalSinceReferenceDate.isFinite)
        XCTAssertTrue(recoveryTimestamp.timeIntervalSinceReferenceDate.isFinite)
        XCTAssertFalse(retainedToCandidate.isFinite)
        XCTAssertTrue(retainedToRecovery.isFinite)
        XCTAssertEqual(retainedToRecovery, maximumWindowDuration)
        XCTAssertLessThanOrEqual(retainedToRecovery, maximumWindowDuration)
        XCTAssertEqual(
            recoveryTimestamp.addingTimeInterval(-maximumWindowDuration).timeIntervalSinceReferenceDate,
            retainedReferenceInterval
        )

        var referenceEstimator = DisplayAscentRateEstimator(maximumWindowDuration: maximumWindowDuration)
        XCTAssertEqual(referenceEstimator.append(sample(timestamp: retainedTimestamp, depth: 20)), 0)
        let expectedRate = referenceEstimator.append(sample(timestamp: recoveryTimestamp, depth: 18))
        XCTAssertTrue(expectedRate.isFinite)
        XCTAssertGreaterThan(expectedRate, 0)

        var estimator = DisplayAscentRateEstimator(maximumWindowDuration: maximumWindowDuration)
        XCTAssertEqual(estimator.append(sample(timestamp: retainedTimestamp, depth: 20)), 0)
        XCTAssertEqual(estimator.append(sample(timestamp: candidateTimestamp, depth: 0)), 0)
        let recoveryRate = estimator.append(sample(timestamp: recoveryTimestamp, depth: 18))

        XCTAssertEqual(recoveryRate, expectedRate)
        XCTAssertTrue(recoveryRate.isFinite)
        XCTAssertGreaterThan(recoveryRate, 0)
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
