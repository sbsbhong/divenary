# Logo Spacing and Splash Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the manta artwork to 85% inside the existing light and dark logo canvases, obtain explicit user approval of both candidates, then apply smooth 22%-radius splash corners consistently across iOS and Android.

**Architecture:** Candidate source images are generated and reviewed outside tracked repository paths before any PNG replacement. After approval, the canonical React Native assets are replaced and a deterministic Swift/Core Graphics script generates every platform derivative; splash derivatives alone receive an anti-aliased transparent corner mask.

**Tech Stack:** React Native 0.85.3, TypeScript/Jest, Swift/Core Graphics/ImageIO, Android resources, iOS asset catalogs.

## Global Constraints

- Keep the canonical canvas at 1254×1254 pixels and preserve the existing light/dark blue backgrounds, gradients, manta silhouette, shading, eye, and orientation.
- Scale only the manta artwork to exactly 85% around its visual center.
- Do not replace any tracked image until the user explicitly approves both candidate images.
- Keep the splash layout at 96 points on iOS and 96 dp on Android.
- Use a splash corner radius equal to exactly 22% of the raster width with anti-aliased transparent corners.
- Do not bake rounded corners into iOS, Android, or watchOS installed app icons; operating systems own those masks.
- Do not add a package dependency or change resource names, bundle identifiers, signing, entitlements, navigation, authentication, sync, or safety behavior.
- Preserve unrelated user changes in the primary checkout.

## File Map

- Create `apps/mobile/scripts/generate-brand-assets.swift`: deterministic platform derivative generator and source of truth for `foregroundScale` and `splashCornerRadiusRatio`.
- Modify `apps/mobile/__tests__/native-splash.test.ts`: assert generator configuration, PNG alpha support, transparent splash corners, opaque centers, and existing density dimensions.
- Replace after approval: `apps/mobile/src/assets/brand/app-logo-light.png` and `apps/mobile/src/assets/brand/app-logo-dark.png`.
- Regenerate after approval: PNGs under `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset`, `apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset`, and `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset`.
- Regenerate after approval: `splash_mark.png`, `ic_launcher.png`, and `ic_launcher_round.png` in every existing light/night Android density directory.
- Do not modify resource XML, storyboard constraints, asset catalog JSON, Xcode target membership, or React Native component APIs unless verification proves existing wiring is insufficient.

---

### Task 1: Generate Untracked Candidate Images and Stop for Approval

**Files:**
- Read: `apps/mobile/src/assets/brand/app-logo-light.png`
- Read: `apps/mobile/src/assets/brand/app-logo-dark.png`
- Create outside repository: `/private/tmp/divenary-logo-spacing-preview/app-logo-light-candidate.png`
- Create outside repository: `/private/tmp/divenary-logo-spacing-preview/app-logo-dark-candidate.png`

**Interfaces:**
- Consumes: the two current 1254×1254 canonical PNGs.
- Produces: two visually reviewed 1254×1254 candidates; no tracked changes.

- [ ] **Step 1: Confirm tracked PNGs are unchanged**

Run `git status --short`. Expected: no modified tracked PNGs.

- [ ] **Step 2: Generate the light candidate with the image editing tool**

Reference `apps/mobile/src/assets/brand/app-logo-light.png` and use:

```text
Edit this square Divenary logo without redesigning it. Preserve the 1254×1254 canvas, exact blue background and gradient, manta silhouette, white shading, folded fin shading, eye, orientation, and center. Scale only the manta ray uniformly to 85% of its current visual size and reconstruct the uncovered background seamlessly. Do not add text, borders, shadows, rounded corners, or new elements. Output one square PNG.
```

Save outside the repository as `/private/tmp/divenary-logo-spacing-preview/app-logo-light-candidate.png`.

- [ ] **Step 3: Generate the dark candidate**

Reference `apps/mobile/src/assets/brand/app-logo-dark.png`, use the same prompt, and append:

```text
Preserve the exact brighter dark-theme blue background and do not copy the light-theme blue.
```

Save outside the repository as `/private/tmp/divenary-logo-spacing-preview/app-logo-dark-candidate.png`.

- [ ] **Step 4: Validate candidate metadata without copying**

```bash
sips -g pixelWidth -g pixelHeight /private/tmp/divenary-logo-spacing-preview/app-logo-light-candidate.png /private/tmp/divenary-logo-spacing-preview/app-logo-dark-candidate.png
git status --short
```

