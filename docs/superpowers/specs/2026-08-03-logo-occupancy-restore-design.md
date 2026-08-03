# Logo Occupancy Restore Design

## Goal

Restore the light and dark Divenary manta logos to the exact large-occupancy images that existed before the 85% spacing refinement, while preserving the current iOS-style continuous corner smoothing on splash assets.

## Approved Direction

Use the exact canonical PNG blobs from commit `14b9d75` rather than resizing, cropping, or regenerating the manta artwork.

- Light canonical blob: `5a5eb21bcb739897e84158244407a5988d95d201`
- Dark canonical blob: `c4a76b743a18eb835706aa83c4ec8b8505aecb95`
- Light path: `apps/mobile/src/assets/brand/app-logo-light.png`
- Dark path: `apps/mobile/src/assets/brand/app-logo-dark.png`

This makes the restoration byte-for-byte exact and avoids interpolation, changed gradients, or altered manta geometry.

## Asset Behavior

The restored large canonical logos are the source for every branded raster asset:

- in-app light and dark logo images
- iOS light and dark app icons
- Android light and dark launcher and round icons
- watchOS app icon
- iOS and Android light and dark splash marks

App and watch icons retain their platform-managed outer icon shape. Splash marks retain the generator's explicit continuous rounded mask.

## Splash Smoothing

The existing splash treatment remains unchanged:

- corner radius ratio: `0.22`
- `CALayer.cornerCurve = .continuous`
- four-times supersampled rendering followed by high-quality downsampling
- transparent PNG corners
- opaque center pixel

Only the source logo occupancy changes. Splash dimensions, launch-screen layout, light/dark backgrounds, and fade behavior remain unchanged.

## Generator Cleanup

The generator currently reports `foregroundScale = 0.85`, but the value does not participate in rendering; the smaller occupancy is baked into the canonical PNGs. Remove this misleading scale configuration and output text. Canonical source selection becomes the single source of truth for logo occupancy.

## Regression Protection

Tests will verify both requirements independently:

1. The canonical light and dark files match the approved pre-refinement Git blob content.
2. Splash generation still declares the 22% continuous corner curve and four-times supersampling.
3. Generated splash PNGs retain transparent corners and an opaque center.
4. Expected iOS, Android, and watch icon outputs remain present at their required dimensions.

The test must fail against the current smaller canonical images before restoration and pass after the exact blobs are restored and derivatives regenerated.

## Scope and Safety

No application behavior, navigation, sync, account data, Supabase schema, watch recording behavior, or safety-related logic changes. Existing unrelated Turbo cache changes and other worktrees remain untouched.

## Verification

Run the smallest relevant gates first, then platform checks:

- focused brand and native splash Jest tests
- mobile TypeScript typecheck
- Android debug resource processing
- watchOS build
- iOS simulator build when the CocoaPods workspace is available

