# Watch session UI and sync startup fixes

Date: 2026-07-10

## Context

Real-device watch checks found three issues before pool validation:

- The watch saved-session list showed sync/status badges as clipped dots or truncated text on the small watch row.
- The live recording screen became too compressed when the surface-gated end-dive button appeared.
- Saving a watch session could fail to appear in the mobile app reliably enough for the next hardware test pass.

## Implementation

The saved-session row now uses dedicated compact metadata and sync-status pills instead of rendering the long `DiveSyncStatus.label` as plain text inside the already constrained row. The visible sync badge uses short labels while keeping the full localized sync label for accessibility.

The recording end-dive action moved out of the main vertical instrument stack. `RecordingView` now keeps the live instrument and disclaimer in the height-owning VStack, then overlays a smaller destructive end action at the bottom trailing edge once the surface gate is visible. This keeps the depth gauge and safety-stop instrument from shrinking just because the button appears.

On mobile, `WatchConnectivitySyncProvider` now subscribes to native `DiveWatchSyncPayloadReceived` events before draining the durable inbox. This closes a startup race where a payload delivered between the drain call and event subscription could stay pending until a manual drain or app restart. The native inbox is also activated from `AppDelegate` launch and from the React Native module init path.

## Boundaries

These changes improve local import robustness and small-screen watch UI. They do not prove background WatchConnectivity delivery on physical paired devices, and they do not replace the later disconnect/reconnect crash reproduction. The acknowledgement still means local mobile repository import, not Supabase/cloud sync.

## Verification

- Focused Jest source/behavior tests cover the watch sync badge contract, compact end-button overlay contract, native app launch activation, and subscribe-before-drain startup order.
