Source URL: project conversation; docs/superpowers/specs/2026-07-18-watch-underwater-runtime-lifecycle-design.md; docs/superpowers/plans/2026-07-18-watch-underwater-runtime-lifecycle.md; docs/2026-07-18-watch-underwater-runtime-device-checklist.md; local implementation
Collected: 2026-07-18
Published: 2026-07-18

# Watch underwater runtime lifecycle implementation and device boundary

Lifecycle Tasks 1-6 changed the Divenary watch app's real recording path to follow watchOS underwater extended-runtime ownership. The device boundary remains explicit: simulator and build evidence are not proof of physical Core Motion samples, `When Submerged`, Water Lock, Digital Crown termination, system out-of-water timeout, Action Button behavior, signing, or provisioning.

Implemented code facts:

- `DivenaryWatchApp.entitlements` declares the public `com.apple.developer.submerged-shallow-depth-and-pressure` capability, and `Info.plist` keeps `WKBackgroundModes` with `underwater-depth`.
- `DiveAppServices` owns one process-scoped `WaterSubmersionCoordinator`, `DiveRuntimeSessionController`, real recorder, and `RealDiveSessionCoordinator`.
- `WaterSubmersionCoordinator` is the sole production owner of `CMWaterSubmersionManager`; `RealDepthSensorProvider` only subscribes the real recorder to its samples.
- `WKApplicationDelegate.handle(_:)` immediately passes a system-supplied `WKExtendedRuntimeSession` to the runtime controller for adoption. System auto-launch, manual start, and Action Button start all enter the same real coordinator.
- automatic and Action Button starts use `DiveSessionStore.preferredDiveMode`, not a selected planned dive. Manual starts keep their explicit plan.
- real-session ending is runtime invalidation after Water Lock removal, a surfaced `>=180s (3 minutes)` Action Button request, or watchOS's continuous `>600s (10 minutes)` out-of-water rule. The app has no `600-second (10-minute)` timer and does not end on one `notSubmerged` event.
- real recordings have no touch end control. Demo/debug recordings keep Crown depth simulation and a surface-gated touch end path, without `WKExtendedRuntimeSession`.
- invalidation with samples creates one summary; manual/Action Button no-sample attempts show one compact result without saving, while system auto-launch no-sample attempts cancel silently.

The repository capability is not signed-device evidence. The signed app and embedded provisioning profile must separately show both `underwater-depth` and the shallow entitlement. The public shallow capability does not authorize the product's deeper range; Apple's external managed entitlement and provisioning remain an open gate.

A 15cm bag/tank test can prove only manually started shallow sampling, such as an approximately `0.1 m` value and Water Lock. Xcode Easy Submersion can prove simulator system-session delivery/adoption and UI navigation, but cannot prove physical sensor delivery, actual hardware `When Submerged` selection/auto-launch, Water Lock, or release readiness. Those physical claims require supported hardware and a safely controlled depth greater than one meter. The device checklist records exact pass evidence, failure capture, and release gates.
