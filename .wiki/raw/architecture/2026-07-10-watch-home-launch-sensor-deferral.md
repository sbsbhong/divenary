# Watch home launch sensor deferral

Source: implementation change, 2026-07-10.

## Context

On a real watch, the app could launch to a black screen where only the system time was visible. The likely failure boundary was watch Home initialization: `HomeView` created the real depth sensor auto-start monitor and read `DepthSensorAvailability.current` while the view was being initialized, before any user-visible home content had a chance to render.

`DepthSensorAvailability.current` touches `CMWaterSubmersionManager.waterSubmersionAvailable`, `CMWaterSubmersionManager.authorizationStatus`, and `WKInterfaceDevice.current().waterResistanceRating`. `RealDepthSensorProvider` also owns a `CMWaterSubmersionManager`. These APIs should not be required for the first Home frame.

## Decision

Watch Home now starts with `DepthSensorAvailability.launchPlaceholder`, which is only a non-ready placeholder state. It renders the Home UI first, then `loadInitialSensorAvailability()` runs on the main actor after `Task.yield()`.

Only after that deferred check reports `canStartRealDive` does Home create `RealDepthSensorProvider()` and call `DiveAutoStartMonitor.startMonitoringIfAvailable(sensorProvider:)`.

## Consequences

- The first Home frame no longer depends on CoreMotion underwater depth availability checks or real sensor provider construction.
- Unsupported/simulator devices still show the normal disabled real-start state after the deferred availability check.
- Automatic dive start remains gated by `DepthSensorAvailability.canStartRealDive`.
- This is a launch robustness fix, not proof that real underwater sensor behavior or watch auto-launch has passed physical-device validation.
