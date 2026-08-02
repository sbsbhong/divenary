# 열린 질문

Sources: pre-Karpathy wiki page, 2026-06-28; user pasted request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Divenary Auth promotion readiness evidence, 2026-07-15; Google iOS client and callback correction, 2026-07-16; Staging/local Auth 개발 경계와 승격 증거, 2026-07-18; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18; Guest data account claim implementation evidence, 2026-07-19; Guest data account claim staging promotion evidence, 2026-07-20; Guest claim target ID and verifier correction evidence, 2026-07-20; Cross-device guest claim reconciliation evidence, 2026-07-29
Raw: [Pre-Karpathy: 열린 질문](../../raw/questions/open-questions.md); [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Divenary Auth promotion readiness evidence](../../raw/architecture/2026-07-15-divenary-auth-promotion-readiness.md); [Google iOS client and callback correction](../../raw/architecture/2026-07-16-google-ios-callback-correction.md); [Staging/local Auth 개발 경계와 승격 증거](../../raw/architecture/2026-07-18-staging-local-auth-evidence.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md); [Guest data account claim staging promotion evidence](../../raw/architecture/2026-07-20-guest-data-account-claim-staging-promotion.md); [Guest claim target ID and verifier correction evidence](../../raw/architecture/2026-07-20-guest-claim-target-id-verifier-correction.md); [Cross-device guest claim reconciliation evidence](../../raw/architecture/2026-07-29-cross-device-guest-claim-reconciliation.md)
Sources: Guest claim semantic canonical reuse evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse.md)
Sources: Guest claim semantic canonical reuse staging promotion evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse staging promotion evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse-staging.md)
Sources: Guest claim semantic canonical reuse physical verification evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse physical verification evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse-physical-verification.md)
Sources: 사용자 승인 진단 설계, 2026-08-02
Raw: [개인정보 최소화 모바일·Watch 진단 결정](../../raw/decisions/2026-08-02-privacy-minimized-diagnostics.md)
Updated: 2026-08-02
Last reviewed: 2026-08-02

## 요약

이 문서는 완료된 동작처럼 쓰면 안 되는 오래 유지할 미확정 사항과 미구현 영역을 기록한다.

## 현재 상태

