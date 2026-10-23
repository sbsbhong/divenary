# Design lead decisions — these OVERRIDE spec.md wherever they differ

Spec: `spec.md` in this folder ("Plumb · 측심"). Read it fully. These decisions were made by the design lead after reviewing the panel; follow them literally.

## D1. Depth-anchored gauge gradient is the DEFAULT (was proposal P1)
The current shipped gauge already uses a blue→navy gradient; anchoring the colour to metres makes it encode depth, so it is information, not decoration. Every gauge water fill (all recording artboards, gauge anatomy, prototype) uses it. It is NOT tagged as a proposal and has no yellow strip. Remove P1 from the proposals board and from the prototype toggles.

Colour anchored to absolute metres: 0 m `#2F7FD1` → 10 m `#1F5A99` → 40 m `#0B2547`.
The gradient spans the whole visible rail (y(0) → y(R)); the fill element shows it only from y(0) down to y(current depth). CSS: the fill is a div clipped to the rail, `top = y(0)`, `height = y(d) − y(0)`, with `background-image` = the gradient for that range and `background-size: 100% <rail visible height px>`, `background-position: top`.
Gradient strings per visible range R (U geometry; S uses the same percentages):
- R = 30: `linear-gradient(to bottom, #2F7FD1 0%, #1F5A99 33.33%, #11355F 100%)`
- R = 40: `linear-gradient(to bottom, #2F7FD1 0%, #1F5A99 25%, #0B2547 100%)`
- R = 10 (recommended-stop page): `linear-gradient(to bottom, #2F7FD1 0%, #1F5A99 100%)` (still drawn at 50% opacity on the stop page per C8)
- R = 6 (out-of-range artboard): `linear-gradient(to bottom, #2F7FD1 0%, #2569AD 100%)`
`--dv-water` (#1F5A99) stays the token name for "water"; profile/sparkline areas keep `--dv-water-area`.
The Always-On gauge stays an outline with no fill (C8).

## D2. Hero numbers are white (as spec). Blue stays only for actions/selection and the "다이빙 중" chip text.

## D3. Sync status — one term per concept (wiki 화면 문구)
Never use the short forms "전송 대기", "iPhone 저장", "전송 실패".
- Home recent card and saved-list rows: sync is a glyph ONLY (no text), right-aligned in the eyebrow / date row, ink2 (failed glyph danger). Its accessibility label is the full term. (Wiki: 저장 목록의 전송 상태는 전체 접근성 문구가 있는 아이콘.)
- Summary and session detail: glyph + full catalog label: "iPhone 전송 대기" / "iPhone에 저장됨" / "iPhone 전송 실패".
- Glyphs: pending `applewatch.and.arrow.forward`, saved `iphone.gen3`, failed `iphone.gen3.slash` (C21).

## D4. No abbreviations of dive types
Never "프리". The Home recent card shows NO dive type (wiki lists date · max depth · time · sync · markers only): values row is "14.2" + "m" then "48분". Saved-list rows show the type as plain ink2 text "프리다이빙" / "스쿠버" on the row's last line next to any marker chip — plain text, never a chip/pill.

## D5. Copy source of truth
All on-screen copy comes from the wiki `.wiki/wiki/design/mobile-watch-ui-language.md` (화면 문구 + watchOS 번역) and the shipped `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings` ko strings. Reuse shipped strings verbatim. New strings only where the spec needs them, in 합니다/세요 style, diver language, no dev terms. COPY-OVERRIDES.md (if present in this folder) lists exact replacements decided after the copy audit — apply them.

## D6. System clock stays drawn (watchOS layout reference), per spec C1.

## D7. Prototype toggles: remove "제안 P1 그라데이션". Keep "제안 P2 분 표시" (default on) and "제안 P3 스탑 확대" (default off).

## D8. Entry artboard name
The design-system sheet is written as `Main.dc.html` (title "디자인 시스템 시트"), not `System-DesignSheet.dc.html`. All other names as in spec §F.

## D9. Proposals board keeps P2, P3, P4, P5, P6, P7, P12, P13 (P1 removed — adopted).

## D10. System chrome = measured from the real watchOS 26 screenshots (OVERRIDES spec §C1, §B3 "content top", and every §F y-coordinate that depends on them)
The spec's clock (baseline 44) and content tops (72 / 104) are higher than real watchOS draws them; on a device the system clock and navigation bar push content down. Mockups must show the real vertical budget.

Ultra 49mm (422×514):
- Clock: `position:absolute; top:37px; right:34px; height:36px; font-size:36px; line-height:36px; font-weight:600; font-variant-numeric:tabular-nums` → right edge 388, baseline ≈ 68. (Already applied to every existing Ultra file.)
- Root large title (Home at scroll top only): "다이빙", `left:34px; top:71px; font-size:40px; line-height:40px; font-weight:600; letter-spacing:-0.6px; color:#2997FF` → baseline ≈ 106.
- Collapsed / pushed title: right-aligned under the clock, `right:34px; top:80px; font-size:30px; line-height:30px; font-weight:600; color:#2997FF` → baseline ≈ 106.
- Toolbar glass circle (back, summary back, demo xmark, Wet Ready home P12): visible circle 72px at left 34, top 40 (spans 34–106 × 40–112), glyph 32px white; the `<button>` hit area is 88×88 centred on it.
- Content top: 152 on root (unscrolled) and pushed screens. Scrolled states: title collapsed under the clock; content may start at 128 and passes under the title with the scroll-edge fade `mask-image: linear-gradient(to bottom, transparent 0, transparent 96px, #000 140px)` on the content layer.
- Flow screens with the bar hidden (ending, saving, no-samples, start error, save failure): content may start at 76 but nothing may sit in the clock's box (x ≥ 300, y < 76).

Series 42mm (374×446):
- Clock: `top:28px; right:28px; height:32px; font-size:32px; line-height:32px` → right edge 346, baseline ≈ 56. (Already applied to Series42-Home.)
- Root large title: `left:30px; top:64px; font-size:36px; line-height:36px` → baseline ≈ 96.
- Collapsed / pushed title: `right:28px; top:70px; font-size:27px; line-height:27px` → baseline ≈ 94.
- Toolbar circle: 64px at left 28, top 34 (hit area 88).
- Content top: 132 (root/pushed); scrolled 112 with fade from 84 to 122. Flow screens: from 66, nothing in x ≥ 262, y < 64.

Recording screens keep the spec chassis (status band U y 72–112 / S 62–102 etc.); only the clock moved. Exceptions with a toolbar circle on a recording-style screen:
- Demo live: xmark circle at U (34,40) 72px / S (28,34) 64px; the status-band chips then start at x 118 (U) / x 104 (S) instead of 8.
- Wet Ready (P12 board): home circle at the same place; the "기록 대기" chip starts at x 118 (U) / 104 (S); the "수심 0.6 m" readout stays right-aligned under the clock.

## D12. Review decisions (round 1)
- End page hint chip carries text: 3 dots (third current) + "동작 버튼 ▸ 기록 종료·저장" (wiki 종료 화면 chip). Not dots-only.
- Underwater automatic changes cross-fade only: RC-CHIP and RC-STOPDONE use opacity (dv-fade-in), no scale. Diver-initiated page changes keep the RC-PAGE offset.
- Always-On hint text opacity 0.75 (0.5 fails 4.5:1).
- Kept on purpose: no fixed non-certified line on recording pages (owner decision 2026-10-22, wiki); the stop zone band + 5 m pip; the 6 m out-of-range board (a state of Live, not a separate screen); the Live canvas-demo loop.

## D13. Review decisions (round 2)
- Wet Ready can be in the water: no bounce or overshoot there. WR-MODE keeps the selection slide (diver-initiated, smooth easing, no overshoot) but the glyph does not bounce; it cross-fades to white.
- Freedive surfacing is automatic: RC-TIDE = the new tide mark fades in (opacity), no scaleX.
- Nothing may be half-clipped by the display corner: the last visible line in a first viewport ends at least 16px clear of the bottom curve; anything that would be cut sits wholly below the fold instead.
- Saved-list read failure = first-load failure (the watch reads synchronously): error block + "다시 시도" only, no list rows under it; C3 footer below. Glyph cutouts on a platter use the platter colour, not black.
- Story A sync timeline: summary at 10:46 "iPhone 전송 대기"; by 1:20 the list row and the detail both show "iPhone에 저장됨".
- Star rating is one `<svg role="img" aria-label="5점 중 4점">`, not a div with a role.
- Collapsed / pushed titles use letter-spacing 0 everywhere.
- Kept on purpose: start-card gap 8px (= row gap); guide illustrations at 0.75 in a 64px band; detail page-1 profile 96px (D10 budget); white on #2997FF for labels ≥ 30px/600 (WCAG large-text 3:1; S Wet Ready tile labels go to 30px).

## D14. Review decisions (round 3: prototype + sheet)
- Every automatic change on a recording page is opacity-only: RC-CHIP, RC-STOPDONE, RC-HERO, RC-WATERLOCK, RC-TIDE, RC-AUTO, RC-SIGNAL. Only diver-initiated page changes (RC-PAGE) move (offset 12px, smooth, no overshoot). The design-sheet motion legend shows exactly this.
- The Digital Crown pages through every recording page incl. type switch and End (shipped behaviour, COPY C7); acting on those pages still needs the Action Button. §F #52's "live↔details only" is superseded.
- Kept: handler-side timers in the prototype (guarded, cleared on unmount); the sheet's compact swatches and 50% component gallery (self-declared).

## D15. Owner adopted every proposal (2026-10-23) — they are now the design, not proposals
- P2 stop minute indices, P3 600 ms interpolated stop-range change (30→10, smooth, no overshoot), P4 Wet Ready water tint (`linear-gradient(to bottom, rgba(31,90,153,.6) 0%, rgba(31,90,153,.22) 50%, rgba(31,90,153,0) 100%)` over the whole screen, under the content), P5 freedive tide marks, P6 one term for the dive's elapsed time, P7 grey storage footer (ink2 glyph + text) on recording pages, P12 Wet Ready home glass circle, P13 unsupported notice below the start cards.
- No board carries a yellow "제안" strip any more: every strip board becomes a plain screen (422×514 / 374×446, display radius 88 / 76). The "예외" strip on the 6 m out-of-range board stays (it marks an edge-case device, not a proposal).
- P6 wording: the scuba dive's elapsed time is "다이빙 시간" everywhere — recording rows ("시간" → "다이빙 시간"), the stop page and End page ("기록 시간" → "다이빙 시간"), Always-On, and the scuba summary/detail ("총 기록 시간" → "다이빙 시간", value "42분 10초"). A single freedive's time is "다이빙 시간" ("시간" → "다이빙 시간"); the freedive session total stays "총 기록 시간" (a different concept: the whole session). "직전 다이빙 시간", "최장 다이빙" stay.
- The proposals board becomes a record: title "채택한 제안", subtitle "2026-10-23 모두 채택해 목업에 반영했습니다. 왼쪽은 이전 규칙, 오른쪽은 지금 디자인입니다.", left label "이전 규칙", right label "채택 · 목업 반영", pills "P2 채택" etc. in a neutral style (#3A3A3C fill, white text) instead of yellow.

## D16a. Summary finale rider faces its direction of travel (owner, 2026-10-23)
The logo mark that rides the profile line from left to right is mirrored horizontally (the logo's manta faces up-left; mirrored, it faces the way it swims). Only the rider is mirrored; the logo everywhere else (Home footer, empty list, design sheet) stays as the original.

## D16. Brand mark
The only manta anywhere is the real logo traced in LOGO.md (same folder). Remove every hand-drawn manta. Home bottom footer: the real mark, monochrome ink3, 64px wide, above the non-certified sentence. Summary finale: the real mark in white, 28px wide, rides the profile line. Empty saved list: the real mark, ink3, 80px wide. Design sheet: replace the "divenary.manta" icon and the footnote example with the real mark and caption it "Divenary 로고 (실제 로고 윤곽)".

## D17. Do not read like Apple's Depth app ("수심" app)
Apple's Depth app is called "수심" in Korean and has its own demo mode driven by the Digital Crown. Generic measurement labels ("수심", "최대 수심", "수온", "수심 정보 없음") stay — every dive computer uses them. What must go is anything that mirrors Apple's app as a whole:
- Retire the `water.waves` glyph everywhere (no-samples screen, auto-launch illustration, design-sheet icon set). Use Divenary's own instrument motif instead, the depth column glyph (24×24 viewBox, stroke/fill currentColor):
  - `divenary.column` (empty): `<rect x="9" y="2.5" width="7" height="19" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 7h2.6M4 12h2.6M4 17h2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
  - `divenary.column.half` (demo): the same plus `<rect x="10.8" y="11" width="3.4" height="8.7" rx="1.7" fill="currentColor"/>`
- Auto-launch guide illustration: the watch outline with a waterline crossing its lower half (one gentle wave stroke in white and the area below it in rgba(31,90,153,.6)), not a symbol inside the watch.
- Home demo row: glyph `divenary.column.half` (not `digitalcrown.arrow.clockwise`), copy per COPY C13.
- Demo hint chip and no-samples screen: copy per COPY C13/C14 (no sentence that pairs the Digital Crown with "수심" the way Apple's demo prompt does, and no headline built on "수심" at the save moment).
- Keep system feature names exactly as watchOS names them ("수중 잠금", "자동 실행", "동작 버튼") — those must match the system.

## D18. Clarifications after adoption
- P3 (owner-adopted) is the one explicit exception to "automatic changes are opacity-only": the 30→10 stop-range change interpolates the scale once over 600 ms, smooth, no overshoot. Static boards may keep their entry fade; the prototype and the sheet show the interpolation.
- Freedive session time (End row, readouts) is "총 기록 시간" (C15).
- Owner clarification (2026-10-23): resembling Apple's apps is fine; only strongly evoking one specific Apple app is not. D17 is applied in that spirit — generic Apple grammar stays.

## D19. REVERTED (2026-10-23): the owner keeps the original monofin (freedive) and tank (scuba) glyphs — they only wanted to know what the monofin meant. The diver-figure pair below is not used anywhere.
## (retired) Dive-type glyphs as a matched pair of diver figures
- `divenary.freedive`: a freediver with no tank, arms streamlined past the head, long fins, heading down at −42°.
- `divenary.scuba`: a scuba diver lying level with a tank on the back and fins (replaces the tank-only object so the pair reads as one set).
- Both drawn in the same weights (head r 2.6, torso 4.6, legs 2.9, arms 1.9, filled fin wedge) and checked at the 44px start-card size. The monofin and tank glyphs are retired everywhere (start cards, Wet Ready tiles, type-switch page, plan rows, design sheet, record board, prototype).

## D20. Implementation review decisions (Task 2)
- End page without an Action Button: the large instruction already says "수중 잠금 해제 / 기록 종료·저장", so the column's bottom-slot Water Lock line is hidden on the End page and the hint chip shows dots only for `.waterLockToEnd`. With an Action Button the chip shows "동작 버튼 ▸ 기록 종료·저장" and the bottom-slot Water Lock line stays (it is the other way to end at the surface, as drawn on the canvas End board).
- Ending overlay (RC-END): the gauge stays visible as a 30 % silhouette while the right value column fades to 0, so the spinner and "기록을 종료하고 있습니다." never sit on top of numbers; not an opaque screen.
- Narrow watches (40/41 mm class): both start-card titles use the same, one-step-smaller title size so "프리다이빙" fits without shrinking below "스쿠버".
- Recommended-stop record layout follows C6: "상태" full width, "스탑 구간 시간" on its own row, "목표 수심 / 스탑 구간" full width, then "시작" | "완료 시각".
- Korean copy keeps "Divenary" and its particle on one line (word joiner U+2060 between "Divenary" and the particle in ko catalog values).
- Each value row is one VoiceOver element ("라벨, 값"); unknown values read "정보 없음" (key `Not available`).
- The max-depth ghost line hides while the current-depth index is within 3 pt of it (they would overlap).
- `DiveModeGlyph` uses the exact spec §C21 monofin and tank paths (the glyphs on the approved canvas), not hand-drawn approximations.
- The fixed status-band offset (36 pt Ultra / 31 pt 42 mm, ignoring the top safe area) must be checked on 40/41/44/46 mm simulators and on the demo screen with its toolbar in Task 6.

## D11. Summary layout (OVERRIDES spec §F #32 / #51 positions)
The bottom chip always says what the next Action Button press does — on recording pages and on the summary alike.
REVISED (round 2) to obey the wiki rule "저장 요약은 최대 수심과 시간을 먼저 두고 상태는 한 곳에만 보인다":
Ultra: pushed chrome (back circle, title "요약"). Then
- "최대 수심" eyebrow, baseline 176; "22.4" (80px, metric 600) + "m" (34px ink2), baseline 244
- "총 기록 시간" (26px ink2) + "42" "분" "10" "초" (44px white digits, 26px ink2 units), baseline 284
- profile y 300–394 with the max label "22.4 m"; PD-FINALE draw + manta ride
- status row y 402–434: `checkmark.circle.fill` 28px white + "워치에 저장됨" 28px/600 white (PD-FINALE bounce on the glyph at t0)
- pinned hint chip y 450–498, no dots: "동작 버튼 ▸ 다음 다이빙 시작" (same component as the recording hint chip)
- The manta is invisible until the ride starts (t150) and fades out at the end; nothing shows at the profile origin before the draw.
- below the fold (Summary-Scrolled starts with it): sync line `applewatch.and.arrow.forward` + "iPhone 전송 대기" (ink2), then the recommended-stop and stats sections.
Series 42mm: same order scaled to S tokens, content from 128, hint chip pinned at the S hint zone (y 386–430).
