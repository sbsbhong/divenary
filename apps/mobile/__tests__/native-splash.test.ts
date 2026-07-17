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
  test('uses the same minimal Divenary splash language on iOS and Android', () => {
    const storyboard = readMobileFile('ios/Divenary/LaunchScreen.storyboard');
    const iosMark = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark.svg');
    const iosMarkContents = readMobileFile('ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json');
    const iosBackground = readMobileFile('ios/Divenary/Images.xcassets/SplashBackground.colorset/Contents.json');
    const androidMark = readMobileFile('android/app/src/main/res/drawable/splash_mark.xml');
    const androidTheme = readMobileFile('android/app/src/main/res/values/styles.xml');
    const android31Theme = readMobileFile('android/app/src/main/res/values-v31/styles.xml');

    expect(storyboard).toContain('image="SplashMark"');
    expect(storyboard).toContain('name="SplashBackground"');
    expect(storyboard).not.toContain('systemGroupedBackgroundColor');
    expect(storyboard).not.toContain('Powered by React Native');
    expect(iosMarkContents).toContain('splash-mark.svg');
    expect(iosMark).toContain('#0066CC');
    expect(iosBackground).toContain('0.960784');
    expect(iosBackground).toContain('"value" : "dark"');
    expect(androidMark).toContain('#0066CC');
    expect(androidTheme).toContain('@drawable/launch_screen');
    expect(android31Theme).toContain('android:windowSplashScreenAnimatedIcon');
    expect(android31Theme).toContain('@drawable/splash_mark');
  });
});
