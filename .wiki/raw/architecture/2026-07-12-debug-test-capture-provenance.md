Source URL: apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift
Collected: 2026-07-12
Published: 2026-07-12

# Debug test capture provenance

The `DiveWatchAppDebug` scheme exposes `Test Freedive` and `Test Scuba` so simulator and debug builds can exercise recording, persistence, WatchConnectivity delivery, mobile import, and log review without underwater hardware.

These controls use `DemoDepthSensorProvider`, so their generated samples must not be represented as measurements from a physical watch sensor. They keep the existing contract-compatible `captureMode: demo` value and add the durable `debug-test-capture` tag. Watch summary/list/detail and mobile log detail use that tag to label the record `Test` instead of the generic `Demo` label. They otherwise use the same persistence and sync path as ordinary watch sessions.

Inspection of the active paired simulators showed recent debug scuba and freedive records with `syncStatus: synced`; debug capture mode is not excluded from WatchConnectivity import.
