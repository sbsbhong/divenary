# Theme-aware app logo design

## Goal

Apply the two user-provided Divenary manta-ray logos across every existing brand-logo surface:

- React Native login UI
- iOS and Android launch screens
- iPhone and Android installed app icons
- Apple Watch companion installed app icon

The first provided image is the light appearance and the second is the dark appearance. The artwork must remain visually unchanged.

## Canonical assets

Store the original square PNG files as the canonical sources:

- `apps/mobile/src/assets/brand/app-logo-light.png`
- `apps/mobile/src/assets/brand/app-logo-dark.png`

Platform-specific sizes and catalogs are derived from those two files. Derived files are committed because native builds must not depend on a generation step that Metro or Xcode does not run automatically.

## React Native usage

Create a small reusable `BrandLogo` component under `apps/mobile/src/components/brand/`. It selects the canonical light or dark PNG from `useAppPreferences().resolvedTheme`, renders it with `resizeMode="contain"`, and keeps the image decorative by default.

Replace the temporary blue rounded square and `D` text in the login sheet with `BrandLogo`. Preserve the existing 44-point visual footprint and accessibility-hiding behavior so the sheet layout and screen-reader output do not change.

No additional logo placement is added to content-heavy screens. A brand asset is used where identity is expected, not repeated as decoration.

## Native launch screens

Preserve the existing centered 96-point launch mark and light/dark launch backgrounds.

- iOS: update `SplashMark.imageset` with light and dark appearance PNGs at 1x, 2x, and 3x. UIKit's loading view continues to use `UIImage(named: "SplashMark")`, allowing the asset catalog and trait collection to choose the appearance.
- Android: replace the vector `D` mark with bitmap-backed light and `night` drawable resources. Android 24–30 and Android 31+ continue to use the same centered splash resource and select the correct resource from the current system UI mode.

The native launch screen follows the operating-system appearance because React Native preferences are not available before the JavaScript application starts.

## Installed app icons

- iPhone/iPad: populate the existing `AppIcon.appiconset` with all currently declared sizes and light/dark appearance entries supported by the asset catalog.
- Android: generate the existing density-specific regular and round launcher PNGs, with matching `mipmap-night-*` variants. Preserve the manifest resource names.
- Apple Watch: add a watch-owned asset catalog and AppIcon set, add it to the watch target's resource phase, and configure `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` for Debug and Release.

Installed icons follow platform icon-appearance behavior. They cannot follow Divenary's in-app theme preference independently of the operating system or launcher.

## Image processing

Use deterministic resizing from the canonical PNGs:

- preserve the square aspect ratio
- do not crop, recolor, sharpen, redraw, or add platform masks
- use high-quality downsampling
- preserve the opaque background supplied in each source

Apple and Android apply their own icon masks. Source icon files remain square.

## Tests and verification

Follow test-driven development for observable behavior:

1. Extend the login screen test to require a themed image-based brand mark instead of the `D` text.
2. Extend native asset tests to require light/dark source files, appearance declarations, expected native icon files, exact pixel dimensions, and watch target membership.
3. Run the focused tests once before implementation and confirm they fail for the missing feature.
4. Implement the minimal asset/component/native changes.
5. Run the focused tests, then:
   - `yarn mobile:typecheck`
   - `yarn ios:build`
   - `yarn watch:build`
   - the smallest relevant Android resource/build verification available in the repository

If an environment-specific native build cannot run, report it accurately and do not call it passing.

## Scope boundaries

- Do not change the primary theme colors.
- Do not change login behavior, authentication, navigation, sync, or safety-related copy.
- Do not add a new image or UI dependency.
- Do not place the logo on screens that currently have no identity surface.
