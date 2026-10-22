# Watch link protocol

폰 앱과 companion watch 앱이 주고받는 메시지 규격이다. 메시지는 모두 문자열 키와 JSON 기본 값만 쓰므로, Apple Watch(WatchConnectivity)와 Wear OS 워치(Wearable Data Layer)가 같은 규격을 구현할 수 있다.

## 계층

| 계층 | 폰 | 워치 |
| --- | --- | --- |
| 앱 코드 | `apps/mobile/src/companion/watch-link.ts`의 `WatchLink` 인터페이스만 사용 | `WatchSyncTransporting` protocol만 사용 |
| 플랫폼 adapter | `native-watch-link.ts`가 native module 계약(`NativeWatchLinkModule`)을 `WatchLink`로 변환 | `WatchSyncTransport`(WatchConnectivity) |
| 전송 | iOS `WatchConnectivityModule` / Android `WearableCompanionModule`(예정) | watchOS / Wear OS(예정) |

`src/companion` 밖의 모바일 코드는 platform watch module을 참조하지 않는다. `__tests__/watch-link.test.ts`가 이 경계를 검사한다.

## 메시지

모든 제어 메시지는 `kind` 키로 종류를 구분한다. 정확한 field와 type의 기준은 `packages/contracts/schemas/watch-link-messages.schema.json`과 `watch-planned-dive.schema.json`이다. `yarn check:quick`이 `packages/contracts/generated/`에 TypeScript·Swift type을 만들고, 모바일 `watch-link.ts`는 생성된 TypeScript type을 쓴다. `__tests__/watch-link-contract.test.ts`는 보내는 쪽 Swift 코드가 스키마의 key를 같은 철자로 쓰는지 검사한다.

| kind | 방향 | 전송 방식 | 내용 |
| --- | --- | --- | --- |
| `watchSyncMessage` | 워치 → 폰 | 파일 전송, metadata에 identity | session JSON 파일 하나(`packages/contracts`의 `WatchSyncMessage`). metadata: `formatVersion`, `localSessionId`, `contentRevision`, `sha256`, `byteCount`, `sampleCount`, `sentAt` |
| `watchSyncAcknowledgement` | 폰 → 워치 | 대기열 메시지, 연결돼 있으면 즉시 메시지도 | `localSessionId`, `contentRevision`, `sha256`, `byteCount`, `sampleCount`. 폰 로컬 저장소에 저장됐다는 뜻이며 cloud 업로드 완료가 아니다 |
| `watchPlannedDives` | 폰 → 워치 | 최신 상태 하나만 유지하는 context, 연결돼 있으면 즉시 메시지도 | `plannedDivesJson`: `WatchPlannedDivePayload` 배열. 실행하지 않은 계획만 담고 계정·백엔드 식별자는 넣지 않는다 |
| `watchSessionDeletionCommand` | 폰 → 워치 | 대기열 메시지 | `formatVersion: 1`, `commandId`(sha256 hex), `localSessionId`, `requestedAt`, 선택적으로 `contentRevision`·`artifactSha256` 쌍 |
| `watchSessionDeletionAcknowledgement` | 워치 → 폰 | 대기열 메시지 | `formatVersion: 1`, `commandId`, `localSessionId`, `acknowledgedAt`, `result`(`deleted`/`alreadyAbsent`), 선택적으로 `removedContentRevision`·`removedArtifactSha256` 쌍 |

## 전송 의미

- 대기열 메시지는 연결이 끊겨도 나중에 도착해야 한다(WatchConnectivity `transferUserInfo`, Data Layer `DataItem`/`MessageClient` 재시도).
- 최신 상태 context는 마지막 값만 의미가 있다(WatchConnectivity application context, Data Layer `DataItem` 덮어쓰기).
- session 파일은 크기와 무관하게 파일 전송으로 보낸다. 폰은 받은 즉시 내구성 있는 inbox에 복사하고 identity(revision, digest, byte/sample 수)를 검증한 뒤 JS에 알린다.
- 폰은 import 성공 뒤에만 `watchSyncAcknowledgement`를 보낸다. 형식이 맞지 않아 버리는 payload는 폰 inbox에서만 지우고 워치에 import ACK를 보내지 않는다.

## Android 구현 시 할 일

1. Wear OS 앱이 위 스키마의 메시지를 같은 키로 보내고 받는다. 받는 쪽은 모르는 선택 key를 무시해도 된다.
2. Android 앱에 `WearableCompanionModule` native module을 만들고 `NativeWatchLinkModule`의 메서드와 `DiveWatchSyncPayloadReceived` event를 구현한다.
3. 앱 코드는 바꾸지 않는다. `resolveNativeWatchLinkModule()`이 Android에서 이 모듈을 찾는다.
