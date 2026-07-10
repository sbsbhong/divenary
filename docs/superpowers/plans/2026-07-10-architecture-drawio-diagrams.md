# Architecture Draw.io Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a high-level architecture diagram package with one multi-page draw.io source, page-specific SVG previews, and a Markdown index.

**Architecture:** `docs/architecture/architecture.drawio` is the editable source of truth and contains three pages: `Overview`, `Apps`, and `External Services`. Each page is exported as a sibling SVG so Obsidian, VS Code Markdown preview, and GitHub-style Markdown can render the diagrams without a draw.io plugin. `docs/architecture/README.md` embeds the SVGs and documents the maintenance workflow.

**Tech Stack:** Markdown, diagrams.net/draw.io XML (`mxfile`), SVG, `rg`, `xmllint` when available.

---

## File Structure

- Create: `docs/architecture/README.md`
  - Embeds the three SVG previews.
  - Links to the editable draw.io source.
  - States update rules for future architecture changes.
- Create: `docs/architecture/architecture.drawio`
  - Editable multi-page draw.io source.
  - Uses uncompressed draw.io XML so page names and labels are searchable.
  - Contains `Overview`, `Apps`, and `External Services`.
- Create: `docs/architecture/architecture-overview.svg`
  - Markdown-preview export for the `Overview` draw.io page.
- Create: `docs/architecture/architecture-apps.svg`
  - Markdown-preview export for the `Apps` draw.io page.
- Create: `docs/architecture/architecture-external-services.svg`
  - Markdown-preview export for the `External Services` draw.io page.

No existing code, schema, generated contract, native project, wiki article, or app behavior should change in this implementation.

## Shared Diagram Content

Use these exact page titles and status labels:

- `Overview`
- `Apps`
- `External Services`
- `current`
- `PoC`
- `future`
- `reserved`
- `requires real-device validation`

Use these safety and scope labels:

- `Recreational log companion`
- `Not certified dive-computer behavior`
- `Local import acknowledgement, not cloud sync`

Avoid these claims:

- Supabase is implemented.
- Auth is implemented.
- Cloud backup is implemented.
- Watch underwater behavior is real-device verified.
- The app is a certified dive computer, decompression computer, medical device, life-support device, or emergency decision system.

### Overview Page Model

The `Overview` page should have these groups:

- `diving-app monorepo`
  - `Yarn 1 workspaces`
  - `Turborepo scripts`
- `apps/mobile`
  - `React Native app`
  - `iOS native project`
  - `Android project`
- `apps/mobile/ios/DiveWatchApp`
  - `SwiftUI watchOS companion`
  - `embedded in DiveMobile.xcodeproj`
- `packages/contracts`
  - `JSON Schema source`
  - `generated TypeScript`
  - `generated Swift`
- `packages/shared-utils`
  - `reserved`
  - `currently empty`
- `.wiki`
  - `durable architecture knowledge`
- `docs`
  - `specs, plans, architecture diagrams`

The page should show these flows:

- `JSON Schema source` -> `generated TypeScript` -> `mobile validation/import`
- `JSON Schema source` -> `generated Swift` -> `generated output, not currently compiled into watch target`
- `.wiki` -> `diagram update check when architecture changes`

### Apps Page Model

The `Apps` page should have these groups:

- `React Native mobile app`
  - `Navigation + screens`
  - `React Query state hooks`
  - `AsyncStorage repositories`
  - `runtime watch payload validation`
  - `Logbook / Planbook / Settings / Home`
- `iOS native bridge`
  - `WatchConnectivityInbox`
  - `WatchConnectivityModule`
  - `durable pending inbox`
  - `planned-dive context publisher`
  - `linked watch status`
- `watchOS companion`
  - `SwiftUI views`
  - `recording engines`
  - `file-backed session store`
  - `WatchConnectivity transport`
- `local sync contract`
  - `WatchSyncMessage`
  - `WatchSession`
  - `DepthSample`

The page should show these flows:

- `watchOS companion` -> `WatchConnectivity payload` -> `iOS native bridge` -> `runtime validation` -> `AsyncStorage repositories`
- `React Native mobile app` -> `planned dive application context` -> `watchOS companion`
- `AsyncStorage repositories` -> `import acknowledgement` -> `watchOS companion`

The acknowledgement flow must be labeled `Local import acknowledgement, not cloud sync`.

### External Services Page Model

The `External Services` page should have these groups:

- `Open-Meteo boundary`
  - `current / PoC client-side provider`
  - `weather / marine conditions`
  - `not safety-critical`
- `Supabase/Auth/Cloud Sync boundary`
  - `future`
  - `no current client`
  - `no migrations`
  - `no RLS policies`
  - `no cloud backup`
- `Apple platform services`
  - `WatchConnectivity`
  - `Core Motion underwater sensor boundary`
  - `Notifications`
- `real-device validation`
  - `pairing`
  - `background delivery`
  - `underwater sensor behavior`
  - `auto-launch`

The page should show these flows:

- `Home conditions provider` -> `current / PoC Open-Meteo boundary`
- `mobile local repositories` -> `future Supabase sync boundary`
- `watchOS companion` -> `Apple platform services`
- `Apple platform services` -> `requires real-device validation`

## Task 1: Create Markdown Index

**Files:**
- Create: `docs/architecture/README.md`

- [ ] **Step 1: Create the architecture docs directory**

Run:

```bash
mkdir -p docs/architecture
```

Expected: command exits successfully.

- [ ] **Step 2: Add `docs/architecture/README.md`**

Create the file with this content:

