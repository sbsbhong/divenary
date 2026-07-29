# Theme-aware App Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every existing Divenary identity surface with the supplied light and dark manta-ray logos across React Native, iOS, Android, and the watchOS companion.

**Architecture:** Keep the two supplied 1024-by-1024 PNGs as canonical assets under the React Native source tree. A focused `BrandLogo` component chooses the canonical image from the resolved in-app theme, while committed native asset catalogs and density-specific files are deterministically resized derivatives. Native splash and installed icon appearance follows the operating system because JavaScript preferences are unavailable there.

**Tech Stack:** React Native 0.85.3, TypeScript, Gluestack UI v4, NativeWind, Jest, iOS/watchOS asset catalogs, Android drawable and mipmap resources, Xcode 26.6.

## Global Constraints

- Preserve the supplied square artwork: no crop, recolor, sharpening, redraw, or added platform mask.
- Keep the existing login mark footprint at 44 points and the native splash mark at 96 points.
- Do not change primary theme colors, authentication, navigation, sync, or safety copy.
- Add no image or UI dependency.
- Keep native derivatives committed so builds require no extra generation step.
- iOS and Android native appearance follows system/platform icon appearance, not Divenary's in-app theme preference.
- Use Yarn 1 workspace commands from the repository root.
- Preserve unrelated `.turbo` and user-owned worktree changes.

---

### Task 1: Canonical Logo Assets and React Native Brand Component

**Files:**

- Create: `apps/mobile/src/assets/brand/app-logo-light.png`
- Create: `apps/mobile/src/assets/brand/app-logo-dark.png`
- Create: `apps/mobile/src/components/brand/brand-logo.tsx`
- Create: `apps/mobile/__tests__/brand-logo.test.tsx`
- Modify: `apps/mobile/src/screens/auth/login-screen.tsx`
- Modify: `apps/mobile/__tests__/auth-screens.test.tsx`

**Interfaces:**

- Consumes: `useAppPreferences(): AppPreferences`, including `resolvedTheme: 'light' | 'dark'`.
- Produces: `BrandLogo(props: { className?: string; testID?: string }): React.JSX.Element`.

- [ ] **Step 1: Materialize and inspect the supplied canonical assets**

Use the first supplied conversation image as `app-logo-light.png` and the second as `app-logo-dark.png`. Preserve each as an opaque square PNG. If the attachment bytes are not directly exposed to the workspace, use the image editing attachment path only to isolate each image without visual changes; do not redraw from a text prompt.

Run:

```bash
file apps/mobile/src/assets/brand/app-logo-{light,dark}.png
sips -g pixelWidth -g pixelHeight -g hasAlpha apps/mobile/src/assets/brand/app-logo-{light,dark}.png
```

Expected: both files are square PNGs with equal width and height. If the supplied files use another square dimension, preserve those canonical originals and create the 1024-by-1024 native icon derivatives with high-quality downsampling.

- [ ] **Step 2: Write the failing themed component test**

Create `apps/mobile/__tests__/brand-logo.test.tsx`:

```tsx
let resolvedTheme: 'light' | 'dark' = 'light';

jest.mock('../src/states/app-preferences', () => ({
  useAppPreferences: () => ({ resolvedTheme }),
}));

import React from 'react';
import { Image as NativeImage } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { BrandLogo } from '../src/components/brand/brand-logo';

describe('BrandLogo', () => {
  test.each(['light', 'dark'] as const)('uses the %s logo for the resolved theme', async theme => {
    resolvedTheme = theme;
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <BrandLogo testID="brand-logo" className="h-11 w-11" />,
      );
    });
    const image = renderer.root.findByType(NativeImage);

    expect(image.props.testID).toBe('brand-logo');
    expect(image.props.source).toEqual(
      theme === 'light'
        ? require('../src/assets/brand/app-logo-light.png')
        : require('../src/assets/brand/app-logo-dark.png'),
    );
    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.accessible).toBe(false);
    expect(image.props.accessibilityElementsHidden).toBe(true);
    expect(image.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(image.props.className).toContain('h-11');
    expect(image.props.className).toContain('w-11');

    await ReactTestRenderer.act(async () => {
      renderer.unmount();
    });
  });
});
```

