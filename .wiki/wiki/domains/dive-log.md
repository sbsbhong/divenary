# 다이브 로그 도메인

Sources: pre-Karpathy wiki page, 2026-06-28; mobile form validation and pressure metadata, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09; pre-real-dive readiness scope and immediate hardening, 2026-07-12
Raw: [Pre-Karpathy: 다이브 로그 도메인](../../raw/domains/dive-log.md); [Mobile form validation and pressure metadata](../../raw/domains/2026-06-28-mobile-form-validation-pressure-metadata.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md)
Updated: 2026-07-12

## 요약

Dive log domain은 watch 기록과 모바일 수동 로그를 과거 기록 확인과 review에 사용한다. Watch transfer status는 raw capture에 보존하고, 모바일 cloud 상태는 별도 `cloudSyncStatus`로 관리한다. Backend가 없는 현재 값은 `notConfigured`이며 cloud 상태 UI를 표시하지 않는다. Safety stop 기록은 감압 정지 기록과 같은 의미가 아니다.

## 현재 상태

Shared watch sync contract는 `WatchSession`, `WatchDepthSample`, `WatchLocation`, `WatchSyncMessage`를 사용한다. Watch 앱은 동기화 가능한 payload로 mapping되는 local Swift `DiveSessionRecord`, `DiveSessionPayload`, `DepthSample` model을 갖는다. 모바일 앱의 최종 로그북 항목은 `DiveLogEntry`이며, 기존 Home/Planning 화면을 위해 `MobileDiveSession` compatibility view를 만든다.

## 상세

Session 식별과 시간 표현은 다음과 같다.

- `localSessionId`는 sync contract에서 watch-side session을 식별한다.
- Shared contract의 `startedAt`, `endedAt`, sample timestamp, location capture time은 Unix timestamp seconds다.
- Watch local model은 Swift `Date`를 사용한다.
- Mobile import key는 `localSessionId`와 `endedAt`을 조합한다. 열려 있는 세션은 key에 `open`을 사용한다.

Session metadata는 다음 field를 포함한다.

- `schemaVersion`
- `diveMode`
- `gasLabel`
- `siteId`, `siteName`
- `buddyIds`
- `gearIds`
- `tags`
- `notes`
- `rating`
- `perceivedExertion`
- `visibilityRating`
- `waterCondition`
- `syncStatus`
- `captureMode`: `real` 또는 `demo`
- `entryLocation`, `exitLocation`
- mode-specific nested payload: `freedive` 또는 `scuba`

Freedive watch payload는 다음 개념을 포함한다.

- `diveCount`
- session `maxDepthMeters`
- `longestDiveDurationSeconds`
- `segments`
- 각 segment의 id, index, 시작/종료 시간, duration, max/min depth, sample range, optional descent/ascent rate

Scuba watch payload는 다음 개념을 포함한다.

- gas label
- max/average depth
- water temperature
- latest/max ascent rate
- `safetyStop`
- safety stop status, current `required`/completed flags, target/min/max depth, duration, remaining time, time in zone, optional start/completion timestamp

현재 `safetyStop.required` field는 v1 권장 리마인더가 arm 되었는지를 나타내는 기존 contract 표현으로만 해석한다. 이 이름은 mandatory decompression stop처럼 읽힐 수 있으므로 다음 contract 작업에서는 `recommended`, `advisory`, `required`, `mandatory`, `decompressionStop`을 어떻게 분리할지 migration을 검토해야 한다. 감압 정지 사실을 저장해야 한다면 safety stop object에 섞지 말고 source provenance와 model/source type을 가진 별도 구조로 설계한다.

Sample metadata는 다음 field를 포함한다.

- `localSessionId`
- `timestamp`
- `depthMeters`
- optional `pressureKPa`
- optional `waterTemperatureCelsius`

Review summary는 duration, max depth, average depth, sample count, average water temperature, freedive segment summary, scuba safety stop reminder summary를 포함할 수 있다. 이 값들은 과거 기록 확인용 값이며 감압 계산이나 비상 지침이 아니다. Apple Watch 기반 v1에서는 40m 이하 수심만 지원 범위로 취급한다. 40m보다 깊은 수심은 manual/watch/planning 값 모두 보존하되 unsupported-depth marker나 warning 없이 정상 지원처럼 표시하지 않는다.

Mobile model은 `WatchSession`과 모바일 최종 로그 항목을 분리한다. `WatchSession`은 watch-to-mobile sync contract로 유지하고, 모바일 로그북은 별도 `DiveLogEntry`를 사용한다.

`DiveLogEntry`는 다음 개념을 보존한다.

- `source`: `manual` 또는 `watch`.
- `fieldSource`: `manual`, `mobile`, `watch` provenance.
- `cloudSyncStatus`: `notConfigured`, `pending`, `synced`, `failed`.
- `localId`: 로컬 저장 기준 식별자.
- `remoteId`: future Supabase row와 연결하는 선택 식별자.
- `ownerUserId`: future authenticated user 연결.

