# 모바일 로그북 로드맵

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15
Raw: [Pre-Karpathy: 모바일 로그북 로드맵](../../raw/architecture/mobile-logbook-roadmap.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md)
Updated: 2026-07-15

## 요약

모바일 앱은 로그북과 Auth의 중심이고 watch 앱은 측정 가능한 세션 데이터를 제공하는 account-free 캡처 source다. Local-first 로그북 위에 Wave 3A login/consent 기반은 추가됐으며 remote data와 principal sync는 기존 저장소 경계를 유지한 채 3B/3C에서 붙인다.

## 현재 상태

현재 모바일 로그북은 `DiveLogEntry`를 `DiveLogRepository` 경계 뒤에서 다룬다. 앱 기본 구현은 AsyncStorage 기반 `PersistentDiveLogRepository`와 React Query hook을 사용한다. 수동 로그와 Watch log는 같은 목록에 표시되고 앱 재시작 뒤에도 저장된다. Wave 3A의 Keychain-compatible session, native Google/Apple login과 mandatory consent는 구현됐지만 로그인해도 이 guest 목록을 claim/upload/delete/partition하지 않는다. Supabase remote data sync는 아직 구현되지 않았다.

승인된 방향은 다음과 같다.

- 모바일 수동 로그 등록과 watch 기반 로그 작성을 모두 지원한다.
- 첫 구현은 로그인 없는 local-only 저장으로 진행한다.
- 저장소 인터페이스를 먼저 만들어 화면이 로컬 저장소와 future Supabase 저장소를 직접 구분하지 않게 한다.
- 앱 기본 local-only 저장소는 AsyncStorage 기반 versioned JSON store를 사용한다.
- React Query를 로그북 조회, 저장, 삭제, watch sync mutation의 비동기 cache 계층으로 사용한다.
- Zustand는 첫 구현 범위에 넣지 않고, 편집 화면의 임시 상태가 복잡해질 때만 재검토한다.
- Watch에서 가져온 측정값은 원본 출처를 보존하고 수정 불가능한 값으로 표시한다.
- 로그인 이후에는 signed-in 사용자가 local write 후 Supabase sync를 사용하고, 비로그인 사용자는 local-only로 계속 사용한다.

## 단계별 TODO

이 TODO는 단기 작업 메모가 아니라 승인된 구현 순서다. 각 단계는 관련 spec과 plan을 확인하고 진행한다.

- [x] Phase 0: 현재 모바일 로그북, watch payload, local storage 후보를 조사하고 첫 구현 file list를 확정한다.
- [x] Phase 1: `DiveLogEntry`, field provenance, sync status, `DiveLogRepository` 인터페이스를 만든다.
- [x] Phase 2: React Query mutation을 통해 로그인 없이 모바일에서 수동 로그를 만들고 수정해 repository에 저장한다.
- [x] Phase 2.5: Logbook, Planbook, 설정 선호를 AsyncStorage 기반 persistent repository/provider에 저장한다.
- [x] Phase 3: Watch에서 만든 contract-valid payload가 모바일로 들어올 수 있는지 검증한다.
- [ ] Phase 4: Watch 기반 로그 작성 화면에서 측정값을 잠금 처리하고 누락된 맥락을 모바일에서 채운다.
- [x] Phase 5A automated: local Supabase, generated type, Keychain-compatible session, iOS native Google/Apple Auth, current legal pointer와 재동의를 포함한 required consent를 추가했다. 기존 Logbook/Planbook은 local-only를 유지한다.
- [ ] Phase 5A promotion: hosted provider/legal/signing, physical Auth/re-consent와 post-Auth Watch regression을 검증한다. 이 gate 전에는 Phase 5B를 시작하지 않는다.
- [ ] Phase 5B: user-owned Logbook/Planbook RLS, keyset cursor infinite pagination, private immutable profile Storage를 추가한다.
- [ ] Phase 6: `guest`/`user:<uuid>` partition, persistent manifest와 bounded batch 기반 explicit guest claim, outbox/retry, revision conflict를 적용한다.
- [ ] Phase 7: account logout local purge와 즉시 영구 삭제를 적용하고 통합 회귀를 수행한다.

## 상세

모바일 로그 항목은 `WatchSession`과 분리된 `DiveLogEntry`가 되어야 한다. `WatchSession`은 watch-to-mobile sync contract이고, `DiveLogEntry`는 사용자가 보는 최종 로그북 항목이다.

오래 유지할 핵심 개념은 다음과 같다.

