# Guest Data Account Claim Device Checklist

작성일: 2026-07-20

대상: staging `mclvhwzsuvsxjerdouka`

상태 표기: 모든 physical check는 실행 전 `PENDING`이다. 자동화나 simulator 결과로 `PASS` 처리하지 않는다.

## 사전 조건

- [ ] `PENDING` 테스트용 staging account A와 B를 준비하고 서로 다른 `auth.uid()`를 기록한다.
- [ ] `PENDING` account-data migrations가 staging에 적용됐는지 `yarn supabase:staging:migrations`로 확인한다.
- [ ] `PENDING` `finalize-guest-claim` Edge Function의 staging deployment와 version을 확인한다.
- [ ] `PENDING` `yarn supabase:staging:verify:auth`가 성공하는지 확인한다.
- [ ] `PENDING` signed iPhone build와 Android development build가 staging endpoint만 사용하는지 확인한다.
- [ ] `PENDING` 테스트 전 account A/B의 `dive_logs`, `dive_plans`, claim staging row와 profile object가 비어 있는지 확인한다.

## 고정 Fixture

각 플랫폼의 새 앱 설치 또는 완전 초기화 상태에서 로그인하지 않고 다음 32개를 만든다.

- [ ] `PENDING` guest log 24개를 만든다. Manual 16개, Watch import 8개를 포함한다.
- [ ] `PENDING` Watch import log 중 4개는 full depth profile을 포함하고 나머지 4개는 profile이 없게 한다.
- [ ] `PENDING` guest plan 8개를 만든다. `draft`, `planned`, `completed`를 모두 포함한다.
- [ ] `PENDING` plan에서 전환한 log와 `sourcePlanLocalId` 관계를 최소 2쌍 포함한다.
- [ ] `PENDING` 목록과 상세에서 24 logs + 8 plans가 모두 열리고 원본 값이 보존되는지 확인한다.

## 기본 Claim Matrix

| ID | Platform | Viewport | Theme | Text | Motion | Status |
|---|---|---|---|---|---|---|
| C1 | iPhone | 320pt width | Light | Default | Standard | `PENDING` |
| C2 | iPhone | Large phone | Dark | Largest accessibility size | Reduce Motion | `PENDING` |
| C3 | Android | 320dp width | Light | Font scale 1.0 | Standard | `PENDING` |
| C4 | Android | Large phone | Dark | Font scale 2.0 | Remove animations/Reduce Motion | `PENDING` |

각 행에서 다음 절차를 수행한다.

1. [ ] `PENDING` guest fixture 32개가 있는 상태에서 account A로 로그인한다.
2. [ ] `PENDING` claim 선택 화면에 24 logs와 8 plans가 정확히 표시되는지 확인한다.
3. [ ] `PENDING` 가져오기를 선택하고 첫 두 항목이 원격 write/readback을 마칠 때까지 기다린다.
4. [ ] `PENDING` 세 번째 항목 완료 직후 화면에 공백을 포함한 exact progress `3 / 32`가 보이는지 확인한다.
5. [ ] `PENDING` progress bar 값이 `3 / 32`와 일치하고 VoiceOver/TalkBack progress 값도 3 of 32인지 확인한다.
6. [ ] `PENDING` item label, progress 숫자, action, sheet grabber가 겹치거나 화면 밖으로 잘리지 않는지 확인한다.
7. [ ] `PENDING` 완료 전 guest source가 삭제되지 않고 account row가 부분 완료 상태로 잘못 노출되지 않는지 확인한다.
8. [ ] `PENDING` 완료 뒤 account Logbook 24개와 Planbook 8개가 보이고 relation/profile/detail 값이 원본과 일치하는지 확인한다.
9. [ ] `PENDING` 같은 `localId`의 guest/account copy가 함께 존재하는 순간에도 account copy 하나만 표시되는지 확인한다.
10. [ ] `PENDING` 완료 뒤 exact snapshot과 일치하는 guest source, claim manifest sidecar, staging records가 정리되는지 확인한다.

## Lifecycle And Retry Matrix

| Scenario | iPhone | Android | Pass condition |
|---|---|---|---|
| Foreground full claim | `PENDING` | `PENDING` | 32개가 중복 없이 committed 되고 guest exact source가 정리된다. |
| Background/foreground | `PENDING` | `PENDING` | claim 중 background 후 foreground에서 같은 user/batch/count로 계속된다. |
| Force-quit resume | `PENDING` | `PENDING` | 강제 종료 후 재실행·로그인에서 새 batch 없이 저장된 manifest부터 재개한다. |
| Offline before start | `PENDING` | `PENDING` | source는 유지되고 네트워크 복구 뒤 사용자가 retry할 수 있다. |
| Offline during upload | `PENDING` | `PENDING` | 마지막 readback 완료 count까지만 표시하고 복구 뒤 중복 없이 재개한다. |
| Offline after remote commit | `PENDING` | `PENDING` | 재실행 시 upload를 반복하지 않고 `cleanupPending` cleanup을 마친다. |
| Session expiry | `PENDING` | `PENDING` | 다른 user로 이어서 쓰지 않고 같은 account 재인증 뒤 재개한다. |
| Duplicate retry tap | `PENDING` | `PENDING` | 동시 batch나 중복 account row를 만들지 않는다. |

Lifecycle 절차:

1. [ ] `PENDING` 각 시나리오 시작 전 24 + 8 fixture와 staging row/object baseline을 기록한다.
2. [ ] `PENDING` progress가 `3 / 32`일 때 지정된 interruption을 발생시킨다.
3. [ ] `PENDING` 재개 후 completed count가 이전 readback 완료 수보다 감소하거나 검증 없이 증가하지 않는지 확인한다.
4. [ ] `PENDING` 최종 account row count, unique `(user_id, local_id)`, revision과 profile object digest를 확인한다.

