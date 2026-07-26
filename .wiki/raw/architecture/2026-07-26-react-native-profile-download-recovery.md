Source URL: packages/supabase/src/guest-claim-repository.ts; apps/mobile/src/utils/utf8.ts; apps/mobile/src/sync/account-sync-coordinator.ts; local simulator account storage and Supabase HTTP cache
Collected: 2026-07-26
Published: 2026-07-26

# React Native profile download recovery evidence

## Reported behavior

- 같은 account의 remote list에는 다이빙 로그 5개가 있었지만 모바일 account
  partition에는 4개만 보였다.
- 누락된 항목은 다른 기기에서 Watch로 만든 로그였다.
- Home에는 `일부 데이터를 확인하지 못했습니다` 안내가 계속 보였고 `다시 시도`도
  같은 결과를 냈다.

## Runtime evidence

Simulator의 account local state와 Supabase 응답을 읽기 전용으로 비교했다.

- Supabase remote list에는 owner가 같은 non-deleted row 5개가 있었다.
- Account local Logbook에는 정상 hydrate된 row 4개가 있었다.
- 누락된 Watch row의 profile Storage GET은 HTTP 200이었다.
- 내려받은 profile은 1,585 bytes와 6 samples였고 row의 SHA-256, byte count,
  sample count descriptor와 정확히 일치했다.
- 같은 remote row와 정확한 profile bytes를 현재 coordinator에 직접 주입하면
  parsing, digest 검증과 local publication이 모두 성공했다.

따라서 remote row 부재, owner RLS, Storage policy, profile object 손상 또는 과거 Watch
session 자체가 원인이 아니었다. 실패는 정상 object를 React Native runtime에서
bytes와 JSON으로 바꾸는 경계에 있었다.

## React Native runtime boundary

첫 번째 실패는 Supabase Storage download가 반환한 React Native native `Blob`에 web
`Blob.arrayBuffer()`가 없는데 package repository가 이 method만 호출한 것이었다.
Package repository는 web-style `arrayBuffer()` fast path를 유지하면서 method가 없는
native `Blob`은 `FileReader.readAsArrayBuffer()`로 읽도록 변경했다.

이 fallback이 실제 simulator에서 실행된 뒤에는 mobile profile parser가 사용하던
global `TextDecoder`가 React Native runtime에 없어 `ReferenceError`가 발생했다.
다운로드와 digest 검증을 통과해도 UTF-8 JSON decode 전에 이 예외가 생겨 Watch row
하나가 hydrate되지 않았다.

## Chosen correction

- Mobile은 shared strict UTF-8 decoder를 사용한다.
- Runtime에 `TextDecoder`가 있으면 `fatal: true`로 decode한다.
- `TextDecoder`가 없으면 RFC 3629 범위의 manual decoder를 사용한다.
- Manual decoder는 잘못된 continuation byte, overlong sequence, truncated sequence,
  UTF-16 surrogate code point와 U+10FFFF 초과 값을 거부한다.
- Native fallback은 표준 `TextDecoder`와 같이 맨 앞 UTF-8 BOM 하나만 제거하고 그
  다음 BOM은 보존한다.
- 큰 profile은 bounded UTF-16 chunk로 문자열을 만들어 argument-count 한계를 피한다.
- Account hydration과 guest claim profile byte parsing은 같은 decoder를 사용한다.

이 correction은 malformed profile을 허용하는 compatibility relaxation이 아니다.
기존 owner/path, content revision, byte count, SHA-256, sample count와 session ID 검증은
그대로 유지한다.

## Home recovery meaning

Remote hydration은 row별 실패를 격리하므로 정상 row 4개는 먼저 account partition에
저장됐다. Watch profile row 하나의 native byte/decode failure가 aggregate
`remoteHydration` degraded 상태를 만들었고, Home 안내는 이 상태를 표현했다. `다시
시도`는 같은 정상 object를 다시 받아도 같은 runtime exception을 재현했기 때문에
변화가 없는 것처럼 보였다.

수정 뒤 account partition에는 remote row 5개가 모두 hydrate됐고 Watch profile은
native profile storage에서 6 samples로 확인됐다. 성공한 pull은 기존 상태 전이에 따라
matching `remoteHydration` issue를 해제한다.
앱을 완전히 종료한 뒤 다시 실행해도 Watch row는 `cloudSyncStatus: synced`로 유지됐고
Home에는 `일부 데이터를 확인하지 못했습니다` 안내가 다시 나타나지 않았다.

## Scope boundary

이 변경은 Supabase schema, migration, RLS, Storage policy와 profile integrity contract를
바꾸지 않는다. Home, Logbook 또는 recovery UI도 변경하지 않는다. 정상 remote bytes를
React Native에서도 web과 같은 검증 입력으로 읽고 strict UTF-8로 decode할 수 있게 한
runtime compatibility correction이다.