- `source`: `manual` 또는 `watch`.
- `fieldSource`: `manual`, `mobile`, `watch` provenance.
- `cloudSyncStatus`: 현재 `notConfigured`; remote outbox가 구현되면 `pending`, `synced`, `failed`를 사용한다.
- `localId`: 로컬 저장과 offline-first 동작의 기준.
- `remoteId`: Supabase sync 이후 remote row와 연결하는 선택 값.
- `ownerUserId`: 인증된 사용자 연결이 생긴 뒤 붙는 선택 값.

원격 목록은 한 번에 모두 가져오지 않는다. Logbook은 `(started_at desc, id desc)`, Planbook은 `(planned_at desc, id desc)` cursor와 기본 page size 30을 사용한다. 목록에는 bounded preview만 두고 전체 1Hz profile은 private Storage에서 detail을 열 때만 받는다.

3C에서 로컬 저장을 `guest`와 `user:<uuid>` namespace로 분리한다. Guest claim은 명시적 동의 뒤 copy-and-verify로 수행하며, 3D logout은 account partition과 downloaded profile을 기기에서 제거하고 guest를 보존한다. 현재 3A는 기존 unscoped guest 저장소를 그대로 유지한다. Watch `session.syncStatus: synced`는 계속 iPhone local import acknowledgement이고 remote cloud status와 별개다.

Watch-captured field는 원본을 덮어쓰지 않는다. 사용자가 틀렸다고 느끼는 경우에는 원본 수정 대신 메모, 표시 제외, 또는 별도 보정 계층을 검토한다.

모바일 수동 로그는 site, date/time, dive mode, duration, max depth, buddy, gear, tags, observed marine life, notes, rating 같은 field를 우선 다룬다. 입력 form은 dive mode별로 달라진다. 현재 새 로그의 active dive mode는 scuba와 freedive 두 가지이며, 모두 과거 기록과 리뷰용 metadata이고 감압이나 안전 판단 계산으로 확장하지 않는다. 모바일 위치 정보는 제안값일 뿐이며 로그 작성의 필수 조건이 아니다.

React Query는 durable store가 아니다. `useQuery`와 `useMutation`은 `DiveLogRepository`를 호출하고 cache invalidation, loading state, error state를 관리한다. 로컬 저장소와 future Supabase row가 실제 데이터 보관 책임을 갖는다.

현재 앱 기본 저장소는 AsyncStorage 기반 persistent repository다. Two-mode reset 이후 `DiveLogEntry[]`는 `dive-app:logbook:v2`, `DivePlan[]`는 `dive-app:planbook:v2`, 설정 선호는 `dive-app:preferences:v1` key에 versioned JSON envelope로 저장된다. React Query는 여전히 cache와 mutation orchestration만 맡고, 실제 보관 책임은 persistent repository와 future Supabase row가 갖는다.

Watch sync payload는 모바일에서 실행 시점 검증을 거친다. `watch-sync-message-validation.ts`는 원시 JSON string이나 `unknown` value를 `WatchSyncMessage` contract로 검증하고, 통과한 payload만 기존 repository import 흐름으로 넘긴다. 현재 앱 fixture도 `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`을 validator에 통과시켜 만든다.

WatchConnectivity PoC에서는 iOS native `WatchConnectivityModule`이 전달한 raw JSON payload도 같은 validator와 repository import 경로를 사용한다. Native inbox는 pending payload를 `UserDefaults`에 보존하고, JS import 성공 뒤 acknowledge된 항목만 제거한다. 이 경로는 실제 paired-device 전송 성공이나 background retry를 보장하지 않는다.

Logbook/Planbook은 현재 v2 key namespace를 사용하고, 설정 선호 store는 version 1 envelope를 사용한다. 향후 로그 모델, 계획 모델, 설정값이 변경되면 migration function을 추가해야 한다. Wave 3A Supabase/Auth boundary는 도입됐지만 remote Logbook/Planbook은 3B 후속이다. Mobile code는 direct SQL을 사용하지 않고 repository 함수를 통해 접근한다. Public schema table을 만들 경우 RLS와 user ownership policy가 함께 필요하다.

## 관련 문서

- [모바일 구조](mobile.md)
- [동기화 흐름 구조](sync-flow.md)
- [Supabase 구조](supabase.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- `docs/superpowers/specs/2026-06-21-mobile-logbook-local-first-design.md`
- `docs/superpowers/plans/2026-06-21-mobile-logbook-local-first.md`
- `docs/mobile-logbook-local-first-roadmap.html`
