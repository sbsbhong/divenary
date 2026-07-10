const readRepoFile = (path: string) => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

  return fs.readFileSync(`${cwd}/../../${path}`, 'utf8');
};

describe('Reverse geocoder native source contract', () => {
  it('exposes a typed React Native wrapper with native-module fallback behavior', () => {
    const wrapper = readRepoFile('apps/mobile/src/native/reverse-geocoder.ts');

    expect(wrapper).toContain('type ReverseGeocodedPlace');
    expect(wrapper).toContain('ReverseGeocoderModule');
    expect(wrapper).toContain('isReverseGeocoderAvailable');
    expect(wrapper).toContain('reverseGeocodeCoordinates');
    expect(wrapper).toContain('formatReverseGeocodedCity');
    expect(wrapper).toContain('subAdministrativeArea');
    expect(wrapper).toContain('administrativeArea');
  });

  it('uses CLGeocoder on iOS and includes the bridge in the DiveMobile target', () => {
    const module = readRepoFile('apps/mobile/ios/DiveMobile/ReverseGeocoderModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/DiveMobile/ReverseGeocoderModuleBridge.m');
    const project = readRepoFile('apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj');

    expect(module).toContain('import CoreLocation');
    expect(module).toContain('@objc(ReverseGeocoderModule)');
    expect(module).toContain('CLGeocoder');
    expect(module).toContain('reverseGeocodeLocation');
    expect(module).toContain('placemark.locality');
    expect(module).toContain('placemark.subAdministrativeArea');
    expect(module).toContain('placemark.administrativeArea');
    expect(bridge).toContain('RCT_EXTERN_MODULE(ReverseGeocoderModule, NSObject)');
    expect(bridge).toContain('reverseGeocode');
    expect(project).toContain('ReverseGeocoderModule.swift in Sources');
    expect(project).toContain('ReverseGeocoderModuleBridge.m in Sources');
  });

  it('uses Android Geocoder and registers the package manually', () => {
    const module = readRepoFile('apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderModule.kt');
    const packageFile = readRepoFile('apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderPackage.kt');
    const mainApplication = readRepoFile('apps/mobile/android/app/src/main/java/com/divemobile/MainApplication.kt');

    expect(module).toContain('android.location.Geocoder');
    expect(module).toContain('class ReverseGeocoderModule');
    expect(module).toContain('getFromLocation');
    expect(module).toContain('address.locality');
    expect(module).toContain('address.subAdminArea');
    expect(module).toContain('address.adminArea');
    expect(packageFile).toContain('class ReverseGeocoderPackage');
    expect(packageFile).toContain('ReverseGeocoderModule');
    expect(mainApplication).toContain('add(ReverseGeocoderPackage())');
  });
});

export {};
