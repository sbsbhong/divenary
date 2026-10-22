# ADR: 플랫폼 중립 Watch link

Sources: 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계, 2026-10-22
Raw: [2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계](../../raw/architecture/2026-10-22-performance-and-watch-link-boundary.md)
Sources: 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract, 2026-10-22
Raw: [2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract](../../raw/architecture/2026-10-22-logbook-paging-and-contract-messages.md)
Updated: 2026-10-22

## Status

Accepted

## Context

모바일 앱 코드가 iOS `WatchConnectivityModule`과 그 event 이름을 여러 화면과 상태 모듈에서 직접 불렀다. 이 구조로는 Android 폰과 Galaxy Watch(Wear OS) 조합을 추가할 때 앱 코드 전반을 고쳐야 한다. 사용자는 모바일과 watch가 iOS에 묶이지 않은 인터페이스로 통신해야 한다고 정했다.

## Decision

- 모바일 앱 코드는 `apps/mobile/src/companion/watch-link.ts`의 `WatchLink` 인터페이스만 쓴다.
- `native-watch-link.ts`가 native module 계약 `NativeWatchLinkModule`을 `WatchLink`로 바꾼다. iOS는 `WatchConnectivityModule`, Android는 같은 계약의 `WearableCompanionModule`을 구현한다. Platform module이 없으면 조용한 unavailable link를 쓴다.
- 메시지는 문자열 key와 JSON 기본 값만 쓰고, 종류(`watchSyncMessage`, `watchSyncAcknowledgement`, `watchPlannedDives`, `watchSessionDeletionCommand`, `watchSessionDeletionAcknowledgement`)와 전송 의미는 `docs/architecture/watch-link-protocol.md`에 둔다.
- `src/companion` 밖의 코드는 platform watch module이나 event 이름을 참조하지 않는다. `__tests__/watch-link.test.ts`가 이 경계를 검사한다.
- Watch 쪽 코드는 `WatchSyncTransporting` protocol만 쓴다.

## Consequences

- Android 지원은 Wear OS 앱과 `WearableCompanionModule` 구현으로 끝나며, 화면·상태·저장소 코드는 바꾸지 않는다.
- Native Swift type 이름(`WatchConnectivityInbox`, `PendingWatchConnectivityPayload`)은 iOS adapter 내부 이름이라 그대로 둔다.
- 제어 메시지와 계획 다이브는 `packages/contracts`의 `watch-link-messages`, `watch-planned-dive` schema가 기준이다. 모바일은 생성된 TypeScript type을 쓰고, Watch target은 생성된 Swift를 컴파일하지 않는 대신 contract test가 보내는 쪽 key 철자를 검사한다.
- Relay가 session artifact를 다시 serialize하면 digest가 달라지므로 session 파일 bytes는 그대로 전달해야 한다.

## Sources

- `apps/mobile/src/companion/watch-link.ts`
- `apps/mobile/src/companion/native-watch-link.ts`
- `apps/mobile/src/companion/default-watch-link.ts`
- `apps/mobile/__tests__/watch-link.test.ts`
- `docs/architecture/watch-link-protocol.md`
- `packages/contracts/schemas/watch-link-messages.schema.json`
- `apps/mobile/__tests__/watch-link-contract.test.ts`
