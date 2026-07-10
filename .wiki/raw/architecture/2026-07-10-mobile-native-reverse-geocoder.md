Source URL: user instruction and repository paths
Collected: 2026-07-10
Published: Unknown

# Mobile native reverse geocoder implementation

사용자 결정:

- 대한민국 수원에서 위치 동의를 이미 받은 상태인데 Home 조건 band가 Open-Meteo timezone 기반 `Seoul`을 표시한다.
- `@react-native-community/geolocation`은 좌표 획득에 계속 사용한다.
- reverse geocoding은 새 npm native package를 추가하지 않고, repo-local iOS/Android native module로 구현한다.
- 구현에 추가한 module 설계를 wiki에 남긴다.

구현 source:

- `apps/mobile/src/native/reverse-geocoder.ts`: React Native `NativeModules.ReverseGeocoderModule` typed wrapper. Native module이 없거나 빈 결과면 `undefined`를 반환할 수 있다.
- `apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts`: Open-Meteo weather/marine response는 유지하고, native reverse geocoder 결과의 `cityName`을 timezone city보다 우선한다. 실패 시 Open-Meteo timezone fallback을 유지한다.
- `apps/mobile/ios/DiveMobile/ReverseGeocoderModule.swift`: iOS `CoreLocation.CLGeocoder` 기반 reverse geocoder. `locality`, `subAdministrativeArea`, `administrativeArea`, `country`를 반환하고 `cityName`은 locality, sub-administrative area, administrative area 순서로 고른다.
- `apps/mobile/ios/DiveMobile/ReverseGeocoderModuleBridge.m`: React Native Objective-C bridge export.
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`: `DiveMobile` iPhone target source membership에 reverse geocoder Swift/bridge 파일을 추가한다.
- `apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderModule.kt`: Android platform `android.location.Geocoder` 기반 reverse geocoder. JS thread 밖에서 실행하고 같은 field shape을 반환한다.
- `apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderPackage.kt`: repo-local React Native package.
- `apps/mobile/android/app/src/main/java/com/divemobile/MainApplication.kt`: autolink 대상이 아닌 repo-local package로 `ReverseGeocoderPackage()`를 수동 등록한다.
- `apps/mobile/__tests__/home-conditions-provider.test.ts`: native reverse geocoded city 우선순위와 fallback 동작을 검증한다.
- `apps/mobile/__tests__/reverse-geocoder-native-source.test.ts`: iOS/Android native module source와 target/package 등록을 source contract로 검증한다.

경계:

- 새 npm dependency는 추가하지 않았다.
- 위치 권한과 좌표 획득은 기존 `@react-native-community/geolocation` 책임이다.
- Open-Meteo는 날씨/해양 API provider로 남는다. 도시명은 native reverse geocoder가 우선이고, native module 실패 또는 미지원 환경에서는 Open-Meteo timezone city로 fallback한다.
- 이 기능은 Home 표시용 위치 label이며 dive suitability, tide/current/weather warning, route planning, safety recommendation을 제공하지 않는다.