Expected: both are 1254×1254 and no tracked PNG changed.

- [ ] **Step 5: Show both candidates and wait**

Display both images, state that they are not applied, and stop until the user explicitly approves both or requests revision.

---

### Task 2: Add Failing Asset Contract Tests

**Files:**
- Modify/Test: `apps/mobile/__tests__/native-splash.test.ts`

**Interfaces:**
- Consumes: planned generator constants `foregroundScale = 0.85` and `splashCornerRadiusRatio = 0.22`.
- Produces: `readPngMetadata(path)` and `readPngAlphaSamples(path)` plus RED tests requiring actual transparent corners and opaque centers.

- [ ] **Step 1: Extend the PNG helper**

Replace `readPngDimensions` with:

```ts
function readPngMetadata(
  relativePath: string,
): {width: number; height: number; colorType: number} | undefined {
  try {
    const bytes = readFileSync(resolve(process.cwd(), relativePath));
    if (bytes.toString('ascii', 1, 4) !== 'PNG') return undefined;
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      colorType: bytes.readUInt8(25),
    };
  } catch {
    return undefined;
  }
}

function readPngDimensions(relativePath: string): {width: number; height: number} | undefined {
  const metadata = readPngMetadata(relativePath);
  return metadata && {width: metadata.width, height: metadata.height};
}
```

- [ ] **Step 2: Add a generator-configuration test**

```ts
test('keeps the approved logo and splash geometry in the asset generator', () => {
  const generator = readMobileFile('scripts/generate-brand-assets.swift');
  expect(generator).toContain('static let foregroundScale = 0.85');
  expect(generator).toContain('static let splashCornerRadiusRatio = 0.22');
  expect(generator).toContain('splashCornerRadiusRatio * CGFloat(renderSize)');
  expect(generator).toContain('let supersample = rounded ? 4 : 1');
  expect(generator).toContain('layer.cornerCurve = .continuous');
});
```

- [ ] **Step 3: Decode PNG alpha without a new dependency**

Add `import {inflateSync} from 'node:zlib';`, then add:

```ts
function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readPngAlphaSamples(
  relativePath: string,
): {cornerAlpha: number; centerAlpha: number} | undefined {
  try {
    const bytes = readFileSync(resolve(process.cwd(), relativePath));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (bytes.readUInt8(24) !== 8 || bytes.readUInt8(25) !== 6 || bytes.readUInt8(28) !== 0) {
      return undefined;
    }

    const chunks: Buffer[] = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }

    const decoded = inflateSync(Buffer.concat(chunks));
    const stride = width * 4;
    const rows: Buffer[] = [];
    let cursor = 0;
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < height; y += 1) {
      const filter = decoded[cursor];
      cursor += 1;
      const raw = decoded.subarray(cursor, cursor + stride);
      cursor += stride;
      const row = Buffer.alloc(stride);
      for (let index = 0; index < stride; index += 1) {
        const left = index >= 4 ? row[index - 4] : 0;
        const up = previous[index];
        const upperLeft = index >= 4 ? previous[index - 4] : 0;
        const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
        if (predictor === undefined) return undefined;
        row[index] = (raw[index] + predictor) & 0xff;
      }
      rows.push(row);
      previous = row;
    }

    return {
      cornerAlpha: rows[0][3],
      centerAlpha: rows[Math.floor(height / 2)][Math.floor(width / 2) * 4 + 3],
    };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Require RGBA dimensions and real alpha samples**

For every iOS splash filename and Android light/night splash path, retain the existing dimension assertion, require `colorType: 6`, and add:

```ts
expect(readPngAlphaSamples(relativePath)).toEqual({cornerAlpha: 0, centerAlpha: 255});
```

- [ ] **Step 5: Run the test and verify RED**

```bash
yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
```

Expected: FAIL because the generator is absent and current splash PNGs use color type 2.

- [ ] **Step 6: Commit the RED test**

```bash
git add apps/mobile/__tests__/native-splash.test.ts
git commit -m "test(mobile): require spaced rounded splash assets"
```

---

### Task 3: Implement the Deterministic Asset Generator

**Files:**
- Create: `apps/mobile/scripts/generate-brand-assets.swift`
- Test: `apps/mobile/__tests__/native-splash.test.ts`

**Interfaces:**
- Consumes: canonical light/dark logo PNGs.
- Produces: `loadImage`, `writePNG`, and `render(source:size:rounded:)`, then all existing platform derivatives.

- [ ] **Step 1: Add exact configuration and image I/O**

```swift
#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO
import QuartzCore
import UniformTypeIdentifiers

