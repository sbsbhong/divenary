# ADR: 1Hz immutable profile과 file-only session sync

Sources: Diving App accepted design and implementation, 2026-07-12
Raw: [1Hz 프로파일 파일 저장과 WatchConnectivity 신뢰성 결정](../../raw/architecture/2026-07-12-one-hertz-profile-file-sync.md)
Updated: 2026-07-12

## Status

Accepted

## Context

수 시간의 다이빙은 센서 callback을 모두 중복 JSON과 UserDefaults에 보관하기에 크고, WatchConnectivity의 direct message 크기 경계와 cold-start ACK race가 반복적인 유실·pending 문제를 만들었다. Simulator 전용 chunk protocol은 실기기 구조와 다른 두 번째 전송 경로를 만든다.

## Decision

원시 callback은 live engine에 사용하고 영구 기록은 non-empty 1초 bucket당 실제 sample 하나와 extrema를 저장한다. 완료 세션은 immutable contract JSON artifact와 작은 manifest로 분리한다. 모든 session body는 `transferFile` 하나로 보내고 `(localSessionId, contentRevision, sha256)`를 application identity로 쓴다. iPhone은 callback 안에 파일을 durable copy하며 ACK도 activation 전 persistent outbox에 보관한다. 모바일 metadata와 full profile은 분리한다.

## Consequences

3시간 연속 기록은 최대 10,800 sample로 bounded된다. 빈 구간은 합성되지 않아 고정 1Hz 시계열이 아니라 최대 1Hz 실제 관측 시계열이다. Same-second 순간 peak는 bucket extrema로 보존하지만 모든 raw callback을 장기 저장하지는 않는다. Short session도 background-oriented file transport를 사용하므로 reachable direct-message fast path는 없다. Simulator chunk fallback은 제공하지 않으며 실제 file delivery는 paired hardware에서 검증한다.

## Sources

- `docs/superpowers/specs/2026-07-12-watch-profile-file-sync-reliability-design.md`
- `apps/mobile/ios/DiveWatchApp/Recording/OneHertzProfileSampler.swift`
- `apps/mobile/ios/DiveWatchApp/Storage/DiveProfileArtifactStore.swift`
- `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
- `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
