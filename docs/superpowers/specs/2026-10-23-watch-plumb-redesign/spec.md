# Divenary watchOS: final build spec, "Plumb · 측심"

**How to read this spec**
- 1 pt = 2 CSS px.
- Screen sizes:
  - Ultra 49mm (**U**) is 211×257 pt, which is 422×514 px.
  - Series 42mm (**S**) is 187×223 pt, which is 374×446 px.
- Sizes are written as `pt/px`.
- Coordinates are CSS px from the top-left of the artboard.
- Every on-screen string appears in quotes, exactly as it must ship.
- The mockups follow the current rules. Any deviation is drawn only on artboards that carry a yellow **제안 Pn** caption strip, and every deviation is listed in §G2.

---

## A. Direction

**Name: Plumb · 측심 (the sounding line).**

The design starts from the "instrument" concept. Two other concepts are grafted onto it:
- From Water Column: watchOS-native grammar and the motion system.
- From Mulbit: the shape grammar, the Water Lock slot, the bright Demo marker and the tide marks.

**Concept.** Every recording page is one fixed, precise instrument. A machined depth column sits on the left, a reserved status band runs across the top and a hint chip sits at the bottom. Only the right-hand value column changes when the diver pages. The page shows one large white number that can be read through a mask. Water fills the column from the surface down to the diver's depth in a quiet navy. A white index with a black keyline and a chevron together read as one watch hand. Live values change in place and never roll, count or overshoot.

Out of the water, the app behaves like a first-party Apple Watch app:
- system rows, glass toolbar circles and vertical paging
- symbol effects, and a Home screen that rises into place
- a Wet Ready selector that slides with the crown
- a recording rail that grows down from the top when recording starts

The reward comes after saving. The dive profile draws itself, the deepest point lands, and the manta glides once along the line. The app is calm in the water and celebrates on land. That makes it the dive app a diver chooses for the screenshots and keeps for its trustworthiness.

**Five principles**
1. **The instrument never moves; only the dive does.** The status band, gauge and hint chip hold fixed positions on every recording page. Paging moves only the right column. The hero baseline is identical across pages.
2. **Live values change in place.** Depth, time, the stop countdown and surface rest update instantly. Motion appears only when the dive's state changes. Unknown values are drawn as grey dashes, and no stale value is ever drawn as current.
3. **One white number, one meaning per colour.**
   - White is data.
   - Grey is a label or an unknown value.
   - Navy is water.
   - Blue is something to press or something chosen.
   - Amber is the recommended-stop reminder.
   - Red is a real failure, and appears only off the recording pages, apart from the pinned storage footer.
   - Green is never used.
4. **System grammar first.** Use watchOS rows, glass toolbar circles, vertical pages, symbol effects and press scale 0.95. Custom drawing is used only where diving needs it: the gauge, the profile and the mode glyphs.
5. **Celebrate on land, stay calm in water.** The delight lives on Home, Wet Ready, the plan pick and the post-dive finale. Underwater motion is short, linear or non-bouncing, and silent. No haptics are added beyond the five events the diver triggers.

---

## B. Tokens

### B1. Colour

| CSS var | Hex / value | Role | Contrast on #000 |
|---|---|---|---|
| `--dv-canvas` | `#000000` | Every background, including every recording page and Always-On. Wet Ready stays black. | n/a |
| `--dv-platter` | `#262628` | Pressable surfaces: start cards, rows, the recent card, secondary buttons, banners | 1.39:1 (white text on it 15.1:1) |
| `--dv-chip` | `#1C1C1E` | Status chips, hint chip, empty gauge track. Darker than the platter so chips never look pressable. | 1.23:1 |
| `--dv-marker` | `#3A3A3C` | "데모"/"테스트" marker chip, start-card glyph disc, disabled play disc, skeleton blocks | 1.85:1 |
| `--dv-ink` | `#FFFFFF` | All data, hero numbers, titles | 21.0:1 |
| `--dv-ink2` | `#AEAEB2` | Labels, units, chip and hint text, tick labels, body on guide pages | 9.5:1 |
| `--dv-ink3` | `#8E8E93` | Fine print, the non-certified sentence, "--" placeholders, "(n)" counters | 6.4:1 |
| `--dv-dot-off` | `#5A5A5E` | Inactive page dots, empty stars, unselected plan circle | 3.1:1 |
| `--dv-hairline` | `rgba(255,255,255,.18)` | Gauge tick hairlines only | n/a |
| `--dv-action` | `#2997FF` | Only for press or selection: play discs, primary buttons, the selected Wet Ready tile, plan checkmark, nav title, the "다이빙 중" chip text (pinned) | 6.96:1 (white on it 3.02:1, so labels on it must be ≥15pt/600) |
| `--dv-action-fill` | `rgba(41,151,255,.30)` (≈ `#0C2D4D`) | Selected plan row fill | n/a |
| `--dv-water` | `#1F5A99` | Data hue, used only for depth fills: gauge water and profile area. Never text, never controls. | 2.98:1 (white on it 7.0:1) |
| `--dv-water-area` | `rgba(31,90,153,.60)` | Profile and sparkline area | | n/a |
| `--dv-water-deep` | `#0E2C52` | **P1 only.** Bottom stop of the depth-anchored gradient. | 1.50:1 |
| `--dv-caution` | `#FFC74D` | Recommended stop only (label, countdown, zone edges, pip, paused/completed text, minute indices). Also the saved "지원 수심 밖" triangle. | 13.5:1 |
| `--dv-caution-fill` | `rgba(255,199,77,.18)` | Stop-zone band fill | n/a |
| `--dv-caution-line` | `rgba(255,199,77,.60)` | Stop-zone top and bottom edge lines | n/a |
| `--dv-caution-dim` | `rgba(255,199,77,.25)` | Pending stop minute index (P2) | n/a |
| `--dv-danger` | `#FF6B61` | Real failures: save, send, read and start errors, failed-send glyph, the pinned storage footer | 7.53:1 |
| `--dv-keyline` | `#000000` | 1pt/2px outline around the white depth index | n/a |
| `--dv-glass` | `rgba(255,255,255,.14)` + `backdrop-filter: blur(12px) saturate(160%)` | Toolbar circles only (back, demo xmark, Wet Ready home) | n/a |
| `--dv-aod-stroke` | `rgba(255,255,255,.50)` | Always-On gauge outline | n/a |

**Colour sentence for the wiki:** 검은 물, 흰 데이터, 회색 라벨, 남색 물기둥, 파란 조작, 앰버 권장 스탑. Red appears only for real failures. Green is never used.

**Contrast rule:** text on `--dv-action` must be at least 15pt/600.

### B2. Type

Font families:
- `--font-metric: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, "Apple SD Gothic Neo", sans-serif;` with `font-variant-numeric: tabular-nums;` on every number.
- `--font-text: -apple-system, "SF Compact Text", system-ui, "Apple SD Gothic Neo", sans-serif;`

Weights:
- Only 400, 600 and 700. Weight 700 is used only for the gauge chevron stroke.
- Weight 300 is not used anywhere.
- 500 and `.medium` are never used.

Tracking values are pt/px.

**Recording type (fixed sizes, not Dynamic Type).** These are compact-mode sizes. Every current watch uses them, because its readout is under 190 pt (see §C7).

| Token | U pt/px | S pt/px | Wt | Family | Tracking U / S | Line-height | Colour |
|---|---|---|---|---|---|---|---|
| `rec-hero-depth` | 56/112 | 48/96 | 600 | metric | −1.20/−2.4 · −0.96/−1.92 | 1.0 | ink |
| `rec-hero-time` (time, stop countdown, surface rest, total time) | 52/104 | 44/88 | 600 | metric | −1.08/−2.16 · −0.87/−1.74 | 1.0 | ink (stop: caution) |
| `rec-hero-count` (freedive count) | 56/112 | 48/96 | 600 | metric | as depth | 1.0 | ink |
| `rec-hero-unit` | 20/40 | 17/34 | 600 | metric | 0 | 1.0 | ink2 |
| `rec-caption` | 13/26 | 12/24 | 600 | text | +0.20/+0.4 · +0.23/+0.46 | 15.5/31 · 14.5/29 | ink2 (stop: caution) |
| `rec-row-label` | 12/24 | 11/22 | 400 | text | +0.23/+0.46 | 14.5/29 · 13.5/27 | ink2 |
| `rec-row-value` | 22/44 | 18/36 | 600 | metric | −0.10/−0.2 · −0.15/−0.3 | 1.15 | ink |
| `rec-row-value-stacked` | 20/40 | 17/34 | 600 | metric | 0 | 1.2 | ink |
| `rec-row-unit` | 15/30 | 13/26 | 600 | metric | 0 | 1.0 | ink2 |
| `rec-quiet-value` | 15/30 | 14/28 | 400 | metric | 0 | 1.15 | ink (ascent: ink2) |
| `rec-quiet-unit` | 12/24 | 11/22 | 400 | metric | 0 | 1.0 | ink2 |
| `rec-chip` / `rec-hint` | 12/24 | 11/22 | 600 | text | +0.23/+0.46 | 14.5/29 · 13.5/27 | ink2 |
| `rec-tick` | 12/24 | 11/22 | 600 | metric | +0.23/+0.46 | 1.0 | ink2 |
| `rec-end-instruction` | 19/38 | 16/32 | 600 | text | −0.22/−0.44 · 0 | 22/44 · 19/38 | ink |
| `rec-switch-title` | 20/40 | 17/34 | 600 | text | 0 | 22.5/45 · 19.5/39 | ink |
| `rec-note` | 13/26 | 12/24 | 400 | text | +0.2/+0.4 | 15.5/31 · 14.5/29 | ink2 |
| `rec-waterlock` | 12/24 | 11/22 | 400 | text | +0.23/+0.46 | 14.5/29 · 13.5/27 | ink2 |
| `rec-stop-state` | 13/26 | 12/24 | 600 | text | +0.2/+0.4 | 15.5/31 · 14.5/29 | caution |

Two further steps exist:
- **Full** (readout ≥190 pt; no current watch qualifies): heroes are 60/120 (U) and 52/104 (S).
- **Tight** (a storage error is shown): heroes are 48/96 and 44/88 (U), and 42/84 and 38/76 (S). Row values are 18/36 (U) and 16/32 (S). Spacing between slots becomes 1pt.

**Non-recording type.** These use Dynamic Type defaults: U = xLarge, S = Large. Build them in SwiftUI with relative styles or `@ScaledMetric`.

| Token | U pt/px | S pt/px | Wt | Family | Line-height U / S | Use |
|---|---|---|---|---|---|---|
| `ui-clock` | 16/32 | 15/30 | 600 | text, tabular | 1.0 | System time |
| `ui-nav-title` | 17/34 | 16/32 | 600 | text | 1.0 | Nav title, colour action |
| `ui-headline` | 17/34 | 16/32 | 600 | text | 19.5/39 · 18.5/37 | Card and row titles |
| `ui-body` | 17/34 | 16/32 | 400 | text | 19.5/39 · 18.5/37 | Row titles, memo |
| `ui-footnote` | 14/28 | 13/26 | 400 | text | 16.5/33 · 15.5/31 | Details, body, disclaimers (ink3) |
| `ui-footnote-em` | 14/28 | 13/26 | 600 | text | same | Emphasised footnote |
| `ui-eyebrow` | 13/26 | 12/24 | 600 | text | 15.5/31 · 14.5/29 | Section labels, stat labels (ink2) |
| `ui-title3` | 20/40 | 19/38 | 600 | text | 22.5/45 · 21.5/43 | Guide page titles |
| `ui-wet-mode` | 15/30 | 14/28 | 600 | text | 1.0 | Wet Ready tile labels |
| `ui-wet-truth` | 13/26 | 13/26 | 600 | text | 15.5/31 | "아직 기록을 시작하지 않았습니다." |
| `ui-wet-guide` | 14/28 | 13/26 | 400 | text | 16.5/33 · 15.5/31 | Start guidance (ink) |
| `ui-crown-hint` | 12/24 | 12/24 | 400 | text | 14.5/29 | Wet Ready crown line (ink2) |
| `ui-metric-xl` | 40/80 | 36/72 | 600 | metric | 1.0 | Summary max depth |
| `ui-metric-l` | 34/68 | 30/60 | 600 | metric | 1.0 | Detail max depth |
| `ui-metric-m` | 22/44 | 20/40 | 600 | metric | 1.0 | Summary and detail total time |
| `ui-stat-value` | 20/40 | 19/38 | 600 | metric (text for words) | 22/44 | Stacked stats |
| `ui-card-depth` | 24/48 | 22/44 | 600 | metric | 1.0 | Recent-card depth |
| `ui-list-depth` | 20/40 | 19/38 | 600 | metric | 1.0 | List-row depth |
| `ui-unit-l` | 17/34 | 15/30 | 600 | metric | 1.0 | Units and "분/초" beside `metric-xl`/`metric-l` (ink2) |
| `ui-unit-m` | 13/26 | 12/24 | 600 | metric | 1.0 | Units and "분/초" beside `metric-m`, stat and list values (ink2) |

SF Compact tracking at 2× for text tokens:

| Size (pt) | Letter-spacing (px) |
|---|---|
| 12 | +0.46 |
| 13 | +0.40 |
| 14 | +0.38 |
| 15 | +0.20 |
| 16 | 0 |
| 17 | −0.14 |
| 19 | −0.44 |
| 20 | 0 |
| 22 | −0.20 |
| 24 | −0.38 |
| 34 | −1.20 |
| 36 | −1.34 |
| 40 | −1.56 |

### B3. Spacing and layout constants

**Spacing scale:**

| Token | pt/px |
|---|---|
| `--sp-1` | 2/4 |
| `--sp-2` | 4/8 |
| `--sp-3` | 6/12 |
| `--sp-4` | 8/16 |
| `--sp-5` | 12/24 |
| `--sp-6` | 16/32 |
| `--sp-7` | 20/40 |
| `--sp-8` | 24/48 |

