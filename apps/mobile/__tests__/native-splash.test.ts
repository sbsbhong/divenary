import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readMobileFile(relativePath: string): string {
  try {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  } catch {
    return '';
  }
}

describe('native splash screen', () => {
  test('centers one 96 by 96 mark in the iOS launch storyboard', () => {
    const storyboard = readMobileFile('ios/Divenary/LaunchScreen.storyboard');
    const iosMarkContents = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json');
    const iosBackground = readMobileFile('ios/Divenary/Images.xcassets/SplashBackground.colorset/Contents.json');
    const iosMarkDirectory = resolve(process.cwd(), 'ios/Divenary/Images.xcassets/SplashMark.imageset');
    const iosMarkImages = [
      { filename: 'splash-mark.png', scale: '1x' },
      { filename: 'splash-mark@2x.png', scale: '2x' },
      { filename: 'splash-mark@3x.png', scale: '3x' },
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
      iosMarkImages.map(({ filename, scale }) => ({ filename, idiom: 'universal', scale })),
    );
    for (const { filename } of iosMarkImages) {
      expect(existsSync(resolve(iosMarkDirectory, filename))).toBe(true);
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
    const androidMark = readMobileFile('android/app/src/main/res/drawable/splash_mark.xml');
    const androidTheme = readMobileFile('android/app/src/main/res/values/styles.xml');
    const androidColors = readMobileFile('android/app/src/main/res/values/colors.xml');
    const androidNightColors = readMobileFile('android/app/src/main/res/values-night/colors.xml');

    expect(androidLaunchScreen).toContain('<layer-list');
    expect(androidLaunchScreen).toContain('android:drawable="@color/splash_background"');
    expect(androidLaunchScreen).toContain('android:width="96dp"');
    expect(androidLaunchScreen).toContain('android:height="96dp"');
    expect(androidLaunchScreen).toContain('android:drawable="@drawable/splash_mark"');
    expect(androidLaunchScreen).toContain('android:gravity="center"');
    expect(androidMark).toContain('android:width="96dp"');
    expect(androidMark).toContain('android:height="96dp"');
    expect(androidMark).toContain('#0066CC');
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
