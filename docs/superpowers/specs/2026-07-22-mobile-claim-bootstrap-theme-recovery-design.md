# Mobile Claim, Bootstrap, and Theme Recovery Design

## Context

로그인 뒤 guest 데이터를 계정으로 가져오는 흐름에서 다음 문제가 함께 보고됐다.

- Settings의 `기기 데이터 가져오기`를 눌러도 claim sheet가 열리지 않는 경우가 있다.
- 로그인 직후 claim을 시작하면 진행률 초기에 바로 실패하지만, UI가 실패 원인이나 문제 항목을 설명하지 않는다.
- 중단된 claim 또는 account-data 준비 실패 이후 native splash가 사라지고 영구적인 흰 화면만 남을 수 있다.
- light 또는 dark를 선택한 뒤 `시스템 설정`으로 돌아가면 실제 시스템 appearance와 다른 테마가 유지될 수 있다.
- modal과 sheet의 bottom safe area 또는 native presentation surface 일부에 현재 테마가 적용되지 않는다.

이번 변경의 최우선 목표는 한 건의 손상, claim 실패, 원격 동기화 실패가 앱 전체 부팅을 막지 않게 하는 것이다. 데이터 원본 보존과 principal 격리를 UI 완성도보다 우선한다.

## Product Decisions

- 앱은 local principal repository가 준비되면 먼저 열린다. account sync, outbox drain, claim resume는 UI publication 이후 수행한다.
- account-data 준비가 일부 실패하면 계정 세션을 유지하고 접근 가능한 로컬 데이터를 보여주는 `degraded` 상태로 진입한다.
- 손상된 claim 항목은 삭제하거나 건너뛰어 성공 처리하지 않고 격리한다. 나머지 앱과 기록은 계속 사용할 수 있다.
- 로컬 저장소 자체를 읽을 수 없는 경우에도 빈 화면을 렌더링하지 않고 전용 recovery shell을 표시한다.
- 네트워크 일시 중단과 정상 manifest의 process interruption만 자동 재개한다. profile, relationship, manifest validation, remote conflict 오류는 사용자 action 전까지 자동 반복하지 않는다.
- Settings와 로그인 직후 자동 제안은 같은 account-claim sheet route와 같은 state model을 사용한다.
- 테마와 claim 상태는 독립적이다. 모든 claim 상태는 light, dark, system appearance에서 동일하게 동작한다.
- 데이터 삭제, AsyncStorage 초기화, 자동 로그아웃은 복구 수단으로 사용하지 않는다.

## Explored Approaches

### A. App remains usable with a scoped recovery sheet

앱은 접근 가능한 로컬 데이터로 열리고, 홈의 compact recovery banner와 Settings row가 동일한 native form sheet를 연다. 선택, 사전 검사, 진행, 실패, 재시도가 한 sheet 안에서 전환된다. 문제 항목만 격리하고 다른 기록은 계속 사용한다.

이 안은 강건성, 문제 가시성, 기존 app context 보존의 균형이 가장 좋아 채택한다.

### B. Dedicated recovery screen before app entry

문제가 가장 명확하지만 account-data의 부분 실패에도 앱 진입을 막는다. 모든 로컬 repository를 열 수 없는 최후의 recovery shell에만 제한한다.

### C. Settings-only recovery

앱 사용을 가장 적게 방해하지만 문제를 놓치기 쉽고, Settings action이 무반응처럼 느껴지는 현재 문제를 반복할 수 있어 제외한다.

## Visual Direction

### Subject, audience, and job

- **Subject:** 로그인 전 iPhone에 쌓인 다이빙 기록을 계정으로 안전하게 옮기고 복구하는 순간.
- **Audience:** 로그가 사라지거나 중복되는 것을 경계하는 returning diver.
- **Single job:** 앱 사용을 막지 않으면서 어떤 기록에 문제가 있고 다음에 무엇을 할 수 있는지 명확히 보여준다.

### Palette and type

기존 semantic token을 유지하고 직접 색상을 component에 흩뿌리지 않는다.

- Divenary Blue `#0066CC` / dark `#0A84FF`: primary action과 depth-trace progress.
- System Mist `#F5F5F7`: light grouped background.
- Cloud White `#FFFFFF`: light elevated sheet surface.
- Dive Ink `#1D1D1F`: light primary text.
- Night Surface `#1C1C1E`: dark elevated sheet surface.
- Signal Amber `#FF9F0A`: 사용자가 확인해야 하는 복구 상태. destructive 의미의 red와 구분한다.

별도 font dependency를 추가하지 않는다. iOS system type을 display/body에 사용하고 진행 count에는 tabular figures를 적용한다.

### Signature and restraint

기존 `DepthTraceProgress`를 유일한 signature element로 유지한다. 오류마다 illustration, gradient, 큰 warning symbol을 추가하지 않는다. 문제 상태는 amber status point, 구체적인 기록명, 다음 action으로 전달한다.

### Surface hierarchy

