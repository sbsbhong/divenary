# Architecture Draw.io Diagrams Design

## Context

The repository already has durable architecture notes in `.wiki/wiki/architecture/*.md`, plus implementation specs and plans under `docs/superpowers/`. It does not yet have a visual architecture artifact that works across draw.io, Obsidian, VS Code Markdown preview, and GitHub-style Markdown rendering.

The requested artifact should stay high-level. It should explain the repository structure, the apps, and the major external-service boundaries without trying to duplicate every source file or every implementation detail.

The project remains a recreational dive log companion. The diagrams must not imply certified dive-computer, decompression-computer, medical, life-support, emergency decision, or certified equipment replacement behavior.

## Goals

- Add one editable multi-page draw.io source file for the current architecture.
- Export each draw.io page as an SVG so Markdown preview tools can render the diagrams without a draw.io plugin.
- Provide a Markdown index that embeds the SVGs and links back to the draw.io source.
- Keep the diagrams concise enough to update when architecture changes.
- Show current implementation and future/external boundaries distinctly.
- Avoid a broad diagram taxonomy or many separate draw.io source files.

## Non-Goals

- Do not model every React Native component, Swift view, test file, or schema property.
- Do not introduce a new documentation generator, diagramming dependency, or CI gate in this pass.
- Do not replace `.wiki/wiki/architecture/*.md`; the diagrams are a visual companion to those pages.
- Do not implement Supabase, authentication, cloud sync, Open-Meteo integration changes, or any app behavior change.
- Do not describe safety-critical dive decisions, decompression obligations, emergency guidance, or certified dive-computer behavior.

## Artifact Layout

Create the diagram package under `docs/architecture/`.

```text
docs/architecture/
  architecture.drawio
  architecture-overview.svg
  architecture-apps.svg
  architecture-external-services.svg
  README.md
```

Naming deliberately omits the `diving-app-` prefix. The directory already gives the files enough project context, and shorter names are easier to embed in Markdown.

## Draw.io Source

`architecture.drawio` is the editable source of truth for the diagrams. It contains three pages:

1. `Overview`
2. `Apps`
3. `External Services`

The source should use stable, simple draw.io shapes and connectors so future edits are straightforward. It should avoid decorative visuals that make XML diffs noisy and maintenance harder.

## SVG Exports

Each draw.io page is exported to a separate SVG:

- `Overview` -> `architecture-overview.svg`
- `Apps` -> `architecture-apps.svg`
- `External Services` -> `architecture-external-services.svg`

Markdown files embed the SVGs rather than the `.drawio` source. This makes the diagrams visible in Obsidian without a draw.io plugin and in ordinary Markdown preview surfaces such as VS Code.

The `.drawio` file remains the edit source. When diagram content changes, update the relevant draw.io page and refresh the corresponding SVG export in the same change.

## Markdown Index

`docs/architecture/README.md` embeds the SVGs in separate sections:

```md
## Overview

![Architecture overview](./architecture-overview.svg)

## Apps

![Apps architecture](./architecture-apps.svg)

## External Services

![External services](./architecture-external-services.svg)

[Open draw.io source](./architecture.drawio)
```

The README should also include a short maintenance note:

- Edit `architecture.drawio`.
- Export changed pages to SVG.
- Keep current and future boundaries visually distinct.
- Do not represent unimplemented Supabase/auth/cloud sync as current production behavior.

## Page Content

### Overview

The overview page shows the repository as a Yarn 1/Turborepo monorepo:

- root scripts and workspace boundary
- `apps/mobile`
- `apps/mobile/ios/DiveWatchApp`
- `packages/contracts`
- `packages/shared-utils`
- `.wiki`
- `docs`

It should also show the primary direction of generated contract flow:

`packages/contracts/schemas` -> generated TypeScript and Swift outputs -> mobile/watch usage boundaries.

`packages/shared-utils` should be marked as reserved/currently empty rather than an active shared implementation package.

### Apps

The apps page focuses on runtime responsibilities:

- React Native mobile app:
  - navigation and screens
  - React Query state hooks
  - AsyncStorage-backed repositories
  - runtime watch payload validation/import
  - iOS WatchConnectivity bridge
- iOS native layer:
  - `WatchConnectivityInbox`
  - `WatchConnectivityModule`
  - planned-dive context delivery
  - linked watch status
- watchOS companion:
  - SwiftUI views
  - recording engines
  - file-backed session store
  - WatchConnectivity transport
- sync direction:
  - watch session payloads to mobile import
  - mobile planned dives to watch context
  - mobile import acknowledgement back to watch

The page should label local mobile repository import acknowledgement separately from future cloud sync. Imported watch logs can be locally saved and acknowledged while cloud sync remains unimplemented.

### External Services

The external services page separates current local app behavior from future or provider-specific integration boundaries:

- Open-Meteo:
  - current / PoC client-side provider boundary for Home conditions
  - not a safety-critical source
- Supabase/Auth/Cloud Sync:
  - future boundary only
  - no current Supabase directory, client, migrations, generated database types, RLS policies, or cloud backup
- Apple platform services:
  - WatchConnectivity
  - Core Motion / underwater sensor boundary requiring real-device validation
  - notifications through the current mobile notification boundary

This page should explicitly mark implementation status with labels such as `current`, `PoC`, `future`, and `requires real-device validation`.

## Maintenance Workflow

Architecture-changing work should update this diagram package when it changes any of these durable boundaries:

- workspace or package responsibility
- mobile/watch ownership
- watch sync contract or import acknowledgement semantics
- external service boundary
- Supabase/auth/cloud sync status
- safety-critical scope boundary

For small implementation details that do not change those boundaries, no diagram update is required.

The wiki remains the textual architecture source. If a change updates `.wiki/wiki/architecture/*.md` because architecture changed, the implementer should check whether `docs/architecture/architecture.drawio` and exported SVGs also need an update.

## Verification

The design/documentation implementation should verify:

- `docs/architecture/README.md` embeds all SVG exports with relative Markdown image links.
- All referenced files exist.
- `architecture.drawio` contains the three expected pages.
- SVG files are valid enough for Markdown preview surfaces.
- No diagram label claims Supabase/auth/cloud sync is implemented.
- No diagram label implies certified dive-computer, decompression, medical, emergency, or life-support behavior.

No app build or test command is required for this documentation-only artifact unless the implementation also changes code, schema, generated contracts, wiki architecture content, or native project files.
