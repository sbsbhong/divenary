Source URL: project conversation; docs/architecture/watch-link-protocol.md; apps/mobile/src/companion/watch-link.ts; apps/mobile/src/companion/native-watch-link.ts; apps/mobile/src/storage/persistent-json-store.ts; apps/mobile/src/claim/guest-claim-store.ts; apps/mobile/src/utils/canonical-json.ts; apps/mobile/src/sync/account-outbox.ts; apps/mobile/src/sync/account-payload.ts; apps/mobile/src/sync/account-sync-coordinator.ts; apps/mobile/src/states/auth.tsx; apps/mobile/src/states/account-data.tsx; apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts; apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift; apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift; apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계

사용자가 실기기에서 큰 로그를 넣은 뒤 "기록을 준비하는 중"에서 멈추고, 탭이 눌리지 않을 만큼 느리며, 날씨를 가져오지 못한다고 보고했다. 사용자는 기존 설계를 바꿔도 좋으니 사람이 읽을 수 있는 수준에서 모바일과 Watch의 비효율을 고치라고 했고, 모바일과 Watch는 iOS에 묶이지 않은 인터페이스로 통신해야 한다고 했다. Android와 Galaxy Watch 조합을 나중에 추가할 수 있어야 하기 때문이다.

## 원인

- Guest claim snapshot(2.7MB)을 읽을 때마다 모든 sidecar를 다시 정규화하고 pure-JS SHA-256으로 해시했다. Debug 기기에서 한 번에 약 10초가 걸렸고, claim 진행 저장마다 같은 검증을 다시 했다.
- Logbook/Planbook 저장소는 단건 조회와 저장마다 전체 컬렉션을 읽고 검증하고 세 번 깊은 복사했으며, 저장마다 pending/commit journal에 전체 값을 한 번 더 쓰고 pure-JS SHA-256을 계산했다.
- `canonicalJson`이 다섯 곳에 복사돼 있었고 모든 객체(깊이 sample 포함)의 key를 `localeCompare`로 정렬했다. Hermes에서 `localeCompare`는 느리다.
- 인증 재검증(foreground, token refresh)이 같은 상태라도 새 객체를 만들어 account-data bootstrap 전체를 다시 실행했다.
- Account outbox는 매 작업마다 전체 상태를 검증하고, 바뀐 것이 없어도 다시 썼다. Cloud refresh는 매번 모든 원격 행 digest와 변하지 않은 profile을 JS에서 다시 해시했다.
- 날씨 요청 마감은 JS timer다. JS thread가 멈췄다 풀리면 이미 끝난 응답보다 timer가 먼저 실행돼 요청이 실패로 끝났다.
- Watch는 1Hz sample마다 sidecar 파일을 인코딩·원자적 쓰기·삭제하고 fsync했으며, 삭제 ledger와 manifest를 매번 전부 디코딩했다. 앱 root와 Home이 recorder와 수중 센서를 관찰해 sample마다 화면을 다시 계산했다.

## 바뀐 설계

- `PersistentJsonStore`는 저장된 text가 바뀔 때까지 parse·검증한 값을 재사용한다. AsyncStorage(SQLite/Room)는 key 하나를 원자적으로 바꾸므로 쓰기는 `setString` 한 번과 readback 한 번이다. 이전 build가 남긴 pending/commit journal은 처음 읽거나 쓰기 전에 한 번만 마무리한다. commit marker 없는 pending 값은 commit되지 않은 값이므로 버린다. readback 실패는 새 값이 이미 저장됐을 수 있으므로 `PersistentJsonCommittedWriteError`로 알린다.
- Claim store는 sidecar마다 내용 검증 결과를 그 입력과 함께 기억한다. 진행 상태만 바뀐 snapshot 쓰기는 진행 field만 다시 검사한다. 입력 bytes가 바뀌면 다시 검증하므로 변조는 계속 거부된다.
- `canonicalJson`은 `src/utils/canonical-json.ts` 하나로 합쳤다. key 순서는 여전히 `localeCompare`로 정하지만 같은 key 목록에 대해 한 번만 계산한다. 출력은 이전 serializer와 byte 단위로 같고 test로 고정했다.
- Auth는 같은 상태로 재검증되면 상태 객체를 유지하고, account-data는 data owner마다 principal 객체를 하나만 쓴다.
- Outbox는 저장 text마다 한 번만 검증하고, 상태를 바꾸지 않은 작업은 쓰지 않는다. 원격 payload digest는 canonical text별로 기억하고, 변하지 않은 synced profile은 text가 바뀌었을 때만 다시 해시한다. 같은 길이의 손상도 text 비교로 잡는다.
- 날씨 요청은 한 번 더 시도한 뒤에 오류를 보인다.
- Watch recording journal은 세션 동안 열어 두고 sample마다 한 줄을 쓰며 10 sample마다 storage로 flush한다. 쓰기가 실패하면 다음 append가 journal을 디스크에서 다시 읽어 잘린 마지막 줄을 고치고, 이미 기록된 재시도 sample은 건너뛴다. 이전 build의 `recording-pending.json`은 다시 열 때 지운다.
- Watch manifest와 삭제 ledger는 파일 수정 시각과 크기가 같으면 디코딩 결과를 재사용한다. 끝난 삭제는 launch마다 다시 실행하지 않고, sync status 변경은 한 번에 모아 manifest를 한 번만 쓰며 바뀌지 않은 status는 쓰지 않는다.
- Watch recorder와 수중 센서 coordinator는 바뀐 값만 publish한다. 앱 root와 Home은 전달만 하는 객체를 관찰하지 않는다.

## Watch link 경계

- 모바일 앱 코드는 `apps/mobile/src/companion/watch-link.ts`의 `WatchLink` 인터페이스만 쓴다. `native-watch-link.ts`가 native module 계약(`NativeWatchLinkModule`)을 `WatchLink`로 바꾼다. iOS는 `WatchConnectivityModule`, Android는 같은 계약의 `WearableCompanionModule`(예정)을 쓴다. Platform module이 없으면 조용한 unavailable link를 쓴다.
- `src/companion` 밖의 모바일 코드는 platform watch module 이름이나 event 이름을 참조하지 않는다. `__tests__/watch-link.test.ts`가 이 경계를 검사한다.
- 메시지 종류와 전송 의미는 `docs/architecture/watch-link-protocol.md`에 둔다. 모든 메시지는 문자열 key와 JSON 기본 값만 쓴다.

## 남은 일

- Claim snapshot의 첫 검증은 launch마다 한 번 남아 있다. sidecar를 불변 문서와 작은 진행 문서로 나누는 구조 변경과 native digest는 하지 않았다.
- 로그 하나에 preview sample이 두 번 저장되는 중복 제거는 digest와 claim 형식을 바꾸므로 하지 않았다.
- Watch 저장 직후 화면이 "저장 중"을 그리기 전에 저장이 동기적으로 실행되는 문제는 coordinator 동작 변경이 필요해 남겼다.
- Watch envelope을 `packages/contracts`의 JSON schema로 옮기는 일은 하지 않았다.
