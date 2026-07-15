# Divenary Service Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the active iPhone and Apple Watch service surfaces from `DiveMobile` / `DiveWatchApp` to `Divenary` / `DivenaryWatchApp`.

**Architecture:** Keep the monorepo and `apps/mobile` workspace path unchanged, while atomically renaming the native Xcode project, targets, schemes, source folders, CocoaPods target, React Native app registry name, display names, and branded bundle identifiers. Role-based module names such as WatchConnectivity and reverse geocoder remain unchanged.

**Tech Stack:** React Native 0.85.3, Yarn 1 workspaces, CocoaPods, Xcode project files, SwiftUI watchOS companion target.

## Global Constraints

- Official English service and UI wordmark: `Divenary`.
- Korean helper spelling only where needed in prose: `다이브너리`.
- iPhone bundle ID: `com.divenary.app`.
- Watch bundle ID: `com.divenary.app.watchkitapp`.
- Watch test bundle ID: `com.divenary.app.watchkitapp.tests`.
- Keep `apps/mobile` workspace path unchanged.
- Keep role-based native module names such as WatchConnectivity, profile storage, and reverse geocoder unchanged.
- Do not add certified dive computer, decompression computer, medical, life-support, emergency decision, or underwater instruction claims.

---

### Task 1: Add Rename Validation Gate

**Files:**
- Create: `apps/mobile/scripts/check-divenary-native-rename.mjs`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Produces: `yarn workspace @repo/mobile native:brand:check`, a deterministic local script that validates target project names, display names, bundle IDs, source paths, Pod target names, and RN registry metadata.

- [ ] **Step 1: Add the validation script**

Create `apps/mobile/scripts/check-divenary-native-rename.mjs` with filesystem and plist/project checks for the approved names.

- [ ] **Step 2: Add package script**

Add `"native:brand:check": "node ./scripts/check-divenary-native-rename.mjs"` to `apps/mobile/package.json`.

- [ ] **Step 3: Run red validation**

Run: `yarn workspace @repo/mobile native:brand:check`

Expected: FAIL, listing existing `DiveMobile` / `DiveWatchApp` active names.

### Task 2: Rename Active Native Surfaces

**Files:**
- Move: `apps/mobile/ios/DiveMobile.xcodeproj` to `apps/mobile/ios/Divenary.xcodeproj`
- Move: `apps/mobile/ios/DiveMobile.xcworkspace` to `apps/mobile/ios/Divenary.xcworkspace`
- Move: `apps/mobile/ios/DiveMobile` to `apps/mobile/ios/Divenary`
- Move: `apps/mobile/ios/DiveMobile/DiveMobile.entitlements` to `apps/mobile/ios/Divenary/Divenary.entitlements`
- Move: `apps/mobile/ios/DiveWatchApp` to `apps/mobile/ios/DivenaryWatchApp`
- Move: `apps/mobile/ios/DiveWatchAppTests` to `apps/mobile/ios/DivenaryWatchAppTests`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/xcshareddata/xcschemes/*.xcscheme`
- Modify: `apps/mobile/ios/Podfile`
- Modify: `apps/mobile/ios/Podfile.lock`
- Modify: `apps/mobile/ios/Divenary/Info.plist`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Info.plist`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/index.js` if registry metadata requires a direct import/name change.

**Interfaces:**
- Produces: Xcode project `apps/mobile/ios/Divenary.xcodeproj`, workspace `apps/mobile/ios/Divenary.xcworkspace`, iPhone scheme `Divenary`, watch scheme `DivenaryWatchApp`, watch debug scheme `DivenaryWatchAppDebug`, watch test scheme `DivenaryWatchAppTests`.

- [ ] **Step 1: Move native project and source folders**

Use git-aware moves for the project/workspace, app source, watch source, tests, and entitlement file.

- [ ] **Step 2: Replace project-level names**

Update `project.pbxproj`, xcschemes, workspace data, Podfile, and Pod lock references from old active names to target names.

- [ ] **Step 3: Replace user-facing native names and identifiers**

Set app display names to `Divenary`, app registry metadata to `Divenary`, iPhone bundle ID to `com.divenary.app`, watch bundle ID to `com.divenary.app.watchkitapp`, watch test bundle ID to `com.divenary.app.watchkitapp.tests`, and watch companion bundle ID to `com.divenary.app`.

- [ ] **Step 4: Run green validation**

Run: `yarn workspace @repo/mobile native:brand:check`

Expected: PASS.

### Task 3: Update Scripts and Documentation References

**Files:**
- Modify: `apps/mobile/scripts/ios-build.mjs`
- Modify: `apps/mobile/scripts/check-watch-ui-language.mjs`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/README.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `apps/mobile/AGENTS.md`

**Interfaces:**
- Produces: current scripts and docs that point at `Divenary.xcodeproj`, `Divenary.xcworkspace`, `Divenary`, `DivenaryWatchApp`, and `DivenaryWatchAppTests`.

- [ ] **Step 1: Update build/list scripts**

Change `watch:build`, `watch:list`, and `ios-build.mjs` to use the renamed project/workspace/scheme and derived data paths.

- [ ] **Step 2: Update watch UI check paths**

Change watch UI validation script paths to `ios/Divenary.xcodeproj` and `ios/DivenaryWatchApp`.

- [ ] **Step 3: Update active docs and agent instructions**

Update current active project references in root/mobile README and AGENTS files. Leave historical dated plan/spec files intact unless they describe current active paths.

### Task 4: Verify Native Rename

**Files:**
- No additional files expected.

**Interfaces:**
- Consumes: renamed native project and validation scripts from Tasks 1-3.
- Produces: verification results for handoff.

- [ ] **Step 1: Run brand validation**

Run: `yarn workspace @repo/mobile native:brand:check`

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run: `yarn mobile:typecheck`

Expected: PASS.

- [ ] **Step 3: Run watch UI check**

Run: `yarn workspace @repo/mobile watch:ui:check`

Expected: PASS.

- [ ] **Step 4: List renamed Xcode project**

Run: `xcodebuild -list -project apps/mobile/ios/Divenary.xcodeproj`

Expected: targets and schemes include `Divenary`, `DivenaryWatchApp`, and `DivenaryWatchAppTests`.

- [ ] **Step 5: Run watch build**

Run: `yarn watch:build`

Expected: PASS, or report simulator/toolchain environment failure separately from project configuration failure.
