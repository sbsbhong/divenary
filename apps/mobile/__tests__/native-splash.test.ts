import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

function readMobileFile(relativePath: string): string {
  try {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  } catch {
    return '';
  }
}

function readPngMetadata(
  relativePath: string,
): { width: number; height: number; colorType: number } | undefined {
  try {
    const bytes = readFileSync(resolve(process.cwd(), relativePath));

    if (bytes.toString('ascii', 1, 4) !== 'PNG') {
      return undefined;
    }

    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      colorType: bytes.readUInt8(25),
    };
  } catch {
    return undefined;
  }
}

function readPngDimensions(relativePath: string): { width: number; height: number } | undefined {
  const metadata = readPngMetadata(relativePath);
  return metadata && { width: metadata.width, height: metadata.height };
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readPngAlphaSamples(
  relativePath: string,
): { cornerAlpha: number; centerAlpha: number } | undefined {
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

      if (type === 'IDAT') {
        chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      }

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
        const predictor = [
          0,
          left,
          up,
          Math.floor((left + up) / 2),
          paeth(left, up, upperLeft),
        ][filter];

        if (predictor === undefined) {
          return undefined;
        }

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

describe('native splash screen', () => {
  test('keeps the approved logo and splash geometry in the asset generator', () => {
    const generator = readMobileFile('scripts/generate-brand-assets.swift');

    expect(generator).toContain('static let foregroundScale = 0.85');
    expect(generator).toContain('static let splashCornerRadiusRatio = 0.22');
    expect(generator).toContain('splashCornerRadiusRatio * CGFloat(renderSize)');
    expect(generator).toContain('let supersample = rounded ? 4 : 1');
    expect(generator).toContain('layer.cornerCurve = .continuous');
  });

  test('centers one 96 by 96 mark in the iOS launch storyboard', () => {
    const storyboard = readMobileFile('ios/Divenary/LaunchScreen.storyboard');
    const iosMarkContents = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json');
    const iosBackground = readMobileFile('ios/Divenary/Images.xcassets/SplashBackground.colorset/Contents.json');
    const iosMarkDirectory = resolve(process.cwd(), 'ios/Divenary/Images.xcassets/SplashMark.imageset');
    const iosMarkImages = [
      { filename: 'splash-mark.png', scale: '1x' },
      {
        appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: 'splash-mark-dark.png',
        scale: '1x',
      },
      { filename: 'splash-mark@2x.png', scale: '2x' },
      {
        appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: 'splash-mark-dark@2x.png',
        scale: '2x',
      },
      { filename: 'splash-mark@3x.png', scale: '3x' },
      {
        appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: 'splash-mark-dark@3x.png',
        scale: '3x',
      },
    ];

    expect(storyboard).toContain('image="SplashMark"');
    expect(storyboard).toContain('firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX"');
    expect(storyboard).toContain('firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY"');
    expect(storyboard).toContain('firstAttribute="width" constant="96"');
    expect(storyboard).toContain('firstAttribute="height" constant="96"');
    expect(storyboard).toContain('<image name="SplashMark" width="96" height="96"/>');
    expect(storyboard).toContain('name="SplashBackground"');
    expect(storyboard).not.toContain('systemGroupedBackgroundColor');
    expect(JSON.parse(iosMarkContents).images).toEqual(
      iosMarkImages.map(image => ({ ...image, idiom: 'universal' })),
    );
    for (const { filename, scale } of iosMarkImages) {
      const relativePath = `ios/Divenary/Images.xcassets/SplashMark.imageset/${filename}`;
      const multiplier = Number.parseInt(scale, 10);

      expect(existsSync(resolve(iosMarkDirectory, filename))).toBe(true);
      expect(readPngMetadata(relativePath)).toEqual({
        width: 96 * multiplier,
        height: 96 * multiplier,
        colorType: 6,
      });
      expect(readPngAlphaSamples(relativePath)).toEqual({
        cornerAlpha: 0,
        centerAlpha: 255,
      });
    }
    expect(iosMarkContents).not.toContain('.svg');
    expect(iosMarkContents).not.toContain('preserves-vector-representation');
    expect(iosBackground).toContain('0.960784');
    expect(iosBackground).toContain('"value" : "dark"');
  });

  test('keeps the iOS splash visible while the React Native root is loading', () => {
    const appDelegate = readMobileFile('ios/Divenary/AppDelegate.swift');

    expect(appDelegate).toContain('override func customize(_ rootView: RCTRootView)');
    expect(appDelegate).toContain('UIColor { traitCollection in');
    expect(appDelegate).toContain('traitCollection.userInterfaceStyle == .dark');
    expect(appDelegate).toContain('return .black');
    expect(appDelegate).toContain('red: 245.0 / 255.0');
    expect(appDelegate).toContain('green: 245.0 / 255.0');
    expect(appDelegate).toContain('blue: 247.0 / 255.0');
    expect(appDelegate).toContain('UIImage(named: "SplashMark")');
    expect(appDelegate).toContain('loadingView.autoresizingMask = [.flexibleWidth, .flexibleHeight]');
    expect(appDelegate).toContain('loadingView.isUserInteractionEnabled = false');
    expect(appDelegate).toContain('markView.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor)');
    expect(appDelegate).toContain('markView.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor)');
    expect(appDelegate).toContain('markView.widthAnchor.constraint(equalToConstant: 96)');
    expect(appDelegate).toContain('markView.heightAnchor.constraint(equalToConstant: 96)');
    expect(appDelegate).toContain('rootView.backgroundColor = splashBackgroundColor');
    expect(appDelegate).toContain('rootView.loadingView = loadingView');
    expect(appDelegate).toContain('rootView.loadingViewFadeDelay = 0');
    expect(appDelegate).toContain('rootView.loadingViewFadeDuration = 0.2');
    expect(appDelegate).not.toMatch(/asyncAfter|Timer\.scheduledTimer|sleep\(/);
  });

  test('uses a centered mark and the correct light and night backgrounds on Android 24 through 30', () => {
    const androidLaunchScreen = readMobileFile('android/app/src/main/res/drawable/launch_screen.xml');
    const androidTheme = readMobileFile('android/app/src/main/res/values/styles.xml');
    const androidColors = readMobileFile('android/app/src/main/res/values/colors.xml');
    const androidNightColors = readMobileFile('android/app/src/main/res/values-night/colors.xml');
    const androidSplashSizes = {
      mdpi: 96,
      hdpi: 144,
      xhdpi: 192,
      xxhdpi: 288,
      xxxhdpi: 384,
    };

    expect(androidLaunchScreen).toContain('<layer-list');
    expect(androidLaunchScreen).toContain('android:drawable="@color/splash_background"');
    expect(androidLaunchScreen).toContain('android:width="96dp"');
    expect(androidLaunchScreen).toContain('android:height="96dp"');
    expect(androidLaunchScreen).toContain('android:drawable="@drawable/splash_mark"');
    expect(androidLaunchScreen).toContain('android:gravity="center"');
    expect(existsSync(resolve(process.cwd(), 'android/app/src/main/res/drawable/splash_mark.xml'))).toBe(false);
    for (const [density, size] of Object.entries(androidSplashSizes)) {
      const lightPath = `android/app/src/main/res/drawable-${density}/splash_mark.png`;
      const darkPath = `android/app/src/main/res/drawable-night-${density}/splash_mark.png`;

      for (const relativePath of [lightPath, darkPath]) {
        expect(readPngMetadata(relativePath)).toEqual({
          width: size,
          height: size,
          colorType: 6,
        });
        expect(readPngAlphaSamples(relativePath)).toEqual({
          cornerAlpha: 0,
          centerAlpha: 255,
        });
      }
    }
    expect(androidColors).toContain('<color name="splash_background">#F5F5F7</color>');
    expect(androidNightColors).toContain('<color name="splash_background">#000000</color>');
    expect(androidTheme).toContain('@drawable/launch_screen');
  });

  test('uses Android 31 system splash configuration without application-visible copy', () => {
    const storyboard = readMobileFile('ios/Divenary/LaunchScreen.storyboard');
    const androidLaunchScreen = readMobileFile('android/app/src/main/res/drawable/launch_screen.xml');
    const androidMark = readMobileFile('android/app/src/main/res/drawable/splash_mark.xml');
    const android31Theme = readMobileFile('android/app/src/main/res/values-v31/styles.xml');

    for (const source of [storyboard, androidLaunchScreen, androidMark, android31Theme]) {
      expect(source).not.toContain('Powered by React Native');
      expect(source).not.toMatch(/<text\b/i);
      expect(source).not.toContain('android:text=');
    }
    expect(storyboard).not.toMatch(/<label\b/i);

    expect(android31Theme).toContain('android:windowSplashScreenBackground">@color/splash_background');
    expect(android31Theme).toContain('android:windowSplashScreenAnimatedIcon');
    expect(android31Theme).toContain('@drawable/splash_mark');
    expect(android31Theme).toContain('android:windowSplashScreenIconBackgroundColor">@color/splash_background');
    expect(android31Theme).toContain('android:windowSplashScreenAnimationDuration">500</item>');
  });
});

describe('native installed app icons', () => {
  test('uses light and dark universal iOS app icons', () => {
    const contents = JSON.parse(
      readMobileFile('ios/Divenary/Images.xcassets/AppIcon.appiconset/Contents.json'),
    );

    expect(contents.images).toEqual([
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
    expect(
      readPngDimensions('ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon.png'),
    ).toEqual({ width: 1024, height: 1024 });
    expect(
      readPngDimensions('ios/Divenary/Images.xcassets/AppIcon.appiconset/app-icon-dark.png'),
    ).toEqual({ width: 1024, height: 1024 });
  });

  test('uses light and dark Android launcher icons at every density', () => {
    const launcherSizes = {
      mdpi: 48,
      hdpi: 72,
      xhdpi: 96,
      xxhdpi: 144,
      xxxhdpi: 192,
    };

    for (const [density, size] of Object.entries(launcherSizes)) {
      for (const appearance of ['', '-night']) {
        for (const filename of ['ic_launcher.png', 'ic_launcher_round.png']) {
          expect(
            readPngDimensions(
              `android/app/src/main/res/mipmap${appearance}-${density}/${filename}`,
            ),
          ).toEqual({ width: size, height: size });
        }
      }
    }
  });

  test('owns a dark watchOS app icon in the watch target', () => {
    const watchContents = JSON.parse(
      readMobileFile(
        'ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/Contents.json',
      ),
    );
    const accentContents = JSON.parse(
      readMobileFile(
        'ios/DivenaryWatchApp/Assets.xcassets/AccentColor.colorset/Contents.json',
      ),
    );
    const project = readMobileFile('ios/Divenary.xcodeproj/project.pbxproj');

    expect(watchContents.images).toEqual([
      {
        filename: 'app-icon.png',
        idiom: 'universal',
        platform: 'watchos',
        size: '1024x1024',
      },
    ]);
    expect(
      readPngDimensions(
        'ios/DivenaryWatchApp/Assets.xcassets/AppIcon.appiconset/app-icon.png',
      ),
    ).toEqual({ width: 1024, height: 1024 });
    expect(accentContents.colors[0].color.components).toEqual({
      alpha: '1.000',
      blue: '1.000000',
      green: '0.592157',
      red: '0.160784',
    });
    expect(project).toContain('A90000000000000000000002 /* Assets.xcassets */');
    expect(project).toContain('Assets.xcassets in Resources');
    expect(project.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g)).toHaveLength(4);
  });
});