| Constant | U | S |
|---|---|---|
| Display corner radius (artboard `border-radius`) | 44pt/88px | 38pt/76px |
| Platter side inset | 6pt/12px (x 12–410) | 5pt/10px (x 10–364) |
| Platter inner padding (horizontal) | 12pt/24px | 10pt/20px |
| Free-text gutter (text x) | 18pt/36px → right edge 386px | 15pt/30px → 344px |
| Wet Ready text gutter | 12pt/24px → 398px | 10pt/20px → 354px |
| Recording horizontal padding (pinned) | 4pt/8px | 4pt/8px |
| Gap between rows | 4pt/8px | 4pt/8px |
| Gap between groups and sections | 12pt/24px | 10pt/20px |
| Content top, pushed screens | 52pt/104px | 46pt/92px |
| Content top, root, Wet Ready, flow screens | 36pt/72px | 32pt/64px |
| Hint chip maximum width (bezel-corner safe) | 184pt/368px | 168pt/336px |

### B4. Radii

All radii are `continuous` in SwiftUI. In CSS, use plain `border-radius`.

| Element | pt/px |
|---|---|
| Status, marker and phase chip | 6/12 (rounded rectangle, **never a capsule**) |
| Hint chip | 7/14 |
| Row, plan row, list row, banner, note card, read-failure block | 12/24 |
| Recent card, Wet Ready tile | 16/32 |
| Start card | U 18/36, S 16/32 |
| Gauge rail | 7/14 (capsule) |
| Stop zone band | 3/6 |
| Skeleton block | 6/12 |
| Buttons | capsule (`999px`) |
| Toolbar circles, play disc, glyph disc | 50% |

**Shape grammar:** a capsule or circle means pressable. A rounded rectangle means information.

### B5. Materials

- **Platters:** flat `--dv-platter`. No border, no shadow, no blur.
- **Glass:** only the system toolbar circles, drawn as `--dv-glass`. This emulates Liquid Glass on watchOS 26/27; the fallback on watchOS 10/11 is a flat `#262628` circle. Glass has no border, no shadow and no inset highlight.
- **Primary buttons:** flat `--dv-action`. In SwiftUI this is `.borderedProminent.tint(action)`, or `.glassProminent` on watchOS 26 and later.
- **Gradients:** none. The gauge fill is solid `--dv-water`; the depth-anchored gradient exists only as proposal P1.
- **Scrolled artboards** may add the system scroll-edge fade under the clock: `mask-image: linear-gradient(to bottom, transparent 0, #000 64px)` on the content layer, 58px on S. This emulates system chrome, not decoration.

---

## C. Components

### C1. System chrome

- **Clock.** Uses `ui-clock`, white, right-aligned.
  - U: right edge x 388, baseline y 44.
  - S: right edge 346, baseline 40.
  - Always-On: 60% white.
- **Root title (Home only).** "다이빙" in `ui-nav-title`, `--dv-action`.
  - U: x 24, baseline 44.
  - S: x 20, baseline 40.
- **Pushed screen.**
  - Back toolbar circle:
    - U: at (16, 6), 62×62px (31pt).
    - S: at (12, 4), 56×56px (28pt).
  - Glyph `chevron.backward`: 30px on U, 28px on S, white. Use the VoiceOver label for that screen: "뒤로" on the summary, and the system default elsewhere.
  - Title sits under the clock in `ui-nav-title` action, right-aligned:
    - U: x 388, baseline 88.
    - S: x 346, baseline 80.
  - On scrolled artboards the title is hidden and content may start at y 72 (U) or 64 (S).
- **Toolbar glass button.**
  - Circle filled with `--dv-glass`.
  - Glyph is 15/30 (U) or 14/28 (S), white, 600-weight strokes.
  - Hit area is 44pt/88px, centred on the circle.
  - Pressed: scale 0.95 (MO-PRESS).
  - It is drawn the same on every screen that has one.

### C2. Start card (`StartSessionCard`, signature `trailingSystemImage: "play.fill"` kept)

| Property | U | S |
|---|---|---|
| Size and position | 398×144px (199×72pt), x 12 | 354×128px (177×64pt), x 10 |
| Radius, fill | 36px, platter | 32px, platter |
| Horizontal padding | 24px | 20px |
| Glyph disc | 72px circle `--dv-marker` | 60px |
| Mode glyph | 44px white custom SVG (C21): monofin for 프리다이빙, tank for 스쿠버 | 40px |
| Gap disc → title | 20px | 16px |
| Title | `ui-headline` white, one line: "프리다이빙" / "스쿠버 다이빙" | same |
| Play disc | 64px `--dv-action` circle at the trailing edge, vertically centred | 60px |
| Play glyph | `play.fill` 26px white, offset +2px on x | 24px |

States:
- **Pressed:** scale 0.95.
- **Disabled** (during the sensor check and on unsupported devices): glyph disc and title at opacity 0.45; play disc `--dv-marker`; play glyph ink3.
- **Arming** (HM-ARM): a 4px (2pt) white ring at radius = disc radius + 6px traces once around the play disc.

The minimum height of 64pt is kept. The two cards are visually identical apart from glyph and title, and no hue is tied to a dive type.

### C3. List row

- **Single-line row:**
  - U: height 96px (48pt). S: height 92px.
  - Platter, radius 24px, padding 0 24px (U) or 0 20px (S).
  - Leading icon 34px (U) or 32px (S) in ink2, in a 48px column.
  - Title in `ui-body` white.
- **Row with detail:**
  - U: height 108px (54pt). S: height 104px.
  - Detail in `ui-footnote` ink2, one line, under the title.
- There are **no chevrons and no borders**. watchOS rows have none.
- Gap between rows is 8px.
- Pressed: scale 0.95.
- **Selected** (plans only): fill `--dv-action-fill` and a trailing `checkmark.circle.fill` at 40px (20pt) in action. The check cutout is drawn in `#0C2D4D`.

### C4. Recent-log card (Home)

Platter with radius 32px and padding 24px (U) or 20px (S). Not tappable (P9 proposes making it tappable).

Content, top to bottom:
1. **Eyebrow row.**
   - Left: "최근 기록" in `ui-eyebrow` ink2.
   - Right: sync glyph 26px ink2 plus the short label in 26px 400 ink2: "전송 대기", "iPhone 저장" or "전송 실패". The failed glyph is danger; its text stays ink2.
2. **Date.** Relative date in 30px (U) or 28px (S), 600 white. Examples: "어제 오후 3:05", "오늘 오전 10:02", "10월 19일 오전 9:30". The year appears only when it is not this year.
3. **Values.**
   - Depth in `ui-card-depth` white, then "m" in 30px (U) or 26px (S), 600 ink2.
   - 16px gap.
   - Then "48분 · 프리" in 30px/28px, 400 ink2.
4. **Sparkline.** 60px (30pt) tall on U, 52px on S, full inner width (C15).
5. **Marker row,** shown only if something applies:
   - Marker chip "데모"/"테스트" (C5).
   - Triangle 22px caution plus "지원 수심 밖" in 24px 400 ink2.
   - "중단 후 복구됨" in 24px 400 ink2.
   - Items are 12px apart.

Spacing: 8px between rows 1–3, then 10px before the sparkline.

VoiceOver reads one summary, unchanged.

### C5. Status chip, phase chip and Demo/Test marker chip

All three share the same shape:
- Height 40px (20pt), padding 0 14px, radius 12px.
- Font `rec-chip` (24px on U, 22px on S).
- Gap between chips 8px.
- Always left-aligned in the status band.

| Kind | Fill | Text colour |
|---|---|---|
| Status or phase ("수면 대기", "요약", "수면", "수심 대기 중", "수심 정보 없음", "수심을 읽지 못함", "수심 측정 범위 밖", "기록 대기") | `--dv-chip` | ink2 |
| Phase "다이빙 중" | `--dv-chip` | `--dv-action` (pinned: the only coloured chip) |
| Marker "데모"/"테스트" | `--dv-marker` | white |

- Chips never take a capsule shape and never take a coloured fill.
- If the depth-status chip and the unsupported-depth chip would show the same words ("수심 측정 범위 밖"), draw it once.
- **Overflow** (rare; exception X-CHIP2): when chips do not fit on one line, the band grows to a second 40px line and the instrument shortens by 24pt, animated with RC-CHIP's 300ms smooth timing.

### C6. Hint chip (real recordings) with page dots

| Property | U | S |
|---|---|---|
| Height | 48px (24pt) | 44px (22pt) |
| Fill, radius | `--dv-chip`, 14px | same |
| Padding | left 16px, right 18px | 14px / 16px |
| Position | centred; bottom = screen bottom − 16px (8pt margin, pinned) | same |
| Maximum width | 368px | 336px |
| Page dots | **vertical stack** at the leading edge, matching watchOS vertical paging: dots 8px (4pt), pitch 12px; current dot white, others `--dv-dot-off` | same |
| Gap dots → text | 12px | 10px |
| Text | `rec-hint` ink2, one of the pinned strings (§F row notes) | same |

Variants:
- **End page:** dots only. Chip width = 16 + 8 + 16 = 40px.
- **Rejected press:** the text becomes white for 2s (RC-REJECT).
- **Demo:** the same chip without dots, text "디지털 크라운으로 수심 조절".
- **Exception X-HINT2:** "동작 버튼 ▸ 프리다이빙으로 바꾸기" is too wide on both sizes. It wraps after "▸" into a 2-line chip, 76px tall on U and 72px on S. On that page only, the instrument shortens by 14pt, animated together with RC-PAGE. This is the current `lineLimit(2)` behaviour. Do not draw this variant; artboards show the "스쿠버로 바꾸기" case, which fits on one line.
- No tap target.

**Water Lock line:** "수중 잠금 해제 시 기록 종료" no longer sits under the chip. It moves into the column's **bottom slot** (C7/C9), so the gauge never resizes when the diver surfaces.

### C7. Recording chassis

The chassis is shared by every real and demo recording page. The structure is pinned: `VStack(spacing: 3)` → status band → `HStack { gauge 46pt; column }` → storage footer → hint, ending in `.padding(.bottom, 8).ignoresSafeArea(.container, edges: .bottom)`.

| Element | U px | S px |
|---|---|---|
| Clock band (system time; demo xmark at the left) | y 0–64 | y 0–58 |
| Demo xmark toolbar circle | (16,6) 62px | (12,4) 56px |
| Status band (always reserved, even when empty) | y 72–112, x 8–414 | y 62–102, x 8–366 |
| Instrument (gauge + column) | y 118–444 (163pt) | y 108–380 (136pt) |
| Gauge frame | x 8–100 | x 8–100 |
| Column | x 112–414 (302px) | x 112–366 (254px) |
| Caption slot | y 118–150 | y 108–136 |
| Hero slot (number baseline) | y 150–270 (baseline 256) | y 136–236 (baseline 224) |
| State slot (stop page only; replaces the 8/4px gap) | y 270–302 | y 236–260 |
| Row 1, inline | 278–330 (stop page: 302–354) | 240–284 (stop page: 260–304) |
| Row 1, stacked (label above value) | 278–354 | 240–306 |
| Row 2, full / quiet | 330–382 / 330–374 (stop: 354–398 quiet; after a stacked row: 354–398 quiet) | 284–328 / 284–318 (stop: 304–338; after stacked: 306–340) |
| Bottom slot, anchored to the instrument bottom (Water Lock line, or storage footer) | y 412–444 | y 354–380 |
| Hint zone | y 450–498 | y 386–430 |

Fit:
- Slack on the stop page and on stacked surface pages is at least 7pt on U and 7–8pt on S.
- On 41mm, use the S geometry with hero sizes 44/40 and labels at 11pt.

**Storage footer.** `externaldrive.badge.exclamationmark` 22px plus "저장 재시도 대기" in 22px 400, both `--dv-danger` (current rule; P7 proposes grey). It sits in the bottom slot and switches to the tight step.

### C8. Depth gauge (`DepthGaugeRail`, `layoutWidth: CGFloat = 46` kept)

Horizontal anatomy, in screen px:

| Part | x (px) | Spec |
|---|---|---|
| Tick labels | right-aligned at x 46 | `rec-tick` ink2. At most 4 labels on 1/2/5/10/20 m steps (existing formula). Each is centred on y(d). |
| Pointer | 48–62 | `chevron.right` (pinned): 20px tall, 6px stroke, weight 700, white, centred on y(d) |
| Rail | 64–92, y 120–442 (U) / 110–378 (S) | 28px capsule (radius 14). Track `--dv-chip`. |
| Index bar | 58–98 | Current depth: 6px (3pt) white bar, radius 3, plus a 2px (1pt) `#000` keyline (`border:2px solid #000` → 10px total) |
| Notch lane | 94–100 | Max-depth notch, stop target pip, tide marks |

Vertical mapping:
- U: `y(d) = 132 + d / R × 298`
- S: `y(d) = 122 + d / R × 244`
- R is the visible range. Examples on U at 0–30: 18.6 m → 316.8; 22.4 m → 354.5. At 0–10: 3 m → 221.4; 5 m → 281; 6 m → 310.8.

Elements:
- **Water fill.** Solid `--dv-water`, clipped to the rail, from y(0) down to y(current depth). Only while depth is live.
- **Tick hairlines.** 2px `--dv-hairline` across the rail (x 64–92) at each labelled depth.
- **Label yield.** A tick label within 16px (8pt) of y(current) drops to 25% opacity over 200ms.
- **Max-depth ghost.**
  - Normal: 3px line, white 50%, across x 64–92, plus a 6×4px notch at x 94–100, white 50%.
  - Details pages: line 100% and notch 8×6px.
  - Never retreats.
  - Hidden in Always-On, off-scale (for example 22.4 m on a 0–10 range), and **during the freediving `diving` phase**.
- **Freedive tide marks (P5).** Shown only when the freediving phase is not `diving`. One 10×3px tick per finished dive at its maximum depth, at x 90–100, for the last 5 dives. The newest is white 80%, older ones white 35%. On freedive Details at the surface: newest 100%, others 50%. There is no separate ghost; the deepest mark is the session maximum.
- **Stop zone** (stop page only; range 0–10):
  - Band from y(3) to y(6), x 58–98, fill `--dv-caution-fill`, radius 6px.
  - 2px `--dv-caution-line` lines on the top and bottom edges. These are lines, not a box border.
  - Target pip: 6×8px `--dv-caution` at x 94–100, centred on y(5).
  - The water fill drops to 50% opacity.
  - The zone is never less than 36px (18pt) tall.
- **Depth not live:** fill, index and chevron fade out over 300ms. Ghost, labels, hairlines and tide marks stay. Nothing is drawn at a "current" position.
- **Beyond the supported limit ("unsupported zone"):**
  - The range caps at the limit.
  - Fill runs full to y(limit).
  - A 2px ink2 cap line sits at y(limit) across x 58–100.
  - No index, no chevron, plus the chip "수심 측정 범위 밖".
  - Nothing is drawn below y(limit).