enum BrandAssetConfig {
  static let foregroundScale = 0.85
  static let splashCornerRadiusRatio = 0.22
  static let iosSplashSizes = [96, 192, 288]
  static let androidSplashSizes = ["mdpi": 96, "hdpi": 144, "xhdpi": 192, "xxhdpi": 288, "xxxhdpi": 384]
  static let androidLauncherSizes = ["mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192]
}

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let mobileRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()

func loadImage(_ path: String) throws -> CGImage {
  let url = mobileRoot.appendingPathComponent(path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    throw NSError(domain: "BrandAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read \(url.path)"])
  }
  return image
}

func writePNG(_ image: CGImage, to path: String) throws {
  let url = mobileRoot.appendingPathComponent(path)
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "BrandAssets", code: 2)
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "BrandAssets", code: 3) }
}
```

- [ ] **Step 2: Add supersampled continuous-corner RGBA rendering**

```swift
func render(source: CGImage, size: Int, rounded: Bool) throws -> CGImage {
  let supersample = rounded ? 4 : 1
  let renderSize = size * supersample
  guard let context = CGContext(data: nil, width: renderSize, height: renderSize, bitsPerComponent: 8,
    bytesPerRow: renderSize * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    throw NSError(domain: "BrandAssets", code: 4)
  }
  context.setAllowsAntialiasing(true)
  context.setShouldAntialias(true)
  context.interpolationQuality = .high
  if rounded {
    let layer = CALayer()
    layer.frame = CGRect(x: 0, y: 0, width: renderSize, height: renderSize)
    layer.contents = source
    layer.contentsGravity = .resizeAspectFill
    layer.cornerRadius = BrandAssetConfig.splashCornerRadiusRatio * CGFloat(renderSize)
    layer.cornerCurve = .continuous
    layer.masksToBounds = true
    layer.render(in: context)
  } else {
    context.draw(source, in: CGRect(x: 0, y: 0, width: renderSize, height: renderSize))
  }
  guard let rendered = context.makeImage() else { throw NSError(domain: "BrandAssets", code: 5) }
  guard supersample > 1 else { return rendered }

  guard let outputContext = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    throw NSError(domain: "BrandAssets", code: 6)
  }
  outputContext.interpolationQuality = .high
  outputContext.draw(rendered, in: CGRect(x: 0, y: 0, width: size, height: size))
  guard let output = outputContext.makeImage() else { throw NSError(domain: "BrandAssets", code: 7) }
  return output
}
```

- [ ] **Step 3: Add exact output loops**

```swift
let light = try loadImage("src/assets/brand/app-logo-light.png")
let dark = try loadImage("src/assets/brand/app-logo-dark.png")

let iosSplashFiles = [
  (96, "splash-mark.png"),
  (192, "splash-mark@2x.png"),
  (288, "splash-mark@3x.png"),
]
for (size, filename) in iosSplashFiles {
  let directory = "ios/Divenary/Images.xcassets/SplashMark.imageset/"
  try writePNG(try render(source: light, size: size, rounded: true), to: directory + filename)
  try writePNG(try render(source: dark, size: size, rounded: true), to: directory + filename.replacingOccurrences(of: "splash-mark", with: "splash-mark-dark"))
}

try writePNG(try render(source: light, size: 1024, rounded: false),
  to: "ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon.png")
try writePNG(try render(source: dark, size: 1024, rounded: false),
  to: "ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon-dark.png")
try writePNG(try render(source: light, size: 1024, rounded: false),
  to: "ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png")

for (density, size) in BrandAssetConfig.androidSplashSizes {
  try writePNG(try render(source: light, size: size, rounded: true),
    to: "android/app/src/main/res/drawable-\(density)/splash_mark.png")
  try writePNG(try render(source: dark, size: size, rounded: true),
    to: "android/app/src/main/res/drawable-night-\(density)/splash_mark.png")
}

