Source URL: apps/mobile/ios/Divenary/WatchConnectivityInbox.swift; apps/mobile/src/claim/guest-claim-store.ts; apps/mobile/src/claim/guest-claim-service.ts; apps/mobile/src/states/account-data.tsx; docs/2026-07-19-guest-data-account-claim-device-checklist.md
Collected: 2026-07-28
Published: 2026-07-28

# Local log import review hardening evidence

## Native profile canonicalization

- Swift `JSONEncoder`의 `Double` 표기는 JavaScript `JSON.stringify`와 항상 같지 않다. 대표적으로 `-0`, `1e-6`, `1e20`은 서로 다른 문자열이 될 수 있고, 같은 sample이라도 profile SHA-256이 달라질 수 있다.
- Native preparation은 validation을 통과한 sample을 `JavaScriptCore`의 `JSON.stringify`로 다시 직렬화한다. Property 순서는 mobile profile contract의 `localSessionId`, `timestamp`, `depthMeters`, optional pressure/bucket/temperature 순서로 고정한다.
- Swift 실행과 Node 실행에서 `-0`, `1e-6`, `1e-7`, `1e20`, `1e21`, optional sample field를 포함한 UTF-8 JSON이 정확히 일치함을 확인했다.
- Prepared profile의 file bytes, byte count 또는 SHA-256이 채택 시점에 달라지면 derived-file I/O corruption으로 분류한다. Raw Watch artifact는 drop-ACK하지 않고 inbox에 남겨 다음 preparation에서 재생성한다.

## Committed claim receipt migration

- Compact committed receipt의 `historicalArtifacts`는 inactive Watch retransmission lookup의 authoritative input이다. Full snapshot이 비어 있어도 이 identity set을 먼저 읽어 과거 artifact가 삭제된 Logbook row를 다시 만들지 않게 한다.
- 이전 schema 1 committed snapshot은 profile sidecar migration을 거치지 않고 바로 schema 2 compact receipt로 전환한다. 이미 remote/account commit이 끝난 데이터를 다시 업로드하지 않는다.
- Compact receipt write 뒤 user, status, batch ID, manifest digest, empty snapshots와 historical identities를 readback한다. 검증이 끝난 뒤 deterministic claim profile evidence key를 정리한다.
- Evidence file removal 실패는 committed receipt를 무효화하지 않는다. 다음 receipt read에서 같은 key cleanup을 다시 시도한다.

## Verification boundary

- Focused tests는 compact history lookup, legacy committed compaction/evidence removal, prepared-file I/O retry와 native source contract를 검증했다.
- TypeScript typecheck, Swift parse와 iOS Simulator SDK typecheck를 통과했다.
- Paired iPhone/Watch의 8,000 sample import, malformed-then-valid batch, background/foreground와 force-quit/relaunch는 physical gate로 남는다.

이 hardening은 Watch ACK가 mobile local repository 저장만 뜻한다는 기존 경계를 바꾸지 않는다. Remote claim evidence와 Supabase profile object retention 정책도 변경하지 않는다.