- 실제 Apple Watch underwater sensor behavior는 아직 지원 hardware에서 검증되지 않았다. `RealDepthSensorProvider`는 `CMWaterSubmersionManager` 기반으로 구현됐고, fake sample은 명시적 demo mode로 분리됐다.
- Lifecycle 구현은 하나의 app-scoped `WaterSubmersionCoordinator`, runtime controller, real recorder/coordinator로 합쳤지만 signed device evidence와 physical lifecycle은 아직 없다. 15cm bag/tank test가 통과해도 manually started shallow sampling만 뜻하며 `When Submerged` pass가 아니다.
- Xcode Easy Submersion은 simulator system-session delivery/adoption과 UI navigation만 확인한다. `When Submerged` 목록 노출과 physical system auto-launch을 resolved로 옮기려면 signed `underwater-depth`, shallow entitlement가 code signature와 provisioning profile에 모두 있는지, install/reinstall, hardware/watchOS, `requestAutoLaunchAuthorizationStatus`, 지원 hardware의 안전하게 통제한 `>1 m`에서 `handle(_:)` adoption과 actual selection을 확인해야 한다.
- Water Lock 제거 뒤 Digital Crown invalidation, watchOS continuous out-of-water `>600s (10 minutes)` timeout, `600s (10 minutes)` 전 resubmerge의 동일 local session ID, Action Button configured Dive app의 surfaced `>=180s (3 minutes)` end는 모두 미검증이다. Action Button submerged/unknown/early rejection은 diver interaction이 아니라 unit test 또는 controlled developer harness로만 확인한다. simulator/build 성공은 이 행동의 증거가 아니다.
- 공개 shallow entitlement는 manager가 허가한 얕은 접근만 의미한다. full-depth sensor behavior는 Apple managed deeper entitlement의 외부 승인과 provisioning이 끝날 때까지 미결 상태다.
- manual/Action Button no-sample compact result와 system auto-launch no-sample silent cancellation, demo/debug의 Crown simulation 및 touch end/non-runtime 경로, 42mm/46mm/49mm layout은 지원 hardware에서 확인해야 한다.
- Apple Watch 기반 v1 지원 수심은 40m 이하로 제한한다. 40m보다 깊은 값은 reject/clamp하지 않고 로그/계획/review에 보존하되 unsupported-depth warning을 표시하는 정책으로 구현됐다. 다만 실제 Apple Watch가 40m 초과 상황에서 어떤 값을 제공하거나 기능을 중단하는지는 지원 hardware에서 검증해야 한다.
- Store-level Apple Watch Ultra-only install filtering은 App Store/TestFlight 단계에서 검증해야 한다. 현재 code boundary는 watch target `underwater-depth` background mode, motion usage description, `waterSubmersionAvailable` runtime gate로 real start를 제한한다.
- WatchConnectivity session body는 file-only이고 native inbox와 activation-gated ACK outbox가 구현됐다. 사용자가 약 4분의 foreground pairing, 자동 import, local save 뒤 Watch `synced` 전환을 확인했지만 build identifier, 기기/OS, background/force-quit delivery, reconnect, retry timing, large transfer는 아직 검증되지 않았다.
- 개인정보를 최소화한 Mobile/Watch 진단 파이프라인은 설계만 승인됐고 구현되지 않았다. 1단계에는 공통 schema, 3일/1MB Watch journal, 14일/10MB iPhone journal, session sync와 분리된 Watch diagnostic transfer/ACK, 고정 분류 incident marker, JSONL 수동 export와 cross-device purge가 필요하다. 모든 build에서 계정 식별자, Auth 정보, 위치, 사용자 콘텐츠, 다이빙 수치·sample과 원본 payload를 제외해야 한다. Watch background/reconnect/ACK retry, retention, offline purge는 paired hardware gate다. 원격 provider, 자동 upload, 사용자 동의·opt-out, privacy policy, sampling, server retention/deletion, native crash/symbolication은 별도 승인 전까지 미구현 2단계다.
- 자동 drain과 수동 drain은 process-wide coordinator로 직렬화됐지만, 실제 disconnect/reconnect crash가 사라졌는지는 paired hardware에서 재현해야 한다.
- Watch sync notification은 preference hydration, AppState 재-drain, Notifee background handler, denied-permission Settings 복구 경로를 갖지만 background/force-quit 상태에서 실제 WatchConnectivity wake와 local notification 표시가 어떻게 동작하는지는 paired 실기기에서 검증되지 않았다.
- Settings의 기기 관리는 공개 `WCSession` 상태를 표시하지만, 사용자가 설정한 Apple Watch 이름을 읽는 공개 API는 아직 확인되지 않았다. 현재 native fallback 이름은 `Apple Watch`다.
- Local Supabase/Auth와 staging Auth foundation에 더해 owner remote data schema, private profile Storage 경계, principal partition, account outbox/revision conflict와 resumable guest claim service가 구현됐다. Hosted staging은 exact-digest cross-device canonical-ID 조정, semantic timestamp·source float·import bookkeeping canonical reuse, 사용자 의미 divergence rollback과 soft-deleted collision denial을 통과했다. 원래 iPhone 15-item retry도 canonical 1건 재사용, 신규 14건 publication과 cleanup을 통과했고, inventory refresh 뒤 별도 1건 claim까지 완료됐다. 최종 local/remote account 26건이 일치하고 guest 0건, compact receipt, empty outbox를 확인했다. Physical Android claim, offline retry, force-quit cleanup resume와 second-account isolation은 여전히 남아 있다.
- Finalizer는 committed `guest_claim_batches`/`guest_claim_records`와 `<user_id>/claims/...` profile object를 idempotent readback/audit용으로 보존한다. Auth user deletion은 database claim row만 cascade하며 remote Storage profile object는 자동 삭제하지 않는다. Account deletion, privileged object cleanup, post-commit retention 기간과 audit 보존 정책은 아직 설계·구현되지 않은 release gate다.
- 사용자는 physical iPhone에서 Apple login 성공을 확인했다. Google physical login, cancellation/repeat, session restore, re-consent와 post-Auth Watch regression은 아직 검증되지 않았다.
- Guest row는 `notConfigured`, account outbox는 `pending`/`synced`/`failed`/`conflict` 전이를 사용할 수 있다. Claim UI는 구현됐지만 screenshot, 320pt/large phone, light/dark, Dynamic Type/font scale 2.0과 Reduce Motion physical evidence는 아직 없다.
- 모바일 Logbook, Planbook, 설정 선호는 AsyncStorage 기반 versioned JSON store에 저장된다. Existing unscoped data를 한 번만 `guest` namespace로 옮기는 migration은 구현됐지만 production upgrade fixture와 long-lived legacy local v1 retention은 별도 검증이 필요하다.
- `scuba`/`freedive` 두 모드 축소는 contract, generated type, validator, 모바일 UI, watch mode model에 구현됐고 Logbook/Planbook은 v2 storage key reset을 사용한다. Legacy local v1 데이터 retention/마이그레이션 정책은 future production 전환 전에는 여전히 별도 결정이 필요하다.
- Home 조건은 실제 Open-Meteo adapter와 위치 권한 경계를 갖지만 platform geocoder와 네트워크 실패 품질은 실기기 확인이 필요하다.
- Generated Swift contract는 존재하지만 현재 `DivenaryWatchApp` target에서 참조되지 않는다.
- v1 Air-only safety stop trigger/countdown/copy의 watch implementation은 rule-based reminder 범위로 들어갔다. 현재 값은 10m arm, 5m target, 3-6m displayed zone, 2.7-6.3m counting zone, 180초 duration, counting zone 밖 연속 30초 reset이다. 다만 이 값들이 실제 underwater sensor에서 충분히 안정적인지, haptic/젖은 화면/시야 조건에서 사용자에게 적절한지는 지원 hardware 수동 검증이 필요하다.
- Safety stop 권장 상태와 mandatory/decompression 상태는 색상과 severity를 분리해야 한다. 현재 contract/Swift/mobile model의 `safetyStop.required` field는 compatibility field로 유지하고, optional `recommendationType: "recommended"`를 추가해 v1 권장 리마인더 의미를 기록한다. 장기적으로 field rename이나 mandatory/decompression migration이 필요한지는 future high-risk 설계에서 다시 결정한다.
- Decompression stop 또는 감압 정지는 safety stop과 같은 의미로 쓰지 않는다. 감압 정지를 추가하려면 직접 계산할지, 외부 dive computer에서 온 사실 기록만 보존할지, mandatory 상태의 source provenance를 어떻게 표시할지 먼저 설계해야 한다.
- `CMWaterSubmersionManager` temperature update는 optional로 처리된다. 얕은 물 실기기에서 첫 update 지연, 미수신, 실제 값 표시와 저장 동작을 확인해야 한다.
- Supabase/Auth 제품 정책, Divenary App ID/bundle identifier, signed provisioning, Google iOS callback, staging legal/current pointer와 hosted guest-claim automated verifier는 검증됐다. `mclvhwzsuvsxjerdouka`는 production이 아니며 production project와 production 약관/개인정보 문서는 future work다. Apple login은 사용자 확인을 근거로 성공으로 기록하지만 Google login은 provider enabled flag나 signed build만으로 성공으로 간주하지 않는다. Physical guest claim, post-Auth Watch regression과 앱 내 즉시 영구 account deletion 전에는 release하지 않는다.
- Memory/share의 tab 위치, media metadata redaction, export format, 실패·취소 UX는 별도 spec이 필요하다.
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
- [ADR: 개인정보 최소화 device-local 진단 파이프라인](../decisions/adr-privacy-minimized-diagnostics.md)
- [Diving App / Open Questions](diving-app-open-questions.md)
