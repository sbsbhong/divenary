# WatchConnectivity Real-Device Validation Checklist

This checklist is a manual gate before claiming paired-device WatchConnectivity behavior. The agent did not run physical Apple Watch or paired iPhone validation.

## Scope

- Validate watch-to-mobile local repository import.
- Validate mobile-to-watch import acknowledgement and watch `synced` status.
- Validate the Settings watch sync notification opt-in and local notification behavior.
- Do not treat simulator success as proof of background delivery, entitlement correctness, underwater sensor behavior, or production retry behavior.

## Setup

- Use a physical iPhone paired to a physical Apple Watch that supports the target watchOS version.
- Install the iPhone app with the embedded `DiveWatchApp` companion.
- For `Test Freedive`, `Test Scuba`, and `Test Large Sync`, run the shared `DiveWatchAppDebug` scheme with `DIVE_WATCH_DEBUG_CONTROLS=1`.
- Confirm the iPhone app and watch app use the same build.
- Confirm signing, bundle identifiers, WatchConnectivity entitlement, app groups if added later, and companion embed settings in Xcode.
- Open Settings in the iPhone app and confirm the paired watch status row reports supported/paired/installed state.

## Foreground Delivery

- Launch the iPhone app in the foreground.
- Launch the watch app and save a short mock recording.
- Confirm the mobile app receives the payload without using the manual sync button.
- Confirm the log appears in Logbook without a cloud-sync status pill. Cloud sync is not configured.
- Confirm the foreground toast says local-device saved wording and stays visible until Open or Close is tapped.
- Tap the toast Open action and confirm it opens the imported Logbook detail.
- Confirm the watch session changes to `synced` after the mobile import acknowledgement is received.

## Manual Drain And Retry

- Treat this section as a pre-device-test blocker: if the phone and watch are disconnected while the watch saves a dive session, reconnecting and attempting sync from the mobile app must not crash.
- Confirm watch sync runs automatically after reconnection when the OS delivers the pending WatchConnectivity payload.
- Save a watch session while the iPhone app is not actively showing the Logbook.
- Open Logbook and tap the watch sync action.
- Confirm pending native inbox payloads drain into the persistent Logbook repository when the automatic path did not already import them.
- If a transfer fails, confirm the payload is not acknowledged as imported and can be retried on app restart.
- If automatic sync fails for any reason, tap the Logbook watch sync action and confirm the same watch session imports without duplicate loss or app crash.
- Observe whether repeated failures have user-visible status; current implementation does not include a finished retry/backoff policy UI.

## Duplicate And Large Transfer

- Trigger automatic delivery and the Logbook manual sync action close together for the same pending record.
- Confirm one mobile Logbook row, one foreground notification/toast, no crash, and eventual Watch acknowledgement.
- Tap `Test Large Sync` once on Watch.
- Confirm the 8,000-sample `Large Sync Fixture` persists on Watch and imports to one mobile row through file transfer.
- Repeat manual sync while delivery is pending and confirm no duplicate row or crash.

## Background And Killed-App Delivery

- Enable Settings -> Watch sync notifications on the iPhone and grant notification permission.
- Save a watch session while the iPhone app is backgrounded.
- Confirm whether the OS delivers the WatchConnectivity payload and the app stores it locally.
- Confirm a local notification appears only after local repository import succeeds.
- Tap the notification and confirm it opens the imported Logbook detail when possible.
- Repeat with the iPhone app force-quit/killed. Record the exact OS behavior; killed-app delivery may differ from background delivery.

## Mobile-To-Watch Planned Dives

- Create a planned scuba dive and a planned freedive in the iPhone app.
- Confirm only uncompleted plans are sent to the watch.
- On watch, open Dive Plan and confirm planned dives appear in the unexecuted plan list.
- Start a recording from a selected plan.
- Save the watch session and confirm the imported mobile log is enriched from the source plan.
- Confirm the source plan becomes completed and records `convertedLogLocalId`.

## Notification Opt-In

- With notifications disabled, confirm foreground imports still show the in-app toast.
- Enable notifications and grant permission; confirm the preference persists after app restart.
- Deny permission on a clean install or reset permission state; confirm the preference remains off and local import still works.
- Confirm notification copy does not say cloud synced, uploaded, backed up, or verified dive computer data.

## Safety Boundary

- Confirm the UI does not claim certified dive computer behavior.
- Confirm scuba ascent and safety-stop copy remains reminder/review-only.
- Confirm Home conditions do not score dive suitability or issue weather, tide, current, no-fly, or emergency recommendations.
- Confirm actual Apple Watch underwater sensor behavior is documented as unverified until tested on supported hardware.

## Shallow Container Or Pool Sensor Check

- Do this only in a controlled shallow container or pool environment. Do not perform an actual freedive or scuba dive for this checklist.
- Start a real recording and confirm depth and pressure respond to immersion and return toward surface values after removal.
- Confirm temperature is absent until the OS supplies a measurement; it must not appear or persist as `0°C` merely because temperature has not arrived.
- After a real temperature arrives, confirm the live value and saved summary/detail use the measured value.
- Where the controlled depth safely permits it, observe auto-launch/auto-start behavior and record whether background handoff works. Do not treat this trigger as a certified dive-start decision.
- Check wet-screen readability, crown operation, haptics, accidental end protection, and non-certified reminder wording.
- Stop here. Deep water, actual freediving/scuba profiles, 40m behavior, and real-dive safety-stop behavior belong to the separate real-dive gate.

## Results Template

Record each physical-device run with:

- Date and build identifier:
- iPhone model and iOS version:
- Apple Watch model and watchOS version:
- Foreground delivery result:
- Background delivery result:
- Killed-app delivery result:
- Import acknowledgement result:
- Watch `synced` status result:
- Notification permission/result:
- Notification press routing result:
- Retry/backoff observations:
- Duplicate automatic/manual import result:
- Large file-transfer result:
- Shallow depth/pressure result:
- Temperature missing/received result:
- Auto-launch/background handoff result:
- Wet control/readability/haptic result:
- Known failures or follow-up work:
