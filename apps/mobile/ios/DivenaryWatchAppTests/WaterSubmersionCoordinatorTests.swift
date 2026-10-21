import Combine
import CoreMotion
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class WaterSubmersionCoordinatorTests: XCTestCase {
    func testBackgroundEventForwardingHopsToMainActorWithScalarSnapshot() async {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        let delivered = expectation(description: "event delivered")
        coordinator.onEvent = { state, timestamp in
            MainActor.preconditionIsolated()
            XCTAssertEqual(state, .submerged)
            XCTAssertEqual(timestamp, self.date(2))
            delivered.fulfill()
        }

        let ranOffMain = await Task.detached {
            coordinator.forwardEvent(
                state: .submerged,
                at: EngineTestFixtures.date(2),
                maximumDepthMeters: 12
            )
            return !Thread.isMainThread
        }.value

        XCTAssertTrue(ranOffMain)
        await fulfillment(of: [delivered], timeout: 1)
        XCTAssertEqual(coordinator.latestState, .submerged)
        XCTAssertEqual(coordinator.maximumDepthMeters, 12)
    }

    func testBackgroundMeasurementForwardingHopsToMainActorWithScalarSnapshot() async throws {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        let delivered = expectation(description: "sample delivered")
        var receivedSample: DepthSample?
        coordinator.onSample = { sample in
            MainActor.preconditionIsolated()
            receivedSample = sample
            delivered.fulfill()
        }

        let ranOffMain = await Task.detached {
            coordinator.forwardMeasurement(
                timestamp: EngineTestFixtures.date(4),
                depthMeters: 0.15,
                pressureKPa: 102.8,
                depthState: .submergedShallow,
                maximumDepthMeters: 14
            )
            return !Thread.isMainThread
        }.value

        XCTAssertTrue(ranOffMain)
        await fulfillment(of: [delivered], timeout: 1)
        let sample = try XCTUnwrap(receivedSample)
        XCTAssertEqual(sample.timestamp, date(4))
        XCTAssertEqual(sample.depthMeters, 0.15, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(sample.pressureKPa), 102.8, accuracy: 0.001)
        XCTAssertEqual(coordinator.latestDepthState, .submergedShallow)
        XCTAssertEqual(coordinator.maximumDepthMeters, 14)
    }

    func testBackgroundTemperatureForwardingHopsToMainActorWithScalarSnapshot() async throws {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        let delivered = expectation(description: "temperature delivered")
        let cancellable = coordinator.$maximumDepthMeters.dropFirst().sink { maximumDepthMeters in
            MainActor.preconditionIsolated()
            if maximumDepthMeters == 16 {
                delivered.fulfill()
            }
        }
        defer { cancellable.cancel() }

        let ranOffMain = await Task.detached {
            coordinator.forwardTemperature(celsius: 18.4, maximumDepthMeters: 16)
            return !Thread.isMainThread
        }.value

        XCTAssertTrue(ranOffMain)
        await fulfillment(of: [delivered], timeout: 1)
        var receivedSample: DepthSample?
        coordinator.onSample = { receivedSample = $0 }
        coordinator.receiveMeasurement(
            timestamp: date(5),
            depthMeters: 1,
            pressureKPa: 103,
            depthState: .submergedShallow
        )
        XCTAssertEqual(try XCTUnwrap(receivedSample?.waterTemperatureCelsius), 18.4, accuracy: 0.001)
        XCTAssertEqual(coordinator.maximumDepthMeters, 16)
    }

    func testBackgroundErrorForwardingHopsToMainActorWithSendableDescription() async {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        let delivered = expectation(description: "error delivered")
        coordinator.onError = { error in
            MainActor.preconditionIsolated()
            XCTAssertEqual(error.localizedDescription, "pressure sensor unavailable")
            delivered.fulfill()
        }

        let ranOffMain = await Task.detached {
            coordinator.forwardError(
                description: "pressure sensor unavailable",
                maximumDepthMeters: 18
            )
            return !Thread.isMainThread
        }.value

        XCTAssertTrue(ranOffMain)
        await fulfillment(of: [delivered], timeout: 1)
        XCTAssertEqual(coordinator.maximumDepthMeters, 18)
    }

    func testMapsEverySubmersionEventState() {
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .unknown), .unknown)
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .notSubmerged), .notSubmerged)
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .submerged), .submerged)
    }

    func testMapsEverySubmersionDepthState() {
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .unknown), .unknown)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .notSubmerged), .notSubmerged)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .submergedShallow), .submergedShallow)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .submergedDeep), .submergedDeep)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .approachingMaxDepth), .approachingMaxDepth)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .pastMaxDepth), .pastMaxDepth)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .sensorDepthError), .sensorDepthError)
    }

    func testValidMeasurementProducesSampleUsingLatestTemperature() throws {
        let result = WaterSubmersionCoordinator.makeSample(
            timestamp: date(4),
            depthMeters: 0.15,
            pressureKPa: 102.8,
            temperatureCelsius: 18.4,
            depthState: .submergedShallow
        )
        let sample = try XCTUnwrap(result)
        XCTAssertEqual(sample.depthMeters, 0.15, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(sample.waterTemperatureCelsius), 18.4, accuracy: 0.001)
    }

    func testMeasurementReusesLatestValidTemperature() throws {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedSamples: [DepthSample] = []
        coordinator.onSample = { receivedSamples.append($0) }

        coordinator.receiveTemperature(celsius: 18.4)
        coordinator.receiveMeasurement(
            timestamp: date(4),
            depthMeters: 0.15,
            pressureKPa: 102.8,
            depthState: .submergedShallow
        )

        let sample = try XCTUnwrap(receivedSamples.first)
        XCTAssertEqual(try XCTUnwrap(sample.waterTemperatureCelsius), 18.4, accuracy: 0.001)
    }

    func testValidMeasurementPublishesLatestDepthMeters() throws {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })

        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 1),
            depthMeters: 0.12,
            pressureKPa: 102.4,
            depthState: .submergedShallow
        )

        XCTAssertEqual(try XCTUnwrap(coordinator.latestDepthMeters), 0.12, accuracy: 0.001)
    }

    func testNotSubmergedEventClearsLatestDepthMeters() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 1),
            depthMeters: 0.12,
            pressureKPa: 102.4,
            depthState: .submergedShallow
        )

        coordinator.receiveEvent(state: .notSubmerged, at: Date(timeIntervalSince1970: 2))

        XCTAssertNil(coordinator.latestDepthMeters)
    }

    func testSensorDepthErrorClearsLatestDepthMeters() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 1),
            depthMeters: 0.12,
            pressureKPa: 102.4,
            depthState: .submergedShallow
        )

        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 2),
            depthMeters: nil,
            pressureKPa: nil,
            depthState: .sensorDepthError
        )

        XCTAssertNil(coordinator.latestDepthMeters)
    }

    func testMeasurementForwardsDepthStateBeforeTheSample() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var events: [String] = []
        coordinator.onDepthState = { state, timestamp in
            events.append("state:\(state):\(timestamp.timeIntervalSince1970)")
        }
        coordinator.onSample = { sample in
            events.append("sample:\(sample.depthMeters)")
        }

        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 1),
            depthMeters: 4.2,
            pressureKPa: 143.0,
            depthState: .submergedShallow
        )
        coordinator.receiveMeasurement(
            timestamp: Date(timeIntervalSince1970: 2),
            depthMeters: nil,
            pressureKPa: nil,
            depthState: .pastMaxDepth
        )

        XCTAssertEqual(events, [
            "state:submergedShallow:1.0",
            "sample:4.2",
            "state:pastMaxDepth:2.0",
        ])
    }

    func testRealProviderReportsRangeAndSensorFailuresAsConditions() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        let provider = RealDepthSensorProvider(coordinator: coordinator)
        var conditions: [DepthSensorCondition] = []
        provider.onCondition = { conditions.append($0) }
        provider.start()

        coordinator.forwardMaximumDepthForTesting(6)
        coordinator.receiveMeasurement(
            timestamp: date(1), depthMeters: 3, pressureKPa: 130, depthState: .submergedShallow
        )
        coordinator.receiveMeasurement(
            timestamp: date(2), depthMeters: nil, pressureKPa: nil, depthState: .pastMaxDepth
        )
        coordinator.receiveMeasurement(
            timestamp: date(3), depthMeters: nil, pressureKPa: nil, depthState: .sensorDepthError
        )
        coordinator.receive(error: TestError.expected)
        provider.stop()
        coordinator.receiveMeasurement(
            timestamp: date(4), depthMeters: nil, pressureKPa: nil, depthState: .sensorDepthError
        )

        XCTAssertEqual(conditions.count, 4)
        XCTAssertEqual(conditions[0], .normal(at: date(1)))
        XCTAssertEqual(conditions[1], .beyondSensorRange(limitMeters: 6, at: date(2)))
        XCTAssertEqual(conditions[2], .sensorError(at: date(3)))
        guard case .sensorError = conditions[3] else {
            return XCTFail("Expected a sensor error condition for a Core Motion error")
        }
    }

    func testMissingDepthOrPressureDoesNotProduceSample() {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: nil, pressureKPa: 101.3,
            temperatureCelsius: nil, depthState: .submergedShallow
        ))
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: nil,
            temperatureCelsius: nil, depthState: .submergedShallow
        ))
    }

    func testNonFiniteDepthOrPressureDoesNotProduceSampleAndNonFiniteTemperatureIsOmitted() throws {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: .infinity, pressureKPa: 101.3,
            temperatureCelsius: 18.4, depthState: .submergedShallow
        ))
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: .nan,
            temperatureCelsius: 18.4, depthState: .submergedShallow
        ))

        let sample = try XCTUnwrap(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: 101.3,
            temperatureCelsius: -.infinity, depthState: .submergedShallow
        ))
        XCTAssertNil(sample.waterTemperatureCelsius)
    }

    func testSensorDepthErrorDoesNotProduceSample() {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: 101.3,
            temperatureCelsius: 18.4, depthState: .sensorDepthError
        ))
    }

    func testEventUpdatesStateAndForwardsTimestamp() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedEvent: (WaterSubmersionState, Date)?
        coordinator.onEvent = { receivedEvent = ($0, $1) }

        coordinator.receiveEvent(state: .submerged, at: date(2))

        XCTAssertEqual(coordinator.latestState, .submerged)
        XCTAssertEqual(receivedEvent?.0, .submerged)
        XCTAssertEqual(receivedEvent?.1, date(2))
    }

    func testErrorIsForwarded() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedError: Error?
        coordinator.onError = { receivedError = $0 }

        coordinator.receive(error: TestError.expected)

        XCTAssertEqual(receivedError as? TestError, .expected)
    }

    func testUnavailableManagerDoesNotStartMonitoring() {
        var factoryInvocationCount = 0
        let coordinator = WaterSubmersionCoordinator(managerFactory: {
            factoryInvocationCount += 1
            return nil
        })

        coordinator.startMonitoring()

        XCTAssertEqual(factoryInvocationCount, 1)
        XCTAssertEqual(coordinator.latestState, .unknown)
        XCTAssertNil(coordinator.maximumDepthMeters)
    }

    func testRepeatedStartMonitoringCreatesAtMostOneManager() {
        var factoryInvocationCount = 0
        let coordinator = WaterSubmersionCoordinator(managerFactory: {
            factoryInvocationCount += 1
            return nil
        })

        coordinator.startMonitoring()
        coordinator.startMonitoring()

        XCTAssertEqual(factoryInvocationCount, 1)
    }

    func testMaximumDepthConvertsAuthorizedLengthToMeters() throws {
        let maximumDepth = Measurement(value: 20, unit: UnitLength.feet)
        let meters = try XCTUnwrap(WaterSubmersionCoordinator.maximumDepthMeters(from: maximumDepth))

        XCTAssertEqual(meters, 6.096, accuracy: 0.001)
    }

    private func date(_ seconds: TimeInterval) -> Date {
        EngineTestFixtures.date(seconds)
    }

    private enum TestError: Error, Equatable {
        case expected
    }
}
