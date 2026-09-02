# Watch start-card height and demo Crown hint design

## Goal

Keep the three immediate-start cards equally generous without explanatory copy, and place the demo-only Crown depth-control instruction at the bottom of the recording screen.

## Scope

- Remove the demo card subtitle (`Crown-controlled sample dive`).
- Keep the Free, Scuba, and Demo start cards free of subtitles and footnotes.
- Give all three cards a shared minimum height of 64 pt, preserving equal, easy-to-tap rows despite their one-line content.
- During an active demo recording only, show the small localized instruction `Digital Crown으로 수심 조절` at the bottom safe area.

## Out of scope

- Do not restore Free or Scuba home-card explanatory copy, including the air/5 m safety-stop display.
- Do not change immediate-start actions, `play.fill` affordances, the demo toolbar `xmark`, persistence, sensor behavior, Water Lock, or depth-gauge dimensions.
- Do not show the Crown instruction for real or debug-test recording modes.

## Layout

`StartSessionCard` owns the shared minimum height, so Free, Scuba, and Demo retain matching cards automatically. The demo depth instruction is a noninteractive, 9 pt bottom `safeAreaInset`; it reserves only its own small line of space and keeps it clear of rounded screen edges. The full-height depth gauge continues to occupy all remaining safe-area height.

## Tests and verification

- Extend the static watch UI check to require the shared 64 pt card height, reject the removed demo subtitle, and require the demo-only bottom Crown instruction.
- Add a lifecycle test proving the Crown hint is only visible during an active demo recording.
- Run the static UI check, concrete-simulator `DivenaryWatchAppTests`, and `yarn watch:build`.