- 앱이 degraded 상태로 열리면 compact recovery banner를 표시한다.
- banner와 Settings row는 동일한 claim sheet를 연다.
- sheet root, content, footer, bottom safe area와 native stack presentation background는 모두 현재 semantic background를 사용한다.
- light/dark 예시는 서로 다른 claim 상태가 테마를 전환한다는 뜻이 아니다. 모든 상태는 현재 resolved appearance를 그대로 따른다.

Apple HIG의 scoped-task sheet, determinate progress, adaptive semantic color, immediate launch 원칙을 따른다.

- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Launching](https://developer.apple.com/design/human-interface-guidelines/launching)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)

## Bootstrap Architecture

### Explicit states

Account-data bootstrap은 다음 상태를 명시적으로 가진다.

- `loading`: local principal boundary를 정하는 짧은 초기 단계.
- `ready`: local repository가 published됐고 optional remote services도 사용할 수 있다.
- `degraded`: local repository는 사용할 수 있지만 migration, remote hydrate, sync, claim restore 중 하나가 실패했다.
- `recoveryRequired`: 선택한 principal의 local repository를 안전하게 읽을 수 없다.

Provider는 실패 뒤 영구적으로 empty Fragment를 반환하지 않는다. `degraded`에서는 children을 렌더링하고 recovery controller를 제공한다. `recoveryRequired`에서는 principal-safe recovery shell을 렌더링한다. 예상하지 못한 render error는 top-level error boundary가 같은 recovery shell로 전환한다.

### Local publication before optional remote work

현재 하나의 `publish()` 안에서 처리되는 책임을 다음 경계로 분리한다.

1. principal 결정과 local repository 생성
2. 안전하게 가능한 legacy migration
3. local repository publication
4. claim store inspection과 presentation 계산
5. outbox reconciliation, remote hydration, drain, resumable cleanup

3번이 완료되면 UI를 렌더링한다. 4~5번의 실패는 이미 published된 local repository를 철회하지 않는다. legacy migration 실패는 기존 versioned partition을 삭제하거나 덮어쓰지 않으며 migration recovery로 격리한다.

### Principal isolation

- 로그인 세션과 data recovery 상태를 분리한다.
- claim 실패 때문에 로그아웃하지 않는다.
- `user:<uuid>` 초기화 실패 시 다른 account partition을 fallback으로 공개하지 않는다.
- guest 데이터는 기존 composition과 explicit claim 규칙 안에서만 계정 화면에 보인다.
- WatchConnectivity local import acknowledgement는 account cloud sync 또는 claim 완료로 재해석하지 않는다.

## Claim Entry and State Model

Settings의 claim row는 eligible guest data가 있거나 claim이 `choice`, `deferred`, `failed`, `running` 상태일 때 동일한 route를 연다. route가 준비되지 않았다면 무반응으로 끝내지 않고 준비 상태를 표시한다.

Claim presentation은 다음 단계를 구분한다.

- `choice`: 가져오기 또는 기기에 유지 선택.
- `checking`: 원격 write 전 전체 local preflight.
- `running`: 원격 staging과 item readback. `completed / total` 표시.
- `finalizing`: server finalization과 remote readback.
- `cleanup`: account local publication/readback과 exact-match guest cleanup.
- `failed`: 오류 code, phase, 문제 item을 포함한 복구 상태.
- `complete`: accessibility announcement 뒤 sheet 종료.

`checking`은 record count를 기반으로 진행을 표시할 수 있지만 remote upload progress와 섞지 않는다.

## Claim Data Flow

### Preflight before remote writes

사용자가 가져오기를 시작하면 immutable snapshot을 만든 뒤 모든 item을 원격 호출 전에 검사한다.

1. snapshot과 manifest schema, owner, ordered item consistency
2. log/plan ID uniqueness와 relationship validity
3. profile artifact 존재 여부
4. profile byte count, SHA-256, sample count, local session consistency
5. 기존 owned manifest와 retry compatibility

하나라도 실패하면 remote repository를 호출하지 않는다. 실패 상태에는 안정적인 error code, phase `checking`, 문제 item의 kind/local id/label을 저장한다. 원본 record와 profile은 그대로 보존한다.

### Upload, finalization, and cleanup

Preflight 통과 뒤에만 manifest를 `running`으로 저장한다.

1. batch create/load
2. item metadata stage
3. profile upload와 readback verification
4. item completion persist
5. server finalization
6. committed rows remote readback
7. account local publication/readback
8. exact-match guest cleanup 또는 changed-row reconciliation

Count는 4번까지 완료한 뒤에만 올라간다. 각 단계는 existing idempotency key와 durable manifest를 유지한다. finalization 전 staging data는 일반 account query에 보이지 않는다.

### Recovery policy

자동 재개 대상은 다음뿐이다.

- `network_unavailable`
- process termination으로 남은 `running` 또는 `finalizing`
- `committed` 또는 `cleanupPending`의 local publication/cleanup

다음 오류는 자동 재개하지 않는다.

- `profile_missing`
- `profile_corrupt`
- `relationship_invalid`
- `claim_validation_failed`
- `remote_conflict`
- 재인증이 필요한 `session_expired`

자동 재개는 active foreground, authenticated online, current generation, matching user에서 single-flight로 한 번만 실행한다. 같은 lifecycle event 안에서 무한 retry loop를 만들지 않는다.

## Error Presentation and Diagnostics

Failure UI는 raw server message를 노출하지 않는다. 다음 정보를 보여준다.

- 사용자가 이해할 수 있는 원인
- 문제 record label과 종류
- 어느 단계에서 멈췄는지
- `다시 확인` 또는 `다시 시도`
- `지금은 기기에 유지`

내부 diagnostic event는 error code, phase, principal scope, batch id, safe item identifier를 포함하되 profile bytes, Auth token, raw payload를 기록하지 않는다.

## Theme Architecture

### One preference, one resolved appearance

`themePreference` (`system | light | dark`)가 유일한 사용자 설정이다. NativeWind에는 계산된 `resolvedTheme`가 아니라 preference 자체를 전달한다. `system` 선택 시 NativeWind의 강제 appearance override를 해제한다.

`resolvedTheme`은 override가 해제된 실제 system appearance 또는 explicit light/dark preference에서 계산한다. 다음 consumer는 모두 같은 resolved value를 사용한다.

- Gluestack semantic token config
- StatusBar
- React Navigation theme
- native-stack `contentStyle`
- form sheet와 modal의 native presentation background
- overlay portal, action sheet, modal, bottom sheet content/footer

### Surface completion

모든 modal/sheet screen root는 `flex-1 bg-background`를 사용하고 bottom safe area까지 채운다. Native stack screen option에도 현재 semantic background를 제공해 React content 밖의 presentation surface가 white 또는 black strip으로 남지 않게 한다.

## Accessibility

- Progress에는 `progressbar` role과 min/max/now를 제공한다.
- 실패는 color만으로 구분하지 않고 title, record label, reason을 함께 제공한다.
- Dynamic Type 200%와 320pt width에서 primary/secondary action이 잘리지 않아야 한다.
- Reduce Motion에서는 depth-trace fill과 state transition animation을 제거한다.
- 상태 변화 announcement는 failure와 completion에 집중하고 매 item마다 screen reader를 방해하지 않는다.
- light/dark 모두 작은 text 최소 4.5:1 contrast를 유지한다.

## Testing Strategy

### Bootstrap regression tests

- legacy migration, local repository preparation, claim store read, outbox hydration, remote sync 실패를 각각 주입한다.
- optional failure 뒤 앱 children과 principal-safe local data가 렌더링되는지 확인한다.
- local repository 자체 실패에서는 recovery shell이 렌더링되고 empty Fragment가 남지 않는지 확인한다.
- 다른 principal query/cache/repository가 노출되지 않는지 확인한다.
- top-level render failure가 recovery UI로 전환되는지 확인한다.

### Claim tests

- Settings row가 `choice`, `deferred`, `failed`, `running`에서 같은 sheet를 연다.
- 준비 중 action이 무반응이 아니라 disabled/loading feedback을 제공한다.
- missing/corrupt profile, invalid relationship, malformed manifest가 preflight에서 실패하고 remote call count가 0인지 확인한다.
- 문제 item metadata가 raw payload 없이 failure state에 전달되는지 확인한다.
- retry가 completed remote item을 중복 stage/upload하지 않는지 확인한다.
- transient failure만 foreground/online에서 자동 재개되는지 확인한다.
- permanent failure가 rerender, AppState event, cold launch에서 반복 실행되지 않는지 확인한다.

### Theme tests

- light → dark → system, dark → light → system
- system 상태의 OS appearance change
- persisted system preference cold launch
- StatusBar, NavigationContainer, native stack content style의 resolved appearance 일치
- login, claim, modal, action sheet, bottom sheet의 content와 bottom safe area surface 일치

### Verification gates

1. focused mobile Jest regression tests
2. full mobile tests
3. `yarn mobile:typecheck`
4. `yarn ios:build`
5. physical iPhone cold launch, force quit/resume, login claim, failure retry, system/light/dark 전환

AsyncStorage 삭제나 앱 재설치가 있어야 통과하는 검증은 성공으로 인정하지 않는다. 현재 설계에는 Supabase schema 변경이 필요하지 않다. 구현 조사 중 remote contract 결함이 확인되면 별도 승인을 받는다.

## Non-Goals

- guest 원본 자동 삭제 또는 손상 record 자동 건너뛰기
- account deletion이나 production Supabase 승격
- 새로운 navigation, UI, state-management dependency 추가
- Watch의 Auth, Supabase, claim 책임 추가
- 감압, 상승 판단, 비상 지시 같은 safety-critical 기능

## Self-Review

- Placeholder: 없음.
- Consistency: local-first publication, explicit recovery state, claim preflight, exact-match cleanup이 같은 data-preservation 원칙을 따른다.
- Scope: mobile bootstrap, account claim entry/recovery, app theme와 presentation surface에 한정한다.
- Ambiguity: `system`은 claim 상태가 아니라 OS appearance preference이며, permanent claim error는 자동 재개하지 않는다고 명시했다.
