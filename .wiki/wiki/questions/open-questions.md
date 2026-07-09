# 열린 질문

Sources: pre-Karpathy wiki page, 2026-06-28; user pasted request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08
Raw: [Pre-Karpathy: 열린 질문](../../raw/questions/open-questions.md); [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md)
Updated: 2026-07-08
Last reviewed: 2026-07-08

## 요약

이 문서는 완료된 동작처럼 쓰면 안 되는 오래 유지할 미확정 사항과 미구현 영역을 기록한다.

## 현재 상태

- 실제 Apple Watch underwater sensor behavior는 아직 지원 hardware에서 검증되지 않았다. `RealDepthSensorProvider`는 `CMWaterSubmersionManager` 기반으로 구현됐고, fake sample은 명시적 demo mode로 분리됐다.
- Apple Watch 기반 v1 지원 수심은 40m 이하로 제한해야 한다. 40m보다 깊은 수심에서 Apple Watch가 어떤 값을 제공하거나 기능을 중단하는지, 앱이 해당 sample을 저장/차단/unsupported marker로 처리할지는 추후 결정해야 한다. 현재 모바일 Logbook/Planbook form validation은 최대 수심 60m를 허용한다.
- Store-level Apple Watch Ultra-only install filtering은 App Store/TestFlight 단계에서 검증해야 한다. 현재 code boundary는 watch target `underwater-depth` background mode, motion usage description, `waterSubmersionAvailable` runtime gate로 real start를 제한한다.
- WatchConnectivity code boundary, companion embed project 구조, durable native inbox, JS acknowledge 경로는 추가됐지만, pairing, entitlement setup, background delivery, retry/backoff behavior, paired iPhone 실기기 전송은 아직 검증되지 않았다.
- 모바일과 watch 연결이 끊긴 상태에서 watch로 만든 다이빙 기록을 재연결 뒤 동기화할 때 crash가 발생하는 사례가 보고됐다. 실기기 검증 전에 자동 동기화와 Logbook `워치 동기화` 버튼을 통한 수동 재시도가 모두 같은 pending 기록을 import할 수 있는지 확인하고 고쳐야 한다.
- Watch sync notification은 Notifee와 Settings opt-in으로 구현됐지만, background/killed 상태에서 WatchConnectivity 수신 뒤 local repository 저장과 local notification 표시가 실제 기기에서 어떻게 동작하는지는 검증되지 않았다.
- Settings의 기기 관리는 공개 `WCSession` 상태를 표시하지만, 사용자가 설정한 Apple Watch 이름을 읽는 공개 API는 아직 확인되지 않았다. 현재 native fallback 이름은 `Apple Watch`다.
- Supabase schema, RLS policy, auth, repository, cloud backup은 구현되지 않았다.
- 현재 모바일 Logbook은 cloud sync 부재를 반영해 imported watch log를 visible `pending`으로 표시한다. 실제 cloud sync가 들어오면 `pending`/`synced`/`failed` 표시 정책, retry UI, local acknowledgement와 remote sync의 연결 방식을 다시 설계해야 한다.
- 모바일 Logbook, Planbook, 설정 선호는 AsyncStorage 기반 versioned JSON store에 저장된다. 다만 version 1 이후의 schema migration behavior와 guest data retention 정책은 아직 추가 설계가 필요하다.
- `scuba`/`freedive` 두 모드 축소는 contract, generated type, validator, 모바일 UI, watch mode model에 구현됐고 Logbook/Planbook은 v2 storage key reset을 사용한다. Legacy local v1 데이터 retention/마이그레이션 정책은 future production 전환 전에는 여전히 별도 결정이 필요하다.
- Home 위치 조건 UI는 provider-neutral interface와 static mock provider로 구현됐지만, 실제 API adapter와 위치 권한 정책은 아직 구현되지 않았다.
- Generated Swift contract는 존재하지만 현재 `DiveWatchApp` target에서 참조되지 않는다.
- v1 Air-only safety stop trigger/countdown/copy의 watch implementation은 rule-based reminder 범위로 들어갔다. 현재 값은 10m arm, 5m target, 3-6m displayed zone, 2.7-6.3m counting zone, 180초 duration, counting zone 밖 연속 30초 reset이다. 다만 이 값들이 실제 underwater sensor에서 충분히 안정적인지, haptic/젖은 화면/시야 조건에서 사용자에게 적절한지는 지원 hardware 수동 검증이 필요하다.
- Safety stop 권장 상태와 mandatory/decompression 상태는 색상과 severity를 분리해야 한다. 현재 contract/Swift/mobile model의 `safetyStop.required` field를 그대로 둘지, 권장 리마인더 의미에 맞게 rename/migration할지는 미정이다.
- Decompression stop 또는 감압 정지는 safety stop과 같은 의미로 쓰지 않는다. 감압 정지를 추가하려면 직접 계산할지, 외부 dive computer에서 온 사실 기록만 보존할지, mandatory 상태의 source provenance를 어떻게 표시할지 먼저 설계해야 한다.
- `CMWaterSubmersionManager` temperature update는 depth update와 독립적이다. 현재 watch sample model은 temperature를 non-optional로 요구하므로, 첫 temperature update 전 fallback 값을 쓰는 구조를 실제 review 품질 기준에 맞게 재검토해야 한다.
- Apple Watch Ultra급 프리다이빙/스쿠버 제품 방향에서 GF 기본값, v2 Air/Nitrox 범위, depth sensor sampling/background 검증, 수심 필터, CNS table, Bühlmann coefficient source, mandatory deco 처리, tank transmitter, export format은 별도 제품 질문으로 남아 있다.

## 상세

위 항목을 resolved로 옮기기 전에는 관련 코드를 직접 확인하고 연결된 architecture/domain page를 함께 수정한다.

## 관련 문서

- [Watch 앱 구조](../architecture/watch-app.md)
- [모바일 구조](../architecture/mobile.md)
- [모바일 로그북 로드맵](../architecture/mobile-logbook-roadmap.md)
- [Supabase 구조](../architecture/supabase.md)
- [동기화 흐름 구조](../architecture/sync-flow.md)
- [안전 규칙](../domains/safety-rules.md)
- [Diving App / Open Questions](diving-app-open-questions.md)