- **Always-On:**
  - Track becomes a 2px `--dv-aod-stroke` outline capsule with no fill and no hairlines.
  - Labels white 60%.
  - Index becomes 4px white 85% with no keyline; chevron white 85%.
  - Ghost and tide marks hidden.
  - Stop zone: only the two edge lines at caution 60%, plus the pip.

### C9. Big metric block (right column)

Slot order is fixed: caption → hero → [state, stop page only] → row 1 → row 2 → bottom slot (anchored).

- **Hero.** Number in `rec-hero-*`, then a 4px gap, then the unit as **separate** text in `rec-hero-unit`, baseline-aligned (`display:flex; align-items:baseline`). Left-aligned at the column x.
- **Unknown values.** "--.-" or "--:--" in ink3, and the unit in ink3.
- **The caption slot is reserved** even when empty, so the hero baseline never moves between pages.

### C10. Secondary value rows

- Laid out as a CSS grid: `grid-template-columns: max-content 1fr; column-gap: 12px (U) / 10px (S); align-items: baseline;`. Both rows share the grid, so their values share a left edge.
- **Inline row:** label in `rec-row-label`, then value in `rec-row-value` plus unit in `rec-row-unit`.
- **Quiet row:** used for ascent ("상승", value colour ink2), for the stop page's "기록 시간", and for the surface-interval "직전 수심" and the Details "최장 다이빙". Value in `rec-quiet-value` plus `rec-quiet-unit`.
- **Stacked row:** used only when label + value do not fit on one line. Label line, then value in `rec-row-value-stacked`. Fixed cases: "직전 다이빙 시간" (surface interval) and "직전 다이빙" (freedive Details).

### C11. Recommended-stop timer (inside `SafetyStopInstrument`; no `isLuminanceReduced` branch)

- **Caption slot:** "권장 스탑" in `rec-caption` caution, followed after a 12px gap by the minute indices (P2).
  - Three capsules: 24×8px (U) or 20×6px (S), 6px apart, vertically centred on the caption.
  - Finished minutes `--dv-caution`; pending minutes `--dv-caution-dim`.
  - They change once per minute.
- **Hero:** remaining time in `rec-hero-time`, caution.
- **State slot:**
  - Running: empty.
  - Paused: `pause.fill` 20px plus "타이머 일시정지" in `rec-stop-state`. The countdown digits drop to 60% opacity and the indices to 40%.
  - Completed (live): `checkmark` 22px plus "권장 스탑 완료" in `rec-stop-state`. Countdown "00:00". All indices full.
- **Rows:** "수심" inline; "기록 시간" quiet.
- `pausedTooDeep` still falls back to scuba Live.

### C12. Buttons

All buttons:
- Capsule, full width at x 12–410 (U) or 10–364 (S).
- Height 94px (47pt) on U, 88px (44pt) on S.
- Label 34px (U) or 32px (S), weight 600.
- Pressed: scale 0.95.

| Kind | Fill | Label |
|---|---|---|
| Primary | `--dv-action` | white |
| Secondary | `--dv-platter` | **white** (a blue label would read as a link) |

- **Pending:** disabled at 0ms (opacity 0.6). After 1s a 32px white spinner appears 16px before the unchanged label.
- **Disabled:** opacity 0.45.
- There is no destructive style on the watch.
- The toolbar button is C1.

### C13. Page indicator (system vertical pages: guide and detail)

- Dots 12px (6pt), pitch 14px, vertical.
- Centred at x 410 (U) or 362 (S), vertically centred on the screen.
- Current dot white, others `--dv-dot-off`.
- Hidden in Always-On.
- Recording pages never use this indicator; their dots live inside the hint chip.

### C14. Static skeleton (reserved)

- Blocks are `--dv-marker`, radius 12px, at the final row geometry. Plan-row example: a title block 28px tall at 60% width, then a value block 40px tall at 40% width.
- Invisible for the first 1s. No pulse and no shimmer. Hidden from accessibility and not hittable. Replaced instantly when data arrives, with no minimum display time.
- **No current watch screen needs a skeleton.** The list reads synchronously, Home draws the real cards disabled, and saving appears immediately. The skeleton is drawn only on the system sheet.

### C15. Mini depth profile, sparkline and profile chart

- **Shape.** 0 m is at the top. Depth axis runs from 0 to max × 1.1. The polyline uses the points in §E.
- **Area.** Polygon from (0,0) along the line to (W,0), filled with `--dv-water-area`. This is the water above the diver.
- **Line.** 3px (1.5pt) `rgba(255,255,255,.85)`, round joins.
- **Max dot.** White circle at the deepest point:
  - 10px on summary and detail
  - 8px on cards and lists
- **Sizes:**

| Use | U | S |
|---|---|---|
| Home card | 60px tall | 52px |
| List row | 32px | 28px |
| Summary | 112px | 96px |
| Detail | 128px (96px when send failed) | 104px |

- No axes or ticks.
- The summary adds the label "22.4 m" in 24px ink2, 8px to the right of the max dot.
- VoiceOver reads only the range.
- Always-On: line at 50%, no area.

### C16. Unsupported-depth marker (saved views)

- Summary and detail:
  - Row: `exclamationmark.triangle.fill` 24px caution plus "지원 수심 밖" in `ui-footnote-em` white.
  - Below it: "이 앱이 Apple Watch에서 지원하는 수심보다 깊습니다. 복기용으로만 보관합니다." in `ui-footnote` ink2.
  - No platter.
- Card and list rows: the compact form from C4, item 5.

### C17. Non-certified footnote

- `ui-footnote` ink3.
- Home footer: centred, under the manta mark. The mark is 32×19px (16pt wide), ink3, with 12px between mark and text.
- Everywhere else: leading-aligned in the flow.
- It is never white and never larger than the instructions on the same screen.

### C18. Banner and persistent note

- **Banner** (auto-hides after 4s):
  - Platter, radius 24px, x 12–410 (U) or 10–364 (S).
  - Bottom edge 16px above the screen bottom; padding 16px/24px.
  - `exclamationmark.circle.fill` 26px danger, then text in 28px (U) or 26px (S), 400 white.
  - The "(n)" counter in ink3.
- **Persistent save-failure note:** the same look, but inline in the scroll flow above the buttons. It never auto-hides.

### C19. Wet Ready mode tile

| Property | U | S |
|---|---|---|
| Layout | Two tiles side by side, gap 10px | same |
| Left tile | x 12–206 | x 10–182 |
| Right tile | x 216–410 | x 192–364 |
| Height | 128px (64pt) | 116px (58pt) |
| Radius | 32px | 32px |
| Glyph | 44px, top inset 20px, centred | 40px, top inset 18px |
| Label | `ui-wet-mode`, centred, baseline 22px above the tile bottom | same |

- Each tile keeps the pinned `.frame(maxWidth: .infinity, minHeight: 44)`.
- **Selected:** fill `--dv-action`; glyph and label white.
- **Unselected:** fill platter; glyph and label ink2.
- Pressed: scale 0.95.
- Always-On: the selected tile becomes a 3px `--dv-action` outline with no fill.

### C20. Stacked stat (summary and detail; Workout-summary style, no platter)

- Label in `ui-eyebrow` ink2.
- Value in `ui-stat-value` white. Units and "분/초" in `ui-unit-m` ink2.
- Block height 75px, gap 16px.
- Two-column grid with each column 175px wide:
  - U: x 36 and 222.
  - S: x 30 and 191.
- Full-width rows span both columns.

### C21. Icons

All icons are inline SVG, `viewBox="0 0 24 24"`, drawn in `currentColor`. Strokes use `stroke-linecap:round; stroke-linejoin:round`.

**SF Symbol stand-ins**

| Name | SVG |
|---|---|
| `play.fill` | `<path d="M8 4.8v14.4c0 .8.9 1.3 1.6.8l11-7.2c.6-.4.6-1.2 0-1.6l-11-7.2C8.9 3.5 8 4 8 4.8z"/>` |
| `checkmark.circle.fill` | `<circle cx="12" cy="12" r="10"/><path d="M7.4 12.4l3.1 3.1 6.1-6.6" fill="none" stroke="(surface colour)" stroke-width="2.2"/>` |
| `circle` | `<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/>` |
| `checkmark` | `<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke-width="2.6"/>` |
| `chevron.backward` | `<path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke-width="2.8"/>` |
| `chevron.right` (gauge pointer) | `<path d="M9 4.5l7.5 7.5L9 19.5" fill="none" stroke-width="3.4"/>` |
| `xmark` | `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke-width="2.8"/>` |
| `list.bullet` | `<circle cx="5" cy="6.5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="17.5" r="1.6"/><path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" stroke-width="2"/>` |
| `list.bullet.clipboard` | `<rect x="5" y="4" width="14" height="17" rx="2.5" fill="none" stroke-width="1.8"/><rect x="9" y="2.5" width="6" height="3.5" rx="1.2"/><path d="M9 11h6M9 15h6" stroke-width="1.8"/>` |
| `hand.tap` | `<path d="M10 21v-9.5a1.5 1.5 0 0 1 3 0V15l4.2.9a2 2 0 0 1 1.5 2.3L18 21" fill="none" stroke-width="1.8"/><path d="M8 7.5a3.5 3.5 0 0 1 7 0" fill="none" stroke-width="1.6"/>` |
| `digitalcrown.arrow.clockwise` | `<rect x="15.5" y="8" width="4" height="8" rx="1.2"/><path d="M12 5.2a6.8 6.8 0 1 0 1.2 13.4" fill="none" stroke-width="1.8"/><path d="M12.4 16.2l1.2 2.4-2.5 1" fill="none" stroke-width="1.8"/>` |
| `info.circle` | `<circle cx="12" cy="12" r="9.5" fill="none" stroke-width="1.8"/><circle cx="12" cy="7.6" r="1.3"/><path d="M12 10.8v6" stroke-width="2.2"/>` |
| `exclamationmark.circle.fill` | `<circle cx="12" cy="12" r="10"/><path d="M12 6.8v6.4" stroke="#000" stroke-width="2.4"/><circle cx="12" cy="16.9" r="1.4" fill="#000"/>` |
| `exclamationmark.triangle.fill` | `<path d="M10.3 3.6L2.6 17.4c-.8 1.4.2 3.1 1.7 3.1h15.4c1.5 0 2.5-1.7 1.7-3.1L13.7 3.6c-.8-1.4-2.6-1.4-3.4 0z"/><path d="M12 9v4.6" stroke="#000" stroke-width="2.2"/><circle cx="12" cy="16.8" r="1.2" fill="#000"/>` |
| `pause.fill` | `<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>` |
| `button.programmable` | `<rect x="2.5" y="6.5" width="19" height="11" rx="5.5" fill="none" stroke-width="1.8"/><rect x="6.5" y="10" width="11" height="4" rx="2"/>` |
| `lock.open` | `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4"/><path d="M8 10.5V7.6a4 4 0 0 1 7.7-1.5" fill="none" stroke-width="2"/>` |
| `water.waves` | `<path d="M3 8c2 0 2-1.5 4.5-1.5S9.5 8 12 8s2-1.5 4.5-1.5S18.5 8 21 8M3 13c2 0 2-1.5 4.5-1.5S9.5 13 12 13s2-1.5 4.5-1.5S18.5 13 21 13M3 18c2 0 2-1.5 4.5-1.5S9.5 18 12 18s2-1.5 4.5-1.5S18.5 18 21 18" fill="none" stroke-width="1.8"/>` |
| `applewatch.and.arrow.forward` | `<rect x="2.5" y="6" width="10" height="12" rx="3" fill="none" stroke-width="1.8"/><path d="M5 6l.6-2.5h3.8L10 6M5 18l.6 2.5h3.8L10 18" fill="none" stroke-width="1.6"/><path d="M15 12h6.5M18.5 9l3 3-3 3" fill="none" stroke-width="1.8"/>` |
| `iphone.gen3` | `<rect x="7" y="2.5" width="10" height="19" rx="2.6" fill="none" stroke-width="1.8"/><rect x="10.2" y="4.2" width="3.6" height="1.2" rx=".6"/>` |
| `iphone.gen3.slash` | the `iphone.gen3` paths plus `<path d="M4 3.5l16 17" stroke-width="1.8"/>` |
| `externaldrive.badge.exclamationmark` | `<rect x="2.5" y="9" width="14" height="8" rx="2" fill="none" stroke-width="1.8"/><circle cx="19" cy="7" r="4"/><path d="M19 5v2.4" stroke="#000" stroke-width="1.6"/>` |

**Custom glyphs** (the SF Symbol templates are `divenary.freedive`, `divenary.scuba` and `divenary.manta`; fallbacks in code are `figure.pool.swim` and `drop.fill`):

- **Monofin** (`divenary.freedive`):
  `<path d="M12 2.5c-1.5 0-2.4 1.2-2.4 2.8v6.6c0 1.1-.4 2.1-1.2 2.9L4.6 18.6c-.7.7-.2 1.9.8 1.9h13.2c1 0 1.5-1.2.8-1.9l-3.8-3.8c-.8-.8-1.2-1.8-1.2-2.9V5.3c0-1.6-.9-2.8-2.4-2.8z"/>`
- **Tank** (`divenary.scuba`):
  `<rect x="7.5" y="6.5" width="9" height="15.5" rx="4.5"/><rect x="10.3" y="2.5" width="3.4" height="4.6" rx="1"/><path d="M13.7 4.2h2.8a2.3 2.3 0 0 1 2.3 2.3V10" fill="none" stroke="currentColor" stroke-width="1.7"/>`
- **Manta** (`divenary.manta`, `viewBox="0 0 40 24"`):
  - Body: `<path d="M20 4.2c-2 0-3.4 1.1-4.3 2.6C12.4 5.6 6.6 6.1 1.6 10.4c4.9.4 9.1 2.1 12.2 5 1.1 2.2 3 3.4 5 3.7l.6 4.7h1.2l.6-4.7c2-.3 3.9-1.5 5-3.7 3.1-2.9 7.3-4.6 12.2-5-5-4.3-10.8-4.8-14.1-3.6C23.4 5.3 22 4.2 20 4.2z"/>`
  - Cephalic fins: `<path d="M17.6 4.9c-.6-1.2-.6-2.5.1-3.4M22.4 4.9c.6-1.2.6-2.5-.1-3.4" fill="none" stroke="currentColor" stroke-width="1.4"/>`
  - Wing fold: `<path d="M25 7.1c3.3-.9 8.4-.3 13.4 3.3-3.9.6-7.6 2-10.5 4.4z" opacity=".5"/>`

