Source URL: user bug report, 2026-07-09; apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift; apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift; apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift
Collected: 2026-07-09
Published: Unknown

# Watch session persistence sanitizer

이 source는 2026-07-09 watch debug/test session 저장 실패 수정 뒤의 오래 유지할 sync/persistence 사실을 보존한다.

관련 source path:

- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- `apps/mobile/ios/DiveWatchAppTests/DiveSessionRecordMigrationTests.swift`

구현 사실:

- `DiveSessionRecord.sanitizedForPersistence()`는 local persistence와 WatchConnectivity payload encoding 전에 JSON으로 표현할 수 없는 `NaN`/`Infinity` 계열 numeric 값을 제거하거나 finite fallback으로 바꾼다.
- `DiveSessionStore.save(_:)`는 transport enqueue와 `UserDefaults` persistence 전에 sanitized record를 사용한다.
- WatchConnectivity transport failure는 local save 실패가 아니라 `syncStatus` 결과로만 반영된다.
- Debug/test freedive와 scuba session은 companion phone transport가 실패해도 watch local store에 남아야 한다.
- Sanitizer는 recorder와 engine의 sample-level guard를 대체하지 않고, derived payload field, location metadata, legacy loaded record, retry path를 보호하는 마지막 방어선이다.

검증:

- `DiveSessionRecordMigrationTests`는 disconnected transport에서 debug freedive/scuba save가 persist되는지 검증한다.
- 같은 test file은 non-finite scuba derived values가 store persistence와 sync encoding 전에 JSON-safe value로 정리되는지 검증한다.
- Freedive derived values도 sanitizer 뒤 JSON encode와 sync message encode가 가능해야 한다.