In `apps/mobile/__tests__/auth-screens.test.tsx`, import `Image as NativeImage` from `react-native` and change the compact sheet assertion to require the brand mark to be a native image and to reject the old `D` text:

```tsx
const brandMark = renderer.root.findByProps({ testID: 'auth-login-brand-mark' });
expect(brandMark.type).toBe(NativeImage);
expect(brandMark.props.className).toContain('h-11');
expect(brandMark.props.className).toContain('w-11');
expect(JSON.stringify(renderer.toJSON())).not.toContain('"children":["D"]');
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/auth-screens.test.tsx
```

Expected: FAIL because `brand-logo.tsx` does not exist and the login screen still renders the temporary `D`.

- [ ] **Step 4: Implement the minimal themed component**

Create `apps/mobile/src/components/brand/brand-logo.tsx`:

```tsx
import React from 'react';

import { Image } from '../ui/image';
import { useAppPreferences } from '../../states/app-preferences';

const logoSources = {
  light: require('../../assets/brand/app-logo-light.png'),
  dark: require('../../assets/brand/app-logo-dark.png'),
} as const;

type BrandLogoProps = {
  className?: string;
  testID?: string;
};

export function BrandLogo({
  className,
  testID = 'brand-logo',
}: BrandLogoProps): React.JSX.Element {
  const { resolvedTheme } = useAppPreferences();

  return (
    <Image
      testID={testID}
      source={logoSources[resolvedTheme]}
      resizeMode="contain"
      size="none"
      className={className}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
```

In `apps/mobile/src/screens/auth/login-screen.tsx`, import `BrandLogo` and replace the temporary mark box:

```tsx
<BrandLogo
  testID="auth-login-brand-mark"
  className="mx-auto h-11 w-11 rounded-xl"
/>
```

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/auth-screens.test.tsx
yarn mobile:typecheck
```

Expected: both commands PASS with no new warnings.

- [ ] **Step 6: Commit the React Native identity surface**

```bash
git add \
  apps/mobile/src/assets/brand/app-logo-light.png \
  apps/mobile/src/assets/brand/app-logo-dark.png \
  apps/mobile/src/components/brand/brand-logo.tsx \
  apps/mobile/src/screens/auth/login-screen.tsx \
  apps/mobile/__tests__/brand-logo.test.tsx \
  apps/mobile/__tests__/auth-screens.test.tsx
git commit -m "feat(mobile): add themed Divenary brand logo"
```

### Task 2: Theme-aware iOS and Android Splash Logo

**Files:**

- Modify: `apps/mobile/__tests__/native-splash.test.ts`
- Modify: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json`
- Replace: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark.png`
- Replace: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark@2x.png`
- Replace: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark@3x.png`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark.png`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark@2x.png`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark@3x.png`
- Delete: `apps/mobile/android/app/src/main/res/drawable/splash_mark.xml`
- Create: `apps/mobile/android/app/src/main/res/drawable-mdpi/splash_mark.png`
- Create: `apps/mobile/android/app/src/main/res/drawable-hdpi/splash_mark.png`
- Create: `apps/mobile/android/app/src/main/res/drawable-xhdpi/splash_mark.png`
- Create: `apps/mobile/android/app/src/main/res/drawable-xxhdpi/splash_mark.png`
- Create: `apps/mobile/android/app/src/main/res/drawable-xxxhdpi/splash_mark.png`
- Create matching files under: `apps/mobile/android/app/src/main/res/drawable-night-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splash_mark.png`

**Interfaces:**

- Consumes: canonical 1024-by-1024 PNG files from Task 1.
- Produces: iOS named image `SplashMark` with luminosity variants and Android drawable resource `@drawable/splash_mark` with `night` variants.

- [ ] **Step 1: Extend the native splash test to require both appearances**

