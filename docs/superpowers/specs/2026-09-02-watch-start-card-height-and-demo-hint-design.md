# Watch start-card height and demo hint design

## Goal

Keep the three immediately-starting watch cards visually equal and comfortably tappable without explanatory copy, while restoring a compact Crown depth-control hint only during a demo recording.

## Scope

- Remove the `Demo` card’s Crown-controlled sample-dive subtitle.
- Give `프리 다이빙`, `스쿠버 다이빙`, and `Demo` the same 64pt minimum card height regardless of subtitle presence.
- Keep all three cards free of subtitle and footnote copy.
- During an active demo recording, add a centered 9pt footer hint: `Digital Crown으로 수심 조절`.

## Out of scope

- Do not restore the removed real-session safety copy, change play affordances, or alter start actions.
- Do not change the demo’s top toolbar `xmark`, auto-save/retry lifecycle, Water Lock behavior, Crown depth-control behavior, sensor data, or the depth gauge.
- Do not add an interactive control in the unsafe area.

## Layout and interaction

`StartSessionCard` owns the fixed 64pt minimum height, so all card callers inherit identical tap targets. Cards continue to use their current `play.fill` affordance and start immediately.

The demo hint is display-only and appears as a bottom safe-area inset only while `recordingMode == .demo` and the lifecycle is actively recording. It uses the established 9pt muted footer style, remains noninteractive, and does not appear for debug-test or real recording flows. The safe-area inset reserves just its own compact height, preventing the hint from overlapping the depth gauge.

## Error handling

The hint disappears when the demo enters saving, saved-summary, retry, cleanup, or completed states. The toolbar `xmark` remains the only demo end control and retains its existing automatic-save behavior.

## Tests and verification

- Extend static UI checks to require the card minimum height, reject all three card subtitles, and require the demo-only bottom hint.
- Extend lifecycle tests to show the hint’s active-recording-only visibility alongside the toolbar end control.
- Run `yarn workspace @repo/mobile watch:ui:check`, concrete-simulator `DivenaryWatchAppTests`, and `yarn watch:build`.
