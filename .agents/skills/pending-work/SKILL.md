---
name: pending-work
description: Summarize remaining, unresolved, or next implementation work in the diving-app repository. Use when the user asks what is left, what remains to do, next priorities, pending tasks, open questions, pre-device-test work, real-device validation gaps, or implementation backlog for this project.
---

# Pending Work

## Overview

Report the current remaining work for `diving-app` from durable project sources. Prefer implemented facts from code and the Karpathy LLM Wiki over stale plan checkboxes.

## Workflow

1. Read the repository context before answering:
   - `AGENTS.md`
   - `.wiki/wiki/index.md`
   - `.wiki/wiki/project/wiki-workflow.md`
   - `.wiki/wiki/architecture/implementation-priorities.md`
   - `.wiki/wiki/questions/open-questions.md`
   - relevant `.wiki/wiki/architecture/*.md` and `.wiki/wiki/domains/*.md`
   - recent `docs/superpowers/specs/*-design.md` files when the user asks about approved but unimplemented work
2. Check current code state for drift:
   - `git status --short`
   - `rg -n "TODO|FIXME|not implemented|미구현|검증|후속|남은|pending" README.md .wiki docs apps packages -g '!node_modules'`
3. Treat old `docs/superpowers/plans/*.md` checkbox lists as historical unless the current `.wiki/wiki/index.md` articles or code still confirm them.
4. Separate the answer into completed foundations, the complete P0 backlog by dependency wave, physical validation gaps, the real-dive-only gate, and the next executable spec.
5. Never omit Supabase/Auth or Memory/share merely because physical-device work is closer. Include every confirmed unresolved item that can be completed before an actual freedive or scuba dive.
6. Include file references for claims that may affect implementation priority.

## Project Rules

- Do not claim commands passed unless they were actually run.
- Do not report speculative ideas as approved work.
- Preserve the safety boundary: this app is not a certified dive computer, decompression computer, medical device, emergency system, or certified equipment replacement.
- For scuba-related pending work, distinguish non-certified reference assistant behavior from safety-critical computation.
- For sync-related pending work, distinguish local repository import from future Supabase or cloud sync.
- `DiveLogEntry.cloudSyncStatus` is separate from raw Watch `session.syncStatus`. Until a backend exists, cloud status is `notConfigured`; do not describe Watch import acknowledgement as cloud sync.
- Physical testing starts only when the user requests it or implementation/automated verification is complete. Do not claim Watch installation, paired delivery, reconnect behavior, or underwater sensor behavior without observed evidence.

## Priority Model

All confirmed work possible before an actual freedive or scuba dive is P0. Waves express dependencies, not lower priority:

1. Dry physical-device install, pairing, WatchConnectivity, acknowledgement, background/killed delivery, planned dives, notifications, and large file transfer.
2. Shallow container/pool depth, pressure, optional temperature, auto-launch, handoff, wet controls, readability, and haptics.
3. Supabase/Auth, user-owned schema/RLS, generated types, remote repositories, outbox/conflict, backup, and media storage.
4. Memory/share, attachments/export, Logbook/Planbook completion, retry/status UX, accessibility, localization, and privacy controls.
5. Release/signing/entitlement/privacy/security QA and design-only high-risk boundaries.

Keep actual freediving/scuba, deep-water behavior, and real-dive safety-stop behavior in a separate Real-dive gate.

## Output Shape

Keep the response short and actionable. Prefer this structure:

- 완료된 기반
- P0 Wave 1-5 전체
- 실제 잠수 게이트
- 열린 질문/검증 필요
- 다음 실행 spec

Within a wave, put data loss, migration, security/RLS, WatchConnectivity integrity, and safety wording before visual polish.
