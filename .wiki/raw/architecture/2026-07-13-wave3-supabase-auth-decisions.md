Source URL: project conversation; docs/superpowers/specs/2026-07-13-supabase-auth-cloud-sync-design.md; https://supabase.com/docs/guides/auth/auth-identity-linking; https://supabase.com/docs/reference/javascript/auth-signinwithidtoken
Collected: 2026-07-13
Published: 2026-07-13

# Wave 3 Supabase/Auth 승인 결정

Status: accepted design, implementation not started

## 실기기 기준선

사용자는 실기기에서 약 4분의 foreground pairing 테스트를 수행했다. Watch 세션은 모바일 Logbook으로 자동 import됐고, 모바일 로컬 저장 뒤 Watch session status가 synced로 바뀌었다. 이 보고는 foreground pairing, import, local save acknowledgement를 확인하지만 reconnect, background, killed app, large transfer, build identifier와 기기/OS 증거까지 완료한 것은 아니다.

## Wave 3 실행 순서

전체 실기기 검증은 Supabase 연결 뒤에도 반복해야 하므로 Wave 3을 먼저 진행한다. Wave 3은 다음 순서의 vertical slice로 나눈다.

1. 3A Supabase/Auth foundation.
2. 3B remote Logbook/Planbook와 profile Storage.
3. 3C local-first partition, guest claim, outbox, conflict.
4. 3D logout, immediate account deletion, integration.

각 단계는 자체 검증 gate를 통과한 뒤 다음 단계로 이동한다.

## 인증과 가입

- iOS부터 native Google과 native Apple 로그인을 제공한다.
- 이메일/비밀번호, magic link, SMS는 넣지 않는다.
- Android native Auth는 후속으로 두고 공통 interface만 호환 가능하게 유지한다.
- social identity 생성 뒤 현재 필수 이용약관과 개인정보 문서에 동의해야 app membership을 활성화한다.
- 필수 동의는 kind/version/agreedAt로 보존한다. 마케팅 동의는 범위 밖이다.
- nickname, avatar, profile 강화, 친구 기능은 친구 기능을 설계할 때 함께 추가한다.
- 앱에서 manual identity linking/unlinking 기능은 제공하지 않는다. 기술 검토 결과 Supabase Auth는 같은 verified email의 OAuth identity를 기본적으로 한 user에 automatic linking하므로 이 동작을 수용한다. App code가 email을 직접 비교하거나 provider별 별도 user를 강제하지 않는다.
- 마지막 성공 provider만 최근 사용 표시를 위해 비민감 preference로 보존한다.

## guest와 account data

- guest는 local-only를 유지한다.
- 로컬 저장소를 guest와 user:<uuid> namespace로 분리한다.
- 로그인 중 guest partition을 account list와 섞지 않으며, account cache는 공유 기기 보호를 위해 logout 때 기기에서 제거한다.
- guest를 account에 연결할 때는 사용자의 명시적 동의를 받는다.
- claim은 guest source를 유지한 채 account local copy, outbox, remote metadata와 profile 검증을 끝낸 뒤 source를 제거한다.
- 사용자가 claim을 거부하면 session을 종료하고 guest로 돌아간다.

## 목록과 profile

- Logbook과 Planbook 원격 목록은 offset이 아니라 keyset cursor infinite pagination을 사용한다.
- 기본 page size는 30이다.
- 목록 row에는 metadata와 최대 160개 preview sample만 포함한다.
- 전체 1Hz profile은 private Supabase Storage immutable object로 저장하고 detail에서만 다운로드한다.

## sync와 conflict

- local save가 UI 성공 조건이다.
- authenticated write는 local first로 저장하고 idempotent outbox가 remote로 전달한다.
- Watch session.syncStatus: synced는 계속 iPhone local import acknowledgement만 뜻하며 Supabase 결과를 기다리지 않는다.
- remote row는 revision을 사용한다. expected revision mismatch는 local mutation을 conflict로 보존하고 remote latest를 가져온다.
- last-write-wins, CRDT, 자동 field merge는 v1에서 사용하지 않는다.

## logout과 삭제

- logout은 account Keychain session, account partition, React Query cache, downloaded profile을 기기에서 제거하고 guest partition을 보존한다.
- account deletion은 앱 안에서 재확인 뒤 즉시 영구 삭제한다.
- 7일 유예 soft deletion/recovery는 명시적 후속 기능이다.
- service_role은 server boundary에만 둔다.

## 안전 경계

Supabase/Auth와 cloud 상태는 기록, 사후 review, backup 범위다. Watch 동작이나 cloud 연결은 감압 의무, 조직 loading, gas switching safety, 상승 허가, 비상 판단을 계산하거나 지시하지 않는다.