for (density, size) in BrandAssetConfig.androidLauncherSizes {
  for filename in ["ic_launcher.png", "ic_launcher_round.png"] {
    try writePNG(try render(source: light, size: size, rounded: false),
      to: "android/app/src/main/res/mipmap-\(density)/\(filename)")
    try writePNG(try render(source: dark, size: size, rounded: false),
      to: "android/app/src/main/res/mipmap-night-\(density)/\(filename)")
  }
}

print("Generated Divenary brand assets (foregroundScale=\(BrandAssetConfig.foregroundScale), splashCornerRadiusRatio=\(BrandAssetConfig.splashCornerRadiusRatio))")
```

- [ ] **Step 4: Typecheck without generating files**

```bash
swiftc -typecheck apps/mobile/scripts/generate-brand-assets.swift
```

Expected: exit code 0 and no PNG changes.

- [ ] **Step 5: Do not execute before approval**

If Task 1 has no explicit approval, stop without running the script.

- [ ] **Step 6: Commit only the generator**

```bash
git add apps/mobile/scripts/generate-brand-assets.swift
git commit -m "build(mobile): add deterministic brand asset generator"
```

Expected: no PNG is part of this commit.

---

### Task 4: Apply Approved Candidates and Reach GREEN

**Files:**
- Replace: `apps/mobile/src/assets/brand/app-logo-light.png`
- Replace: `apps/mobile/src/assets/brand/app-logo-dark.png`
- Regenerate: all derivative PNGs listed in File Map.
- Test: `apps/mobile/__tests__/native-splash.test.ts`
- Test: `apps/mobile/__tests__/brand-logo.test.tsx`

**Interfaces:**
- Consumes: explicitly approved Task 1 candidates and Task 3 generator.
- Produces: canonical and platform PNGs with stable dimensions and RGBA splash corners.

- [ ] **Step 1: Reconfirm approval immediately before copying**

The conversation must contain explicit approval for both displayed candidate images. If approval is absent or conditional, stop.

- [ ] **Step 2: Copy only approved candidates**

```bash
cp /private/tmp/divenary-logo-spacing-preview/app-logo-light-candidate.png apps/mobile/src/assets/brand/app-logo-light.png
cp /private/tmp/divenary-logo-spacing-preview/app-logo-dark-candidate.png apps/mobile/src/assets/brand/app-logo-dark.png
```

- [ ] **Step 3: Generate platform derivatives**

```bash
swift apps/mobile/scripts/generate-brand-assets.swift
```

Expected: one success line containing `foregroundScale=0.85` and `splashCornerRadiusRatio=0.22`, exit code 0.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/native-splash.test.ts
```

Expected: 2 suites pass with 0 failures.

- [ ] **Step 5: Inspect final splash derivatives**

Display:

```text
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark@3x.png
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark@3x.png
```

Verify that corners are smoothly rounded and transparent, and that both mantas match the approved candidates.

- [ ] **Step 6: Commit approved assets**

```bash
git add apps/mobile/src/assets/brand apps/mobile/ios/Divenary/Images.xcassets apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset apps/mobile/android/app/src/main/res
git commit -m "feat(mobile): refine logo spacing and splash corners"
```

---

### Task 5: Verify Native Resource Pipelines

**Files:**
- Verify only: files changed by Tasks 2–4.

**Interfaces:**
- Consumes: final committed tests, generator, and images.
- Produces: fresh mobile, Android, watchOS, and iOS verification evidence.

- [ ] **Step 1: Run tests and typecheck**

```bash
yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/native-splash.test.ts
yarn mobile:typecheck
```

Expected: both suites pass and TypeScript exits 0.

- [ ] **Step 2: Process Android resources**

```bash
cd apps/mobile/android
./gradlew :app:processDebugResources
```

Expected: `BUILD SUCCESSFUL` with no invalid or duplicate PNG resource error.

- [ ] **Step 3: Build watchOS**

From repository root:

```bash
yarn watch:build
```

Expected: `BUILD SUCCEEDED` for the `DivenaryWatchApp` scheme.

- [ ] **Step 4: Build the full iOS workspace**

```bash
yarn ios:build
```

Expected: `BUILD SUCCEEDED` for the iOS simulator workspace. Report simulator-service warnings separately when exit code is 0.

- [ ] **Step 5: Verify final scope**

```bash
git status --short
git diff --check HEAD~3..HEAD
git log --oneline --decorate -6
```

Expected: no uncommitted files, no whitespace errors, and only design, plan, test, generator, and approved image changes on this feature branch.
