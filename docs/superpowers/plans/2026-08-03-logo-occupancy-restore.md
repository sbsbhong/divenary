# Exact Logo Occupancy Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the exact pre-refinement large light and dark logo PNGs across in-app, iOS, Android, and watch assets while retaining continuous rounded-corner splash smoothing.

**Architecture:** The two canonical PNGs under `apps/mobile/src/assets/brand/` remain the single source of truth. Restore their exact Git blobs from commit `14b9d75`, then run the existing deterministic Swift generator to rebuild every native derivative; regression tests calculate Git blob IDs so a visually similar replacement cannot pass.

**Tech Stack:** Yarn 1, Jest, Node.js `crypto`, Swift/CoreGraphics/ImageIO/QuartzCore, React Native 0.85.3, Android Gradle, Xcode

## Global Constraints

- Restore the canonical light blob exactly as `5a5eb21bcb739897e84158244407a5988d95d201`.
- Restore the canonical dark blob exactly as `c4a76b743a18eb835706aa83c4ec8b8505aecb95`.
- Preserve splash corner radius ratio `0.22`.
- Preserve `CALayer.cornerCurve = .continuous`.
- Preserve four-times supersampled splash rendering and transparent PNG corners.
- Do not change launch-screen dimensions, backgrounds, layout, or fade behavior.
- Do not modify application, navigation, sync, account, Supabase, watch recording, or safety behavior.
- Do not stage or modify unrelated `.turbo/cache/` files.
- Do not add dependencies or update `yarn.lock`.

---

### Task 1: Add exact canonical-blob regression coverage

**Files:**
- Modify: `apps/mobile/__tests__/native-splash.test.ts`
- Test: `apps/mobile/__tests__/native-splash.test.ts`

**Interfaces:**
- Consumes: canonical PNG files at `src/assets/brand/app-logo-light.png` and `src/assets/brand/app-logo-dark.png` relative to the mobile workspace.
- Produces: `readGitBlobId(relativePath: string): string | undefined`, which computes the same SHA-1 Git uses for a blob object.

- [ ] **Step 1: Import Node crypto and add the Git blob-ID helper**

Add the import:

```ts
import { createHash } from 'node:crypto';
```

Add this helper after `readMobileFile`:

