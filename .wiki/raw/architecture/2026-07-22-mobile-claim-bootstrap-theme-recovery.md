Source URL: apps/mobile/src/states/account-data.tsx
Collected: 2026-07-22
Published: 2026-07-22

# Mobile claim, bootstrap, and theme recovery

사용자는 로그인 뒤 Settings의 기기 데이터 가져오기 버튼이 빈 시트처럼 보이고, 로그인 직후 가져오기가 첫 항목에서 즉시 실패하며, 이후 앱이 splash 다음 흰 화면에 머무는 문제를 보고했다. 또한 explicit light/dark에서 system theme으로 돌아갈 때 실제 system appearance와 달라지고 native modal/sheet 하단 배경이 테마를 따르지 않는 문제를 보고했다.

승인한 방향은 앱을 계속 사용할 수 있는 fail-open local publication과 별도 recovery UI다. Guest 원본을 삭제하거나 로그아웃·저장소 초기화로 복구하지 않는다. Settings, 로그인 직후 claim sheet, Home recovery banner가 하나의 claim 상태를 보여주고, 준비·진행·실패 상태에서 빈 native sheet를 만들지 않는다.

구현 근거:

- `apps/mobile/src/states/account-data.tsx`는 선택된 principal의 local repositories를 optional outbox reconciliation과 remote hydrate/drain보다 먼저 publish한다. Optional 단계 실패는 `degraded`, local repository 구성 실패는 `recoveryRequired`다.
- `apps/mobile/src/components/app-error-boundary.tsx`와 `apps/mobile/src/screens/recovery/screen.tsx`는 영구 empty fragment 대신 preserve-data loading/retry 화면을 제공한다.
- `apps/mobile/src/claim/guest-claim-store.ts`와 `guest-claim-service.ts`는 claim digest 밖의 strict optional `failure`에 phase, entity kind, bounded local id와 label을 보존한다. Profile/relationship preflight 실패는 remote batch 생성 전에 반환된다.
- `apps/mobile/src/screens/account-claim/screen.tsx`는 hidden/busy 상태를 준비 화면으로, running/finalizing/cleanup을 단계별 진행 화면으로, failed를 원본 보존 설명과 문제 label로 표시한다.
- `apps/mobile/src/screens/settings/screen.tsx`는 owned account의 eligible, running, failed, deferred claim 상태를 online/offline 여부와 별개로 다시 열 수 있게 유지한다.
- `apps/mobile/src/providers.tsx`는 `themePreference` 자체를 Gluestack/NativeWind override로 전달한다. `resolvedTheme`은 status bar와 React Navigation theme을 파생하는 데 사용한다.
- `apps/mobile/src/components/navigation/index.tsx`는 semantic navigation palette와 form-sheet `contentStyle`을 사용해 modal/sheet의 native uncovered area도 같은 배경을 사용한다.
- WatchConnectivity acknowledgement 의미는 변경하지 않았다. ACK는 mobile local repository 저장을 뜻하며 account cloud sync나 guest claim 완료를 뜻하지 않는다.