## Corrupt Profile

1. [ ] `PENDING` profile이 있는 guest log 하나의 local profile JSON을 snapshot 직전 손상시킨다.
2. [ ] `PENDING` claim이 `profile_corrupt` 또는 사용자용 일반 실패 상태로 멈추고 해당 item을 완료로 세지 않는지 확인한다.
3. [ ] `PENDING` 원본 guest log/profile과 다른 31개 guest item이 삭제되지 않는지 확인한다.
4. [ ] `PENDING` 오류 화면이 raw object path, token, Supabase error body 또는 내부 stack을 노출하지 않는지 확인한다.
5. [ ] `PENDING` profile을 정상화하고 retry했을 때 같은 manifest/batch 경계에서 완료되는지 확인한다.

## Keep On Device And Settings Retry

1. [ ] `PENDING` account A 로그인 후 claim 선택 화면에서 기기에 유지를 선택한다.
2. [ ] `PENDING` 24 logs + 8 plans가 삭제되지 않고 목록에 device-only badge로 표시되는지 확인한다.
3. [ ] `PENDING` badge가 light/dark, 320pt/320dp, large phone, Dynamic Type/font scale 2.0에서 잘리거나 주요 제목을 밀어내지 않는지 확인한다.
4. [ ] `PENDING` 앱 재시작과 background/foreground 뒤 deferred 상태가 자동 upload로 바뀌지 않는지 확인한다.
5. [ ] `PENDING` Settings retry action이 online authenticated 상태와 eligible guest data가 있을 때만 보이는지 확인한다.
6. [ ] `PENDING` Settings retry로 같은 24 + 8을 claim하고 exact `3 / 32` progress와 completion cleanup을 확인한다.
7. [ ] `PENDING` account copy와 같은 local ID인 deferred guest row는 account-copy-wins로 한 번만 표시되는지 확인한다.

## Logout, Login, Second Account Isolation

1. [ ] `PENDING` account A claim을 `3 / 32`에서 중단하고 logout한다.
2. [ ] `PENDING` account B로 로그인해 A의 account rows, outbox, manifest, profile, progress와 query cache가 보이지 않는지 확인한다.
3. [ ] `PENDING` B에서 guest data를 기기에 유지하고 device-only badge가 B account data와만 합성되는지 확인한다.
4. [ ] `PENDING` logout 후 account A로 다시 로그인해 A의 기존 claim만 같은 progress/batch에서 재개되는지 확인한다.
5. [ ] `PENDING` A claim 완료 뒤 logout/login해 account rows가 중복되지 않고 guest cleanup이 유지되는지 확인한다.
6. [ ] `PENDING` staging에서 account A/B의 row와 profile path 첫 segment가 각자의 `auth.uid()`와 일치하는지 확인한다.

## Accessibility And Visual Checks

- [ ] `PENDING` iPhone 320pt와 Android 320dp에서 제목, `3 / 32`, actions와 실패 상태가 겹치지 않는다.
- [ ] `PENDING` large iPhone/Android에서 sheet가 불필요하게 full-screen card처럼 늘어나지 않는다.
- [ ] `PENDING` light/dark 모두에서 progress track/fill, device-only badge와 disabled action contrast를 확인한다.
- [ ] `PENDING` iOS largest accessibility Dynamic Type에서 text가 잘리지 않고 세로로 재배치된다.
- [ ] `PENDING` Android font scale 2.0에서 긴 한국어/영어 label과 `3 / 32`가 container 밖으로 나가지 않는다.
- [ ] `PENDING` VoiceOver/TalkBack focus 순서가 title, counts, primary action, secondary action 순서로 이해 가능하다.
- [ ] `PENDING` Reduce Motion 또는 Android remove animations에서 progress 의미가 유지되고 필수 정보를 animation에만 의존하지 않는다.
- [ ] `PENDING` completion announcement가 한 번만 읽히고 이전 account/user의 stale announcement가 나오지 않는다.

## Watch Regression

Guest 상태와 authenticated account A 상태에서 각각 수행한다.

1. [ ] `PENDING` paired Apple Watch에서 새 session을 기록하고 iPhone foreground import를 완료한다.
2. [ ] `PENDING` mobile local repository 저장 뒤에만 Watch가 `synced`로 바뀌는지 확인한다.
3. [ ] `PENDING` Supabase를 offline으로 둬도 mobile local import ACK가 account cloud operation과 독립적으로 완료되는지 확인한다.
4. [ ] `PENDING` guest import는 guest partition, authenticated import는 account A partition에 저장되는지 확인한다.
5. [ ] `PENDING` logout 직전/직후 들어온 payload가 account B나 잘못된 principal에 publish되지 않는지 확인한다.
6. [ ] `PENDING` Watch contract/artifact에 account `userId`, Supabase token 또는 remote object path가 추가되지 않았는지 확인한다.

## 종료 판정

- [ ] `PENDING` matrix의 모든 필수 행이 실제 기기, OS version, build SHA, account와 실행 시각을 기록했다.
- [ ] `PENDING` 24 logs + 8 plans의 remote/local count와 profile digest가 일치한다.
- [ ] `PENDING` exact `3 / 32`, force-quit cleanup resume, offline retry, corrupt profile, keep-on-device, Settings retry와 second-account isolation이 모두 통과했다.
- [ ] `PENDING` iPhone/Android 접근성 및 Watch guest/authenticated regression이 모두 통과했다.

Production Supabase와 앱 내 즉시 영구 account deletion은 이 체크리스트의 통과 여부와 별개의 release gate다.