```ts
function readGitBlobId(relativePath: string): string | undefined {
  try {
    const bytes = readFileSync(resolve(process.cwd(), relativePath));
    const header = Buffer.from(`blob ${bytes.length}\0`);

    return createHash('sha1').update(header).update(bytes).digest('hex');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Replace the stale scale assertion with exact source assertions**

Change the first test to:

```ts
test('keeps the exact large logo sources and approved splash geometry', () => {
  const generator = readMobileFile('scripts/generate-brand-assets.swift');

  expect(readGitBlobId('src/assets/brand/app-logo-light.png')).toBe(
    '5a5eb21bcb739897e84158244407a5988d95d201',
  );
  expect(readGitBlobId('src/assets/brand/app-logo-dark.png')).toBe(
    'c4a76b743a18eb835706aa83c4ec8b8505aecb95',
  );
  expect(generator).not.toContain('foregroundScale');
  expect(generator).toContain('static let splashCornerRadiusRatio = 0.22');
  expect(generator).toContain('splashCornerRadiusRatio * CGFloat(renderSize)');
  expect(generator).toContain('let supersample = rounded ? 4 : 1');
  expect(generator).toContain('layer.cornerCurve = .continuous');
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
```

Expected: FAIL because both canonical blob IDs still identify the 85%-spacing images and the generator still contains `foregroundScale`.

- [ ] **Step 4: Commit the verified failing regression test**

```bash
git add apps/mobile/__tests__/native-splash.test.ts
git commit -m "test(mobile): require exact large logo sources"
```

### Task 2: Restore exact sources and regenerate native assets

**Files:**
- Restore: `apps/mobile/src/assets/brand/app-logo-light.png`
- Restore: `apps/mobile/src/assets/brand/app-logo-dark.png`
- Modify: `apps/mobile/scripts/generate-brand-assets.swift`
- Regenerate: `apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset/*.png`
- Regenerate: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/*.png`
- Regenerate: `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png`
- Regenerate: `apps/mobile/android/app/src/main/res/drawable-*/splash_mark.png`
- Regenerate: `apps/mobile/android/app/src/main/res/drawable-night-*/splash_mark.png`
- Regenerate: `apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png`
- Regenerate: `apps/mobile/android/app/src/main/res/mipmap-night-*/ic_launcher*.png`

**Interfaces:**
- Consumes: exact canonical Git blobs from commit `14b9d75` and the existing `render(source:size:rounded:)` generator function.
- Produces: deterministic full-occupancy app, watch, and splash PNG derivatives; rounded derivatives still use `rounded: true`.

- [ ] **Step 1: Restore the canonical PNGs from the approved commit**

Run:

```bash
git restore --source=14b9d75 -- apps/mobile/src/assets/brand/app-logo-light.png apps/mobile/src/assets/brand/app-logo-dark.png
```

Verify exact Git blob IDs:

```bash
git hash-object apps/mobile/src/assets/brand/app-logo-light.png
git hash-object apps/mobile/src/assets/brand/app-logo-dark.png
```

Expected output, in order:

```text
5a5eb21bcb739897e84158244407a5988d95d201
c4a76b743a18eb835706aa83c4ec8b8505aecb95
```

- [ ] **Step 2: Remove the unused scale configuration from the generator**

Delete this line from `BrandAssetConfig`:

```swift
static let foregroundScale = 0.85
```

Replace the final print block:

```swift
print(
  "Generated Divenary brand assets "
    + "(foregroundScale=\(BrandAssetConfig.foregroundScale), "
    + "splashCornerRadiusRatio=\(BrandAssetConfig.splashCornerRadiusRatio))"
)
```

with:

```swift
print(
  "Generated Divenary brand assets "
    + "(splashCornerRadiusRatio=\(BrandAssetConfig.splashCornerRadiusRatio))"
)
```

- [ ] **Step 3: Typecheck the generator**

Run:

```bash
swiftc -typecheck -module-cache-path /private/tmp/divenary-logo-restore-module-cache apps/mobile/scripts/generate-brand-assets.swift
```

Expected: exit code 0 with no Swift errors.

- [ ] **Step 4: Regenerate every native derivative**

Run:

```bash
SWIFT_MODULECACHE_PATH=/private/tmp/divenary-logo-restore-module-cache CLANG_MODULE_CACHE_PATH=/private/tmp/divenary-logo-restore-clang-cache swift apps/mobile/scripts/generate-brand-assets.swift
```

Expected output:

```text
Generated Divenary brand assets (splashCornerRadiusRatio=0.22)
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/native-splash.test.ts
```

Expected: 2 suites pass, 10 tests pass, 0 failures.

- [ ] **Step 6: Inspect the highest-resolution splash outputs**

Open these generated files with the local image viewer and verify that the manta has the original large occupancy while the square has smooth continuous transparent corners:

```text
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark@3x.png
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark@3x.png
```

- [ ] **Step 7: Commit the exact restoration and regenerated assets**

```bash
git add apps/mobile/src/assets/brand/app-logo-light.png apps/mobile/src/assets/brand/app-logo-dark.png apps/mobile/scripts/generate-brand-assets.swift apps/mobile/ios/Divenary/Images.xcassets apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset apps/mobile/android/app/src/main/res
git commit -m "fix(mobile): restore full-size brand logos"
```

### Task 3: Verify all affected platforms

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: committed exact canonical PNGs and regenerated native assets from Task 2.
- Produces: fresh test, typecheck, Android resource, watchOS, and iOS build evidence.

- [ ] **Step 1: Re-run the focused regression tests**

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/native-splash.test.ts
```

Expected: 2 suites pass, 10 tests pass, 0 failures.

- [ ] **Step 2: Run the mobile typecheck**

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn mobile:typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Process Android debug resources**

From `apps/mobile/android`, run:

```bash
ANDROID_HOME=/Users/hongseongbin/Library/Android/sdk PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin ./gradlew --no-daemon :app:processDebugResources
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Build the watch app**

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn watch:build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Build the complete iOS simulator app**

If `apps/mobile/ios/Pods/Manifest.lock` is present and matches `Podfile.lock`, run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:/usr/bin:/bin /Users/hongseongbin/.nvm/versions/node/v22.20.0/bin/yarn ios:build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 6: Confirm repository scope and commit state**

```bash
git diff --check
git status --short
git log --oneline --decorate -5
```

Expected: no uncommitted files in the isolated worktree, no whitespace errors, and the test and implementation commits at the branch tip.

