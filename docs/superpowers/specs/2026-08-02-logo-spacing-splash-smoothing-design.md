# Logo Spacing and Splash Smoothing Design

## Goal

Refine the existing light and dark Divenary logo artwork so the manta ray has more breathing room, then make the splash-screen tile use smooth continuous-style corners on iOS and Android.

The intended visual result is:

- keep the existing square canvas, blue backgrounds, gradient character, and manta artwork;
- scale only the manta artwork to 85% of its current visual size, centered in the same canvas;
- leave installed app-icon masking to each operating system;
- give only the splash-screen tile a rounded, anti-aliased boundary.

## Scope

The approved logo is used consistently by:

- the React Native `BrandLogo` shown on the login surface;
- iOS and Android installed app icons, including light and dark variants;
- the watchOS installed app icon;
- the iOS launch storyboard and React Native loading view;
- Android 24–30 launch background resources;
- the Android 31+ system splash icon.

No navigation, authentication, product wording, sync behavior, or safety behavior changes are included.

## Asset Treatment

### Canonical light and dark logos

The canonical 1254×1254 light and dark logo files remain square and preserve their existing background colors and gradients. The manta ray is reduced to 85% around its visual center. Its silhouette, eye position, fold shading, white balance, and orientation must remain recognizable as the same artwork rather than a redraw.

The change increases clear space around the manta without shrinking the blue tile when it is displayed. Installed app icons receive this spacing change but do not receive baked rounded corners because iOS, Android, and watchOS apply their own icon masks.

### Splash-specific tile

Splash assets are derived from the approved canonical logos at every existing density. They keep the current 96-point/96-dp logical size and use a corner radius equal to 22% of the tile width. The edge is rendered at high resolution and downsampled so the transparent corner transition is anti-aliased. Transparent corner pixels reveal the existing light or dark splash background.

The rounded boundary is baked into the splash raster instead of relying on runtime view-layer configuration. This keeps the launch storyboard, React Native loading view, Android legacy launch background, and Android system splash visually aligned.

## Mandatory Preview Approval Gate

Image generation is split from repository application:

1. Generate candidate light and dark full-resolution logo images outside tracked repository paths.
2. Show both candidates to the user before replacing any canonical or derived asset.
3. If requested, revise and show the candidates again.
4. Only after explicit approval, copy the approved candidates into the repository and generate platform derivatives.

Until step 4 is approved, no tracked PNG is replaced and no platform resource points at a candidate image.

## Implementation Approach

Use the approved image candidates as the canonical light and dark sources. A small deterministic Swift/Core Graphics asset-generation script will produce platform-sized PNG derivatives, apply the splash-only corner mask with high-quality interpolation, and avoid new package dependencies.

Existing resource names and platform wiring remain unchanged. This minimizes native project changes and preserves the current theme selection behavior.

## Verification

Development follows a red-green test cycle:

- extend native splash regression tests first so they require alpha-capable rounded splash PNGs, transparent outer corners, an opaque center, and all existing density dimensions;
- add a regression assertion for the 85% canonical foreground scale in the deterministic asset generator configuration;
- run the focused logo and native splash tests;
- run mobile TypeScript checking;
- process Android debug resources;
- run the watchOS simulator build;
- run the full iOS simulator build when the CocoaPods workspace is available.

Visual verification includes showing the light and dark candidate images before application and inspecting the final rounded splash assets after generation.

## Failure Handling

- If a generated candidate changes the manta silhouette, shading, theme color, or orientation beyond the requested scale change, reject it and regenerate before repository application.
- If platform resource processing changes the logical 96-point/96-dp splash size, retain the current layout configuration and correct only the raster derivative.
- If a platform build failure is environmental, report it separately from compile or resource failures.
