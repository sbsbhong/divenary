Source URL: user bug report, 2026-07-09; apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift; apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift
Collected: 2026-07-09
Published: Unknown

# Watch session file storage

이 source는 2026-07-09 watch session 저장소가 `UserDefaults` record blob에서 파일 기반 JSON 저장으로 이동한 이유와 검증 사실을 보존한다.

관련 source path:

- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`

문제:

- watchOS의 CFPreferences/NSUserDefaults는 이 플랫폼에서 1MB 이상 data 저장을 invalid로 처리할 수 있다.
- `UserDefaults.set`은 Swift throwing API가 아니므로 `do/catch`로 보호할 수 없다.
- `DiveSessionRecord`는 raw depth samples를 포함하므로 긴 debug/test session이나 실제 장시간 session이 1MB를 넘으면 local persistence가 `SIGABRT`로 앱을 종료시킬 수 있다.

구현 사실:

- `DiveSessionStore`는 session record array를 `Application Support/DiveWatchApp/savedDiveSessionRecords.json` 파일에 JSON으로 저장한다.
- 작은 preference인 preferred dive mode, planned dives, executed plan ids는 기존처럼 `UserDefaults`에 남는다.
- 기존 `savedDiveSessionRecords` `UserDefaults` data가 있으면 처음 load 때 file storage로 migrate하고 해당 key를 제거한다.
- `save`, retry, sync status update는 sanitizer를 거친 record를 file storage에 쓴다.
- Companion phone이나 WatchConnectivity transport가 없어도 local save는 file storage에 유지된다.

검증:

- `DiveSessionRecordMigrationTests.testStorePersistsLargeSessionOutsideUserDefaultsLimit`는 encoded record가 1MB를 넘는 session을 저장해도 `savedDiveSessionRecords` UserDefaults key가 비어 있고 file storage에서 reload되는지 검증한다.
- `DiveSessionRecordMigrationTests.testStoreMigratesLegacyUserDefaultsRecordsToFileStorage`는 기존 UserDefaults record data가 file storage로 migrate되고 old key가 제거되는지 검증한다.
