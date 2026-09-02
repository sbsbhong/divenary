# Watch start cards and demo end control design

## Goal

Make the watch home screen’s dive choices read as activities that start immediately, and let a demo recording end from a compact, safe-area toolbar control without reducing the depth gauge’s usable height.

## Scope

- Rename the two real-session cards to `프리 다이빙` and `스쿠버 다이빙` (with corresponding English localizations).
- Remove only the supplemental safety copy from those two cards. The home safety footer and all other safety boundaries remain unchanged.
- Replace the trailing chevron on the two real-session cards and the demo card with `play.fill`, making immediate launch explicit.
- During a demo recording, replace the bottom `End Dive` button and its explanatory text with a leading toolbar `xmark` button.
- Tapping the demo `xmark` ends the recording through the existing completion lifecycle: automatic local save, saved-session summary on success, and retained-record retry UI on save failure.

## Out of scope

- Do not change real-session end controls, Water Lock behavior, sensor capture, runtime ownership, depth-gauge dimensions, or depth values.
- Do not move interactive controls into the watch’s unsafe area.
- Do not remove global non-certified/recreational-use copy or safety-stop reminders outside the two specified home cards.
- Debug test cards keep their existing labels and chevrons.

## Interaction design

### Home cards

`프리 다이빙`, `스쿠버 다이빙`, and `Demo` remain whole-card buttons that start their established destinations immediately. Their trailing `play.fill` replaces the navigation-style chevron so the control does not imply a detail page or a second selection step. The two real cards omit both subtitle and footnote text; this makes the activity name and play affordance the complete control.

### Demo recording

The demo keeps the existing full-height recording instrument and Crown depth control. It has no bottom end-control footer. A safe-area leading toolbar `xmark` is the visible in-app exit control. Its action calls the same end function used by the existing demo button, so there is no alternate persistence path. After successful saving, the existing saved-summary chevron remains the navigation control for returning home.

## Error handling

The top `xmark` is disabled or absent whenever the demo is no longer actively recording. A failed save continues to preserve the completed record and presents `Retry Save`; it must not dismiss or delete the record.

## Tests and verification

- Extend lifecycle coverage to demonstrate that the visible demo end control uses the existing finish-and-save flow rather than cancellation.
- Extend the static watch UI check to reject the demo bottom end footer, require the demo toolbar end control, require play affordances for the three immediately-starting home cards, and reject the removed home-card copy.
- Run `yarn workspace @repo/mobile watch:ui:check`, concrete-simulator `DivenaryWatchAppTests`, and `yarn watch:build`.