```md
# Architecture Diagrams

This directory contains the editable draw.io source and Markdown-preview SVG exports for the current `diving-app` architecture.

The diagrams are a visual companion to `.wiki/wiki/architecture/*.md`. The wiki remains the durable textual architecture source.

## Overview

![Architecture overview](./architecture-overview.svg)

## Apps

![Apps architecture](./architecture-apps.svg)

## External Services

![External services](./architecture-external-services.svg)

## Source

[Open the draw.io source](./architecture.drawio)

## Maintenance

- Edit `architecture.drawio`.
- Export each changed page to its matching SVG file.
- Keep current, PoC, future, reserved, and real-device-validation boundaries visually distinct.
- Do not show Supabase, auth, cloud sync, or cloud backup as implemented until code and wiki pages say they are implemented.
- Do not imply certified dive-computer, decompression-computer, medical, life-support, emergency decision, or certified equipment replacement behavior.

Update these diagrams when architecture work changes workspace responsibility, mobile/watch ownership, watch sync semantics, external service boundaries, Supabase/auth/cloud sync status, or safety-critical scope boundaries.
```

- [ ] **Step 3: Verify Markdown references**

Run:

```bash
rg -n "architecture-overview.svg|architecture-apps.svg|architecture-external-services.svg|architecture.drawio" docs/architecture/README.md
```

Expected: output includes all four referenced filenames.

## Task 2: Create Multi-Page Draw.io Source

**Files:**
- Create: `docs/architecture/architecture.drawio`

- [ ] **Step 1: Add `architecture.drawio`**

Create a valid uncompressed draw.io XML file with:

- root `<mxfile>` element;
- exactly three `<diagram>` children;
- diagram names `Overview`, `Apps`, and `External Services`;
- visible labels matching the models in `Shared Diagram Content`;
- simple rounded rectangles, swimlane-style groups, and directional connectors;
- no `diving-app-` filename prefix in labels or links.

Use this concrete XML structure:

- root element: `<mxfile host="app.diagrams.net" modified="2026-07-10T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">`
- first child: `<diagram id="overview" name="Overview">` with one `<mxGraphModel>` page sized `1400` by `900`
- second child: `<diagram id="apps" name="Apps">` with one `<mxGraphModel>` page sized `1400` by `900`
- third child: `<diagram id="external-services" name="External Services">` with one `<mxGraphModel>` page sized `1400` by `900`
- every `<mxGraphModel>` root contains `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>`
- every visible shape is an `<mxCell vertex="1" parent="1">` with a concrete `value`, `style`, and `<mxGeometry as="geometry" x="..." y="..." width="..." height="..."/>`
- every connector is an `<mxCell edge="1" parent="1" source="..." target="...">` with `endArrow=block` in the style and an `<mxGeometry relative="1" as="geometry"/>`
- the final file contains no XML comments

- [ ] **Step 2: Verify draw.io page names**

Run:

```bash
rg -n 'name="Overview"|name="Apps"|name="External Services"' docs/architecture/architecture.drawio
```

Expected: exactly three matching lines or matches.

- [ ] **Step 3: Verify XML parses**

Run:

```bash
xmllint --noout docs/architecture/architecture.drawio
```

Expected: command exits successfully. If `xmllint` is unavailable, run:

```bash
ruby -rrexml/document -e 'REXML::Document.new(File.read("docs/architecture/architecture.drawio")); puts "ok"'
```

Expected: `ok`.

## Task 3: Create Page-Specific SVG Exports

**Files:**
- Create: `docs/architecture/architecture-overview.svg`
- Create: `docs/architecture/architecture-apps.svg`
- Create: `docs/architecture/architecture-external-services.svg`

- [ ] **Step 1: Create `architecture-overview.svg`**

Create an SVG that visually matches the `Overview` draw.io page and includes these visible section headings:

```text
diving-app monorepo
apps/mobile
apps/mobile/ios/DiveWatchApp
packages/contracts
packages/shared-utils
.wiki
docs
```

The SVG must include visible labels for:

```text
Yarn 1 workspaces
Turborepo scripts
JSON Schema source
generated TypeScript
generated Swift
mobile validation/import
generated output, not currently compiled into watch target
reserved
currently empty
durable architecture knowledge
specs, plans, architecture diagrams
```

- [ ] **Step 2: Create `architecture-apps.svg`**

Create an SVG that visually matches the `Apps` draw.io page and includes these visible section headings:

```text
React Native mobile app
iOS native bridge
watchOS companion
local sync contract
```

The SVG must include visible labels for:

```text
Navigation + screens
React Query state hooks
AsyncStorage repositories
runtime watch payload validation
WatchConnectivityInbox
WatchConnectivityModule
durable pending inbox
planned-dive context publisher
SwiftUI views
recording engines
file-backed session store
WatchConnectivity transport
WatchSyncMessage
WatchSession
DepthSample
Local import acknowledgement, not cloud sync
```

- [ ] **Step 3: Create `architecture-external-services.svg`**

Create an SVG that visually matches the `External Services` draw.io page and includes these visible section headings:

```text
Open-Meteo boundary
Supabase/Auth/Cloud Sync boundary
Apple platform services
real-device validation
```

The SVG must include visible labels for:

```text
current / PoC client-side provider
weather / marine conditions
not safety-critical
future
no current client
no migrations
no RLS policies
no cloud backup
WatchConnectivity
Core Motion underwater sensor boundary
Notifications
pairing
background delivery
underwater sensor behavior
auto-launch
requires real-device validation
```

- [ ] **Step 4: Verify SVG XML parses**

Run:

```bash
xmllint --noout docs/architecture/architecture-overview.svg docs/architecture/architecture-apps.svg docs/architecture/architecture-external-services.svg
```

Expected: command exits successfully. If `xmllint` is unavailable, run:

```bash
ruby -rrexml/document -e 'ARGV.each { |path| REXML::Document.new(File.read(path)); puts "#{path}: ok" }' docs/architecture/architecture-overview.svg docs/architecture/architecture-apps.svg docs/architecture/architecture-external-services.svg
```

Expected: one `ok` line per SVG file.

## Task 4: Cross-Check Content And Safety Boundaries

**Files:**
- Inspect: `docs/architecture/README.md`
- Inspect: `docs/architecture/architecture.drawio`
- Inspect: `docs/architecture/architecture-overview.svg`
- Inspect: `docs/architecture/architecture-apps.svg`
- Inspect: `docs/architecture/architecture-external-services.svg`

- [ ] **Step 1: Verify all artifact paths exist**

Run:

```bash
ls docs/architecture/README.md docs/architecture/architecture.drawio docs/architecture/architecture-overview.svg docs/architecture/architecture-apps.svg docs/architecture/architecture-external-services.svg
```

Expected: all five paths are printed.

- [ ] **Step 2: Verify expected labels exist**

Run:

```bash
rg -n "Overview|Apps|External Services|React Native mobile app|watchOS companion|Open-Meteo boundary|Supabase/Auth/Cloud Sync boundary|Local import acknowledgement, not cloud sync" docs/architecture
```

Expected: output includes matches across the draw.io source, SVG exports, and README.

- [ ] **Step 3: Verify forbidden implementation claims are absent**

Run:

```bash
rg -n "current Supabase|implemented Supabase|implemented auth|implemented cloud sync|cloud backup implemented|certified dive computer behavior|decompression computer behavior|emergency decision behavior|life-support behavior" docs/architecture
```

Expected: no output and exit code `1`.

- [ ] **Step 4: Inspect SVG preview readability**

Open or preview the three SVG files in the editor or Markdown preview. Confirm:

- the page title is visible;
- all boxes fit inside the SVG viewport;
- connector labels are readable;
- no text overlaps another label;
- current, PoC, future, reserved, and real-device-validation boundaries are visually distinct.

No terminal command is required for this manual visual check.

## Task 5: Commit Documentation Artifacts

**Files:**
- Add: `docs/architecture/README.md`
- Add: `docs/architecture/architecture.drawio`
- Add: `docs/architecture/architecture-overview.svg`
- Add: `docs/architecture/architecture-apps.svg`
- Add: `docs/architecture/architecture-external-services.svg`
- Modify: `docs/superpowers/specs/2026-07-10-architecture-drawio-diagrams-design.md`
- Add: `docs/superpowers/plans/2026-07-10-architecture-drawio-diagrams.md`

- [ ] **Step 1: Review diff**

Run:

```bash
git diff -- docs/architecture docs/superpowers/specs/2026-07-10-architecture-drawio-diagrams-design.md docs/superpowers/plans/2026-07-10-architecture-drawio-diagrams.md
```

Expected: diff only includes the architecture diagram package, the corrected architecture diagram design spec wording, and this implementation plan.

- [ ] **Step 2: Stage documentation artifacts**

Run:

```bash
git add docs/architecture docs/superpowers/specs/2026-07-10-architecture-drawio-diagrams-design.md docs/superpowers/plans/2026-07-10-architecture-drawio-diagrams.md
```

Expected: command exits successfully.

- [ ] **Step 3: Confirm staged paths**

Run:

```bash
git diff --cached --name-only
```

Expected: output includes only:

```text
docs/architecture/README.md
docs/superpowers/specs/2026-07-10-architecture-drawio-diagrams-design.md
docs/architecture/architecture-apps.svg
docs/architecture/architecture-external-services.svg
docs/architecture/architecture-overview.svg
docs/architecture/architecture.drawio
docs/superpowers/plans/2026-07-10-architecture-drawio-diagrams.md
```

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "docs: add architecture diagrams"
```

Expected: commit succeeds.

## Self-Review Notes

- Spec coverage: the plan creates one multi-page draw.io source, three page-specific SVG previews, and a Markdown index under `docs/architecture/`.
- Spec coverage: the plan uses `architecture.*` filenames without a `diving-app-` prefix.
- Spec coverage: the plan distinguishes current local behavior, PoC Apple platform behavior, future Supabase/auth/cloud sync, and Open-Meteo provider boundaries.
- Spec coverage: the plan includes safety wording checks and avoids certified dive-computer or emergency-behavior claims.
- Completeness scan: no step contains unspecified future work, incomplete file instructions, or open-ended test commands.