### C22. Always-On summary (per component)

| Element | Always-On treatment |
|---|---|
| Hero | White. The stop countdown also turns white through the shared hero style. |
| Units | ink3 |
| Kept rows | 80% |
| Hidden items | `opacity:0`, layout kept: ascent, dive count row, previous-dive values, maximum depth, temperature |
| Chips and markers | Always kept, at 80% |
| "권장 스탑", "타이머 일시정지", "권장 스탑 완료", "수심", "기록 시간" | Always kept. "권장 스탑" stays caution at 80%. |
| Stop minute indices | Static: finished 60%, pending 20% |
| Hint chip | Dots hidden; text at 50% |
| Water Lock line | 60% |
| Gauge | As in C8 |
| Wet Ready, summary, list, detail | System dimming |

---

## D. Motion spec

### D1. Guardrails

- Every animation reacts to a value or state change. There are no idle loops on any app screen; looping demos appear only on the system sheet's motion legend.
- Underwater nothing bounces, nothing overshoots, and nothing runs longer than 600ms. Depth, time, the stop countdown and surface rest never roll.
- Automatic changes use cross-fades only. Movement in a direction means the diver did it.
- **Reduce Motion:** every move or scale becomes an opacity change of 200ms ease-in-out. `numericText` becomes `.identity`, symbol effects are off, and the finale reduces to a fade.
- **Always-On:** `transaction.animation = nil`. Updates are 1 Hz or slower. The only motion is a 300ms settle on enter and exit.
- No view plays haptics. `WatchDiveHaptics` keeps its five events: start, page change, rejected press, end requested, saved.

### D2. Tokens

```css
:root{
  --ease-smooth: cubic-bezier(.2,.8,.2,1);      /* ≈ SwiftUI .smooth (bounce 0) */
  --ease-snappy: cubic-bezier(.2,.9,.25,1.03);  /* ≈ .snappy (bounce .15) */
  --ease-bouncy: cubic-bezier(.34,1.4,.64,1);   /* ≈ .bouncy (bounce .3), land only */
  --ease-inout:  cubic-bezier(.42,0,.58,1);     /* = .easeInOut */
  --ease-out:    cubic-bezier(0,0,.58,1);       /* = .easeOut */
  --ease-linear: linear;                        /* = .linear */
  /* optional exact springs (Chrome/Safari 17+) */
  --spring-smooth: linear(0,.101,.289,.476,.63,.746,.829,.887,.926,.953,.97,.981,.988,.992,.995,.997,1);
  --spring-snappy: linear(0,.098,.292,.495,.666,.795,.884,.941,.975,.994,1.003,1.006,1.006,1.005,1.004,1.003,1);
  --spring-bouncy: linear(0,.128,.38,.632,.826,.951,1.018,1.043,1.045,1.035,1.023,1.013,1.005,1.001,.999,.998,1);
}
```

### D3. Animation table

Durations are CSS ms. SwiftUI durations are the same value in seconds. RM = Reduce Motion; AOD = Always-On.

| ID | Trigger | Element | Property | ms | CSS easing | SwiftUI | RM | AOD |
|---|---|---|---|---|---|---|---|---|
| MO-PRESS | Press on a card, row, tile, button or toolbar circle | Pressed element | `transform: scale(.95)` and back | 250 | snappy | `.scaleEffect(p ? 0.95 : 1).animation(.snappy(duration:0.25), value:p)` | opacity 1→.7, 150 | n/a |
| HM-ENTER | Home first appears in a launch (not on pop) | Start cards, plan row, card, rows, in order | opacity 0→1, translateY 16px→0, stagger 40ms | 500 | smooth | `.transition(.opacity.combined(with:.offset(y:8)))` + `.smooth(duration:0.5).delay(i*0.04)` on `@State didAppear` | opacity 200 | n/a |
| HM-READY | Sensor check finishes | Card content; play disc | opacity .45→1; disc bg `#3A3A3C`→`#2997FF` | 250 | inout | `.animation(.easeInOut(duration:0.25), value:isReady)` | same | n/a |
| HM-ARM | Start card tapped | Ring around the play disc | `stroke-dashoffset` C→0 (C = 2πr) | 600 | inout | `Circle().trim(from:0,to:p).stroke(.white, lineWidth:2)`, run in parallel with `startManual`. After 1s with no start, replace with a static `ProgressView`. | ring skipped | n/a |
| HM-SPARK | A log's profile is drawn for the first time (card, list row) | Line, area, dot | line dashoffset L→0; area opacity 0→1; dot scale .6→1 + opacity (300ms, starts at 600ms) | 600 | smooth / dot snappy | `.trim(from:0,to:p)` with `.smooth(duration:0.6)`. Remember drawn log IDs. | fade 200 | static |
| HM-SYNC | Transfer status changes | Sync glyph | cross-fade + scale .8→1 | 300 | snappy | `.contentTransition(.symbolEffect(.replace))` | identity | n/a |
| HM-SUB | Return from Plans after a change | Plan row detail | cross-fade | 200 | inout | `.contentTransition(.opacity)` | same | n/a |
| PL-SELECT | Plan row tapped | Trailing glyph; row fill | `circle`→`checkmark.circle.fill`: scale 1→1.18→.96→1; fill → action-fill (200); pop back after 350 | 450 | bouncy (pre-dive, land) | `.contentTransition(.symbolEffect(.replace))` + `.symbolEffect(.bounce, value:isSelected)`; `.easeInOut(0.2)`; dismiss after 0.35s | replace without bounce; pop after 200 | n/a |
| GD-PAGE | Page change in the guide or detail (crown or swipe) | Page content | out: opacity→0, translateY −40px, blur 4px; in: from +40px | 350 | smooth | `.tabViewStyle(.verticalPage(transitionStyle:.blur))` | opacity 200 | dots hidden |
| GD-ILLUS | Guide page becomes visible | Hardware highlight | highlight opacity 0→1 (300), then one action: Action Button scale 1→.88→1 (400), or crown arc rotate 0→90° (600), or waves translateX 0→6px→0 (600). Once only. | 300 + ≤600 | smooth | `phaseAnimator([.idle,.highlight,.rest], trigger: page)`; glyph `.symbolEffect(.bounce, value: page)` | static highlight | n/a |
| WR-ENTER | Wet Ready appears | Content | opacity 0→1 | 300 | out | `.transition(.opacity)` | same | n/a |
| WR-MODE | Crown detent or tile tap on Wet Ready | Blue selection fill; newly selected glyph | fill `translateX` to the other tile; glyph scale 1→1.18→.96→1 | 300 / 450 | snappy / bouncy | `matchedGeometryEffect(id:"selection", in:ns)` + `.snappy(duration:0.3)`; `.symbolEffect(.bounce, value:mode)`. System detent haptic only. | cross-fade 150 | outline tile, instant |
| RC-ENTER | Recording starts (Wet Ready Action Button, auto-launch, start card) | Wet Ready → chassis | Wet Ready opacity→0 (250, out); rail `scaleY 0→1`, `transform-origin: top` (500, starts at 100); hero and rows opacity 0→1 (200, starts at 150); ticks, chips and hint opacity (200, starts at 250) | 600 total | smooth | phase change in `RealRecordingFlowView` inside `withAnimation(.smooth(duration:0.5))`; rail `.scaleEffect(y: grown ? 1 : 0, anchor: .top)` | cross-fade 200 | instant |
| RC-DEPTH | New depth sample | Fill bottom edge, index, chevron | `transform: translateY` / height | 300 | **linear** | Animatable `WaterColumnShape(level:)`, `.animation(.linear(duration:0.3), value: sampleID)` scoped to the rail. Hero digits use `.contentTransition(.identity)`. | jump | jump ≤1 Hz |
| RC-LIVE | Depth, time, stop countdown, surface rest, total time | Text | none (instant) | 0 | — | `.contentTransition(.identity)` | — | ≤1 Hz |
| RC-PAGE | Diver page change (Action Button or crown) | **Right column only**; hint text and dot | out: opacity→0, translateY 0→−12px (200, out); in: opacity 0→1, translateY +12px→0 (350, smooth). Crown back reverses direction. Hint text and dot cross-fade 200. | 350 | smooth | `.id(page)` + `.transition(.asymmetric(insertion:.opacity.combined(with:.offset(y:6)), removal:.opacity.combined(with:.offset(y:-6))))`, `.smooth(duration:0.35)` | opacity 200 | n/a (forced Live) |
| RC-AUTO | Automatic return to Live: 10s idle, phase change, stop starts, depth not live, AOD, end no longer allowed, switch window closed | Right column | cross-fade only | 450 | inout | `.transition(.opacity)`, `.easeInOut(duration:0.45)`. **No haptic.** | 200 | instant |
| RC-HERO | Hero changes quantity (depth↔time; freedive surface↔diving) | Hero | old: opacity→0, scale .96; new: opacity 0→1, scale .96→1 | 300 | smooth | `.id(heroKind).transition(.opacity.combined(with:.scale(0.96)))` | opacity | instant |
| RC-SIGNAL | Depth stops or resumes being live | Fill, index, chevron | opacity 1↔0 | 300 | out | `.opacity(isLive ? 1 : 0)` + `.easeOut(duration:0.3)` | same | instant |
| RC-CHIP | Chip appears, leaves or changes | Chip; band height (X-CHIP2) | opacity 0→1, scale .9→1 (origin left); text cross-fade 200; band grows 300 | 350 | snappy | `.transition(.opacity.combined(with:.scale(0.9, anchor:.leading)))`, `.contentTransition(.opacity)` | opacity | instant |
| RC-RANGE | Visible range changes (30→40, Live 30 ↔ stop 10) | Labels, hairlines, fill, ghost, zone | old layer opacity 1→0 (150), new layer 0→1 (250). **No interpolated sliding** (P3 would add sliding). | 250 | inout | two layers keyed by `visibleRange`, `.transition(.opacity)` | same | instant |
| RC-STOPIN | Stop page replaces Live (automatic) | Column (RC-AUTO); RC-RANGE; zone band; fill | zone opacity 0→1 (300, starts at 200); fill opacity 1→.5 (300) | 500 | inout | as above. **No haptic, no flash.** | opacity | instant |
| RC-STOPMIN (P2) | A stop minute completes | That index | opacity .25→1 | 200 | out | `.easeOut(duration:0.2), value: completedMinutes` | same | static |
| RC-STOPPAUSE | Stop pauses or resumes | State text; countdown; indices | text cross-fade; countdown 1↔.6; indices →.4 | 200 | inout | `.contentTransition(.opacity)` | same | instant |
| RC-STOPDONE | Stop completes (live) | `checkmark` and text | opacity 0→1, scale .8→1, **no overshoot, no bounce** | 300 | smooth | `.transition(.symbolEffect(.appear))`, never `.bounce` or `.drawOn` | opacity | static |
| RC-COUNT | Freedive dive count +1 (event) | Count digits | old digit up and out, new digit up from below (translateY ±60%) | 350 | snappy | `.contentTransition(.numericText(value: Double(count)))`, `.snappy` | identity | hidden |
| RC-TIDE (P5) | Freedive surfacing (diving → interval) | New tide mark; previous newest | new mark starts as a 3px line across x 64–100 at 80%, then `scaleX 1→.18` (`transform-origin: right`) into the notch; previous newest 80%→35% | 450 | smooth | `TideMark` width and offset, `.smooth(duration:0.45)` | notch fades in 200 | hidden |
| RC-WATERLOCK | Water state changes | Water Lock line (bottom slot) | opacity + translateY 8px→0 | 300 | smooth | `.transition(.opacity.combined(with:.offset(y:4)))` | opacity | 60%, no animation |
| RC-REJECT | Rejected press | Hint text | cross-fade to white rejection text (150), hold 2000, back (200) | 150/200 | inout | `.contentTransition(.opacity)`; 2s timer `rejectionNoteSeconds` | same | n/a |
| RC-STORAGE | Journal write uncertain | Footer; tight step | footer opacity in 200; sizes 300 | 300 | smooth | — | opacity | instant |
| RC-END | Action Button on the End page | Ending overlay | column→0; gauge → silhouette at 30%; overlay in (≤150, shown immediately) | 150 | out | `.transition(.opacity)` | same | same |
| RC-AOD | Always-On begins or ends | Fill→outline, hidden rows→0, dots, hero colour | opacity and colour only, no movement | 300 | inout | `.easeInOut(duration:0.3), value:isLuminanceReduced` at the parent (not in `SafetyStopInstrument`) | same | — |
| PD-SPIN | Ending and saving screens | Spinner | system `ProgressView`; CSS 12-step spin | 1000/turn | `steps(12)` | `ProgressView()` | same | n/a |
| PD-FINALE | Summary first shown after a save returns (not on back navigation) | See timeline below | see below | ≤1100 | — | `keyframeAnimator` or `withAnimation(_:completionCriteria:_:completion:)`; `.trim`; `.symbolEffect(.bounce, value: saved)` | all visible; profile fades 200; no manta | static final |
| PD-RETRY | "다시 저장", "다시 보내기", "다시 시도" | Button | disabled at 0; spinner at 1000; on success glyph → `checkmark` (replace), then leave after 400 | — | snappy | `.contentTransition(.symbolEffect(.replace))` | fade | n/a |
| PD-BANNER | Bottom failure note | Banner | in: translateY 16px→0 + opacity (300 snappy); after 4000: opacity→0 (200) | 300/200 | snappy | `.transition(.move(edge:.bottom).combined(with:.opacity))` | opacity | n/a |
| LS-EDGE | Scrolling a list, summary or detail | Rows at the scroll edges | scale .94, opacity .75 at the edges | scroll-linked | — | `.scrollTransition { c,p in c.scaleEffect(p.isIdentity ? 1 : 0.94).opacity(p.isIdentity ? 1 : 0.75) }` | opacity only | n/a |
| DT-PROFILE | Detail page 1 first opens | Profile | as HM-SPARK | 800 | smooth | `.trim` | fade 200 | static |