Add a PNG header reader to `apps/mobile/__tests__/native-splash.test.ts`:

```ts
function readPngDimensions(path: string): { width: number; height: number } | undefined {
  try {
    const bytes = readFileSync(resolve(process.cwd(), path));
    if (bytes.toString('ascii', 1, 4) !== 'PNG') {
      return undefined;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {
    return undefined;
  }
}
```

Require six iOS entries, with dark entries carrying:

```ts
appearances: [{ appearance: 'luminosity', value: 'dark' }]
```

Require light and `drawable-night-*` Android files at pixel sizes:

```ts
const androidSplashSizes = {
  mdpi: 96,
  hdpi: 144,
  xhdpi: 192,
  xxhdpi: 288,
  xxxhdpi: 384,
};
```

Assert that each PNG exists, has the expected square dimensions, and that `drawable/splash_mark.xml` no longer exists.

- [ ] **Step 2: Run the splash test and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
```

Expected: FAIL because the dark iOS images and Android bitmap resources do not exist.

- [ ] **Step 3: Generate deterministic splash derivatives**

From `apps/mobile`, run `sips -z HEIGHT WIDTH SOURCE --out DESTINATION` for:

```text
iOS light: 96, 192, 288
iOS dark:  96, 192, 288
Android light/dark: 96, 144, 192, 288, 384
```

Update `SplashMark.imageset/Contents.json` so every light entry is followed by a dark luminosity entry at the same scale. Keep the existing `LaunchScreen.storyboard`, `AppDelegate.swift`, `launch_screen.xml`, and Android 31 theme resource names unchanged.

- [ ] **Step 4: Run the splash test and native asset compiler check**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
xcrun actool \
  apps/mobile/ios/Divenary/Images.xcassets \
  --compile /private/tmp/divenary-logo-actool \
  --platform iphonesimulator \
  --minimum-deployment-target 15.1 \
  --app-icon AppIcon \
  --output-format human-readable-text \
  --warnings --notices
```

Expected: Jest PASS. `actool` exits 0; the still-empty AppIcon warnings are resolved by Task 3, so do not treat them as final verification yet.

- [ ] **Step 5: Commit the native splash assets**

```bash
git add \
  apps/mobile/__tests__/native-splash.test.ts \
  apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset \
  apps/mobile/android/app/src/main/res
git commit -m "feat(mobile): theme native splash logo"
```

### Task 3: iOS, Android, and watchOS Installed Icons

**Files:**

- Modify: `apps/mobile/__tests__/native-splash.test.ts`
- Modify: `apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset/Contents.json`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon.png`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon-dark.png`
- Replace: `apps/mobile/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`
- Replace: `apps/mobile/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_round.png`
- Create matching regular and round files under: `apps/mobile/android/app/src/main/res/mipmap-night-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/`
- Create: `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/Contents.json`
- Create: `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/Contents.json`
- Create: `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png`
- Modify: `apps/mobile/ios/Divenary.xcodeproj/project.pbxproj`

**Interfaces:**

- Consumes: canonical light and dark PNGs from Task 1.
- Produces: iOS `AppIcon`, Android `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`, and watchOS `AppIcon`.

- [ ] **Step 1: Write failing native icon assertions**

Add assertions to `apps/mobile/__tests__/native-splash.test.ts` for:

```ts
const iosAppIconContents = JSON.parse(
  readMobileFile('ios/Divenary/Images.xcassets/AppIcon.appiconset/Contents.json'),
);
expect(iosAppIconContents.images).toEqual([
  {
    filename: 'app-icon.png',
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  },
  {
    appearances: [{ appearance: 'luminosity', value: 'dark' }],
    filename: 'app-icon-dark.png',
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  },
]);
```

Require Android icon sizes `48, 72, 96, 144, 192` in normal and `night` mipmap directories. Require both regular and round names, but keep the source artwork square because Android applies the launcher mask.

Require the watch asset catalog, its 1024-by-1024 dark artwork, `Assets.xcassets in Resources`, and these watch Debug/Release settings:

```text
ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
```

- [ ] **Step 2: Run the native test and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
```

Expected: FAIL because iOS AppIcon filenames, Android night icons, and the watch asset catalog do not exist.

- [ ] **Step 3: Populate iOS and Android icons**

Copy the canonical 1024 files without modification into the iOS AppIcon set and use the exact two-entry Xcode 26 universal `Contents.json` asserted above.

Generate Android light and dark sizes:

```text
mdpi 48, hdpi 72, xhdpi 96, xxhdpi 144, xxxhdpi 192
```

For each appearance and density, write identical bytes to `ic_launcher.png` and `ic_launcher_round.png`; the launcher, not the source file, owns masking.

- [ ] **Step 4: Add the watch asset catalog to the watch target**

Create `apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/Contents.json`:

```json
{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
```

Create a watch `AppIcon.appiconset/Contents.json` with one universal watchOS 1024 entry:

```json
{
  "images" : [
    {
      "filename" : "app-icon.png",
      "idiom" : "universal",
      "platform" : "watchos",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
```

Use the dark canonical logo for the watch icon because the watchOS app launcher is a dark surface. Add `Assets.xcassets` as a file reference under the `DivenaryWatchApp` group, add it to the watch Resources build phase, and set `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` in both watch build configurations.

- [ ] **Step 5: Run asset and target verification**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/native-splash.test.ts
xcrun actool \
  apps/mobile/ios/Divenary/Images.xcassets \
  --compile /private/tmp/divenary-logo-actool \
  --platform iphonesimulator \
  --minimum-deployment-target 15.1 \
  --app-icon AppIcon \
  --output-format human-readable-text \
  --warnings --notices
yarn watch:build
```

Expected: all commands PASS, the phone asset catalog has no missing AppIcon warning, and the watch target compiles its AppIcon.

- [ ] **Step 6: Commit installed icons**

```bash
git add \
  apps/mobile/__tests__/native-splash.test.ts \
  apps/mobile/ios/Divenary/Images.xcassets/AppIcon.appiconset \
  apps/mobile/ios/DivenaryWatchApp/Assets.xcassets \
  apps/mobile/ios/Divenary.xcodeproj/project.pbxproj \
  apps/mobile/android/app/src/main/res
git commit -m "feat(mobile): install Divenary icons on every target"
```

### Task 4: Full Verification and Visual Inspection

**Files:**

- Modify only if a verification failure identifies a defect in a file already listed above.

**Interfaces:**

- Consumes: all React Native and native assets from Tasks 1–3.
- Produces: verified theme-aware branding with no new runtime dependency.

- [ ] **Step 1: Run the focused and mobile gates**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/brand-logo.test.tsx __tests__/auth-screens.test.tsx __tests__/native-splash.test.ts
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 2: Run native build gates**

Run:

```bash
yarn ios:build
yarn watch:build
```

Expected: PASS. If CocoaPods, simulator services, or local signing prevents a build, record the exact environmental failure and do not report the command as passing.

- [ ] **Step 3: Run the available Android resource build**

From `apps/mobile/android`, run:

```bash
./gradlew :app:processDebugResources
```

Expected: `BUILD SUCCESSFUL`, proving all normal and `night` resource names resolve.

- [ ] **Step 4: Inspect representative generated images**

Open and compare:

```text
apps/mobile/src/assets/brand/app-logo-light.png
apps/mobile/src/assets/brand/app-logo-dark.png
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark@3x.png
apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark-dark@3x.png
apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
apps/mobile/android/app/src/main/res/mipmap-night-xxxhdpi/ic_launcher.png
apps/mobile/ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png
```

Expected: the manta artwork, gradient, white body, eye, and fin shadow match the supplied source at every size; no crop or unintended transparent border appears.

- [ ] **Step 5: Check repository scope and commit any verification-only correction**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only planned branding files and the pre-existing `.turbo` cache change are present. If verification required a correction, stage only the planned file and commit:

```bash
git commit -m "fix(mobile): finalize themed logo assets"
```