`pending`/`synced`/`failed`는 future cloud outbox 상태를 위해 예약된다. Backend와 outbox가 없으므로 현재 수동/watch 항목은 모두 `notConfigured`이며 cloud badge와 filter를 숨긴다. Raw Watch `session.syncStatus`는 local WatchConnectivity 전송 provenance다.

Watch-captured 측정값은 원본 출처를 보존하고 모바일 편집 화면에서 잠금 값으로 다룬다. Manual field와 mobile-assisted field는 사용자가 수정할 수 있다.

현재 수동 로그 field는 site, optional `entryStyle`, startedAt, dive mode, duration, max depth, buddy, gear, tags, observed marine life, notes, rating을 다룬다. `entryStyle`은 `shore`, `boat`, `pool` 중 하나지만 선택 field다. 기존 수동 로그와 watch import에는 기본값을 넣지 않으며, 값이 없는 상태와 `shore`를 같은 사실로 취급하지 않는다. 새 로그에서 선택 가능한 `diveMode`는 `scuba`와 `freedive` 두 가지다. Scuba는 현재 Air-only gas label을 표시하고, water condition, visibility rating, perceived exertion, optional pressure metadata를 저장할 수 있다. Pressure metadata는 `unit`(`bar` 또는 `psi`), start, end를 가진 `manual.measuredValues.pressure`이며, 사용자가 입력한 기록 맥락일 뿐 gas remaining이나 reserve 판단이 아니다. Watch-sourced scuba log도 사용자가 편집으로 start/end pressure를 입력하면 detail에서 두 값을 함께 표시한다. Watch import 자체는 tank pressure sensor 값이나 종료 압력을 자동 생성하지 않는다. Freedive는 repetition count, training focus, perceived exertion을 저장할 수 있다. 수동 최대 수심이 40m를 넘으면 저장은 허용하지만 Apple Watch 기반 지원 범위 밖이라는 warning을 표시한다. 비어 있거나 유효하지 않은 수치 field는 `0`으로 저장하지 않고 `undefined`로 유지해 알 수 없는 값과 실제 0 값을 구분한다. Review summary와 preview aggregate도 같은 규칙을 따라 unknown duration/depth를 `0`으로 더하지 않고 placeholder로 표시한다.

`scuba`와 `freedive` 두 모드 축소는 watch sync contract, generated TypeScript/Swift, validator, 모바일 Logbook/Planbook, watch picker와 recording UI에 반영됐다. 기존 local Logbook/Planbook v1 데이터는 v2 storage key namespace로 분리되어 새 앱 상태에서 다시 시작한다.

완료된 Planbook 항목에서 Logbook 초안을 만들 수 있다. 이 전환은 자동 로그 저장이 아니라 수동 editor를 여는 흐름이다. 계획에서 복사하는 값은 site, buddy, gear, tags, dive mode, optional `entryStyle`, Air gas label, optional scuba pressure metadata, objective/training focus/notes 같은 안전한 metadata로 제한한다. 계획 최대 수심, 계획 시간, 예상 시야, 예상 난이도, checklist 상태는 실제 측정값이 아니므로 `DiveLogEntry.manual.measuredValues.maxDepthMeters`나 `durationSeconds`에 복사하지 않는다.

Watch import는 raw `WatchSession`을 `watchCapture.session`에 보존한다. 같은 import key가 다시 들어오면 manual/mobile field와 cloud 상태를 유지하고 watch capture만 최신 payload로 갱신한다. 자동 event와 수동 drain은 process-wide coordinator로 같은 concurrent `payloadId`를 합치며 repository key도 row를 dedupe한다.

Watch sample profile은 모바일 detail에서 depth/temperature SVG path로 렌더링한다. 원본 sample은 보존하고, 렌더링 단계에서만 min/max bucket downsampling을 적용해 850개 이상의 sample도 detail 화면에서 보이도록 한다.

Legacy watch local log는 새 record model로 adapter된다. 모바일 runtime validator도 이미 native inbox에 들어온 schema v1/unknown flat `diveMode` payload를 mode-specific payload로 보강한다. 기존 freedive log는 하나의 `FreeDiveSegment`를 가진 `FreeDiveSession`으로 보존하고, 기존 scuba log는 safety stop 상태를 unknown 또는 not required로 기본 처리한다. 이 adapter와 validator 호환 경로는 기존 저장 데이터를 깨뜨리지 않기 위한 계층이며, 오래된 로그에 없던 safety stop 완료 사실을 새로 만들어내지 않는다.

앱 기본 저장소는 AsyncStorage 기반 `PersistentDiveLogRepository`다. 기존 `dive-app:logbook:v2` key의 schema 3은 schema-2 top-level 상태를 `cloudSyncStatus: notConfigured`로 migration한다. `LocalDiveLogRepository`는 테스트용 in-memory 저장소다.

## 관련 문서

- [동기화 흐름 구조](../architecture/sync-flow.md)
- [모바일 구조](../architecture/mobile.md)
- [모바일 로그북 로드맵](../architecture/mobile-logbook-roadmap.md)
- [다이브 계획 도메인](dive-planning.md)
- [Watch 앱 구조](../architecture/watch-app.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- [다이빙 용어](diving-glossary.md)
- [안전 규칙](safety-rules.md)