**PD-FINALE timeline** (t = 0 when the summary appears):
1. **t0:** the "저장됨" checkmark bounces once: scale 1→1.18→.96→1 over 450ms, bouncy. The coordinator plays the `saved` haptic at the same moment, for real recordings only. The animation does not trigger the haptic.
2. **t0–300ms:** max depth and total time rise 12px and fade in, 80ms apart, smooth. They show their true values from the first frame and never count up.
3. **t150–1050ms:** the profile line draws (900ms, ease-in-out) and the area fades in over the same span. A 24px (12pt) white manta rides the drawing tip (`offset-path` along the profile, `offset-rotate: auto`) and fades out over 200ms past the end.
4. **t900ms:** the max dot pops (scale .6→1, 350ms, snappy).
5. A tap or crown turn jumps straight to the end state.

### D4. CSS keyframes for the mockups

```css
@keyframes dv-rise-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes dv-fade-in{from{opacity:0}to{opacity:1}}
@keyframes dv-fade-out{from{opacity:1}to{opacity:0}}
@keyframes dv-page-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes dv-page-in-back{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
@keyframes dv-page-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-12px)}}
@keyframes dv-guide-in{from{opacity:0;transform:translateY(40px);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
@keyframes dv-ring-trace{from{stroke-dashoffset:var(--c)}to{stroke-dashoffset:0}}
@keyframes dv-draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
@keyframes dv-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes dv-bounce{0%{transform:scale(1)}35%{transform:scale(1.18)}70%{transform:scale(.96)}100%{transform:scale(1)}}
@keyframes dv-appear{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
@keyframes dv-chip-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}} /* transform-origin:left center */
@keyframes dv-rail-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}            /* transform-origin:top */
@keyframes dv-tide{from{transform:scaleX(1)}to{transform:scaleX(.18)}}               /* transform-origin:right */
@keyframes dv-manta-ride{from{offset-distance:0%;opacity:1}90%{opacity:1}to{offset-distance:100%;opacity:0}}
@keyframes dv-spin{to{transform:rotate(360deg)}}
@keyframes dv-press-hint{0%,100%{transform:scale(1)}50%{transform:scale(.88)}}
@keyframes dv-crown-turn{from{transform:rotate(0)}to{transform:rotate(90deg)}}
@keyframes dv-waves-shift{0%,100%{transform:none}50%{transform:translateX(6px)}}
.dv-press{transition:transform 250ms var(--ease-snappy)} .dv-press:active{transform:scale(.95)}
.dv-gauge-move{transition:transform 300ms linear, height 300ms linear}
.dv-xfade{transition:opacity 200ms var(--ease-inout)}
@media (prefers-reduced-motion:reduce){
  *{animation-duration:200ms!important;animation-timing-function:var(--ease-inout)!important;transition:opacity 200ms var(--ease-inout)!important}
  .dv-move,.dv-gauge-move{transform:none!important}
}
```

Static artboards play their listed animations once, on load. A "canvas demo" marked as such may repeat every 3s.

---

## E. Mock data (one story, reused everywhere)

**Watch and settings**
- Ultra 3, 49mm, with the full 40 m limit. The OutOfRange artboard is the exception: it shows a 6 m shallow-entitlement watch.
- Action Button is assigned to Divenary.
- **Auto-launch is off**, so the Home row reads "자동 실행 꺼짐" and Wet Ready shows the Action Button guidance variant.

**Plans**

| # | Title | Type | Planned depth | Date | Selected |
|---|---|---|---|---|---|
| 1 | "문섬 동쪽 벽" | 스쿠버 | 18.0 m | "오늘 오전 10:00" | yes |
| 2 | "범섬 프리다이빙 연습" | 프리다이빙 | 15.0 m | "내일 오전 9:00" | no |
| 3 | "섶섬 산호 정원" | 스쿠버 | 25.0 m | "10월 24일 오전 9:30" | no |

### Story A: scuba, today (2026-10-22), 서귀포 문섬 동쪽 벽

Entry 오전 10:02. Recording time 42:10. Maximum 22.4 m, reached at 12:00.

| Artboard | Clock | Values |
|---|---|---|
| Home | 9:41 | — |
| Wet Ready | 10:01 | 수심 0.6 m |
| Scuba Live | 10:24 | depth 18.6 m · 시간 21:40 · 상승 0.4 m/min · max 22.4 · 수온 21.3 °C |
| Depth unavailable | 10:28 | 26:18, chip "수심 정보 없음" |
| Stop running | 10:40 | remaining 01:52 · 수심 5.2 m · 기록 시간 38:08 · 1 minute done |
| Stop paused (too shallow) | 10:41 | 01:24 · 수심 2.4 m · 기록 시간 38:50 |
| Stop done | 10:43 | 00:00 · 수심 4.8 m · 기록 시간 40:52 |
| End | 10:45 | chip "수면" · 기록 시간 42:10 |
| Ending, saving | 10:45 | — |
| Summary | 10:46 | sync "iPhone 전송 대기" |

**Saved values**

| Field | Value |
|---|---|
| 최대 수심 | 22.4 m |
| 총 기록 시간 | 42분 10초 |
| 평균 수심 | 12.8 m |
| 평균 수온 | 21.6 °C |
| 최대 상승 속도 | 8.6 m/min |
| 수심 측정 횟수 | 2,530 |

**Recommended stop**

| Field | Value |
|---|---|
| 상태 | 권장 스탑 완료 |
| 남은 시간 | 0초 |
| 구간 체류 시간 | 3분 |
| 권장 사항 | 권장 스탑 |
| 완료 여부 | 예 |
| 목표 / 구간 | 5.0 m · 3.0 m-6.0 m |
| 시작 | 오전 10:39 |
| 완료 시각 | 오전 10:42 |

**Detail** (viewed at 1:21; sync "iPhone에 저장됨")

| Field | Value |
|---|---|
| 호흡 기체 | 공기 |
| 다이빙 포인트 | 서귀포 문섬 동쪽 벽 |
| 평점 | ★★★★☆ (4) |
| 시야 | 4/5 |
| 수중 상태 | 약한 물결 |
| 메모 | "동쪽 벽을 따라 연산호 군락. 자리돔 떼가 많았다." |

**Profile A** (fraction of time, depth in m):
(0,0) (.03,4) (.07,12) (.10,17.5) (.14,19.8) (.20,21.0) (.26,22.4) (.32,21.2) (.40,19.6) (.48,18.6) (.56,17.0) (.64,15.2) (.72,12.4) (.78,9.8) (.83,7.0) (.86,5.4) (.89,5.1) (.92,5.0) (.94,4.9) (.96,3.0) (.98,1.2) (1,0)

### Story B: freedive, yesterday (10월 21일), 서귀포 범섬

Start 오후 3:05. Total 48분 20초. 7 dives. Maximum 14.2 m. Longest 1분 32초. Sync "iPhone 저장".

| Dive | Time · depth | 수면 휴식 before |
|---|---|---|
| #01 | 00:52 · 8.4 m | — |
| #02 | 01:01 · 10.4 m | 03:10 |
| #03 | 01:12 · 12.0 m | 02:48 |
| #04 | 01:32 · 13.5 m | 03:05 |
| #05 | 01:04 · 9.8 m | 02:30 |
| #06 | 01:06 · 14.2 m | 02:41 |
| #07 | 00:58 · 11.0 m | 02:56 |

**Live freedive artboards**

