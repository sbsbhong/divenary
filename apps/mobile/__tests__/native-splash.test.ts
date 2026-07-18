import { readFileSync } from 'node:fs';
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
    const iosMark = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark.svg');
    const iosMarkContents = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json');
    const iosBackground = readMobileFile('ios/Divenary/Images.xcassets/SplashBackground.colorset/Contents.json');

    expect(storyboard).toContain('image="SplashMark"');
    expect(storyboard).toContain('firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX"');
    expect(storyboard).toContain('firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY"');
    expect(storyboard).toContain('firstAttribute="width" constant="96"');
    expect(storyboard).toContain('firstAttribute="height" constant="96"');
    expect(storyboard).toContain('<image name="SplashMark" width="96" height="96"/>');
    expect(storyboard).toContain('name="SplashBackground"');
    expect(storyboard).not.toContain('systemGroupedBackgroundColor');
    expect(iosMarkContents).toContain('splash-mark.svg');
    expect(iosMark).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"');
    expect(iosMark).toContain('#0066CC');
    expect(iosBackground).toContain('0.960784');
    expect(iosBackground).toContain('"value" : "dark"');
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
