Source URL: docs/superpowers/specs/2026-07-28-local-log-import-performance-reliability-design.md; docs/superpowers/plans/2026-07-28-local-log-import-performance-reliability.md; apps/mobile/src/repositories/persistent-dive-log-repository.ts; apps/mobile/src/claim/guest-claim-service.ts; apps/mobile/src/states/watch-connectivity-sync.tsx; apps/mobile/ios/Divenary/WatchConnectivityInbox.swift
Collected: 2026-07-28
Published: 2026-07-28

# Local log import performance and reliability evidence

## Reported behavior and root cause

- 앱 부팅 직후와 기기 데이터 가져오기 중 탭·버튼 반응이 느려질 수 있었다.
- 실제 live guest log가 1개여도 claim 화면은 과거 immutable snapshot 전체 크기인 `15 / 15`를 표시했다.
- claim cleanup은 항목마다 persistent repository `get`, profile 비교, `deleteIf`, 재확인을 수행해 같은 metadata envelope와 큰 profile을 반복 parse했다.
- remote/account 검증을 마친 guest 원본과 과거 full claim snapshot/profile evidence가 계속 남아 이후 inventory와 cleanup 비용을 키웠다.
- iPhone native inbox는 drain마다 첫 payload의 전체 JSON 파일을 문자열로 읽어 JS에 전달했다. 첫 항목이 실패하면 뒤 항목을 처리하지 않아, 유효한 Watch 로그가 durable inbox와 Supabase에 있어도 가져오기가 막힐 수 있었다.

## Implemented storage and claim boundary

- Logbook/Planbook repository는 `deleteManyIf`를 지원한다. Claim cleanup은 live inventory를 한 번 읽고 entity별 한 번의 조건부 bulk delete로 exact snapshot row만 제거한다.
- 조건이 달라진 guest row는 삭제하지 않고 account local-first/outbox로 승격한다. bulk 조건 실패는 `cleanupPending`과 `failure.phase: cleanup`으로 영구 기록되며 사용자의 명시적 retry에서만 다시 정리한다.
- 성공 cleanup은 guest profile과 claim sidecar를 제거하고 full committed snapshot을 compact historical artifact receipt로 축약한다. Historical Watch retransmission 판정에 필요한 `localSessionId`, `contentRevision`, artifact SHA만 보존한다.
- Claim schema 2는 큰 profile JSON을 metadata envelope 밖의 deterministic raw sidecar에 둔다. Schema 1 inline profile은 exact raw write/readback 뒤에만 schema 2로 승격한다.
- Claim UI의 항목별 `completed / total`은 upload/finalize에만 사용한다. Remote/account 저장 뒤 local cleanup은 indeterminate 상태로 표시하고, cleanup 실패도 과거 `15 / 15`를 표시하지 않는다.

## Implemented Watch import boundary

- Native inbox drain과 event는 full JSON 대신 최대 8개의 bounded descriptor만 반환한다. Descriptor에는 payload ID, session/revision/artifact identity와 수신 시각만 있다.
- 선택된 descriptor는 native utility queue에서 artifact 무결성을 확인하고 전체 sample array를 별도 prepared profile 파일로 atomic 저장한다. JS에는 최대 160개의 peak-preserving preview가 든 bounded payload만 반환한다.
- Prepared profile bytes는 JS `JSON.stringify`가 만드는 sample property order와 number encoding을 따르는 canonical UTF-8 JSON이다. Native가 반환하는 byte count와 SHA-256은 account outbox와 guest claim의 기존 sample digest contract와 같다.
- Persistent repository는 prepared file을 destination profile key로 native copy한 뒤 preview와 profile reference만 metadata envelope에 저장한다. 전체 sample array를 JS에서 다시 stringify/hash하지 않는다.
- Native prepared source는 imported/drop ACK 전까지 삭제하지 않아 I/O나 local commit 실패 뒤 재시도할 수 있다.
- Drain은 payload별 실패를 격리한다. 잘못된 artifact나 prepared metadata는 drop-ACK하고, I/O/repository 실패는 ACK하지 않은 채 남긴다. 첫 실패 뒤 같은 batch의 다음 descriptor를 계속 처리한다.
- 수동 가져오기 summary는 `receivedCount`, `importedCount`, `failedCount`를 구분한다. 일부 성공은 성공 개수를 표시하고, 전부 실패했을 때만 기존 재시도 안내를 표시한다.

## Verification evidence and remaining gate

- Bulk repository, claim snapshot/profile/cleanup, claim UI, prepared repository import와 Watch drain failure isolation 회귀 테스트를 추가했다.
- 관련 mobile Jest 135개, claim/account targeted suites, TypeScript typecheck와 Swift parse gate를 통과했다.
- Swift와 JS canonical profile 예제의 UTF-8 JSON 출력이 정확히 일치하는 것을 확인했다.
- 현재 isolated worktree에는 CocoaPods xcconfig와 bundle gems가 없어 `yarn ios:build`는 compile 전에 차단됐다. Native source parse는 통과했지만 paired iPhone/Watch의 8,000 sample import, 첫 malformed/다음 valid payload, background/relaunch retry는 실기기 gate로 남는다.

이 변경은 Watch local acknowledgement가 mobile local repository 저장만 뜻한다는 기존 경계를 유지한다. Supabase upload, certified dive-computer 기능, 감압 또는 비상 판단 완료를 의미하지 않는다.
