Source URL: User-requested watch readability changes; apps/mobile/ios/DivenaryWatchApp/Views
Collected: 2026-10-22
Published: 2026-10-22

# Watch readability requirements

Preserved requirements from the repository owner's task:

- No essential text on a recording page may render below 11 pt on a 41/42 mm watch. Shorten copy or drop redundant elements instead of shrinking. Gauge tick labels: at least 11 pt, fewer ticks if needed.
- Non-certified text on recording pages: replace the full 8 pt sentence with one short readable marker, "Log only · Not certified" / "기록용 · 인증 장비 아님". Keep it on every real and demo recording page. Keep the full disclaimer on Home, Wet Ready, saved summary and saved detail.
- On the End page make the instruction to press the Action Button to end and save the largest element, with elapsed time secondary. Without the Action Button hint, describe the available hardware path: Water Lock off ends the recording. Never add a touch target.
- Scale the depth rail to the sensor's authorized maximum when known; otherwise keep the current scale. Do not draw values beyond the authorized range. The full beyond-range layout remains backlog D6.
- Keep total recording time visible on the recommended-stop screen. Keep the amber "Recommended stop" / "권장 스탑" label, including Always-On. Completed stops must be distinguishable without colour.
- Saved rows: date must not truncate; mode badges must not become empty pills; sync status must not truncate. Stack detail sync status below the mode and marker badges.
- Use Dynamic Type-friendly fonts where layout allows on Home, saved list and detail. Saved row VoiceOver summary: date, max depth, time, sync status, markers. Chart summary: depth range only, no sample counts.
- Error/storage text must not overlap the main metric. Muted text on dark tiles needs adequate contrast.
- Keep Demo/Test markers, depth status chips, unknown placeholders, the 180 s + notSubmerged end guard, all input behaviour and haptics unchanged. This is a recreational dive log, not a certified dive computer; no decompression computation or underwater instructions.

Implementation inspection found that WetReadyView lacked its full disclaimer; the shared full disclaimer is restored there. Native build, XCTest and rendered small-watch validation remain the lead's responsibility in this sandbox.
