# Watch Session UI and Sync Fixes

## Goal

Fix three real-device watch issues:

- Session-list sync status badge is clipped or effectively invisible.
- The live recording screen becomes too compressed when the end-dive button appears.
- Saving a current watch session does not reliably sync/import into the mobile app.

## Scope

- Watch SwiftUI session-list row layout and sync-status badge presentation.
- Watch SwiftUI live recording layout around the end-dive action.
- Mobile WatchConnectivity sync provider startup location so pending watch payload drain/ack is active from the app root.
- Source-level regression tests for the above contracts.
- Wiki note for the sync startup boundary.

## Implementation

1. Add failing source tests that lock the expected watch badge, compact end-button overlay, and root-level mobile sync provider behavior.
2. Update `SessionListView.swift` to use a dedicated readable sync badge in the middle column without relying on clipped plain text.
3. Update `RecordingView.swift` so the end-dive button is a compact bottom overlay instead of a normal vertical child that shrinks the instrument.
4. Move `WatchConnectivitySyncProvider` activation/drain responsibility to the mobile app provider root while leaving navigation-specific toast/notification callbacks in the navigation layer if needed.
5. Update wiki raw/source and compiled article/log for the mobile watch sync startup boundary.

## Verification

- Focused Jest source tests.
- `yarn mobile:typecheck`.
- `yarn watch:build`.
- `yarn codex:check` if the focused gates pass.

## Risks

- Real-device WatchConnectivity delivery still depends on paired-device state and iOS scheduling; the code can make startup/drain robust but cannot force immediate background delivery.
- The watch screen sizes need real-device visual validation after build because source tests cannot fully capture 41mm/45mm rendering.