| Artboard | Clock | Values |
|---|---|---|
| Surface ready (out of water) | 3:06 | 총 기록 시간 00:40 · 다이빙 횟수 0 · 수심 --.- m |
| Switch (in water) | 3:06 | 0.4 m |
| Surface rest (after #06, in water at 0.4 m) | 3:46 | 수면 휴식 02:14 · 직전 01:06 · 14.2 m · tide marks #02–#06 |
| Details | 3:46 | 다이빙 횟수 6 · 최장 01:32 |
| Diving (#07) | 3:49 | 9.6 m · 시간 00:31 · 상승 0.0 m/min |

**Profile B:** seven V-dips, each from 0 to the bottom at 45% of the dive's width and back to 0.

| Dive | Start | Width | Depth (m) |
|---|---|---|---|
| #01 | .10 | .018 | 8.4 |
| #02 | .20 | .021 | 10.4 |
| #03 | .31 | .025 | 12.0 |
| #04 | .43 | .032 | 13.5 |
| #05 | .56 | .022 | 9.8 |
| #06 | .69 | .023 | 14.2 |
| #07 | .82 | .020 | 11.0 |

The line stays at 0 between dives.

### Other logs

- **Story C:** 10월 19일 오전 9:30, 섶섬, scuba, 18.1 m, 47분 30초, sync "iPhone 전송 실패". Detail note: "전송하지 못했습니다. 다시 시도하세요. (1)". Profile: Profile A scaled to 18.1 m.
- **Story D:** 10월 18일 오후 8:12, demo, 7.3 m, 4분, marker "데모", sync pending. Demo live artboard: clock 8:12, 7.3 m, 03:12, 상승 0.0 m/min, max 9.1.
- **Out-of-range edge case:** shallow-entitlement watch, clock 10:10, beyond the 6 m limit, time 08:12.

---

## F. Artboard plan

**General rules**
- Each artboard is exactly the screen size: 422×514 (U) or 374×446 (S).
- Root style: black background, `border-radius` 88px (U) or 76px (S), `overflow:hidden`.
- An artboard that carries a proposal or an edge-case caption is 422×560 (U) or 374×492 (S). The screen sits at the top and a 46px strip sits below it on `#111`. The strip holds a yellow pill (`#FFD600` background, black 22px/600 text) with "제안 Pn" or "예외", then 22px ink2 text naming the fallback.
- Positions use the chassis in C7 and the components in §C. Only artboard-specific content is listed below.

### Row 1: System

**Row note:** "Plumb · 측심 — 토큰, 컴포넌트, 모션, 제안. 목업은 현재 규칙을 따르고, 제안은 노란 띠로 표시."

**1. `System-DesignSheet.dc.html`** · "디자인 시스템 시트" · 1400×2800, black.
- **(0–220) Header.** "Plumb · 측심" in 56px/700 white, then the concept paragraph from §A in 24px ink2. Then 5 principle cards, each 256×120 on a platter, each with its title in 24px/600 and one line of body text.
- **(240–640) Colour.** All B1 tokens as 160×96 swatches in a 6-column grid. Under each: name, hex, role and contrast in 18px. A swatch whose role is "fill only" is labelled "텍스트 금지".
- **(660–1240) Type.** Two columns, Ultra and 42mm. Each token is rendered with its real sample:
  - recording: "18.6 m", "23:45", "권장 스탑", "동작 버튼 ▸ 상세 1/2"
  - UI: "다이빙", "최근 기록", "다이빙 기록·복기용입니다."
  - Each sample is followed by its spec line in 16px ink3.
- **(1260–1460) Spacing, radii, materials.** Scale bars; a radius gallery labelled "캡슐 = 누를 수 있음 · 둥근 사각형 = 정보"; a glass circle on a striped test background.
- **(1480–2380) Components at 2×, with captions:**
  - start card in normal, pressed, disabled and arming
  - row in single, detail and selected
  - recent card
  - chips: "수면 대기", "다이빙 중", "수심 정보 없음", "데모", "테스트"
  - hint chip with 2 dots, 3 dots, dots only, rejected, demo
  - metric block with depth hero, time hero and "--.- m"
  - inline, quiet and stacked rows
  - stop timer in running, paused and done
  - primary and secondary buttons in normal, pressed, pending and disabled
  - toolbar glass circle with back and xmark
  - system page indicator
  - static skeleton (plan row)
  - profile chart, card sparkline, list sparkline
  - unsupported marker in both forms
  - non-certified footnote with manta
  - banner and persistent note
  - Wet Ready tiles, selected and unselected
  - stacked stat
  - the icon set from C21 at 48px
- **(2400–2800) Motion legend.** Every ID in D3 on its own row: ID, name, ms, easing, and a 120×80 demo cell that loops every 3s (canvas only).

**2. `System-GaugeAnatomy.dc.html`** · "게이지 해부도" · 1400×1100.
- **Left (x 40–480):** the U gauge drawn at 4× (368×1304px, scaled to fit 1000px tall). Callout lines on the right label each part with its C8 coordinates.
- **Right:** nine gauge states at 2× (92×326 each), in two rows, with Korean captions:

| # | State | Caption |
|---|---|---|
| 1 | Live 18.6 | "실시간" |
| 2 | Details (bright ghost) | "상세" |
| 3 | Not live | "수심 정보 없음" |
| 4 | Range 40 | "범위 40 m" |
| 5 | Stop running 0–10 | "권장 스탑" |
| 6 | Stop paused | "일시정지" |
| 7 | Unsupported cap at 6 m | "범위 밖" |
| 8 | Freedive surface with tide marks | "프리다이빙 수면 (P5)" |
| 9 | Always-On | "Always-On" |

- **Footer:** the range formulas in 18px ink2: start at 30 m and grow in 10 m steps, never shrinking; stop page uses `max(10, ceil((max(d,6)+2)/2)*2)`; at most 4 labels on 1/2/5/10/20 m steps; nothing is drawn past the limit.

**3. `System-Proposals.dc.html`** · "제안 (승인 필요)" · 1400×1400.
- Eight cards in two columns, each 660×300.
- Each card: "현재 규칙 대안 · 목업 사용" on the left, "제안" on the right, at 2× mini-screens. Below: one line explaining why it is informational rather than decorative.
- Cards: P1 depth-anchored gradient, P2 stop minute indices, P3 stop rescale motion, P4 Wet Ready water tint, P5 tide marks, P6 recording copy, P7 grey storage footer, P12 Wet Ready home toolbar.

### Row 2: Pre-dive (Ultra)

**Row note:** "출발 전: 홈, 수중 조작, 계획, 기록 대기. 다이빙 종류에 색을 붙이지 않고 글리프로 구분."

**4. `Ultra-Home.dc.html`** · "홈" · 422×514.
- Clock "9:41". Root title "다이빙".
- Freediving card at y 72–216:
  - glyph disc at x 36–108, y 108–180, monofin glyph
  - title "프리다이빙" at x 128, baseline 156
  - play disc at x 322–386, y 112–176
- Scuba card at y 228–372, tank glyph, "스쿠버 다이빙".
- Plan row at y 384–492, with detail: `list.bullet.clipboard`, title "다이빙 계획" (baseline 428), detail "문섬 동쪽 벽" (baseline 464).
- On load: cards start disabled; HM-ENTER plays, then HM-READY at 300ms.

**5. `Ultra-Home-Scrolled.dc.html`** · "홈 (스크롤)" · 422×514.
- Clock and title stay; the content fade under the clock applies.
- Recent card at y 72–310:
  - eyebrow at baseline 116: "최근 기록" on the left; `iphone.gen3` plus "iPhone 저장" on the right
  - date "어제 오후 3:05" at baseline 156
  - values at baseline 206: "14.2" + "m" + "48분 · 프리"
  - sparkline Profile B at y 226–286
- Row "저장한 기록" (`list.bullet`) at y 322–418.
- Row "수중 조작" (`hand.tap`), detail "자동 실행 꺼짐", from y 426, cut by the screen edge.
- Plays HM-SPARK.

**6. `Ultra-Home-Bottom.dc.html`** · "홈 (맨 아래)" · 422×514.
- Row "수중 조작" with detail "자동 실행 꺼짐" at y 72–180.
- Row "데모" (`digitalcrown.arrow.clockwise`) with detail "가상 수심" at y 188–296.
- Manta 64×38px ink3 centred at y 328–366.
- Footer centred, 2 lines at baselines 406 and 439: "다이빙 기록·복기용입니다." / "인증된 다이브 컴퓨터가 아닙니다." in ink3.

**7. `Ultra-Home-Unsupported.dc.html`** · "홈 · 미지원 기기" · 422×560, strip "제안 P13 · 대안: 안내를 카드 위 한 줄로".
- Both cards disabled (C2).
- Notice from y 392, with no platter:
  - `info.circle` 30px ink2 at x 36
  - title at x 80–386: "수심 측정을 지원하는 Apple Watch가 필요합니다" in `ui-footnote-em` white, 2 lines
  - body at x 36: "다이빙 기록에는 수심 측정 기능이 필요합니다. 데모는 사용할 수 있습니다." in `ui-footnote` ink2, continuing below the fold

**8. `Ultra-Controls-AutoLaunch.dc.html`** · "수중 조작 1 · 자동 실행" · 422×514.
- Pushed chrome: title "수중 조작", clock "9:42". Page dots: 3, with the first current.
- Illustration at y 104–200, centred:
  - watch front: 56×68px rounded rectangle, radius 18, 3px ink3 stroke
  - crown nub: 8×16px ink3 on the right
  - `water.waves` 36px in white inside the lower half
- Title "자동 실행" (`ui-title3`) at baseline 244.
- Status line at baseline 280: hollow 14px dot (2px ink2 stroke) plus "자동 실행 꺼짐" in 26px/600 ink2.
- Body from baseline 322, 28px ink2, line height 33: "설정 앱의 자동 실행 항목에서 물에 잠겼을 때 실행할 앱으로 Divenary를 선택하세요. 그러면 물에 들어갈 때 Divenary가 열리고 기록을 시작합니다."
- Plays GD-PAGE and GD-ILLUS (waves highlight).

**9. `Ultra-Controls-Crown.dc.html`** · "수중 조작 2 · 디지털 크라운" · 422×514.
- Page dots: second current.
- Illustration: the case's right side with the crown in white and a 3px white arc arrow around it.
- Title "디지털 크라운".
- Paragraph 1: "기록 중에는 디지털 크라운을 돌려 실시간 화면과 상세 화면을 오갈 수 있습니다."
- 24px gap, then paragraph 2: "수면에서 수중 잠금을 해제하면 기록이 끝납니다."
- Plays GD-ILLUS (the arc rotates 90° once).

**10. `Ultra-Controls-ActionButton.dc.html`** · "수중 조작 3 · 동작 버튼" · 422×514.
- Page dots: third current.
- Illustration: the Ultra's left flank with the Action Button in white.
- Title "동작 버튼". Three paragraphs, 24px apart:
  1. "설정 앱의 동작 버튼 항목에서 다이빙을 고른 뒤 Divenary를 선택하세요."
  2. "동작 버튼에 Divenary를 지정했다면 처음 누를 때 기록을 시작하고, 그다음부터는 누를 때마다 화면을 넘깁니다. 기록 시작 후 3분이 지났고 워치가 물 밖에 있으면 마지막 화면에서 눌러 종료하고 저장합니다." (continues below the fold)
  3. "잠수하기 전에는 종류 바꾸기 화면에서 동작 버튼을 눌러 스쿠버와 프리다이빙을 바꿀 수 있습니다."
- Then the footer "다이빙 기록용입니다. 인증된 다이브 컴퓨터가 아닙니다." in ink3. This is the last page, so it may scroll.
- Non-Ultra variant text, noted on the sheet only: "이 워치에는 동작 버튼이 없을 수 있습니다. 입수 전에 다이빙 화면에서 기록을 시작하세요."
- Plays GD-ILLUS (the button press scale).

**11. `Ultra-Plans.dc.html`** · "다이빙 계획" · 422×514.
- Pushed chrome: title "다이빙 계획", clock "9:42".
- Header at y 104–203, 3 lines, `ui-footnote` ink2: "홈 화면에서 시작할 때 사용할 계획을 선택하세요. 다시 누르면 선택을 해제합니다."
- Row A, selected, at y 215–368:
  - fill action-fill
  - "문섬 동쪽 벽" (headline) at baseline 257
  - `checkmark.circle.fill` 40px at x 346–386
  - baseline 295: tank glyph 24px ink2 + "스쿠버 · 계획 수심 " in ink2 + "18.0" (28px/600 white, metric) + " m" in ink2
  - baseline 331: "오늘 오전 10:00" in ink2
- Row B from y 380, cut by the screen edge: "범섬 프리다이빙 연습", `circle` in dot-off, monofin glyph + "프리다이빙 · 계획 수심 15.0 m", "내일 오전 9:00".
- Plays PL-SELECT (the checkmark bounce) once.

**12. `Ultra-WetReady.dc.html`** · "기록 대기" · 422×560, strip "제안 P12 · 대안: '홈 화면으로' 캡슐을 면책 문구 아래에".
- Glass circle at (16, 6) with `chevron.backward`. VoiceOver label "홈 화면으로".
- Clock "10:01".
- Chip "기록 대기" at x 24, y 76–116. Right-aligned at 398, baseline 104: "수심" (24px ink2) + "0.6" (30px/600 white) + "m" (24px ink2).
- Tiles at y 124–252: "프리다이빙" unselected on the left; "스쿠버" selected on the right.
- Truth line at baseline 284: "아직 기록을 시작하지 않았습니다." (`ui-wet-truth`).
- Guidance at baselines 320 and 353: "동작 버튼에 Divenary를 지정했다면 눌러서 기록을 시작하세요." (`ui-wet-guide` white).
- Crown line: crown glyph 24px ink2 at x 24, y 376; text at x 56, baselines 394 and 423: "디지털 크라운을 돌려 다이빙 종류를 선택하세요."
- Disclaimer at baselines 470 and 503: "다이빙 기록용입니다. 인증된 다이브 컴퓨터가 아닙니다." in ink3.
- Plays WR-ENTER. At 800ms, WR-MODE: the selection slides from 프리다이빙 to 스쿠버 and the glyph bounces.

### Row 3: Scuba (Ultra)

**Row note:** "고정 계기: 게이지·상태 띠·안내 chip은 움직이지 않고 오른쪽 열만 넘어간다. 숫자는 흰색, 앰버는 권장 스탑만."

Defaults for every artboard in this row:
- No status chips unless listed.
- Range 0–30; tick labels at 0/132, 10/231.3, 20/330.7, 30/430.
- Hint chip "동작 버튼 ▸ 상세 1/2" with 2 dots, the first current.

**13. `Ultra-Scuba-Live.dc.html`** · "스쿠버 · 실시간"
- Clock "10:24".
- Gauge: fill y 132→316.8; index and chevron at 316.8; ghost at 354.5; label "20" yields.
- Hero "18.6" + "m".
- Row 1: "시간" "21:40".
- Row 2 (quiet): "상승" "0.4" + "m/min", ink2.
- Plays RC-ENTER. Canvas demo: depth 18.6 ↔ 18.5 every 1s with the RC-DEPTH glide.

**14. `Ultra-Scuba-Details.dc.html`** · "스쿠버 · 상세"
- Same gauge, with the ghost bright.
- Hero "18.6" m.
- Row 1: "최대" "22.4" m.
- Row 2 (full): "수온" "21.3" + "°C".
- Hint "동작 버튼 ▸ 실시간 2/2", second dot current.
- Plays RC-PAGE.

**15. `Ultra-Scuba-DepthUnavailable.dc.html`** · "스쿠버 · 수심 정보 없음"
- Clock "10:28".
- Chip "수심 정보 없음".
- Gauge: no fill and no index; ghost at 50%.
- Hero "26:18" (time hero), empty caption.
- Row 1: "수심" "--.-" m, in ink3.
- Row 2: "상승" "--.-" m/min, in ink3.
- Plays RC-SIGNAL at 600ms and RC-CHIP.

**16. `Ultra-Scuba-OutOfRange.dc.html`** · "지원 수심 밖 (6 m 한도 기기)" · 422×560, strip "예외 · 얕은 수심 권한 기기, 실제 현재 빌드의 한도".
- Clock "10:10".
- Chip "수심 측정 범위 밖" (deduplicated).
- Range 0–6: labels 0/132, 2/231.3, 4/330.7, 6/430. Full fill to 430, 2px ink2 cap line at 430, no index.
- Hero "08:12".
- Rows: "수심 --.- m", "상승 --.- m/min".

**17. `Ultra-Stop-Running.dc.html`** · "권장 스탑 · 진행" · 422×560, strip "제안 P2 · 대안: 분 표시 없이 카운트다운만".
- Clock "10:40".
- Range 0–10 (labels 0, 5, 10), zone y 221.4–310.8, pip at 281, fill to 287 at 50%, index at 287; label "5" yields; no ghost.
- Caption "권장 스탑" plus indices: first full, then two dim.
- Hero "01:52", caution.
- Row 1 (stop position): "수심" "5.2" m.
- Row 2 (quiet): "기록 시간" "38:08".
- Plays RC-STOPIN.

**18. `Ultra-Stop-Paused.dc.html`** · "권장 스탑 · 일시정지" · 422×560, strip P2.
- Clock "10:41".
- Index and fill at y 203.5.
- Indices at 40%.
- Hero "01:24", caution at 60%.
- State slot: `pause.fill` + "타이머 일시정지".
- Rows: "수심 2.4 m", "기록 시간 38:50".
- Plays RC-STOPPAUSE.

**19. `Ultra-Stop-Done.dc.html`** · "권장 스탑 · 완료" · 422×560, strip P2.
- Clock "10:43".
- Index at 275.
- All three indices full.
- Hero "00:00", caution.
- State slot: `checkmark` + "권장 스탑 완료".
- Rows: "수심 4.8 m", "기록 시간 40:52".
- Plays RC-STOPDONE (appear, no bounce).

**20. `Ultra-Scuba-End.dc.html`** · "종료 화면"
- Clock "10:45".
- Chip "수면".
- Gauge: no fill; ghost at 354.5.
- Column:
  - `button.programmable` 56px white at y 122–178
  - "동작 버튼을 누르면" / "기록 종료·저장" in `rec-end-instruction`, baselines 222 and 266
  - row "기록 시간" "42:10" with the value at 34px (17pt)/600, baseline 316
- Bottom slot: "수중 잠금 해제 시 기록 종료" in `rec-waterlock`, baseline 436.
- Hint: dots only (3 dots, the third current).
- Plays RC-PAGE.

**21. `Ultra-Demo-Live.dc.html`** · "데모 · 실시간"
- Glass xmark circle at (16, 6), labelled "데모 종료".
- Clock "8:12".
- Marker chip "데모".
- Gauge: fill and index at 204.5; ghost at 222.4.
- Hero "7.3" m.
- Rows: "시간 03:12", "상승 0.0 m/min" (quiet, ink2).
- Hint slot without dots: "디지털 크라운으로 수심 조절".
- Canvas demo: depth 7.3 → 7.6 → 7.3 with RC-DEPTH.

### Row 4: Freedive (Ultra)

**Row note:** "프리다이빙: 단계 chip이 첫 chip, '다이빙 중'만 파란 글자. 하강 중에는 최대 수심선과 이전 다이빙 표시를 숨긴다."

**22. `Ultra-Freedive-SurfaceReady.dc.html`** · "프리다이빙 · 수면 대기"
- Clock "3:06".
- Chips "수면 대기" and "수면".
- Gauge: empty (depth not live, no dives yet).
- Caption "총 기록 시간"; hero "00:40".
- Row 1: "다이빙 횟수" "0".
- Row 2 (full): "수심" "--.-" m, ink3.
- Bottom slot: "수중 잠금 해제 시 기록 종료".
- Hint: 3 dots (first current) + "기록 종료 가능까지 2:20".

**23. `Ultra-SwitchType.dc.html`** · "종류 바꾸기"
- Clock "3:06".
- Chip "수면 대기".
- Gauge: fill and index at 136; "0" yields.
- Column:
  - tank glyph 60px white at y 126–186
  - "스쿠버로 바꾸기" in `rec-switch-title`, baseline 230
  - "아직 잠수 전이라 새로 기록합니다." in `rec-note`, baselines 270 and 301
- Hint: 3 dots (third current) + "동작 버튼 ▸ 스쿠버로 바꾸기".
- Plays RC-PAGE.

**24. `Ultra-Freedive-Diving.dc.html`** · "프리다이빙 · 다이빙 중"
- Clock "3:49".
- Chip "다이빙 중", in action text.
- Gauge: fill and index at 227.4; **no ghost and no tide marks**.
- Hero "9.6" m.
- Row 1: "시간" "00:31".
- Row 2 (quiet): "상승" "0.0 m/min".
- Hint "동작 버튼 ▸ 상세 1/2".
- Plays RC-HERO and RC-CHIP.

**25. `Ultra-Freedive-SurfaceRest.dc.html`** · "프리다이빙 · 수면 휴식" · 422×560, strip "제안 P5 · 대안: 수면에서 최대 수심선만".
- Clock "3:46". No chips.
- Index at 136.
- Tide marks:

| Dive | Depth | y (px) | Opacity |
|---|---|---|---|
| #02 | 10.4 m | 235.3 | 35% |
| #03 | 12.0 m | 251.2 | 35% |
| #04 | 13.5 m | 266.1 | 35% |
| #05 | 9.8 m | 229.4 | 35% |
| #06 | 14.2 m | 273.0 | 80% |

- Caption "수면 휴식"; hero "02:14".
- Row 1 (stacked): "직전 다이빙 시간" / "01:06".
- Row 2 (quiet): "직전 수심" "14.2" m.
- Hint "동작 버튼 ▸ 상세 1/2".
- Plays RC-TIDE.
- The summary-phase variant (chip "요약") is noted on the sheet only.

**26. `Ultra-Freedive-Details.dc.html`** · "프리다이빙 · 상세" · 422×560, strip P5.
- Clock "3:46".
- Tide marks brighter: newest 100%, others 50%.
- Caption "다이빙 횟수"; hero "6".
- Row 1 (stacked): "직전 다이빙" / "01:06 · 14.2 m", with " · " and "m" in ink2.
- Row 2 (quiet): "최장 다이빙" "01:32".
- Hint "동작 버튼 ▸ 실시간 2/2".
- Plays RC-COUNT (5→6).

### Row 5: Post-dive and logs (Ultra)

**Row note:** "물 밖의 보상: 저장 뒤 프로필이 그려지고 만타가 지나간다. 전송은 iPhone 글리프로, 구름 없음."

**27. `Ultra-Ending.dc.html`** · "기록 종료 중"
- Clock "10:45".
- Gauge silhouette only: track, labels and hairlines at 30%; no fill, index or ghost. No chips, no hint.
- Centred over the column (x centre 263):
  - spinner 48px white at y 214–262
  - "기록을 종료하고" / "있습니다." in 30px/600 white, baselines 306 and 342
- Plays PD-SPIN.

**28. `Ultra-Saving.dc.html`** · "기록 저장 중"
- Clock "10:45". Black.
- Spinner 48px centred at (211, 236).
- "기록 저장 중" in 30px/600 white, centred, baseline 300.

**29. `Ultra-NoSamples.dc.html`** · "기록 없음 결과"
- `water.waves` 64px ink2, centred at y 120–184.
- "수심이 기록되지 않았습니다" in 34px/600 white, centred, baselines 232 and 271.
- Primary "완료" at y 330–424.

**30. `Ultra-StartError.dc.html`** · "기록 시작 오류"
- `exclamationmark.circle.fill` 56px danger at y 92–148.
- "기록을 시작할 수 없음" in 34px/600, baseline 196.
- "기록을 준비하지 못했습니다." in 30px ink2, baseline 236.
- Primary "완료" at y 270–364.
- Banner at y 402–494: "기록을 시작하지 못했습니다." + "(2)" in ink3.
- Plays PD-BANNER.

**31. `Ultra-SaveFailure.dc.html`** · "저장 실패"
- Clock "10:45".
- Icon `exclamationmark.circle.fill` 40px danger at (24, 76).
- Title at x 76–398, 30px/600 white, 3 lines at baselines 100, 135 and 170: "기록을 아직 저장하지 못했습니다. 다시 저장해 주세요."
- Persistent note at y 192–290: "저장하지 못했습니다. 기록은 보관하고 있습니다." + "(2)" in ink3.
- Primary "다시 저장" at y 302–396.
- Secondary "홈 화면으로" at y 408–502.
- Below the fold, in `ui-footnote` ink2: "기록을 보관하고 홈 화면에서 자동으로 저장을 재시도합니다." and "동작 버튼은 저장을 재시도한 뒤 새 기록을 시작합니다."

**32. `Ultra-Summary.dc.html`** · "다이빙 요약"
- Pushed chrome: back circle (VoiceOver "뒤로"), title "요약", clock "10:46".
- Hint-style chip without dots, centred, at y 104–152: "동작 버튼 ▸ 다음 다이빙 시작".
- "최대 수심" in `ui-eyebrow`, baseline 186.
- "22.4" (`ui-metric-xl`) + "m", baseline 262.
- Baseline 314: "총 기록 시간" in 26px ink2, then "42" (44px white) + "분" (26px ink2) + " 10" + "초".
- Profile A at y 334–446, max label "22.4 m".
- Status row: `checkmark.circle.fill` 30px white + "저장됨" in 30px/600 white, baseline 486.
- Plays PD-FINALE.

**33. `Ultra-Summary-Scrolled.dc.html`** · "요약 (아래)"
- Back circle and clock; title hidden; edge fade.
- Content from y 72:
  - "권장 스탑 요약" in eyebrow
  - stacked stats:
    - full width: "상태" "권장 스탑 완료" (value 34px/600, **ink2** because a completed stop is grey in saved views)
    - "남은 시간" "0초" | "구간 체류 시간" "3분"
    - "권장 사항" "권장 스탑" | "완료 여부" "예"
  - note in ink3: "권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요."
  - 24px gap
  - "평균 수심" "12.8 m" | "평균 수온" "21.6 °C"
  - full width: "최대 상승 속도" "8.6 m/min"
  - disclaimer: "저장한 기록의 복기용입니다. 인증된 다이브 컴퓨터가 아닙니다."
  - footer: "세부 정보는 iPhone에서 편집할 수 있습니다." (ink3, past the fold)
- Plays LS-EDGE (the bottom row is drawn at .94/.75).

**34. `Ultra-List.dc.html`** · "기록"
- Pushed chrome: title "기록", clock "1:20".

| Row | y (px) | Date | Sync glyph | Values | Profile | Marker |
|---|---|---|---|---|---|---|
| 1 | 104–277 | "오늘 오전 10:02" | `applewatch.and.arrow.forward` ink2 | "22.4" + "m" + "42분 · 스쿠버" | A | — |
| 2 | 285–458 | "어제 오후 3:05" | `iphone.gen3` ink2 | "14.2 m · 48분 · 프리" | B | — |
| 3 | 466– (peek, .94/.75) | "10월 19일 오전 9:30" | `iphone.gen3.slash` danger | "18.1 m · 47분 · 스쿠버" | — | — |
| 4 (below the fold) | — | "10월 18일 오후 8:12" | — | "7.3 m · 4분 · 스쿠버" | — | marker chip "데모" |

- Rows 1 and 2 show their profile as a sparkline under the values.
- Footer below the fold: "이 앱은 다이빙 기록·복기용이며, 인증된 다이브 컴퓨터가 아닙니다."
- Plays HM-SPARK, 60ms stagger.

**35. `Ultra-List-ReadFailure.dc.html`** · "기록 읽기 실패"
- Title "기록".
- Platter at y 104–200: `exclamationmark.triangle.fill` 30px danger + "저장된 기록을 읽지 못했습니다." in `ui-body`, 2 lines.
- Secondary "다시 시도" at y 212–306, **outside** the platter.
- Row 1 of the list at y 318–491.

**36. `Ultra-List-Empty.dc.html`** · "기록 없음"
- Title "기록".
- Manta 80×48px ink3, centred at y 150–198.
- "기록 없음" in 26px/600 ink2, baseline 240.
- "아직 저장한 기록이 없습니다" in headline white, centred, 2 lines at baselines 284 and 323.
- "다이빙 화면에서 기록을 시작하세요." in footnote ink2, baselines 365 and 398.

**37. `Ultra-Detail-Dive.dc.html`** · "기록 상세 1 · 다이빙"
- Pushed chrome: title "10월 22일", clock "1:21". Page dots: 3, first current.
- Chip "스쿠버" plus "오전 10:02" (26px ink2) at y 104–144.
- Baseline 180: `iphone.gen3` + "iPhone에 저장됨" (footnote ink2).
- Profile at y 196–324.
- "최대 수심" eyebrow, baseline 360; "22.4" (`ui-metric-l`) + "m", baseline 424.
- Baseline 476: "총 기록 시간" + "42분 10초" (`ui-metric-m`, units in ink2).
- Plays DT-PROFILE.

**38. `Ultra-Detail-SendFailed.dc.html`** · "기록 상세 · 전송 실패"
- Title "10월 19일".
- Chip "스쿠버" + "오전 9:30".
- `iphone.gen3.slash` danger + "iPhone 전송 실패" (ink2).
- Note at y 196–262, in danger, leading-aligned: "전송하지 못했습니다. 다시 시도하세요." + "(1)" in ink3.
- Secondary "다시 보내기" at y 274–368.
- Profile at 96px height, y 380–476.

**39. `Ultra-Detail-Stats.dc.html`** · "기록 상세 2 · 통계"
- Page dots: second current.
- Stacked stats:

| y (px) | Left | Right |
|---|---|---|
| 104–179 | "평균 수심" "12.8 m" | "평균 수온" "21.6 °C" |
| 195–270 | "최대 상승 속도" "8.6 m/min" | "수심 측정 횟수" "2,530" |
| 286–361 | "다이빙 포인트" "서귀포 문섬 동쪽 벽" (full width, headline) | — |
| 377–452 | "호흡 기체" "공기" | "평점" "★★★★☆" (30px; filled stars white, empty star dot-off; VoiceOver "5점 중 4점") |

- Plays GD-PAGE.

**40. `Ultra-Detail-Records-Top.dc.html`** · "기록 상세 3 · 권장 스탑 기록"
- Page dots: third current.
- "권장 스탑 기록" eyebrow, baseline 128.
- Stacked stats:
  - full width: "상태" "권장 스탑 완료" (ink2)
  - "완료 여부" "예" | "구간 체류 시간" "3분"
  - "남은 시간" "0초" | "권장 사항" "권장 스탑"
  - full width: "목표 / 구간" "5.0 m · 3.0 m-6.0 m"
  - "시작" "오전 10:39" | "완료 시각" "오전 10:42" (at the fold)

**41. `Ultra-Detail-Records-Bottom.dc.html`** · "기록 상세 3 · 정보·메모"
- Scrolled state, from y 72:
  - "시작" | "완료 시각" row
  - note "권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요." (ink3)
  - "시야" "4/5" | "수중 상태" "약한 물결"
  - memo card (platter, radius 24): "메모" eyebrow + "동쪽 벽을 따라 연산호 군락. 자리돔 떼가 많았다." (`ui-body` white)
  - disclaimer "이 앱은 다이빙 기록·복기용이며, 인증된 다이브 컴퓨터가 아닙니다." (ink3)

### Row 6: Always-On (Ultra)

**Row note:** "손목을 내리면 같은 배치 그대로 외곽선 계기가 된다. 권장 스탑 라벨·상태 문구·chip·표식은 숨기지 않는다."

**42. `Ultra-AOD-Live.dc.html`** · "Always-On · 실시간"
- Clock "10:24" at 60%.
- Gauge in AOD form: outline, index at 316.8, no ghost.
- Hero "18.6" white, "m" in ink3.
- Row 1: "시간 21:40" at 80%. Row 2 at opacity 0.
- Hint without dots: "동작 버튼 ▸ 상세 1/2" at 50%.
- Plays RC-AOD.

**43. `Ultra-AOD-Stop.dc.html`** · "Always-On · 권장 스탑" · 422×560, strip P2.
- Zone shown only as edge lines plus the pip.
- Caption "권장 스탑" caution at 80%; indices static.
- Hero "01:52" **white**.
- Rows kept: "수심 5.2 m", "기록 시간 38:08".

**44. `Ultra-AOD-FreediveSurface.dc.html`** · "Always-On · 수면 휴식"
- Caption "수면 휴식"; hero "02:14" white.
- Rows at opacity 0.
- Tide marks hidden; index at 136.

### Row 7: Series 42mm (374×446)

**Row note:** "가장 빽빽한 화면의 42mm 검증. 모든 예산에 6pt 이상 여유. 실제 한글 폭은 시뮬레이터에서 확인."

All artboards in this row use the S chassis and S tokens.

**45. `Series42-Home.dc.html`**
- Clock "9:41"; title "다이빙".
- Freediving card at y 64–192:
  - glyph disc at x 30–90, y 98–158
  - title baseline 140
  - play disc at x 284–344
- Scuba card at y 202–330.
- Plan row at y 340–444: "다이빙 계획" (baseline 380), "문섬 동쪽 벽" (baseline 414).

**46. `Series42-WetReady.dc.html`** · 374×492, strip P12.
- Circle at (12, 4).
- Chip "기록 대기" at y 66–106. Right-aligned at 354, baseline 94: "수심 0.6 m".
- Tiles at y 112–228: left x 10–182, right x 192–364, scuba selected.
- Truth line "아직 기록을 시작하지" / "않았습니다." at baselines 258 and 289.
- Guidance in 3 lines at baselines 328, 359 and 390.
- Crown line starts at baseline 432.

**47. `Series42-Stop-Paused.dc.html`** · 374×492, strip P2.
- Clock "10:41".
- Range 0–10: zone y 195.2–268.4; pip at 244; index and fill at 180.6.
- Caption + indices (20×6px) at 40%.
- Hero "01:24" at 88px, 60% opacity, baseline 222.
- State slot "타이머 일시정지", baseline 254.
- Row 1: "수심" "2.4 m", baseline 294.
- Row 2: "기록 시간" "38:50", baseline 330.
- Hint "동작 버튼 ▸ 상세 1/2".

**48. `Series42-Freedive-SurfaceRest.dc.html`** · 374×492, strip P5.
- Clock "3:46".
- Tide marks at y 206.6, 219.6, 231.8, 201.7 and 237.5 (newest); index at 125.3.
- Hero "02:14", baseline 222.
- Row 1 (stacked): label baseline 258, value "01:06" baseline 298.
- Row 2 (quiet): "직전 수심 14.2 m", baseline 332.

**49. `Series42-End.dc.html`**
- Clock "10:45"; chip "수면".
- Ghost at 304.2.
- Glyph 48px at y 112–160.
- "동작 버튼을 누르면" / "기록 종료·저장" at 32px (16pt), baselines 196 and 234.
- Row "기록 시간" "42:10" at 30px (15pt), baseline 284.
- Bottom slot: Water Lock line, baseline 374.
- Hint: dots only.

**50. `Series42-SaveFailure.dc.html`**
- Icon 36px at (20, 66).
- Title at x 66–354, 28px, 3 lines at baselines 88, 121 and 154.
- Note at y 168–296.
- Primary "다시 저장" at y 306–394.
- Secondary "홈 화면으로" from y 404, cut by the screen edge.

**51. `Series42-Summary.dc.html`**
- Circle at (12, 4); title "요약" right-aligned, baseline 80.
- Chip "동작 버튼 ▸ 다음 다이빙 시작" at y 92–136.
- "최대 수심", baseline 168.
- "22.4" + "m", baseline 236.
- "총 기록 시간 42분 10초", baseline 282.
- Profile at y 298–394.
- "저장됨" row at y 404–436.
- Plays PD-FINALE.

### Row 8: Prototype

**Row note:** "핵심 흐름: 홈 → 입수(기록 대기) → 하강 → 권장 스탑 → 수면 → 종료 → 저장 → 요약. 오른쪽 버튼이 동작 버튼과 디지털 크라운을 흉내 낸다."

**52. `Prototype-DiveFlow.dc.html`** · "인터랙티브 프로토타입 · 스쿠버 다이빙" · 760×620.

**Presentation layout.** Background `#0B0B0C`.
- Watch body: 466×558 at (24, 31), radius 110px, fill `#1C1C1E`, 2px `#3A3A3C` border.
- Screen: 422×514 at (46, 53).
- Crown: rectangle at x 490–506, y 170–230, radius 6, `#3A3A3C`.
- Side button: x 490–500, y 262–330.
- Action Button: x 14–24, y 200–270, `#FF7A1A`.

**Control panel** (x 530–736; presentation chrome, not app UI):

| y (px) | Control |
|---|---|
| 40 | Title "Divenary 워치 프로토타입" (22px/600) |
| 64 | Subtitle "Ultra 49mm · 서귀포 문섬 · 시뮬레이션" (14px ink2) |
| 96 | Button "동작 버튼" (206×56, orange dot, 18px/600) |
| 170 | Label "디지털 크라운" |
| 184 | Buttons "▲ 뒤로" and "▼ 앞으로" (100×44 each) |
| 246 | "입수" (206×40) |
| 294 | "자동 진행 ▶" / "일시정지 ❚❚" |
| 342 | "처음으로" |
| 392 | Switch "Always-On (손목 내림)" |
| 426 | Switch "동작 줄이기" |
| 460 | Switch "제안 P1 그라데이션" (default off) |
| 494 | Switch "제안 P2 분 표시" (default **on**, yellow "제안" pill) |
| 528 | Switch "제안 P3 스탑 확대" (default off) |
| 560–608 | Readout, 13px mono ink2: "단계: …", "기록 시간 mm:ss · 수심 x.x m", "시뮬레이션 ×N", "햅틱: …" (fades after 1.5s) |

**JS class `DivePrototype`.**
- State: `screen` (`home` | `wet` | `rec` | `ending` | `saving` | `summary`), `mode`, `depth`, `maxDepth`, `elapsed` (sim seconds), `submerged`, `page` (`live` | `details` | `switch` | `end`), `stop {status, remaining}`, `descended1m`, `aod`, `rm`, `p1`, `p2`, `p3`, `autoplay`, `idleTimer`.
- Render loop: 100ms real time, or 1000ms while `aod`.

**Behaviour by screen**
- **Home.** Cards are disabled for 300ms, then HM-READY. Tapping a card plays HM-ARM, then `rec` at the surface with `submerged = false`. "입수" goes to `wet`.
- **Wet.** Depth 0.6. Crown ▲/▼ or a tile tap toggles the mode (WR-MODE). The Action Button starts recording in the armed mode (RC-ENTER, haptic log "햅틱: 시작"). The glass back circle returns to Home.
- **Page cycle:** `[live, details] + (switch if !descended1m && !endAvailable) + (end if !submerged && elapsed ≥ 180)`.
- **Action Button.**
  - On `end`: go to `ending` (log "햅틱: 종료 요청").
  - On `switch`: restart in the other mode at `live` (log "햅틱: 시작").
  - Otherwise: next page with RC-PAGE (log "햅틱: 화면 넘김").
- **Crown:** moves only between live and details. Reset the 10s idle timer on every input; when it fires, RC-AUTO back to Live.
- **Live slot:** shows the stop page while `stop.status` is `active`, `pausedTooShallow` or `completed`.
- **Hint text:** the rules from §C6 and the inventory table, Ultra variant only.

**Autoplay segments** (sim time; the speed is shown in the readout):

| Segment | Sim time | Speed | Real time | Depth | Notes |
|---|---|---|---|---|---|
| A | 0→180 s | ×30 | 6 s | 0.6→18.6, ease-in-out | `submerged = true`; `descended1m` turns true at 1 m |
| B | 180→2040 s | ×310 | 6 s | 18.6→22.4 (at 720 s)→19.0→16.2→12.0 | — |
| C | 2040→2220 s | ×30 | 6 s | 12.0→5.2 | Entering 6.3 m: stop `active`, remaining 180 (RC-STOPIN, no haptic) |
| D | 2220→2400 s | ×15 | 12 s | wobble 5.0–5.6 | Remaining counts down; RC-STOPMIN at 120 and 60; at 0 → `completed` (RC-STOPDONE) |
| E | 2400→2430 s | ×15 | 2 s | 4.8 | — |
| F | 2430→2530 s | ×25 | 4 s | 4.8→0 | Below 0.5 m: `submerged = false`; depth status chip "수면"; RC-SIGNAL drains the fill; RC-WATERLOCK; End joins the cycle; autoplay pauses with `elapsed = 42:10` |

Rendering during autoplay:
- Each simulated second updates the digits instantly.
- The gauge uses `transition: transform 200ms linear` while updates arrive every 200ms, and 300ms otherwise.
- P3 on: RC-RANGE becomes a 600ms smooth interpolation of the scale. P1 on: the fill becomes a depth-anchored `linear-gradient` from `#1F5A99` at y(0) to `#0E2C52` at y(40), revealed only down to the current depth.

**After autoplay ends**
- The diver presses the Action Button: stop page → Details ("동작 버튼 ▸ 종료 화면") → End (dots only) → `ending` (1.0 s, RC-END) → `saving` (1.4 s) → `summary` with PD-FINALE (log "햅틱: 저장됨").
- The summary's back circle returns to Home. The recent card now shows "오늘 오전 10:02 · 22.4 m · 42분 · 스쿠버" with "전송 대기", drawn with HM-SPARK.

**Toggles**
- **Always-On:** forces Live, hides dots, applies C22 styling with the 300ms RC-AOD settle, and ignores input.
- **동작 줄이기:** applies the RM column of D3.
- **처음으로:** resets everything.

---

## G. Rule ledger

### G1. How each hard constraint is met

1. **Not a dive computer.** There is no decompression, NDL, tissue, gas, emergency or ascent instruction anywhere, and none of the banned phrases appear. The motion never signals "safe".
2. **Recommended-stop wording and colour.**
   - Wording is only "권장 스탑".
   - Running, paused and live-completed states are amber. Completion is shown by a `checkmark` plus "권장 스탑 완료", with no bounce.
   - Paused also shows "타이머 일시정지".
   - In saved views a completed stop is ink2 grey.
   - There is no ring: P2 uses linear indices.
   - The stop zone changes from cyan to amber, so the screen has one colour story.
3. **Non-certified sentence.** It appears on the Home footer, Wet Ready, the guide (last page), the summary, the list and the detail. No recording page carries it.
4. **Patterns to avoid.**
   - No ascent bars or arrows, and no red or green on recording pages.
   - Every value has a label.
   - The ghost and tide marks are hidden during freediving descent and in Always-On.
   - The ending overlay shows no digits.
   - No compass, no scores and no goals.
   - Ending still needs the End page plus its guard. There is no long press.
5. **Ascent.** Stays on Live as a quiet 15/14pt 400 ink2 row. It is not on Details. Saved views label it "최대 상승 속도".
6. **Unsupported depth.** Muted chip "수심 측정 범위 밖", deduplicated. Saved views show "지원 수심 밖" plus the explanation. Nothing is drawn past the limit.
7. **Demo/Test markers.** A brighter marker chip appears on every recording page (including Always-On), the Home card, list rows, the summary and the detail.
8. **Diver terms.** Every string comes from the inventory, apart from the refinements in G2. "동작 버튼 ▸" and "크라운 ▸" are used only in chips. Action Button copy stays conditional.
9. **Sync.** Watch-arrow, iPhone and iPhone-slash glyphs carry the full labels. No cloud glyph. "다시 보내기" appears only on a failed detail.
10. **Unknown values.** "--.- m", "--:--" and so on, drawn in ink3, always paired with a depth status chip.
11. **No touch targets** on recording pages, apart from the demo xmark.
12. **Page model.** Unchanged: cycle, crown limits, 10 s and automatic returns without haptics, Always-On forcing Live. The page drawn is always the page that receives input.
13. **One large number per page.** The End instruction is the largest text on its page (19pt vs 17pt, and 16pt vs 15pt on S).
14. **Gauge.** A 46pt gauge on every recording page, with the status band above it.
15. **Gauge ranges.** All formulas unchanged.
16. **Freediving phase chip.** Always first. Only "다이빙 중" is blue.
17. **Hint chip.** Pinned strings, dots inside the chip (now a vertical stack), the Water Lock line only out of the water (now in the column's bottom slot), and rejected-press notes for 2 s.
18. **End page.** The guard is unchanged, and the instruction is the largest element.
19. **Touch targets.** At least 44pt everywhere; toolbar circles get 88px hit areas.
20. **Text size.** Recording text is at least 11pt on S and 12pt on U. Every former 10pt text is raised to 12pt or more. Non-recording screens use relative styles.
21. **Weights.** Only 400, 600 and 700.
22. **Recording layout.** Uses the bottom safe area with the 8pt margin. Compact mode below 190pt is now one size step, and fits 42mm and 41mm with 7pt of slack.
23. **Always-On.** As C22. `SafetyStopInstrument` has no AOD branch.
24. **Haptics.** The same five events. No view-level haptics. Crown detents stay silent on the pager.
25. **Loading.** Nothing before 1 s, then a static skeleton or spinner, a message from 4 s and retry from 10 s. No minimum display time. The watch exceptions are kept.
26. **Busy and failure feedback.** "잠시 기다려 주세요" for 2 s after a busy press. Failure notes carry "(n)". The save note stays inline above the buttons and never hides.
27. **Surfaces.** Black canvas, no card inside a card, no borders, no shadows. The gauge fill is solid, so there is no decorative gradient.
28. **Colour roles.** Blue only for actions and selection. Chips are low-chroma rounded rectangles. Press is scale 0.95.
29. **Home structure.** Kept, with the 64pt minimum card height and pull-to-refresh.
30. **Summary, list and detail.**
    - The summary leads with maximum depth and time, shows status once, and has a toolbar back button.
    - List dates are never truncated, there is no empty mode pill, and sync is shown as an icon.
    - On the detail, sync sits under the badges.
31. **Tests and docs.** See G3.
32. **Hardware.** Nothing is claimed as verified on real hardware (G4).

### G2. Proposals needing owner approval, and the fallback the mockups use

| # | Proposal | Mockup default (rule-compliant) |
|---|---|---|
| P1 | Depth-anchored gauge gradient (`#1F5A99` at 0 m → `#0E2C52` at 40 m), revealed only down to the current depth. Keeps the jest `LinearGradient`/`deepBlueGradient` literals. | Solid `--dv-water` |
| P2 | Three amber stop-minute indices | Countdown only (shown tagged on the stop and AOD-stop artboards) |
| P3 | 600ms interpolated stop rescale (30→10) | 250ms cross-fade (RC-RANGE) |
| P4 | Wet Ready `containerBackground` water tint | Black |
| P5 | Freedive tide marks at the surface | Surface max ghost only (tagged on the freedive surface artboards) |
| P6 | One recording term per concept: "다이빙 시간" for "시간"/"기록 시간", and "마지막 확인" for "확인된 시간" | Current strings |
| P7 | Storage footer in grey on recording pages | Danger red |
| P8 | Hide "--" rows in the summary and detail (except "상태") | Show rows with "--" in ink3. The mock data has no empty rows. |
| P9 | Home recent card links to its detail | Not tappable |
| P11 | Shorter save-failure copy: "저장하지 못했습니다" / "기록은 워치에 남아 있습니다." | Current strings |
| P12 | Wet Ready "홈 화면으로" as a toolbar glass circle | Secondary capsule after the disclaimer |
| P13 | Unsupported notice below the start cards | One line above the cards |

**Copy and format refinements adopted without a rule change.** These need catalog entries in en and ko and must be checked against the pins:
- Relative dates: "오늘/어제 …", with the year only when it is not this year.
- Off-recording durations: "42분 10초", "3분", "0초" (`Duration.UnitsFormatStyle`).
- "계획 수심" on plan rows.
- Detail title is the date ("10월 22일").
- "Air" is localised to "공기".
- Visibility is shown as "4/5".

### G3. Pins, tests and docs to update

**`apps/mobile/__tests__/watch-connectivity-native-source.test.ts`**
- `LinearGradient`/`deepBlueGradient`: remove under the fallback; keep under P1.
- Any blue hero colour and any 38/34/30pt compact constants.
- The `RecordingPageDots` `HStack` becomes a `VStack`.
- The Water Lock note moves out of `RecordingHintBar`.
- The `Back to Home` button literal changes only under P12.

**Pins kept as they are**
- `layoutWidth: CGFloat = 46`
- `VStack(spacing: 3)`
- `.padding(.bottom, 8).ignoresSafeArea`
- `Image(systemName: "chevron.right")`
- `StartSessionCard(... trailingSystemImage: "play.fill")`
- `HomeRow(title: "Demo", detail: String(localized: "Simulated depth"))`
- `.frame(maxWidth: .infinity, minHeight: 44)`
- every hint literal

**Other files**
- `apps/mobile/scripts/check-watch-ui-language.mjs`: add the new catalog strings; the size floor stays (no 8, 9 or 10).
- `DivenaryWatchAppTests/RecordingHintTests.swift`: unchanged.
- `.wiki/wiki/design/mobile-watch-ui-language.md`: update through the karpathy-llm-wiki and wiki-writing skills. Add the water data-hue role, white heroes, shape grammar, motion rules (D1), vertical hint dots, the Water Lock slot, the compact step and the approved P-decisions.
- `safety-rules.md`: add a cross-reference that motion never signals the stop or clearance.

**Gates:** `yarn workspace @repo/mobile watch:ui:check`, `yarn mobile:test`, `yarn watch:build`, and the `DivenaryWatchAppTests` XCTest.

### G4. Not verified (do not claim)

- Hangul widths: estimated at about 0.92–0.94 em. Confirm the End and hint lines on 42mm and 41mm in the simulator.
- How smooth the gauge glide looks at the real sample rate.
- Navy fill and white index legibility in green water, at night and in glare.
- Always-On transitions.
- The 41/42/46/49mm fit on device.
- Crown behaviour under Water Lock and the Action Button chain.
- How Liquid Glass renders on watchOS 26/27.
- Whether `matchedGeometryEffect` holds across the Wet Ready → recording phase switch.